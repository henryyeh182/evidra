# Fitness MCP — Implementation Plan

> 版本：**v7** · 依 [Design Manifesto](design-manifesto.md) 推導
> **Mission**：A permissioned Fitness Decision Engine that turns fragmented, user-owned health evidence into explainable training decisions for AI agents.

> ⚠️ [Design Manifesto](design-manifesto.md) 位階最高，衝突時以宣言為準。
> 宣言回答「蓋什麼、不蓋什麼」；本文件回答「照什麼順序蓋、現在偏差在哪」。
> 本文件是唯一的實作計畫，先前的 v1／v2／各 phase 分冊已刪除並整併於此。

---

## 0. 對外產品交付路線（P1 → P8）

本節以**使用者實際旅程**排列新的優先順序；下方第 4 節的 Phase 1–9
是歷史工程階段與完成狀態，兩者不要混為同一套編號。第一個成功標準不是
parser 或 tool 的數量，而是使用者能在手機上的 Claude／ChatGPT 直接問訓練問題，
得到有證據、可解釋、可執行的決策。

### P1 — 資料主權與產品邊界

固定「誰取得資料、誰處理資料、誰保存資料」：

- Fitness MCP 不直接 fetch Apple Health、Garmin、Strava，也不持有來源 OAuth refresh token。
- Hosted 版本只接受 caller 傳入的最小化 Evidence，transiently 計算後丟棄。
- Evidence 不進 database、file、object storage、queue、analytics、trace 或模型訓練資料。
- 完成 Privacy Policy、data-flow map、retention policy、subprocessor 清單與非醫療用途聲明。
- 對外使用：`We process only the minimum health-related evidence submitted by the caller...`
  不使用 `We never process health data`。

**驗收**：每條 request path 都能說明 Evidence 從哪裡來、在哪裡短暫存在、何時消失，且 log／error path 不洩漏 Evidence。

### P2 — 最小化 Evidence 契約與來源形狀

固定跨 Apple Health、Garmin、Strava 的 canonical Evidence：必要欄位、單位、時間、來源與 freshness。

- 對照真實 connector 輸出，不只驗證本機 export fixture。
- 缺資料時回 `signalCoverage.missing` 與降低 confidence，不補造數值。
- 只傳決策所需欄位，不把完整活動原始 payload 帶進 hosted MCP。
- 補齊 Apple Health／Garmin／Strava 的 source schema 與 scenario gate。

**驗收**：相同 canonical Evidence 在不同來源下產生相同 deterministic state；缺少的訊號被誠實標示。

### P3 — AI 教練決策 MVP

```text
使用者在 Claude／ChatGPT 手機輸入問題
        ↓ AI host 理解意圖並取得必要 Evidence
Fitness MCP：state → decision → action → reason
        ↓
AI host 把結構化結果講成人話
```

#### 使用情境 A：今天的課表

使用者：「我今天的課程安排是什麼？」

若有今日計畫且負荷偏高：

```text
原定：高強度腿部訓練
決策：adjust
改為：中等強度下肢訓練
原因：近期負荷偏高
```

這是 `Decision`，因為明確包含 `from → to`。

#### 使用情境 B：昨天運動量很大

使用者：「我昨天運動量很大，今天適合做什麼？」

若今天有原定課表，流程是：

```text
昨日 Evidence → 今日原定課表 → 調整後課表
```

例如把間歇課改成 Zone 2 或恢復活動。若今天沒有原定課表，不能偽裝成
Decision，應明確回傳 `Recommendation`，例如輕鬆步行、核心穩定、活動度或伸展。

#### 使用情境 C：限制與信心

使用者：「我睡不好但還是想運動，今天可以怎麼安排？」

MCP 必須回傳缺少或過期的 HRV／睡眠訊號、confidence 與 limits，而不是由 LLM 猜測生理狀態。

**驗收**：六個 decision tools 能由 Claude／ChatGPT 以自然語句正確選用，回覆包含 Decision、Action、Reason、confidence、signal coverage 與 limits。

### P4 — Local / private engine

提供不讓 hosted service 接觸 raw health Evidence 的版本：

```text
Apple Health / Garmin / Strava
        ↓
User device / home server / private VPC
  ├─ source connectors
  ├─ packages/evidence
  ├─ packages/semantic-engine
  ├─ decision computation
  └─ local/private MCP server
        ↓ 只回傳最小化 Decision
Claude／ChatGPT／internal AI host
```

把 source adapters、`packages/evidence`、`packages/semantic-engine` 與 decision computation
綁成 local bundle 或 Docker image；local stdio 給個人電腦，private HTTP 給 NAS／企業 VPC。

**驗收**：在沒有 hosted MCP 的情況下仍可完成 P3 三個情境，並測得 raw Evidence 不離開 user-controlled environment。

### P5 — Hosted MCP production boundary

讓一般使用者能從手機 AI App 連到 hosted Fitness MCP：

- Docker 化 Node HTTP server，公開 HTTPS `/mcp`。
- 完成 OAuth Resource Server：signature/JWKS、issuer、audience、expiry、scope。
- 接入外部 Authorization Server；MCP 不自己保存帳號密碼。
- 定義 `fitness:read`、`fitness:plan:write` 等 scopes。
- request body、tool arguments、Bearer token 不進 access log、APM 或 error trace。
- Hosted MCP stateless，或明確使用受控的外部狀態。

**驗收**：完成 `401 → metadata → OAuth → token → tools/list → tools/call`；錯誤 token、錯誤 audience、過期 token、缺 scope 正確回 401／403。

### P6 — Mobile AI coach connector journey

```text
Claude／ChatGPT Mobile
        ↓ Connect／登入／同意
AI host 取得來源 connector 的 Evidence
        ↓
Hosted 或 local/private Fitness MCP
        ↓ 結構化 Decision
        ↓
AI 以貼身教練口吻回覆
```

驗證使用者可從手機完成連線、授權、撤銷與重新授權；AI 能區分「查詢課表」、
「調整既有課表」與「沒有課表時的推薦」；connector 輸出能映射到 P2 Evidence；
Claude Desktop 的 local stdio 與手機的 remote HTTP 是兩條清楚的 deployment path。

**驗收**：用真實或固定 connector 跑完 P3 三個情境，從輸入到自然語言回覆可追蹤，但追蹤紀錄不含健康資料。

### P7 — Safety、privacy 與上架準備

完成 GDPR/controller-processor 角色分析、DPA、DPIA 評估、資料主體權利流程、
retention／跨境傳輸／subprocessor 文件、非醫療診斷聲明、incident response、
token rotation，以及 connector directory 的 OAuth、privacy URL、support、測試帳號與範例 prompts。

**驗收**：Privacy Policy、實際 request path、cloud logging 設定與 automated tests 對同一份 data-flow map；不一致不得上架。

### P8 — REST／SDK 與營運擴充

在 P6 使用旅程被驗證後再做 REST API／SDK、idempotency、rate limit、quota、
不含健康資料的 usage metering、source contract regression、MCP dual-era、pricing、tenant isolation 與 enterprise private deployment。

**優先級**：P1–P3 是核心；P4 是高隱私版本；P5–P6 是 hosted mobile distribution；P7 是上架 gate；P8 不得搶在核心旅程驗證前。

## 1. 已實作元件

248 tests pass，全部 dependency-free（Node 20+，無外部套件）。

| Package | 內容 |
|---|---|
| `packages/domain` | 核心模型：User / Goal / Preference / Injury / Equipment / Workout / HealthMetric，含 `assertValidUserContext` |
| `packages/semantic-engine` | `generateSemanticFitnessState`：recovery / readiness / fatigue / 分肌群疲勞 / 負荷。**訊號可得性自適應**——訊號過期即排除並重新正規化權重，如實下調 confidence，輸出 `signalCoverage`。基線由 `options.baselines` 注入，族群常數僅作 fallback |
| `packages/training-load` | **`computeTrainingLoad`**：ATL / CTL / TSB（指數移動平均）、ACWR ramp-rate、負荷分區，**detraining 為獨立軸線**（以本人近期 CTL 峰值為基準，須同時滿足閒置天數與體能流失，taper／deload 不誤觸）。**`computePersonalBaselines`**：由傳入的 health metrics 現算本人基線 |
| `packages/knowledge-graph` | 889 節點 / 5,785 邊。`graph.js`（替代／進退階／結構化檢索遍歷）、`workoutSchema.js`（Block/Set 結構與驗證）、`programTemplates.js`（參數化課表模板）、`resolveExercise`／`displayNameFor`（口語↔規格化命名）、`models.js` 的 `assertValidProgressions`／`assertUniqueExerciseNaming`／`assertValidTrainingGoals`（建圖時強制） |
| `packages/planning` | `generatePlan`（週期化 base→build→peak→deload）、`adaptPlan`（非破壞式 diff 預覽）、stateless patch validator（caller/external storage 持有版本） |
| `packages/connectors` | Apple Health（`export.xml` 串流解析）、**Strava**（OAuth API ＋ bulk export 兩種方言，後者按欄位索引解析並從 `.fit.gz` 還原本地 offset）、**Garmin**（readiness／daily summary／sleep／activities，含 sentinel 處理）的格式正規化 |
| `packages/evidence` | **Fitness Evidence Model**：跨來源證據契約 ＋ 轉內部 context |
| `packages/decision-engine` | **`decideSession`**：計畫 × 證據 → Decision/Action/Reason，結構性拒絕退化成推薦 |
| `packages/db` | PostgreSQL schema 與 row mappers（尚未接 runtime） |
| `apps/mcp-server` | **6 個對外決策 tool**（另 10 個 Content 端點已下架、仍可呼叫一版），JSON-RPC over stdio，含 `assertGrounded` 與 4KB payload 預算 |
| `/schemas` | 各 tool 的 input/output JSON Schema 契約 ＋ drift guard |
| `/eval` | 20 golden cases，5 個 gate（case pass／schema／grounding／plan validity／**plan → catalog**）全綠 |

**工具腳本**：`npm run build:graph`（重建知識圖譜）、`audit:graph`（品質稽核）、`import:apple-health`（本機匯入真實資料）、`eval`（評測計分）

**資料品質現況**：分類準確率 94.0%、替代合理率 100%（50 抽樣）、高負荷動作無禁忌 0 個、
策展核心進退階覆蓋率 82.1%（gate ≥ 70%）、訓練目標每節點平均 1.40 個且無目標挑不出動作
（gate）、plan → catalog 100%（gate）。

---

## 2. 偏差清單（審查結果）

> v4 的核心工作項。修完才繼續開發新功能。

### ~~D1 — 證據是自己讀檔~~ ✅ 已修

```
tool input:  userId, date                 ← 只有識別碼
server 內部: readFile("data/seeds/...")   ← 自己去拿資料
```

架構圖是 `使用者授權 → AI → tool call 帶證據進來`，實作是 `userId → 我們的檔案`。
等於我們是資料保管者，違反原則 1，且「permissioned」失去意義（沒有授權動作，只有查表）。

**已修**：`packages/evidence` 定義 Fitness Evidence Model；決策 tool 接受 `evidence` 參數，回應帶 `provenance` 標明來源。demo seed 降為明確標示的本機 fallback。

### ~~D2 — 沒有任何 tool 產出決策~~ ✅ 已修

| 欄位 | 13 個 tool 中有的 |
|---|---|
| `decision` / `action` / `evidence` | **0** |
| `confidence` | 3 |
| `signalCoverage` | 1 |

五層模型（Evidence→State→Decision→Action→Reason）**沒有一個實作到 Decision 層**，全部停在 State 或 Content。

**已修**：`packages/decision-engine` 產出 Evidence→State→Decision→Action→Reason；`assertValidDecision` 結構性拒絕「沒改動的非 keep 決策」與「沒有理由的決策」。

### ~~D3 — 13 個 tool，其中 8 個是 Content~~ ✅ 已修

`search_exercises` `get_exercise` `search_workouts` `get_workout` `get_user_profile` `get_training_history` `get_plan` `list_plans` — 回傳清單／詳情，違反原則 5，且超出 ≤10 上限。

**已修**：對外 **14 → 6**。Content 端點下架但仍可呼叫一個版本；新增 `decide_exercise_substitution` 承接替代能力，避免空窗。

### ~~D4 — recommend_workout 是 Recommendation~~ ✅ 已修

現況回「今天適合低衝擊 Zone 2」——憑空發出、無 from→to、無 prior state。GPT-6 也做得到。

**已修**：`decide_session` 上線，`recommend_workout` 下架為 deprecated。

### ~~D5 — eval 零外部增益~~ ⛔ 已取消（決策）

原本規劃裸模型 vs 模型＋MCP 的 A/B 評測。**取消，理由有二**：
1. 那是在測 Claude / ChatGPT 的腦，不是測我們的產品。
2. 執行它必須呼叫 LLM API，與 **D-LLM「系統內不含 LLM」** 相衝突。

**改為**：承諾 B 的衡量方式從「模型對照」改成「**決策可驗證性**」——決策規則是確定性的，正確與否由測試直接驗證（`assertValidDecision` ＋ 248 個測試）。
另補上 **MCP client 相容性驗證**（見下）取代連通性層面的疑慮。

> **D1 與 D2 同一個根因**：系統是照「我們有使用者資料庫，AI 來查」設計的（傳統 SaaS），不是照「AI 帶授權證據來，我們回決策」設計的（intelligence layer）。**架構圖畫的是後者，程式蓋的是前者。**

---

## 3. 護城河缺口

| # | 能力 | 現況 | 缺口 |
|---|---|---|---|
| 1 | Semantic Fitness Layer | 🟡 | 證據契約已就位（D1 已修）；**3/6** 來源解析器（＋Garmin），來源格式與統一詞彙已有 schema 與方言等價驗證。**這是護城河，不是苦工**——理由見 3.5 的訂正段 |
| 2 | Fitness Intelligence Engine | 🟢 | 確定性且產出五層決策（D2 已修）；ATL/CTL/TSB ＋ detraining 軸線 ＋ 個人基線已上（Phase 4 前兩項） |
| 3 | Fitness Knowledge Graph | 🟢 | 889 節點 / 5,785 邊。**進退階已補齊**（7 → 34 條，17 組互逆，策展核心覆蓋 82.1%，帶不變量把關）；**命名層已統一**（規格化 id ↔ 口語別名）；**訓練目標已上**（節點屬性，接進 plan fallback 與替代決策）。相似度邊佔 89.4%，但那是匯入節點的設計結果（見 Phase 4.3） |
| 4 | Feedback Learning | 🔴 | **零**。無「狀態→決策→結果」記錄與閉環 |
| 5 | Multi-LLM Interface | 🟡 | MCP stdio ＋ Streamable HTTP 已上；**無 REST API、無 SDK**。OAuth **資源伺服器那半已完成**（`b37027e`），缺的是簽章驗證器、進入點接線、authorization server —— 見 7.1 |

---

## 3.5 價值、護城河、獨特性、機會（v6 新增）

### 核心概念（使用者 2026-07-30 定調，原話為準）

> 知識的輸出現在已經沒有價值，任何問 AI 馬上有答案。
> 但要做到**輸入的數據有結構化、標準化**，馬上可以立刻找到 `acwr = atl / ctl`。
> 這一個除法——來說明近期負荷除以長期負荷。算出的數值 = readiness、分肌群疲勞。
> **Claude 已經可以組成完整的中文理由句子**「急慢性負荷比 X 高於 1.4，近期負荷上升過快」，
> 然後用白話回應給 user。**這是我做 Evidra 的核心概念。**

**三段分工照這句話切：**

| 段 | 誰做 | 內容 |
|---|---|---|
| 1 | **我們** | 把散在 Garmin／Apple／Google／Strava 的資料做成**結構化、標準化的一份** |
| 2 | **我們** | **確定性計算**——`acwr = atl / ctl` 就是一個除法，不需要模型 |
| 3 | **Claude** | 組句子、用白話講給使用者聽 |

> 🔴 **現況與第 3 段有落差，待使用者決定，不得自行改。**
> 引擎目前自己在寫中文理由句子（`decideSession.js` 的 `reason.push(...)` 是中文模板）。
> 若語言交給 Claude，引擎應只回結構化數值與觸發的規則。列為 4.5-A5。

> **寫法規則**：每一條標明是**已驗證**（有指令／讀碼／官方文件出處）還是**主張**（尚未驗證）。
> 主張不得當成已驗證的事實引用到別處。

### 價值：缺口在「誰握著今天原本要做什麼」

**已驗證（官方頁原文）**：Strava MCP **Access coming soon**、逐步開放中、**目前只連
Anthropic Claude**。定位是「問 Claude 關於你的 Strava 表現」，由 **Claude** 去看訓練模式、
給改進建議。**建議由 Claude 產生，不是 Strava 的引擎產生。**

**已驗證**：本專案的 Decision 定義（CLAUDE.md）是 **from → to，對既有狀態的變更**，
前提是知道「今天原本要做什麼」。沒有這個前提，能生出來的只有推薦。

**因此缺口是具體的**：來源方給資料、host model 會推理，但**沒有任何一方持有那份計畫**。
這是 Evidra 佔的位置。

> ✅ **2026-07-30 已修正 runtime 邊界。** `packages/planning/src/planStore.js` 現在是
> **無狀態 patch/preview validator**，不含 `Map`、cache 或 process-lifetime plan；
> caller／外部 storage 持有 plan 與版本歷史。`packages/db` 的 PostgreSQL schema
> 尚未接 runtime，屬部署層持久化工作，不由 MCP core 偷渡保存。

### 護城河：GPT-6 判準的三樣，只有兩樣是我們的

| 大型模型自己做不到的三件事 | 我們的實況 | 依據 |
|---|---|---|
| **證據** | ✅ **是，但不是「擁有資料」那個意思**——是**同時讀懂四家並對齊成一份**。見下方訂正 | 已驗證（實測 Apple Health 匯出、Strava 官方頁） |
| **計算** | ✅ 是。ATL/CTL/TSB、detraining 獨立軸線、個人基線，確定性、零外部 API、0.443ms | 已驗證（實測，Phase 8） |
| **保證** | ✅ 是，且更難複製。同證據永遠同決策，理由綁回證據，輸出帶 confidence／signalCoverage／limits | 已驗證（G3 gate、248 tests） |

**知識圖譜 889 節點不列為護城河。** GPT-6 知道所有動作。它的價值在**不變量**
（進退階互逆、禁忌把關、plan → catalog 100%）讓替代決策**可被驗證**，不在節點數。
把節點數當護城河講，就是 R2「滑回內容庫」正在發生。

#### 訂正：「證據」那一列先前寫錯了

> v6 初稿寫「證據不是我們的護城河，Strava 給得比我們拉得到的完整」。**兩句都錯。**

**資料實際的流向是這樣**——手錶是源頭，平台全是下游：

```
Garmin 手錶 / Apple Watch          ← 真正的量測源頭
   │  Garmin Connect / Connect IQ
   ├──→ Apple Health     （聚合容器，本身不量測）
   ├──→ Google Health    （聚合容器，本身不量測）
   └──→ Strava           （只收運動）
```

| 平台 | 有 | 沒有 |
|---|---|---|
| **Strava** | 運動當下的資料（活動、逐秒心率與配速、Relative Effort） | **靜息心率、睡眠、HRV、全日心率全都沒有** |
| Apple Health／Google Health | 多裝置寫入的聯集 | 本身不量測；有什麼取決於哪些裝置在寫 |
| Garmin Connect | 最完整（含睡眠、HRV、readiness） | **沒有官方 MCP connector** |

**已實測佐證**：使用者的 Apple Health 匯出中，來源名稱 `Connect`（Garmin）寫入 30,198 筆
心率、41 筆睡眠（**睡眠 100% 來自 Garmin**）；HRV 只有 Apple Watch 有。iPhone 量不到這些。

**所以正確的說法是**：

- 「**擁有**原始資料」不是我們的護城河，也不該是（D-EVIDENCE）。
- 但「**同時讀懂四家 schema、對齊成同一份 canonical evidence**」**是**——而且
  **只有站在 AI 那一層的中立第三方做得到**。Strava 只看得見自己的資料，Garmin 也只看得見
  自己的。四家唯一會同時出現的地方，是使用者的 AI client。**我們是那裡被呼叫的工具。**
- 同一個使用者的同一筆心跳，會以四種名稱、四種單位、四種取樣頻率出現在四個平台，
  而且互相同步、彼此重複。**沒有任何來源方有動機去對齊別人家的格式。**

**這條把 Semantic Fitness Layer（護城河 #1）從「苦工」升回「護城河」。**
它的價值不在支援幾家，在於**同一天的資料從不同來源進來，正規化後必須產生完全相同的
canonical evidence**（方言等價，見 Phase 5）。這一條做不到，多接幾家也只是一堆特例。

### 獨特性（主張，尚未對外驗證）

**不是更聰明的教練，是不會改口的那一個。** 同一份證據，週二與週四給同一個答案；
理由指得出是哪一條證據、哪一個門檻。在健康領域這是責任問題，不是體驗問題。

> **這條要靠可檢查的性質論證，不是靠跟裸模型比分數**（R1 已於 v6 結案）。
> 三項都跑兩次就驗得出來：同資料同答案、理由指得出是哪個數字對哪條門檻、
> 確定性程式說服不了。**模型好不好由使用者自己判斷，不好就換模型——那不是我們的變數。**

### 機會（已驗證的三項外部條件）

| # | 事實 | 對我們的意義 |
|---|---|---|
| 1 | 來源方自己在做 connector（Strava 2026-06、COROS 2026-05） | **最貴的那一段有人免費補上**。每多一家，可用證據變大而我們不寫程式 |
| 2 | Anthropic Connectors Directory **無上架費、無抽成** | 分發免費；金流要自己做 |
| 3 | 成本隨**人數**變動、不隨呼叫次數（實測 0 次外部 API） | 可以支援「隨時問」而不怕帳單。接 LLM API 的競品每次呼叫都要付費，做不到 |

### 商業模式機會（v6 新增）

#### 先看清楚 Strava 的 MCP 模式是什麼

**已驗證（官方頁原文）**：Strava 自己 host remote MCP server，**Access coming soon**、
逐步開放、**目前只連 Anthropic Claude**；由 **Claude** 對使用者的 Strava 表現看模式、給建議。

**所以那個 connector 不是新的收入品項，是既有訂閱的加值與留存工具。**
他們用「你的資料現在可以在 Claude 裡問了」來留住訂閱，把推理讓給 host model。

**我們沒有既有訂閱可以加值，所以不能直接照抄。** 但它替我們留下了一塊空地：
**它明講自己不做決策。**

#### 同業盤點：Peloton · Strava · Garmin（2026-07-30 查證）

| | 官方 MCP | 實況 |
|---|---|---|
| **Strava** | 🟡 逐步開放中 | 官方頁寫 **Access coming soon**、**目前只連 Anthropic Claude**；建議由 **Claude** 產生 |
| **COROS** | ✅ 2026-05 | `mcp.coros.com` |
| **Peloton** | ❌ **沒有官方** | 全是社群作品。`@striderlabs/mcp-peloton` 用 **Playwright 瀏覽器自動化**（等於爬網頁）；另有數個接非官方 API 的版本 |
| **Garmin** | ❌ **沒有官方** | 開發者論壇有正式 feature request；社群版本多個，其中一個 **61 個 tool／7 大類**，建立在逆向工程的 `python-garminconnect` 上，**用帳號密碼登入而非 OAuth**；另有第三方雲端代管的 Garmin Chat Connector |

> **宣言原本拿 Peloton 當對照，但 Peloton 根本沒有官方 MCP**——那個對照講的是社群作品。
> 已改為 Strava（官方、可查證）。

**Garmin 論壇那串裡有兩件對我們直接相關的事：**

1. 討論中提到 Garmin 可能顧慮**與自家 Connect+ 付費服務衝突**——這解釋了為什麼擁有最完整
   資料的一家反而最慢。
2. 有使用者回報：**Claude 依照傳入的 Garmin 資料做出會隨資料調整的個人化訓練計畫，
   表現勝過 Garmin 自己的建議**。

> 第 2 點是**需求存在的證據**，但要看清楚它證明了什麼：它證明使用者要的是「隨資料調整的
> 計畫」，**不證明那個做法是可靠的**——由模型自由推理產生的計畫，換一天問就會換一個答案，
> 而且沒有紀錄可回溯。**這正是 from → to ＋ 綁回證據要解決的問題。**

**共同模式**：不論官方或社群，**現有的全部是資料存取層**（Garmin 那個有 61 個 tool，
就是把 API 端點一個個包出來）。**沒有一個做決策層。**

#### MCP 的金流現況（2026-07-30 查證，會變動，屬於本文件不屬於宣言）

| 管道 | 現況 |
|---|---|
| **Anthropic Connectors Directory** | 無上架費、無抽成機制 |
| **MCPize** | 專做付費 MCP 的 marketplace，**分潤 80–85% 給開發者** |
| **Apify** | 一級 MCP 代管，pay-per-event，**開發者拿 80%** 扣除平台運算成本 |
| **Glama** | 免費瀏覽／本機安裝；**代管版本可收費** |
| **Smithery** | 目錄最大，但創作者付 $30/月且**無分潤** |
| **付款軌道** | **x402**（USDC 按次付費）· **Stripe MPP**（法幣 session 計費） |
| **計費基礎建設** | Moesif（按次／訂閱＋超額／**按成功結果計費**）· Nevermined（原生整合進協定） |

**市場脈絡**：MCP SDK 從 2024-11 的每月約 200 萬次下載，到 2026 年初超過每月 9,700 萬次。
但截至 2026-06，**已上線的數千個 MCP 幾乎全部免費——所以幾乎沒有一個是生意。**

> **對我們的意義**：marketplace 分潤這條路**現在就有人在做**，不是等 Anthropic。
> 而且「按成功結果計費」這種模式與我們的成本結構相容——但要能計費就要先能計量，
> 計量的欄位界線見 Phase 8（`userId · 時間 · tool 名 · 次數`，不含健康資料）。

#### 四條路（皆為主張，附各自立論的已驗證事實）

| # | 模式 | 立論依據（已驗證） | 難點 |
|---|---|---|---|
| **1** | **直接對使用者**：目錄上架，訂閱制 | 目錄無上架費無抽成；成本隨人數不隨次數（實測 0 次外部 API），可支援「隨時問」 | 定價天花板——使用者已在付 Claude 訂閱，我們是第二筆。且需先過 C5＋7.1＋7.2＋Team 帳號 |
| **2** | **賣給來源方**（授權決策引擎給 Strava／Garmin／COROS 等，掛在他們自己的 connector 後面） | Strava 把建議交給 Claude 產生；**Garmin 完全沒有官方 connector**。想在自家 connector 後面放確定性決策，就要自建或授權 | 企業銷售，週期長。且對方可能選擇自建 |
| **3** | **賣給握有課表的一方**（教練平台、健身房、企業健康方案） | 決策必須有「今天原本要做什麼」才成立；**這些對象本來就握著課表**，正好補上我們最缺的 C5 | 需要 REST API／SDK（Phase 7 未做），不只 MCP |
| **4** | **API／SDK**（D-INTERFACE 已列） | 對外介面不該只有 MCP | 尚未開始 |

#### 這裡有一個結構性的優勢，四條路都吃得到

**單一來源方永遠對齊不了四家格式，因為他們沒有動機、也拿不到別人的資料。**

- Strava 拿不到睡眠與 HRV（那在 Garmin Connect 與 Apple Health）
- Garmin 拿不到使用者在 Strava 上的活動
- Apple／Google 是容器，不做跨來源語意對齊

**四家唯一會同時出現的地方，是使用者的 AI client。** 我們是那裡被呼叫的工具——
這個位置不是誰讓給我們的，是架構本身決定的。

> ⚠️ 上面四條都是**主張**，尚未對外驗證。
> 但**不再卡在「先證明比裸模型好」**——R1 已於 v6 結案，理由見風險表。

### 開發主軸：以 user journey 為準，不以內部完成度為準

> **2026-07-30 訂正。** 先前這裡的排序是從內部完成度推出來的（gate、協定版本、金流）。
> **開發主軸是 [user-journey.html](user-journey.html) 的「Before The Chain」那張表**
> ——使用者實際走的六個步驟。不在那條路徑上的事，使用者感受不到，stakeholder 也看不到。

**使用者實際的六步，以及誰負責：**

| 步驟 | 做的人 | 現況 |
|---|---|---|
| 在手機開 Claude 說「今天該練什麼」 | Anthropic | ✓ 已存在 |
| **Claude 連上 Evidra** | **我們** | **✗ 唯一一個我們做得完、卻還沒完成的** |
| 取得 Apple Health 資料 | Claude app 的 HealthKit 權限 | 不在我們手上 |
| 取得 Garmin Connect 資料 | Garmin OAuth，授權對象是 host | 不在我們手上 |
| 證據以參數進入 tool call | 我們 | ✓ 已完成 |
| 五層決策 | 我們 | ✓ 已完成 |

**所以下一步只有一件事：讓 Claude 連得上。**

1. **7.2 公開部署 ＋ 7.1 OAuth 補完** ← **主軸上唯一未完成的一步**
2. **Phase 8 上架清單** ← 連得上之後才有人找得到（Team 帳號與隱私政策與程式無關，可平行）
3. **user-journey 補上已完成的功能**（提議評估、心率區間分佈，見 4.5-C3）
   ← 這份文件同時是需求書與對 stakeholder 的說明，內容落後就是需求說明落後

**以下不在主軸上，不得排在前面：**

| 項目 | 為什麼不在主軸上 |
|---|---|
| Phase 9 協定升級 | 使用者感受不到。**唯一的例外**：7.1 選 authorization server 時要照它的結論挑（支援 CIMD），那是一個選型條件，不是一個階段 |
| marketplace 金流研究 | 商業模式評估，不是使用者路徑 |
| 內部 gate 增修 | **不再新增 gate**。gate 是宣告完成前的檢查，不是開發方向 |

> C5（計畫持久化）與 C6（證據來源形狀）**在主軸上，但位置要看使用者路徑決定**：
> 兩者都影響「連上之後決策做不做得出來」，不影響「連不連得上」。連上之前先不動。

> **這份分析指向 Phase 6（Feedback Learning）與宣言 L55 的衝突**：若計畫與決策紀錄
> 要持久化，B1 就必須先有結論。**使用者已指定 B1 另開 session 討論，此處只標示指向，
> 不展開。**

---

## 4. Phase 順序

### 盤查表（v6，2026-07-30）

| Phase | 狀態 | 已完成 | 未完成 |
|---|---|---|---|
| 1 修架構級偏差 | ✅ 完成 | 證據經 tool call 傳入；五層決策契約 | — |
| 2 工具面收斂 | ✅ 完成 | 14 → 6 個對外 tool | — |
| 3 證明增益 | ✅ 完成（已改範圍） | 改為 MCP client 相容性驗證 | 原本的裸模型對照已取消，**取消理由第 2 條對宣言不成立**（見 4.5-B2） |
| 4 決策深度 | ✅ 完成 3/3 | 訓練負荷模型、個人基線、知識圖譜語意關係 | — |
| 5 多來源正規化 | 🟡 進行中 | 3/6 來源有解析器（Apple Health／Garmin／Strava，Strava 兩種方言）；心率區間分佈 | 其餘 3 家（Oura／Whoop／Google Health Connect）只有 registry 宣告；**G5 紅**：Apple Health 與 Strava 缺 source schema 與 scenario（4/4 只做到 2/4） |
| 6 Feedback Learning | 🔴 未開始 | — | 全部。**且與宣言衝突未解**，使用者指定另開 session 討論（4.5-B1） |
| 7 Multi-LLM Interface | 🟡 部分完成 | stdio；Streamable HTTP；OAuth 資源伺服器那一半 | 7.1 三缺口（簽章驗證器空著／進入點沒接線／沒有 authorization server）；7.2 公開部署；REST API；SDK |
| 8 商業化 | 🔴 未開始 | 成本已實測；上架清單已查證；**計價單位暫定 per-MAU（2026-07-31）** | 14 項上架前置只有 icon ✅、tool annotations ✅；計價定案待 Claude／Codex 的 MCP server 商業文件 |
| 9 協定升級 2026-07-28 | 🔴 未開始（v6 新增） | — | 全部。做法已定：dual-era |

**下一步的順序由 user journey 決定，不由 Phase 編號決定**（見 3.5「開發主軸」）：
**7.2 公開部署 ＋ 7.1 OAuth** 是使用者六步裡唯一我們做得完卻沒完成的一步 →
接著 Phase 8 上架清單 → user-journey 補上已完成功能。
Phase 9 不在主軸上；它唯一的作用是給 7.1 的 authorization server 選型一個條件（支援 CIMD）。

### ~~Phase 1 — 修架構級偏差（D1 + D2）~~ ✅ 完成
證據經 tool call 傳入、五層決策契約上線。外部使用者（server 檔案中不存在）可純靠傳入證據取得完整決策。

### ~~Phase 2 — 工具面收斂（D3 + D4）~~ ✅ 完成
對外 6 個 tool：`assess_fitness_state`、`decide_session`、`decide_exercise_substitution`、`generate_plan`、`preview_adjust_plan`、`commit_adjust_plan`。

### ~~Phase 3 — 證明增益~~ ✅ 改為 client 相容性驗證（已完成）

不做模型評測（見 D5）。改為確認 MCP client 接得上，實測後修掉三個協定問題：

| 問題 | 影響 | 已修 |
|---|---|---|
| 對 notification 回應 | 每個 client 握手後都送 `notifications/initialized`，回它違反 JSON-RPC | 無 id 一律不回應 |
| 不支援 `ping` | client 保活失敗 | 回空 result |
| protocolVersion 寫死 | 新版 client 被靜默降級 | 協商，支援 2025-06-18 / 2025-03-26 / 2024-11-05 |

**驗收（已通過）**：以子行程模擬 Claude Desktop 完整流程——handshake → initialized 通知 → tools/list → generate_plan → decide_session，取得帶 from→to 的決策。

### ~~Phase 4 — 決策深度（護城河 #2 #3）~~ ✅ 完成（3/3）

> 原驗收條件是「lift 相對 Phase 3 基準再提升」。**該條已失效**——lift 的量測方式是
> D5 取消的裸模型 vs 模型＋MCP 對照，執行它必須呼叫 LLM API，與 **D-LLM** 相衝突。
> 下面依 D5 的替代原則（決策可驗證性）重寫。

#### ✅ 4.1 Training Load Model — 已完成

`packages/training-load/src/trainingLoad.js`，接線於 [`toolHandlers.js`](../apps/mcp-server/src/toolHandlers.js)。

| 產出 | 內容 |
|---|---|
| ATL / CTL / TSB | 指數移動平均，由傳入證據中的 workouts 現算（hosted 不落地，符合 D-DATA） |
| ACWR ramp-rate | 急慢性負荷比，作為升載安全閥 |
| 負荷分區 | `LOAD_ZONES`，資料不足時回 `insufficient_history` 而非猜一個分區 |
| **detraining 獨立軸線** | 見下 |

**detraining 不是 TSB 的一個帶**。TSB = CTL − ATL 是差值，ATL 觸底後會跟著 CTL 一起
回到 0——舊版 `TSB >= 25` 的判法讓休兩週讀作 "fresh"、休六個月讀作 "neutral"，
**離開越久越健康**。現以本人近期 CTL 峰值為基準，同時要求「閒置天數」與「CTL 流失
百分比」兩個條件，taper 與 deload 因此不會誤觸。

兩個呼叫端一併補上這個軸線：

- `decideSession` — 原本只讀恢復訊號（休息中當然全部漂亮，且 ACWR=0 對 ramp-rate
  規則是最安全值），照原樣發出高強度課表。現在降強度與量，且不對「只是很新鮮」的人
  提議進階。
- `generateTrainingPlan` — 原本無視訓練史，每份計畫從滿載 base 開頭。現在偵測到
  起始前有中斷時走 return ramp。

#### ✅ 4.2 個人基線取代寫死常數 — 已完成

`computePersonalBaselines(healthMetrics, { asOf })` 由傳入證據現算本人基線，經
`toolHandlers` 注入 semantic-engine 的 `options.baselines`。`DEFAULT_BASELINES`
（含原本的 `hrvMs: 52`）降為**證據不足時的 fallback**，不再是唯一來源。

> 與 D-DATA 一致：基線是**每次呼叫現算**的，**hosted service 不保存任何人的基線**。
> Phase 2 若要把基線落地，那是使用者控制環境裡的事，不改變 hosted 這一側。

#### ✅ 4.3 知識圖譜語意關係 — 已完成

**缺的是資料不是程式**：`graph.js` 的 `findSubstitutes` 早就會查 `REGRESSES_TO`
（`graph.js:109`，權重 0.6），也已導出 `getProgressions` / `getRegressions`。
遍歷路徑一直都在，缺的是可走的邊。

##### 負面結果：進退階生不出來，只能標註

試過三條在 vendored 資料屬性上的生成規則（同群＋同器材＋skill +1；同群＋同器材＋
單邊化；同群＋器材階梯 +1），以及一條以動作名稱主幹為錨的規則。全部失敗：

| 規則 | 產出 | 樣本 |
|---|---:|---|
| skill +1（同器材） | 1,360 條，最大扇出 25 | `3/4 Sit-Up → Russian Twist` |
| 器材階梯 +1 | 2,380 條，最大扇出 25 | `3/4 Sit-Up → Cable Crunch` |
| 名稱主幹＋skill +1 | 214 條，最大扇出 4 | `Cable Shoulder Press → Dumbbell Shoulder Press`（換器材，不是進階）<br>`Close-Grip Dumbbell Press → Alternating Kettlebell Press`（主幹 "press" 把胸推和壺鈴過頭推併在一起） |

**根因**：free-exercise-db 的 `level` 是**單一動作的難度標籤**，不是動作家族內的順序；
資料裡也沒有家族欄位可當錨。任何在這組屬性上的規則，本質都是「相似度加一個方向」——
正是本節開頭警告的那件事。**進退階是策展關係，不是可推導關係。**

##### 已做：策展階梯 ＋ 資料層不變量

- 補 4 個缺的橫檔節點：`Incline Push-up`、`Dumbbell Shoulder Press`、
  `Band-assisted Pull-up`、`Lat Pulldown`（`Pull-up` 與 `Overhead Press` 原本
  **沒有任何退階可退**）
- 進退階 **7 → 34 條**（17 組互逆），涵蓋 squat／hinge／horizontal_push／
  vertical_push／vertical_pull／horizontal_pull／locomotion
- `assertValidProgressions`（`packages/knowledge-graph/src/models.js`）在**每次
  建圖時**強制四條不變量，這是擋住「相似度改包裝」的實際機制：

  | 不變量 | 擋掉什麼 |
  |---|---|
  | 互逆 | 只能爬不能退的階梯——`findSubstitutes` 找的是退階，單向等於沒有 |
  | skill 沿 `PROGRESSES_TO` 非遞減 | 進階回傳一個更簡單的動作 |
  | 不得互為對方的進階 | 矛盾邊 |
  | 無環 | 「比自己難」，且會讓找下一階的呼叫端無限繞 |

  修這件事時就抓到一條真實壞資料：`deadlift REGRESSES_TO romanian_deadlift`
  當時沒有反向邊。

- `npm run audit:graph` 新增階梯覆蓋率並納入 gate。**覆蓋率只在策展核心上量**——
  匯入節點依設計只帶相似度邊。現況 **23/28 = 82.1%**（gate ≥ 70%），
  未覆蓋的只有 `mobility`。

##### ✅ 已做：三層命名（規格化 / 對照 / 口語）

原本兩份動作名單各自獨立誕生：計畫引擎（`86afe50`）先寫，知識圖譜（`c7af0de`，同日
稍後）另起一份，用了器材限定的精確命名。`exercises` 欄位存的是**自由文字不是外鍵**，
所以沒有任何機制擋下漂移，CI 也不會叫。

| 層 | 欄位 | 例 | 規則 |
|---|---|---|---|
| **規格化** | `id` | `exercise_bent_over_row` | 決策、儲存、比對一律只用它。永久固定 |
| **規格化拼寫** | `name` | `Bent-over Barbell Row` | 精確、帶器材限定，兩個變化式不會撞名 |
| **口語顯示** | `displayName` | `Bent-over Row` | 只用於輸出 |
| **口語輸入** | `aliases[]` | `barbell row`／`rdl`／`easy walk` | 使用者怎麼講都收，一律映射回 id |

- `graph.resolveExercise(任意說法)` 是自由文字變成 id 的**唯一入口**；
  `graph.displayNameFor(id)` 是 id 變成人話的唯一出口。
- 課表模板改存 `exerciseId`；session 同時輸出 `exerciseIds`（規格化）與
  `exercises`（口語，由前者導出，不另行撰寫）。
- `decideSession` 的 `RECOVERY_MOVEMENTS` 寫死字串改為 canonical id。
- **「多久／多重」不進動作身分**：Long Zone 2 Run 是 Zone 2 Run 跑久一點
  （`baseMinutes`／`longSession`），所以是別名；Tempo Run 是不同的訓練刺激，
  所以是**自己的節點**。
- 端到端實測：口語 `["barbell row","rdl","bench press"]` →
  `["exercise_bent_over_row","exercise_romanian_deadlift","exercise_bench_press"]` →
  口語 `["Bent-over Row","Romanian Deadlift","Bench Press"]`。

**這一層抓到的既有壞資料**：`assertUniqueExerciseNaming` 一上線就擋下建圖——
匯入資料與策展核心有 **12 組同名節點**（Goblet Squat、Leg Press、Romanian Deadlift…），
同一個動作在圖上存在兩份、各有不同 id，`search_exercises` 會回兩次。build script 原本
只用 id 去重；已改為以名稱／別名去重，策展版優先。

**驗收**：eval 的 plan → catalog 由診斷升為 **gate**，62.5% → **100%**。

##### ✅ 已做：訓練目標屬性

依前述建議做成**節點屬性**（`trainingGoals`），不新增邊型別：「這個動作服務什麼目標」
是動作自己的性質，與 `equipment`／`contraindications` 同類；「A 換成 B」現有 8 種
`conditions` 已能表達。

**值域五個而非四個**：`strength`／`hypertrophy`／`power`／`endurance`／`mobility`。
原本規劃的四個沒有 `power`——但資料裡有 61 個 plyometrics 與 35 個 olympic
weightlifting，四值域只能把爆發力動作誤標成肌力。**寧可多一個值域，不要製造壞資料。**

| 來源 | 怎麼標 |
|---|---|
| 策展核心 28 節點 | 手寫 |
| 匯入 861 節點 | 由 vendor 自帶的 `category` ＋ 已導出的 `movementPattern` 映射 |

這裡與進退階的差別要講清楚：**進退階生不出來是因為資料裡沒有家族順序**（見上節負面
結果）；訓練目標則是 `category` 直接說了的事——stretching 服務活動度、cardio 服務耐力、
olympic 服務爆發力。唯一的判斷是複合／單關節：多關節動作同時服務肌力與肥大，單關節
動作不是任何人練最大肌力的方式。**次數與負重決定其餘，而那些長在課表上，不在動作上。**

`assertValidTrainingGoals`（建圖時強制）四條不變量：

| 不變量 | 擋掉什麼 |
|---|---|
| 值必須在值域內 | 打錯字的目標不會炸，只會靜靜地匹配不到任何動作 |
| 至少一個 | 沒標的動作永遠不會被挑到，等於對這層查詢隱形 |
| **最多三個** | 宣稱服務所有目標的動作，被換進來時什麼都沒保住 |
| pattern 的定義性質必須在 | 跑步必須是耐力、活動度流程必須是活動度、增強式必須是爆發力 |

第三條是這個屬性最需要活過的失效模式：**把每個節點都標滿，覆蓋率就會好看。**

**接到決策路徑**（否則只是死資料）：

- `generate_plan` — slot 宣告自己服務什麼目標。原本某個 slot 的動作被器材或 avoid
  偏好刷光時，一律退回寫死的 `exercise_bodyweight_squat`：**上肢肌力日會變成深蹲**，
  是一份課表，但不是原本排的那份。現在先向圖譜要一個服務同一目標的動作，要不到才退回
  寫死值，而且兩種情況都寫進 session rationale。
- `decide_exercise_substitution` — 替代品若不保住原目標，寫進 `limits`（承諾 A）。
  受傷時把跑步換成走路仍是對的決策，但呼叫端必須知道刺激換掉了。
- `graph.searchExercises({ trainingGoal })`／`findSubstitutes({ preserveTrainingGoal })`。

**驗收**：`audit:graph` 兩條新 gate——**沒有任何目標是零動作**、**沒有任何目標在無器材
條件下挑不出東西**（那正是 fallback 會發的查詢）。目標分佈與「每節點平均目標數」列為
診斷：現況 **1.40**，沒有標滿。

#### 驗收（重寫）

這一層的驗收是「**決策可被驗證**」，不是「決策更準」。沒有 ground truth，也不做模型
對照（D5）；能驗的是規則是否確定性、輸出是否自我解釋、退化是否誠實。

| # | 驗收條件 | 量測方式 |
|---|---|---|
| A1 | 同一組證據重複呼叫，決策完全相同 | 既有測試即為確定性斷言 |
| A2 | 每個非 `keep` 決策都帶 from→to 與可追溯的 reason | `assertValidDecision` 結構性拒絕 |
| A3 | 證據不足時回退化標記，不猜數值 | `insufficient_history` ／ `signalCoverage` ／ `missing` |
| A4 | 負荷指標所依據的每個訊號都出現在 `provenance` | eval grounding gate |
| A5 | ✅ 進退階可從圖上走通，且每條階梯上下都通 | `audit:graph` 階梯覆蓋率 gate（≥ 70%，現 82.1%）＋ `assertValidProgressions` 四條不變量 |
| A6 | ✅ 退階請求回真實的退階動作，而非相似動作 | `graph.test.js`：`exercise_pullup` 的退階必須是 `exercise_assisted_pullup`（beginner／同 pattern） |
| A7 | ✅ 決策與計畫排出的每個動作都指得到圖上節點 | eval `planExerciseCatalogCoverage` 已升為 gate（100%）＋「every movement a plan can prescribe exists in the catalog」測試 |
| A8 | ✅ 動作被換掉時訓練刺激不會靜靜消失 | `audit:graph` 目標可挑性 gate ＋ `assertValidTrainingGoals` 四條不變量 ＋「a slot that loses its movements keeps its training goal」測試 |

> **訂正（v5.1）**：A5 原本寫的是「`SIMILAR_TO` 佔比上限」。該指標作廢——它假設
> 生成器會補出大量語意邊來稀釋佔比，而 4.3 的負面結果證明生成器**不該**補進退階。
> 全圖 89.4% 的相似度佔比是匯入節點的設計結果，不是缺陷，壓低它只能靠刪資料或造假邊。
> 改以**策展核心的階梯覆蓋率**衡量——那才決定「要求退階時答不答得出來」。
> 佔比仍列在 audit 輸出中，作為診斷而非 gate。
>
> 原則不變：**不得為了通過門檻而回頭放寬自動生成規則**。這條現在由
> `graph.test.js` 的「generated nodes must not carry progression edges」直接把關。

### Phase 5 — 多來源正規化（護城河 #1）🟡 進行中
- Oura / Whoop / Google Health Connect 格式解析 —— **Apple Health／Garmin／Strava 已完成**（3/6 來源，其餘三家 registry 已宣告映射但無解析器）。Strava 兩種方言各自解析：OAuth API 與 bulk export
- 跨來源語意對齊（同一個 HRV，各家名稱／單位／取樣頻率統一）
- **證據由 tool call 傳入，不做 OAuth 拉取**
- **驗收**：同一使用者接不同來源，決策語意一致；訊號衝突有明確優先序

> **來源方自己在做 connector（2026-07-30 查證，v6 補記）。** Strava 有官方 remote MCP
> server，**Access coming soon、逐步開放中、目前只連 Anthropic Claude**；COROS 2026-05
> 亦已推出（`mcp.coros.com`）；Garmin 無官方，論壇有 feature request。
>
> **它給什麼**（官方說明頁）：活動歷史、fitness trends、**training load**、**readiness
> metrics**、目標進度、跨運動比較、裝備。逐秒心率與配速的 full stream。
>
> **建議由誰產生**：官方頁的說法是「問 Claude 關於你的 Strava 表現」，用它來找訓練模式、
> **給改進建議**、加油打氣。**產生建議的是 Claude，不是 Strava 的引擎。**
> Strava 供資料，Claude 推理——那是 recommendation 的形狀（憑語言推測、無既有計畫可比對、
> 換一天問會換一個答案），與 from → to 的 decision 不是同一件事。
>
> **兩者是同一條管線上相鄰的兩段，不是競爭關係。** 使用者的 Claude 同時裝著兩個 connector：
>
> ```
> 使用者問 Claude
>   → Claude 向 Strava connector 取證據（近 30 天活動、逐秒心率、Relative Effort）
>   → Claude 把證據當參數呼叫 Evidra：decide_session({ evidence, scheduledSession })
>   → Evidra 回 from: Tempo Run 45min high → to: Zone 2 Run 45min low，reason: ACWR 2.1 > 1.4
>   → Claude 用人話講給使用者聽
> ```
>
> **能推出的結論有兩條**：
>
> ① **不要自建來源 connector。** 來源方給得比我們拉得到的完整（我們拉不到逐秒串流），
> 自建既違反 D-EVIDENCE 也是多餘的。
>
> ② **架構有一個我們自己不擁有的前提，這個前提現在成立了。** 整份設計建立在「證據會抵達
> AI 那層，而且不是我們去 fetch」之上——但**誰把證據送到 Claude 手上，從來不是我們能決定
> 的**。2026-06 之前那是假設，管線第一段是空的，只能靠使用者手動匯出撐著。Strava 與
> COROS 上線官方 connector 之後，**該前提對至少兩個來源已從假設變成可觀察的事實**。
> 且 Strava 的定位是供資料、由 Claude 推理，**與確定性決策層不是同一段**。
>
> **仍然推不出來的**：這不證明決策層本身有價值。決策層要靠 GPT-6 判準與
> Decision ≠ Recommendation 自己站住，與 Strava 做不做無關。**②講的是管線接得起來，
> 不是我們賣的東西值錢。**
>
> **要盯著的一項**：它輸出的 training load 與 readiness 是**廠商複合值**，與
> Relative Effort 46 同型（可引用、不可重算，見本節下方）。這類值進到我們手上是證據，
> 不是可重算的量，registry 要照這個性質標。
>
> 出處：`support.strava.com/en-us/articles/15401531-strava-mcp-connector`、
> `press.strava.com/articles/strava-launches-mcp-connector`

**已完成（Garmin）**：

| 產出 | 位置 |
|---|---|
| 原始格式契約（含 sentinel／缺洞與實測可得率） | `schemas/sources/garmin.export.json` |
| 統一詞彙契約（connector 的輸出＝decision tool 的輸入） | `schemas/evidence/fitness-evidence.json` |
| 解析器補齊 sleep／stress，與 registry 宣告一致 | `packages/connectors/src/providers/garmin/` |
| 匯出樣本（含真實缺洞） | `data/fixtures/garmin/export-sample.json` |
| 五種匯出形狀的模擬場景 ＋ `npm run simulate:garmin` | `eval/scenarios/` |

**已完成（Strava bulk export）**：同一個平台的第二種方言。Strava 的 Download Request
不需要 OAuth，是使用者交出歷史而不授予常駐存取的路徑——所以它值得被當成獨立方言讀，
而不是 API 形狀的變體。

| 產出 | 位置 |
|---|---|
| 方言宣告（欄位索引、單位陷阱、FTP 相對性、錨點檔） | `VENDOR_SCHEMAS.strava_export`，`packages/evidence/src/schemaRegistry.js` |
| CSV 解析器（按**索引**定址，進檔前驗證 header row） | `packages/connectors/src/providers/strava/parseExport.js` |
| 最小 FIT 解碼器（只取 `activity.local_timestamp − timestamp`） | `packages/connectors/src/providers/strava/parseFit.js` |
| 正規化 ＋ coverage（`loadSource`／`rpeBasis`／`timezoneKnown`） | `packages/connectors/src/providers/strava/normalizeExport.js` |
| 合成匯出樣本（真實 103 欄 header ＋ 手工 FIT 檔） | `data/fixtures/strava/export/` |

三個陷阱是這個方言的全部重點：`activities.csv` 有 **5 組同名欄單位不同**（`Distance`[6]
是本地化的公里／英里，[17] 恆為公尺），所以按欄名解析會靜默拿到錯的單位；`Activity Date`
是 **UTC 且 CSV 裡沒有任何 offset**，本地時區只存在於 `activities/*.fit.gz`；`Training Load`
與 `Intensity` 是 **FTP 相對值**且只在該次有功率時存在，跨人不可比、FTP 過期即失真——
因此負荷取 `Relative Effort`（每筆都有，且與 API 的 `suffer_score` 同一把尺），TSS 連同
它所相對的 FTP 一起放進 metadata。

**這一層的驗收是「讀得懂」，不是「調得準」**：斷言只有命名／單位／source 標籤／
sentinel 不外洩／缺的誠實列在 `missing`／registry ↔ parser 一致，外加「決策仍成立且
自我解釋」。模擬出來的生理數值不是 ground truth，不得用來校準門檻——否則就是拿捏造
的人去 fit 引擎。詳見 [`eval/scenarios/README.md`](../eval/scenarios/README.md)。

**已完成（心率區間分佈）**：Strava 的 Heart Rate Analysis 只存在於它的網站——分佈與
zone 邊界都不在任何 CSV，`general_preferences.csv` 只給 pace zone。但兩個成分都拿得到：
逐秒心率在 `activities/*.fit.gz` 的 record 訊息裡，邊界由呼叫端傳入（正是 D-EVIDENCE 的
形狀）。`computeTimeInZone` 是純算術，不是推估——**實測對照 Strava 自己的面板，五個區間
逐秒吻合**（Z1 104s／Z2 860s／Z3 1157s／Z4 0／Z5 0，總計 2121s = FIT 的 total_timer_time）。

| 產出 | 位置 |
|---|---|
| 純函式（區間重疊／缺值／跳秒都會說出來，不靜靜補值） | `packages/connectors/src/timeInZone.js` |
| FIT 逐秒心率讀取（讀了就聚合，不留串流） | `parseFit.js` 的 `readFitHeartRateSamples` |
| 一個活動的分佈 | `providers/strava/intensityDistribution.js` |
| canonical signal `session_intensity_distribution` | `schemaRegistry.js`（**非 composite**——它可被對帳） |
| 證據契約 `workout.intensityDistribution` | `schemas/evidence/fitness-evidence.json` |

**刻意只記錄、不消費**：分佈進 `provenance` 與 `limits`，`decideSession` 明說「已列入證據鏈，
但沒有任何規則讀取它」。要用它訂門檻就得先有運動科學依據——**拿一個人的訓練回頭 fit 引擎
是紀律 2 禁止的**。

vendor 產出的准入規則同時定下來（`ADMISSION_RULE`）：**有單位、有宣告基準的值才收**。
Relative Effort（0–300）收，逐區秒數收；「This was harder than your usual effort」不收——
沒有單位、沒有量表、沒說跟什麼比，進不了任何欄位，也就無法在 `limits` 裡被反駁。

**方言等價**是這層真正的護城河證據：同一天用 `{typeKey}` 或裸字串、`calendarDate` 或
epoch timestamp 寫成兩份匯出，正規化後必須產生**完全相同**的 canonical evidence。
做得到，這層才是翻譯；做不到，就只是一堆各格式的特例。

### Phase 6 — Feedback Learning（護城河 #4）

> ✅ **已結（2026-07-31 使用者確認）。** 依 [product spec](product-spec.md) §5。

**hosted service 不保存三元組，由呼叫端保存。**

- 「狀態→決策→結果」由**呼叫端**保存，並可作為證據回傳
- 「呼叫端」在兩種部署下是不同的角色：Phase 1 是 **AI host 的記憶**，
  Phase 2 是**使用者控制環境裡的 `packages/db`**。兩者都不是 hosted service
- 我們這端的學習發生在**引擎規則與知識圖譜**（跨使用者的通則），不在個人資料
- **驗收**：規則能依回傳的結果證據調整，且 hosted service 不保存任何個人紀錄

### Phase 7 — Multi-LLM Interface（護城河 #5）🟡 部分完成

| 項目 | 狀態 | 位置／缺口 |
|---|---|---|
| MCP stdio | ✅ | `apps/mcp-server/src/stdio.js` |
| MCP Streamable HTTP | ✅ | `apps/mcp-server/src/http.js`，`npm run serve:http`；另有 `/health` |
| OAuth 2.1 Resource Server | 🟡 | **見下方訂正**——資源伺服器那半已實作，但驗證器沒填、進入點沒接線 |
| REST API | ❌ | HTTP server 只掛 MCP endpoint ＋ `/health`，無資源式 REST |
| SDK | ❌ | 無 |

- **驗收**：外部 agent 開發者不接觸原始碼即可接上

> **訂正（v6）**：v5.2 這行原本寫「OAuth ❌ · 目前是 bearer token 字串比對，非 OAuth」。
> **不準確。** `apps/mcp-server/src/oauth.js`（181 行）已實作資源伺服器該負責的全部：
> RFC 9728 protected resource metadata、audience 驗證（confused deputy 防護）、issuer
> 白名單、scope 檢查、`WWW-Authenticate` 導引、bearer 僅限 header。`http.js` 也已掛上
> `/.well-known/oauth-protected-resource` 與 401 流程。
> 實際缺的是三件具體的事，列為 7.1。

#### 7.1 OAuth 補完（上架前必須完成）

| # | 缺口 | 位置 | 性質 |
|---|---|---|---|
| A | 簽章驗證器是空插槽 | `http.js` `verify: options.oauth.verify \|\| null` | 沒填 → `claims` 為 null → **每個 token 都被拒**。需接 JWKS 驗證 |
| B | 進入點沒把 oauth 接進去 | `http.js` 直接執行區塊只傳 `token` / `allowedOrigins` | `npm run serve:http` 跑起來是共用密碼模式，**不是 OAuth** |
| C | 沒有 authorization server | — | 發 token／跑同意畫面那一端。**唯一 per-MAU 成本**（見 Phase 8） |

**C 的選型受 2026-07-28 規格影響，先讀 Phase 9 再選。** 規格已將 DCR（RFC 7591）
deprecated，改推 **CIMD**（Client ID Metadata Documents），授權伺服器以
`client_id_metadata_document_supported` 宣告支援。客戶端優先序為
pre-registration → CIMD → DCR → 要使用者手動填。**選一個不支援 CIMD 的
authorization server，等於一上線就走在 deprecated 路徑上。**

- **7.1 驗收**：MCP Inspector 帶真實 token 走完 401 → metadata → 授權 → 帶 token 呼叫，
  且錯誤 token（過期／audience 不符／issuer 不認得）各自回正確狀態碼。

#### 7.2 公開部署（上架前必須完成）

現況只跑 `localhost:8787`。目錄要求：

- **`https://` 網址**（提交表單強制），且**須從 Anthropic IP 連得到**——
  私有網段、VPN 後、防火牆擋掉的一律不通，「自己電腦連得到」不算數
- 網域**應與服務本身一致**（review 準則的 API ownership 條款）
- transport 二選一：**streamable HTTP 或 SSE**——我們走 streamable HTTP，已符合

### Phase 8 — 商業化

- Marketplace 上架（商品名 **Fitness Decision Engine**）
- 責任邊界條款：非醫療用途
- 計價單位：**暫定 per-MAU（按月活躍使用者）**，2026-07-31 使用者決定。
  原本寫死「＝decision tool 呼叫」，量測後發現與成本結構不符（見下），改為與成本同軸。
  **定案條件**：Claude／Codex 出明確的 MCP server 商業與計價文件後回頭定。
- 當前重點：先把產品備齊、找到一個能上架的平台，讓使用者用自己的 AI 工具串接。
  採哪一種商業模式較有利／較快，尚未決定

#### 一次決策的實際成本（實測，非估計）

以 180 個 metric ＋ 40 場訓練的證據跑 `decide_session`，500 次穩態平均：

| | |
|---|---|
| 每次呼叫 | **0.443 ms** |
| 單核每秒 | **2,256 次** |
| 外部 API 呼叫 | **0**——D-LLM 的直接結果，後面接 LLM 的產品每次都要付 API 費 |
| 請求／回應 | 23.3 KB／2.2 KB |
| 首次呼叫 | 27.2 ms（載入知識圖譜，每個行程一次，不是每次呼叫） |

#### 成本隨「人數」變動，不隨「次數」

| 成本項 | 隨什麼變動 |
|---|---|
| 運算 | 幾乎不變動 |
| 頻寬 | 每次約 25 KB；一百萬次決策 ≈ 25 GB |
| **Authorization server** | **per-MAU**（Auth0／WorkOS 等皆按月活躍使用者計費） |
| 主機 | 固定 |

**唯一隨規模變動的是人數。** 按次計價會與成本錯配，並且打擊產品自己想要的行為——
「隨時問」意味著一次對話可能觸發數次呼叫，按次收費會讓使用者開始省著問，帳單也不可預測。

#### 可數的事件只有兩種

**連上的人數** 與 **呼叫次數**。Anthropic 目錄上架後會提供 server health 與 usage metrics，
這兩個數字平台會給，不必自建。

> **計量不違反 D-DATA。** hosted 要保存的是 `userId · 時間 · tool 名 · 次數`，不含任何健康資料。
> 這條界線要守住——不能因為「已經有 metering 表了」就開始往裡面放別的東西。

#### 上架給的是分發，不是金流

實測兩家平台（2026-07）：

| | 現況 |
|---|---|
| Anthropic Connectors Directory | **無付費上架、無抽成機制** |
| OpenAI Apps SDK | 抽成比例**未公布**；現階段官方建議 external checkout（在自己網域結帳） |

**所以金流必須自己做。** 另有一個定價天花板：使用者已經在付 Claude／ChatGPT 訂閱，
**我們是加在上面的第二筆**。

#### 上架前置清單（2026-07-30 實查官方文件）

來源：[Submitting to the Connectors Directory](https://claude.com/docs/connectors/building/submission) ·
[Pre-submission checklist](https://claude.com/docs/connectors/building/review-criteria) ·
[Anthropic Software Directory Policy](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy)

| # | 要求 | 現況 |
|---|---|---|
| 1 | **Team 或 Enterprise 組織帳號**——提交入口在 Claude.ai admin settings，個人方案沒有 | ❌ **硬前提，先前未列** |
| 2 | `https://` 網址，Anthropic IP 連得到 | ❌ 見 7.2 |
| 3 | 需要驗證的服務**必須用 OAuth 2.0**（憑證須來自公認 CA）；模式限 DCR／CIMD／Anthropic 保管的 static client ID | 🟡 見 7.1 |
| 4 | 每個 tool 要有 `title` ＋ 對應的 `readOnlyHint`／`destructiveHint` | ✅ 6 個對外 tool 全數具備（已實測 `listedToolDefinitions()`） |
| 5 | 讀寫分離，不得有 `method` 參數的萬用 tool | ✅ 決策 tool 本來就是專用端點 |
| 6 | tool 描述不得含引導 Claude 行為的字句（prompt-injection 準則） | 🟡 **待逐條自審**——描述裡的「Use this after…」句式需確認落在「說明何時呼叫」而非「指揮模型」 |
| 7 | Privacy policy URL（HTTPS）。**缺或不完整＝立即退件** | ❌ 未寫 |
| 8 | 公開文件 URL（部落格或說明文章即可，發布日前備妥） | ❌ 未寫 |
| 9 | support 聯絡方式、icon、listing slug（slug 發布後永久固定） | 🟡 **icon ✅ 已備**（`docs/brand/`，含 1024／512／256 等尺寸）；support 聯絡與 slug 未定 |
| 10 | **測試帳號＋範例資料**，資料要夠完整讓審查者跑完每個 tool | ❌ 未備 |
| 11 | 三組可運作的範例 prompt | ❌ 未寫 |
| 12 | 自行用 MCP Inspector ＋ Claude custom connector 跑過每個 tool | ❌ 未做 |
| 13 | Data handling 一欄須申報**是否處理個人健康資料** | 🟡 **要據實申報**。上架的是 hosted service：它不保存（D-DATA），但證據確實經手。照 [product spec](product-spec.md) §6 的正式 wording 寫——「只處理呼叫端送進來的最小化健康證據，不留存、不販售、不訓練、不作無關用途」，**不得寫成「完全不碰健康資料」** |
| 14 | 七項 compliance 聲明（含 prompt injection、對話資料蒐集、first-party API） | 🟡 D-DATA／D-EVIDENCE 對我們有利，但要逐條對答案 |

> **政策面對我們無阻礙的部分**：禁止金流、禁止 AI 生成影音、禁止廣告——三條都與我們無關。
> 政策全文**未對健康／醫療資料設額外限制**，只走一般隱私條款；但 R3（責任邊界）
> 仍是我們自己的義務，不因政策沒寫而消失。

---

### Phase 9 — 協定升級至 MCP 2026-07-28（新增於 v6）

> **這一條不擋上架。** 上架擋在 7.1 ／ 7.2 ／ Phase 8 清單。本 Phase 是協定版本跟進，
> 兩條線只有一個交集：**7.1-C 的 authorization server 選型必須照新版選 CIMD**。

**現況**：`server.js` 的 `SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26",
"2024-11-05"]`，走 `initialize` 握手，HTTP 端以 `mcp-session-id` 發 session。
按新版術語這是 **legacy（handshake-based）** 實作。

#### 為什麼必須做成 dual-era，而不是直接改成 stateless

官方 versioning 頁的相容性矩陣寫得很直接：

| Client | Server | 結果 |
|---|---|---|
| Legacy | Modern | **Fails**——legacy 客戶端沒有向前相容機制 |
| Modern | Legacy | **Fails** |
| Legacy／Modern | **Dual-era** | 都 Works |

**所以直接改成新版，所有還沒升級的客戶端都會連不上。** 唯一安全路徑是 dual-era：
帶 modern `_meta` 的請求走 stateless，收到 `initialize` 就走 legacy 語意。
規格明文允許同一個 endpoint 同時服務兩個世代。

#### 9.1 Modern 路徑（新增，不動既有 legacy 路徑）

| # | 項目 | 規格要求 |
|---|---|---|
| A | 每請求 `_meta` | `io.modelcontextprotocol/protocolVersion`／`clientInfo`／`clientCapabilities`；結果的 `_meta` 回 `serverInfo` |
| B | `server/discover` | **MUST 實作**，宣告支援版本、能力、身分 |
| C | `MCP-Protocol-Version` header | 每個 POST 必帶，且**必須與 body `_meta` 一致**，不一致回 `400` ＋ `-32020 HeaderMismatch` |
| D | `Mcp-Method`／`Mcp-Name` header | `Mcp-Method` 所有請求必帶；`Mcp-Name` 於 `tools/call` 必帶。非 ASCII 走 `=?base64?…?=` sentinel，**比對前要先解碼** |
| E | 版本不支援 | 回 `-32022 UnsupportedProtocolVersionError`，`data.supported` 列出支援清單 |
| F | 所有 result 加 `resultType` | `"complete"`／`"input_required"` |
| G | `ttlMs` ＋ `cacheScope` | `tools/list` 等清單型結果**必填**。我們的 tool 清單是靜態的，`cacheScope: "public"` 合理 |
| H | GET／DELETE | 只支援本版時一律回 `405`；收到 `Mcp-Session-Id` 忽略不回聲；`Last-Event-ID` 忽略 |
| I | `tools/list` 順序 | SHOULD 穩定排序，利於客戶端與 prompt cache |

#### 9.2 要拆掉的東西（僅限 modern 路徑；legacy 路徑保留）

- `ping`、`logging/setLevel`、`notifications/roots/list_changed` 已從協定移除
- GET SSE endpoint（`http.js`）→ 改由 `subscriptions/listen` 提供
- SSE resumability（`Last-Event-ID`）不再支援
- `sessions` Set → **直接刪除**。已實測它只有 `add` 與 `delete`、**從無 `has`**，
  沒有任何一行檢查它，等於刪掉而不是重寫

#### 9.3 MRTR（Multi Round-Trip Requests）

server 不再主動送 request。需要補資料時回 `InputRequiredResult`（`resultType:
"input_required"` ＋ `inputRequests`），客戶端帶 `inputResponses` **重試原請求**。

**這條與 P6（elicitation 一次收齊參數）合流**——P6 從此不是「補一個 elicitation 呼叫」，
而是「在 MRTR 形狀下一次列出缺的參數」。跨重試的關聯自己編在 `requestState`。

#### 9.4 時程壓力

新版有**十二個月最短 deprecation window**，Roots／Sampling／Logging 與 HTTP+SSE
都在窗內。**不急，但別拖到窗尾**；且 7.1-C 一旦選定 authorization server 就難改，
CIMD 那個決定要在 Phase 7 就下對。

- **Phase 9 驗收**：
  1. 同一個 endpoint 對 legacy 客戶端（送 `initialize`）與 modern 客戶端（帶 `_meta`）皆可用
  2. header 與 body 不一致時確實回 `-32020`
  3. 不支援的版本回 `-32022` 且列出 `supported`
  4. `server/discover` 回得出支援版本清單
  5. 既有 248 tests 全綠，且新增 dual-era 雙路徑測試

---

## 4.5 待決事項與未結項（v6 新增）

> 來源：2026-07-30 工作紀錄。列在這裡是因為**沒有任何 gate 抓得到它們**——
> `npm run review:phase` 九條 gate 全綠也不代表這些消失了。

### A. 要使用者決定的（A2 已於 2026-07-31 結案）

| # | 事項 | 卡在哪 |
|---|---|---|
| A1 | **Authorization server 選哪家**（Auth0／WorkOS／Clerk／自建） | resource server 已寫好，沒有 AS 就無法端到端。**v6 已給出硬判準：必須支援 CIMD**（見 D-REGISTRATION），這條先前沒有 |
| ~~A2~~ | ~~**計價單位**~~ | ✅ **已決（2026-07-31）：暫定 per-MAU**，與實測成本同軸。宣言舊句「商業單位 = Decision Tools」已於宣言改寫時移除，衝突消失。定案條件：Claude／Codex 出明確的 MCP server 商業與計價文件 |
| A3 | **max HR 171 是年齡估計**（220−49） | 資料裡觀察到的最高 150，但那 7 筆全是穩態有氧，是下限不是上限。維持估計值、還是做一次最大努力測試 |
| A5 | **理由句子由誰組**——核心概念（3.5）說語言那層是 Claude 的；引擎現在自己寫中文模板句。要不要改成只回結構化數值與觸發的規則 | 影響 `decideSession.js` 全部 `reason.push(...)`、schema 契約、G3 gate |
| A4 | **四個 tool 要不要改名**（`decide_session` → `decide_training_session` 等，牽動 6 處） | 判準是「遮住 connector 名稱後看不看得出是健身領域」，四個沒過。`deprecatedToolAliases` 已在，改名不會斷既有呼叫端 |

### B. 計畫與宣言衝突（B1、B3 已於 2026-07-31 結案；B2 仍未決）

| # | 宣言 | 計畫現況 | 狀態 |
|---|---|---|---|
| ~~B1~~ | ~~L55 需保存「狀態→決策→結果」三元組~~ | Phase 6「我們這端不留三元組」 | ✅ **已結（2026-07-31）**：宣言 L55 已於改寫時移除，使用者確認採 Phase 6 的寫法。呼叫端保存——Phase 1 是 AI host，Phase 2 是使用者環境的 `packages/db` |
| B2 | **宣言內部先自相矛盾**：L40「模型無關——換模型、新模型出現，我們不受影響」vs L188 第一里程碑「證明沒有這個 MCP，Claude／ChatGPT 的 fitness decision quality 會明顯下降」 | D5 取消評測，理由二「呼叫 LLM API 違反 D-LLM」 | 🔴 **要改的是宣言，不是計畫。** 理由二不成立，而且錯兩層：①L42 明文例外——開發期評測是開發工具；②**更根本的是誤讀 D-LLM**——它管的是模型在誰家，不是碰到模型就違規。**整個產品本來就跑在模型上面**，開發時呼叫一次模型 API 與它無關 → 撤掉。但**理由一（測的是模型不是產品）在 v6 更強了**，見 R1。若模型無關成立，「這個模型少了我們會差多少」就不是關於我們的量測——**L188 是否該改，只有使用者能決定，不得自行改宣言** |
| ~~B3~~ | ~~L184「商業單位 = Decision Tools」~~ | Phase 8 計價單位 = per-MAU | ✅ **已結**，同 A2。該句已從宣言移除 |

### C. 未結的技術債

| # | 項目 | 位置 |
|---|---|---|
| C1 | **`maxSampleGapSeconds = 30` 沒有出處**——「心率斷超過 30 秒算暫停」的 30 是挑的，已 commit。要有依據，或改成呼叫端必填 | `packages/connectors/src/timeInZone.js:106` |
| C2 | **`trainingLoad ?? 分鐘數` 仍在編造負荷值**（`rpe ?? 5` 已於 `ec7f887` 移除，這條當時明確劃在範圍外） | `packages/evidence/src/model.js:155` |
| C3 | **user-journey 缺兩個已完成功能**（提議評估、心率區間分佈）。**沒有 gate 抓得到**——G4 只比對五種決策型別，沒有東西比對「功能 ↔ 對外文件」 | `docs/user-journey.html` |
| C6 | 🟡 **證據的實際來源形狀沒驗過**——我們的 parser 全部是針對**匯出檔**寫的（`normalize.js` 註解自陳「Garmin Connect export → Fitness Evidence Model」）。但真實流程裡，證據是 Claude 從**別人的 MCP server** 拿到再當參數傳進來的：Strava 官方 connector、Garmin 社群版 61 個 tool 的 API 形狀。**兩者形狀不同，且從未對照過。** 這是「四家對齊」這條護城河能不能兌現的關鍵 | `packages/connectors/src/providers/*/normalize.js` |
| C5 | ✅ **plan state 不由 MCP runtime 持有**——`planStore` 已改為 stateless patch/preview validator；caller 或外部 storage 負責持久化與版本歷史。`packages/db` 仍未接 runtime，屬部署層工作。 | `packages/planning/src/planStore.js`、`packages/db` |
| C4 | **G5 一直紅著**：Apple Health 與 Strava 有 parser，但 `schemas/sources/` 缺原始格式契約、`eval/scenarios/` 缺匯出形狀場景。`schemas/README.md` 自訂規則是「registry ＋ source schema ＋ parser ＋ scenario」四件，現在 2/4 | `schemas/sources/`、`eval/scenarios/` |

> **C4 現在的條件比先前好**：真實 Apple Health 匯出已在 `data/private/AppleHealth/export.xml`
> （153MB／382,246 筆／2017-11→2026-07），可得率是量出來的，可以照 Garmin 那份寫成真正的
> source contract。

### D. 一個會影響 registry 正確性的實測發現

**`apple_health` 給什麼訊號，完全取決於哪個裝置在餵它。** 實測該匯出：來源名稱 `Connect`
（Garmin）寫入 30,198 筆心率、114/120 筆靜息心率、**41 筆睡眠（100%）**——iPhone 自己量不到
這些；HRV 則只有 Apple Watch 有（19 筆，最後一筆 2023-08，近三年 0 筆）。

**registry 寫「apple_health 提供 4 個 signal」是錯的**——它提供的是餵它的那些裝置能給的
**聯集**，而且隨使用者的裝置史變動。這是 schema registry 的正確性問題，不是某個使用者的
資料特性（紀律 2 不禁止這一類斷言：它講的是匯出檔的形狀，不是某人的生理數值）。

---

## 5. 決策日誌

| 決策 | 結論 |
|---|---|
| **D-POSITION** | Permissioned Fitness Decision Engine，不做 App／社群／內容庫 |
| **D-EVIDENCE** | 證據由 AI 那層經 tool call 傳入；**我們不 fetch、不持有原始資料** |
| **D-DATA**（2026-07-31 修訂） | **hosted service 不保存任何個人資料；Phase 2 的持久層在使用者控制的環境裡。** 長期指標（負荷曲線、基線）一律由傳入證據現算後回傳，hosted 不落地。計畫與決策紀錄由**呼叫端**保存：Phase 1 是 AI agent 的記憶，Phase 2 是使用者自己的 `packages/db`。**兩者都不是 hosted service**——`raw_provider_events`、`health_metrics`、`semantic_fitness_states` 這類表在 hosted 一張都不能建。舊版寫「我們自身不保存」，那句話在 Phase 2 落地後會讀成「使用者也不能存」，與 [product spec](product-spec.md) §5 衝突 |
| **D-LLM** | **管的是「模型在誰家」，不是「有沒有模型」。** 禁的只有一件事：**我們自己的程式不呼叫模型來產生決策**（為了確定性、可稽核、換模型不受影響、零外部 API 成本）。**模型是前提不是選配**——聽懂使用者的話、湊齊各 connector 的證據、決定呼叫哪個 tool、把結構化決策講成人話，全是 host 在做。沒有模型就得做 App（介面、手動輸入、自建資料管線），原則 4「不做 UI、不搶對話」就是靠 host 才成立。**因此「呼叫模型 API＝違反 D-LLM」是誤讀**，見 4.5-B2 |
| **D-NUTRITION** | 從架構圖移除，暫不提供營養決策 |
| **D-TOOL** | **14 → 6**，依 GPT-6 判準；砍端點不砍能力（已執行）|
| **D-INTERFACE** | 不只 MCP，還要 REST API ＋ SDK（Phase 7） |
| **D-GRAPHDB** | 未觸發，in-memory 足夠，不導入 Neo4j |
| **D-CONNECTOR**（v6） | **不自建任何來源 connector。** Strava（逐步開放中）、COROS（2026-05）已自行 host 官方 MCP server，給得比我們拉得到的完整（逐秒串流）；其定位是供資料、由 Claude 推理——**與確定性決策層相鄰**。連帶效果：架構原本「證據自己會到 AI 那層」這個我們不擁有的前提，已對兩個來源成為事實。**但這只說明管線接得起來，不代表決策層有價值**，見 Phase 5 補記 |
| **D-PROTOCOL**（v6） | 升 2026-07-28 走 **dual-era**，不是直接切換。依官方相容性矩陣，只支援新版會讓所有舊版客戶端連不上 |
| **D-REGISTRATION**（v6） | authorization server 以**支援 CIMD** 為選型硬條件。DCR 已 deprecated，只留向後相容 |

## 6. 風險

| 風險 | 現況 |
|---|---|
| **R1 增益無法證明** | ✅ **v6 結案**（使用者 2026-07-30 定調）。那個對照要量的是**模型品質**：不是我們的東西、使用者用了就知道、不好就換模型，而且下一版模型出來數字就作廢。**訓練資料不會變**——拿會變動又不歸我們的東西去量固定的輸入，量出來沒有保存期限。改以三項可直接檢查的性質衡量：①同資料同答案 ②理由指得出是哪個數字對哪條門檻 ③確定性程式說服不了。跑兩次就驗得出來。**但這與宣言第一里程碑牴觸，見 4.5-B2** |
| **R2 定位滑回內容庫** | 🟢 已發生一次（早期蓋出檢索層），D3 已收回；靠 GPT-6 判準持續守 |
| **R3 健康建議責任邊界** | 🟡 B2B 讓責任鏈更長，需 tool description ＋ 合約兩層聲明非醫療用途 |
| **R4 KG 關係品質** | 🟢 進退階與訓練目標皆已補齊並有不變量把關（4.3）。**殘留**：匯入的 861 個節點只有相似度邊，且已驗證無法由規則升級為語意**邊**（訓練目標走的是節點屬性，不是邊） |
| **R5 上架前提未備**（v6） | 🔴 提交入口需 **Team／Enterprise 組織**，個人方案進不去；privacy policy 缺件即退件。**這兩項與程式無關，寫再多程式也繞不過**，見 Phase 8 清單 |

## 7. 工程原則（沿用，位階次於宣言）

| # | 原則 | 狀態 |
|---|---|---|
| P1 | Tool 回傳結構化資料，不回傳散文 | ✅ |
| P2 | 決策由引擎產生，非 LLM 推測 | ✅ |
| P3 | 輸出帶可驗證 ID，回傳前驗證存在性 | ✅ `assertGrounded` |
| P4 | 寫入 two-phase + idempotency key | 🟡 缺 idempotency key |
| P5 | 日期／時區由 server 解析 | 🟡 預設日期已改由 server 以使用者時區解析（`packages/domain/src/dates.js`）；**尚缺**自然語言相對日期（「明天」「上週三」）解析 |
| P6 | elicitation 一次收齊參數 | ❌ **形狀已變**——見 Phase 9.3，2026-07-28 起走 MRTR，不再是 server 主動送 elicitation request |

> **P5 訂正**：原本 `toolHandlers.js` 的 `DEFAULT_DATE = "2026-07-23"` 與
> `generatePlan.js` 的 `startDate || "2026-07-27"` 是**寫死的日曆日**——沒帶 `date` 的
> 呼叫一律當成撰寫當天，訊號新鮮度、detraining 與計畫起始日全部錯。改用
> `todayInTimezone(user.timezone)`；時區那半同樣重要：`2026-07-23T22:30:00Z` 在
> `Asia/Taipei` 已經是 **07-24**，用 UTC 取日會差一天。demo seed 沒有「今天」可言，
> 因此改**由 seed 最新一筆證據推得**錨點並在 `provenance.dateAnchoredTo` 標明，
> 而不是再寫死一個常數。
