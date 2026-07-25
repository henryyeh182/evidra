/**
 * Training load model: ATL / CTL / TSB.
 *
 * The standard impulse-response formulation used across endurance coaching.
 * Both curves are exponentially weighted moving averages of daily training
 * load, differing only in time constant:
 *
 *   CTL(t) = CTL(t-1) + (load(t) - CTL(t-1)) / 42    chronic — fitness
 *   ATL(t) = ATL(t-1) + (load(t) - ATL(t-1)) /  7    acute   — fatigue
 *   TSB(t) = CTL(t-1) - ATL(t-1)                     balance — freshness
 *
 * TSB reads yesterday's curves on purpose: today's session has not been
 * absorbed yet, so including it would make a hard day look like recovery.
 *
 * Computed fresh from the evidence supplied on each call — this package holds
 * no state. The resulting curve is returned so the caller can remember it.
 */

const CTL_DAYS = 42;
const ATL_DAYS = 7;

/** Ramp-rate guidance. ACWR outside ~0.8–1.3 is where injury risk climbs. */
export const LOAD_ZONES = {
  detraining: { maxTsb: Infinity, minTsb: 25, label: "detraining", note: "負荷不足，體能開始流失" },
  fresh: { maxTsb: 25, minTsb: 5, label: "fresh", note: "恢復充分，可承受高強度" },
  neutral: { maxTsb: 5, minTsb: -10, label: "neutral", note: "負荷與恢復平衡" },
  productive: { maxTsb: -10, minTsb: -30, label: "productive", note: "有效訓練壓力，需留意恢復" },
  overreaching: { maxTsb: -30, minTsb: -Infinity, label: "overreaching", note: "過度負荷，建議減量" }
};

function dayKey(iso) {
  return String(iso).slice(0, 10);
}

function addDays(day, n) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + n);
  return date.toISOString().slice(0, 10);
}

/** Sum each day's training load; days with no session contribute zero. */
function dailyLoads(workouts) {
  const perDay = new Map();
  for (const workout of workouts) {
    if (!workout.startedAt) continue;
    const day = dayKey(workout.startedAt);
    const load = Number(workout.trainingLoad ?? 0);
    perDay.set(day, (perDay.get(day) || 0) + (Number.isFinite(load) ? load : 0));
  }
  return perDay;
}

/**
 * Walk the calendar day by day so rest days decay the curves. Iterating the
 * workout list alone would leave a fortnight off looking like peak fatigue.
 *
 * @param {Array<{startedAt: string, trainingLoad?: number}>} workouts
 * @param {{ asOf: string, windowDays?: number }} options
 */
export function computeTrainingLoad(workouts = [], options = {}) {
  const asOf = dayKey(options.asOf || new Date().toISOString());
  // Only evidence up to `asOf` may inform the curve. Including later sessions
  // leaks the future into the seed and inflates every historical point.
  const perDay = dailyLoads(workouts.filter((w) => w.startedAt && dayKey(w.startedAt) <= asOf));

  const observed = [...perDay.keys()].sort();
  const earliest = observed[0];
  // Start where the evidence starts, or one window back for a long history —
  // whichever is later. Running the loop before the first session would decay
  // the seed away over empty days and reintroduce the very ramp it prevents.
  const windowDays = options.windowDays ?? CTL_DAYS * 2;
  const windowStart = addDays(asOf, -windowDays);
  const start = earliest && earliest > windowStart ? earliest : windowStart;

  // Cold-start seeding. Starting both curves at zero makes CTL climb for six
  // weeks while ATL settles in one, so anyone with a short history reads as
  // overreaching purely from the ramp. Seed with the observed mean daily load
  // so a steady athlete starts at equilibrium and only real spikes register.
  // Average over the span we actually observed, not the padded window — padding
  // with empty days would drag the seed toward zero and reintroduce the ramp.
  const observedSpan = earliest
    ? Math.max(1, Math.round((new Date(`${asOf}T00:00:00Z`) - new Date(`${earliest}T00:00:00Z`)) / 86400000) + 1)
    : 1;
  const totalLoad = [...perDay.values()].reduce((sum, value) => sum + value, 0);
  const seed = observed.length > 0 ? totalLoad / observedSpan : 0;

  let ctl = seed;
  let atl = seed;
  let prevCtl = seed;
  let prevAtl = seed;
  const series = [];

  for (let day = start; day <= asOf; day = addDays(day, 1)) {
    prevCtl = ctl;
    prevAtl = atl;
    const load = perDay.get(day) || 0;
    ctl = ctl + (load - ctl) / CTL_DAYS;
    atl = atl + (load - atl) / ATL_DAYS;
    series.push({
      date: day,
      load,
      ctl: Number(ctl.toFixed(1)),
      atl: Number(atl.toFixed(1)),
      tsb: Number((prevCtl - prevAtl).toFixed(1))
    });
  }

  const today = series[series.length - 1];
  const tsb = today ? today.tsb : 0;

  // Acute:chronic ratio, the ramp-rate check coaches actually use.
  const acwr = today && today.ctl > 0 ? Number((today.atl / today.ctl).toFixed(2)) : 0;

  const zone = Object.values(LOAD_ZONES).find((z) => tsb < z.maxTsb && tsb >= z.minTsb) || LOAD_ZONES.neutral;

  // Days of evidence actually covering the chronic window drives confidence:
  // a 42-day curve built from a week of data is not a 42-day curve.
  const coveredDays = observed.filter((day) => day > addDays(asOf, -CTL_DAYS) && day <= asOf).length;
  const historyDays = earliest ? Math.min(CTL_DAYS, Math.round((new Date(`${asOf}T00:00:00Z`) - new Date(`${earliest}T00:00:00Z`)) / 86400000)) : 0;

  const sufficient = historyDays >= CTL_DAYS * 0.5;

  return {
    asOf,
    ctl: today ? today.ctl : 0,
    atl: today ? today.atl : 0,
    tsb,
    acwr,
    // A 42-day curve built from two weeks is not a 42-day curve. Rather than
    // hand back an authoritative-looking zone, say the history is too short —
    // the caller can still see the raw numbers and judge for itself.
    zone: sufficient ? zone.label : "insufficient_history",
    zoneNote: sufficient
      ? zone.note
      : `僅 ${historyDays} 天訓練史（需 ≥ ${Math.round(CTL_DAYS * 0.5)} 天），負荷曲線尚未收斂，此區間判定不可靠。`,
    coverage: {
      historyDays,
      workoutDays: coveredDays,
      sufficient
    },
    series
  };
}

/**
 * Personal baselines from the supplied evidence, replacing population averages.
 * A fixed HRV baseline of 52ms describes a population, not this athlete — using
 * it makes every reading look like a deviation for someone who simply runs low.
 *
 * @param {Array<{type: string, value: number, recordedAt: string}>} healthMetrics
 * @param {{ asOf: string, windowDays?: number }} [options]
 */
export function computePersonalBaselines(healthMetrics = [], options = {}) {
  const asOf = dayKey(options.asOf || new Date().toISOString());
  const windowDays = options.windowDays ?? 60;
  const cutoff = addDays(asOf, -windowDays);

  const byType = new Map();
  for (const metric of healthMetrics) {
    if (!metric?.type || typeof metric.value !== "number") continue;
    if (dayKey(metric.recordedAt) < cutoff) continue;
    if (!byType.has(metric.type)) byType.set(metric.type, []);
    byType.get(metric.type).push(metric.value);
  }

  const baselines = {};
  for (const [type, values] of byType) {
    const sorted = [...values].sort((a, b) => a - b);
    // Median rather than mean: a single bad night should not move the baseline.
    const median = sorted.length % 2
      ? sorted[(sorted.length - 1) / 2]
      : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
    baselines[type] = {
      median: Number(median.toFixed(1)),
      sampleCount: sorted.length,
      // Below this many readings the "baseline" is really just noise.
      reliable: sorted.length >= 10
    };
  }

  return { asOf, windowDays, baselines };
}
