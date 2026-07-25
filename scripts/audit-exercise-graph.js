// Quality audit for the exercise knowledge graph. Reports movement-pattern
// misclassifications (name keyword vs assigned pattern), contraindication
// coverage, and equipment sanity. Read-only: prints a report and writes a
// review file. Run: npm run audit:graph
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");

// Strong name keywords -> the movement pattern a coach would expect. Order
// matters: more specific phrases first.
const KEYWORD_PATTERN = [
  [/hyperextension|back extension|good ?morning|deadlift|romanian|rdl|hip thrust|hip hinge|kettlebell swing/, "hinge"],
  [/pulldown|pull-?up|pullup|chin-?up|chinup/, "vertical_pull"],
  [/\brow\b|inverted row/, "horizontal_pull"],
  [/overhead press|shoulder press|military press|arnold press|push press/, "vertical_push"],
  [/bench press|chest press|push-?up|pushup|chest dip|incline press|decline press/, "horizontal_push"],
  [/back squat|front squat|goblet squat|air squat|bodyweight squat|hack squat|\blunge\b|split squat|step-?up|leg press|pistol/, "squat"],
  [/leg extension|leg curl|lying curl|bicep curl|hammer curl|preacher curl|tricep|triceps|lateral raise|front raise|calf raise|cable fly|dumbbell fly|pec deck|wrist curl/, "isolation"],
  [/plank|sit-?up|situp|crunch|russian twist|leg raise|hollow hold|dead bug|ab wheel/, "core"],
  [/\bstretch\b|mobility|foam roll|\byoga\b/, "mobility"],
  [/\brun\b|\bjog\b|sprint|cycling|rowing machine|elliptical|treadmill|jump rope/, "locomotion"]
];

function expectedPattern(name) {
  const lower = name.toLowerCase();
  for (const [re, pattern] of KEYWORD_PATTERN) {
    if (re.test(lower)) return pattern;
  }
  return null;
}

async function main() {
  const data = JSON.parse(await readFile(join(rootDir, "data/seeds/exercises-graph.json"), "utf8"));
  const imported = data.exercises.filter((e) => e.source === "free-exercise-db");

  const misclassified = [];
  let checkable = 0;
  for (const node of imported) {
    const expected = expectedPattern(node.name);
    if (!expected) continue;
    checkable += 1;
    if (expected !== node.movementPattern) {
      misclassified.push({ id: node.id, name: node.name, assigned: node.movementPattern, expected });
    }
  }

  const noContra = imported.filter((e) => e.contraindications.length === 0).length;
  const highLoadNoContra = imported.filter(
    (e) => ["squat", "hinge", "vertical_push"].includes(e.movementPattern) && e.contraindications.length === 0
  ).length;

  const classificationAccuracy = checkable ? (checkable - misclassified.length) / checkable : 1;

  console.log("Knowledge graph quality audit");
  console.log("=".repeat(30));
  console.log(`Imported nodes:              ${imported.length}`);
  console.log(`Keyword-checkable nodes:     ${checkable}`);
  console.log(`Misclassified:               ${misclassified.length}`);
  console.log(`Classification accuracy:     ${(classificationAccuracy * 100).toFixed(1)}%  (gate >= 85% on checkable sample)`);
  console.log(`Contraindications empty:     ${noContra}/${imported.length}`);
  console.log(`High-load w/o contraindication: ${highLoadNoContra}`);

  const byExpected = {};
  for (const m of misclassified) {
    byExpected[m.expected] = byExpected[m.expected] || [];
    byExpected[m.expected].push(`${m.name} [${m.assigned}]`);
  }
  console.log("\nMisclassifications by expected pattern:");
  for (const [pattern, list] of Object.entries(byExpected).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${pattern} (${list.length}): ${list.slice(0, 6).join(", ")}${list.length > 6 ? " …" : ""}`);
  }

  // Substitute reasonableness (Phase 1 gate: >= 85% on a 50-exercise sample).
  // Proxy for human review: a substitute is reasonable when it trains the same
  // primary muscle or the same movement pattern. Deterministic sample (every
  // Nth node) so the number is reproducible across runs.
  const { buildExerciseGraph } = await import("../packages/knowledge-graph/src/graph.js");
  const graph = buildExerciseGraph(data);
  const step = Math.max(1, Math.floor(imported.length / 50));
  const sample = imported.filter((_, index) => index % step === 0).slice(0, 50);

  let subsTotal = 0;
  let subsReasonable = 0;
  const badSubstitutes = [];
  for (const node of sample) {
    for (const sub of graph.findSubstitutes(node.id, {})) {
      const target = graph.getExercise(sub.id);
      subsTotal += 1;
      const reasonable =
        target.primaryMuscle === node.primaryMuscle || target.movementPattern === node.movementPattern;
      if (reasonable) subsReasonable += 1;
      else badSubstitutes.push(`${node.name} -> ${target.name}`);
    }
  }
  const substituteRate = subsTotal ? subsReasonable / subsTotal : 1;
  console.log(`\nSubstitute reasonableness (${sample.length} sampled, ${subsTotal} substitutes):`);
  console.log(`  ${(substituteRate * 100).toFixed(1)}%  (gate >= 85%)`);
  if (badSubstitutes.length) {
    console.log(`  questionable: ${badSubstitutes.slice(0, 5).join("; ")}${badSubstitutes.length > 5 ? " …" : ""}`);
  }

  const reviewPath = join(rootDir, "data/vendor/graph-review-flags.json");
  await writeFile(reviewPath, `${JSON.stringify({ classificationAccuracy, misclassified }, null, 2)}\n`);
  console.log(`\nWrote ${misclassified.length} flags to data/vendor/graph-review-flags.json`);

  process.exitCode = classificationAccuracy >= 0.85 && highLoadNoContra === 0 && substituteRate >= 0.85 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
