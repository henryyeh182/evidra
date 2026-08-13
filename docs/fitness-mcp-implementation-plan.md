# Pacevera — Product & Implementation Plan

> 更新：2026-08-13
>
> 本文件是 Pacevera 的產品終局、發行現況與開工順序正本。
> 歷史判斷、舊代號與已淘汰方案保留在
> [fitness-mcp-implementation-plan-history.md](fitness-mcp-implementation-plan-history.md)，不再放進主閱讀路徑。
>
> 整合來源：
> [Evidra_Decision_Engine_開發計畫.md](Evidra_Decision_Engine_開發計畫.md) 的 Decision Infrastructure／九層能力，
> 以及 [pacevera-product-strategy.md](pacevera-product-strategy.md) 的客群、隱私、部署與產品頁策略。
> 兩份來源若與目前實作或已定版 release 衝突，以本文件與
> [release-plan-v0.5.0.md](release-plan-v0.5.0.md) 為準。

---

## 1. 產品最終樣貌

### 1.1 一句話

> **Pacevera 是 local-first、deterministic、可解釋的運動科學決策基礎設施：AI 負責理解與溝通，Pacevera 根據使用者持續累積的 Evidence，決定今天的訓練應該從什麼變成什麼。**

對外英文主張：

> **Your AI coach should know how you are today—not own your health history.**

Pacevera 最終不是另一個健身聊天機器人、健康 dashboard 或穿戴資料倉庫。它是一顆可被 Claude、ChatGPT、Gemini、教練系統或企業軟體呼叫的 Exercise Science Decision Engine。

### 1.2 使用者最後得到的體驗

```text
穿戴／健康資料／訓練紀錄／原定課表
                ↓
使用者控制的 Evidence 與縱向狀態
                ↓
Pacevera Decision Engine + versioned Rule Packages
                ↓
今天維持／調整／替代／延後／進階什麼
                ↓
from → to + reason + missing signals + confidence + rule trace
                ↓
使用者採用／拒絕／回報結果，形成下一次決策的連續脈絡
```

首次成功體驗固定為：**10 分鐘內完成一次「原定課表 → 今日調整後課表」的可追溯決策，並看得懂資料在哪裡、AI 看到了什麼、哪些訊號缺失。**

即使換對話視窗、換 AI host 或換裝置，Pacevera 對同一位使用者的 state、plan 與 decision history 不應歸零；同一份 Evidence 與版本組合必須產生相同的結構化決策，AI 只改變表達方式。

### 1.3 最終產品由六個部分組成

| 部分 | 最終責任 |
|---|---|
| Evidence layer | 將 Apple Health、Garmin、Google Health、Oura、WHOOP、Strava、手動輸入等資料轉成 vendor-neutral Evidence，明確標示來源、時間、freshness、coverage 與缺值。 |
| Semantic state | 保存可重算的 readiness、fatigue、load、injury constraints、plan 與 longitudinal state，不把原始歷史全部交給 AI。 |
| Decision Engine | 固定執行 condition evaluation、conflict resolution、priority arbitration 與 effect combination；LLM 不參與決策計算。 |
| Rule Packages | 以 `base_rules` 與未來 domain packages 管理 Rule Library、engine parameters、evidence packets、provenance、review 與 regression corpus。 |
| Explainability & learning | 每次決策都有 decision ID、Decision Graph、Rule／Evidence／Source／Version trace；結果回報是可選、可刪除、由使用者控制的資料。 |
| Interfaces & deployment | 先以 Desktop MCPB 交付，再延伸到 user-controlled private engine、受控 mobile access、REST／SDK 與 Team／Enterprise 私有部署。 |

### 1.4 三種部署形態與不可混用的隱私承諾

| 形態 | 最終用途 | 可以承諾什麼 |
|---|---|---|
| Local desktop | 個人使用者在自己的電腦安裝 MCPB／local engine。 | 原始 Evidence、token、state 與 plan 留在使用者控制的電腦。 |
| User-controlled private | 教練、隊伍或企業部署在自己的裝置、VPC 或 on-prem 環境。 | 資料留在客戶控制的環境，並有角色、稽核、保留與刪除政策。 |
| Hosted remote | 提供手機或低門檻 remote host 接入。 | 只能承諾資料最小化、transient processing 與不留存；不能宣稱 Evidence 沒離開使用者電腦。 |

Remote MCP 是 access channel，不是產品護城河，也不能先於 local/private 的資料契約上線。

### 1.5 核心護城河

Pacevera 的護城河是三者合一，而不是 MCP transport 或單一 AI 平台：

1. **Evidence Model**：不同來源進入同一個可稽核的語言。
2. **Rule Library / Rule Packages**：每個門檻、參數與效果都有版本、來源、限制及人工審核紀錄。
3. **Decision Graph**：保存哪些規則觸發、哪些被壓過、最後如何形成 `from → to`。

長期治理層再把 Decision → Outcome → Review → Rule update 串起來；LLM 可協助整理候選證據，不能自行核准新規則。

Pacevera 的核心流程固定為：**Evidence → State → Decision → Action → Outcome**。

### 1.6 目標客群與商業順序

1. 重視隱私、已有穿戴資料且正在使用 AI 的 serious athletes。
2. 個人教練與小型訓練團隊。
3. 運動隊、高績效團隊與企業 private deployment。
4. 在明確 consent 與責任邊界內的醫療／復健合作；產品仍不宣稱診斷或治療。

定價與 Free／Pro／Enterprise 邊界要在真實使用者驗證後定案。現階段不以 connector 數量、tool call 次數或 Rule 數量作為價值代理，也不先做 marketplace、白牌 AI coach 或健康資料廣告模式。

### 1.7 競品與視覺參考：AthleteSpace

[AthleteSpace](https://athletespace.ai/) 是 Pacevera 的相鄰競品與 Phase 0.5 視覺參考。它把
training、recovery、readiness、strain 與 HRV／sleep 等訊號集中成一個面向運動者的
AI endurance experience，產品方向接近 Pacevera 的 **Evidence → State → Action**：
先讀取身體與訓練訊號，形成目前狀態，再把狀態轉成下一步訓練行動。

Phase 0.5 可以參考 AthleteSpace 的資訊架構、狀態卡片、指標層次、視覺節奏與從資料到
行動的導覽方式，但不複製其「AI coach／dashboard」定位。Pacevera 必須把辨識度加深在
**deterministic decision engine**：

- Evidence 要顯示來源、時間窗、freshness、coverage 與缺失訊號。
- State 要顯示 readiness、fatigue、load、injury constraint 與 plan context 如何形成。
- Decision 要表達保留、調整、替代、延後或進階的確定性判斷。
- Action 要以明確的 `from → to` 呈現，而不是泛用 recommendation 或聊天回答。
- 每個 Decision 都要能展開 reason、confidence、triggered／suppressed rules、Rule → Evidence →
  Source → Version trace，並可在後續接收 Outcome。
- UI 可以有 AI coach 的入口，但 AI 只負責理解與溝通；畫面上的決策結果必須來自可重現、
  版本化、可稽核的 Rule／Engine 執行。

視覺驗證的成功標準不是「看起來像另一個健康 dashboard」，而是使用者在數秒內看懂：
**今天原本要做什麼、哪些 Evidence 改變了判斷、Pacevera 確定決定要改成什麼，以及這個
決定能否被追溯。**

---

## 2. 已完成與發行現況

### 2.1 已發行：Pacevera v0.5.0

v0.5.0 已於 2026-08-11 發行，是目前公開可安裝的 Desktop MCPB 基線。

| 項目 | 已發行內容 |
|---|---|
| Product / MCPB | `0.5.0` |
| Decision Engine | `1.6.0` |
| Legacy Rule Library | `1.4.0`；當時尚無可獨立識別的 `base_rules` package release line。 |
| Public tools | 10 個：既有 6 個 decision／planning tools，加上 `get_evidence_coverage`、`explain_decision`、`submit_outcome`、`generate_workout`。 |
| Decision capability | Deterministic session／plan／substitution decisions、injury-first arbitration、coverage／confidence、`decisionBasis` 與規則溯源。 |
| Evidence capability | 6 家 provider parser；Apple Health／Garmin／Google Health／Strava 已用真實資料形狀驗證，Oura／WHOOP 仍只有官方規格與模擬 fixture。 |
| Delivery | Local stdio MCPB；Streamable HTTP 為開發能力，不代表 hosted remote 已上線。 |

### 2.2 v0.5.0 與目前 main 已完成

- `get_evidence_coverage`、`explain_decision`、`submit_outcome` 三個 support tools。
- 所有 decision tools 的 `decisionId` 與共用 bounded／TTL Decision Trace Registry。
- bounded outcome event registry，以及 cross-conversation athlete continuity／本機 state store 的工程基礎。
- `base_rules` package boundary、manifest、checksum、Engine compatibility、validate、dry-run、明確 install、immutable versions、active pointer 與 rollback。
- `base_rules@1.1.0` 的五個 evidence packets，以及不誇大文獻支持範圍的 provenance／limitations。
- Decision Harness、Plan Harness、substitution harness、37-case behavioral regression baseline、package diff gate 與 release-install smoke。
- 本機 Decision Graph viewer，可檢查 triggered／suppressed rules 與版本差異。
- `generate_workout` 已整合至 main，包含 picker、schema、handler、public tool metadata 與 tests；它沿用 active `base_rules`，沒有啟用 draft package。
- prompt-injection guard 已整合至 Decision Harness。
- unified release manifest、MCPB／Remote-ready build scaffolding、artifact verification 與 rollback gate 已落地。
- Rule Review Schema 與 released package 的 machine-checkable `governanceReview` gate 已落地；released package 必須有 approved review、review scope、proposer／reviewer identity，以及零 Decision／Graph regression diff。
- LLM assistance boundary 已定義並以 contract／test 固定：文獻只能產生 `rule-candidate` draft，不能進 runtime；既有 Rule 的白話解釋只能讀取已載入的 Rule／`decisionBasis` metadata。
- provider-token rejection、hosted data boundary、authorization／governance 的 source-level foundation；這些不等於 hosted service 已可用。

### 2.3 目前仍未完成或未宣稱完成

- `single_workout_rules@0.1.0` 仍是 draft；EVD-R-013～015 尚未接 runtime。`generate_workout` 目前沿用 Decision Engine `1.6.0` 與 active `base_rules` 做個人化，因此不得宣稱 draft package 已啟用。
- Remote image build／smoke 尚未在本機完成，因 Docker daemon 不可用；local release gate 只能以 `--skip-remote` 執行。
- `review:phase` 的 G2／G2b／G9 已修正並通過；目前機械 gate 13/13 全綠。
- 2026-08-13 在可監聽 localhost 的環境重跑完整 `npm test`：548 tests 全數執行、0 fail、0 skip，含先前受 sandbox EPERM 限制的 HTTP／authorization／privacy integration tests，以及同日完成的 Evidence Flow Story 1～6（含 Story 4）新增 31 個 tests（見 §5「Phase 2 - Story 2 詳細分解」）。舊版本紀錄的「5 個未能執行、其餘 512 通過」是特定 sandbox 權限下的結果，不是固定上限；之後若在權限受限的環境重跑，數字可能再次不同，屆時應以當次實測為準，不沿用本行舊數字。
- 公開 privacy URL、release review 與 MCPB archive／published review 仍需收尾；`docs/privacy-deployment-contract.md` 是目前的 canonical implementation contract，不等同於已完成 hosted privacy policy。
- Outcome repository 已接入 user-controlled local engine：SQLite `outcome_records`、migration `0004`、`saveOutcome`／`listOutcomes` 與 local MCP injection 已完成；hosted MCP 仍維持 process-local/stateless，且尚未形成自動 Rule learning loop。
- Durable decision trace 已接入同一個 user-controlled SQLite：`decision_records`、local `explain_decision` restart recovery 與 user scope test 已完成；backup、export、delete 尚待補齊。

### 2.4 已發布的 v0.5.0 與 main 的落差

目前 main 在 v0.5.0 發布後仍有公開行為面的後續變更。這些變更不應被回溯描述成
v0.5.0 已具備；下一次正式 release 前，需重新打包並更新 release identity：

- `generate_workout` 的 public description／review contract 已在 main 補強。
- `outputSchemas.js`、`server.js` 與其他 public surface 可能比已發布 bundle 新；以
  `review:phase` 的 G9 實際 diff 為準，不把 main 文件直接當成已發布 bundle 的行為。

---

## 3. 下一版已定版：Pacevera v0.5.0

### 3.1 使用者看到的版本（已發行）

> **Pacevera v0.5.0，使用 Decision Engine v1.6.0 與 base_rules v1.1.0。**

這個 identity 已寫入 `package.json`、`manifest.json`、`server.json`、
`docs/release-version-lines.json` 與 root `release-manifest.json`；
`npm run release:validate` 目前通過。後續工作是補齊發行後驗證與文件一致性，不再把
v0.5.0 視為尚未 bump 的 release candidate。

從 v0.5.0 起，release gate 以三個 runtime identities 為準：

| Version line | v0.5.0 | 何時進版 |
|---|---:|---|
| Product / MCPB | `0.5.0` | tool surface、產品功能、bug fix、封裝或使用者可觀察行為改變。 |
| Decision Engine | `1.6.0` | condition evaluation、arbitration、effect combination 或 Engine output contract 改變。 |
| Rule Package(s) | `base_rules@1.1.0` | Rule Library、engine parameters、evidence packets、provenance 或 package lifecycle 的可觀察內容改變。 |

舊 `decisionBasis.libraryVersion` 暫留作相容欄位，但 Rule Library 不再是一條獨立 release line。歷史 release 仍保留該值，避免改寫已發布事實。

每次 MCPB release 都必須把 Product、Engine、所有 active Rule Package versions、checksums 與相容範圍寫入 [release-version-lines.json](release-version-lines.json)，並由 release gate 對實際 bundle 的 `initialize`、`tools/list` 與 decision output 核對。

### 3.2 v0.5.0 對外內容

- 既有 6 個 decision／planning tools。
- 新增 `generate_workout`，提供單次個人化 workout 的 `from → to` 結果。
- 新增 `get_evidence_coverage`、`explain_decision`、`submit_outcome`。
- 總計 10 個 public tools。
- 每次 decision 可回查 Rule → Evidence → Source → Version trace。
- 本機 continuity／state 能力只有在 privacy、retention、deletion 與 export 說法完成後才可出貨。
- `base_rules@1.1.0` package lifecycle、evidence packets、regression gate 與 rollback。
- Prompt-injection harness guard、完整 release smoke 與固定 runtime identity。

完整 release blocker 與功能歸屬見 [release-plan-v0.5.0.md](release-plan-v0.5.0.md)。在 blockers 關閉前，不先把 `package.json`、`manifest.json` 或 `server.json` bump 到 `0.5.0`。

---

## 4. 版本與發行更新機制（獨立工作流）

這是一條獨立於產品功能 Phase 的交付工作流，現在即開始實作。目標是讓目前的
Desktop `.mcpb` 與未來的 Remote MCP 共用同一份 Engine、Rule Packages、schemas、
tests 與 release identity；未來切換 deployment target 時，不重寫決策邏輯，也不建立
第二套版本系統。

### 4.1 目前基線：MCPB v0.5.0

目前已發行的 bundle identity 是：

```text
Pacevera MCPB 0.5.0
├── Decision Engine 1.6.0
└── base_rules 1.1.0
```

`.mcpb` 是完整 bundled release：Engine 與 active Base Rules 隨 bundle 發行，不在
runtime 自行下載或替換。更新流程是下載新版 bundle、驗證 checksum、重新安裝並重啟
MCP host。這個 offline 行為是 local privacy contract 的一部分，不實作隱藏式 updater。

### 4.2 下一版與 Remote 模式 A

若下一版同時修改 Engine 與 Base Rules，預定 identity 為：

```text
Release 0.6.0
├── Decision Engine 1.7.0
└── base_rules 1.2.0
```

但 Remote 化本身不強制 Engine 或 Rules 進版。若只是新增 Remote deployment target，
可以是同一組 `Engine 1.6.0 + base_rules 1.1.0`，分別產出 `.mcpb` 與 Remote image。

Remote 初期採模式 A：Engine 與 Base Rules 綁在同一個 immutable server release，
不做每個 request 的 rule download，也不做獨立 runtime rule registry。

```text
同一份 source release
├── pacevera.mcpb              （local stdio）
└── pacevera-server:<release>  （Remote MCP / HTTPS）
```

每個 Remote release 必須能回答：使用哪一版 Engine、哪一版 Base Rules、哪一個
content checksum、哪一個 git commit／image digest。部署採 immutable image、health
check、smoke test、canary／blue-green（具備時）與整體 rollback；不允許只替換 Engine
或只替換 Rules 而留下未驗證的組合。

### 4.3 共用 Release Manifest

建立單一 `release-manifest.json` 作為 `.mcpb` 與 Remote image 的 release identity：

```json
{
  "releaseVersion": "0.6.0",
  "engineVersion": "1.7.0",
  "libraryVersion": "1.2.0",
  "libraryChecksum": "sha256:<64 hex>",
  "gitCommit": "<commit>",
  "imageDigest": "<digest when remote>"
}
```

`imageDigest` 在 local bundle 可為 `null`。Product／MCPB version、Engine version、
active Rule Package version 與 checksum 必須由 release gate 核對，不允許只改其中一處。
所有 decision output 保留 `libraryVersion` 與 `engineVersion`，並逐步增加
`releaseVersion` 與 `libraryChecksum`，以支援重現、稽核與 rollback 後的診斷。

### 4.4 可直接排程的實作工作

| Story | 交付結果 | 完成條件 | 狀態 |
|---|---|---|---|
| Release Story 1 | Unified release manifest。 | 建立 manifest schema／loader；由 Product、Engine、active Rule Packages 產生；檢查版本、checksum、engine compatibility 與 git metadata。 | 完成 |
| Release Story 2 | Dual-target build。 | 同一份 source release 可產生 `.mcpb` 與 Remote-ready container image；兩者的 tool contract、Engine、Rules、schemas 與 manifest 相同。 | 進行中 |
| Release Story 3 | Runtime identity output。 | decision／read／trace output 帶有 release、engine、library identity；既有 `libraryVersion`／`engineVersion` 保持相容；tests 驗證 metadata 不漂移。 | 完成 |
| Release Story 4 | Release／rollback gate。 | CI 依序執行 tests、harness、package validation、bundle install smoke、Remote container smoke、checksum／manifest gate；image 可切回上一個完整 release。 | 進行中 |

#### Release Story 1 completion evidence — 2026-08-12

- Root `release-manifest.json` is generated from `package.json`, `manifest.json`, `ENGINE_VERSION` and the validated active `base_rules` package; it records release, engine, legacy library, package checksum, compatibility, and git commit identity.
- `release-manifest.schema.json` defines the shared release identity contract. `packages/release/src/index.js` loads and validates the manifest for source/runtime use; the bundle build inlines the same manifest content.
- `npm run release:validate` is a drift gate for product version, engine version, active package version/checksum/compatibility, and git metadata. Decision basis, trace versions, and MCP `initialize.serverInfo` now expose `releaseVersion` and `libraryChecksum` while preserving `libraryVersion` and `engineVersion`.
- Remote target scaffolding is present in `Dockerfile`, `apps/mcp-server/src/http-entry.js`, `scripts/build-remote-image.js`, and `scripts/smoke-remote-image.js`; the same source release builds the stdio bundle by default and the HTTP entrypoint with `BUNDLE_ENTRY=apps/mcp-server/src/http-entry.js`.
- `scripts/verify-release-artifacts.js` checks archive metadata, bundled `initialize`, and `tools/list`; `scripts/release-gate.js` runs package validation, dry-run regression, bundle build, and optional artifact／remote smoke. `scripts/rollback-remote-image.js` only verifies an immutable release-labelled image and does not mutate a mutable `latest` tag.
- Remote image build／smoke remains unexecuted locally because the Docker daemon is unavailable. Local release gate passed with `--skip-archive --skip-remote`; the archive gate also awaits the existing `mcpb` pack command completing.

### 4.5 Migration contract：MCPB → Remote

Migration 不是把本機 `.mcpb` 自動改成 Remote，而是保留兩個明確 deployment target：

| Target | Transport | 更新單位 | 資料邊界 |
|---|---|---|---|
| Local MCPB | stdio | 使用者重新安裝 bundle | 使用者本機 |
| Remote MCP | HTTPS MCP | server immutable release | Remote deployment／其 privacy contract |

兩者共用 MCP tool names、input／output schemas、decision contract、version metadata 與
regression suite。切換時由 host 設定改用 Remote endpoint；不做未經同意的自動切換，
也不假設 local state 可以自動搬到 Remote。若日後需要 state migration，另立明確的
export／import、consent、authentication 與 deletion workflow。

## 5. 由終局倒推的剩餘 Roadmap

狀態只使用：`待開始`、`進行中`、`Blocked`、`完成`。每個 Phase 固定四個 Story；Story 完成後保留結果摘要，細節移到 history。

### Phase 0 — 完成並發行 v0.5.0

目標：把目前已完成的能力變成一顆公開、可安裝、版本資訊一致的 MCPB。

| Story | 交付結果 | 完成條件 | 狀態 |
|---|---|---|---|
| Phase 0 - Story 1 | 整合 prompt-injection guard 與 `generate_workout`。 | tool、schema、manifest 與 tests 已在 main 一致；draft rules 不被誤啟用。 | 完成 |
| Phase 0 - Story 2 | 固定產品與隱私契約。 | 10 tools 的公開文件與 continuity 邊界大致完成；仍需補公開 privacy URL／發行文件收尾與一致性 review。 | 進行中 |
| Phase 0 - Story 3 | 產出 v0.5.0 release candidate。 | Product `0.5.0`／Engine `1.6.0`／`base_rules@1.1.0` 已寫入 runtime metadata；release manifest checksum 驗證通過。 | 完成 |
| Phase 0 - Story 4 | 通過 release gates 並上架。 | v0.5.0 已登錄為 released；G2／G2b／G9 已綠，但 localhost integration rerun、MCPB archive／published review 與 Remote smoke 尚未全部完成。 | 進行中 |

### Phase 0.5 — Decision Engine 視覺化 UI 原型

目標：從 2026-08-12 開始，建立一個可操作的視覺化 UI 原型，借鑑
[AthleteSpace](https://athletespace.ai/) 的資訊架構與視覺層次，將 Pacevera 的
Evidence → State → Decision → Action → Outcome 與 deterministic decision engine 變成
使用者一眼看懂的產品體驗。本階段是產品／視覺驗證，不改變 v0.5.0 的 runtime contract，
也不把 mock data 描述成已完成的 connector 或 private engine 能力。

| Story | 交付結果 | 完成條件 | 狀態 |
|---|---|---|---|
| Phase 0.5 - Story 1 | 視覺語言與頁面骨架。 | 定義 Evidence、State、Decision、Action、Outcome、Trace 的色彩、層級、卡片與狀態語言；完成 desktop-first 主畫面與 responsive 基本規則。 | 完成 |
| Phase 0.5 - Story 2 | Evidence → State → Decision → Action 主流程。 | 以一個「原定 Tempo Run → 今日調整」案例呈現來源訊號、狀態判斷、`from → to`、reason、confidence 與 missing signals。 | 完成 |
| Phase 0.5 - Story 3 | Deterministic Decision Graph。 | 可視化 triggered／suppressed rules、優先序／仲裁結果、Rule → Evidence → Source → Version trace；AI 對話不是主要視覺焦點。 | 完成 |
| Phase 0.5 - Story 4 | Outcome 與 prototype review。 | 能記錄採用／拒絕／結果回報的入口；以 3–5 位目標使用者或內部 reviewer 檢查「是否看懂今天為何改課表」，並記錄 AthleteSpace 可借鑑處及 Pacevera 必須保持的差異。 | 進行中 |

### Phase 0.5 completion evidence — 2026-08-12

- **Story 3**：`docs/pacevera-home.html` 的 Today’s Brief 以 `Why this changed · open Decision Trace` 開啟 drawer；Tempo Run → Moderate Run fixture 明確展示 `triggered`、`suppressed`、priority arbitration，以及 Rule → Evidence → Source → Version rows。Drawer 可由按鈕、背景點擊與 Escape 關閉，並在開啟時將 focus 移至 close control。
- **Story 4**：同一頁新增 prototype-only Outcome controls：`Adopted`、`Changed`、`Skipped` 與 perceived-effort slider。互動回饋明確寫出 `not saved`，不冒充 durable outcome persistence、account 或 hosted service。實際 reviewer sessions 尚未完成；Excel 填寫版見 [`docs/phase-0.5-review.xlsx`](phase-0.5-review.xlsx)。
- **Story 4**：外部／內部 reviewer sessions 尚未完成，review protocol 與 findings template 見 [`docs/phase-0.5-review.md`](phase-0.5-review.md)。
- **Story 1–2**：首頁已具備視覺語言、responsive 基本規則與 Evidence → State → Decision → Action 的 Tempo Run → Moderate Run 主流程；狀態依現有 static evidence 更新為完成。
- **Product boundary review**：`docs/user-journey.html` 維持 stakeholder／marketing explainer 的長文角色，並把 v0.5.0、connectors、hosted remote、private engine 與 account capability 改成 preview／release-target／future language；homepage 保留較短的 install CTA 與 visual demo。
- **Validation**：static HTML parse、required-label/accessibility assertions、script syntax checks 與 repository tests are the evidence for the prototype; no claim is made that 3–5 external user interviews or a browser-run smoke session have occurred.

Phase 0.5 的核心畫面：

```text
Evidence → current state → decision intent → scheduled workout (from)
  → executable workout (to) → reason + missing signals + confidence
```

完成這個 prototype 後，才進入 Phase 1 的首頁視覺設計。若畫面仍像一般 readiness dashboard，先修正產品敘事與 UI，不以增加 metrics 或 connector 數量代替差異化。

目標：以 Phase 0.5 的 Decision Brief 為視覺核心，用一個真實、可操作的產品頁講清楚 Pacevera，讓目標使用者安裝或加入 private beta。**Phase 0.5 的 prototype 已可作為視覺核心；Phase 1 的首頁工程與市場驗證仍待進行。**

| Story | 交付結果 | 完成條件 | 狀態 |
|---|---|---|---|
| Phase 1 - Story 1 | 定位與首頁資訊架構。 | 完成獨立公司首頁的 Hero、問題、from→to 案例、How it works、適合誰、現在／未來界線與 CTA；`user-journey.html` 僅作 Product 深度案例；不宣稱尚未存在的一鍵 connector 或 hosted privacy。 | 進行中（定位已收斂；首頁待拆分實作） |
| Phase 1 - Story 2 | 可理解的產品示範。 | 將 Phase 0.5 的 Decision Brief prototype 嵌入獨立首頁，並以 `user-journey.html` 作為 Product 深度案例；互動式展示「原定 Tempo → 根據 Evidence 調整」，顯示 reason、coverage、missing signals 與 trace。 | 待開始 |
| Phase 1 - Story 3 | 信任與安裝區。 | 並列 Local desktop／Private deployment／Hosted remote；顯示 Product／Engine／Rule Package 版本、資料流、privacy policy、非醫療聲明與 v0.5.0 安裝入口。 | 待開始 |
| Phase 1 - Story 4 | 上線與驗證。 | pacevera.com 第一版上線；waitlist 不收健康資料；完成 3–5 位目標使用者訪談，量測 10 分鐘 activation、7 日回訪與決策採用。 | 待開始 |

### Phase 2 — Local private engine MVP

目標：把「Evidence 不離開使用者控制環境」從 MCPB 敘事變成完整、可驗證的 private data plane。

| Story | 交付結果 | 完成條件 | 狀態 |
|---|---|---|---|
| Phase 2 - Story 1 | Durable local repository。 | SQLite 優先的 state／plan／decision／outcome repository；process restart 後仍可讀；有 migration、backup、export 與 delete。 | 進行中（decision／outcome records、migration 與 local restart recovery 已完成；backup、export、delete 尚待補齊） |
| Phase 2 - Story 2 | Private connector boundary。 | 第一批只完成經驗證的 local Evidence workflow；Google Health API local connector 重用既有 importer／normalizer；connector token 加密、最小 scope、撤銷與刪除；Oura／WHOOP 先補真實去識別化 fixture，不以平台數量充當完成。 | 待開始 |
| Phase 2 - Story 3 | Evidence continuity。 | 每次 Decision 帶 state ID、evidence window、Product／Engine／Rule Package identity；保留 ingestion source、original writer、platform 與 signal provenance；新對話或新 host 只讀最小化 bootstrap，不重新取得完整健康歷史。 | 待開始 |
| Phase 2 - Story 4 | Private-engine acceptance。 | 無 hosted service 時，Google Health API → Evidence → Decision、今日課表調整、低恢復降載、傷病替代、單次 workout 五個情境端到端通過；privacy boundary tests 證明 raw Evidence 與 token 未離開 user-controlled environment，且 Garmin chain 缺少 HRV 時明確回報 missing。 | 待開始 |

### Phase 2 entry decision — Google Health ingestion

Google Health API 的資料處理核心已存在：`scripts/import-google-health-api.js` 能讀取已取得的 Google Health API v4 raw response，並交給既有 Google Health normalizer 產生 Evidence。這個 importer 是 **local-only**，不是 hosted OAuth client；下一步不應重做 parser，而是補上受控的取得與連線層。

本工程正式歸入 **Phase 2 - Story 2**，並以 Story 1 的 local repository 作為保存、匯出與刪除邊界的前置條件。帳號身分與健康資料授權必須分離：

```text
Sign in with Google       = Pacevera user identity
Connect Google Health     = Google Health API data permission
```

Phase 2 的目標資料流固定為：

```text
Google account identity
        ↓
Connect Google Health（獨立授權）
        ↓
Google Health API OAuth token
        ↓
existing importer / normalizer
        ↓
Evidence + source provenance
        ↓
Decision Engine
```

Evidence 必須區分 `ingestionSource`（Google Health API）與 `originalWriter`（例如 Garmin Connect 或 Apple Watch／HealthKit）。Garmin → Apple Health 的同步是單向資料路徑，且目前實測 Garmin chain 沒有 HRV；HRV 缺失時必須保留為 `missing`，不得推測或補值。Apple Watch HRV 將由後續 HealthKit connector 驗證，不把 Google Health 的聚合結果自動標成 Apple Watch 資料。

`Sign in with Google` 不應在 Phase 0.5 public preview 中獨立上線；若進入 mobile／private-engine product，應與 `Connect Google Health` 一起設計，但使用不同 consent、token scope、撤銷與刪除流程。Hosted Google OAuth、mobile access 與 hosted retention／DPA 仍屬 **Phase 3 - Story 4**，目前維持 `Blocked`。

### Phase 2 - Story 2 詳細分解：本機匯出檔 Evidence Data Flow

Phase 2 - Story 2「Private connector boundary」目前寫的完成條件只涵蓋 Google Health API
OAuth 這一條即時路徑（帳號登入 → 連接 Google Health → API token → importer → Evidence →
Decision Engine，見上一節）。以下拆出另一條平行路徑：不經任何 API，直接讀使用者已經用
Apple Health、Garmin、Strava、Google Health 匯出、放在本機資料夾（例如 `data/private/`）
裡的檔案。兩條路徑都屬於 Story 2 的範圍，差別只在證據怎麼進來——一個是即時 API，
一個是離線檔案。

`packages/connectors` 的 4 家 provider parser（Apple Health、Garmin、Strava、Google
Health）已用真實匯出檔驗證正確（見 2.1），但目前只被 `demoData.js` 用來產生展示假資料，
`apps/mcp-server` 沒有任何路徑會主動掃本機資料夾、把這些 parser 的輸出餵進決策工具。
`packages/connectors/src/local.js` 已定義 `LocalConnectorAdapter` 介面（`pullNormalizedEvents()`），
但除了測試用的 `FixtureConnectorAdapter`，沒有任何 provider 有具體實作。

| Story | 交付結果 | 完成條件 | 狀態 |
|---|---|---|---|
| Evidence Flow - Story 1 | Local connector 具體實作。 | 為 Apple Health／Garmin／Strava 各寫一個 `LocalConnectorAdapter` 子類，實作 `pullNormalizedEvents()`：掃對應資料夾、挑最新匯出檔、呼叫既有 normalize 函式。Google Health 沿用既有 `scripts/import-google-health-api.js` 的 importer／normalizer，不重寫。「最新」的判斷依據（檔案時間戳／匯出內容裡的日期）要附出處，無出處不准進 repo。 | 完成 |
| Evidence Flow - Story 2 | 多來源 Evidence 組裝。 | 用既有 `applyNormalizedEventsToContext` 把 4 家輸出合併成單一 context；沒資料或資料過期的來源要反映在 `signalCoverage.recovery.missing`／`training.missing`，不得假裝有值。 | 完成 |
| Evidence Flow - Story 3 | 接進本機決策路徑。 | 組裝好的 Evidence 在本機引擎內部直接餵進 `assess_fitness_state`／`decide_session`，不透過 Claude 傳 `evidence` 參數；同一批檔案重跑兩次，決策結果要一致。 | 完成 |
| Evidence Flow - Story 4 | 對外介面決定。 | 要不要曝露成一個可被 Claude 觸發的 tool；若要，回傳只給摘要與決策結果，不吐 HRV／心率等原始數值——比照既有 Google Health sync 定案原則。 | 完成（2026-08-13 使用者定案） |
| Evidence Flow - Story 5 | Harness 驗證與文件收尾。 | 建 Decision Harness scenario 覆蓋「檔案齊全／缺檔／格式過期／髒資料」；本文件與 `CLAUDE.md` 現況段同步更新。 | 完成 |
| Evidence Flow - Story 6 | Today's Brief UI 接真資料。 | `docs/pacevera-home.html` 的 Evidence／Decision／Reason 區塊改讀 Story 3 產出的真實決策輸出，取代目前寫死在 `<script>` 裡的 fixture 物件（`keep`／`adjust` 等常數）；`prototype-note` 與 fixture 免責句拿掉或改寫成反映真實資料狀態。 | 完成 |

#### Evidence Flow completion evidence — 2026-08-13

- **Story 1**：`packages/connectors/src/local/`（`appleHealthLocal.js`／`garminLocal.js`／`stravaLocal.js`／`googleHealthApiLocal.js`）。「最新」一律用 `fs.stat().mtimeMs`（`latestExportFile.js`），Google Health 沿用既有 script 的 reader／normalizer（搬到 `googleHealthApiLocal.js`，`scripts/import-google-health-api.js` 改為呼叫它，行為不變）。
  **實測發現、非文件既有假設**：Garmin 的 GDPR bulk export（`DI_CONNECT/`）與 `schemas/sources/garmin.export.json`／既有 `normalizeGarminSleep`／`normalizeGarminDailySummary` 假設的欄位形狀不同——真實匯出檔的 `sleepData.json` 完全沒有 `sleepTimeSeconds` 欄位（改用 `deepSleepSeconds+lightSleepSeconds+remSleepSeconds`），`sleepScores.overallScore` 不是巢狀 `.overall.value`；`UDSFile` 的 `averageStressLevel` 巢狀在 `allDayStress.aggregatorList`（`type: "TOTAL"` 那筆）不是攤平欄位。這兩個轉換寫在 `garminLocal.js`（`flattenSleep`／`flattenDailySummary`），不改動既有 `normalizeGarmin*` 函式本身。另外把 `normalizeGarminDailySummary`／`normalizeGarminSleep`／vendor_assessment 事件補上 `stableId`（先前缺失，多檔合併時會用 `id: undefined` 互相覆蓋）。
- **Story 2**：`assembleLocalEvidence.js` 跑 4 個來源、單一來源失敗只記 `sources[name].status`，不中斷其他三個。`applyNormalizedEventsToContext` 新增 `vendor_assessment` 合併（先前被靜默丟棄——Garmin 的 `recoveryTime`／Body Battery 最可靠的訊號正是這個 kind）。
- **Story 3**：`scripts/import-local-evidence.js`；`LocalPrivateEngine.decideToday` 新增 `context` 覆寫參數——因為 repository 的 SQLite schema 不存 `vendor_assessment`，若照舊從 repository 重讀會把 Garmin 這組訊號重新丟掉，所以決策改吃組裝後留在記憶體裡的完整 context。對同一批真實私有匯出檔跑兩次，stdout byte-for-byte 相同（僅 SQLite experimental-warning 那行的 PID 不同）。
- **Story 5**：`packages/connectors/test/local/harnessScenarios.test.js` 覆蓋 complete／stale（超過 `stalenessSleepDays`/`stalenessAutonomicDays`/`stalenessRestingHrDays`/`stalenessVendorCompositeDays` 視窗後轉 missing）／dirty（壞掉的 JSON 檔、缺欄位記錄、欄位改版的 Strava CSV）；missing 由 `assembleLocalEvidence.test.js` 既有兩個案例覆蓋。新增 fixture：`data/fixtures/garmin/di-connect-export{,-dirty}/`、`data/fixtures/google-health-api/raw/`、`data/fixtures/strava/export-dirty/`。
- **Story 6**：`scripts/generate-home-scenario-fixtures.js` 跑 `harness/scenarios/01,02,03`（既有、已審查過的合成情境）經真實 `generateSemanticFitnessState`+`decideSession`，寫出 `docs/pacevera-home-scenarios.js`（machine-generated，取代原本手寫在 inline `<script>` 裡的 `keep`／`adjust`／`defer` 物件）；同步更新頁面上與舊 fixture 數字綁定的靜態文案（trace drawer、decision-layer 區塊）避免與新數字矛盾。原本的趨勢箭頭（↑/↓）沒有對應的時間序列比較基準，本來就是裝飾性數字，這次移除而非保留。
- **Story 4**（2026-08-13 補做，使用者定案「下一版 mcpb 要能真的體驗這條流程」）：不新開一個要 Claude 特地去叫的 tool——`assess_fitness_state`／`decide_session`／`generate_plan`／`generate_workout`（唯四個 input schema 有 `evidence` 欄位的 tool）在 `apps/local-engine/src/localEvidence.js` 這層攔截：呼叫端沒帶 `evidence`（或帶了空的）時才用 `assembleLocalEvidence` 掃使用者選的資料夾補上，呼叫端自己給的 evidence（哪怕只有一筆）一律不覆蓋。`apps/mcp-server`（hosted）完全沒改，只有 `apps/local-engine` 這層動。回傳沿用既有 `decide_session` 輸出契約——查過那份契約本來就只回算好的分數（readiness／acwr 這類），從沒回過原始 HRV ms／心率數字，所以「不吐原始數值」這條不用另外寫防護，沿用既有契約就成立。folder 路徑改用 MCPB manifest 的 `user_config`（`type: "directory"`，裝的時候跳原生資料夾選擇器，預設 `${HOME}/Pacevera`），過 `${user_config.private_data_dir}` 樣板注入 `PACEVERA_PRIVATE_DIR` 環境變數——不是猜的語法，用官方 `@anthropic-ai/mcpb` 套件本地的 `mcpb-manifest-v0.3.schema.json` 核對過，manifest 也跑過 `npx @anthropic-ai/mcpb validate` 通過。`.mcpb` 打包進入點（`scripts/build-bundle.js` 的 `BUNDLE_ENTRY` 預設值）從 `apps/mcp-server/src/stdio.js` 換成 `apps/local-engine/src/stdio.js`；Remote image 的 `BUNDLE_ENTRY=apps/mcp-server/src/http-entry.js` 覆寫不受影響。
  **過程中發現三個既有檔案的路徑在打包後會壞掉**（`packages/db/src/repository.js` 讀 `../schema/sqlite.sql`、`packages/rules/src/candidate.js` 讀 `../../../rule-packages/schemas/rule-candidate.schema.json`——這兩個都是先前從沒被 `apps/mcp-server` 那條進入點載入過，這次換成 local-engine 進入點才第一次被打包進去、第一次暴露）：兩個都比照既有 `librarySource.js`／`parameterSource.js` 的模式各自拆一個 `*Source.js` 間接模組，`scripts/build-bundle.js` 的 `layoutShims` 各補一條內嵌規則，不改動兩邊原本的商業邏輯。
  **實測**：`npm run pack` 打包、`node scripts/smoke-release-install.js --skip-online --skip-claude` 全綠；額外把打包出來的 `.mcpb` 解壓、直接跑裡面的 `dist/evidra-server.mjs`，用真實 fixture 資料夾當 `PACEVERA_PRIVATE_DIR`，對 `decide_session` 打「VO2max Intervals 60min」且不帶 `evidence` 參數，收到 `evidenceSource: "provided"` 與真實決策（`adjust` → `Moderate run`），不是空跑。
  新增 `manifest.json` 的 `evidra_local_decide_today`（先前只在 `apps/local-engine` 程式碼裡存在、從沒寫進 manifest／README／`docs/mcp-server.md`，`apps/mcp-server/test/publicContract.test.js` 原本的斷言只比對 hosted 10 個 tool，沒把這個本機專屬 tool 算進去，這次一併補上並修正該測試的假設）。
- 全部 31 個新 tests（`packages/connectors/test/local/*` 8+3+4、`apps/local-engine/test/importLocalEvidence.test.js` 2、`apps/local-engine/test/localEvidence.test.js` 6、`apps/local-engine/test/localEvidenceInjection.test.js` 4、`apps/local-engine/test/noEngine.test.js` 4）與既有 517 個一起跑：`npm test` 548/548 通過。

#### 已裝機實測抓到的 regression：`node:sqlite` 在 Node <22.5 完全不存在（2026-08-13）

上面 Story 4 的東西打包裝進 Claude Desktop 之後，使用者實際裝上去是 `failed` / `Server disconnected`，log
（`~/Library/Logs/Claude/mcp-server-Pacevera.log`）顯示 process 一收到 `initialize` 就死掉，**沒有任何 stderr**。

**查證過程**：用 `nvm install 20` 裝一份真的 Node 20.20.2 直接跑打包出來的 `dist/evidra-server.mjs`，
重現出一模一樣的崩潰特徵：`Error [ERR_UNKNOWN_BUILTIN_MODULE]: No such built-in module: node:sqlite`。
`node:sqlite` 是 Node 22.5 才加的 experimental 模組，`manifest.json` 宣告的相容下限卻是 `"node": ">=20"`——
這次把打包進入點從完全不碰 SQLite 的 `apps/mcp-server` 換成用到 `packages/db`（進而用到 `node:sqlite`）的
`apps/local-engine`，才第一次讓這個落差變成實際會發生的崩潰。**沒有 stderr 的原因**：ESM 的 `import` 是整個
依賴圖一起解析完才開始執行任何一行程式碼，`node:sqlite` 這個 import 解析失敗時，連同一支檔案裡寫在它
前面的診斷程式碼都輪不到執行——這點也是實際塞了診斷程式碼進已安裝的檔案、看它完全不印才確認的，
不是憑經驗猜的。

**怎麼修的**：`packages/db/src/repository.js` 改用 `createRequire(import.meta.url)` 在 constructor 裡才去
`require("node:sqlite")`，把「整個依賴圖解析失敗」變成一個可以被 catch 的普通 `Error`（用同一份 Node 20
驗證過兩種寫法的差異：static import 直接讓 process 死掉、`require` 版本乾淨拋出可 catch 的錯誤）。
`apps/local-engine/src/stdio.js`／`server.js` 對應改成：repository 建立失敗時不讓整個 process 死掉，
只讓 `evidra_local_decide_today` 與 outcome/decision trace 續存這兩個真的需要 SQLite 的功能不可用，
本次 Story 4 真正要交付的「四個帶 `evidence` 的 tool 自動讀本機資料夾」完全不需要 SQLite，在 Node 20 一樣
正常運作。**用打包出來的實際 archive（不是原始碼）在真 Node 20 上重新驗證過一次**：`tools/list` 正確變成
10 個（少了本機專屬那顆）、`decide_session` 不帶 `evidence` 照樣讀本機資料夾算出正確決策。

### Phase 3 — 受控手機與跨 AI host 體驗

目標：讓手機與不同 AI host 可使用同一個 private engine，同時維持清楚的資料邊界。

| Story | 交付結果 | 完成條件 | 狀態 |
|---|---|---|---|
| Phase 3 - Story 1 | Cross-host conformance。 | Claude、ChatGPT、Gemini 對同一 state／version 組合產生相同結構化 decision；差異只在自然語言表達。 | 待開始 |
| Phase 3 - Story 2 | Secure device pairing。 | 一次性 pairing code、短期 audience-bound token、scope、rotation、unlink、revocation、replay protection 與連線裝置顯示端到端成立。 | 待開始 |
| Phase 3 - Story 3 | User-controlled mobile path。 | 受控 tunnel 或 private VPC 路徑可用；連線前能知道資料流向；local endpoint 預設不暴露區網。 | 待開始 |
| Phase 3 - Story 4 | Hosted remote go／no-go。 | 除 authorization server、HTTPS、claims／scope、redaction、privacy policy、DPA、目標 host E2E 與明確付費需求外，完成 Google Health API mobile OAuth connector：以最小 scopes 取得 API response、正規化為 Evidence、不得把 provider refresh token 或長期 raw health history 留在 hosted Pacevera；desktop importer `4175a1a` 維持 local-only。全數成立才可 GO；否則維持 Blocked。 | Blocked |

### Phase 4 — Team／Enterprise 與平台介面

目標：把個人隱私價值延伸成團隊資料治理與可整合的 Decision Infrastructure。

| Story | 交付結果 | 完成條件 | 狀態 |
|---|---|---|---|
| Phase 4 - Story 1 | Tenant／athlete governance。 | Verified principal、tenant isolation、athlete scope、coach／clinician／admin／auditor 權限 fail closed；team output 不含 raw payload。 | 待開始 |
| Phase 4 - Story 2 | Private deployment operations。 | VPC／on-prem、SSO／SCIM、audit log、retention／deletion、資料區域、backup 與 SLA 可部署及稽核。 | 待開始 |
| Phase 4 - Story 3 | REST API 與 SDK。 | MCP、REST、SDK 共用同一 Decision contract、版本資訊與 authorization policy；不另做一套會漂移的判斷邏輯。 | 待開始 |
| Phase 4 - Story 4 | Team pilot 與商業定案。 | 至少一個受控 team pilot 驗證 active-athlete 計價、角色可見範圍、decision trace review 與 support 成本；之後才定 Free／Private Pro／Enterprise 包裝。 | 待開始 |

---

## 6. 跨 Phase 持續治理

以下不是獨立產品 Phase，而是每次變更都要遵守的 release discipline：

- Rule／parameter／evidence 變更：建立 review record，驗證 schema、checksum、compatibility、golden／boundary／replay behavior 與 Decision Graph diff。
- Engine 變更：Decision Engine 必須進版，全部 regression／harness 重跑，不能只更新 package version。
- Product surface 變更：Product／MCPB 進版，README、manifest、schemas、`tools/list`、privacy 與 release notes 同步。
- 新 domain package：先以 draft 發展；未接 runtime、未通過 review／regression、未列入 active packages 前，不得對外宣稱啟用。
- Evidence 文獻只支持它真正涵蓋的 claim；研究品質不直接等於個人 decision confidence。
- Hosted mode 不保存原始 Evidence；任何 telemetry、trace 或 log 都要有 payload redaction test。

## 7. 明確不在近期主線

- 泛用健康 dashboard、社群、內容庫或由 Pacevera 自建的聊天 UI。
- 讓 LLM 直接生成或核准決策規則。
- 在 local/private contract 完成前公開 hosted Remote MCP。
- 在有真實付費驗證前製作 Rule Marketplace、白牌 AI coach、複雜授權加密或多層定價。
- 宣稱 Oura／WHOOP 已完成真實流程驗證，或宣稱 Apple／Google／Garmin 已可一鍵即時同步。
- 把 behavioral regression corpus 描述成醫學 ground truth。

## 8. 舊代號說明

舊文件中的 `R1`、`R2`、`C9`、`P1` 等是不同時期的臨時工作包，不是產品版本；部分代號後來被重複使用，已無法讓人一眼辨識先後與歸屬。

從本版起：

- 未完成工作只使用 `Phase N - Story N`。
- 發行只使用 Product、Decision Engine、Rule Package identity。
- 歷史代號只留在 [fitness-mcp-implementation-plan-history.md](fitness-mcp-implementation-plan-history.md) 與舊 handoff，供稽核，不再拿來排新工作。

---

## 9. 現在開工順序

1. `Phase 0 - Story 2`：補公開 privacy URL、10-tool 文件一致性與 continuity／retention／export／delete 的 release wording。
2. `Phase 0 - Story 4`：在可監聽 localhost 的環境重跑完整 tests、package dry-run、install smoke、MCPB archive／published review；G2／G2b／G9 已關閉。
3. `Release Story 2`：完成 Remote-ready image build／smoke；Docker daemon 可用前不宣稱 hosted Remote MCP 已上線。
4. `Release Story 4`：把 release gate 接到可重現的 CI／artifact 流程，補齊完整 rollback evidence。
5. `Phase 0.5 - Story 4`：完成 Decision Graph／Outcome 的 3–5 位 reviewer review，先不宣稱 durable outcome storage。
6. `Phase 1 - Story 2～4`：完成 pacevera.com 第一版與 3–5 位目標使用者驗證；不把 Google Health、Apple Health 或 Garmin 寫成已完成的一鍵 connector。
7. `Phase 2 - Story 1`：完成 local state／plan／decision／outcome repository；records、migration 與 local restart recovery 已完成，接著補 backup、export 與 delete。
8. `Phase 2 - Story 2`：將既有 Google Health API importer 接到 local OAuth／connector boundary，完成 token、scope、撤銷與最小化同步。
9. `Phase 2 - Story 3～4`：完成 source-aware Evidence continuity、Garmin／Apple Watch provenance、HRV missing handling 與 private-engine acceptance。
10. `Phase 3 - Story 4`：只有在 authorization、HTTPS、redaction、DPA、privacy policy、host E2E 與付費需求全部成立後，才重新評估 hosted Google Health OAuth；此前維持 Blocked。
