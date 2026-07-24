import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildExerciseGraph } from "../src/graph.js";
import { assertValidTemplate, expandTemplate } from "../src/programTemplates.js";

const graphData = JSON.parse(
  await readFile(new URL("../../../data/seeds/exercises-graph.json", import.meta.url), "utf8")
);
const templates = JSON.parse(
  await readFile(new URL("../../../data/seeds/program-templates.json", import.meta.url), "utf8")
);
const graph = buildExerciseGraph(graphData);

test("seed templates are valid", () => {
  for (const template of templates) {
    assert.equal(assertValidTemplate(template), true);
  }
});

test("expandTemplate resolves movement patterns to grounded exercises", () => {
  const ppl = templates.find((template) => template.id === "template_ppl");
  const expanded = expandTemplate(ppl, graph, {
    availableEquipment: ["dumbbell", "barbell", "pull_up_bar"]
  });

  assert.equal(expanded.fullyGrounded, true);
  for (const day of expanded.days) {
    for (const slot of day.slots) {
      assert.ok(graph.exists(slot.exerciseId), `${slot.exerciseId} should exist`);
    }
  }
});

test("expandTemplate reports unmet patterns when equipment is missing", () => {
  const ppl = templates.find((template) => template.id === "template_ppl");
  const expanded = expandTemplate(ppl, graph, { availableEquipment: [] });

  // Vertical pull (pull-up) needs a bar, so it cannot be grounded bodyweight-only.
  assert.equal(expanded.fullyGrounded, false);
  assert.ok(expanded.unmetPatterns.includes("vertical_pull"));
});
