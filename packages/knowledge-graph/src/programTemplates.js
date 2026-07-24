/**
 * @typedef {Object} TemplateDay
 * @property {string} label
 * @property {string[]} movementPatterns
 */

/**
 * @typedef {Object} ProgramTemplate
 * @property {string} id
 * @property {string} name
 * @property {string} periodization
 * @property {number} daysPerWeek
 * @property {TemplateDay[]} days
 */

export function assertValidTemplate(template) {
  if (!template || typeof template !== "object") {
    throw new Error("Program template must be an object.");
  }
  for (const field of ["id", "name", "periodization", "days"]) {
    if (template[field] === undefined || template[field] === null) {
      throw new Error(`Template ${template.id || "?"} is missing field: ${field}`);
    }
  }
  if (!Array.isArray(template.days) || template.days.length === 0) {
    throw new Error(`Template ${template.id} must contain days.`);
  }
  if (template.days.length !== template.daysPerWeek) {
    throw new Error(`Template ${template.id} daysPerWeek does not match its days.`);
  }
  return true;
}

/**
 * Expand a parameterized template into concrete, grounded exercise ids by
 * resolving each movement pattern against the knowledge graph under the given
 * constraints. Every returned exerciseId is guaranteed to exist in the graph.
 *
 * @param {ProgramTemplate} template
 * @param {{ searchExercises: Function }} graph
 * @param {{ availableEquipment?: string[], excludeContraindications?: string[], skillLevel?: string }} [constraints]
 */
export function expandTemplate(template, graph, constraints = {}) {
  assertValidTemplate(template);

  const days = template.days.map((day) => {
    const slots = day.movementPatterns.map((pattern) => {
      const matches = graph.searchExercises({
        movementPattern: pattern,
        availableEquipment: constraints.availableEquipment,
        excludeContraindications: constraints.excludeContraindications,
        skillLevel: constraints.skillLevel,
        limit: 1
      });
      const choice = matches[0];
      return {
        movementPattern: pattern,
        exerciseId: choice ? choice.id : null,
        exerciseName: choice ? choice.name : null,
        unmet: !choice
      };
    });

    return { label: day.label, slots };
  });

  const unmet = days.flatMap((day) => day.slots.filter((slot) => slot.unmet).map((slot) => slot.movementPattern));

  return {
    templateId: template.id,
    name: template.name,
    periodization: template.periodization,
    days,
    fullyGrounded: unmet.length === 0,
    unmetPatterns: [...new Set(unmet)]
  };
}
