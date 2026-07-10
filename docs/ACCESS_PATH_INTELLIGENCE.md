# Access Path Intelligence

Sentinel Prospects now answers:

> Who should Twin Rivers call tomorrow morning?

Not just which company exists on a permit.

## Decision order

1. Classify **access path type**
   - Owner-driven
   - GC-driven
   - Developer-driven
   - Municipality-driven
2. Classify **procurement stage**
3. Estimate **subcontractor award probability**
4. Choose **decision maker** (prefer Project Manager when available)
5. Choose **second contact**
6. Build **escalation path**
7. Emit **recommended first call**

## Fields

| Field | Meaning |
| --- | --- |
| `decision_maker` | Who to call first |
| `decision_maker_role` | PM / GC office / Owner / Estimator |
| `decision_maker_phone` | Direct phone when known |
| `decision_maker_email` | Direct email when known |
| `access_path_type` | Owner / GC / Developer / Municipality |
| `procurement_stage` | Pre-bid, plan check, permit issued, awarded |
| `subcontractor_award_probability` | Likelihood fence package already placed |
| `recommended_first_call` | Exact tomorrow-morning action |
| `second_contact` | Backup person/company |
| `escalation_path` | Stepwise call ladder |

## Owner / site-business behavior

If a permit description names a business like **Golden Memories Childcare**, that remains a valid first call target for owner-driven jobs.

If a Project Manager contact exists, it ranks above company office phones.

## Commands

```bash
npm run intelligence:access-path
npm run intelligence:contractor-actions
```

Or full chain:

```bash
npm run intelligence:contacts
```

Reports:

- `reports/access-path-intelligence.md`
- `reports/who-to-call-tomorrow.md`
- `data/access_path_intelligence.json`
