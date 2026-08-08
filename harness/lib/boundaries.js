// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

/**
 * DH-BND: is every threshold exercised at its edge, and does the rule stay
 * quiet one step short of it?
 *
 * DH-COV asks whether a rule is reachable. A rule can be reachable and still
 * have its number free to move: every scenario that fires EVD-R-004 sits at a
 * fatigue of 80-odd, so 65 could become 55 or 75 and nothing here would notice.
 * The fingerprint catches the *edit*; this catches the *guarantee*, by pinning
 * scenarios either side of the line so that moving the line moves a decision.
 *
 * Set-level, like DH-COV and for the same reason: no single scenario can say
 * whether the threshold above it was also approached from the other side, and
 * `provedBy` points at a sibling scenario that a per-scenario check would not
 * have in hand.
 *
 * Three claims a scenario can make, declared in `rulePosition`:
 *
 *   triggers    The reading is on the acting side and the rule acts.
 *   boundary    The reading is *exactly* the threshold value. Whether that
 *               acts is the operator's business, not the scenario's — `>=`
 *               acts at the value and `>` does not, and deriving it here is
 *               what stops a scenario from asserting the wrong half of its own
 *               rule.
 *   just_below  The reading is on the non-acting side and within one step of
 *               the value, and the rule stays quiet.
 *
 * Every non-acting claim is then made to prove itself. A scenario that does not
 * fire a rule proves nothing on its own: on a rule with more than one threshold
 * the silence may be some other condition failing, and the two are
 * indistinguishable from outside. So the same scenario is re-run with that one
 * quantity pushed across the line; if the rule does not fire then, the silence
 * was not this threshold's doing and the scenario is not testing what it says
 * it tests.
 */

import { runChain } from "./chain.js";
import {
  QUANTITIES,
  actingSideValue,
  boundaryActs,
  findThreshold,
  libraryThresholds,
  onActingSide,
  requiredPositions,
  stepFor
} from "./quantities.js";

const POSITIONS = ["triggers", "boundary", "just_below"];

/** Floating-point comparison, because `ratio` steps are 0.01. */
const near = (a, b) => Math.abs(a - b) < 1e-9;

function appliedEntry(result, ruleId) {
  return (result.decision.decisionBasis?.appliedRules || []).find((rule) => rule.ruleId === ruleId);
}

/**
 * Check one declaration against the run that made it.
 *
 * @returns {Promise<string[]>} failures, in the scenario's own terms
 */
async function checkDeclaration(run, declaration, byId) {
  const failures = [];
  const { rule: ruleId, threshold: key, position } = declaration;
  const where = `${ruleId}/${key}`;

  if (!POSITIONS.includes(position)) {
    return [`declares position "${position}" for ${where}; it must be one of ${POSITIONS.join(", ")}`];
  }

  const threshold = findThreshold(ruleId, key);
  if (!threshold) {
    return [`declares a straddle of ${where}, and the active rule library has no such threshold`];
  }

  const quantity = QUANTITIES[`${ruleId}/${key}`];
  if (!quantity) {
    return [`declares a straddle of ${where}, and nothing says where that quantity is read from`];
  }
  if (quantity.gates === "effect") {
    return [
      `declares a straddle of ${where}, which is a cap the rule applies after it fires rather ` +
        `than something a reading is compared against — there is no side to be on`
    ];
  }

  const measured = quantity.read(run);
  if (measured === null || measured === undefined) {
    return [`declares a straddle of ${where} and supplies nothing for that quantity to be read from`];
  }

  const acting = onActingSide(measured, threshold);
  const step = stepFor(threshold);

  // 1. Is the reading where the scenario says it is?
  if (position === "triggers" && !acting) {
    failures.push(
      `claims to trigger ${where}, but ${measured} is not ${threshold.operator} ${threshold.value}`
    );
  }
  if (position === "boundary" && !near(measured, threshold.value)) {
    failures.push(
      `claims to sit on ${where}'s boundary, but the reading is ${measured} and the threshold is ` +
        `${threshold.value} — a boundary case has to be exactly on it or it is testing nothing in ` +
        `particular`
    );
  }
  if (position === "just_below") {
    if (acting) {
      failures.push(
        `claims to fall short of ${where}, but ${measured} is ${threshold.operator} ` +
          `${threshold.value}, which is the acting side`
      );
    } else if (Math.abs(measured - threshold.value) > step + 1e-9) {
      failures.push(
        `claims to fall just short of ${where}, but ${measured} is more than one step (${step}) ` +
          `from ${threshold.value} — far below a threshold says nothing about where it is`
      );
    }
  }

  // 2. Did the rule do what being on that side of the line means?
  const entry = appliedEntry(run, ruleId);
  if (quantity.gates === "firing") {
    if (acting && !entry) {
      failures.push(
        `${measured} is ${threshold.operator} ${threshold.value} and ${ruleId} did not fire`
      );
    }
    if (!acting && entry) {
      failures.push(
        `${measured} is short of ${where} (${threshold.operator} ${threshold.value}) and ${ruleId} ` +
          `fired anyway`
      );
    }
  } else if (quantity.gates === "severity") {
    // The rule fires either side of a severity threshold; what the threshold
    // decides is how hard it pushes.
    if (!entry) {
      failures.push(
        `${where} is a severity threshold, so ${ruleId} has to have fired for it to mean ` +
          `anything, and it did not`
      );
    } else if (entry.measured?.severe !== acting) {
      failures.push(
        `${measured} is ${acting ? "" : "not "}${threshold.operator} ${threshold.value}, so the ` +
          `reading should record severe ${acting}, and it records ${entry.measured?.severe}`
      );
    }
  }

  // 3. Does the reader here still agree with what the engine measured? This is
  //    what keeps `quantities.js` from drifting into checking a number the
  //    engine never looked at. Only where the rule publishes this quantity: a
  //    rule records one reading, and comparing a token length against the
  //    movement count that happened to be recorded would fail for being right.
  if (entry && quantity.engineField) {
    const recorded = entry.measured?.[quantity.engineField];
    if (typeof recorded === "number" && !near(recorded, measured)) {
      failures.push(
        `the harness reads ${where} as ${measured} and the engine recorded ${recorded} ` +
          `— one of the two is measuring the wrong thing`
      );
    }
  }

  // 4. Prove the silence. Only for readings that did not act: an acting reading
  //    that fired the rule has already demonstrated the connection.
  if (!acting) {
    const target = actingSideValue(threshold);

    if (quantity.nudge) {
      const probed = await runChain(run.scenario, {
        overrideState: (state) => quantity.nudge(state, target, run)
      });
      const probedEntry = appliedEntry(probed, ruleId);
      const acted =
        quantity.gates === "severity" ? probedEntry?.measured?.severe === true : Boolean(probedEntry);
      if (!acted) {
        failures.push(
          `moving ${where} from ${measured} to ${target} — across the threshold and nothing else — ` +
            `still does not make ${ruleId} act, so this scenario's silence is some other ` +
            `condition's doing and it is not testing ${key}`
        );
      }
    } else if (declaration.provedBy) {
      // No state field to move, so the proof is a sibling scenario that differs
      // in this quantity and does act. Weaker than the probe, and visibly so:
      // two scenarios can differ in more than one thing.
      const sibling = byId.get(declaration.provedBy);
      if (!sibling) {
        failures.push(
          `names ${declaration.provedBy} as proof that ${where} is what keeps ${ruleId} quiet here, ` +
            `and no scenario has that id`
        );
      } else {
        const siblingMeasured = quantity.read(sibling);
        if (!appliedEntry(sibling, ruleId)) {
          failures.push(
            `names ${declaration.provedBy} as proof for ${where}, and ${ruleId} does not fire there ` +
              `either`
          );
        } else if (!onActingSide(siblingMeasured, threshold)) {
          failures.push(
            `names ${declaration.provedBy} as proof for ${where}, and its reading (${siblingMeasured}) ` +
              `is on the same side of the threshold as this one`
          );
        }
      }
    } else {
      failures.push(
        `sits short of ${where} and offers no way to show that ${key} is what kept ${ruleId} quiet ` +
          `— the quantity has no state field to move, so the scenario has to name a sibling in ` +
          `\`provedBy\``
      );
    }
  }

  return failures;
}

/**
 * @param {{ scenario: object, result: object }[]} runs
 * @returns {Promise<{ findings: object[], matrix: object[] }>}
 */
export async function checkBoundaries(runs) {
  const findings = [];
  const byId = new Map(runs.map(({ scenario, result }) => [scenario.id, result]));
  /** @type {Map<string, Map<string, string[]>>} */
  const covered = new Map();

  for (const { scenario, result } of runs) {
    for (const declaration of scenario.rulePosition || []) {
      const failures = await checkDeclaration(result, declaration, byId);
      for (const failure of failures) {
        findings.push({ check: "DH-BND", scenario: scenario.id, failure });
      }

      if (failures.length === 0) {
        const where = `${declaration.rule}/${declaration.threshold}`;
        if (!covered.has(where)) covered.set(where, new Map());
        const positions = covered.get(where);
        if (!positions.has(declaration.position)) positions.set(declaration.position, []);
        positions.get(declaration.position).push(scenario.id);
      }
    }
  }

  // The coverage half. Only declarations that held count towards it: a straddle
  // that failed its own claim is not evidence that the threshold was exercised.
  const matrix = [];
  for (const { ruleId, key, threshold, quantity } of libraryThresholds()) {
    const where = `${ruleId}/${key}`;

    if (!quantity) {
      findings.push({
        check: "DH-BND",
        scenario: "—",
        failure:
          `${where} is a threshold in an active rule and nothing in harness/lib/quantities.js says ` +
          `where that quantity is read from, so it cannot be straddled`
      });
      continue;
    }
    if (quantity.gates === "effect") continue;

    const positions = covered.get(where) || new Map();
    const required = requiredPositions(threshold, quantity);
    const missing = required.filter((position) => !positions.has(position));

    // On `<` and `>` the boundary reading is itself the non-acting one, so it
    // discharges `just_below` as well. Recorded rather than assumed: this is
    // the reason the required list is shorter for those operators.
    matrix.push({
      where,
      gates: quantity.gates,
      operator: threshold.operator,
      value: threshold.value,
      boundaryActs: boundaryActs(threshold),
      unreachable: quantity.unreachable ?? null,
      required,
      positions,
      missing
    });

    for (const position of missing) {
      findings.push({
        check: "DH-BND",
        scenario: "—",
        failure:
          `no scenario puts ${where} at "${position}" (${threshold.operator} ${threshold.value}), ` +
          `so that threshold could move ${position === "triggers" ? "outward" : "inward"} and every ` +
          `check here would still pass`
      });
    }
  }

  return { findings, matrix };
}
