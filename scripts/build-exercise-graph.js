// Build data/seeds/exercises-graph.json by merging the hand-authored curated
// core with the vendored free-exercise-db dataset.
//
// Design constraints:
//   - The curated core (nodes + edges) is preserved verbatim; its ids and edges
//     are the safety-critical, test-covered part of the graph.
//   - Generated edges connect ONLY imported nodes to each other, so no curated
//     query result can change. Imported nodes carry a lower confidence and
//     source="free-exercise-db".
//
// Run: npm run build:graph
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { stableId } from "../packages/db/src/id.js";
import { assertValidGraphData } from "../packages/knowledge-graph/src/models.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");

const SIMILAR_TOP_K = 6;

// --- field mapping --------------------------------------------------------

const MUSCLE_MAP = {
  quadriceps: "quads",
  hamstrings: "hamstrings",
  glutes: "glutes",
  calves: "calves",
  adductors: "adductors",
  abductors: "abductors",
  chest: "chest",
  lats: "lats",
  "middle back": "back",
  "lower back": "lower_back",
  traps: "traps",
  shoulders: "shoulders",
  neck: "neck",
  biceps: "biceps",
  triceps: "triceps",
  forearms: "forearms",
  abdominals: "core"
};

const EQUIPMENT_MAP = {
  "body only": "none",
  dumbbell: "dumbbell",
  barbell: "barbell",
  kettlebells: "kettlebell",
  cable: "cable",
  machine: "machine",
  bands: "bands",
  "medicine ball": "medicine_ball",
  "exercise ball": "exercise_ball",
  "e-z curl bar": "ez_curl_bar",
  "foam roll": "foam_roller",
  other: "other"
};

const LEVEL_MAP = { beginner: "beginner", intermediate: "intermediate", expert: "advanced" };

const LEG_MUSCLES = new Set(["quads", "hamstrings", "glutes", "adductors", "abductors"]);

function mapMuscle(muscle) {
  return MUSCLE_MAP[muscle] || muscle.replace(/\s+/g, "_");
}

function mapEquipment(equipment) {
  if (!equipment) return ["none"];
  return [EQUIPMENT_MAP[equipment] || "none"];
}

function includesAny(haystack, needles) {
  return needles.some((needle) => haystack.includes(needle));
}

const ISOLATION_MUSCLES = new Set(["triceps", "biceps", "forearms", "calves"]);

function mapMovementPattern(exercise, primaryMuscle) {
  const name = `${exercise.name} ${exercise.id}`.toLowerCase();

  // 0. A "stretch" is always mobility, regardless of the muscle it targets.
  if (/\bstretch\b/.test(name)) return "mobility";

  // 1. Name keywords a coach would recognize take precedence over the coarse
  //    force/category signals (a "deadlift" is a hinge no matter how it's tagged).
  if (includesAny(name, ["deadlift", "good morning", "romanian", "rdl", "hip thrust", "hyperextension", "back extension", "hip hinge", "kettlebell swing"])) {
    return "hinge";
  }
  if (includesAny(name, ["tricep", "bicep", "curl", "leg extension", "leg curl", "calf raise", "lateral raise", "front raise", "rear delt", "pec deck", "cable fly", "cable crossover", "wrist", "reverse fly", "flye"])) {
    return "isolation";
  }
  if (includesAny(name, ["squat", "lunge", "step-up", "step up", "leg press", "split squat", "pistol"])) return "squat";

  // 2. Core (incl. static holds like planks) before the generic static->mobility.
  if (primaryMuscle === "core" || includesAny(name, ["plank", "sit-up", "situp", "crunch", "russian twist", "leg raise", "hollow", "dead bug", "ab wheel"])) {
    return "core";
  }

  if (exercise.category === "stretching" || exercise.force === "static") return "mobility";
  if (exercise.category === "cardio") return "locomotion";
  if (exercise.category === "plyometrics") return "plyometric";

  // 3. Single-joint muscles default to isolation unless a keyword above claimed them.
  if (ISOLATION_MUSCLES.has(primaryMuscle)) return "isolation";

  if (LEG_MUSCLES.has(primaryMuscle)) {
    if (primaryMuscle === "glutes" || primaryMuscle === "hamstrings") return "hinge";
    return "squat";
  }

  if (exercise.force === "push") {
    if (primaryMuscle === "shoulders" || primaryMuscle === "traps" || includesAny(name, ["overhead", "military"])) {
      return "vertical_push";
    }
    return "horizontal_push";
  }
  if (exercise.force === "pull") {
    if (includesAny(name, ["row"])) return "horizontal_pull";
    if (primaryMuscle === "lats" || includesAny(name, ["pulldown", "pull-up", "pullup", "chin"])) return "vertical_pull";
    if (primaryMuscle === "back" || primaryMuscle === "traps") return "horizontal_pull";
    return "vertical_pull";
  }
  return "isolation";
}

// Joint-based contraindication flags, matching the curated seed's convention
// (e.g. back squat -> ["knee","lower_back"]). These feed the R3 safety
// hard-filter; they are conservative joint flags, not medical advice.
function deriveContraindications(movementPattern, impactLevel) {
  const set = new Set();
  if (movementPattern === "squat") set.add("knee");
  if (movementPattern === "hinge") set.add("lower_back");
  if (movementPattern === "vertical_push") { set.add("shoulder"); set.add("lower_back"); }
  if (movementPattern === "horizontal_push") set.add("shoulder");
  if (movementPattern === "vertical_pull" || movementPattern === "horizontal_pull") set.add("shoulder");
  if (movementPattern === "locomotion" || impactLevel === "high") { set.add("knee"); set.add("ankle"); }
  return [...set];
}

const PLANE_BY_PATTERN = {
  horizontal_push: "transverse",
  horizontal_pull: "transverse",
  vertical_push: "frontal",
  vertical_pull: "frontal",
  squat: "sagittal",
  hinge: "sagittal",
  locomotion: "sagittal",
  plyometric: "sagittal",
  mobility: "multi",
  core: "sagittal",
  isolation: "sagittal"
};

const LOADS_BY_PATTERN = {
  squat: ["knee", "hip"],
  hinge: ["hip", "spine"],
  horizontal_push: ["shoulder", "elbow"],
  vertical_push: ["shoulder", "elbow"],
  horizontal_pull: ["shoulder", "elbow"],
  vertical_pull: ["shoulder", "elbow"],
  locomotion: ["knee", "ankle", "hip"],
  plyometric: ["knee", "ankle"],
  core: ["spine"],
  mobility: [],
  isolation: []
};

function isUnilateral(exercise) {
  const name = `${exercise.name} ${exercise.id}`.toLowerCase();
  return includesAny(name, ["single", "one-arm", "one arm", "one-legged", "split", "lunge", "pistol", "single-leg"]);
}

function toNode(exercise) {
  const primaryMuscle = exercise.primaryMuscles?.length ? mapMuscle(exercise.primaryMuscles[0]) : "full_body";
  const movementPattern = mapMovementPattern(exercise, primaryMuscle);
  const impactLevel =
    movementPattern === "plyometric" ? "high" : movementPattern === "locomotion" ? "moderate" : "low";

  const equipment = mapEquipment(exercise.equipment);
  // Data fix: the dataset tags pull-ups/chin-ups as "body only", but a vertical
  // pull needs something to hang from. Ground them on a bar so a bodyweight-only
  // program cannot silently satisfy a vertical-pull slot with no equipment.
  if (movementPattern === "vertical_pull" && equipment.length === 1 && equipment[0] === "none") {
    equipment[0] = "pull_up_bar";
  }

  return {
    id: stableId("exercise", "fedb", exercise.id),
    name: exercise.name,
    movementPattern,
    primaryMuscle,
    secondaryMuscles: (exercise.secondaryMuscles || []).map(mapMuscle),
    equipment,
    planeOfMotion: PLANE_BY_PATTERN[movementPattern] || "sagittal",
    unilateral: isUnilateral(exercise),
    skillLevel: LEVEL_MAP[exercise.level] || "intermediate",
    impactLevel,
    loadsJoints: LOADS_BY_PATTERN[movementPattern] || [],
    contraindications: deriveContraindications(movementPattern, impactLevel),
    source: "free-exercise-db",
    confidence: 0.6
  };
}

// --- edge generation (imported <-> imported only) -------------------------

function similarityScore(a, b) {
  let score = 0;
  if (a.primaryMuscle === b.primaryMuscle) score += 2;
  const sharedSecondary = a.secondaryMuscles.filter((m) => b.secondaryMuscles.includes(m)).length;
  score += sharedSecondary * 0.5;
  const sharedEquipment = a.equipment.filter((e) => b.equipment.includes(e)).length;
  score += sharedEquipment * 0.5;
  if (a.skillLevel === b.skillLevel) score += 0.25;
  return score;
}

function generateImportedEdges(nodes) {
  const edges = [];
  const seen = new Set();
  const addEdge = (edge) => {
    const key = `${edge.type}:${edge.from}:${edge.to}`;
    if (edge.from === edge.to || seen.has(key)) return;
    seen.add(key);
    edges.push(edge);
  };

  // Group by movement pattern so similarity is only computed within a pattern.
  const byPattern = new Map();
  for (const node of nodes) {
    if (!byPattern.has(node.movementPattern)) byPattern.set(node.movementPattern, []);
    byPattern.get(node.movementPattern).push(node);
  }

  for (const group of byPattern.values()) {
    for (const node of group) {
      const ranked = group
        .filter((other) => other.id !== node.id)
        .map((other) => ({ other, score: similarityScore(node, other) }))
        .sort((a, b) => b.score - a.score || a.other.id.localeCompare(b.other.id))
        .slice(0, SIMILAR_TOP_K);

      for (const { other, score } of ranked) {
        addEdge({
          type: "SIMILAR_TO",
          from: node.id,
          to: other.id,
          score: Number(Math.min(0.95, 0.5 + score / 6).toFixed(2)),
          dimensions: ["movement_pattern", "primary_muscle"]
        });
      }

      // A no-equipment alternative in the same pattern + primary muscle.
      if (!node.equipment.includes("none")) {
        const bodyweight = group.find(
          (other) =>
            other.id !== node.id &&
            other.primaryMuscle === node.primaryMuscle &&
            other.equipment.length === 1 &&
            other.equipment[0] === "none"
        );
        if (bodyweight) {
          addEdge({
            type: "SUBSTITUTES_FOR_WHEN",
            from: bodyweight.id,
            to: node.id,
            conditions: ["no_equipment"]
          });
        }
      }
    }
  }

  return edges;
}

// --- main -----------------------------------------------------------------

async function main() {
  const curated = JSON.parse(await readFile(join(rootDir, "data/seeds/exercises-graph.curated.json"), "utf8"));
  const raw = JSON.parse(await readFile(join(rootDir, "data/vendor/free-exercise-db.json"), "utf8"));

  const curatedIds = new Set(curated.exercises.map((e) => e.id));
  const importedNodes = [];
  const importedIds = new Set();

  for (const exercise of raw) {
    const node = toNode(exercise);
    if (curatedIds.has(node.id) || importedIds.has(node.id)) continue; // never shadow curated / dedupe
    importedIds.add(node.id);
    importedNodes.push(node);
  }

  const importedEdges = generateImportedEdges(importedNodes);

  const merged = {
    exercises: [...curated.exercises, ...importedNodes],
    edges: [...curated.edges, ...importedEdges]
  };

  assertValidGraphData(merged);

  await writeFile(join(rootDir, "data/seeds/exercises-graph.json"), `${JSON.stringify(merged, null, 2)}\n`);

  const patternCounts = {};
  for (const node of importedNodes) {
    patternCounts[node.movementPattern] = (patternCounts[node.movementPattern] || 0) + 1;
  }

  console.log("Built data/seeds/exercises-graph.json");
  console.log(`  curated: ${curated.exercises.length} nodes, ${curated.edges.length} edges`);
  console.log(`  imported: ${importedNodes.length} nodes, ${importedEdges.length} edges`);
  console.log(`  total:   ${merged.exercises.length} nodes, ${merged.edges.length} edges`);
  console.log(`  imported movement patterns:`, patternCounts);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
