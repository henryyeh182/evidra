# Fitness MCP — Implementation Plan

> 版本：**v5.1** · 依 [Design Manifesto](design-manifesto.md) 推導
> **Mission**：A permissioned Fitness Decision Engine that turns fragmented, user-owned health evidence into explainable training decisions for AI agents.

> ⚠️ [Design Manifesto](design-manifesto.md) 位階最高，衝突時以宣言為準。
> 宣言回答「蓋什麼、不蓋什麼」；本文件回答「照什麼順序蓋、現在偏差在哪」。
> 本文件是唯一的實作計畫，先前的 v1／v2／各 phase 分冊已刪除並整併於此。

---

## 1. 已實作元件

163 tests pass，全部 dependency-free（Node 20+，無外部套件）。

| Package | 內容 |
|---|---|
| `packages/domain` | 核心模型：User / Goal / Preference / Injury / Equipment / Workout / HealthMetric，含 `assertValidUserContext` |
| `packages/semantic-engine` | `generateSemanticFitnessState`：recovery / readiness / fatigue / 分肌群疲勞 / 負荷。**訊號可得性自適應**——訊號過期即排除並重新正規化權重，如實下調 confidence，輸出 `signalCoverage`。基線由 `options.baselines` 注入，族群常數僅作 fallback |
| `packages/training-load` | **`computeTrainingLoad`**：ATL / CTL / TSB（指數移動平均）、ACWR ramp-rate、負荷分區，**detraining 為獨立軸線**（以本人近期 CTL 峰值為基準，須同時滿足閒置天數與體能流失，taper／deload 不誤觸）。**`computePersonalBaselines`**：由傳入的 health metrics 現算本人基線 |
| `packages/knowledge-graph` | 900 節點 / 5,866 邊。`graph.js`（替代／進退階／結構化檢索遍歷）、`workoutSchema.js`（Block/Set 結構與驗證）、`programTemplates.js`（參數化課表模板）、`models.js` 的 `assertValidProgressions`（進退階不變量，建圖時強制） |
| `packages/planning` | `generatePlan`（週期化 base→build→peak→deload）、`adaptPlan`（非破壞式 diff 預覽）、`planStore`（版本化 preview→commit） |
| `packages/connectors` | Apple Health（`export.xml` 串流解析）、Strava、**Garmin**（readiness／daily summary／sleep／activities，含 sentinel 處理）的格式正規化 |
| `packages/evidence` | **Fitness Evidence Model**：跨來源證據契約 ＋ 轉內部 context |
| `packages/decision-engine` | **`decideSession`**：計畫 × 證據 → Decision/Action/Reason，結構性拒絕退化成推薦 |
| `packages/db` | PostgreSQL schema 與 row mappers（尚未接 runtime） |
| `apps/mcp-server` | **6 個對外決策 tool**（另 10 個 Content 端點已下架、仍可呼叫一版），JSON-RPC over stdio，含 `assertGrounded` 與 4KB payload 預算 |
| `/schemas` | 各 tool 的 input/output JSON Schema 契約 ＋ drift guard |
| `/eval` | 20 golden cases，4 個 gate（case pass／schema／grounding／plan validity）全綠 |

**工具腳本**：`npm run build:graph`（重建知識圖譜）、`audit:graph`（品質稽核）、`import:apple-health`（本機匯入真實資料）、`eval`（評測計分）

**資料品質現況**：分類準確率 94.1%、替代合理率 100%（50 抽樣）、高負荷動作無禁忌 0 個、
策展核心進退階覆蓋率 85.2%（gate ≥ 70%）。

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

**改為**：承諾 B 的衡量方式從「模型對照」改成「**決策可驗證性**」——決策規則是確定性的，正確與否由測試直接驗證（`assertValidDecision` ＋ 163 個測試）。
另補上 **MCP client 相容性驗證**（見下）取代連通性層面的疑慮。

> **D1 與 D2 同一個根因**：系統是照「我們有使用者資料庫，AI 來查」設計的（傳統 SaaS），不是照「AI 帶授權證據來，我們回決策」設計的（intelligence layer）。**架構圖畫的是後者，程式蓋的是前者。**

---

## 3. 護城河缺口

| # | 能力 | 現況 | 缺口 |
|---|---|---|---|
| 1 | Semantic Fitness Layer | 🟡 | 證據契約已就位（D1 已修）；**3/6** 來源解析器（＋Garmin），來源格式與統一詞彙已有 schema 與方言等價驗證 |
| 2 | Fitness Intelligence Engine | 🟢 | 確定性且產出五層決策（D2 已修）；ATL/CTL/TSB ＋ detraining 軸線 ＋ 個人基線已上（Phase 4 前兩項） |
| 3 | Fitness Knowledge Graph | 🟡 | 900 節點 / 5,866 邊。**進退階已補齊**（7 → 34 條，17 組互逆，策展核心覆蓋 85.2%，帶不變量把關）；**仍缺恢復、訓練目標連結**。相似度邊佔 89.4%，但那是匯入節點的設計結果（見 Phase 4.3） |
| 4 | Feedback Learning | 🔴 | **零**。無「狀態→決策→結果」記錄與閉環 |
| 5 | Multi-LLM Interface | 🟡 | MCP stdio ＋ Streamable HTTP 已上；**無 REST API、無 SDK、無 OAuth**（`http.js` 目前是 bearer token 比對） |

---

## 4. Phase 順序

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

### Phase 4 — 決策深度（護城河 #2 #3）🟡 進行中（2/3）

> 原驗收條件是「lift 相對 Phase 3 基準再提升」。**該條已失效**——lift 的量測方式是
> D5 取消的裸模型 vs 模型＋MCP 對照，執行它必須呼叫 LLM API，與 **D-LLM** 相衝突。
> 下面依 D5 的替代原則（決策可驗證性）重寫。

#### ✅ 4.1 Training Load Model — 已完成

`packages/training-load/src/trainingLoad.js`，接線於 [`toolHandlers.js`](../apps/mcp-server/src/toolHandlers.js)。

| 產出 | 內容 |
|---|---|
| ATL / CTL / TSB | 指數移動平均，由傳入證據中的 workouts 現算（不落地，符合 D-DATA） |
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

> 與 D-DATA 一致：基線是**每次呼叫現算**的，我們這端不保存任何人的基線。

#### 🟡 4.3 知識圖譜語意關係 — 進退階已補，恢復／訓練目標未動

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
  匯入節點依設計只帶相似度邊。現況 **23/27 = 85.2%**（gate ≥ 70%），
  未覆蓋的只有 `mobility`。

##### 剩餘：恢復與訓練目標連結

- `decideSession.js:29` 的 `RECOVERY_MOVEMENTS = ["Easy walk", "Mobility flow"]`
  是**寫死字串**，不是從圖上取的——這就是「缺恢復連結」的具體形態，也對應 eval
  那條 plan exercise → catalog coverage 62.5% 的診斷（`Tempo Run`、`Bent-over Row`、
  `Long Zone 2 Run` 都指不到節點）。
- 訓練目標同理，圖上沒有可依目標挑動作的欄位或邊。
- **待決策**：目標與恢復角色要做成**節點屬性**（與 equipment／joints 現有做法一致，
  見 `models.js` 的註解）或**新邊型別**。前者改動小且與現況一致；後者在導入 graph DB
  後較自然。此決策未做，故此項未開工。

#### 驗收（重寫）

這一層的驗收是「**決策可被驗證**」，不是「決策更準」。沒有 ground truth，也不做模型
對照（D5）；能驗的是規則是否確定性、輸出是否自我解釋、退化是否誠實。

| # | 驗收條件 | 量測方式 |
|---|---|---|
| A1 | 同一組證據重複呼叫，決策完全相同 | 既有測試即為確定性斷言 |
| A2 | 每個非 `keep` 決策都帶 from→to 與可追溯的 reason | `assertValidDecision` 結構性拒絕 |
| A3 | 證據不足時回退化標記，不猜數值 | `insufficient_history` ／ `signalCoverage` ／ `missing` |
| A4 | 負荷指標所依據的每個訊號都出現在 `provenance` | eval grounding gate |
| A5 | ✅ 進退階可從圖上走通，且每條階梯上下都通 | `audit:graph` 階梯覆蓋率 gate（≥ 70%，現 85.2%）＋ `assertValidProgressions` 四條不變量 |
| A6 | ✅ 退階請求回真實的退階動作，而非相似動作 | `graph.test.js`：`exercise_pullup` 的退階必須是 `exercise_assisted_pullup`（beginner／同 pattern） |
| A7 | **恢復／訓練目標連結完成後**：`decideSession` 換入的恢復動作指得到圖上節點 | eval 的 plan exercise → catalog coverage 由診斷升為 gate |

> **訂正（v5.1）**：A5 原本寫的是「`SIMILAR_TO` 佔比上限」。該指標作廢——它假設
> 生成器會補出大量語意邊來稀釋佔比，而 4.3 的負面結果證明生成器**不該**補進退階。
> 全圖 89.4% 的相似度佔比是匯入節點的設計結果，不是缺陷，壓低它只能靠刪資料或造假邊。
> 改以**策展核心的階梯覆蓋率**衡量——那才決定「要求退階時答不答得出來」。
> 佔比仍列在 audit 輸出中，作為診斷而非 gate。
>
> 原則不變：**不得為了通過門檻而回頭放寬自動生成規則**。這條現在由
> `graph.test.js` 的「generated nodes must not carry progression edges」直接把關。

### Phase 5 — 多來源正規化（護城河 #1）🟡 進行中
- Garmin / Oura / Whoop / MyFitnessPal 格式解析 —— **Garmin 已完成**（3/6 來源）
- 跨來源語意對齊（同一個 HRV，各家名稱／單位／取樣頻率統一）
- **證據由 tool call 傳入，不做 OAuth 拉取**
- **驗收**：同一使用者接不同來源，決策語意一致；訊號衝突有明確優先序

**已完成（Garmin）**：

| 產出 | 位置 |
|---|---|
| 原始格式契約（含 sentinel／缺洞與實測可得率） | `schemas/sources/garmin.export.json` |
| 統一詞彙契約（connector 的輸出＝decision tool 的輸入） | `schemas/evidence/fitness-evidence.json` |
| 解析器補齊 sleep／stress，與 registry 宣告一致 | `packages/connectors/src/providers/garmin/` |
| 匯出樣本（含真實缺洞） | `data/fixtures/garmin/export-sample.json` |
| 五種匯出形狀的模擬場景 ＋ `npm run simulate:garmin` | `eval/scenarios/` |

**這一層的驗收是「讀得懂」，不是「調得準」**：斷言只有命名／單位／source 標籤／
sentinel 不外洩／缺的誠實列在 `missing`／registry ↔ parser 一致，外加「決策仍成立且
自我解釋」。模擬出來的生理數值不是 ground truth，不得用來校準門檻——否則就是拿捏造
的人去 fit 引擎。詳見 [`eval/scenarios/README.md`](../eval/scenarios/README.md)。

**方言等價**是這層真正的護城河證據：同一天用 `{typeKey}` 或裸字串、`calendarDate` 或
epoch timestamp 寫成兩份匯出，正規化後必須產生**完全相同**的 canonical evidence。
做得到，這層才是翻譯；做不到，就只是一堆各格式的特例。

### Phase 6 — Feedback Learning（護城河 #4）
> ⚠️ 受 D-DATA「不保存」約束，閉環設計需重新定義：**我們這端不留三元組**。
- 「狀態→決策→結果」由**呼叫端**保存，並可作為證據回傳
- 我們這端的學習發生在**引擎規則與知識圖譜**（跨使用者的通則），不在個人資料
- **驗收**：規則能依回傳的結果證據調整，且不需保存任何個人紀錄

### Phase 7 — Multi-LLM Interface（護城河 #5）🟡 部分完成

| 項目 | 狀態 | 位置／缺口 |
|---|---|---|
| MCP stdio | ✅ | `apps/mcp-server/src/stdio.js` |
| MCP Streamable HTTP | ✅ | `apps/mcp-server/src/http.js`，`npm run serve:http`；另有 `/health` |
| OAuth 2.1 Resource Server | ❌ | 目前是 bearer token 字串比對（`http.js`），非 OAuth。**手機與 marketplace 上架的前提** |
| REST API | ❌ | HTTP server 只掛 MCP endpoint ＋ `/health`，無資源式 REST |
| SDK | ❌ | 無 |

- **驗收**：外部 agent 開發者不接觸原始碼即可接上

### Phase 8 — 商業化
- 計價單位＝decision tool 呼叫；usage metering
- Marketplace 上架（商品名 **Fitness Decision Engine**）
- 責任邊界條款：非醫療用途

---

## 5. 決策日誌

| 決策 | 結論 |
|---|---|
| **D-POSITION** | Permissioned Fitness Decision Engine，不做 App／社群／內容庫 |
| **D-EVIDENCE** | 證據由 AI 那層經 tool call 傳入；**我們不 fetch、不持有原始資料** |
| **D-DATA** | 我們**自身不保存**；負荷曲線／基線／決策紀錄由 **AI agent 記憶並可回溯**。長期指標由傳入證據現算後回傳 |
| **D-LLM** | **系統內不含 LLM**，腦袋來自 host（Claude / ChatGPT） |
| **D-NUTRITION** | 從架構圖移除，暫不提供營養決策 |
| **D-TOOL** | **14 → 6**，依 GPT-6 判準；砍端點不砍能力（已執行）|
| **D-INTERFACE** | 不只 MCP，還要 REST API ＋ SDK（Phase 7） |
| **D-GRAPHDB** | 未觸發，in-memory 足夠，不導入 Neo4j |

## 6. 風險

| 風險 | 現況 |
|---|---|
| **R1 增益無法證明** | ⛔ 評測已取消（測 LLM 腦非產品，且違反 D-LLM）。改以決策可驗證性衡量。**殘留風險：對外仍缺一個量化說法** |
| **R2 定位滑回內容庫** | 🟢 已發生一次（早期蓋出檢索層），D3 已收回；靠 GPT-6 判準持續守 |
| **R3 健康建議責任邊界** | 🟡 B2B 讓責任鏈更長，需 tool description ＋ 合約兩層聲明非醫療用途 |
| **R4 KG 關係品質** | 🟡 進退階已由策展補齊並有不變量把關（4.3）。**殘留**：恢復／訓練目標連結仍缺；匯入的 873 個節點只有相似度邊，且已驗證無法由規則升級為語意邊 |

## 7. 工程原則（沿用，位階次於宣言）

| # | 原則 | 狀態 |
|---|---|---|
| P1 | Tool 回傳結構化資料，不回傳散文 | ✅ |
| P2 | 決策由引擎產生，非 LLM 推測 | ✅ |
| P3 | 輸出帶可驗證 ID，回傳前驗證存在性 | ✅ `assertGrounded` |
| P4 | 寫入 two-phase + idempotency key | 🟡 缺 idempotency key |
| P5 | 日期／時區由 server 解析 | ❌ |
| P6 | elicitation 一次收齊參數 | ❌ |
