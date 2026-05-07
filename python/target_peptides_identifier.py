#!/usr/bin/env python3
"""Find tryptic peptides shared by every species/strain descendant of a given
set of NCBI taxa and unique to that set per the Unipept LCA."""

from __future__ import annotations

import argparse
import logging
import re
import sys
from typing import Iterable, Iterator

import requests
from opensearchpy import OpenSearch
from opensearchpy.exceptions import ConnectionError as OSConnectionError
from opensearchpy.exceptions import OpenSearchException
from opensearchpy.helpers import scan
from requests.adapters import HTTPAdapter
from tqdm import tqdm
from urllib3.util.retry import Retry


TRYPSIN_RE = re.compile(r"(?<=[KR])(?!P)")

LINEAGE_ID_FIELDS = (
    "domain_id", "realm_id", "kingdom_id", "subkingdom_id",
    "superphylum_id", "phylum_id", "subphylum_id",
    "superclass_id", "class_id", "subclass_id",
    "superorder_id", "order_id", "suborder_id", "infraorder_id",
    "superfamily_id", "family_id", "subfamily_id",
    "tribe_id", "subtribe_id",
    "genus_id", "subgenus_id",
    "species_group_id", "species_subgroup_id",
    "species_id", "subspecies_id",
    "strain_id", "varietas_id", "forma_id",
)

logger = logging.getLogger("target_peptides")

PROGRESS_DISABLED = not sys.stderr.isatty()


def progress(iterable=None, **kwargs) -> "tqdm":
    """tqdm wrapper that auto-disables when stderr is not a terminal."""
    kwargs.setdefault("disable", PROGRESS_DISABLED)
    return tqdm(iterable, **kwargs)


class TqdmLoggingHandler(logging.Handler):
    """Route log records through tqdm.write so they don't tear active bars."""

    def emit(self, record: logging.LogRecord) -> None:
        try:
            tqdm.write(self.format(record), file=sys.stderr)
            self.flush()
        except Exception:
            self.handleError(record)


def configure_logging(log_file: str | None) -> None:
    fmt = logging.Formatter("[%(levelname)s] %(message)s")
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    for h in list(root.handlers):
        root.removeHandler(h)

    tqdm_handler = TqdmLoggingHandler()
    tqdm_handler.setFormatter(fmt)
    root.addHandler(tqdm_handler)

    if log_file:
        file_handler = logging.FileHandler(log_file, mode="w")
        file_handler.setFormatter(fmt)
        root.addHandler(file_handler)

    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.getLogger("opensearch").setLevel(logging.ERROR)
    logging.getLogger("opensearchpy").setLevel(logging.ERROR)


def build_session() -> requests.Session:
    session = requests.Session()
    retry = Retry(
        total=5,
        backoff_factor=0.5,
        status_forcelist=(429, 500, 502, 503, 504),
        allowed_methods=frozenset(["GET", "POST"]),
        raise_on_status=False,
    )
    adapter = HTTPAdapter(max_retries=retry, pool_connections=10, pool_maxsize=10)
    session.mount("http://", adapter)
    session.mount("https://", adapter)
    return session


def chunked(seq: Iterable, size: int) -> Iterator[list]:
    buf: list = []
    for item in seq:
        buf.append(item)
        if len(buf) == size:
            yield buf
            buf = []
    if buf:
        yield buf


def read_taxa(path: str) -> list[int]:
    taxa: list[int] = []
    seen: set[int] = set()
    with open(path) as f:
        for lineno, raw in enumerate(f, 1):
            s = raw.strip()
            if not s or s.startswith("#"):
                continue
            try:
                tid = int(s)
            except ValueError:
                raise SystemExit(f"Line {lineno} in {path}: not an integer: {s!r}")
            if tid not in seen:
                seen.add(tid)
                taxa.append(tid)
    if not taxa:
        raise SystemExit(f"No taxon IDs found in {path}.")
    return taxa


def validate_taxa(
    session: requests.Session,
    unipept_url: str,
    taxa: list[int],
    batch_size: int,
) -> list[int]:
    url = f"{unipept_url}/api/v2/taxonomy.json"
    valid: list[int] = []
    invalid: list[int] = []

    chunks = list(chunked(taxa, batch_size))
    for chunk in progress(chunks, desc="Validating taxon IDs", unit="batch"):
        data = [("input[]", str(t)) for t in chunk]
        resp = session.post(url, data=data, timeout=60)
        resp.raise_for_status()
        returned = {entry["taxon_id"] for entry in resp.json()}
        for tid in chunk:
            if tid in returned:
                valid.append(tid)
            else:
                invalid.append(tid)

    for tid in invalid:
        logger.warning("Unknown taxon ID: %d", tid)
    if not valid:
        raise SystemExit("None of the provided taxon IDs are known to Unipept.")
    return valid


def collect_descendants(
    session: requests.Session,
    unipept_url: str,
    taxa: list[int],
    batch_size: int,
) -> set[int]:
    url = f"{unipept_url}/api/v2/taxonomy.json"
    descendants: set[int] = set()

    chunks = list(chunked(taxa, batch_size))
    for chunk in progress(chunks, desc="Fetching species descendants", unit="batch"):
        data: list[tuple[str, str]] = [("input[]", str(t)) for t in chunk]
        data.append(("descendants", "true"))
        data.append(("descendants_ranks[]", "species"))

        resp = session.post(url, data=data, timeout=120)
        resp.raise_for_status()
        for entry in resp.json():
            entry_descendants = entry.get("descendants") or []
            if not entry_descendants:
                logger.warning(
                    "Taxon %d (%s, %s) has no species-level descendants.",
                    entry["taxon_id"],
                    entry.get("taxon_name", "?"),
                    entry.get("taxon_rank", "?"),
                )
            descendants.update(entry_descendants)

    if not descendants:
        raise SystemExit("No species-level descendants found for any input taxon.")
    return descendants


def count_proteins_by_taxon(
    client: OpenSearch,
    index: str,
    taxon_ids: set[int],
    chunk_size: int = 1024,
) -> dict[int, int]:
    """Return ``{taxon_id: doc_count}`` for every taxon with at least one document.

    Uses one ``_search?size=0`` per chunk with a ``terms`` aggregation, which is
    far cheaper than scanning the documents themselves.
    """
    counts: dict[int, int] = {}
    for chunk in chunked(sorted(taxon_ids), chunk_size):
        body = {
            "size": 0,
            "query": {"terms": {"taxon_id": chunk}},
            "aggs": {
                "by_taxon": {"terms": {"field": "taxon_id", "size": len(chunk)}}
            },
        }
        resp = client.search(index=index, body=body)
        for bucket in resp["aggregations"]["by_taxon"]["buckets"]:
            counts[int(bucket["key"])] = int(bucket["doc_count"])
    return counts


def streaming_intersect_peptides(
    client: OpenSearch,
    index: str,
    taxon_ids: set[int],
    min_length: int,
    equate_il: bool,
    page_size: int = 2000,
) -> set[str]:
    """Stream proteins per taxon, digest on the fly, fold into a running intersection.

    When ``equate_il`` is true, every sequence is folded to a canonical form
    (``I`` -> ``L``) before digestion so that the intersection treats I and L
    as identical, matching Unipept's ``equate_il=true`` LCA semantics.

    Memory is bounded by ~2 peptide sets at any time (the current taxon's plus
    the running candidate). Taxa are processed smallest-first so the candidate
    set never exceeds the smallest descendant's peptide count.
    """
    counts = count_proteins_by_taxon(client, index, taxon_ids)

    empty_taxa = sorted(tid for tid in taxon_ids if counts.get(tid, 0) == 0)
    for tid in empty_taxa:
        logger.warning("Excluded from intersection (no proteins in OpenSearch): %d", tid)
    if empty_taxa:
        logger.warning(
            "%d of %d descendant taxa excluded from intersection due to missing proteins.",
            len(empty_taxa),
            len(taxon_ids),
        )

    populated = sorted(
        (tid for tid in taxon_ids if counts.get(tid, 0) > 0),
        key=lambda t: counts[t],
    )
    if not populated:
        logger.error("No descendant taxa had proteins; cannot compute intersection.")
        return set()

    total_proteins = sum(counts[t] for t in populated)
    candidate: set[str] | None = None
    bar = progress(
        desc="Streaming digest + intersection",
        unit="prot",
        total=total_proteins,
    )
    try:
        for tid in populated:
            peptides: set[str] = set()
            gen = scan(
                client,
                index=index,
                query={"query": {"term": {"taxon_id": tid}}},
                _source=["sequence"],
                size=page_size,
                preserve_order=False,
                scroll="5m",
            )
            try:
                for hit in gen:
                    seq = hit["_source"].get("sequence")
                    if seq:
                        if equate_il:
                            seq = seq.replace("I", "L")
                        for pep in TRYPSIN_RE.split(seq):
                            if len(pep) >= min_length:
                                peptides.add(pep)
                    bar.update(1)
            finally:
                gen.close()

            if candidate is None:
                candidate = peptides
            else:
                candidate &= peptides

            if not candidate:
                logger.warning(
                    "Running intersection became empty after taxon %d; stopping early.",
                    tid,
                )
                break
    finally:
        bar.close()

    return candidate or set()


def lookup_lcas(
    session: requests.Session,
    unipept_url: str,
    peptides: list[str],
    equate_il: bool,
    batch_size: int,
) -> dict[str, set[int]]:
    url = f"{unipept_url}/api/v2/pept2lca.json"
    lineage_by_peptide: dict[str, set[int]] = {}

    chunks = list(chunked(peptides, batch_size))
    for chunk in progress(chunks, desc="Computing LCAs", unit="batch"):
        data: list[tuple[str, str]] = [("input[]", p) for p in chunk]
        data.append(("equate_il", "true" if equate_il else "false"))
        data.append(("extra", "true"))
        data.append(("names", "false"))

        resp = session.post(url, data=data, timeout=180)
        resp.raise_for_status()
        for entry in resp.json():
            ids: set[int] = {int(entry["taxon_id"])}
            for field in LINEAGE_ID_FIELDS:
                v = entry.get(field)
                if v:
                    ids.add(int(v))
            lineage_by_peptide[entry["peptide"]] = ids

    missing = [p for p in peptides if p not in lineage_by_peptide]
    for p in missing:
        logger.warning("No LCA returned for peptide: %s", p)
    return lineage_by_peptide


def filter_unique(
    peptides: Iterable[str],
    lineage_by_peptide: dict[str, set[int]],
    user_input_set: set[int],
) -> list[str]:
    kept: list[str] = []
    for pep in peptides:
        ids = lineage_by_peptide.get(pep)
        if ids and ids & user_input_set:
            kept.append(pep)
    return sorted(kept)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Find tryptic peptides shared by every species/strain descendant "
            "of the provided NCBI taxa and unique to that set per the Unipept LCA."
        )
    )
    parser.add_argument(
        "taxa_file",
        help="Path to a text file with one NCBI taxon ID per line.",
    )
    parser.add_argument(
        "--no-equate-il",
        action="store_true",
        help="Treat I and L as distinct when computing LCAs (default: equated).",
    )
    parser.add_argument(
        "--min-length",
        type=int,
        default=6,
        help="Keep peptides with length >= this value (default: 6, i.e. longer than 5).",
    )
    parser.add_argument(
        "--opensearch-url",
        default="http://localhost:9200",
        help="OpenSearch base URL (default: http://localhost:9200).",
    )
    parser.add_argument(
        "--opensearch-index",
        default="uniprot_entries",
        help="OpenSearch index name (default: uniprot_entries).",
    )
    parser.add_argument(
        "--unipept-url",
        default="https://api.unipept.ugent.be",
        help="Unipept API base URL (default: https://api.unipept.ugent.be).",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=100,
        help="Batch size for Unipept POST requests (default: 100).",
    )
    parser.add_argument(
        "--log-file",
        default=None,
        help="Optional file path to which warnings/errors are also written.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    configure_logging(args.log_file)
    session = build_session()

    user_taxa = read_taxa(args.taxa_file)
    logger.info("Read %d unique taxon IDs from %s.", len(user_taxa), args.taxa_file)

    valid_taxa = validate_taxa(session, args.unipept_url, user_taxa, args.batch_size)
    logger.info("%d/%d input taxon IDs are known to Unipept.", len(valid_taxa), len(user_taxa))

    descendants = collect_descendants(session, args.unipept_url, valid_taxa, args.batch_size)
    logger.info("Collected %d unique species-level descendants.", len(descendants))

    client = OpenSearch(
        hosts=[args.opensearch_url],
        timeout=120,
        max_retries=3,
        retry_on_timeout=True,
    )
    equate_il = not args.no_equate_il
    try:
        core = streaming_intersect_peptides(
            client,
            args.opensearch_index,
            descendants,
            args.min_length,
            equate_il=equate_il,
        )
    except OSConnectionError as exc:
        logger.error(
            "Could not connect to OpenSearch at %s (%s). "
            "Is the instance running and reachable?",
            args.opensearch_url,
            exc.error if hasattr(exc, "error") else exc,
        )
        return 1
    except OpenSearchException as exc:
        logger.error("OpenSearch query failed: %s", exc)
        return 1

    logger.info("Core peptidome size (intersection across organisms): %d", len(core))
    if not core:
        logger.warning("No peptides shared across all organisms — nothing to report.")
        return 0

    lineage_by_peptide = lookup_lcas(
        session,
        args.unipept_url,
        sorted(core),
        equate_il=equate_il,
        batch_size=args.batch_size,
    )

    unique = filter_unique(core, lineage_by_peptide, set(valid_taxa))
    logger.info("%d peptides remain after uniqueness filter.", len(unique))

    for pep in unique:
        sys.stdout.write(pep + "\n")
    sys.stdout.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
