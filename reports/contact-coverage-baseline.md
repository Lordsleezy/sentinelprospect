# Contact Coverage Baseline

Generated: 2026-07-09T07:05:03.062Z

**Baseline label:** 2026-07-09 contact enrichment baseline (CSLB BusinessPhone)

Use this report to measure future contact enrichment improvements.

## Overall opportunity coverage

| Metric | Count | % |
| --- | ---: | ---: |
| Opportunities total | 205 | 100 |
| With best contact | 74 | 36.1 |
| With phone | 73 | 35.6 |
| With email | 8 | 3.9 |
| Known human contact | 16 | 7.8 |
| Company office contact | 57 | 27.8 |
| Named company lead only | 1 | 0.5 |
| Access route only | 0 | 0 |
| Unknown | 131 | 63.9 |

## Bidable fencing opportunities

| Metric | Count | % |
| --- | ---: | ---: |
| Bidable fencing total | 12 | 100 |
| With phone | 5 | 41.7 |
| With email | 2 | 16.7 |
| Named lead, no phone | 1 | 8.3 |
| No contact | 6 | 50 |

## Company enrichment layer

| Metric | Count |
| --- | ---: |
| Company profiles | 44 |
| Profiles with phone | 36 |
| Enrichment rows | 41 |
| Enrichment with phone | 41 |
| Enrichment with email | 5 |
| Human contact profiles with best contact | 36 / 44 |

## Action layer

| Metric | Count |
| --- | ---: |
| Action opportunities | 205 |
| Phone-backed | 73 |
| Email-backed | 8 |

## Bidable fencing detail

| Project | Coverage | Company | Phone | Email |
| --- | --- | --- | --- | --- |
| 259,635 tenant improvement for Cardinal Health | Company Office Contact | ARCO / MURRAY NATIONAL NORCAL LLC | (650) 288-1305 | - |
| AREA: R03:  Swimming Pool Remodel | Unknown | - | - | - |
| AREA: R06:  raise fence height to 7 ft max | Unknown | - | - | - |
| AREA: R08:  Pouring Driveway over culvert with an automatic  | Company Office Contact | BRUCE CONSTRUCTION GROUP LLC | (707) 688-5345 | - |
| Building a 9 foot steel gate | Unknown | - | - | - |
| Building Compliance: TI (INTERIOR REMODEL&NEW FENCE) - 6201  | Unknown | - | - | - |
| CELL TOWER MOD - 6851 WATT AVE | Unknown | - | - | - |
| Installation of electric sliding gate | Unknown | - | - | - |
| NEW (GATES) - 3401 BALMORAL DR | Company Office Contact | ALLTECH GATES AND ENTRY CONTROLS INC | (916) 599-6629 | alltechgates@gmail.com |
| NEW (GATES) - 5800 FAIR OAKS BLVD | Company Office Contact | A 1 ELECTRICAL | (916) 482-3400 | - |
| NEW (GATES) - 7575 POWER INN RD | Company Office Contact | ALLTECH GATES AND ENTRY CONTROLS INC | (916) 599-6629 | alltechgates@gmail.com |
| NEW (GATES/FENCE & TI INT OFFICE-CLASS ROOM) 5033 WHITNEY AV | Named Company Lead | Golden Memories Childcare | - | - |

## How to refresh

```bash
npm run intelligence:contacts
node scripts/report-contact-coverage.mjs
```

Compare new `data/contact_coverage_baseline.json` / `reports/contact-coverage-baseline.md` against this commit.
