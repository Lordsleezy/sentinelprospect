# Evidence Pipeline Analysis

Generated for Sentinel Prospects evidence extraction & scope intelligence work.

## Verdict

Zero snippets were **not** caused by ranking or fencing probability logic.

Root cause:

1. Evidence expansion only searched curated `data/evidence_documents.json` (7 relationship/news docs).
2. Those curated docs contain almost no fence/gate language.
3. Real fence/gate language already existed in Sacramento/Placer permit descriptions, but that source text never entered the evidence search corpus.
4. Scope intelligence also ignored `project_description`, so even `"NEW (GATES) ... fencing"` stayed `No Evidence`.

## Pipeline

```text
Source File
↓
Extractor / Collector
↓
Opportunity Qualification
↓
Access + Contractor Opportunity
↓
Scope Intelligence
↓
Evidence Expansion
↓
Search UI
```

### 1. Source File

| Source | Path | What it contains |
| --- | --- | --- |
| Sacramento County permits | `data/sacramento-county-permits.json` | ArcGIS permit records with `normalized.project.description` and raw `payload.WorkDescription` |
| Placer County permits | `data/placer-county-records.json` | Active building permits with project descriptions |
| SAM.gov | `data/samgov-opportunities.json` | Federal opportunities (sparse locally) |
| Curated evidence docs | `data/evidence_documents.json` | Hand-curated public docs (news, agendas, portfolio pages) |

Collectors:

- `scripts/run-sacramento-county-collector.mjs`
- `scripts/run-placer-county-collector.mjs`
- `scripts/run-samgov-collector.mjs`

### 2. Extractor

| Script | Input | Output |
| --- | --- | --- |
| `build-opportunity-qualification.mjs` | permit caches + curated document extractions | `data/opportunity_qualification_results.json` |
| `build-access-intelligence.mjs` | qualification results | `data/access_opportunity_results.json` |
| `build-contractor-opportunity.mjs` | access results | `data/contractor_opportunities.json` |
| `build-scope-intelligence.mjs` | contractor opportunities + curated docs | `data/scope_intelligence.json` |
| `build-evidence-expansion.mjs` | opportunities + curated docs + permit/opportunity source text | `data/evidence_expansion.json` |

### 3. Evidence Expansion

`scripts/build-evidence-expansion.mjs` now builds searchable source documents from:

1. Curated `evidence_documents.json`
2. Permit records (`permit_record`)
3. Opportunity source records (`opportunity_record`) using `project_name` + `project_description`

It extracts:

- matching sentence / surrounding context
- source document title
- source URL
- confidence (`direct`)

Stored in:

- `evidence_snippets`
- `evidence_fence_signals`
- `evidence_sources`
- `project_summary`
- `why_fencing_matters`

### 4. Scope Intelligence

`scripts/build-scope-intelligence.mjs` now reads:

- `opportunity.project_name`
- `opportunity.project_description`
- curated document summary when available

Fence detection uses source text only (not inferred trade labels like `"Fencing"`).

### 5. Search UI

`src/lib/contractor-opportunity-engine.ts` merges:

- contractor opportunity
- scope intelligence
- evidence expansion

Suppression remains strict:

```text
positiveFenceEvidence.length === 0
AND
fence_scope_confidence === "No Evidence"
→ suppress fencing search result
```

`src/app/search/page.tsx` displays:

- Project Summary
- Why Fencing Matters (evidence-backed)
- Evidence snippets with source document + URL + confidence

## Why snippets were empty before

| Layer | Status before fix |
| --- | --- |
| Permit source text | Present in collector JSON |
| Opportunity records | Dropped `project_description` |
| Scope intelligence | Did not read permit description |
| Evidence expansion | Only searched 7 curated docs |
| Gate regex in scope | Required phrases like `access gate`, missed standalone `GATES` |
| Result | `with_snippets: 0` |

## What changed

1. Propagate `project_description` through qualification → access → opportunity.
2. Scope detection uses permit/opportunity source text.
3. Evidence expansion indexes permit + opportunity source text.
4. Sacramento collector also queries fence/gate keyword permits.
5. Snippet validators reject incidental mentions (`Golden Gate Ave`, `behind fence`, inferred `"Fencing score"` text).
6. Suppression rules were **not** loosened.

## Rebuild commands

Run from repository root:

```bash
cd C:\Users\pgg12\CascadeProjects\sentinelprospect
npm run collect:sacramento -- --limit=75 --min-valuation=50000 --fence-limit=50
npm run intelligence:rebuild
npm run validate
```
