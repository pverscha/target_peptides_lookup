# Target Peptides Identifier — UI

A browser-based tool for identifying diagnostic peptides for user-defined groups of taxa. Given one or more NCBI taxon IDs, the pipeline computes three distinct sets of peptides and explains what each set means from a biological perspective.

---

## Table of contents

1. [Overview](#overview)
2. [Pipeline steps](#pipeline-steps)
3. [Peptide computations](#peptide-computations)
   - [Per-taxon core peptidome](#per-taxon-core-peptidome)
   - [Shared peptides across all taxa](#shared-peptides-across-all-taxa)
   - [Shared unique peptides](#shared-unique-peptides)
4. [Configuration parameters](#configuration-parameters)

---

## Overview

The tool takes a list of NCBI taxon IDs as input. Each ID may represent a taxon at any rank — a species, genus, family, order, or higher clade. The pipeline then:

1. Resolves each taxon to its species-level descendants using the Unipept taxonomy.
2. Retrieves all protein sequences for those species from an OpenSearch index that mirrors the UniProt database.
3. Digests the protein sequences in silico and computes the requested peptide sets.
4. Annotates each peptide with its lowest common ancestor (LCA) using Unipept's `pept2lca` endpoint.
5. Filters peptides for uniqueness using Unipept's `pept2taxa` endpoint.

---

## Pipeline steps

### Step 1 — Validate taxon IDs

Each input taxon ID is validated against the Unipept taxonomy database using the `/api/v2/taxonomy.json` endpoint. IDs that are absent from Unipept (and therefore not linked to any protein data) are reported as invalid and excluded from the rest of the pipeline. Valid IDs are resolved to their scientific names at this stage.

### Step 2 — Collect species-level descendants

For each valid input taxon, Unipept's taxonomy endpoint is called again with `descendants=true` and `descendants_ranks[]=species`. This returns the NCBI taxon IDs of all species that fall under the input taxon in the NCBI taxonomy tree.

The pipeline operates at the species level because protein data in the OpenSearch index is indexed per species. If an input taxon is already a species, it yields itself as its only descendant. If an input taxon is a genus, family, or higher-rank clade, all species within that clade are collected. Descendants are deduplicated across input taxa: if two input taxa share a descendant species, it is only processed once.

This expansion step is critical: it ensures that the downstream analysis reflects the full biological breadth of the selected taxa rather than only what is directly annotated to the input node in the database.

### Step 3 — Count proteins per species

For each species-level descendant, the pipeline queries the OpenSearch index to count the number of protein sequences annotated to that species. Species below the configurable `minProteins` threshold are excluded. This removes taxa with too little data to contribute meaningfully to the intersection and avoids false negatives caused by incomplete proteome coverage.

### Step 4 — Digest and intersect peptides

This is the main computational step. For each input taxon, the pipeline:

1. Iterates over all species-level descendants of that taxon (in ascending order of protein count, to fail fast when the intersection becomes empty early).
2. For each species, streams all protein sequences from the OpenSearch index and digests them in silico using trypsin (cleavage after K or R, not before P) or a user-specified custom cleavage regex. Peptides shorter than the configured minimum length are discarded.
3. Computes the **per-taxon core**: the set intersection of peptide sets across all species under the input taxon. A peptide is in the per-taxon core if and only if it is produced by at least one protein in every species under that taxon.
4. Across all input taxa, computes the **global core**: the intersection of the per-taxon unions. A peptide enters the global core if, for every input taxon, at least one species under that taxon produces it.

The I/L equivalence option (`equateIL`) controls whether isoleucine (I) and leucine (L) are treated as identical during digestion. In mass spectrometry, I and L are isobaric and cannot be distinguished by standard tandem MS; enabling this option reflects that constraint.

### Step 5 — Look up LCAs

For each peptide in the global core (and optionally the per-taxon cores), Unipept's `pept2lca` endpoint is queried. This endpoint searches all UniProt protein sequences for the given peptide and computes the **lowest common ancestor (LCA)** of all organisms whose proteins contain that peptide.

The LCA is the most specific node in the NCBI taxonomy tree that is an ancestor of every organism carrying the peptide. If a peptide occurs in proteins from three different species within the same genus, its LCA is that genus. If it occurs in proteins spread across two different phyla, its LCA is their common ancestor higher up the tree.

The endpoint returns not only the LCA taxon (ID, name, rank) but also its full NCBI lineage — the chain of ancestor nodes from domain down to forma. The pipeline stores, for each peptide, the complete set of taxon IDs in this lineage. This lineage set is used in the next step to determine per-taxon uniqueness.

### Step 6 — Apply uniqueness filter

Depending on which computations are enabled, this step applies two distinct uniqueness filters.

**Per-taxon unique peptides** are filtered using the LCA lineage data from step 5. For each input taxon, its per-taxon core peptides are tested: a peptide is retained if the input taxon's NCBI ID appears anywhere in the peptide's LCA lineage. If the input taxon is in the LCA lineage, then the LCA is either that taxon itself or one of its ancestors — meaning all organisms that carry the peptide are descendants of the input taxon. No organism outside the input taxon's clade is known to carry that peptide. This filter is efficient because it only requires the lineage data already retrieved in step 5.

**Shared unique peptides** are filtered using Unipept's `pept2taxa` endpoint. This endpoint returns the full list of UniProt organisms (species-level) that contain each peptide sequence. For each peptide in the global core, the pipeline checks every organism in the `pept2taxa` response: if any organism is not a descendant of at least one input taxon, the peptide is excluded. A peptide passes the filter only if every known occurrence in UniProt falls within the input group. This check is more conservative than the LCA-based approach because it inspects each organism individually rather than relying on the aggregated LCA.

---

## Peptide computations

### Per-taxon core peptidome

**What is computed:** For each input taxon individually, the set of peptides that result from an in silico digest of every species-level descendant and that appear in all such species. This is the intersection of species-level peptide sets within a single input taxon.

**Biological meaning:** These peptides arise from proteins that are conserved across every species in the clade. A peptide in the per-taxon core cannot be lost from any member species without being removed from the set. Such conservation is characteristic of proteins under strong purifying selection — for example, core metabolic enzymes, ribosomal proteins, chaperones, or other essential cellular machinery. The per-taxon core peptidome is therefore a proxy for the shared functional backbone of that clade's proteome at the peptide-observable level.

The per-taxon core is also the starting point for the per-taxon unique peptides computation. Core peptides that pass the uniqueness filter (see above) are diagnostic for that clade and not confounded by other organisms in the database.

**Use case in proteomics:** The per-taxon core is useful when designing targeted assays for a clade. If a peptide is present in every species of interest, a single assay can confirm the presence of the entire group. Combined with uniqueness filtering, these peptides become the strongest candidates for taxon-specific biomarkers in metaproteomics experiments.

---

### Shared peptides across all taxa

**What is computed:** The intersection of all per-taxon unions. A peptide is in this set if, for every input taxon, at least one species under that taxon produces the peptide during in silico digestion.

Concretely, this is the set of peptides that the input taxa have "in common" at the peptide level, regardless of whether every individual species under each taxon produces it.

**Biological meaning:** These peptides correspond to proteins (or protein regions) that are functionally present across all of the selected clades. Because the union is taken within each input taxon before the global intersection is computed, a peptide can qualify even if it is absent from some species within one clade, as long as it appears somewhere within that clade. The shared peptide set is therefore more permissive than requiring the peptide to be in every single descendant species.

From a biological standpoint, shared peptides represent molecular features that connect the selected groups. They may reflect ancient conserved functions, horizontal gene transfer events, or convergent evolution. They do not, by themselves, imply that the peptides are exclusive to the input group.

**Use case in proteomics:** The shared peptide set is relevant when studying proteins that are common to a defined group of organisms. In comparative proteomics, shared peptides can serve as reference points for quantitative comparisons across clades. They are also the input to the shared unique peptide computation.

---

### Shared unique peptides

**What is computed:** The subset of shared peptides (above) for which every known occurrence in the UniProt database falls within the input group. Specifically, for each peptide in the global core, Unipept's `pept2taxa` endpoint returns all UniProt species that contain that peptide. A peptide is retained only if none of those species falls outside the set of organisms covered by the input taxa.

**Biological meaning:** These peptides are both conserved across the entire input group and absent from all organisms outside the group, according to current UniProt annotations. A peptide with this property can be used to confirm the presence of the group — or any member of it — in a complex sample, while excluding any signal from unrelated organisms.

The exclusivity guarantee is derived from the content of UniProt at the time of analysis. It is a database-dependent property: if a closely related organism outside the input group is added to UniProt in the future, some peptides may lose their unique status. The guarantee also depends on the completeness of the proteomes in the database. For organisms with partial or no proteome coverage, the absence of a peptide from those organisms' records cannot be confirmed empirically.

From a structural biology perspective, shared unique peptides typically reside in protein domains that are both conserved within the group (explaining their presence in every member) and diverged enough from homologs outside the group that the specific peptide sequence is not shared. This combination of within-group conservation and between-group divergence is what makes them valuable as group-specific biomarkers.

**Use case in proteomics:** Shared unique peptides are the primary output of the tool when the goal is to detect an entire clade in a metaproteomics experiment. Because they are present in every organism of the group and absent from all others, a single detection event provides unambiguous evidence for the presence of the group. This is directly applicable to clinical diagnostics, environmental monitoring, and food safety applications where a defined group of microorganisms must be detected or excluded.

---

## Configuration parameters

| Parameter | Description |
|-----------|-------------|
| `minLength` | Minimum peptide length (in amino acids) after cleavage. Shorter fragments are discarded. |
| `equateIL` | Treat isoleucine (I) and leucine (L) as identical. Recommended for standard MS/MS data where these residues are isobaric. |
| `cleavageMethod` | `tryptic` uses trypsin cleavage rules (after K or R, not before P). `custom` accepts a user-defined regular expression. |
| `cleavageRegex` | The regular expression used when `cleavageMethod` is `custom`. |
| `minProteins` | Minimum number of proteins a species must have in the database to be included in the intersection. |
| `computePerTaxonUnique` | Whether to compute per-taxon unique peptides (requires LCA lookup). |
| `computeUniqueSharedPeptides` | Whether to compute shared unique peptides (requires `pept2taxa` lookup for the global core). |
| `batchSize` | Number of taxon IDs per request to the Unipept taxonomy endpoint. |
| `lcaBatchSize` | Number of peptides per request to the Unipept `pept2lca` endpoint. |
| `taxaBatchSize` | Number of peptides per request to the Unipept `pept2taxa` endpoint. |
| `parallelRequests` | Number of concurrent HTTP requests to Unipept for LCA and taxa lookups. |