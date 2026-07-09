# Contractor Bidability Model

Sentinel Prospects now classifies fencing opportunities using contractor bidability, not keyword coincidence.

## Decision order

1. **What is the project primarily?** (`primary_scope`)
2. **Is there strong fencing/gate installation evidence?**
3. **Would a fencing contractor reasonably bid this?** (`fencing_bidable`)
4. Only then assign fence confidence and search visibility.

## Evidence tiers

| Tier | Examples | Max classification |
| --- | --- | --- |
| Strong | new fence, raise fence, pool safety fencing, install sliding gate, NEW (GATES), gates/fence | Primary / Secondary / Possible |
| Weak | bare "entry gates", incidental "fence" in setbacks | Weak Opportunity (hidden from fencing search) |
| None | no fence/gate install language | No Evidence |

## Primary-scope veto

If primary scope is clearly another trade (electrical/landscape lighting, solar, HVAC, roofing, drainage, interior TI) and fencing evidence is not strong, the opportunity is **No Evidence** for fencing.

Example blocked:

`PLACER VINEYARDS ... Electrical for Landscaping` mentioning `COMMUNITY ENTRY GATES`

## Search rule

Fencing search only returns opportunities where:

- `fencing_bidable === true`
- strong positive fence evidence exists
- confidence is not No Evidence / Weak Opportunity

## UI

- Shows **Primary scope**
- Renames section to **Why a Fencing Contractor Should Care**
- Probability requires bid-able strong evidence

## Strong evidence patterns (non-exhaustive)

Must indicate install intent, not incidental mention:

- `NEW (GATES)`, `gates/fence`, raise/new fence, pool safety fencing
- `sliding` / `automatic` / `automated slide` gates
- `ADA ped gate`, steel/security/vehicle/pedestrian gates
- chain-link / ornamental iron when tied to install scope

Bare `gate` or `fence` alone is **weak** and never enough for search visibility.

## Known false-positive traps (blocked)

| Pattern | Why blocked |
| --- | --- |
| Electrical for Landscaping + "entry gates" | Primary electrical/landscape; gate is incidental |
| "replace … with new" without fence/gate nearby | Regex false "Fence installation" |
| Permit-type catalog text mentioning Solar next to a real gate job | Negatives ignored when primary scope is fence/gate install |
| Subdivision / production home alone | No fencing trade inference without install language |
