# Evidra — Fitness Decision Engine

> **Evidra decides today's session.**
> 它不查資料、不給建議。它拿**你今天原本排定的課表**與**你現在的身體證據**，
> 回一個 `from → to` 的變更，並說得出憑什麼。

一次真實的輸出（`examples/evidence-garmin-hard-day.json`，可自行重跑）：

```jsonc
"action": {
  "from": { "focus": "Tempo Run",    "durationMinutes": 50, "intensity": "high" },
  "to":   { "focus": "Moderate run", "durationMinutes": 50, "intensity": "moderate" },
  "changed": ["focus", "intensity"]
},
"decision": { "type": "adjust", "intent": "reduce_today_intensity" },
"reason": [
  "Readiness 48 is below 60, so intensity comes down.",
  "At moderate intensity the session is no longer \"Tempo Run\"; it becomes \"Moderate run\"."
],
"confidence": "high",
"decisionBasis": {
  "governingRule": {
    "ruleId": "EVD-R-002",
    "title":  "Low readiness pulls intensity down one step",
    "measured": { "quantity": "readiness_score", "value": 48 },
    "evidence": { "studyDesign": "none", "recommendationStrength": "internal_heuristic" }
  }
}
```

**沒有那份 `from`，這一切就只是建議。** 問「今天練什麼」而手上沒有課表時，Evidra 不會
編一個出來——它回 `intent: no_scheduled_session`，並附一句
`This is a recommendation question, not a decision.`

**AI host 是教練的大腦與對話介面；Fitness MCP 是教練背後的運動科學計算與安全判斷引擎。**

最重要的情境是：使用者要 AI 的教練能力，但**不要 Claude、也不要我們的 hosted MCP
看見他完整的原始健康資料**。

## 使用者旅程

```
使用者
  │ 在 Claude Desktop 輸入：
  │「今天排的是 Tempo Run 50 分鐘高強度，我還該照做嗎？」
  ▼
Claude Desktop
  │ 聽懂問題、湊齊證據 —— 從使用者的匯出檔，或直接問他
  │「昨天練了什麼、睡多久」本身就是合法的證據
  ▼
Evidra（MCP tool call）
  │ 證據以「參數」進入呼叫。Evidra 不連任何雲端、不持有 token、
  │ 不 fetch 任何人的資料 —— 它只看得到這一次呼叫傳進來的東西
  ├─ 標準化各家方言
  ├─ 計算 ACWR / readiness / 分肌群疲勞
  ├─ 套用確定性規則與傷病硬過濾
  └─ 回傳 Decision / Action(from → to) / Reason / decisionBasis
  ▼
Claude Desktop
  │ 把結構化決策講成人話（強度與動作不重新推導）
  ▼
使用者知道今天那堂課變成什麼，以及為什麼
```

**證據路徑今天長這樣**：`evidenceSource` 只有 `provided`（呼叫端傳入）與 `demo_seed` 兩種。
`packages/connectors` 的六家解析器是用來**讀懂各家匯出檔的格式**，不是決策路徑上的即時
connector——Evidra 從不代替使用者連上 Apple Health、Garmin 或 Strava。

今天已走通的是 **Claude Desktop + desktop extension（MCPB）**。手機情境需要 remote MCP
server，因此仍卡在 authorization server、OAuth 簽章驗證、HTTPS 公開部署與 hosted 版隱私政策。

裝好之後貼上去就能跑的五則問法在 [`examples/README.md`](examples/README.md)。

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
缺的訊號列進 `signalCoverage` 並下調信心，**不補造數值**。

`signalCoverage` 分兩組，因為缺的性質不同：

```json
"signalCoverage": {
  "recovery": { "usable": ["hrv"], "missing": ["sleep"] },
  "training": { "usable": ["trainingLoad"], "missing": [] }
}
```

- `recovery.missing` —— 今天的睡眠／HRV／靜息心率／壓力沒有夠新的讀數
- `training.missing` —— 近 7 天有訓練沒帶負荷

**嚴格定義：那一組每一筆都有才算 `usable`**，一筆缺就進 `missing`。
沒有負荷的訓練不計入分肌群疲勞（不當成 0，因為沒人說它不累），
`training.missing` 是呼叫端得知這件事的唯一途徑，confidence 也會跟著降。

分肌群疲勞是 `trainingLoad × decay`，**不乘 RPE**——廠商算好的負荷本身已含強度，
`training-load` 算 ATL／CTL／ACWR 用的也是同一個數字。RPE 仍當證據收，但不參與計算。

## Privacy Policy

> 這一節是**對外的**，隨 `.mcpb` bundle 出去給審閱者與使用者讀，所以是英文。
> 底下的〈隱私邊界〉是給我們自己看的判準，兩者不要合併。
> 完整政策：https://github.com/henryyeh182/evidra/blob/main/PRIVACY.md

Evidra runs locally on your own machine and does not retain your evidence.

We process only the minimum health-related evidence submitted by the caller, solely to
compute the requested fitness decision. We do not retain, sell, use for training, or use
it for unrelated purposes.

Evidra never fetches your data — it only sees what the calling AI assistant passes into a
tool call: recovery signals for today, recent training load, the session you had scheduled,
and context you state yourself. As a desktop extension, this is checkable against the one
compiled server file it ships — minifying does not hide which standard-library modules a
file imports:

- **Evidra itself performs no outbound network requests.** No outbound HTTP, fetch, socket,
  or DNS calls, and it transmits your evidence nowhere.
- **Evidra itself does not persist your evidence.** No database, no cache, no log file,
  no history.
- **No runtime dependencies.** Node.js standard library only — no analytics, telemetry, or SDKs.
- **No model calls.** Decisions are deterministic arithmetic and explicit rules.
- **No accounts.** No sign-up, no login, no user identifier.

These statements describe Evidra's own behaviour, not the computer it runs on, the AI
assistant that calls it, or the operating system and Node.js runtime underneath it.

Evidence exists in memory for the duration of a single tool call. Nothing is written to
durable storage, so there is nothing for us to keep, delete, or export on request.

Evidra is not a medical device and does not provide medical advice. It is intended for
general fitness and training purposes only.

Privacy questions and requests: **evidramcp@icloud.com**

## 隱私邊界

對外只能這樣說：

> We process only the minimum health-related evidence submitted by the caller,
> solely to compute the requested fitness decision. We do not retain, sell, use
> for training, or use it for unrelated purposes.

不能說 `We never process health data`——接收並計算 Evidence 本身就是 transient processing。

### 三種形態

這不是三個階段，是三種使用者處境；三者共用同一套 domain packages 與確定性決策邏輯。

**Form 1 — Desktop extension（MCPB）**：目前第一個可用形態，跑在使用者自己的電腦上，
走 stdio。上面英文 Privacy Policy 描述的是這個已發布 bundle 的行為：不 outbound、
不持久化、不呼叫模型、不需要帳號。

**Form 2 — Remote MCP server**：手機唯一可行的路，也是未來商業化形態。hosted MCP
只能短暫處理最小化 Evidence，不持久化、不保管、不二次利用；不直接連資料供應商、
不持有來源 OAuth refresh token。這條目前還是 NO-GO。

**Form 3 — User-controlled private engine**：source connectors、`packages/evidence`、
`packages/semantic-engine`、`packages/db` 與 decision computation 全部在使用者控制的環境執行。
hosted service 不接觸 raw health Evidence。**MCP 從遠端資料處理中心變成
安裝在使用者環境裡的 local data plane。**

**持久化只存在於 Form 3。** `packages/db` 會寫入 provider 原始 payload、HRV／睡眠、
每日狀態——Form 2 界線禁止把 raw Evidence 寫進 database，那些表在 hosted 一張都不能建。
所以 Form 2 hosted 永遠無狀態，計畫由呼叫端持有並隨每次呼叫傳入；Form 3 才有持久層。

Form 3 是核心宗旨要的那個版本，不是選配。它排在後面是因為尚未開工，不是因為不重要。

## 對外工具

全部是決策或決策的基底。

| Tool | 產出 |
|---|---|
| `evidra_assess_fitness_state` | 恢復／準備度判定 |
| `evidra_decide_session` | 今日課表 from → to |
| `evidra_decide_exercise_substitution` | 動作替代 from → to |
| `evidra_generate_plan` | 計畫（決策的基底） |
| `evidra_preview_adjust_plan` / `evidra_commit_adjust_plan` | 兩階段調整 |

## 現況

| 項目 | 現況 |
|---|---|
| 對外 tool | 6 個（`tools/list` 實測） |
| 資料標準化 | `packages/connectors` 實作 6 家（Apple Health／Garmin／Strava／Google Health Takeout／Oura／WHOOP，Strava 含 API 與 bulk export 兩種方言）；schema registry 涵蓋 6 家。前四家照真實匯出檔寫，Oura／WHOOP 照兩家自己的 OpenAPI 寫、尚未對過真實回應 |
| 確定性計算 | `semantic-engine`（readiness／分肌群疲勞）· `training-load`（ATL/CTL/TSB/ACWR）· `decision-engine`（from→to）· `planning` · `knowledge-graph`（889 節點 / 5,785 邊） |
| 測試 | 407 tests、eval 20 golden cases 全綠 |
| 傳輸 | stdio ✅ · Streamable HTTP ✅ |
| OAuth | 只做了「檢查 token claims」那一半；**簽章驗證器沒填、`serve:http` 進入點沒接線、沒有 authorization server** → 遠端連不起來 |
| 協定版本 | `2025-06-18`；最新規格是 `2026-07-28`（stateless），升級走 dual-era |
| 產品形態 | Form 1 desktop extension 可用；Form 2 remote MCP server 目前 NO-GO；Form 3 user-controlled deployment **一行程式都沒有** |

source schema 與匯出形狀 scenario **四家齊備**（Garmin／Google Health Takeout／Apple Health／Strava）。

**這個版本走到哪裡**：目前的發布是 v0.3.7，v0.1.0 是第一次公開發布。決策邏輯有確定性測試與 eval 覆蓋——
同一個版本下，同樣的證據永遠得到同樣的決策。`evidra_decide_session` 的決策另外帶
`decisionBasis`——依據哪條規則、哪個讀數觸發、那條規則的數字哪裡來；其餘五個 tool 的門檻
還沒進規則庫，所以不回傳這個欄位（技術債 C9）。
**但它還沒有經過長期真實訓練週期的驗證。**

**本檔與 `docs/`、`examples/` 描述的是這個 repo 的目前建置，不是 v0.3.7。**
v0.3.7 凍結於 2026-08-07 00:56，而當天的出處覆核在 2.5 小時後才進來，所以那顆
**規則庫還是 1.0.0、EVD-R-007 仍宣稱 `systematic_review`、仍帶著已撤回的「4–7%」、
`vendorAssessments` 不在 tool schema 裡**。逐項差距表在
[user-journey.html](docs/user-journey.html) 的〈Install〉一節，
會在下一版一起出貨。**文件連結跟著 main 走、bundle 停在 release，這個落差是預設狀態**——
改對外敘述時要主動對照已發布那顆，不是對照 working tree。

**證據由呼叫端提供。** Evidra 不會代替使用者連上 Apple Health、Garmin、Strava
或任何其他服務，也不需要綁定帳號——它讀的是呼叫時交給它的東西，可以單純是
「昨天練了什麼、睡了多久」。已經匯出的資料也能當輸入評估。
沒提供的訊號會列進 `signalCoverage` 並下調 confidence，**不會用預設值補**。

## 明確不做

健身 App · 健身社群 · 聊天介面 · 內容資料庫 · 資料湖

## 文件

- [**Demo prompts 與 sample evidence**](examples/README.md) — 裝好之後貼上去就能跑的五則；輸出由 `apps/mcp-server/test/examples.test.js` 釘住
- [User Journey](docs/user-journey.html) — 對外敘事正本：產品核心、獨特性、使用者情境
- [**產品規格需求書**](docs/product-spec.md) — 核心需求、架構、概念、使用者情境
- [Design Manifesto](docs/design-manifesto.md) — 原則與治理判準
- [Implementation Plan](docs/fitness-mcp-implementation-plan.md) — 工程 roadmap 正本：現況、順序、會變動的市場事實
- [MCP Server](docs/mcp-server.md) — server 與 tool 說明
- [Phase Review](docs/phase-review.md) — 宣告完成前的審查機制
- [Schemas](schemas/README.md) · [Eval](eval/README.md)

## 接上 Claude Desktop

stdio、本機。遠端 host（Claude app／ChatGPT app）還接不起來——缺遠端 https 部署與
authorization server，見上面〈現況〉的 OAuth 一列。

**設定檔是每台機器各自的，不會被任何機制同步過去。換一台就要再做一次。**

**1. 取得這台機器的 node 絕對路徑**

```bash
which node
```

GUI 啟動的 app 拿到的 PATH 很精簡，設定檔裡**不能寫裸的 `node`**，會找不到。

**2. 編輯 `~/Library/Application Support/Claude/claude_desktop_config.json`**

這個檔案已經有 Claude Desktop 自己寫入的內容（`coworkUserFilesPath`、`preferences`、
帳號識別碼、視窗版面狀態）。**只在最外層加 `mcpServers`，不要整份覆蓋。**

```json
{
  "coworkUserFilesPath": "…原本的，不要動…",
  "preferences": { "…原本的，不要動…" },
  "mcpServers": {
    "fitness-mcp": {
      "command": "/opt/homebrew/bin/node",
      "args": ["/absolute/path/to/fitness-mcp/apps/mcp-server/src/stdio.js"]
    }
  }
}
```

兩個值都要換成這台機器的實際路徑：`command` 用步驟 1 的輸出，`args` 用這份 repo 的絕對位置。

**3. 完全結束 Claude Desktop 再開啟**（關視窗不算）。MCP server 是常駐行程，
改程式或改設定都不會熱重載。

**4. 驗證**：問一句「今天排的是 VO2max intervals，我跑得動嗎？」，
應該會看到 `Decide Today's Session` 這個工具被呼叫。

> 這個檔案不進版控：裡面是機器專屬的絕對路徑與帳號狀態，而且 Claude Desktop
> 會自己覆寫它。進 git 的是上面這段做法。

## 指令

```bash
npm test                    # 407 tests
npm run eval                # golden set 計分
npm run review:phase        # 階段完成審查（宣告「做完了」之前必跑）
npm run serve:http          # HTTP transport
npm run simulate:garmin     # Garmin 各種匯出形狀的讀取報告
npm run build:graph         # 重建知識圖譜
npm run audit:graph         # 圖譜品質稽核
npm run import:apple-health # 匯入本機真實資料（git-ignored）
npm run demo:mcp            # tool 呼叫示範
```
