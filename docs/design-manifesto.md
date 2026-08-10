# Evidra — Design Manifesto

> **正本是 [產品規格需求書](product-spec.md)。** 那份寫核心需求、架構、概念與使用者情境；
> 本文件只寫從它推出來的**原則與治理判準**。兩者衝突時以規格需求書為準。
>
> 本文件不記載會變動的市場現況與實作進度——那些記在
> [implementation plan](fitness-mcp-implementation-plan.md)，可以隨查證更新。

---

## 核心宗旨

> 最重要的情境是——使用者要 AI 的教練能力，但不要 Claude、也不要我們的 hosted MCP
> 看見他完整的原始健康資料；所以 host 只當大腦與對話介面，Fitness MCP 只當背後的
> 運動科學計算與安全判斷引擎，收最小化證據、算完不留（Phase 1 靠承諾與實作，
> Phase 2 把 evidence 與決策計算整個搬進使用者控制的環境，讓 MCP 從遠端資料處理中心
> 變成 local data plane），因此對外只能說「只處理呼叫端送進來的最小化健康證據，
> 不留存、不販售、不訓練、不作無關用途」，不能說「完全不碰健康資料」。

**AI host 是教練的大腦與對話介面；Fitness MCP 是教練背後的運動科學計算與安全判斷引擎。**

## 三段分工

全文其餘章節都必須與這三段一致。

| 段 | 誰做 | 做什麼 |
|---|---|---|
| 1 | **我們** | 把各家資料做成結構化、標準化的一份 |
| 2 | **我們** | 確定性計算：`acwr = atl / ctl` 就是一個除法，不需要模型 |
| 3 | **Host（Claude／ChatGPT）** | 組句子、用白話講給使用者聽 |

**我們的程式不呼叫模型來產生決策。** 決策必須是確定性的、可重現的。

**但模型是前提，不是選配。** 聽懂問題、湊齊證據、選工具、講人話全在 host 那邊。
沒有模型就只能做 App——要有介面、要使用者自己填、要自建資料管線。
原則 4「不做 UI、不搶對話」能成立，前提就是有模型在前面。

> 這一條管的是**模型在誰家**，不是**有沒有模型**。開發期評測工具呼叫模型 API 與本條無關。

**這也解釋了為什麼「知識」不是產品**：GPT 已經知道 ACWR 是什麼。它不知道的是**這個人的
atl 和 ctl 是多少**——那要有人先把各家格式對齊，再把 28 天實際加總。

## 五個設計原則

1. **Evidence minimization** — 只收算得出這個決策所需的最小證據，算完不留；
   不建資料湖、不持有來源 OAuth refresh token。
2. **Permissioned** — 授權是取得證據的唯一途徑；撤銷授權即撤銷能力。
3. **Intelligence Layer** — 提供運動科學與決策，不是 App、社群、資料庫。
4. **AI Agent First** — 第一使用者是程式，不是人。不做 UI、不搶對話。
5. **Decision, not Content** — 賣判斷，不賣素材。

## 兩條操作承諾

- **A. 決策自我解釋** — 每個輸出帶 `confidence`、`evidence`、`signalCoverage`、`limits`。
- **B. 價值以決策品質衡量** — 不是 connector 數、tool 數、動作數。

## 輸入不得由我們編造

三段分工的第 1 段是「結構化、標準化」，**不是「填滿」**。使用者沒給的值，就是沒有。

- **不得用預設值代替缺失的輸入。** 沒有 RPE 就是沒有，不是 5；沒有訓練負荷就是沒有，
  不是拿時長充數。一個被填進去的值，下游讀起來會像使用者真的講過。
- 缺的走 `signalCoverage` 的缺漏清單並下調 confidence，**不是靜靜補值**。
- **廠商自己算好的複合分數**（readiness、Body Battery）當一等證據收進來，不重算
  ——裝置在手腕上，它整合了我們看不到的訊號。
- **確定性門檻必須有出處。** `acwrHigh = 1.4` 這類數字要嘛附依據，要嘛標為未驗證，
  要嘛改由呼叫端傳入。

> 一個編造的輸入會一路走到輸出：沒有負荷 → 拿時長當負荷 → ATL/CTL 用它算 →
> `acwr = atl / ctl` → 理由句子寫「急慢性負荷比 2.1 高於 1.4」。
> **整句話看起來有憑有據，實際上第一個數字是我們自己生的。**

## Decision ≠ Recommendation

| | Recommendation | **Decision** |
|---|---|---|
| 例 | 「建議今天跑 Zone 2」 | 「今天的 VO₂max Intervals → 45 分鐘 Zone 2」 |
| 結構 | 憑空發出 | **from → to，對既有狀態的變更** |
| 前提 | 不需要 | **必須知道「今天原本要做什麼」** |
| GPT-6 | ✅ 做得到 | ❌ 它不知道你今天原本該做什麼 |

決策型別：`keep`（也是決策）· `adjust` · `substitute` · `defer` · `advance`

**推論：計畫是決策的基底。** 沒有計畫只能推薦；有計畫才能決策。

## 五層決策模型

```
Evidence        HRV ↓ · Sleep 5h · Load ↑
  ↓
Fitness State   Recovery = Low
  ↓
Decision        降低今日強度                    ← 意圖
  ↓
Action          Intervals → Zone 2              ← from → to
  ↓
Reason          HRV 低於 baseline · 睡眠負債 · 急性負荷偏高
```

Decision 與 Action 必須分開：同一個意圖在不同器材／時間／傷病下落成不同 Action。
Reason 必須綁回 Evidence，不是事後編的說法。

## 工具准入判準（GPT-6 Test）

> 「如果明天 GPT-6 已經知道所有運動知識，這個 Tool 還有存在價值嗎？」

**否 → 砍掉或降為內部。** GPT-6 殺死「知識查詢」，殺不死三樣：

- **證據** — 它沒有這個人的資料
- **計算** — 它沒有執行縱向運算
- **保證** — 確定性過濾器不會被說服繞過

## 對外能說什麼

能說：

> We process only the minimum health-related evidence submitted by the caller,
> solely to compute the requested fitness decision. We do not retain, sell, use
> for training, or use it for unrelated purposes.

不能說：

> We never process health data.

**接收並計算 Evidence 本身就是 transient processing。** 「不 fetch、不持有原始資料」
不等於「完全不處理資料」。

> 用詞：內部討論 input 一律稱 **Evidence** 不稱 Data。

## 三種 deployment mode，一條界線

The canonical data-flow, storage, token, logging, and deletion contract is
[privacy-deployment-contract.md](privacy-deployment-contract.md). The summaries
below are principles; the contract and machine-readable manifest are the
acceptance criteria.

### Phase 1：Hosted decision service

hosted MCP 會短暫處理最小化 Evidence，但不持久化、不保管、不二次利用。界線：

- 不直接連 Apple Health、Garmin、Strava 等資料供應商
- 不持有來源 OAuth refresh token
- 只接收完成請求所需的最小 Evidence
- 不把 raw Evidence 寫入 database、file、object storage、queue 或 analytics
- 不把 Evidence 用於訓練、廣告、profiling 或無關的二次目的
- request 完成後不保留 Evidence；log、trace、error telemetry 遮蔽 payload、token 與健康欄位

### Phase 2：User-controlled private engine

source connectors、`packages/evidence`、`packages/semantic-engine`、`packages/db` 與
decision computation 全部在使用者控制的環境執行，hosted service 不接觸 raw health Evidence。

**MCP 不再是遠端資料處理中心，而是安裝在使用者控制的環境裡的 local data plane。**

**持久化只存在於 Phase 2。** `packages/db` 的 schema 會寫入 provider 原始 payload
（`raw_provider_events`）、HRV／睡眠／靜息心率（`health_metrics`）與每日狀態
（`semantic_fitness_states`）——這些表在 hosted service 裡一張都不能建，因為 Phase 1
界線禁止把 raw Evidence 寫入 database。它們合法的唯一位置是使用者自己的機器。

因此 **Phase 1 hosted 永遠無狀態**：計畫與決策紀錄由呼叫端持有並隨每次呼叫傳入。
**Phase 2 才有持久層**，那是「計畫是決策的基底」第一次有地方落腳。

### 決策紀錄：我們不留（2026-07-31 使用者確認）

「狀態 → 決策 → 結果」三元組 **hosted service 不保存**，由呼叫端持有並可作為證據回傳。
Phase 2 只是讓「呼叫端」多一個選擇——Phase 1 是 AI host 的記憶，Phase 2 是使用者
自己控制的 `packages/db`。**兩種情況 hosted service 都不留。**

我們這端的學習發生在**引擎規則與知識圖譜**（跨使用者的通則），不在個人資料。

**Phase 2 是核心宗旨要的那個版本**——只有它能做到「Claude 也看不見完整原始健康資料」。
它不是高隱私情境的選配，是主線。

兩種模式共用同一套 domain packages，差別在 source adapter、MCP transport
與 Evidence 的處理位置。

完整的部署圖與驗收條件見 [產品規格需求書](product-spec.md) §5、§9。

## 商業原則

商品名是 **Fitness Decision Engine**，不是「Garmin Connector」。

**金流的控制權要在我們手上**，不把收入唯一寄託在任何單一平台的政策上。
各平台此刻有沒有抽成、費率多少，是會變的市場現況，記在 implementation plan，不寫進本文件。

### 計價單位：暫定按月活躍使用者（2026-07-31）

**暫定 per-MAU，不按呼叫次數。** 理由是成本結構：單次決策 0.443 ms、零次外部 API 呼叫，
運算與主機幾乎不隨次數變動；唯一隨規模走的是人數（authorization server 按月活躍使用者計費）。
按次計價除了與成本錯配，還會打擊產品自己想要的行為——「隨時問」意味著一次對話可能觸發
數次呼叫，按次收費會讓使用者開始省著問。

**這是暫定，不是定案。** 現階段的重點是把產品備齊、找到一個能上架的平台，
讓使用者用自己的 AI 工具串接起來。等 Claude／Codex 出明確的 MCP server 商業與計價文件，
再回頭定案。

## 未決（不得在其他 session 自行改寫）

| 題目 | 狀況 |
|---|---|
| **計畫的表還沒做** | 持久化的位置已定（Phase 2，見上節），但 `packages/db/schema.md` 把 plan 與 planned workout 列在 Future Migrations，還沒寫。**Phase 2 有地方放，東西還沒做出來** |
| **計價單位定案** | 已暫定 per-MAU（見上節）。定案條件：Claude／Codex 出明確的 MCP server 商業與計價文件 |

## 明確不做

健身 App · 健身社群 · 聊天介面 · 內容資料庫 · 資料湖
