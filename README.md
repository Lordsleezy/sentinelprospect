# Sentinel Prospects v0.1

Construction intelligence search for public project opportunities.

## Stack

- Next.js App Router, TypeScript, TailwindCSS
- shadcn/ui-style local primitives in `src/components/ui`
- Supabase schema in `supabase/`
- PostgreSQL full-text search on `projects.search_vector`
- MapLibre + OpenStreetMap-compatible demo tiles

## Run locally

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:3000`.

The app runs with source-backed collector caches when Supabase env vars are not present. To use Supabase, copy `.env.local.example` to `.env.local`, fill in your local Supabase URL and anon key, then apply:

```bash
supabase db reset
```

## Routes

- `/` dashboard metrics, recent projects, recent permits, source health
- `/projects` searchable and filterable project table
- `/projects/[id]` project detail with permits, companies, documents, source links, and map
- `/permits` searchable and filterable permits
- `/companies` searchable companies
- `/map` MapLibre project pins
- `/sources` source registry
- `/search` grouped global search across projects, companies, and permits

## Collector Framework

`collectors/` contains the v0.1 ingestion framework only. Future source integrations should extend `BaseCollector`, collect raw records, then normalize into the project-first schema through the normalization pipeline.
