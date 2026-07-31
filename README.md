# Evidra — Fitness Decision Engine

> 使用者用自己已訂閱的 AI App 對話；AI 自動取得使用者授權的運動證據，
> Fitness MCP 以最小化資料計算訓練決策，AI 再以自然語言提供個人化、可解釋的教練回覆。

**AI host 是教練的大腦與對話介面；Fitness MCP 是教練背後的運動科學計算與安全判斷引擎。**

最重要的情境是：使用者要 AI 的教練能力，但**不要 Claude、也不要我們的 hosted MCP
看見他完整的原始健康資料**。

## 使用者旅程

```
使用者
  │ 手機輸入：
  │「我今天的課表是什麼？」
  │「昨天運動量很大，今天適合做什麼？」
  ▼
Claude / ChatGPT Mobile
  │ 理解問題、判斷需要哪些資料
  ▼
資料來源 connector
  │ Apple Health / Garmin / Strava
  ▼
最小化 Evidence
  │ 例如：昨日負荷、近 7 日負荷、睡眠、HRV、今日課表
  ▼
Fitness MCP
  ├─ 標準化
  ├─ 計算 ACWR / readiness / fatigue
  ├─ 套用確定性規則
  └─ 產生 Decision / Action / Reason
  ▼
Claude / ChatGPT
  │ 把結構化結果轉成自然語言
  ▼
使用者得到個人化教練回覆
```

## 三段分工

| 段 | 誰做 | 做什麼 |
|---|---|---|
| 1 | 我們 | 把各家資料做成結構化、標準化的一份 |
| 2 | 我們 | 確定性計算：`acwr = atl / ctl` 就是一個除法，不需要模型 |
| 3 | Host（Claude／ChatGPT） | 組句子、用白話講給使用者聽 |

我們的程式不呼叫模型來產生決策——決策必須是確定性的、可重現的。
但模型是前提不是選配：聽懂問題、湊齊證據、選工具、講人話全在 host 那邊。

## Decision ≠ Recommendation

| | Recommendation | Decision |
|---|---|---|
| 例 | 「建議今天跑 Zone 2」 | 「今天的 VO₂max Intervals → 45 分鐘 Zone 2」 |
| 結構 | 憑空發出 | from → to，對既有狀態的變更 |
| 前提 | 不需要 | 必須知道「今天原本要做什麼」 |

決策型別：`keep`（也是決策）· `adjust` · `substitute` · `defer` · `advance`

五層：`Evidence → Fitness State → Decision（意圖）→ Action（from → to）→ Reason（綁回證據）`

每個輸出帶 `confidence`、`evidence`、`signalCoverage`、`limits`。
缺的訊號列進 `signalCoverage.missing` 並下調信心，**不補造數值**。

## 隱私邊界

對外只能這樣說：

> We process only the minimum health-related evidence submitted by the caller,
> solely to compute the requested fitness decision. We do not retain, sell, use
> for training, or use it for unrelated purposes.

不能說 `We never process health data`——接收並計算 Evidence 本身就是 transient processing。

### 兩種部署

**Phase 1 — Hosted decision service**：hosted MCP 短暫處理最小化 Evidence，
不持久化、不保管、不二次利用；不直接連資料供應商、不持有來源 OAuth refresh token。

**Phase 2 — User-controlled private engine**：source connectors、`packages/evidence`、
`packages/semantic-engine` 與 decision computation 全部在使用者控制的環境執行，
hosted service 不接觸 raw health Evidence。**MCP 從遠端資料處理中心變成
安裝在使用者環境裡的 local data plane。**

Phase 2 是核心宗旨要的那個版本，不是選配。兩種模式共用同一套 domain packages。

## 對外工具

全部是決策或決策的基底。

| Tool | 產出 |
|---|---|
| `assess_fitness_state` | 恢復／準備度判定 |
| `decide_session` | 今日課表 from → to |
| `decide_exercise_substitution` | 動作替代 from → to |
| `generate_plan` | 計畫（決策的基底） |
| `preview_adjust_plan` / `commit_adjust_plan` | 兩階段調整 |

## 現況

| 項目 | 現況 |
|---|---|
| 對外 tool | 6 個（`tools/list` 實測） |
| 資料標準化 | `packages/connectors` 實作 3 家（Apple Health／Garmin／Strava，Strava 含 API 與 bulk export 兩種方言）；schema registry 涵蓋 6 家 |
| 確定性計算 | `semantic-engine`（readiness／分肌群疲勞）· `training-load`（ATL/CTL/TSB/ACWR）· `decision-engine`（from→to）· `planning` · `knowledge-graph`（889 節點 / 5,785 邊） |
| 測試 | 248 tests、eval 20 golden cases 全綠 |
| 傳輸 | stdio ✅ · Streamable HTTP ✅ |
| OAuth | 只做了「檢查 token claims」那一半；**簽章驗證器沒填、`serve:http` 進入點沒接線、沒有 authorization server** → 遠端連不起來 |
| 協定版本 | `2025-06-18`；最新規格是 `2026-07-28`（stateless），升級走 dual-era |
| Phase 2 | **一行程式都沒有** |

source schema 與匯出形狀 scenario 目前只做了 Garmin 一家；Apple Health 與 Strava
有 parser 但缺 `schemas/sources/` 契約與 `eval/scenarios/` 場景。

## 明確不做

健身 App · 健身社群 · 聊天介面 · 內容資料庫 · 資料湖

## 文件

- [**產品規格需求書**](docs/product-spec.md) — 核心需求、架構、概念、使用者情境。**正本**
- [Design Manifesto](docs/design-manifesto.md) — 原則與治理判準
- [Implementation Plan](docs/fitness-mcp-implementation-plan.md) — 現況、順序、會變動的市場事實
- [MCP Server](docs/mcp-server.md) — server 與 tool 說明
- [Phase Review](docs/phase-review.md) — 宣告完成前的審查機制
- [Schemas](schemas/README.md) · [Eval](eval/README.md)

## 指令

```bash
npm test                    # 248 tests
npm run eval                # golden set 計分
npm run review:phase        # 階段完成審查（宣告「做完了」之前必跑）
npm run serve:http          # HTTP transport
npm run simulate:garmin     # Garmin 各種匯出形狀的讀取報告
npm run build:graph         # 重建知識圖譜
npm run audit:graph         # 圖譜品質稽核
npm run import:apple-health # 匯入本機真實資料（git-ignored）
npm run demo:mcp            # tool 呼叫示範
```
