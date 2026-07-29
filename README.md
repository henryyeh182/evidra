# Fitness MCP

> **A permissioned Fitness Decision Engine that turns fragmented, user-owned health evidence into explainable training decisions for AI agents.**

一個以使用者資料主權為前提的 Fitness Decision Engine，把分散在各家穿戴裝置、且屬於使用者的健康證據，轉換成 AI Agent 可採用、可解釋的訓練決策。

**不提供健康資料，不提供健身內容；提供的是基於證據與運動科學的決策。**

## Architecture

```
User Device / User Accounts
  Apple Health · Garmin · Oura · Whoop · Strava · Google Health Connect
        │ User OAuth 授權
        ▼
Claude / ChatGPT  (Conversation + Reasoning Layer)
        │ MCP Tool Call
        ▼
Fitness MCP  (Data Access + Fitness Intelligence Interface)
        ▼
Fitness Decision Engine
  Recovery · Training Readiness · Workout Adjustment
        ▼
Claude / ChatGPT 回覆使用者
```

證據由 AI 那層經 tool call 傳入 — **Fitness MCP 不去廠商雲端拉資料，也不持有原始健康資料**。
系統內**不含 LLM**：語言與推理來自 host，我們提供確定性的領域智慧。

## Design Principles

1. **Data stays with the user** — 不建資料湖、不保存原始健康資料
2. **Permissioned** — 授權是取得證據的唯一途徑
3. **Intelligence Layer** — 提供運動科學與決策，不是 App、社群、資料庫
4. **AI Agent First** — 第一使用者是程式，不做 UI、不搶對話
5. **Decision, not Content** — 賣判斷，不賣素材

**Decision ≠ Recommendation**：推薦是憑空發出的建議（任何模型都會）；決策是對既有狀態的變更，帶 `from → to`，需要知道「今天原本該做什麼」。

## Moat

1. **Semantic Fitness Layer** — 異質資料 → 統一 AI 語意狀態
2. **Fitness Intelligence Engine** — 運動科學模型產生可重現、可解釋的決策
3. **Fitness Knowledge Graph** — 連結動作、肌群、恢復、訓練目標
4. **Feedback Learning** — 「狀態 → 決策 → 結果」閉環
5. **Multi-LLM Interface** — MCP / REST / SDK，共用同一套 Fitness Intelligence

## Not Building

健身 App · 健身社群 · 聊天介面 · 內容資料庫 · 資料湖

## Status

目前：**6 個決策 tool**（stdio ＋ Streamable HTTP）、889 節點知識圖譜、Apple Health／Strava／Garmin 證據正規化、221 tests pass。

各家 schema 的解讀能力有獨立的驗證軸線：`/schemas/sources` 記錄各廠原始格式（含 sentinel 與缺洞），
`/schemas/evidence` 是統一詞彙，`/eval/scenarios` 用五種匯出形狀（完整／sentinel／方言等價／有損／稀疏）
確認「registry 宣告的訊號真的解析得出來、單位有換算、缺的誠實說缺」。**那是讀 schema 的能力，不是調參。**

對外工具面全部是決策或決策基底：

| Tool | 產出 |
|---|---|
| `assess_fitness_state` | 恢復／準備度判定 |
| `decide_session` | 今日課表 from → to |
| `decide_exercise_substitution` | 動作替代 from → to |
| `generate_plan` | 計畫（決策的基底） |
| `preview_adjust_plan` / `commit_adjust_plan` | 兩階段寫入 |

偏差 D1–D4 已修；**剩 D5（證明增益）**，詳見 [Implementation Plan](docs/fitness-mcp-implementation-plan.md)。

## Documentation

- [**Design Manifesto**](docs/design-manifesto.md) — 定位與治理，位階最高
- [Implementation Plan](docs/fitness-mcp-implementation-plan.md) — 現況、偏差、Phase 順序
- [MCP Server](docs/mcp-server.md) — server 與 tool 說明
- [Phase Review](docs/phase-review.md) — 宣告完成前的審查機制（機械 gate ＋ 判斷題）
- [Schemas](schemas/README.md) · [Eval](eval/README.md)

## Local Commands

```bash
npm test                    # 221 tests
npm run eval                # golden set 計分
npm run review:phase        # 階段完成審查（宣告「做完了」之前必跑）
npm run simulate:garmin     # Garmin 各種匯出形狀的讀取報告
npm run build:graph         # 重建知識圖譜
npm run audit:graph         # 圖譜品質稽核
npm run import:apple-health # 匯入本機真實資料（git-ignored）
npm run demo:mcp            # tool 呼叫示範
```
