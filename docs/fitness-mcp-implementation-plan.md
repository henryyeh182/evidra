# Fitness MCP — Implementation Plan

> 版本：**v4** · 依 [Design Manifesto](design-manifesto.md) 推導
> **Mission**：A permissioned Fitness Decision Engine that turns fragmented, user-owned health evidence into explainable training decisions for AI agents.

> ⚠️ [Design Manifesto](design-manifesto.md) 位階最高，衝突時以宣言為準。
> 宣言回答「蓋什麼、不蓋什麼」；本文件回答「照什麼順序蓋、現在偏差在哪」。
> 本文件是唯一的實作計畫，先前的 v1／v2／各 phase 分冊已刪除並整併於此。

---

## 1. 已實作元件

73 tests pass，全部 dependency-free（Node 20+，無外部套件）。

| Package | 內容 |
|---|---|
| `packages/domain` | 核心模型：User / Goal / Preference / Injury / Equipment / Workout / HealthMetric，含 `assertValidUserContext` |
| `packages/semantic-engine` | `generateSemanticFitnessState`：recovery / readiness / fatigue / 分肌群疲勞 / 負荷。**訊號可得性自適應**——訊號過期即排除並重新正規化權重，如實下調 confidence，輸出 `signalCoverage` |
| `packages/knowledge-graph` | 896 節點 / 5,839 邊。`graph.js`（替代／進退階／結構化檢索遍歷）、`workoutSchema.js`（Block/Set 結構與驗證）、`programTemplates.js`（參數化課表模板） |
| `packages/planning` | `generatePlan`（週期化 base→build→peak→deload）、`adaptPlan`（非破壞式 diff 預覽）、`planStore`（版本化 preview→commit） |
| `packages/connectors` | Apple Health（`export.xml` 串流解析）、Strava 的格式正規化，共用 `applyNormalizedEventsToContext` |
| `packages/db` | PostgreSQL schema 與 row mappers（尚未接 runtime） |
| `apps/mcp-server` | 13 個 tool，JSON-RPC over stdio，含 `assertGrounded` 存在性驗證與 4KB payload 預算 |
| `/schemas` | 各 tool 的 input/output JSON Schema 契約 ＋ drift guard |
| `/eval` | 19 golden cases，4 個 gate（case pass／schema／grounding／plan validity）全綠 |

**工具腳本**：`npm run build:graph`（重建知識圖譜）、`audit:graph`（品質稽核）、`import:apple-health`（本機匯入真實資料）、`eval`（評測計分）

**資料品質現況**：分類準確率 94.1%、替代合理率 100%（50 抽樣）、高負荷動作無禁忌 0 個。

---

## 2. 偏差清單（審查結果）

> v4 的核心工作項。修完才繼續開發新功能。

### D1 — 證據是自己讀檔，不是傳進來的 🔴 架構級

```
tool input:  userId, date                 ← 只有識別碼
server 內部: readFile("data/seeds/...")   ← 自己去拿資料
```

架構圖是 `使用者授權 → AI → tool call 帶證據進來`，實作是 `userId → 我們的檔案`。
等於我們是資料保管者，違反原則 1，且「permissioned」失去意義（沒有授權動作，只有查表）。

**修**：tool 契約接受 `evidence` 參數；server 對原始資料無狀態。

### D2 — 沒有任何 tool 產出決策 🔴 產品級

| 欄位 | 13 個 tool 中有的 |
|---|---|
| `decision` / `action` / `evidence` | **0** |
| `confidence` | 3 |
| `signalCoverage` | 1 |

五層模型（Evidence→State→Decision→Action→Reason）**沒有一個實作到 Decision 層**，全部停在 State 或 Content。

**修**：決策 tool 輸出五層契約。

### D3 — 13 個 tool，其中 8 個是 Content 🟠

`search_exercises` `get_exercise` `search_workouts` `get_workout` `get_user_profile` `get_training_history` `get_plan` `list_plans` — 回傳清單／詳情，違反原則 5，且超出 ≤10 上限。

**修**：砍出工具面，程式留作內部證據來源（**能力保留，端點取消**）。

### D4 — `recommend_workout` 是 Recommendation 不是 Decision 🟠

現況回「今天適合低衝擊 Zone 2」——憑空發出、無 from→to、無 prior state。GPT-6 也做得到。

**修**：改為 `decide_session`：讀今天排定的課表 → 依證據調整 → 回 from→to。

### D5 — eval 零外部增益 🟠

四個 gate 全測內部正確性。承諾 B 說價值以決策品質提升衡量，目前**沒有任何數字**。

**修**：建裸模型 vs 模型＋MCP 的 A/B 評測。

> **D1 與 D2 同一個根因**：系統是照「我們有使用者資料庫，AI 來查」設計的（傳統 SaaS），不是照「AI 帶授權證據來，我們回決策」設計的（intelligence layer）。**架構圖畫的是後者，程式蓋的是前者。**

---

## 3. 護城河缺口

| # | 能力 | 現況 | 缺口 |
|---|---|---|---|
| 1 | Semantic Fitness Layer | 🟡 | 只有 2/6 來源；證據自己讀檔（D1） |
| 2 | Fitness Intelligence Engine | 🟡 | 確定性 ✅ 但不產出決策（D2） |
| 3 | Fitness Knowledge Graph | 🟡 | 只連動作/肌群/器材/替代；**缺恢復、訓練目標連結**。5,242/5,839 邊是自動生成的 SIMILAR_TO，**進退階關係幾乎不存在**（僅 7 條） |
| 4 | Feedback Learning | 🔴 | **零**。無「狀態→決策→結果」記錄與閉環 |
| 5 | Multi-LLM Interface | 🔴 | 只有 MCP stdio，**無 REST API、無 SDK** |

---

## 4. Phase 順序

### Phase 1 — 修架構級偏差（D1 + D2）
- Tool 契約改為接受 `evidence` 參數，server 不持有使用者資料
- 決策 tool 輸出五層契約：`evidence` / `state` / `decision` / `action{from,to}` / `reason` / `confidence` / `signalCoverage` / `limits`
- **驗收**：至少一個 tool 端到端產出真正的 Decision（含 from→to）

### Phase 2 — 工具面收斂（D3 + D4）
- 13 → 7；Content 端點下架，能力保留為內部
- `recommend_workout` → `decide_session`
- **驗收**：對外 tool ≤ 10；每個都過 GPT-6 判準

### Phase 3 — 證明增益（D5）
- 決策品質評分標準：事實正確性／證據紮實度／安全性／可執行性／誠實度
- A/B runner：裸模型 vs 模型＋MCP，三家模型分開記分
- **驗收**：lift 顯著且可重現；裸模型失敗模式成清單
- ⚠️ 若 lift 不顯著 → **定位需重新檢視**，這是最大的商業風險

### Phase 4 — 決策深度（護城河 #2 #3）
- Training Load Model：ATL / CTL / TSB（指數移動平均）
- 個人基線取代寫死常數（現在 `hrvMs: 52` 是族群平均，不是本人基線）
- KG 補上恢復、訓練目標的連結；補真實的進退階關係
- **驗收**：lift 相對 Phase 3 基準再提升

### Phase 5 — 多來源正規化（護城河 #1）
- Garmin / Oura / Whoop / MyFitnessPal 格式解析
- 跨來源語意對齊（同一個 HRV，各家名稱／單位／取樣頻率統一）
- **證據由 tool call 傳入，不做 OAuth 拉取**
- **驗收**：同一使用者接不同來源，決策語意一致；訊號衝突有明確優先序

### Phase 6 — Feedback Learning（護城河 #4）
- 記錄「狀態 → 決策 → 結果」三元組（決策紀錄，非原始健康資料）
- 依結果回饋改善決策品質
- **驗收**：閉環可量測，lift 隨資料累積上升

### Phase 7 — Multi-LLM Interface（護城河 #5）
- MCP（Streamable HTTP）＋ **REST API** ＋ **SDK**
- OAuth 2.1 Resource Server（認證 agent 開發者）
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
| **D-DATA** | 只存衍生指標（負荷曲線、基線、決策紀錄），不存原始讀數 |
| **D-LLM** | **系統內不含 LLM**，腦袋來自 host（Claude / ChatGPT） |
| **D-NUTRITION** | 從架構圖移除，暫不提供營養決策 |
| **D-TOOL** | 13 → 7，依 GPT-6 判準；砍端點不砍能力 |
| **D-INTERFACE** | 不只 MCP，還要 REST API ＋ SDK（Phase 7） |
| **D-GRAPHDB** | 未觸發，in-memory 足夠，不導入 Neo4j |

## 6. 風險

| 風險 | 現況 |
|---|---|
| **R1 增益無法證明** | 🔴 未測。若 lift 不顯著，定位崩塌。**最大商業風險** |
| **R2 定位滑回內容庫** | 🟡 已發生一次（早期蓋出檢索層），靠 D3 收回 |
| **R3 健康建議責任邊界** | 🟡 B2B 讓責任鏈更長，需 tool description ＋ 合約兩層聲明非醫療用途 |
| **R4 KG 關係品質** | 🟡 90% 邊是自動生成的相似度，語意關係稀疏 |

## 7. 工程原則（沿用，位階次於宣言）

| # | 原則 | 狀態 |
|---|---|---|
| P1 | Tool 回傳結構化資料，不回傳散文 | ✅ |
| P2 | 決策由引擎產生，非 LLM 推測 | ✅ |
| P3 | 輸出帶可驗證 ID，回傳前驗證存在性 | ✅ `assertGrounded` |
| P4 | 寫入 two-phase + idempotency key | 🟡 缺 idempotency key |
| P5 | 日期／時區由 server 解析 | ❌ |
| P6 | elicitation 一次收齊參數 | ❌ |
