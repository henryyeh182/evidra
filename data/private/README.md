# data/private — local-only personal data (never committed)

This directory holds **real** personal data — Apple Health exports and anything
derived from them. Everything here except this README is git-ignored (see the
`data/private/*` rule in [`.gitignore`](../../.gitignore)). This is deliberate:
the repository is public, and raw health data (HRV, resting HR, sleep, body
mass…) must never enter git history.

The MCP server's continuity store is `data/private/athletes/` by default. It
contains one hashed-identity JSON record per identified athlete and is written
only when a request has an OAuth subject or explicit `userId`. Anonymous tool
calls remain stateless. Set `EVIDRA_STATE_DIR` to place these records elsewhere.

## How to load your Apple Health data

1. On iPhone: **Health app → profile picture → Export All Health Data**. You get
   `export.zip`; unzip it and find `apple_health_export/export.xml`.
2. Copy that file to:

   ```
   data/private/apple-health/export.xml
   ```

3. Run the importer:

   ```bash
   npm run import:apple-health
   ```

   It parses and normalizes the export into
   `data/private/apple-health/normalized.json` (also git-ignored) and prints a
   real Semantic Fitness State computed from your data.

## What is safe to commit

Only small, **de-identified** sample fixtures for tests belong in the repo, and
those live under [`data/fixtures/apple-health/`](../fixtures/apple-health) — not
here. Do not move real records into `data/fixtures/`.
