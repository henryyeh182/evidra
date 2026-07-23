import test from "node:test";
import assert from "node:assert/strict";
import { assertValidUserContext } from "../src/models.js";

test("assertValidUserContext accepts a complete context", () => {
  const context = {
    user: {
      id: "user_1",
      name: "Demo",
      timezone: "Asia/Taipei",
      heightCm: 175,
      weightKg: 74,
      fitnessLevel: "intermediate"
    },
    goals: [],
    preferences: [],
    injuries: [],
    equipment: [],
    workouts: [],
    healthMetrics: []
  };

  assert.equal(assertValidUserContext(context), true);
});

test("assertValidUserContext rejects missing user fields", () => {
  const context = {
    user: {
      id: "user_1"
    },
    goals: [],
    preferences: [],
    injuries: [],
    equipment: [],
    workouts: [],
    healthMetrics: []
  };

  assert.throws(() => assertValidUserContext(context), /Missing required user field/);
});
