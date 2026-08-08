#!/usr/bin/env node
// Copyright (c) 2026 Henry Yeh. All rights reserved.
// Evidra — proprietary. See LICENSE at the repository root.

/**
 * 發布前／上架前的對帳 —— 對「已發布的那顆」，不對 working tree。
 *
 *   npm run review:release
 *
 * `review:phase` 問的是「文件與程式碼一致嗎」，全部在本機工作目錄上跑。這支問的是
 * 另一個問題，而那個問題在 2026-08-07 之前沒有任何東西在問：
 *
 *   使用者真的下載得到的那顆 .mcpb，和公開 repo 現在寫的那些話，對得起來嗎？
 *
 * 為什麼需要分開一支：`manifest.json` 的 `documentation` 與 `privacy_policies` 指向
 * `blob/main/...`，所以讀者永遠讀到最新文件、卻裝到最後一個 release。兩者分離是
 * 預設狀態。同一天發生過兩次它造成的錯：對外 README 描述了一個當天才進 schema、
 * 還沒出貨的欄位；而 PRIVACY.md 對「已編譯檔案」逐條做的宣稱，從發布到那天為止
 * 沒有任何人拿真正的 archive 核對過一次。
 *
 * PRIVACY.md 特別值得整支工具存在：它不是泛泛的隱私聲明，它明寫「searching it for
 * node:http, node:net, node:dgram or fetch( returns nothing」——那是一句可執行的
 * 斷言，寫給讀者自己驗的。既然寫得出來，就該由我們每次先驗。
 *
 * 需要網路（`gh` 下載 release、抓公開 repo 的兩份文件），所以不進 `npm test`。
 * 這是發布動作的一部分，不是每次存檔都要跑的東西。
 */

import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_REPO = "henryyeh182/evidra";

const checks = [];
function check(id, title, why, run) {
  checks.push({ id, title, why, run });
}

const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });

// ---------------------------------------------------------------------------

const serverJson = JSON.parse(readFileSync(join(rootDir, "server.json"), "utf8"));
const declaredVersion = serverJson.version;
const declaredSha = serverJson.packages?.[0]?.fileSha256;

let work = null;
let mode = null;
let archive = null;
let compiled = null;
let archiveList = "";
let bundledManifest = null;
let bundledPackage = null;

/**
 * 兩種時機，兩個 artifact。
 *
 * 這支原本只認「已經在 GitHub 上的那顆」，結果是**發布前根本跑不動**：版號一 bump，
 * `gh release download v0.3.8` 直接 not found，五條檢查一條都到不了。而發布前正是
 * 最需要它的時候——那時候還來得及修。
 *
 * 所以先看 `server.json` 宣告的版本有沒有對應的 release：
 *   有 → 驗**已發布**的那顆（發布後對帳，也是平常想確認現況時跑的）
 *   沒有 → 驗 `npm run pack` 剛產出的 `dist/evidra.mcpb`（發布前對帳）
 *
 * 兩種模式都會在標頭印出**驗的是哪一顆**。這件事不能靠讀的人自己推——一份說
 * 「全部通過」卻沒說驗了什麼的輸出，比不跑更糟。
 */
function loadArtifact() {
  work = mkdtempSync(join(tmpdir(), "evidra-release-"));
  const tag = `v${declaredVersion}`;

  try {
    sh("gh", ["release", "download", tag, "--repo", PUBLIC_REPO, "--pattern", "*.mcpb", "--dir", work], {
      stdio: ["ignore", "pipe", "ignore"]
    });
    archive = join(work, "evidra.mcpb");
    mode = "published";
  } catch {
    archive = join(rootDir, "dist/evidra.mcpb");
    mode = "local";
    // 本機那顆不存在就是紅的：這代表還沒 `npm run pack`，沒有東西可驗。
    readFileSync(archive);
  }

  sh("unzip", ["-oq", archive, "-d", join(work, "x")]);
  archiveList = sh("unzip", ["-l", archive]);
  compiled = readFileSync(join(work, "x/dist/evidra-server.mjs"), "utf8");
  bundledManifest = JSON.parse(readFileSync(join(work, "x/manifest.json"), "utf8"));
  bundledPackage = JSON.parse(readFileSync(join(work, "x/package.json"), "utf8"));
}

// ---------------------------------------------------------------------------

check(
  "R1",
  "GitHub 上的最新 release 就是 server.json 宣告的版本",
  "registry 與送審表單指向的是 latest。宣告一個版本、發布另一個，兩邊會各自對到不同的東西。",
  () => {
    const findings = [];
    const latest = sh("gh", ["release", "view", "--repo", PUBLIC_REPO, "--json", "tagName", "--jq", ".tagName"]).trim();
    if (latest === `v${declaredVersion}`) return findings;

    // 發布前這是預期狀態，不是錯——但要講出來，因為它代表底下四條驗的是還沒出去的東西。
    if (mode === "local") {
      console.log(`    （發布前：GitHub 的 latest 仍是 ${latest}，底下驗的是本機 dist/evidra.mcpb）`);
      return findings;
    }
    findings.push(`server.json 宣告 v${declaredVersion}，GitHub 的 latest 是 ${latest}`);
    return findings;
  }
);

check(
  "R2",
  "下載回來的 .mcpb 與 server.json 的 sha256 相符，且內含版本一致",
  "checksum 是我們請使用者去 registry 核對的那一串。它對不上，那段安裝說明就是假的。",
  () => {
    const findings = [];
    const actual = createHash("sha256").update(readFileSync(archive)).digest("hex");
    if (actual !== declaredSha) {
      findings.push(
        mode === "published"
          ? `下載的 sha256 ${actual}，server.json 宣告 ${declaredSha}`
          : `本機 dist/evidra.mcpb 的 sha256 ${actual} 與 server.json 的 ${declaredSha} 不符——` +
            `重打包之後要跑 stamp-release，否則發布出去的 checksum 會是錯的`
      );
    }
    if (bundledManifest.version !== declaredVersion) {
      findings.push(`archive 內 manifest.json 是 ${bundledManifest.version}，server.json 是 ${declaredVersion}`);
    }
    return findings;
  }
);

/**
 * PRIVACY.md 自己列出的搜尋詞，逐字照抄過來。
 *
 * 政策原文：「searching it for `node:http`, `node:net`, `node:dgram` or `fetch(`
 * returns nothing」與「no `writeFile`, no `appendFile`, no `createWriteStream`,
 * no `mkdir`」。政策叫讀者這樣搜，我們就先這樣搜。
 */
const PROMISED_ABSENT = [
  "node:http",
  "node:https",
  "node:net",
  "node:dns",
  "node:dgram",
  "node:tls",
  "node:child_process",
  "fetch(",
  "writeFile",
  "appendFile",
  "createWriteStream",
  "mkdir"
];

check(
  "R3",
  "已編譯檔的行為與 PRIVACY.md 逐條相符",
  "PRIVACY.md 寫的不是泛泛聲明，是一組可執行的斷言。寫得出來就該每次先驗。",
  () => {
    const findings = [];
    for (const token of PROMISED_ABSENT) {
      if (compiled.includes(token)) {
        findings.push(`已編譯檔含 "${token}"，但 PRIVACY.md 宣稱搜不到——政策與出貨物不符`);
      }
    }
    if (Object.keys(bundledPackage.dependencies || {}).length > 0) {
      findings.push(`archive 的 package.json 有 runtime 依賴，PRIVACY.md 宣稱 zero runtime dependencies`);
    }
    if (archiveList.includes("node_modules")) {
      findings.push("archive 內含 node_modules，與「no third-party code」牴觸");
    }
    return findings;
  }
);

/**
 * build-mcpb skill 的 `references/local-security.md` 出貨前清單。
 *
 * 那份檔在 SKILL.md 裡標著 "mandatory reading, not optional"，而 v0.3.7 出貨時
 * 它沒有被讀過，這幾項是事後才第一次跑的。跑過一次不算流程，所以搬進來。
 */
check(
  "R4",
  "出貨的檔案通過 local-security 出貨前清單",
  "MCPB 沒有沙箱，行程拿的是使用者的完整權限。平台不會替我們擋任何一件。",
  () => {
    const findings = [];
    if (/\bexec\(|execSync|\bspawn\(|child_process/.test(compiled)) {
      findings.push("已編譯檔具備另起行程的能力（exec／spawn／child_process）");
    }
    if (/\beval\(|new Function\(/.test(compiled)) {
      findings.push("已編譯檔含 eval／new Function");
    }
    for (const hint of ["readOnlyHint", "destructiveHint"]) {
      if (!compiled.includes(hint)) findings.push(`已編譯檔沒有 ${hint} 標註`);
    }
    // 讀檔路徑必須是寫死的字面值。任何一個由呼叫端傳進來的路徑都是路徑穿越的入口。
    const reads = [...compiled.matchAll(/\b[A-Za-z_$][\w$]{0,3}\(\s*("?)([^",)]{0,80})\1\s*[,)]/g)];
    const literalPaths = [...compiled.matchAll(/\b[A-Za-z_$][\w$]{0,3}\("(data\/[^"]+|package\.json)"/g)].length;
    if (literalPaths === 0 && reads.length > 0) {
      findings.push("找不到任何寫死的資料路徑——讀檔改成動態組路徑了嗎？請人工確認");
    }
    return findings;
  }
);

check(
  "R5",
  "公開 repo 的 README 與 PRIVACY 沒有描述這顆沒有的東西",
  "文件連結跟著 main、bundle 停在 release。這個落差是預設狀態，所以每次發布都要對一次。",
  () => {
    const findings = [];
    const raw = (path) =>
      sh("gh", ["api", `repos/${PUBLIC_REPO}/contents/${path}`, "--jq", ".content"])
        .split("\n")
        .join("");
    const decode = (b64) => Buffer.from(b64, "base64").toString("utf8");

    const readme = decode(raw("README.md"));
    const privacy = decode(raw("PRIVACY.md"));

    // 對外宣告的版本必須是這一版。
    if (!readme.includes(`v${declaredVersion}`)) {
      findings.push(
        `evidra/README.md 沒有提到 v${declaredVersion}——` +
          (mode === "local"
            ? "發布前就要改好，否則 release 一出去，公開文件講的就是上一版"
            : "讀者對不到自己裝的是哪一版")
      );
    }

    // 對外列出的 tool 必須真的在出貨物裡。少一個是漏做，多一個是宣稱不存在的功能。
    for (const match of readme.matchAll(/`(evidra_[a-z_]+)`/g)) {
      if (!compiled.includes(`"${match[1]}"`)) {
        findings.push(`evidra/README.md 提到 ${match[1]}，但 v${declaredVersion} 的出貨物裡沒有這個 tool`);
      }
    }

    // PRIVACY.md 指名要搜的那幾個詞，必須真的還在政策裡——政策改寫時最容易掉的
    // 就是這種「叫讀者自己驗」的句子，而掉了不會有人發現。
    for (const token of ["node:http", "fetch(", "writeFile"]) {
      if (!privacy.includes(token)) {
        findings.push(`evidra/PRIVACY.md 不再指名 "${token}"——那句可執行的斷言被改掉了，R3 就失去對照`);
      }
    }

    return findings;
  }
);

// ---------------------------------------------------------------------------

console.log("\n發布前對帳 —— 對已發布的那顆");
console.log("================================\n");
let failed = 0;
try {
  loadArtifact();
} catch (cause) {
  console.log(`✖ 沒有可驗的 artifact：${cause.message.split("\n")[0]}`);
  console.log("\n先 `npm run pack`，或確認 release 存在。取不到就是紅的，不是跳過。\n");
  process.exit(1);
}

console.log(`  server.json 宣告：v${declaredVersion}`);
console.log(`  公開 repo：${PUBLIC_REPO}`);
console.log(
  mode === "published"
    ? `  驗的是：GitHub release v${declaredVersion} 下載回來的 evidra.mcpb\n`
    : `  驗的是：本機 dist/evidra.mcpb（v${declaredVersion} 尚未發布 —— 發布前對帳）\n`
);

for (const { id, title, why, run } of checks) {
  let findings = [];
  try {
    findings = run() || [];
  } catch (cause) {
    failed += 1;
    console.log(`✖ ${id}  ${title}`);
    console.log(`    檢查自己壞了：${cause.message.split("\n")[0]}\n`);
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

if (work) rmSync(work, { recursive: true, force: true });

console.log();
if (failed > 0) {
  console.log(`${failed} 條未通過。已發布的東西與對外說法不一致——修好再上架。\n`);
  process.exit(1);
}
console.log(
  mode === "published"
    ? "全部通過。已發布的那顆與公開文件對得上。\n"
    : "全部通過。這顆可以發布——發布後再跑一次，模式會切成 published。\n"
);
