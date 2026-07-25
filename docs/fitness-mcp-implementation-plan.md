# Fitness MCP — Implementation Plan

> 版本：**v4**（依 [Design Manifesto](design-manifesto.md) 重新推導）
> **Mission**：A permissioned Fitness Decision Engine that transforms user-owned health evidence into explainable training decisions for AI agents.

> ⚠️ **治理位階**：[Design Manifesto](design-manifesto.md) 高於本文件。
> 兩者衝突時以宣言為準。宣言回答「蓋什麼、不蓋什麼」；本文件回答「照什麼順序蓋」。

---

## v4 改了什麼（相對 v3）

v3 的骨架是「以 Peloton 實測缺口反推設計」——那是**從一個 to C 產品的失敗反推另一個 to C 產品**。它的工程原則（P1–P6 防幻覺、防寫錯）到今天仍然成立，但它的**產品假設已經作廢**。

v4 的三個根本改變：

| | v3（Peloton 反推） | v4（Intelligence Layer） |
|---|---|---|
| **我們在賣什麼** | 一個更好的健身產品 | 讓 AI Agent 具備運動決策能力 |
| **成功指標** | 知識庫規模、tool 數量、connector 數量 | **接入後 AI 決策品質提升多少** |
| **第一里程碑** | 能公開的 demo | **證明沒有這個 MCP，模型的決策品質會下降** |

因此 v4 做了三件 v3 不會做的事：
1. **把「證明增益」提到 Phase 1**——先於任何新功能。
2. **工具面從 13 砍到 7**——依 GPT-6 判準與原則 5「Decision, not Content」。
3. **重新開啟 D-PROTO**——v3 把 HTTP + OAuth 延後了；但在新定位下「讓外部 agent 接得上」**就是商業模式本身**，不能延後到不確定的未來。

---

## 0.5 現況盤點（Reality Check）

> 以實際跑出來的結果為準，不以計畫寫了什麼為準。

### 已落地（dependency-free、73 tests pass）

| Package | 狀態 | 在 v4 的位置 |
|---|---|---|
| `packages/semantic-engine` | ✅ recovery / readiness / fatigue，含 `signalCoverage` 與誠實 confidence | **核心決策原語**，符合承諾 A（自我解釋） |
| `packages/planning` | ✅ 週期化計畫生成、preview→commit 版本化 | 保留，需改造輸出格式 |
| `packages/knowledge-graph` | ✅ 896 節點 / 5743 邊、分類 94.1% | **降為內部證據來源**，不再是對外工具面 |
| `packages/connectors` | 🟡 Strava（normalize）、Apple Health（檔案匯入） | 兩者皆**無 OAuth**，未達架構圖要求 |
| `packages/db` | 🟡 PostgreSQL schema + mappers | 需依「只存衍生指標」重新檢視 |
| `apps/mcp-server` | 🟡 13 個 tool、stdio-only | **待砍到 7**；transport 待升級 |
| `/eval` | 🟡 19 golden cases、4 個 gate 全綠 | **測的全是內部正確性，零外部增益** |

### 依宣言檢驗，五個真實缺口

1. **增益未證明**（承諾 B）。`/eval` 的四個 gate 測「我們的輸出格式對不對」，**沒有一個測「接上之後模型變強多少」**。這是 v4 的第一優先。
2. **工具面違反原則 5「Decision, not Content」**。13 個裡有 8 個回傳原始資料或內容目錄，不回傳決策。
3. **訓練科學深度不足**。無 ATL / CTL / TSB，只有 7 日／28 日加總與粗糙 ACWR。「agent 開發者不想自己研究 training science」這個賣點目前撐不起來。
4. **多來源正規化只做了 2/6，且無 OAuth**。「把 Garmin 語言、Oura 語言轉成 Fitness Evidence Model」是核心責任之一，目前僅起步。
5. **外部 agent 接不上**。stdio-only。B2B 客戶（agent 開發者、marketplace）**在技術上無法成為客戶**。

---

## 治理層

### 定位原則（宣言，位階最高）
見 [Design Manifesto](design-manifesto.md)。

**五個設計原則（我們是什麼）**：1. Data stays with the user · 2. Permissioned · 3. Intelligence Layer · 4. AI Agent First · **5. Decision, not Content**

**兩條操作承諾（我們怎麼做）**：A. 每個決策自我解釋（confidence／evidence／signal coverage／limits） · B. 價值以決策品質提升衡量

### 工程原則（v3 沿用，位階次之）

| # | 原則 | 落實狀態 |
|---|---|---|
| P1 | Tool 回傳結構化資料，不回傳自然語言敘述 | ✅ |
| P2 | Plan 由引擎產生，LLM 只做編排與說明 | ✅ |
| P3 | 所有輸出 item 帶可驗證 ID，回傳前驗證存在性 | ✅ 讀取層已落實（`assertGrounded`） |
| P4 | 寫入一律 two-phase + idempotency key | 🟡 preview/commit 有，idempotency key 未補 |
| P5 | 日期／時區／相對時間由 server 解析 | ❌ 未實作 |
| P6 | 用 elicitation 一次收齊參數 | ❌ 未實作 |

### 決策日誌

| 決策 | 結論 | 狀態 |
|---|---|---|
| **D-POSITION** 產品定位 | Permissioned Intelligence Layer，不做 App／社群／內容庫 | 🟢 已定 |
| **D-DATA** 資料主權界線 | **只存衍生指標（負荷曲線、基線），不存原始讀數** | 🟢 已定 |
| **D-TOOL-V4** 工具面 | 13 → 7，依 GPT-6 判準；砍的是工具面不是程式 | 🟢 已定，待執行 |
| **D-NUTRITION** 營養 | 先理解核心規格，暫不實作 | 🟢 已定 |
| **D-PROTO** 協定升級 | ⚠️ **v3 的「延後」判斷已作廢**。外部 agent 接得上＝商業模式本身，移入 Phase 5 | 🔴 **需重新拍板時程** |
| D-GRAPHDB Graph DB 導入 | 未觸發，in-memory 足夠 | 🟢 不導 |

### 風險 Register

| 風險 | 綁定 gate | 現況 |
|---|---|---|
| **R1 增益無法證明**（v4 新增，**最高**） | Phase 1：lift 必須顯著且可重現 | 🔴 未測。若 lift 很小，整個定位崩塌——**這是最大的商業風險，不是技術風險** |
| **R2 定位滑回內容庫／App** | 每個 tool 都要過 GPT-6 判準 | 🟡 已發生過一次（Phase 1+2 蓋出內容檢索層），靠 v4 重構收回 |
| **R3 健康建議責任邊界**（升級） | 傷病禁忌硬過濾違反率 = 0 | 🟡 **B2B 讓這條更嚴重**：別人的 agent 呼叫我們的判斷，責任鏈更長。需在 tool description 與授權合約兩層聲明非醫療用途 |
| **R4 Apple Health 無伺服器 API**（v4 新增） | Phase 4 | 🟡 硬限制。B2B 客戶的使用者無法用 OAuth 交出 Apple Health 資料，需 companion app 或接受此來源缺席 |
| R5 Tool 太多讓模型變笨 | tool 總數 ≤ 10 | 🟢 重構後 7 個 |

---

## Phase 1 — 證明增益（Prove the Lift）

**狀態**：🔴 未開始 · **這是 v4 的第一優先，先於任何新功能**

> 承諾 B：價值以決策品質提升衡量。
> 目前 `/eval` 完全沒測這件事。沒有這個數字，後面所有工作都是自說自話。

### 交付物

1. **決策品質評分標準（rubric）**——針對 fitness 決策，可重現地評分：
   - **事實正確性**：提到的生理數值／訓練史是否真實
   - **證據紮實度**：建議是否基於使用者實際狀態，而非通用建議
   - **安全性**：是否違反傷病禁忌
   - **可執行性**：是否給出具體、符合器材與時間限制的方案
   - **誠實度**：資料不足時是否如實表達不確定

2. **A/B 評測 runner**：同一組決策問題，兩組條件
   - **對照組**：裸模型（無 MCP）
   - **實驗組**：模型 + Fitness MCP
   - 三家模型（GPT / Claude / Gemini）分開記分

3. **決策問題集（30–50 題）**：涵蓋需要個人證據才答得好的問題
   - 「我今天該練什麼？」（需 readiness）
   - 「我這週練太多了嗎？」（需負荷模型）
   - 「深蹲膝蓋痛，換什麼？」（需傷病紀錄＋器材）
   - 陷阱題：資料不足時，裸模型會不會自信地編造

### 驗收標準
- **lift 顯著且可重現**：實驗組在事實正確性與證據紮實度上明確勝出
- **裸模型的失敗模式被記錄下來**——這份失敗清單本身就是對外簡報的素材

### 為什麼這個先做
因為它可能**推翻整個定位**。如果裸模型答得跟接上 MCP 一樣好，那商業論點不成立，應該及早知道，而不是蓋完六個 Phase 才發現。

---

## Phase 2 — 工具面重構（13 → 7）

**狀態**：🔴 未開始 · 依 D-TOOL-V4

### 目標工具面

| Tool | 五層模型位置 | 現況 |
|---|---|---|
| `assess_fitness_state` | **Fitness State** 層 | ✅ 有（`get_semantic_fitness_state` 改名＋改造） |
| **`decide_session`** ← 核心 | **Decision → Action → Reason** | 🟡 `recommend_workout` 只做到推薦，**缺 from → to** |
| `decide_exercise_substitution` | 動作層級 Decision | 🟡 從 `get_exercise` 抽出保證部分 |
| `get_training_load` | Evidence／State（ATL／CTL／TSB） | ❌ 要蓋（見 Phase 3） |
| `generate_plan` / `adjust_plan` | **決策基底**（沒有計畫就只能推薦） | ✅ 有，需改造輸出 |
| `preview_*` / `commit_*` | 寫入保證 | ✅ 有 |

> **`recommend_workout` → `decide_session` 是概念改名，不是換字。**
> 舊的回傳「今天適合低衝擊 Zone 2」——那是 Recommendation，GPT-6 也做得到。
> 新的要回傳「**今天排定的 VO₂max Intervals → 45 分鐘 Zone 2**」——那是 Decision，需要知道今天原本該做什麼。

### 統一輸出契約：五層決策模型（落實承諾 A）

每個決策 tool 的回傳必須依 [五層模型](design-manifesto.md) 展開，**Decision 與 Action 分開**：

```json
{
  "evidence": [
    { "signal": "hrv_ms", "value": 41, "baseline": 52, "recordedAt": "...", "source": "garmin" },
    { "signal": "sleep_duration_hours", "value": 5.0, "recordedAt": "...", "source": "oura" }
  ],
  "state": { "recovery": "low", "readiness": 48, "acuteLoad": "high" },
  "decision": { "type": "adjust", "intent": "reduce_today_intensity" },
  "action": {
    "from": { "session": "VO₂max Intervals", "durationMinutes": 60, "intensity": "high" },
    "to":   { "session": "Zone 2 Endurance",  "durationMinutes": 45, "intensity": "moderate" }
  },
  "reason": [
    "HRV 41ms 低於個人 baseline 52ms",
    "睡眠 5.0h，累積睡眠負債",
    "急性負荷偏高（ACWR 1.4）"
  ],
  "confidence": "medium",
  "signalCoverage": { "usable": ["hrv", "sleep", "load"], "missing": ["stress"] },
  "limits": ["缺少主觀壓力資料，信心下調"]
}
```

**`decision.type` 取值**：`keep` / `adjust` / `substitute` / `defer` / `advance`。
`keep`（照原定執行）**也是決策**，一樣要附 evidence 與 reason。

`get_semantic_fitness_state` 已有 `signalCoverage` / `confidence` / `reasoning`，是 **state 層與 reason 層的樣板**；`decision` 與 `action` 兩層是新的。

### 砍出工具面（程式保留為內部能力）
`search_exercises`、`get_exercise`、`search_workouts`、`get_workout`、`get_user_profile`、`get_training_history`、`get_plan`、`list_plans`

原始資料改以 **evidence 欄位**出現在決策 tool 的輸出裡；計畫狀態降為 MCP resource。

### 驗收標準
- 對外 tool ≤ 10（目標 7）
- 每個 tool 通過 GPT-6 判準，且輸出符合統一契約
- **Phase 1 的 lift 不因重構而下降**（用同一組評測驗證）

---

## Phase 3 — 決策深度（Training Science）

**狀態**：🔴 未開始

> 賣點是「agent 開發者不想自己研究 HRV interpretation 與 training science」。這個 Phase 讓賣點成立。

### 交付物
1. **Training Load Model**：ATL（7 日）、CTL（42 日）、TSB，以指數移動平均實作
2. **分肌群疲勞衰減模型**——「今天別再練胸」的前提
3. **個人基線**：靜息心率／HRV 的個人基準線，而非固定常數（現在寫死 `hrvMs: 52` 是錯的，那是族群平均不是本人基線）
4. **`decide_session` 的 Action 層**：依今日證據調整既定課表（降強度／換動作／縮時長），回傳 from → to

### 資料主權約束（D-DATA）
負荷曲線與基線**可以保存**（衍生值、可重建、非醫療資料）；原始 HRV／心率／睡眠分期**不保存**。

### 驗收標準
- ATL/CTL/TSB 與公開實作對照，數學正確
- 個人基線在稀疏訊號使用者（如不戴錶睡覺）上仍能收斂或誠實回報不足
- **lift 相對 Phase 1 基準再提升**

---

## Phase 4 — 多來源正規化（Fitness Evidence Model）

**狀態**：🟡 2/6 來源，皆無 OAuth

> 宣言職責之一：把 Garmin 的語言、Oura 的語言、Apple Health 的語言，轉成 **Fitness Evidence Model** 的統一證據語彙。

### 交付物
1. **OAuth connector 框架**：Garmin / Oura / Whoop / Strava（皆有真雲端 API）
2. **Fitness Evidence Model schema**：跨來源統一的證據契約（含 source／recordedAt／baseline）
3. **Apple Health 路徑決策**（R4）：companion app、或明確標示此來源需手動匯入

### 驗收標準
- 新增一個來源**不動上層任何一行程式**（Apple Health 已驗證過這點）
- 同一位使用者接不同來源，`assess_fitness_state` 的輸出語意一致
- 訊號衝突時（兩來源給不同 HRV）有明確的優先序與揭露

---

## Phase 5 — 對外可用（讓客戶接得上）

**狀態**：🔴 未開始 · **D-PROTO 需重新拍板**

> v3 把 HTTP + OAuth 延後到「公開 demo 前」。**在 v4 定位下這個判斷作廢**：外部 agent 接得上就是商業模式本身。

### 交付物
- **Streamable HTTP** transport（SSE 已 deprecated）
- **OAuth 2.1 Resource Server**、RFC 8707 Resource Indicators
- 多租戶：一個 server 服務多個 agent 開發者的多個終端使用者
- 授權撤銷時，衍生指標一併刪除（D-DATA）

### 驗收標準
- 一個外部 agent 開發者能在**不接觸我們原始碼**的情況下接上並取得決策
- 三家 client（Claude / ChatGPT / Gemini）皆可連線

---

## Phase 6 — 商業化封裝

**狀態**：⚪ 未到

- **計價單位＝decision tool 呼叫**（商業單位就是決策原語）
- Usage metering 與配額
- Marketplace 上架：商品名是 **Fitness Decision Engine**，不是「Garmin Connector」
- 穿戴品牌的 Intelligence Layer 授權條款
- **責任邊界條款**（R3）：非醫療用途，B2B 責任鏈需明文

---

## Phase 7 — Nutrition Guidance

**狀態**：⚪ 依 D-NUTRITION 暫緩

架構圖上有，但先把 Recovery／Readiness／Workout Adjustment 三項訓練決策做深再說。進場時仍須通過 GPT-6 判準——**通用營養知識 GPT-6 已經有，我們要提供的是基於本人訓練負荷與目標的營養決策**。

---

## Phase 8 — 生態系

**狀態**：⚪ 未到

- Proactive agent（async tasks）
- 第三方 agent 生態
- Coach MCP（長期記憶與訓練哲學）

---

## 附錄：v3 → v4 對照

| v3 Phase | v4 去向 |
|---|---|
| P0 骨架與協定 | 部分完成（schema + eval 骨架）；協定移入 v4 Phase 5 |
| P1 知識庫 | **降為內部證據來源**。896 節點保留，不再是產品功能 |
| P2 讀取 API | **砍出工具面**（v4 Phase 2）。違反原則 5 |
| P3 規則推薦 | 併入 v4 Phase 2／3 的決策原語 |
| P4 計畫引擎 | 保留，改造輸出格式（v4 Phase 2） |
| P5 健康整合 | → v4 Phase 3（負荷模型）＋ Phase 4（多來源） |
| P6 寫入動作 | 保留，補 idempotency key 與 date resolver |
| P7 跨模型 UI / MCP Apps | **暫緩**。原則 4「AI Agent First」，我們不做 UI |
| P8 生態系 | → v4 Phase 8 |

> v3 附錄 A 的 Tool Surface 演進表已作廢，以 [宣言第 7 節](design-manifesto.md) 為準。
