# Fitness MCP — Design Manifesto

> 位階最高。與 [implementation plan](fitness-mcp-implementation-plan.md) 或既有程式衝突時，以本文件為準。

## Mission

> **A permissioned Fitness Decision Engine that turns fragmented, user-owned health evidence into explainable training decisions for AI agents.**

一個以使用者資料主權為前提的 Fitness Decision Engine，把分散在各家穿戴裝置、且屬於使用者的健康證據，轉換成 AI Agent 可採用、可解釋的訓練決策。

**不提供健康資料，不提供健身內容；提供的是基於證據與運動科學的決策。**

## 五個設計原則

1. **Data stays with the user** — 不建資料湖、不保存原始健康資料。
2. **Permissioned** — 授權是取得證據的唯一途徑；撤銷授權即撤銷能力。
3. **Intelligence Layer** — 提供運動科學與決策，不是 App、社群、資料庫。
4. **AI Agent First** — 第一使用者是程式，不是人。不做 UI、不搶對話。
5. **Decision, not Content** — 賣判斷，不賣素材。

## 兩條操作承諾

- **A. 決策自我解釋** — 每個輸出帶 confidence、evidence、signal coverage、limits。
- **B. 價值以決策品質提升衡量** — 不是 connector 數、tool 數、動作數。

## 腦袋來自 host：系統內不含 LLM

**Fitness MCP 不內含 LLM、不呼叫 LLM API、不訓練語言模型。**
語言理解、對話、意圖推理一律用 **Claude / ChatGPT 的腦袋**（host 那層）。

我們提供的是**確定性的領域智慧**——運動科學模型、知識圖譜、決策規則，可重現、可解釋、不依賴 LLM 推測（護城河 #2）。

| 誰做 | 做什麼 |
|---|---|
| **Host LLM**（Claude / ChatGPT） | 聽懂使用者、拆解意圖、把決策講成人話 |
| **Fitness MCP** | 依證據與運動科學算出決策，回傳結構化的 Decision → Action → Reason |

**推論**
- **零推論成本**：不付 token 費用，毛利結構乾淨。
- **模型無關**：換模型、新模型出現，我們不受影響。
- **Feedback Learning 學在確定性模型與圖譜裡**，不是 fine-tune LLM。
- 例外：開發期的 lift 評測需要呼叫模型——那是**開發工具**，不是產品的一部分。

## 核心護城河（Moat）

護城河不是 MCP，也不是單一 LLM，而是以下能力的組合：

1. **Semantic Fitness Layer** — 將 Apple Health、Garmin、Oura、WHOOP、Strava 等異質資料轉換為統一的 AI 語意狀態。
2. **Fitness Intelligence Engine** — 以運動科學模型產生可重現、可解釋的決策，而非依賴 LLM 推測。
3. **Fitness Knowledge Graph** — 以知識圖譜連結動作、肌群、恢復、訓練目標與營養知識。
4. **Feedback Learning** — 持續學習「狀態 → 決策 → 結果」的閉環，改善未來決策品質。
5. **Multi-LLM Interface** — 透過 MCP、REST API、SDK 等介面，讓 ChatGPT、Claude、Gemini 與未來 AI 共用同一套 Fitness Intelligence。

> 知識圖譜是護城河**能力**，但價值透過決策兌現，不透過檢索端點對外曝光（見原則 5）。
> Feedback Learning 需保存「狀態→決策→結果」三元組——那是決策紀錄，非原始健康資料，符合資料主權界線。

## 工具准入判準（GPT-6 Test）

> 「如果明天 GPT-6 已經知道所有運動知識，這個 Tool 還有存在價值嗎？」

**否 → 砍掉或降為內部。** GPT-6 殺死「知識查詢」，殺不死三樣：
**證據**（它沒有這個人的資料）、**計算**（它沒有執行縱向運算）、**保證**（確定性過濾器不會被說服繞過）。

## Decision ≠ Recommendation

| | Recommendation | **Decision** |
|---|---|---|
| 例 | 「建議今天跑 Zone 2」 | 「今天的 VO₂max Intervals → 45 分鐘 Zone 2」 |
| 結構 | 憑空發出的建議 | **from → to，對既有狀態的變更** |
| 前提 | 不需要 | **必須有「原本要做什麼」** |
| GPT-6 | ✅ 做得到 | ❌ 它不知道你今天原本該做什麼 |

**推論：計畫是決策的基底。** 沒有計畫只能推薦（弱）；有計畫才能決策（強）。
決策類型：`keep`（也是決策）· `adjust` · `substitute` · `defer` · `advance`

## 五層決策模型

```
Evidence        HRV ↓ · Sleep 5h · Load ↑
  ↓
Fitness State   Recovery = Low
  ↓
Decision        Reduce today's intensity        ← 意圖
  ↓
Action          Replace intervals with Zone 2   ← from → to
  ↓
Reason          HRV 低於 baseline · Sleep debt · High acute load
```

Decision 與 Action 分開：同一個意圖可對應不同 Action（受器材／時間／傷病影響）。
Reason 必須綁回 Evidence，不是事後編的說法。

## 架構（正式版，不得偏離）

```
User Device / User Accounts

  Apple Health
  Garmin
  Oura
  Whoop
  Strava
  MyFitnessPal

        │ User OAuth 授權
        ▼

Claude / ChatGPT
(Conversation + Reasoning Layer)

        │ MCP Tool Call
        ▼

Fitness MCP
(Data Access + Fitness Intelligence Interface)
  ※ Data Access = 使用者授權 AI 取用；data 所有權仍屬使用者

        ▼

Fitness Decision Engine

  Recovery
  Training Readiness
  Workout Adjustment

        ▼

Claude / ChatGPT 回覆使用者
```

**這張圖就是護城河**，也是與 Peloton MCP 的根本差異：Peloton 把既有的內容搜尋 API 包成 MCP tool，**MCP 之後直接就是回覆**；這裡在 MCP 與回覆之間有一個獨立的 **Fitness Decision Engine** 層，而它上游接的是使用者授權的多來源證據。

任何實作都不得改變這張圖的層次與名稱。實作進度另記於 [implementation plan](fitness-mcp-implementation-plan.md)，不反映在架構圖上。

## 資料如何進來（重要）

架構圖上 `User OAuth 授權` 的箭頭指向 **Claude / ChatGPT**，不是指向 Fitness MCP。

- **授權對象是 AI 那層**，不是我們。
- 證據經由 **MCP Tool Call 以參數傳入**；**Fitness MCP 不去廠商雲端拉資料、不持有原始資料**。
- 因此各來源有沒有伺服器端 API（例如 Apple Health 沒有）**與本架構無關**——我們從不 fetch。

這是原則 1「Data stays with the user」的結構性保證：我們對原始資料無狀態，只收證據、回決策。

> 用詞：內部討論 input 一律稱 **Evidence** 不稱 Data。架構圖層級名稱維持原文。
> `Data Access` 的語意＝**使用者授權 AI 取用，資料所有權仍屬使用者**。

## 資料主權界線

**只存衍生指標，不存原始讀數。**

| 可存 | 不可存 |
|---|---|
| 負荷曲線（ATL/CTL/TSB）、個人基線、疲勞衰減狀態、訊號覆蓋率 | 原始 HRV／心率／睡眠分期，任何可視為醫療紀錄的原始值 |

撤銷授權時，衍生指標一併刪除。

## 客戶

| 客戶 | 計價 |
|---|---|
| AI Agent 開發者（Running / Cycling / PT coach） | API / Intelligence usage |
| AI 平台 Marketplace | 平台分潤 |
| 穿戴品牌 | Intelligence Layer 授權 |

商品名是 **Fitness Decision Engine**，不是「Garmin Connector」。
**商業單位 = Decision Tools**，所以工具面的定義就是商業模型的定義。

## 第一里程碑

> 不是建平台，而是證明：**沒有這個 MCP，Claude / ChatGPT 的 fitness decision quality 會明顯下降。**

現有 `/eval` 測的全是內部正確性，**零外部增益**。需要的是：同一組決策問題，裸模型 vs 模型＋MCP 的對照評分。

## 明確不做

健身 App · 健身社群 · 聊天介面 · 內容資料庫 · 資料湖
