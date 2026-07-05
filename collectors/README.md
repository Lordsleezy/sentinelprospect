# Sentinel Projects Collector Framework

Collectors transform public construction source records into the intelligence schema used by the application.

This v0.2 framework intentionally separates raw records, signals, evidence, projects, and generated opportunities. Future collectors should extend `BaseCollector`, return raw source records, then normalize each record into projects, permits, companies, documents, signals, and evidence records. Opportunities are generated later by the scoring engine from evidence; collectors should not manufacture recommendations directly.

Configured source targets live in `collectors/sources.ts`:

- Sacramento County Public Records
- Placer County Public Records
- Roseville Development Services
- Rocklin Community Development
- Folsom Community Development
- Elk Grove Development Services
- SAM.gov Contract Opportunities

Each configured collector is disabled for live scraping until a source-specific adapter is implemented and tested against the actual portal, API, agenda feed, or document source.

Planned collector families:

- Accela permit portals
- Tyler Technologies permit portals
- OpenGov datasets
- Planning commission agendas
- PDF packets and staff reports
- SAM.gov opportunity API
