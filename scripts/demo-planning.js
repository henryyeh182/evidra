import { handleJsonRpcMessage } from "../apps/mcp-server/src/server.js";

async function callTool(id, name, args) {
  const response = await handleJsonRpcMessage(
    JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } })
  );
  if (response.error) {
    throw new Error(response.error.message);
  }
  return JSON.parse(response.result.content[0].text);
}

function printPlanSummary(plan) {
  console.log(`Plan ${plan.id} (v${plan.version}) — ${plan.name}`);
  console.log(`  ${plan.startDate} → ${plan.endDate} · ${plan.periodizationType}`);
  for (const week of plan.weeks) {
    const sessions = week.sessions
      .map((session) => `${session.dayOfWeek.slice(0, 3)} ${session.durationMinutes}m ${session.focus}`)
      .join(" | ");
    console.log(`  W${week.weekIndex} [${week.phase} x${week.loadMultiplier}] ${sessions}`);
  }
}

const userId = "user_henry_demo";

console.log("=== 1. Generate a 4-week plan ===");
const plan = await callTool(1, "generate_training_plan", { userId, startDate: "2026-07-27", weeks: 4 });
printPlanSummary(plan);

console.log("\n=== 2. Preview a travel week (reduce week 1 to 25 min/day) ===");
const preview = await callTool(2, "preview_plan_change", {
  planId: plan.id,
  changeRequest: { kind: "reduce_availability", weekdayAvailableMinutes: 25, weekIndexes: [1], reason: "Business travel" }
});
console.log(preview.summary);
for (const entry of preview.diff) {
  console.log(`  ${entry.date} ${entry.field}: ${JSON.stringify(entry.before)} → ${JSON.stringify(entry.after)}`);
}

console.log("\n=== 3. Commit the change ===");
const committed = await callTool(3, "commit_plan_change", { previewId: preview.previewId });
console.log(`Committed plan is now version ${committed.version}.`);
console.log(`Version history: ${committed.versionHistory.map((entry) => `v${entry.version}(${entry.weekdayAvailableMinutes}m)`).join(", ")}`);
printPlanSummary(committed.plan);
