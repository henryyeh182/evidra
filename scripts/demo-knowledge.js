import { readFile } from "node:fs/promises";
import { buildExerciseGraph, searchWorkouts, assertValidWorkout, expandTemplate } from "../packages/knowledge-graph/src/index.js";

async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(`../${relativePath}`, import.meta.url), "utf8"));
}

const graph = buildExerciseGraph(await readJson("data/seeds/exercises-graph.json"));
const workouts = await readJson("data/seeds/workouts.json");
const templates = await readJson("data/seeds/program-templates.json");
for (const workout of workouts) assertValidWorkout(workout, graph);

console.log(`Knowledge graph: ${graph.size} exercises, ${graph.edgeCount} relationships\n`);

console.log('Q: "Find a knee-friendly squat substitute" (one graph traversal)');
for (const sub of graph.findSubstitutes("exercise_back_squat", { conditions: ["knee_injury"], avoidContraindications: ["knee"] })) {
  console.log(`   - ${sub.name} — ${sub.reason}`);
}

console.log('\nQ: "Upper-body only, dumbbells and a bench"');
for (const exercise of graph.searchExercises({ muscleGroup: "upper", availableEquipment: ["dumbbell", "bench"] })) {
  console.log(`   - ${exercise.name} (${exercise.primaryMuscle})`);
}

console.log('\nQ: "A workout entirely in Zone 2"');
for (const workout of searchWorkouts(workouts, graph, { inZone: 2 })) {
  console.log(`   - ${workout.name} (${workout.durationMinutes} min)`);
}

console.log('\nQ: "No-equipment session under 20 minutes"');
for (const workout of searchWorkouts(workouts, graph, { availableEquipment: [], maxDurationMinutes: 20 })) {
  console.log(`   - ${workout.name} (${workout.durationMinutes} min)`);
}

console.log("\nExpand the Push/Pull/Legs template into grounded exercises:");
const expanded = expandTemplate(templates.find((template) => template.id === "template_ppl"), graph, {
  availableEquipment: ["dumbbell", "barbell", "pull_up_bar", "bench"]
});
for (const day of expanded.days) {
  console.log(`   ${day.label}: ${day.slots.map((slot) => slot.exerciseName).join(", ")}`);
}
console.log(`   fully grounded: ${expanded.fullyGrounded}`);
