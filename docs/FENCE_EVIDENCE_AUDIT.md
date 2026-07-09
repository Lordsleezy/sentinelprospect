# Fence Evidence Audit

## Verdict

**B) The terms exist in source documents, but extraction was failing.**

They were not missing from the underlying permit corpus. They were missing from the evidence-search corpus.

## Term counts

Counts below are from source-backed text fields (project name/description/work description), not generated intelligence labels.

### Curated evidence documents (`data/evidence_documents.json`)

| Term | Count | Notes |
| --- | --- | --- |
| fence | 0 | None |
| fencing | 0 | None |
| gate | 1 | False positive: **Southgate** Recreation |
| gates | 0 | None |
| perimeter | 0 | None |
| security | 0 | None |
| access control | 0 | None |
| enclosure | 0 | None |
| screen wall | 0 | None |
| chain link | 0 | None |
| ornamental iron | 0 | None |
| wrought iron | 0 | None |
| detention basin | 0 | None |
| park fencing | 0 | None |
| trail fencing | 0 | None |
| school fencing | 0 | None |
| sports field fencing | 0 | None |

### Sacramento County permits (before fence-keyword expansion)

| Term | Source-text hits | Notes |
| --- | --- | --- |
| fence / fencing | present in work descriptions after keyword collection | Example: `raise fence height`, `pool safety fencing`, `NEW FENCE` |
| gate / gates | present | Example: `NEW (GATES) - 7575 POWER INN RD` |
| perimeter | mostly incidental | Example: `perimeter footings` (not fencing) |
| security | present with gate/fence | Example: `security fence`, `security gate` |
| access control | 0 in current sample | None found |
| enclosure | rare / incidental | Not treated as strong fence evidence alone |
| screen wall | 0 | None |
| chain link | 0 in current sample | None |
| ornamental iron | 0 | None |
| wrought iron | 0 | None |
| detention basin | 0 in current sample | None |
| park/trail/school/sports field fencing | 0 | None |

### After collector expansion

Sacramento collector now merges:

1. valuation-matched permits
2. fence/gate keyword permits

Result from latest collection:

- 75 valuation-matched
- 50 fence-keyword
- **123 unique Sacramento permits**
- **38** records with intentional fence/gate source language

### Placer County records

| Term | Source-text hits | Notes |
| --- | --- | --- |
| fence | present | Mostly setback language (`for fence or structure`) — incidental |
| gates | present | Example: `COMMUNITY ENTRY GATES` |
| other specialty terms | 0 / rare | Limited in current active-permit sample |

## Extraction failure mode

Example that existed before the fix:

```text
Project: NEW (GATES) - 7575 POWER INN RD
WorkDescription: Supply and install automated slide gates, ADA ped gate and fencing with gate operators and necessary equipment.
```

Observed pipeline behavior:

| Stage | Result |
| --- | --- |
| Permit cache | Contained the description |
| Opportunity record | Kept project name, dropped description |
| Scope intelligence | `fence_evidence: []`, `No Evidence` |
| Evidence expansion | `related_evidence_count: 0`, `evidence_snippets: []` |
| Search | Suppressed (correct under strict rules, but evidence was invisible) |

## Post-fix status

Evidence expansion now reports source-backed snippets when intentional fence/gate language exists.

Example:

```json
{
  "opportunity_id": "sac-cbnc2026-00207",
  "fence_scope_confidence": "Secondary Opportunity",
  "project_summary": "NEW (GATES) - 7575 POWER INN RD - Supply and install automated slide gates, ADA ped gate and fencing with gate operators and necessary equipment.",
  "why_fencing_matters": "Source document specifies gate and fencing installation: \"...\"",
  "evidence_snippets": [
    {
      "text": "NEW (GATES) - 7575 POWER INN RD - Supply and install automated slide gates, ADA ped gate and fencing with gate operators and necessary equipment.",
      "source": "CBNC2026-00207 Commercial",
      "source_url": "https://data.saccounty.gov/datasets/sacramentocounty::permits/explore?filters=Application%3ACBNC2026-00207",
      "confidence": "direct"
    }
  ]
}
```

## Important trust note

Raw string counts in generated files like `scope_intelligence.json` / `evidence_expansion.json` are inflated by labels such as `fence_scope_confidence` and `why_fencing_matters`.

Audit decisions must use **source fields**, not generated intelligence labels.

## Audit helper

```bash
node scripts/audit-fence-evidence.mjs
```
