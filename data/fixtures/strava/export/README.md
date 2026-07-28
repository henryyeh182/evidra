# Strava bulk-export fixture

Synthetic, including the athlete. The header of `activities.csv` is the real
103-column layout from a Strava "Download Request" archive — that layout *is*
the schema under test, so it is reproduced byte for byte. Every value below it
is invented, and the identity files (`profile.csv`, `logins.csv`, ...) are not
reproduced at all.

The invented athlete is born 1988-03-12, 72 kg, FTP 240 W, maximum heart rate
182 — left at Strava's 220-age default on purpose, so the age-estimate flag has
something to detect. The load columns are computed with Strava's own arithmetic
against that FTP (Intensity = round(NP/FTP x 100), Training Load = TSS), so the
fixture cannot disagree with itself.

The rows hold the dialect's traps in place:

| Activity | What it pins down |
|---|---|
| 1000000001 Run | power present, so `Training Load` (TSS) and `Intensity` are populated |
| 1000000002 Hike | heart rate but no power — `Relative Effort` is the only load signal |
| 1000000003 Ride | `Commute` disagrees between its two columns ("true" vs 1.0) |
| 1000000004 WeightTraining | no HR and no Relative Effort; per-set rows in `structured_details.csv` |
| 1000000005 Run | athlete typed a `Perceived Exertion`, which outranks any inference |

Duplicate headers are preserved throughout: `Distance`[6] is kilometres,
`Distance`[17] is metres, and both say "Distance".

## `activities/*.fit.gz`

Hand-built by the same generator — each holds a `file_id` and an `activity`
message and nothing else, with valid FIT header and CRCs. They exist to pin
down the one thing the CSVs cannot say, the athlete's UTC offset:

| File | Offset | Why |
|---|---|---|
| 2000000001 | +08:00 | the ordinary case |
| 2000000002 | +08:00 | UTC day 07-23, training day 07-24 — the flip the offset fixes |
| 2000000003 | none | `local_timestamp` is the all-ones sentinel, which must read as absent, not as a date in 2125 |
| 2000000004 | *(file absent)* | an export whose FIT files were pruned |
| 2000000005 | -07:00 | the same athlete, travelling: UTC day 07-25, training day 07-24 |

Real exports live in `data/private/` and are git-ignored.
