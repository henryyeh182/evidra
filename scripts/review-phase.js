#!/usr/bin/env node
// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

/**
 * 階段任務完成審查 —— 機械可驗的那一半。
 *
 * 每次宣告「某個 Phase／偏差修好了」之前跑這支。它不判斷做得好不好，只回答
 * 一個問題：**已經宣告完成的東西，現在還成立嗎？**
 *
 * 為什麼需要它：這個專案的完成宣稱寫在五份文件裡（README、CLAUDE.md、宣言、
 * implementation plan、user-journey），而事實長在程式與 gate 裡。兩邊各自
 * 演化，沒有任何機制讓它們對帳——實際上已經漂移過兩次（測試數、圖譜節點數、
 * 一個 registry 宣告了卻不存在的來源）。文件說了什麼不重要，說的跟做的不一樣
 * 才重要。
 *
 * 需要人判斷的那一半（GPT-6 判準、Decision ≠ Recommendation、三條紀律）在
 * docs/phase-review.md，這支不假裝能驗。
 *
 *   npm run review:phase
 *
 * 任何一條 gate 不過就 exit 1，並印出具體到 file:line 的漂移點。
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");

/** 對外 tool 的白名單。新增一個名字之前，先過 docs/phase-review.md 的 GPT-6 判準。 */
const APPROVED_DECISION_TOOLS = [
  "evidra_assess_fitness_state",
  "evidra_decide_session",
  "evidra_decide_exercise_substitution",
  "evidra_generate_plan",
  "evidra_preview_adjust_plan",
  "evidra_commit_adjust_plan"
];

/**
 * 承諾 A（決策自我解釋）逐 tool 的最低欄位。
 * 決策型的三個要能回答「憑什麼、有多確定、缺什麼、換掉了什麼」；
 * 計畫型的三個是決策的基底，要能回答「為什麼這樣排、改了哪裡」。
 */
const SELF_EXPLANATION = {
  evidra_assess_fitness_state: ["confidence", "signalCoverage", "provenance"],
  evidra_decide_session: ["decision", "action", "reason", "confidence", "signalCoverage", "limits", "provenance"],
  evidra_decide_exercise_substitution: ["decision", "action", "reason", "confidence", "limits"],
  evidra_generate_plan: ["reasoning"],
  evidra_preview_adjust_plan: ["diff", "summary"],
  evidra_commit_adjust_plan: ["versionHistory"]
};

/** 宣告完成度的文件。這五份都必須走得過。 */
const CLAIM_DOCS = [
  "README.md",
  "CLAUDE.md",
  "docs/fitness-mcp-implementation-plan.md",
  "docs/design-manifesto.md",
  "docs/user-journey.html"
];

const results = [];

function gate(id, title, why, run) {
  let findings = [];
  let error = null;
  try {
    findings = run() || [];
  } catch (cause) {
    error = cause;
  }
  results.push({ id, title, why, findings, error });
}

function read(relativePath) {
  return readFileSync(join(rootDir, relativePath), "utf8");
}

function has(relativePath) {
  return existsSync(join(rootDir, relativePath));
}

/** 回報漂移時附上行號，否則收到的人得自己找。 */
/**
 * 位置要用這一處 match 的 index，不能拿字串回頭去找第一次出現的地方——同一份
 * 文件寫了三次 `262 tests` 時，三筆 finding 會全部指向第一行，修完那一行還是紅的。
 */
function locate(relativePath, text, index) {
  if (!Number.isInteger(index) || index < 0) return relativePath;
  return `${relativePath}:${text.slice(0, index).split("\n").length}`;
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

// ---------------------------------------------------------------------------
// G0 — 必讀文件在不在
// ---------------------------------------------------------------------------

gate(
  "G0",
  "審查的五份真相文件存在",
  "審查的前提是有東西可對帳；文件被刪掉或改名時，後面每一條 gate 都會變成空跑。",
  () => CLAIM_DOCS.filter((path) => !has(path)).map((path) => `${path} 不存在`)
);

// ---------------------------------------------------------------------------
// G1 — 文件宣稱的數字 vs 工具實測
// ---------------------------------------------------------------------------

gate(
  "G1",
  "文件寫的數字就是工具跑出來的數字",
  "已經漂移過兩次。一份說 138、一份說 184、實際 221 的文件，讀的人無從判斷哪個是真的。",
  () => {
    const findings = [];

    // 明確指定 TAP，不要靠預設 reporter。這條比對死過一次：node --test 的預設
    // 輸出從 TAP 換成 spec（`ℹ pass 288`）之後就再也對不到 `# pass`，而下面的
    // Number.isFinite 讓它安靜地跳過——CLAUDE.md 寫 284、實測 288，G1 照樣綠。
    const tap = execFileSync("node", ["--test", "--test-reporter=tap"], {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
    const actualTests = Number(/^# pass (\d+)$/m.exec(tap)?.[1]);
    const graph = readJson("data/seeds/exercises-graph.json");
    const actualNodes = graph.exercises.length;
    const actualEdges = graph.edges.length;
    const actualTools = APPROVED_DECISION_TOOLS.length;
    const actualParsers = readdirSync(join(rootDir, "packages/connectors/src/providers")).length;

    // 只比對「整張圖」的宣稱。4.3 那種「策展核心 28 節點」「匯入 861 節點」是
    // 不同的量，抓進來就是製造誤報，而誤報會讓人學會忽略這支。
    const claims = [
      { pattern: /(\d[\d,]*)\s*tests/gi, actual: actualTests, label: "tests" },
      { pattern: /(\d[\d,]*)\s*節點\s*\/\s*[\d,]+\s*邊/g, actual: actualNodes, label: "圖譜節點" },
      { pattern: /[\d,]+\s*節點\s*\/\s*(\d[\d,]*)\s*邊/g, actual: actualEdges, label: "圖譜邊" },
      { pattern: /(\d[\d,]*)\s*節點知識圖譜/g, actual: actualNodes, label: "圖譜節點" },
      { pattern: /(\d+)\s*個(?:對外)?決策\s*tool/g, actual: actualTools, label: "對外決策 tool" },
      { pattern: /parser\s*實作\s*(\d+)\s*家/g, actual: actualParsers, label: "parser 家數" }
    ];

    // 量不到就是紅的，不是跳過。一條「無法測量」的宣稱與一條「已驗證相符」的
    // 宣稱在輸出上長得一樣，才是這支工具最危險的失敗——它會讓人以為查過了。
    for (const { actual, label } of claims) {
      if (!Number.isFinite(actual)) {
        findings.push(`量不到「${label}」的實測值，所以這條宣稱這次根本沒有被檢查`);
      }
    }

    for (const docPath of CLAIM_DOCS.filter(has)) {
      const text = read(docPath);
      for (const { pattern, actual, label } of claims) {
        for (const match of text.matchAll(pattern)) {
          const claimed = Number(match[1].replace(/,/g, ""));
          if (Number.isFinite(actual) && claimed !== actual) {
            findings.push(`${locate(docPath, text, match.index)} 寫 ${label} ${claimed}，實測 ${actual}`);
          }
        }
      }
    }

    return findings;
  }
);

// ---------------------------------------------------------------------------
// G2 — 對外工具面沒有滑回內容庫
// ---------------------------------------------------------------------------

gate(
  "G2",
  "對外 tool 全部是決策或決策基底",
  "原則 5 與 D-TOOL。R2 已經發生過一次（早期蓋出檢索層），這條是它的常設圍欄。",
  async () => {
    const findings = [];
    const definitions = readFileSync(join(rootDir, "apps/mcp-server/src/toolDefinitions.js"), "utf8");

    // 從原始碼讀，而不是 import 後執行——審查不該依賴被審查的程式跑得起來。
    const listed = [...definitions.matchAll(/^\s{4}name:\s*"([a-z_]+)"/gm)].map((m) => m[1]);
    const deprecated = new Set(
      [...definitions.matchAll(/name:\s*"([a-z_]+)"[\s\S]{0,600}?deprecated:\s*true/g)].map((m) => m[1])
    );
    const exposed = listed.filter((name) => !deprecated.has(name));

    if (exposed.length > 10) {
      findings.push(`對外 tool ${exposed.length} 個，超過 ≤10 上限`);
    }
    for (const name of exposed) {
      if (!APPROVED_DECISION_TOOLS.includes(name)) {
        findings.push(`${name} 未登錄在白名單——先過 GPT-6 判準（docs/phase-review.md）再加進 scripts/review-phase.js`);
      }
    }
    for (const name of APPROVED_DECISION_TOOLS) {
      if (!exposed.includes(name)) {
        findings.push(`白名單的 ${name} 已不在對外清單——若是刻意下架，白名單要一起改`);
      }
    }

    return findings;
  }
);

// ---------------------------------------------------------------------------
// G2b — 被選中的條件
// ---------------------------------------------------------------------------

gate(
  "G2b",
  "每個對外 tool 都說得出使用者會怎麼問，並說明證據從哪來",
  "分發不是靠人逛目錄，是靠 host 在一堆 connector 裡挑。tool 描述就是分發面：沒有使用者語彙，對不上提問；沒有取證指示，host 會用空證據呼叫，然後得到一個看起來沒用的答案。",
  () => {
    const findings = [];
    const source = readFileSync(join(rootDir, "apps/mcp-server/src/toolDefinitions.js"), "utf8");

    // Read the live definitions rather than the file text: a description
    // assembled from concatenated string literals is invisible to a regex.
    const listed = [...source.matchAll(/^\s{4}name:\s*"([a-z_]+)"/gm)].map((m) => m[1]);
    const deprecated = new Set(
      [...source.matchAll(/name:\s*"([a-z_]+)"[\s\S]{0,900}?deprecated:\s*true/g)].map((m) => m[1])
    );
    const exposed = listed.filter((name) => !deprecated.has(name));

    const blocks = new Map();
    for (const name of exposed) {
      const start = source.indexOf(`    name: "${name}",`);
      const next = source.indexOf("\n  {\n", start + 1);
      blocks.set(name, source.slice(start, next === -1 ? source.length : next));
    }

    for (const [name, block] of blocks) {
      const description = block.match(/description:\s*([\s\S]*?)\n\s{4}inputSchema/)?.[1] || "";

      if (!/Use this for|Use this after/.test(description)) {
        findings.push(`${name} 的描述沒有觸發語句（Use this for …）——host 無從得知使用者會怎麼問`);
      }

      // Exempt: the tools that have no `evidence` input at all. Plan-write
      // tools take history, not physiology; evidra_decide_exercise_substitution
      // decides from the movement plus the constraints the user states, and
      // reads no recovery or load signal. Requiring the instruction of them
      // was what put a parameter that does not exist into a public tool
      // description. Everything else must still say where the evidence comes
      // from.
      const needsEvidence = !["evidra_preview_adjust_plan", "evidra_commit_adjust_plan", "evidra_decide_exercise_substitution"].includes(
        name
      );
      if (needsEvidence && !/`evidence`/.test(description)) {
        findings.push(`${name} 的描述沒有說明證據從哪來`);
      }

      // A description that points at a tool nobody serves sends the host
      // somewhere that does not exist.
      for (const [, referenced] of description.matchAll(/\b((?:get|search|list|decide|assess|generate|preview|commit|recommend)_[a-z_]+)\b/g)) {
        if (!exposed.includes(referenced)) {
          findings.push(`${name} 的描述指向 ${referenced}，那不在對外清單上`);
        }
      }
    }

    return findings;
  }
);

// ---------------------------------------------------------------------------
// G3 — 承諾 A：決策自我解釋
// ---------------------------------------------------------------------------

gate(
  "G3",
  "每個 tool 的輸出契約仍帶得動自我解釋",
  "承諾 A。少一個 confidence 或 limits，決策就從「可被質疑」退化成「請相信我」。",
  () => {
    const findings = [];

    for (const [tool, required] of Object.entries(SELF_EXPLANATION)) {
      const contractPath = `schemas/tools/${tool}.output.json`;
      if (!has(contractPath)) {
        findings.push(`${contractPath} 不存在`);
        continue;
      }
      const properties = readJson(contractPath).properties || {};
      const missing = required.filter((field) => !(field in properties));
      if (missing.length > 0) {
        findings.push(`${contractPath} 缺 ${missing.join("／")}`);
      }
    }

    return findings;
  }
);

// ---------------------------------------------------------------------------
// G4 — Decision ≠ Recommendation：五種決策型別三處一致
// ---------------------------------------------------------------------------

gate(
  "G4",
  "決策型別在引擎、契約、對外文件三處一致",
  "user-journey 是對外承諾。它畫的決策型別若跟引擎產得出來的不同，就是在賣一個不存在的產品。",
  () => {
    const findings = [];

    const models = read("packages/decision-engine/src/models.js");
    const engineTypes = JSON.parse(
      /export const DECISION_TYPES = (\[[^\]]*\])/.exec(models)[1].replace(/'/g, '"')
    );

    const contractTypes = readJson("schemas/tools/evidra_decide_session.output.json").properties.decision.properties.type.enum;

    const journey = read("docs/user-journey.html");
    const journeyTypes = engineTypes.filter((type) => new RegExp(`<code>${type}</code>`).test(journey));

    for (const type of engineTypes) {
      if (!contractTypes.includes(type)) findings.push(`evidra_decide_session 契約缺決策型別 ${type}`);
      if (!journeyTypes.includes(type)) findings.push(`docs/user-journey.html 沒有提到決策型別 ${type}`);
    }
    for (const type of contractTypes) {
      if (!engineTypes.includes(type)) findings.push(`契約宣告了引擎產不出來的決策型別 ${type}`);
    }

    // from → to 是決策的定義，不是選配欄位。
    if (!/action/.test(read("schemas/tools/evidra_decide_session.output.json"))) {
      findings.push("evidra_decide_session 契約沒有 action，決策退化成推薦");
    }

    return findings;
  }
);

// ---------------------------------------------------------------------------
// G5 — 一個來源要算「讀得懂」，四件事缺一不可
// ---------------------------------------------------------------------------

gate(
  "G5",
  "有 parser 的來源，registry／source schema／scenario 都在",
  "schemas/README 自己定的規則：加一個平台 = registry 映射 ＋ source schema ＋ parser ＋ scenario。少了 source schema，parser 就沒有可對帳的契約。",
  async () => {
    const findings = [];
    const registry = read("packages/evidence/src/schemaRegistry.js");
    const vendors = [...registry.matchAll(/^\s{2}([a-z_]+):\s*\{/gm)].map((m) => m[1]);

    const parserDirs = readdirSync(join(rootDir, "packages/connectors/src/providers"));
    const scenarioFiles = readdirSync(join(rootDir, "eval/scenarios"));
    const sourceSchemas = has("schemas/sources") ? readdirSync(join(rootDir, "schemas/sources")) : [];

    for (const dir of parserDirs) {
      const vendor = dir.replace(/-/g, "_");
      const declared = vendors.some((name) => name === vendor || name.startsWith(`${vendor}_`));
      if (!declared) findings.push(`packages/connectors/.../${dir} 有 parser，但 schemaRegistry 沒有對應宣告`);
      if (!sourceSchemas.some((file) => file.startsWith(dir.split("-")[0]))) {
        findings.push(`${dir} 有 parser，但 schemas/sources/ 沒有原始格式契約`);
      }
      if (!scenarioFiles.some((file) => file.startsWith(dir.split("-")[0]))) {
        findings.push(`${dir} 有 parser，但 eval/scenarios/ 沒有匯出形狀場景`);
      }
    }

    return findings;
  }
);

// ---------------------------------------------------------------------------
// G6 — 寫死的日曆日不得回來
// ---------------------------------------------------------------------------

gate(
  "G6",
  "runtime 原始碼裡沒有寫死的日曆日",
  "P5。DEFAULT_DATE = \"2026-07-23\" 這類常數不會壞掉，只會每天錯得更多一點——沒有測試會叫。",
  () => {
    const findings = [];
    const roots = ["packages", "apps"];
    const stack = roots.map((dir) => join(rootDir, dir));

    while (stack.length > 0) {
      const current = stack.pop();
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const full = join(current, entry.name);
        if (entry.isDirectory()) {
          if (["test", "node_modules", "fixtures"].includes(entry.name)) continue;
          stack.push(full);
          continue;
        }
        if (!entry.name.endsWith(".js")) continue;
        const text = readFileSync(full, "utf8");
        const lines = text.split("\n");
        for (const match of text.matchAll(/"(\d{4}-\d{2}-\d{2})"/g)) {
          const lineNumber = text.slice(0, match.index).split("\n").length;
          const line = lines[lineNumber - 1];
          const relative = full.slice(rootDir.length + 1);

          if (/^\s*(\/\/|\/\*|\*)/.test(line)) continue; // 註解裡的例子不算

          // 找的是「被當成日期用的預設值」，不是所有長得像日期的字串。MCP 的
          // protocolVersion 就是 2025-06-18 這種形狀，它是版本識別碼不是日曆日。
          const isFallback = line.includes("||");
          const namesADate = /\b(date|day|asOf|since|until|start)\b/i.test(line);
          if (!isFallback && !namesADate) continue;

          findings.push(`${relative}:${lineNumber} 寫死日曆日 ${match[1]}`);
        }
      }
    }

    return findings;
  }
);

// ---------------------------------------------------------------------------
// G7 — D-LLM／D-DATA：系統內不含 LLM，也不落地健康資料
// ---------------------------------------------------------------------------

gate(
  "G7",
  "系統內沒有 LLM，也沒有把健康資料寫下來",
  "D-LLM 與 D-DATA。這兩條一旦破，賣的東西就從「確定性的領域智慧」變成「另一個包了 API 的 wrapper」與「資料湖」。",
  () => {
    const findings = [];

    const pkg = readJson("package.json");
    for (const field of ["dependencies", "devDependencies"]) {
      const names = Object.keys(pkg[field] || {});
      const llm = names.filter((name) => /openai|anthropic|langchain|llama|gemini/i.test(name));
      if (llm.length > 0) findings.push(`package.json ${field} 引入了 LLM 套件：${llm.join("、")}`);
    }

    const stack = [join(rootDir, "packages"), join(rootDir, "apps")];
    while (stack.length > 0) {
      const current = stack.pop();
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const full = join(current, entry.name);
        if (entry.isDirectory()) {
          if (["test", "node_modules"].includes(entry.name)) continue;
          stack.push(full);
          continue;
        }
        if (!entry.name.endsWith(".js")) continue;
        const text = readFileSync(full, "utf8");
        const relative = full.slice(rootDir.length + 1);
        if (/api\.(openai|anthropic)\.com|generativelanguage\.googleapis/.test(text)) {
          findings.push(`${relative} 直接呼叫 LLM API`);
        }
        if (/writeFile|createWriteStream/.test(text) && !relative.startsWith("packages/db/")) {
          findings.push(`${relative} 在 runtime 路徑寫檔——確認寫的不是使用者的健康證據`);
        }
      }
    }

    return findings;
  }
);

// G8 — 對外文字不用內部詞彙，也不從「我們不做什麼」開頭
//
// 存在的理由是實測出來的，不是預防性的。2026-08-06～07 一整天，使用者連續抓到六件
// 事，沒有一件是程式錯，全部是文字：失敗訊息被模型當人話唸給使用者聽、`limits` 的語
// 氣像在推責任、送審文案寫得準卻沒人看得懂、擴充功能的描述說「All computation is
// performed on the server」——那句話對一個裝在自己電腦上的東西來說，意思是反的。
//
// 每一次那六件事發生時，368 個測試與其餘七條 gate 全綠。它們比對的是數字與宣稱是否
// 一致，沒有一條會讀一句話然後問「人看了會怎麼想」。這條補的就是那個洞，補得很粗
// ——它只認得字串，認不得語氣——但它認得的那幾個字，是每一次都真的漏出去的那幾個。
gate(
  "G8",
  "使用者讀得到的文字裡沒有內部詞彙",
  "九條 gate 都不讀敘述句。這條只讀敘述句。",
  () => {
    const findings = [];

    // 每一項都出現在真的漏出去過的句子裡。
    const banned = [
      [/\bcaller[- ]supplied\b/i, "caller-supplied——讀者不知道 caller 是他的 AI 助理"],
      [/\bthe caller\b/i, "the caller——同上，對外要說 your assistant 或 you"],
      [/from\s*(->|→)\s*to/i, "from -> to——內部記法，對外要講成做了什麼（keep／ease／swap／move）"],
      [/\bsemantic fitness layer\b/i, "Semantic Fitness Layer——內部套件邊界的名字"],
      [/computation is performed on the server/i, "「computation is performed on the server」——對裝在自己電腦上的擴充功能來說，這句話意思是反的"],
      [/\btraining state to the next\b/i, "「transition from the current training state to the next」——已判定沒人看得懂"],
      [/\bnever silently inferred\b/i, "silently inferred——內部用語，對外要講具體會發生什麼"]
    ];

    // 只掃使用者或審閱者真的會讀到的欄位，不掃程式註解與內部文件。
    const manifest = JSON.parse(read("manifest.json"));
    const server = JSON.parse(read("server.json"));
    const surfaces = [
      ["manifest.description", manifest.description],
      ["manifest.long_description", manifest.long_description],
      ["server.json description", server.description],
      ...(manifest.tools || []).map((tool) => [`manifest.tools[${tool.name}]`, tool.description])
    ];

    for (const [where, text] of surfaces) {
      if (!text) continue;
      for (const [pattern, why] of banned) {
        if (pattern.test(text)) findings.push(`${where}: ${why}`);
      }
    }

    return findings;
  }
);

// ---------------------------------------------------------------------------

const resolved = [];
for (const result of results) {
  resolved.push({ ...result, findings: await result.findings });
}

console.log("\n階段任務完成審查");
console.log("==================\n");

let failed = 0;
for (const { id, title, why, findings, error } of resolved) {
  if (error) {
    failed += 1;
    console.log(`✖ ${id}  ${title}`);
    console.log(`    gate 自己壞了：${error.message}\n`);
    continue;
  }
  if (findings.length === 0) {
    console.log(`✔ ${id}  ${title}`);
    continue;
  }
  failed += 1;
  console.log(`✖ ${id}  ${title}`);
  console.log(`    ${why}`);
  for (const finding of findings) console.log(`    · ${finding}`);
  console.log();
}

console.log();
if (failed > 0) {
  console.log(`${failed} 條 gate 未通過。這些是宣稱與現況的落差，不是待辦功能。\n`);
  console.log("需要人判斷的那一半（GPT-6 判準、Decision ≠ Recommendation、三條紀律）：");
  console.log("docs/phase-review.md\n");
  process.exit(1);
}

console.log("全部通過。接著走 docs/phase-review.md 的判斷題——機械 gate 驗不到定位漂移。\n");
