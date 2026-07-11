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
- Add city portal adapters (Roseville / Rocklin / Folsom / Elk Grove)
- Persist hypotheses into Neo4j using `Signal` / `Breadcrumb` / `Hypothesis` node types

## Planning stage discovery

```bash
npm run collect:planning
```

Pulls live Sacramento County PLANNING_PROJECTS MapServer + Placer All_Active_Planning_Projects / Major Pre-Development layers into `data/planning_signals.json`. Those signals feed search (“Early-stage planning leads”) and research atoms via `npm run intelligence:research`.
