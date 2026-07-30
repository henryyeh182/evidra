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
手錶（Garmin · Apple Watch）—— 真正的量測源頭
   │ Garmin Connect / Connect IQ 向外同步
   ▼
Sources（Apple Health · Google Health · Strava · Oura · Whoop）
   │ 都是下游。Strava 最窄：只有運動當下的資料，沒有睡眠／HRV／靜息心率
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

**邊界精確定義**：hosted Fitness MCP 會 transiently process caller 傳入的
最小化 Evidence；不得把這件事描述成「完全不處理健康資料」。正式 wording：

> We process only the minimum health-related evidence submitted by the caller,
> solely to compute the requested fitness decision. We do not retain, sell, use
> for training, or use it for unrelated purposes.

Phase 1 是 `source connector → minimum Evidence → hosted Fitness MCP → transient
decision`；Phase 2 才把 `packages/evidence`、`packages/semantic-engine` 與
decision computation 放進 user-controlled local/private environment，讓 hosted
service 不接觸 raw health Evidence。完整邊界以
[`docs/design-manifesto.md`](docs/design-manifesto.md) 為準。

## 核心概念（使用者定調，2026-07-30）

> **知識的輸出現在已經沒有價值**，任何問 AI 馬上有答案。
> 但要做到**輸入的數據有結構化、標準化**，馬上可以立刻找到 `acwr = atl / ctl`。
> 這一個除法——來說明近期負荷除以長期負荷。算出的數值 = readiness、分肌群疲勞。
> **Claude 已經可以組成完整的中文理由句子**，然後用白話回應給 user。

三段分工：**①我們把四家資料做成標準化的一份 → ②我們做確定性計算 → ③Claude 講人話。**

系統內**不含 LLM**——但這條管的是**模型在誰家，不是有沒有模型**。禁的只有「我們的程式
呼叫模型來產生決策」；模型是前提不是選配，聽懂問題、湊齊證據、選工具、講人話全是 host 在做。

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
- 247 tests、eval 20 golden cases，全綠
- schema registry 涵蓋 6 家 ＋ Strava bulk export 方言；parser 實作 3 家（Apple Health／Garmin／Strava，Strava 含 API 與 bulk export 兩種方言）
- Strava bulk export：CSV 按欄位**索引**解析（5 組同名欄單位不同）；`Activity Date` 是 UTC 無 offset，本地時區只能從 `activities/*.fit.gz` 的 `activity.local_timestamp − timestamp` 還原（opt-in `readLocalTimezone`）
- 知識圖譜 889 節點 / 5,785 邊（**內部證據來源，不是對外產品**）
- transport：stdio ✅ · Streamable HTTP ✅ · OAuth **資源伺服器那一半 ✅**（`oauth.js`），
  但**簽章驗證器沒填、`serve:http` 進入點沒接線、沒有 authorization server** → 端到端還不能用
- 協定版本停在 `2025-06-18`；最新規格是 `2026-07-28`（stateless）。升級做法已定：dual-era

## 常用指令

```bash
npm test                     # 全套測試
npm run eval                 # golden set 計分
npm run review:phase         # 階段完成審查（宣告「做完了」之前必跑）
npm run build:graph          # 重建知識圖譜
npm run audit:graph          # 圖譜品質稽核
npm run serve:http           # HTTP transport
```

## 宣告完成之前

要說某個 Phase／偏差／修正「做完了」，先走 [docs/phase-review.md](docs/phase-review.md)：
先讀（memory → 本檔 → README → 宣言 → plan → user-journey），再跑 `npm run review:phase`
的九條 gate，最後回答七道機械驗不到的判斷題（GPT-6 判準、Decision ≠ Recommendation、
三條紀律…）。**gate 紅的不得宣告完成**——紅的是宣稱與現況的落差，不是待辦功能。

**MCP server 是常駐行程，改程式不會熱重載**——要驗證改動必須開新 session 或重啟行程。
