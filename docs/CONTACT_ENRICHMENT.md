# Contact Enrichment Pipeline

Sentinel Prospects resolves contractor phones from **public CSLB License Master records** (`BusinessPhone`), not keyword guessing.

## Why contacts were empty

1. County permit ArcGIS layers include contractor **names** but almost never phones/emails.
2. Enrichment was manual (`company_web_sources.json` had ~7 companies).
3. `intelligence:rebuild` previously skipped contact harvest / human-contact rebuild.

## What works now

```
enrich:contacts
  → downloads/matches CSLB License Master BusinessPhone
  → optional website scrape for emails
  → writes data/company_web_sources.json + data/company_contact_enrichment.json

harvest:contacts
intelligence:companies
intelligence:qualify
intelligence:access
intelligence:human-contacts
intelligence:contractor-actions
```

Or one command:

```bash
npm run intelligence:contacts
```

Refresh CSLB master (large public CSV):

```bash
npm run enrich:contacts:download
```

## Coverage expectations

| Situation | Result |
| --- | --- |
| Permit lists a licensed CA contractor | CSLB phone attached with license evidence URL |
| Company website has mailto/tel | Email/phone scraped with source URL |
| Work description names a business (e.g. childcare) | Named company lead attached; phone if CSLB/web finds one |
| Contractor is `TO BE DETERMINED` / blank and no named business | No fake contact; Accela login or assessor lookup required |
| Sacramento parcel owner | Not published online by County |

## Current measured coverage

After `npm run intelligence:contacts`:

- ~73 / 205 opportunities with phone
- ~8 with email
- Named description leads attached when present
- Bidable fencing jobs with named GCs now show phones (Alltech, A1 Electrical, ARCO/Murray, Bruce Construction)

## Evidence rules

- Phones must come from CSLB public records or source-backed websites.
- Placeholder emails (`user@domain.com`, directory membership inboxes) are rejected.
- UI shows Best Contact, Phone, and Email only when real values exist.
