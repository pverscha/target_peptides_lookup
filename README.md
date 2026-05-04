# target_peptides_identifier

A Python 3 command-line tool that identifies tryptic peptides which are
(a) shared by every species-level descendant of a given set of NCBI taxa,
and (b) unique to that taxon set according to the Unipept LCA.

The script is intended to run on a host that has access to a local
OpenSearch instance containing UniProt entries indexed by `taxon_id`
(see *Expected OpenSearch index* below).

## Pipeline

1. **Validate input**: read the user-provided taxon IDs from a text file
   and verify them against the Unipept `taxonomy.json` endpoint. Unknown
   IDs are reported and skipped.
2. **Collect descendants**: for each valid input taxon, retrieve all
   species-level descendants via Unipept's `descendants` parameter and
   aggregate them into a deduplicated set.
3. **Retrieve proteins**: query the local OpenSearch index
   (`uniprot_entries` by default) with a `terms` filter on `taxon_id`,
   paginating with the scroll API. Only `taxon_id` and `sequence` are
   fetched.
4. **Tryptic digest per organism**: digest every protein with the standard
   trypsin rule (cleave after K or R unless followed by P). Peptides
   shorter than the configured minimum length are discarded. Descendant
   taxa with no proteins in the index are reported and excluded from the
   subsequent intersection.
5. **Intersection**: compute the set of peptides shared by every
   descendant organism that yielded proteins.
6. **LCA computation**: send the intersection in batches to the Unipept
   `pept2lca.json` endpoint with `extra=true` to obtain the full lineage
   for each LCA.
7. **Uniqueness filter**: keep peptides whose LCA (or any ancestor in its
   lineage) lies at or below at least one of the originally provided
   taxon IDs. Surviving peptides are written to stdout, one per line, in
   sorted order.

## Requirements

- Python 3.9 or newer.
- A reachable Unipept API endpoint (default: `https://api.unipept.ugent.be`).
- A reachable OpenSearch instance (default: `http://localhost:9200`)
  hosting the `uniprot_entries` index.

### Expected OpenSearch index

The script assumes documents matching this schema:

```json
{
  "mappings": {
    "properties": {
      "uniprot_accession_number": { "type": "keyword" },
      "version":                  { "type": "integer" },
      "taxon_id":                 { "type": "integer" },
      "type":                     { "type": "keyword" },
      "name":                     { "type": "text" },
      "sequence":                 { "type": "text", "index": false },
      "fa":                       { "type": "text", "index": false }
    }
  }
}
```

Only the `taxon_id` and `sequence` fields are read, but the index must
allow `terms` queries on `taxon_id` and a stable sort on `_id`.

## Installation

A virtual environment is recommended.

```bash
cd /path/to/target_peptides_identifier

python3 -m venv .venv
source .venv/bin/activate

pip install -r requirements.txt
```

The dependencies are `requests`, `opensearch-py`, and `tqdm`.

## Usage

```bash
python target_peptides_identifier.py TAXA_FILE [OPTIONS]
```

`TAXA_FILE` is a plain text file with one NCBI taxon ID per line. Empty
lines and lines starting with `#` are ignored.

### Example

```bash
echo 216816 > taxa.txt
python target_peptides_identifier.py taxa.txt > unique_peptides.txt
```

`unique_peptides.txt` will contain the unique tryptic peptides, one per
line. Progress bars, informational messages, and warnings are written to
stderr, so stdout remains a clean peptide list that can be piped into
downstream tools.

### Options

| Option                  | Default                          | Description                                                                 |
| ----------------------- | -------------------------------- | --------------------------------------------------------------------------- |
| `--no-equate-il`        | I/L equated                      | Treat isoleucine and leucine as distinct in both the digest and the LCA call. |
| `--min-length N`        | `6`                              | Keep peptides with at least `N` amino acids.                                |
| `--opensearch-url URL`  | `http://localhost:9200`          | Base URL of the OpenSearch instance.                                        |
| `--opensearch-index I`  | `uniprot_entries`                | Index name to query.                                                        |
| `--unipept-url URL`     | `https://api.unipept.ugent.be`   | Base URL of the Unipept API.                                                |
| `--batch-size N`        | `100`                            | Batch size for Unipept POST requests.                                       |
| `--log-file PATH`       | not written                      | Also write all warnings and errors to the given file.                       |
| `-h`, `--help`          |                                  | Show the full help message and exit.                                        |

### Logging

Warnings and errors are routed through `tqdm.write` so they appear above
any active progress bar without clobbering it. When `--log-file` is set,
the same messages are additionally appended to the specified file. The
file is overwritten on each run.

Progress bars are written to stderr only when stderr is a terminal. When
stderr is redirected to a file or pipe (e.g. `2> err.log` or piping the
script's output through another tool that consumes stderr), the bars
are automatically disabled so the redirected stream contains only the
structured log lines. The `--log-file` itself never receives progress
bar output because that file is fed by Python's `logging` module, which
is independent of tqdm.

Categories of messages emitted:

- `Unknown taxon ID: <id>` for input IDs that Unipept does not recognise.
- `Taxon <id> ... has no species/strain descendants.` when an input
  taxon expands to nothing.
- `Excluded from intersection (no proteins in OpenSearch): <id>` for
  descendant taxa with zero documents in the index, followed by a single
  summary line `N of M descendant taxa excluded ...`.
- `No LCA returned for peptide: <seq>` when a peptide is missing from
  the `pept2lca.json` response.
- A clean one-line error when OpenSearch is unreachable.

### Exit codes

- `0`: success, including the case where no peptide survives the
  intersection or the uniqueness filter (an informational message is
  emitted on stderr).
- `1`: unrecoverable error (no valid input IDs, no descendants, no
  proteins for any descendant, OpenSearch unreachable, or other
  OpenSearch failure).
