# Contract fixture provenance

These fixtures are safe contract inputs only; they contain no real personal
health data and are never uploaded to a provider or submitted to a registry.

| Fixture | Boundary represented | Status |
|---|---|---|
| `strava-api.synthetic.json` | Strava `DetailedActivity` API subset | Synthetic values; field names checked against the public API reference |
| `oura-api-v2.synthetic.json` | Oura API v2 endpoint-shaped join | Synthetic envelope joining the `sleep`, `daily_sleep`, `daily_readiness`, `daily_activity`, and `workout` response families |
| `whoop-api-v2.synthetic.json` | WHOOP API v2 endpoint-shaped join | Synthetic envelope joining recovery, sleep, cycle, and workout records |
| `../garmin/export-sample.json` | Garmin Connect export-shaped JSON | De-identified checked-in export fixture; not a live Garmin cloud API response |

“Synthetic” means the values and combined test document were authored for the
contract tests. It does not mean a provider guarantee: nullable fields,
omitted fields, score gates, timestamp semantics, and units are tested only
against the provider documentation currently cited by each source schema.
Live provider responses require provider approval/credentials and are outside
this repository’s evidence boundary.
