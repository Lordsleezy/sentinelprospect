# Research Intelligence

Sentinel’s breadcrumb → hypothesis research layer.

## What it does

1. **Atoms** — every opportunity becomes a sparse public-record crumb with extracted entities (developer, subdivision, address, parcel, trade).
2. **Linkage** — Splink-style probabilistic matching connects crumbs that share package-grade entities (not just city/county).
3. **Hypotheses** — linked crumbs assemble into opportunity packages (“housing development”, commercial packages, etc.).
4. **ConstructIQ search** — hybrid lexical index + metadata filters (`GET /api/research/search?q=...`).

## Commands

```bash
npm run intelligence:research
```

Writes:

- `data/research_intelligence.json`
- `reports/research-intelligence.md`

## API

```
GET /api/research/search?q=concrete+jobs+sacramento&trade=Concrete&has_phone=true
```

## Open-source patterns

| Project | Role |
|---|---|
| ConstructIQ | Semantic permit search + filters |
| Splink | Probabilistic entity resolution |
| sift-kg | Document → entity graph trails |
| LightRAG | Graph + vector dual retrieval |
| ElecBidSpec AI | Pre-RFP pursuit stage model |
| kipi | Typed OSINT entity graphs |

## Next upgrades

- Swap TF-IDF for embeddings (OpenAI / Sentence-BERT) behind the same ConstructIQIndex API
- Turn on live ACT / Accela / city agenda adapters (`npm run collect:planning`)
- Persist hypotheses into Neo4j using `Signal` / `Breadcrumb` / `Hypothesis` node types
- Merge planning signals into breadcrumb assembler as first-class atoms

## Planning stage discovery

```bash
npm run collect:planning
```

Writes `data/planning_signals.json` with seed housing packages + portal adapter stubs.
