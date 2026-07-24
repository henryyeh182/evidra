# Fitness MCP — Implementation Plan (Phase 0 → Phase 8)

> 個人運動規劃生成與推薦系統 · 跨模型 MCP Server
> 版本：**v3**（把三份附錄升級為治理層，並讓路線圖與已落地的程式碼對齊）

---

## v3 改了什麼（相對 v2）

v2 是「以 Peloton 缺口反推設計」的藍圖，內容正確但有兩個問題：

1. **三份附錄（Tool Surface / 關鍵決策點 / 最大風險）被擺在文件最底部**，實務上沒人在每個 Phase 動工前回頭看它們。v3 把這三份升級成貫穿全程的 **治理層（Governance）**，每個 Phase 的 gate 都直接引用它們。
2. **藍圖與現況脫節**。程式碼已經沿著「最快問出 *今天該練什麼*」的垂直切法走了一段，實際 tool 名稱與 v2 附錄 A 的水平切法不同，知識庫的資料量也還遠未達標。v3 新增 [§0.5 現況盤點](#05-現況盤點reality-check)，把 package → phase 的真實狀態講清楚，並據此**重新拆解**剩餘工作。

v3 不推翻 v2 的任何設計判斷，只做兩件事：**把治理層拉到前面、把路線圖對齊現實。**

---

## 0. 這份計畫的核心判斷

Peloton 已經證明了兩件事：

1. **需求成立**：使用者確實想用自然語言規劃訓練，而不是用篩選器。
2. **淺層整合會失敗**：把既有搜尋 API 包成 MCP tool，LLM 拿到的是不夠結構化的資料，結果就是幻覺、錯排序、假計畫。

因此本計畫的第一原則是：**Semantic Layer 先於 MCP，MCP 先於 App**。
資料沒有語意結構之前，開再多 tool 都只是把幻覺搬到另一個介面。

---

## 0.5 現況盤點（Reality Check）

> 這一節是 v3 的錨點。任何 Phase 的重新拆解都以此為準，不以「計畫上寫了什麼」為準。

### 已落地的 package（dependency-free、有 node test）

| Package | 對應 Phase | 狀態 | 備註 |
|---|---|---|---|
| `packages/domain` | Phase 0/1 | ✅ 架構完成 | 核心領域模型（User / Workout / Program / State） |
| `packages/semantic-engine` | Phase 1/3 | ✅ 架構完成 | `generateSemanticFitnessState`：recovery / readiness / fatigue / 推薦焦點 |
| `packages/knowledge-graph` | Phase 1 | 🟡 架構完成、**資料未達標** | ontology graph + workout schema + program templates 都在，但種子資料 ~4 動作 / ~28 邊 / ~3 課表，目標是 800 / 3000 |
| `packages/planning` | Phase 4/6 | ✅ 架構完成 | `generatePlan` / `adaptPlan` / `planStore`（preview→commit、版本化） |
| `packages/connectors` | Phase 5 | 🟡 兩個來源 | Strava + Apple Health（`export.xml` 串流解析 → normalize，原始資料本機私有／gitignored）；其餘來源未接 |
| `packages/db` | Phase 1 | 🟡 契約完成 | PostgreSQL schema、mappers、2 個 migration；尚未接上真正的 runtime |
| `apps/mcp-server` | Phase 2/4/6 | 🟡 垂直切片 | 8 個 tool，走 stdio；**沒有 Streamable HTTP / OAuth** |

### 已上線的 Tool Surface（實際 8 個，垂直切法）

```
get_semantic_fitness_state   recommend_workout         get_training_context
generate_plan                get_plan                  list_plans
preview_adjust_plan          commit_adjust_plan
```

這 8 個 tool 是為了最快兌現 README 的 MVP 問句「**What should I do today?**」而做的垂直切片：直接跳到 semantic state + 計畫生成 + preview/commit，**跳過了 v2 附錄 A 規劃的水平讀取 API**（`search_exercises` / `get_exercise` / `search_workouts` / `get_workout` …）。

### 因此，真正的缺口（v3 拆解的依據）

1. **知識庫是空的護城河**。graph 的程式在、資料不在（達標率 < 1%）。這正是 [風險 R1](#風險-registerappendix-c) 正在發生。
2. **水平讀取 API 尚未存在**。附錄 A 的 P2 六件套一個都還沒開；目前只能問「今天練什麼」，不能問「找一個不傷膝的深蹲替代」。
3. **Tool 命名雙軌**。已上線的垂直名稱 vs 附錄 A 的水平名稱需要一次對齊決策（見 [Tool Surface Contract](#tool-surface-contractappendix-a)）。
4. **協定基線未達 Phase 0 標準**。目前 stdio-only，沒有 Streamable HTTP、沒有 OAuth 2.1。
5. **量化紀律的骨架已建立（v3 補上）**。`/eval` golden set v0 + runner 已就緒，能對現有 8 tool 客觀評分（schema validity / grounding / plan validity）；仍待把 golden set 擴到 30 條並接上跨模型 tool-selection 評分。

---

## 治理層（Governance）— 每個 Phase 動工前先看這裡

治理層由四塊組成：**六條設計原則**、**Tool Surface Contract（原附錄 A）**、**決策日誌（原附錄 B）**、**風險 Register（原附錄 C）**，外加一條**貫穿全程的量化紀律**。這些不是附錄，是每個 Phase 的驗收前提。

### 六條設計原則（從 Peloton 的破口反推）

| # | 原則 | 對應的 Peloton 失敗 | 目前落實狀態 |
|---|---|---|---|
| P1 | Tool 回傳結構化資料，不回傳自然語言敘述 | 課程結構被 LLM 編造 | ✅ 現有 8 tool 皆回結構化 |
| P2 | Plan 由 Planning Engine 產生，LLM 只做編排與說明 | 18 週計畫出現不存在的課 | ✅ `packages/planning` |
| P3 | 所有輸出 item 必須帶可驗證 ID，server 端在回傳前做存在性驗證 | 幻覺課名 | 🟡 有 ID，回傳前存在性驗證待補 |
| P4 | 寫入動作一律 two-phase：`preview_*` → `commit_*`，帶 idempotency key | 加錯課、加到過去 | 🟡 preview/commit 有，idempotency key 待補 |
| P5 | 日期、時區、相對時間（「下週一」）一律由 server 解析，不交給 LLM | 排到上週一 | ❌ 尚未實作 date resolver |
| P6 | 用 MCP elicitation 一次收齊參數，不靠多輪追問 | 免費帳號撞額度 | ❌ 尚未實作 elicitation |

### Tool Surface Contract（Appendix A）

> **這是一份活的契約，不是回顧表。** 每次新增 / 改名 tool 都要更新這裡，並確認總數 ≤ 20。

**演進表（目標態，水平命名為 canonical）：**

| Canonical Tool | P2 | P3 | P4 | P5 | P6 |
|---|:-:|:-:|:-:|:-:|:-:|
| `search_exercises` | ● | | | | |
| `get_exercise` | ● | | | | |
| `search_workouts` | ● | | | | |
| `get_workout` | ● | | | | |
| `get_user_profile` | ● | | | | |
| `get_training_history` | ● | | | | |
| `recommend_workout` | | ● | | | |
| `suggest_alternatives` | | ● | | | |
| `generate_plan` | | | ● | | |
| `get_plan` / `adjust_plan` / `explain_plan` | | | ● | | |
| `get_readiness` | | | | ● | |
| `get_training_load` | | | | ● | |
| `get_availability` | | | | ● | |
| `preview_*` / `commit_*` | | | | | ● |
| `log_workout` | | | | | ● |
| `update_user_preferences` | | | | | ● |

合計 19 個，落在多數 client 的舒適區間內（20 是上限，不是目標）。

**現況對齊（已上線 8 tool ↔ canonical）：**

| 已上線（v0，垂直） | 對應 canonical | 對齊決策 |
|---|---|---|
| `get_semantic_fitness_state` | （新增，附錄 A 沒有）| **保留**。它是 semantic layer 的門面，比 `get_readiness` 更上位；`get_readiness` 之後作為它的子視圖 |
| `recommend_today_workout` → **`recommend_workout`** | `recommend_workout` | ✅ **已改名**（今日只是預設參數，不該綁進名字）|
| `get_training_context` | `get_user_profile` + `get_training_history` 的合併 | **保留**（Phase 2 時拆成兩個 canonical read tool）|
| `generate_training_plan` → **`generate_plan`** | `generate_plan` | ✅ **已改名** |
| `get_training_plan` → **`get_plan`** | `get_plan` | ✅ **已改名** |
| `list_training_plans` → **`list_plans`** | `list_plans` | ✅ **已改名**（附錄 A 漏列，計畫列表確有需要）|
| `preview_plan_change` / `commit_plan_change` → **`preview_adjust_plan` / `commit_adjust_plan`** | `adjust_plan`（兩階段版）| ✅ **已改名** |

> **訂正（v3 撰寫時的錯誤）**：先前把 `preview_plan_change` 對到 Phase 6 的 `preview_plan_apply`（把計畫寫進行事曆）是錯的。實際行為是對既有計畫做局部調整（reduce_availability / add_injury / deload_week），對應的 canonical 是 Phase 4 的 **`adjust_plan`**；因兩階段寫入（P4）故命名為 `preview_adjust_plan` / `commit_adjust_plan`。真正的 `preview_plan_apply`（行事曆寫入）仍是 Phase 6 未實作項。

> **決策 D-TOOL：已執行。** 一次改名到 canonical，舊名保留為 deprecated alias 一個版本（`apps/mcp-server/src/toolDefinitions.js` 的 `deprecatedToolAliases`，server 在 `tools/call` 解析）；golden set 有一條 `deprecated_alias_routes` case 守住向後相容。`tools/list` 只曝光 canonical 名稱。

### 決策日誌（Appendix B）

| 決策 | 時機 | 建議 | v3 狀態 |
|---|---|---|---|
| Graph DB 何時導入 | Phase 1 中段 | 等 traversal 深度 > 3 或 p95 延遲 > 200ms 再導 | 🟢 未觸發：目前 in-memory graph 足夠，**先不導 Neo4j** |
| 自建動作庫 vs 授權 | Phase 1 開始前 | 自建。這是護城河，不該外包 | 🟢 已定：自建（但資料量未達標）|
| 是否做 App | Phase 5 之後 | 除非 MCP 端的留存數據支持，否則不做 | ⚪ 未到 |
| 開源程度 | Phase 2 完成時 | 開源 MCP server 與 schema，閉源 KB 與 Engine | ⚪ 待 Phase 2 收尾時拍板 |
| 商業模式 | Phase 4 完成時 | Semantic Layer 訂閱 + API 計價，不做 content 訂閱 | ⚪ 未到 |
| **D-TOOL：tool 改名對齊** | **Phase 2 動工前** | 一次改名 + 舊名 deprecated alias | 🟢 **已定＋已執行**：改到 canonical，舊名留 alias 一版 |
| **D-PROTO：協定升級時機** | **Phase 2 動工前** | stdio 先撐開發；公開 demo 前補 Streamable HTTP + OAuth | 🟢 **已定**：開發期續用 stdio；HTTP + OAuth 延到對外前，在那之前不動 |

### 風險 Register（Appendix C）

每條風險都綁定一個 gate，Phase 過不了 gate 就不准往下。

| 風險 | 綁定 gate | v3 現況判讀 |
|---|---|---|
| **R1 資料品質決定一切，資料工作沒有捷徑。** Phase 1 草率，後面每個 Phase 都在擦屁股。寧可 Phase 1 拖長兩個月。 | Phase 1 gate：≥ 800 節點 / ≥ 3000 邊，替代動作合理率 ≥ 85% | 🔴 **正在發生**：目前 ~4 節點。這是 v3 判定的**當前最高優先**缺口 |
| **R2 Tool 太多會讓所有模型變笨。** 每加一個先問能不能併進既有 tool。19 是上限不是目標。 | 每個 Phase gate：tool 總數 ≤ 20 | 🟢 目前 8 個，健康。改名對齊時保持警覺 |
| **R3 健康建議的責任邊界。** UI 與 tool description 兩層都要聲明非醫療用途；傷病禁忌必須硬過濾、不可由 LLM 覆寫。**Phase 3 就要立起來。** | Phase 3 gate：傷病禁忌違反率 = 0 | 🟡 semantic-engine 有 constraint 概念，硬過濾的紅線測試待補 |

### 貫穿全程的量化紀律

每個 Phase 都要通過一組 **offline evaluation set**（等同回測）：

- 固定 50–100 條 golden query（含正例、邊界、陷阱題）
- 三個指標：
  - **Grounding rate**：回應中所有具體 item 都能對應到真實 ID 的比例（目標 ≥ 99%）
  - **Tool selection accuracy**：LLM 選對 tool 的比例（目標 ≥ 90%）
  - **Plan validity rate**：產出的計畫通過 schema + 業務規則驗證的比例（目標 100%）
- 每條 query 都在 GPT / Claude / Gemini 三家各跑一次，分開記分

> v3 現況：`/eval` 尚未建立。**這是 Phase 2 的前置條件之一**——沒有 golden set，改名對齊與讀取 API 的品質都無法客觀驗收。

---

## Phase 0 — 骨架與不可逆決策

**時間**：2 週 · **狀態**：🟡 部分完成（monorepo 骨架 ✅、協定基線 ❌）

**目標**：把之後很難改的東西先定下來。

### 交付物

1. **Repo 骨架**（monorepo）✅ — 已存在 `packages/*` 與 `apps/mcp-server`，`/schemas` 與 `/eval` 尚未建立。
2. **協定基線** ❌ — 目前 stdio-only：
   - Transport：**Streamable HTTP**（SSE 已 deprecated，新 server 不採用）— 未做
   - Auth：**OAuth 2.1 Resource Server**，RFC 8707 Resource Indicators、Client ID Metadata Documents — 未做
   - Spec version：`2025-11-25` 起跳，預留 extension（MCP Apps 走這條）— 待確認
3. **Schema-first** 🟡 — tool input/output 已有結構，但尚未抽成 `/schemas` 下的 JSON Schema 單一真實來源。
4. **Golden set v0** ❌ — 尚未建立。

### 重新拆解的 backlog（Phase 0 補完）
- [x] 建 [`/schemas`](../schemas)：8 個 tool 的 input/output 抽成 JSON Schema（[`schemas/tools/`](../schemas/tools)），並加 drift guard（`eval/test/contract.test.js`）確保與 server 定義不脫節。
- [x] 建 [`/eval`](../eval)：golden set v0（10 條）+ runner 骨架，跑既有 8 tool 的 **schema validity / grounding / plan validity** 三個 gating 指標，外加 plan→catalog 覆蓋率診斷。`npm run eval`。
- [ ] 把 golden set 從 10 條擴到 30 條（Phase 0 目標）。
- [ ] 反轉方向：讓 `toolDefinitions.js` 從 `/schemas` 匯入（codegen），schema 成為唯一真實來源。
- [ ] 接上 tool-selection-accuracy（需 model runner，golden case 已預留 `query` / `expectedTool`）。
- [x] **決策 D-PROTO 已定**：開發期續用 stdio；Streamable HTTP + OAuth 延到公開 demo / 第三方 client 連上前才補，在那之前此條掛著不動。

> 註：eval runner 已量到一個真實缺口——planner 產出的動作是**自由文字名稱**（`Romanian Deadlift`）而非 grounded `exercise_id`，plan→catalog 覆蓋率因此偏低。這正是 P3/R1 的量化證據，會隨 Phase 1 資料與 Phase 2 讀取 API 補上而升到 100%。

### 風險
- 這個階段沒有 demo 價值容易被跳過，但 transport 與 auth 之後改成本極高。**v3 明確：協定升級可延後，但 schema-first 與 eval 骨架不可延後**，因為它們是後續每個 Phase 的驗收地基。

---

## Phase 1 — Workout Knowledge Base

**時間**：4–6 週 · **狀態**：🟡 架構完成、**資料未達標（R1 進行中）**

**目標**：把「動作」變成有語意的圖，而不是一張表。這是整個專案唯一的護城河。

### 交付物

1. **Exercise Ontology** ✅ 架構（`packages/knowledge-graph/src/models.js` + `graph.js`）
   - 節點屬性：`primaryMuscle`, `secondaryMuscles`, `movementPattern`, `equipment`, `planeOfMotion`, `unilateral`, `skillLevel`, `impactLevel`, `loadsJoints`, `contraindications`, `source`, `confidence`
   - 關係邊：`IS_VARIANT_OF` / `PROGRESSES_TO` / `REGRESSES_TO` / `SIMILAR_TO`（帶 score）/ `SUBSTITUTES_FOR_WHEN`（帶條件）/ `ANTAGONIST_OF` / `REQUIRES_EQUIPMENT` / `LOADS_JOINT`
   > 「幫我找一個不傷膝蓋的深蹲替代動作」= 一次 graph traversal，不是一次 prompt。
2. **Workout Structure Schema** ✅（`workoutSchema.js`）：`Workout → Block[] → Set[]`
3. **Program Template Library** ✅（`programTemplates.js`）：線性週期、分化、PPL、5/3/1、Zone 2 等參數化模板
4. **資料匯入 pipeline** ❌ — 目前是手寫種子檔，無 source/confidence 審核佇列，量能不足。

### 資料儲存（Polyglot）
沿用 v2 建議：**Phase 1 只用 PostgreSQL + pgvector，Graph 用 in-memory / recursive CTE 硬撐**。決策 D「Graph DB 何時導入」目前未觸發（見決策日誌）。

### 驗收標準（Phase 1 gate — 綁定 R1）
- ≥ 800 個動作節點，≥ 3000 條關係邊 — 🔴 現況 ~4 / ~28
- 隨機抽 50 個動作「找 3 個替代」人工評分合理率 ≥ 85%
- 「全程 Zone 2」「純上肢」「無器材 20 分鐘」在 DB 層查得到正確結果

### 重新拆解的 backlog（**v3 判定的當前最高優先**）
- [ ] **資料擴充管線**：寫 import script，把公開動作庫（LLM 初標 + 人工複核）灌成 ≥ 800 節點，每筆帶 `source` / `confidence`。
- [ ] **關係邊生成**：用規則 + embedding 相似度批次生成 `SIMILAR_TO` / `SUBSTITUTES_FOR_WHEN`，人工複核高影響邊。
- [ ] **審核佇列**：human-in-the-loop 的 review queue（可先用簡單 JSON + CLI）。
- [ ] **資料層驗收測試**：把上述三條 gate query 寫成自動化測試。

### 風險
- **R1：資料是瓶頸，不是程式。** 70% 工時在資料清理與關係標註。v3 明確把「灌資料」列為 Phase 2 動工前的硬前置。

---

## Phase 2 — MCP Read API（第一次能被三家模型連上）

**時間**：3 週 · **狀態**：❌ 未開始（現有 8 tool 是垂直切片，非此處的水平讀取 API）

**目標**：讓 GPT / Claude / Gemini 都能查到 Phase 1 的知識庫。**唯讀，零副作用。**

### Tool Surface（首批 6 個，刻意精簡）

| Tool | 說明 | 關鍵設計 |
|---|---|---|
| `search_exercises` | 多維度動作檢索 | 支援 muscle / equipment / pattern / exclude_contraindication；回傳一律含 `exercise_id` |
| `get_exercise` | 單一動作詳情 | 含 graph 鄰居（變化式、進階、替代） |
| `search_workouts` | 課表檢索 | **支援結構化條件**（強度區間、時長、器材），這是與 Peloton 的分水嶺 |
| `get_workout` | 課表詳情 | 回傳完整 Block/Set 結構，**不回傳散文描述** |
| `get_user_profile` | 使用者偏好、器材、傷病、可用時間 | |
| `get_training_history` | 訓練紀錄查詢 | 預設按時間倒序，**排序邏輯在 server 端** |

### 跨模型注意事項
- Tool 描述用英文寫，回傳內容可多語
- 每個 tool 的 description 要寫「什麼時候不要用這個 tool」，顯著降低誤選率
- 回傳 payload ≤ ~4KB，超過走分頁；Gemini 對長 tool result 最不穩定

### 驗收標準
- Golden set 在三家模型上 tool selection accuracy ≥ 90%
- Grounding rate ≥ 99%
- 針對 Peloton 失敗的那七題，全數通過

### 重新拆解的 backlog
- [ ] **前置**：Phase 1 資料達標 + Phase 0 的 `/eval` 骨架就緒。
- [x] **前置 D-TOOL**：改名對齊已完成（`recommend_today_workout → recommend_workout` 等，見 Tool Surface Contract）。
- [ ] 實作 6 個讀取 tool，全部接到 knowledge-graph，回傳帶 `exercise_id` / `workout_id` 並在回傳前做**存在性驗證（落實 P3）**。
- [ ] 把 golden set 補到 50 條並在三家模型跑分。

> 這個 Phase 結束時，你會有一個能公開、且在「結構化查詢」維度明確優於現有產品的 demo。

---

## Phase 3 — Rule-based Recommendation

**時間**：3–4 週 · **狀態**：🟡 semantic-engine 已有推薦焦點，但規則層與 explainability 欄位待補齊

**目標**：從「查得到」進化到「知道該練什麼」。**還不要用 LLM 做決策。**

### 核心：Recommendation Engine ≠ LLM
```
LLM  →  MCP  →  Recommendation Engine  →  Knowledge Graph
                       ↑
                  Rule Set + 使用者狀態
```
LLM 的角色是 **orchestrator 與 explainer**，不做計算。

### 規則層（第一版全部是確定性規則）
- 肌群輪替：同一肌群 48 小時內不重複高強度刺激
- 器材可用性過濾
- **傷病禁忌硬過濾（安全紅線，永遠不可由 LLM 覆寫）← 綁定 R3**
- 時間預算匹配
- 偏好權重：喜好加分、明確排除直接剔除
- 新鮮度：避免連續推薦相同課表

### 新增 Tool
| Tool | 說明 |
|---|---|
| `recommend_workout` | 回傳 3–5 個候選，**每個都附 `reasoning` 欄位** |
| `suggest_alternatives` | 動作替代，帶替代原因 |

### 關鍵設計：Explainability 欄位
```json
{
  "workout_id": "...",
  "score": 0.87,
  "reasons": [
    {"rule": "muscle_recovery", "detail": "chest last trained 72h ago"},
    {"rule": "time_budget", "detail": "fits 35min window"},
    {"rule": "equipment", "detail": "requires only dumbbells"}
  ]
}
```
LLM 拿到這個就能講出人話，而且**講的是真的**。這是防幻覺最有效的一招。

### 驗收標準（gate 綁定 R3）
- 傷病禁忌違反率 = 0（硬性）
- 推薦結果人工評分合理率 ≥ 80%
- LLM 轉述 reasoning 時的事實正確率 100%

### 重新拆解的 backlog
- [ ] 把 semantic-engine 現有推薦邏輯抽成明確的 **確定性規則集**，每條規則可獨立測試。
- [ ] 加 `reasons[]` 結構化欄位到推薦輸出。
- [ ] **R3 紅線測試**：構造帶傷病禁忌的使用者，斷言違反率恆為 0，且該過濾不可被任何參數繞過。
- [ ] 新增 `suggest_alternatives`（直接吃 knowledge-graph 的 `SUBSTITUTES_FOR_WHEN`）。

---

## Phase 4 — AI Planning Engine

**時間**：4–6 週 · **狀態**：🟡 引擎與 preview/commit 已落地，Intent Parsing / elicitation / narration 待補

**目標**：產生多週訓練計畫。這是 Peloton 明確失敗的地方。

### 分層架構（不要讓 LLM 生成計畫）
```
1. Intent Parsing      ← LLM（「12 週後跑半馬 sub-2」轉成結構化目標）   ❌ 待補
2. Periodization       ← 演算法（週期化、負荷分配、減量週）             ✅ packages/planning
3. Session Assembly    ← Engine（從 KG 挑真實課表填 slot）              🟡 依賴 Phase 1 資料
4. Validation          ← 硬性檢查（ID 存在、總負荷合理、無禁忌）        🟡 存在性驗證待補
5. Narration           ← LLM（解釋為什麼這樣排）                       ❌ 待補
```
只有第 1、5 步是 LLM。第 3 步保證「不會出現不存在的課」。

### 新增 Tool
| Tool | 說明 | 現況 |
|---|---|---|
| `generate_plan` | 產生完整計畫，同步回傳 `plan_id` | ✅ 已上線（D-TOOL 已改名，舊名 `generate_training_plan` 留 alias）|
| `get_plan` | 取回計畫 | ✅ 已上線（舊名 `get_training_plan` 留 alias）|
| `adjust_plan` | 局部調整 | ✅ 已上線為兩階段 `preview_adjust_plan` / `commit_adjust_plan`（P4 兩階段寫入）|
| `explain_plan` | 結構化設計理由 | ❌ 待補 |

### 兩個關鍵設計
- **Plan 是 server 端持有的物件，不是對話裡的文字**（有 ID、版本、diff）✅ `planStore`
- **用 elicitation 一次收齊參數**（落實 P6）❌ 待補

### 驗收標準
- 12 週計畫 plan validity rate = 100%
- 任何長度計畫 item grounding rate = 100%（**依賴 Phase 1 資料達標**）
- 三家模型在相同輸入下結構一致（因為是 engine 產的）

### 重新拆解的 backlog
- [ ] `adjust_plan` / `explain_plan` 補成獨立 tool。
- [ ] `generate_plan` 在參數不足時回 **elicitation request**（落實 P6）。
- [ ] Session Assembly 在填 slot 後做**存在性驗證**（落實 P3、P4 驗收前提）。

---

## Phase 5 — Health Integration & Connector Layer

**時間**：6–8 週 · **狀態**：🟡 Strava normalization 框架 + 測試已有，其餘來源與負荷模型待補

**目標**：讓系統知道「你今天狀態如何」，而不只是「你有什麼器材」。

### Connector 原則：AI 永遠不碰外部 API
```
Apple Health / Garmin / Strava / WHOOP / Oura / Google Calendar
        ↓  (OAuth / Sync / Webhook / Normalize)
   Normalized Health Graph
        ↓
   Recovery / Fatigue / Readiness Score
        ↓
   MCP Tool（只露出分數與趨勢，不露出資料來源）
```
每個 connector 只做四件事：OAuth、Sync、Webhook、Normalize。加新來源不應動到上層任何一行。✅ `packages/connectors` 已是這個形狀（目前只有 Strava）。

### Training Load Graph
- ATL（7 日）、CTL（42 日）、TSB（訓練壓力平衡）
- **分肌群疲勞百分比** — 「今天別再練胸」的前提
- 數學與指數移動平均、均值回歸幾乎同構，可直接複用直覺

### 新增 Tool
| Tool | 說明 |
|---|---|
| `get_readiness` | 今日 readiness / recovery / fatigue + 一句話結論 |
| `get_training_load` | ATL/CTL/TSB 與分肌群疲勞 |
| `get_availability` | 從行事曆推出可訓練時段 |

> 註：`get_readiness` 之後作為 `get_semantic_fitness_state` 的子視圖（見 Tool Surface Contract）。

### 隱私設計（不能事後補）
- 健康資料分級，MCP 層預設只露出**分數**不露出**原始讀數**
- 使用者可逐項授權
- 原始資料加密靜態儲存，跨境傳輸需明確同意
- 對外文件明確寫出：本系統不提供醫療建議

### 驗收標準
- 至少 3 個 connector 上線並穩定同步 30 天（現況：2 — Strava + Apple Health）
- Readiness score 與主觀感受相關性 > 0.5（30 人小樣本）

### 重新拆解的 backlog
- [x] 接 Apple Health（`packages/connectors/src/providers/apple-health`，`npm run import:apple-health`）——驗證了「加來源不動上層」：沿用既有 `applyNormalizedEventsToContext`，semantic-engine 一行沒改。
- [ ] 再接 1 個來源（建議 Oura / Garmin）湊滿 3 個並穩定同步。
- [ ] 實作 ATL/CTL/TSB + 分肌群疲勞計算，接到 semantic-engine。
- [ ] 露出 `get_training_load`；`get_readiness` 作為 semantic state 子視圖。

---

## Phase 6 — Write Actions

**時間**：3 週 · **狀態**：🟡 preview/commit 骨架已有，idempotency key / date resolver / audit log 待補

**目標**：讓 AI 能真的改東西。Peloton 在這裡摔得最重，所以這裡最需要紀律。

### Two-phase commit（強制）
```
preview_schedule_change(...)  →  回傳 diff + preview_token
              ↓  使用者在 client 端確認
commit_schedule_change(preview_token, idempotency_key)
```
**沒有 preview_token 的 commit 一律拒絕。** ✅ 現有 `preview_adjust_plan` / `commit_adjust_plan` 已是此形狀；🟡 缺 idempotency key。

### 日期解析歸 server（落實 P5）❌ 待補
「下週一」「明天早上」全部由 server 用使用者時區解析，preview 中顯示絕對日期（`2026-08-03 (Mon) 07:00 GMT+8`）。LLM 不被允許自己算日期。

### 新增 Tool
| Tool | 說明 | 現況 |
|---|---|---|
| `preview_schedule_change` / `commit_schedule_change` | 排程寫入 | ❌ 待補（目前只有 plan_change）|
| `log_workout` | 記錄完成的訓練（含主觀 RPE） | ❌ |
| `preview_plan_apply` / `commit_plan_apply` | 把計畫寫進行事曆 | ❌ 待補（與 `adjust_plan` 不同：這是行事曆寫入，非計畫編輯）|
| `update_user_preferences` | 更新偏好、器材、傷病 | ❌ |

### 驗收標準
- 100 次重複 commit（同 idempotency key）只產生 1 筆變更
- 所有寫入都有 audit log，可回溯到觸發它的 tool call
- 混沌測試：preview 與 commit 之間插入狀態變更，系統應拒絕 commit 而非寫錯

### 重新拆解的 backlog
- [ ] 給 commit 家族加 **idempotency key**（落實 P4）。
- [ ] 實作 **server 端 date resolver**（落實 P5），preview 顯示絕對日期。
- [ ] 加 **audit log**，每筆寫入可回溯 tool call。
- [ ] 補 `log_workout` / `update_user_preferences`。

---

## Phase 7 — Cross-LLM 深化與 MCP Apps UI

**時間**：4 週 · **狀態**：⚪ 未到（協定層跨模型從 Phase 2 起，這裡處理體驗差異）

**目標**：從「三家都能連」進化到「三家都好用」。

### MCP Apps（SEP-1865）
2026-01-26 起，MCP Apps 成為 MCP 的第一個官方 extension，由 Anthropic 與 OpenAI 共同制定。Server 透過 `ui://` URI 宣告 HTML 資源，host 在沙箱 iframe 渲染，UI 與 host 走 JSON-RPC over postMessage。Claude、ChatGPT、VS Code Copilot、Goose 均已支援。→ **一套 UI 多平台重用。**

適合做成 MCP App 的三個介面：
1. **週計畫檢視器** — 可拖曳調整、點擊換課
2. **Readiness 儀表板** — 分數 + 趨勢圖 + 分肌群疲勞熱區
3. **訓練意圖表單**（elicitation UI）— 一次收齊目標、時間、器材、限制

### 各家差異處理
| 面向 | 處理方式 |
|---|---|
| Tool 數量預算 | 總數 ≤ 20；namespace 分組，必要時動態 tool 曝光（**R2**）|
| Tool result 長度 | 統一分頁，單次 ≤ 4KB |
| UI 能力偵測 | capability negotiation，不支援 MCP Apps 的 client 降級成結構化文字 |
| 錯誤語意 | 統一錯誤碼與可讀訊息，避免各家模型自行編造失敗原因 |

### 驗收標準
- 同一組 golden set，三家模型指標差距 < 10 個百分點
- MCP Apps UI 在 Claude 與 ChatGPT 兩邊渲染一致

---

## Phase 8 — Agent Ecosystem / Fitness OS

**時間**：持續 · **狀態**：⚪ 未到

**目標**：從「被呼叫的工具」變成「會主動運作的系統」。

1. **Proactive Agent** — 用 MCP async tasks，週日晚上自動產生下週計畫、連續三天高疲勞主動提醒降量
2. **Nutrition MCP** — 第二個獨立 MCP server，與 Workout MCP 共享 Semantic Layer
3. **Coach MCP** — 對話式教練，長期記憶 + 訓練哲學
4. **Third-party 開放** — 讓別人的 agent 呼叫你的 Semantic Layer（「Plaid of fitness」的兌現）
5. **Web Dashboard / Mobile App** — **Dashboard，不是 AI**。AI 的入口永遠是使用者已經在用的模型

---

## 附錄：v3 的執行順序（重新拆解後的近期路線）

治理層已整合進正文（原附錄 A/B/C 分別成為 [Tool Surface Contract](#tool-surface-contractappendix-a)、[決策日誌](#決策日誌appendix-b)、[風險 Register](#風險-registerappendix-c)）。以下是據 [§0.5 現況盤點](#05-現況盤點reality-check) 重新拆解後的動工順序：

1. **Phase 0 補完（地基）** — 建 `/schemas`（8 tool 抽 JSON Schema）+ `/eval`（golden set + runner 骨架）。沒有這兩個，後面沒有客觀驗收。
2. **Phase 1 資料達標（護城河，最高優先 / R1）** — 動作庫從 ~4 灌到 ≥ 800 節點、≥ 3000 邊，帶 source/confidence + 審核佇列。
3. ~~**決策 D-TOOL / D-PROTO 拍板**~~ — ✅ 已定：D-TOOL 已改名對齊；D-PROTO 開發期續用 stdio、對外前才補 HTTP + OAuth。
4. **Phase 2 讀取 API** — 6 個唯讀 tool，落實 P3 存在性驗證，golden set 三家跑分。
5. **回填 P3–P6 的落實缺口** — 存在性驗證、idempotency key、date resolver、elicitation，穿插進 Phase 3/4/6。

> 一句話：**先把地基（schema + eval）與護城河（知識庫資料）補起來，再往水平讀取 API 展開。** 垂直切片已經證明「今天該練什麼」跑得通，但整個計畫的價值壓在還沒灌的那 800 個動作節點上。
