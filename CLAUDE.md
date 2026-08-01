# Evidra — Fitness Decision Engine

> 這份文件每個 session 自動載入。**動手之前先讀完。**
> 正本是 [docs/product-spec.md](docs/product-spec.md)（核心需求、架構、概念、使用者情境）；
> 原則與治理判準在 [docs/design-manifesto.md](docs/design-manifesto.md)。衝突時以規格需求書為準。

## 核心宗旨

使用者要 AI 的教練能力，但**不要 Claude、也不要我們的 hosted MCP 看見他完整的原始健康資料**。

所以 host 只當大腦與對話介面，Fitness MCP 只當背後的運動科學計算與安全判斷引擎，
收最小化證據、算完不留。

## 三段分工

| 段 | 誰做 | 做什麼 |
|---|---|---|
| 1 | 我們 | 把各家資料做成結構化、標準化的一份 |
| 2 | 我們 | 確定性計算：`acwr = atl / ctl` 就是一個除法，不需要模型 |
| 3 | Host | 組句子、用白話講給使用者聽 |

**我們的程式不呼叫模型來產生決策。** 但模型是前提不是選配——聽懂問題、湊齊證據、
選工具、講人話全在 host 那邊。這條管的是模型在誰家，不是有沒有模型。

## Decision ≠ Recommendation（最常失守的一條）

| | Recommendation | **Decision** |
|---|---|---|
| 例 | 「建議今天跑 Zone 2」 | 「今天的 VO₂max Intervals → 45 分鐘 Zone 2」 |
| 結構 | 憑空發出 | **from → to，對既有狀態的變更** |
| 前提 | 不需要 | **必須知道「今天原本要做什麼」** |
| GPT-6 | 做得到 | 做不到 |

**計畫是決策的基底。** 決策型別：`keep`（也是決策）· `adjust` · `substitute` · `defer` · `advance`

五層：`Evidence → Fitness State → Decision（意圖）→ Action（from → to）→ Reason（綁回證據）`

Decision 與 Action 必須分開：同一意圖在不同器材／時間／傷病下落成不同 Action。

## 邊界：能說什麼，不能說什麼

能說：

> We process only the minimum health-related evidence submitted by the caller,
> solely to compute the requested fitness decision. We do not retain, sell, use
> for training, or use it for unrelated purposes.

**不能說 `We never process health data`。** 接收並計算 Evidence 本身就是 transient processing。
「不 fetch、不持有原始資料」不等於「完全不處理資料」。

內部討論 input 一律稱 **Evidence** 不稱 Data。

## 兩種部署

- **Phase 1（hosted）**：短暫處理最小化 Evidence，不持久化、不保管、不二次利用；
  不直接連資料供應商、不持有來源 OAuth refresh token；log／trace 遮蔽 payload、token 與健康欄位。
- **Phase 2（user-controlled）**：connectors、`packages/evidence`、`packages/semantic-engine`、
  `packages/db` 與 decision computation 全在使用者控制的環境跑。MCP 變成 local data plane。

**Phase 2 是核心宗旨要的那個版本，不是選配。** 排序依核心宗旨，不依 Phase 編號。

**持久化只能存在於 Phase 2。** `packages/db` 會寫入 provider 原始 payload、HRV／睡眠、
每日狀態——Phase 1 界線禁止把 raw Evidence 寫進 database，所以那些表在 hosted 一張都不能建。
**Phase 1 hosted 永遠無狀態**，計畫由呼叫端持有並隨呼叫傳入。

**決策紀錄我們不留**（2026-07-31 使用者確認）：「狀態→決策→結果」三元組由呼叫端保存，
可作為證據回傳。Phase 1 存在 AI host 的記憶，Phase 2 存在使用者自己的 `packages/db`
——**兩種情況 hosted 都不留**。我們這端的學習在引擎規則與知識圖譜，不在個人資料。

## 工具准入判準（GPT-6 Test）

> 「如果明天 GPT-6 已經知道所有運動知識，這個 Tool 還有存在價值嗎？」

否 → 砍掉或降為內部。GPT-6 殺死**知識查詢**，殺不死三樣：
**證據**（沒有這個人的資料）· **計算**（沒有執行縱向運算）· **保證**（確定性過濾器不會被說服繞過）。

## 四條反覆失守的紀律

都因為實際偏移過而寫在這裡。動手前逐條自問。

### 1. 沒有同意不要動程式

使用者問設計問題時，先回答問題。要改程式先說要改什麼、為什麼，**得到同意才動手**。

### 2. 輸入不得由我們編造

沒給的值就是沒有。不用預設值代替缺失輸入（沒有 RPE 就是沒有，不是 5），
缺的走 `signalCoverage.recovery.missing`／`signalCoverage.training.missing` 並下調 confidence。

`signalCoverage` 分兩組：`recovery` 是今天的睡眠／HRV／靜息心率／壓力夠不夠新，
`training` 是近 7 天每一筆訓練有沒有帶負荷。**嚴格定義：全部都有才算 usable**，
一筆缺就整組進 missing。沒有負荷的訓練不計入分肌群疲勞，
`training.missing` 就是呼叫端得知這件事的唯一途徑。

**分肌群疲勞 = `trainingLoad × decay`，不再乘 `rpe/10`。** 廠商算好的負荷
（Garmin `activityTrainingLoad`、Strava Relative Effort、Apple Health 活動能量）
本身已含強度，`training-load` 也是直接用同一個數字算 ATL／CTL／ACWR。
RPE 仍當證據收進來，但不參與任何計算——所以不供 RPE 的來源不會被扣分。

**確定性門檻必須有出處**——`acwrHigh = 1.4`、`maxSampleGapSeconds = 30` 這類數字
要嘛附依據，要嘛標為未驗證，要嘛改由呼叫端傳入。**無出處的值不准進 repo。**

廠商算好的複合分數（readiness、Body Battery）當一等證據收進來，不重算。

### 3. 任何單一來源都必須能用

**沒有使用者需要湊齊 Strava ＋ Apple Watch ＋ Garmin。** 只有 Strava 的跑者靠訓練負荷拿決策；
不戴錶睡覺的人靠 HRV 與廠商複合分數拿決策。**這是設計，不是降級。**

談任何來源時講**這組來源能做出什麼決策**，不要講它缺什麼。缺漏只出現在
`signalCoverage.recovery.missing`／`signalCoverage.training.missing` 與 confidence，不當敘事主軸。

### 4. 不拿單一使用者的資料特性當設計依據

匯入 Apple Health／Garmin 是為了讓 Semantic Fitness Layer **學會讀懂各家 schema**，不是調參。

驗證軸線是**匯出檔的形狀**——完整／sentinel／缺洞／方言等價／有損／稀疏。
可驗證的斷言只有六類：canonical 命名、單位換算、registry ↔ parser 一致、sentinel 不外洩、
缺的列進 `signalCoverage` 對應那一組的 `missing`、決策仍成立且自我解釋。

**模擬的生理數值不是 ground truth**，不得用來回頭 fit `readiness < 40` 這類門檻。

## 現況（2026-08-01 查證）

- 對外 **6 個 tool**：`assess_fitness_state` · `decide_session` · `decide_exercise_substitution` ·
  `generate_plan` · `preview_adjust_plan` · `commit_adjust_plan`
- **288 tests**、eval 20 golden cases，全綠
- parser 實作 4 家（Apple Health／Garmin／Strava／Google Health Takeout；Strava 含 API 與
  bulk export 兩種方言）；schema registry 涵蓋 6 個平台
- Strava bulk export：CSV 按欄位**索引**解析（5 組同名欄單位不同）；`Activity Date` 是 UTC 無 offset，
  本地時區只能從 `activities/*.fit.gz` 的 `activity.local_timestamp − timestamp` 還原
  （opt-in `readLocalTimezone`）
- Google Health Takeout（＝ Fitbit 形狀的匯出，跟 Health Connect API 是同平台不同方言）：
  每日檔的 timestamp 是「本地午夜以 UTC 表示」（16:00Z ＝ +08:00 的 00:00，時刻本身就編碼了
  offset）；按月 JSON 日期是 `MM/DD/YY`；`0`／`0.0`／`UNSPECIFIED` 全是 not-measured sentinel；
  同一天的步數會同時來自 Garmin 與手機兩個 recorder（取單一 recorder 最大值，不相加）；
  Garmin 同步進來的值不會有 Fitbit 複合分數（sleep_score／Stress Score 只剩表頭、cardio_load 全 0）
- 知識圖譜 889 節點 / 5,785 邊（**內部證據來源，不是對外產品**）
- transport：stdio ✅ · Streamable HTTP ✅；OAuth 只有「檢查 token claims」那一半
  （`oauth.js`），**簽章驗證器是 `null`、`http.js` 進入點沒傳 `oauth`、沒有 authorization server**
  → 端到端還不能用
- 協定停在 `2025-06-18`；最新規格 `2026-07-28`（stateless）。升級走 dual-era
- `schemas/sources/` 與 `eval/scenarios/` 有 Garmin 與 Google Health Takeout 兩家；
  Apple Health／Strava 仍缺 → `review:phase` 的 G5 紅
- **Phase 2：一行程式都沒有**

## 未決（不得自行改寫）

- **計畫的表還沒做**：持久化位置已定（Phase 2），但 plan 與 planned workout 的 migration
  列在 `packages/db/schema.md` 的 Future Migrations，還沒寫。
- **計價單位定案**：已暫定 per-MAU（見下）。定案條件是 Claude／Codex 出明確的
  MCP server 商業與計價文件。

## 計價與當前重點（2026-07-31）

**計價暫定按月活躍使用者（per-MAU），不按呼叫次數。** 成本結構決定的：單次決策 0.443 ms、
零次外部 API 呼叫，唯一隨規模走的是人數。按次計價會與成本錯配，也會讓使用者省著問。

**當前重點是把產品備齊、找到一個能上架的平台**，讓使用者用自己的 AI 工具串接起來。
商業模式哪一種有利、哪一種快，還沒決定——不要拿未定的商業模式去推導技術決策。

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
先讀（memory → 本檔 → product-spec → 宣言 → README → plan → user-journey），
再跑 `npm run review:phase` 的九條 gate，最後回答機械驗不到的判斷題
（GPT-6 判準、Decision ≠ Recommendation、四條紀律…）。
**gate 紅的不得宣告完成**——紅的是宣稱與現況的落差，不是待辦功能。

**MCP server 是常駐行程，改程式不會熱重載**——要驗證改動必須開新 session 或重啟行程。

## 明確不做

健身 App · 健身社群 · 聊天介面 · 內容資料庫 · 資料湖
