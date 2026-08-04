# Evidra — 產品規格需求書

> 2026-07-30 重寫。內容以使用者定稿的原話為主，程式現況為查證結果。

---

## 1. 核心宗旨

> 最重要的情境是——使用者要 AI 的教練能力，但不要 Claude、也不要我們的 hosted MCP
> 看見他完整的原始健康資料；所以 host 只當大腦與對話介面，Fitness MCP 只當背後的
> 運動科學計算與安全判斷引擎，收最小化證據、算完不留（Phase 1 靠承諾與實作，
> Phase 2 把 evidence 與決策計算整個搬進使用者控制的環境，讓 MCP 從遠端資料處理中心
> 變成 local data plane），因此對外只能說「只處理呼叫端送進來的最小化健康證據，
> 不留存、不販售、不訓練、不作無關用途」，不能說「完全不碰健康資料」。

## 2. 產品體驗

> 使用者用自己已訂閱的 AI App 對話；AI 自動取得使用者授權的運動證據，
> Fitness MCP 以最小化資料計算訓練決策，AI 再以自然語言提供個人化、可解釋的教練回覆。

> AI host 是教練的大腦與對話介面；Fitness MCP 是教練背後的運動科學計算與安全判斷引擎。

## 3. 使用者旅程

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

## 4. 三段分工

| 段 | 誰做 | 做什麼 |
|---|---|---|
| 1 | 我們 | 把各家資料做成結構化、標準化的一份 |
| 2 | 我們 | 確定性計算：`acwr = atl / ctl` 就是一個除法，不需要模型 |
| 3 | Host（Claude／ChatGPT） | 組句子、用白話講給使用者聽 |

我們的程式不呼叫模型來產生決策。決策必須是確定性的、可重現的。
但模型是前提不是選配：聽懂問題、湊齊證據、選工具、講人話全在 host 那邊。

## 5. 兩種部署

### Phase 1：Hosted decision service

hosted MCP 會短暫處理最小化 Evidence，但不持久化、不保管、不二次利用。

```
Apple Health / Garmin / Strava
        │ 使用者授權資料來源
        ▼
AI host 或 user-controlled local gateway
        │ parser / normalization / 最小化 Evidence
        ▼
Hosted Fitness MCP（transient processing only）
        │ deterministic computation
        ▼
Decision / Action / Reason
```

hosted MCP 的界線：

- 不直接連 Apple Health、Garmin、Strava 等資料供應商
- 不持有來源 OAuth refresh token
- 只接收完成請求所需的最小 Evidence
- 不把 raw Evidence 寫入 database、file、object storage、queue 或 analytics
- 不把 Evidence 用於訓練、廣告、profiling 或無關的二次目的
- request 完成後不保留 Evidence；log、trace、error telemetry 遮蔽 payload、token 與健康欄位

### Phase 2：User-controlled private engine

`packages/evidence`、`packages/semantic-engine` 與 decision engine 全部在
user-controlled environment 執行，hosted service 不接觸 raw health Evidence。

```
Apple Health / Garmin / Strava
        │
        ▼
User device / private gateway / private VPC
  ├─ source connectors
  ├─ packages/evidence
  ├─ packages/semantic-engine
  ├─ packages/db          ← 持久化只存在於這裡
  ├─ decision computation
  └─ local/private MCP server
        │ 只回傳最小化 Decision 結果
        ▼
Claude / ChatGPT / internal AI host
```

這個做法可以理解成：**MCP 不再是遠端資料處理中心，而是安裝在使用者控制的
環境裡的 local data plane。**

#### 持久化（`packages/db`）只能存在於 Phase 2

Phase 1 的界線明文禁止「把 raw Evidence 寫入 database、file、object storage、queue
或 analytics」。而 `packages/db` 的 schema 做的正是這件事：

| 表 | 存什麼 |
|---|---|
| `raw_provider_events` | provider 的原始 payload（`payload JSONB`） |
| `normalized_events` | 正規化後的事件 |
| `health_metrics` | HRV · 睡眠 · 靜息心率 · 壓力 |
| `workouts` | 完成的訓練紀錄 |
| `semantic_fitness_states` | 每日 recovery／readiness／fatigue／ACWR |
| `users`／`goals`／`preferences`／`injuries`／`equipment` | 個人設定與限制 |
| `connector_accounts` | 授權狀態與 scope（**不存 token**） |

**這些表在 hosted service 裡一張都不能建。** 它們合法的唯一位置是使用者控制的環境
——那裡「保存」的對象是使用者自己的機器，儲存與刪除都由使用者決定。

因此：

- **Phase 1 hosted 永遠無狀態。** 計畫與決策紀錄由呼叫端持有並隨每次呼叫傳入
  （`get_plan`／`preview_adjust_plan`／`commit_adjust_plan` 現況已是如此）。
- **Phase 2 才有持久層。** 這是「計畫是決策的基底」第一次有地方落腳。
- Phase 2 有持久層不代表使用者或企業環境不需要自己的存取控制、加密、保留與刪除政策。

#### 決策紀錄：我們不留，呼叫端保存（2026-07-31 使用者確認）

「狀態 → 決策 → 結果」三元組 **hosted service 不保存**，由呼叫端持有，並可作為證據回傳。
Phase 2 只是讓「呼叫端」多了一個選擇：

| 部署 | 呼叫端＝誰 | 三元組存在哪 |
|---|---|---|
| Phase 1 hosted | AI host | host 的記憶 |
| Phase 2 | 使用者控制的環境 | 使用者自己的 `packages/db` |

**兩種情況下 hosted service 都不留。** 我們這端的學習發生在**引擎規則與知識圖譜**
（跨使用者的通則），不在個人資料。

代價要講清楚：Phase 1 這條路徑的可靠度取決於 AI host 的記憶，不是我們能保證的。
沒有 Phase 2 環境的使用者（例如只接 Strava 的跑者）就只有這條路。

**還沒做的**：`packages/db/schema.md` 把 plan 與 planned workout 列在 Future Migrations。
Phase 2 有地方放，但表還沒建。

**Phase 2 是核心宗旨要的那個版本**——只有它能做到「Claude 也看不見完整原始健康資料」。

兩種模式共用同一套 domain packages，差別在 source adapter、MCP transport
與 Evidence 的處理位置。

## 6. 對外能說什麼

能說：

> We process only the minimum health-related evidence submitted by the caller,
> solely to compute the requested fitness decision. We do not retain, sell, use
> for training, or use it for unrelated purposes.

不能說：

> We never process health data.

接收並計算 Evidence 本身就是 transient processing。

## 7. 產品定義

**Decision ≠ Recommendation**

| | Recommendation | Decision |
|---|---|---|
| 例 | 「建議今天跑 Zone 2」 | 「今天的 VO₂max Intervals → 45 分鐘 Zone 2」 |
| 結構 | 憑空發出 | from → to，對既有狀態的變更 |
| 前提 | 不需要 | 必須知道「今天原本要做什麼」 |

決策型別：`keep`（也是決策）· `adjust` · `substitute` · `defer` · `advance`

**五層**：Evidence → Fitness State → Decision（意圖）→ Action（from → to）→ Reason（綁回證據）

**每個輸出帶** confidence、evidence、signalCoverage、limits。缺的訊號列進
`signalCoverage` 的缺漏清單並下調信心，不補造數值。

## 8. 現在有什麼（2026-07-30 查證）

| 項目 | 現況 |
|---|---|
| 對外 tool | 6 個：`assess_fitness_state`／`decide_session`／`decide_exercise_substitution`／`generate_plan`／`preview_adjust_plan`／`commit_adjust_plan` |
| 資料標準化 | `packages/connectors` 實作 3 家（Apple Health／Garmin／Strava），schema registry 涵蓋 6 家 |
| 確定性計算 | `semantic-engine`（readiness／分肌群疲勞）· `training-load`（ATL/CTL/TSB/ACWR）· `decision-engine`（from→to）· `planning` · `knowledge-graph`（889 節點） |
| 測試 | 248 tests、eval 20 golden cases 全綠 |
| 傳輸 | stdio ✅ · Streamable HTTP ✅ |
| OAuth | 只做了「檢查 token」那一半；**簽章驗證器沒填、`serve:http` 沒接線、沒有 authorization server** → 遠端連不起來 |
| 協定版本 | 停在 `2025-06-18`；最新規格是 `2026-07-28`（stateless） |
| Phase 2 | **一行程式都沒有**。`packages/db` 有 schema 與 11 張表，但 `FitnessRepository` 全是未實作的抽象，沒有任何 runtime 程式 import 它 |

## 9. 要做什麼

依核心宗旨排序——Phase 2 是最重要的情境，不是選配。

### 必要前提（Phase 1 與 Phase 2 共用）

- 最小化 Evidence 契約：跨 Apple Health／Garmin／Strava 的必要欄位、單位、時間、來源與 freshness
- ~~補齊 Apple Health／Strava 的 source schema 與 scenario~~（2026-08-03 完成，`review:phase` 的 G5 綠）
- 只傳決策所需欄位，不把完整活動原始 payload 帶進 hosted MCP

### Phase 2：local / private engine

- 把 source connectors、`packages/evidence`、`packages/semantic-engine`、`packages/db`、
  decision computation 綁成 local bundle 或 Docker image
- 接上 `packages/db`：`FitnessRepository` 目前每個方法都 `throw "must be implemented"`，
  需要一個具體 adapter（Postgres／SQLite），且只在使用者環境裡跑
- 補 plan 與 planned workout 的 migration——決策的基底目前沒有表可以放
- local stdio 給個人電腦，private HTTP 給 NAS／企業 VPC
- **手機情境要解的那一段**：手機上的 Claude 怎麼連到使用者家裡的 local engine。
  MCP 官方的 **tunnels**（2026-07-28 隨新規格推出）正是為此——內部工具不需要公開端點、
  不需要開防火牆就能接上 Claude。**這一段目前計畫裡沒有。**
- 驗收：沒有 hosted MCP 也能完成三個使用情境，且 raw Evidence 不離開 user-controlled environment

### Phase 1：hosted production boundary

- Docker 化 HTTP server，公開 HTTPS `/mcp`
- 補完 OAuth Resource Server：signature/JWKS、issuer、audience、expiry、scope
- 接外部 Authorization Server；定義 `fitness:read`、`fitness:plan:write` 等 scope
- request body、tool arguments、Bearer token 不進 access log、APM 或 error trace
- 驗收：`401 → metadata → OAuth → token → tools/list → tools/call` 走得通；
  錯誤 token／錯誤 audience／過期 token／缺 scope 正確回 401／403

### 協定升級

`2026-07-28` 走 dual-era，不直接切換（只支援新版會讓舊客戶端連不上）。
新規格的 core 是 stateless request/response——`planPatch`（原 `planStore.js`）已於 `1d28ba6` 改成無狀態，
方向一致。

### 上架與商業

- connector directory 需要的：OAuth、privacy URL、support、測試帳號、範例 prompts
- 合規：GDPR controller/processor 角色、DPA、DPIA、資料主體權利流程、retention、
  跨境傳輸、subprocessor、非醫療診斷聲明、incident response、token rotation
- 計價：**暫定按月活躍使用者（per-MAU）**（2026-07-31 決定）。實測單次決策 0.443ms、
  零次外部 API 呼叫，成本隨**人數**變動（authorization server 按月活躍使用者計費），
  不隨呼叫次數；按次計價會與成本錯配，也會讓使用者省著問。
  **定案條件**：Claude／Codex 出明確的 MCP server 商業與計價文件後回頭定。
- 當前重點：**先把產品備齊，找到一個能上架的平台**，讓使用者用自己的 AI 工具串接。
  商業模式採哪一種有利、哪一種快，尚未決定——不拿未定的商業模式去推導技術決策。
- 商業模式方向（使用者 2026-07-30 提出）：decision API／MCP usage pricing · marketplace 分潤 ·
  B2B license 給 AI coach app · wearable／health-data 平台授權 · enterprise wellness

## 10. 明確不做

健身 App · 健身社群 · 聊天介面 · 內容資料庫 · 資料湖
