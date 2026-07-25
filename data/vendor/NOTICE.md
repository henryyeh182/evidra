# Vendored datasets

## free-exercise-db.json

- Source: https://github.com/yuhonas/free-exercise-db
- License: The Unlicense (public domain dedication)
- 873 exercises with name, force, level, mechanic, equipment, primary/secondary
  muscles, category, and instructions.

This is the raw upstream dataset. `scripts/build-exercise-graph.js` transforms it
into knowledge-graph nodes and merges it with the hand-authored curated core
(`data/seeds/exercises-graph.curated.json`) to produce
`data/seeds/exercises-graph.json`. Do not edit the transformed output by hand —
edit the curated file or the build script and re-run `npm run build:graph`.
