# Evidra — Fitness Decision Engine

> 這份文件每個 session 自動載入。**動手之前先讀完。**
> 完整版：[docs/design-manifesto.md](docs/design-manifesto.md)。兩者衝突時以宣言為準。

## Mission

**A permissioned Fitness Decision Engine that turns fragmented, user-owned health evidence into explainable training decisions for AI agents.**

不提供健康資料，不提供健身內容；**提供的是基於證據與運動科學的決策**。

## 五個設計原則

1. **Data stays with the user** — 不建資料湖、不保存原始健康資料
2. **Permissioned** — 授權是取得證據的唯一途徑
3. **Intelligence Layer** — 提供運動科學與決策，不是 App／社群／資料庫
4. **AI Agent First** — 第一使用者是程式，不做 UI、不搶對話
5. **Decision, not Content** — 賣判斷，不賣素材

## 兩條操作承諾

- **A. 決策自我解釋** — 每個輸出帶 confidence、evidence、signalCoverage、limits
- **B. 價值以決策品質衡量** — 不是 connector 數、tool 數、動作數

## Decision ≠ Recommendation（最常失守的一條）

| | Recommendation | **Decision** |
|---|---|---|
| 例 | 「建議今天跑 Zone 2」 | 「今天的 VO₂max Intervals → 45 分鐘 Zone 2」 |
| 結構 | 憑空發出 | **from → to，對既有狀態的變更** |
| 前提 | 不需要 | **必須知道「今天原本要做什麼」** |
| GPT-6 | 做得到 | 做不到 |

**計畫是決策的基底。** 決策型別：`keep`（也是決策）· `adjust` · `substitute` · `defer` · `advance`

## 五層決策模型

```
Evidence → Fitness State → Decision（意圖）→ Action（from → to）→ Reason（綁回證據）
```

Decision 與 Action 必須分開：同一意圖在不同器材／時間／傷病下落成不同 Action。

## 工具准入判準（GPT-6 Test）

> 「如果明天 GPT-6 已經知道所有運動知識，這個 Tool 還有存在價值嗎？」

否 → 砍掉或降為內部。GPT-6 殺死**知識查詢**，殺不死三樣：
**證據**（沒有這個人的資料）· **計算**（沒有執行縱向運算）· **保證**（確定性過濾器不會被說服繞過）。

## 架構（不得偏離）

```
Sources（Apple Health · Garmin · Oura · Whoop · Strava · MyFitnessPal）
   │ User OAuth 授權 —— 授權對象是 AI 那層，不是我們
   ▼
Claude / ChatGPT（Conversation + Reasoning）
   │ MCP Tool Call —— 證據以參數傳入
   ▼
Fitness MCP（Evidence Access + Intelligence Interface）
   ▼
Fitness Decision Engine（Recovery · Training Readiness · Workout Adjustment）
   ▼
Claude / ChatGPT 回覆使用者
```

**我們不 fetch、不持有原始健康資料。** 因此某來源有沒有伺服器 API 與本架構無關。
系統內**不含 LLM**——語言與推理來自 host，我們提供確定性的領域智慧。

## 三條反覆失守的紀律

這三條都因為實際偏移過而寫在這裡。動手前逐條自問。

### 1. 任何單一來源都必須能用

**沒有使用者需要湊齊 Strava ＋ Apple Watch ＋ Garmin。** 只有 Strava 的跑者靠訓練負荷拿決策；不戴錶睡覺的人靠 HRV 與廠商複合分數拿決策。**這是設計，不是降級。**

談任何來源時講**這組來源能做出什麼決策**，不要講它缺什麼。缺漏只出現在 `signalCoverage.missing` 與 confidence，不當敘事主軸。

> 已偏移三次：用「使用者沒有睡眠資料」論證設計、把 Strava 那排寫成「全空」。

### 2. 不拿單一使用者的資料特性當設計依據

匯入 Apple Health／Garmin 是為了讓 Semantic Fitness Layer **學會讀懂各家 schema**，不是拿來調參。

驗證軸線是**匯出檔的形狀**——完整／sentinel／缺洞／方言等價／有損／稀疏——不是某個運動員的故事。
可驗證的斷言只有六類：canonical 命名、單位換算、registry ↔ parser 一致、sentinel 不外洩、缺的列進 `signalCoverage.missing`、決策仍成立且自我解釋。

**模擬的生理數值不是 ground truth**，不得用來回頭 fit `readiness < 40` 這類門檻。

### 3. 沒有同意不要動程式

使用者問設計問題時，先回答問題。要改程式先說要改什麼、為什麼，**得到同意才動手**。

## 明確不做

健身 App · 健身社群 · 聊天介面 · 內容資料庫 · 資料湖

## 現況（2026-07）

- 對外 **6 個決策 tool**：`assess_fitness_state` · `decide_session` · `decide_exercise_substitution` · `generate_plan` · `preview_adjust_plan` · `commit_adjust_plan`
- 157 tests、eval 20 golden cases，全綠
- schema registry 涵蓋 6 家；parser 實作 3 家（Apple Health／Garmin／Strava）
- 知識圖譜 896 節點（**內部證據來源，不是對外產品**）
- transport：stdio ✅ · Streamable HTTP ✅ · **OAuth ❌**（手機與 marketplace 上架的前提）

## 常用指令

```bash
npm test                     # 全套測試
npm run eval                 # golden set 計分
npm run build:graph          # 重建知識圖譜
npm run audit:graph          # 圖譜品質稽核
npm run serve:http           # HTTP transport
```

**MCP server 是常駐行程，改程式不會熱重載**——要驗證改動必須開新 session 或重啟行程。
