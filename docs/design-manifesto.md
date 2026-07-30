# Fitness MCP — Design Manifesto

> 位階最高。與 [implementation plan](fitness-mcp-implementation-plan.md) 或既有程式衝突時，以本文件為準。

## Mission

> **A permissioned Fitness Decision Engine that turns fragmented, user-owned health evidence into explainable training decisions for AI agents.**

一個以使用者資料主權為前提的 Fitness Decision Engine，把分散在各家穿戴裝置、且屬於使用者的健康證據，轉換成 AI Agent 可採用、可解釋的訓練決策。

**不提供健康資料，不提供健身內容；提供的是基於證據與運動科學的決策。**

## 產品體驗（2026-07-30 定調）

> 使用者用自己已訂閱的 AI App 對話；AI 自動取得使用者授權的運動證據，
> Fitness MCP 以最小化資料計算訓練決策，AI 再以自然語言提供個人化、可解釋的教練回覆。

**AI host 是教練的大腦與對話介面；Fitness MCP 是教練背後的運動科學計算與安全判斷引擎。**

## 核心概念（2026-07-30 定調，位階與 Mission 同級）

> **知識的輸出現在已經沒有價值**，任何問 AI 馬上有答案。
> 但要做到**輸入的數據有結構化、標準化**，馬上可以立刻找到 `acwr = atl / ctl`。
> 這一個除法——來說明近期負荷除以長期負荷。算出的數值 = readiness、分肌群疲勞。
> **Claude 已經可以組成完整的中文理由句子**，然後用白話回應給 user。

**三段分工，全文其餘章節都必須與這三段一致：**

| 段 | 誰做 | 內容 |
|---|---|---|
| 1 | **我們** | 把散在各家的資料做成**結構化、標準化的一份** |
| 2 | **我們** | **確定性計算**——`acwr = atl / ctl` 就是一個除法，不需要模型 |
| 3 | **Host（Claude／ChatGPT）** | 組句子、用白話講給使用者聽 |

**這解釋了為什麼「知識」不是產品**：GPT 已經知道 ACWR 是什麼。它不知道的是**這個人的
atl 和 ctl 是多少**——那要有人先把四家格式對齊、再把 28 天實際加總。

## 五個設計原則

1. **Data stays with the user** — 不建資料湖、不保存原始健康資料。
2. **Permissioned** — 授權是取得證據的唯一途徑；撤銷授權即撤銷能力。
3. **Intelligence Layer** — 提供運動科學與決策，不是 App、社群、資料庫。
4. **AI Agent First** — 第一使用者是程式，不是人。不做 UI、不搶對話。
5. **Decision, not Content** — 賣判斷，不賣素材。

## 兩條操作承諾

- **A. 決策自我解釋** — 每個輸出帶 confidence、evidence、signal coverage、limits。
- **B. 價值以決策品質提升衡量** — 不是 connector 數、tool 數、動作數。

## 第三條：輸入不得由我們編造（Garbage In, Garbage Out）

**核心概念的第 1 段是「結構化、標準化」，不是「填滿」。** 使用者沒給的值，就是沒有。

- **不得用預設值代替缺失的輸入。** 沒有 RPE 就是沒有，不是 5；沒有訓練負荷就是沒有，
  不是拿時長充數。一個被填進去的值，下游讀起來會像使用者真的講過。
- 缺的走 `signalCoverage.missing` 並下調 confidence，**不是靜靜補值**。
- **廠商自己算好的複合分數**（readiness、Body Battery）當一等證據收進來，不重算
  ——裝置在手腕上，它整合了我們看不到的訊號。
- **確定性門檻必須有出處。** `acwrHigh = 1.4` 這類數字要嘛附依據，要嘛標為未驗證，
  要嘛改由呼叫端傳入。**理由句子把門檻講得像事實，但門檻本身沒有出處，就是在編。**

> 一個編造的輸入會一路走到輸出：沒有負荷 → 拿時長當負荷 → ATL/CTL 用它算 →
> `acwr = atl / ctl` → 理由句子寫「急慢性負荷比 2.1 高於 1.4」。
> **整句話看起來有憑有據，實際上第一個數字是我們自己生的。**

## 腦袋來自 host：系統內不含 LLM

> **這一條管的是「模型在誰家」，不是「有沒有模型」。**
> **模型是前提，不是選配。** 沒有模型，使用者說的話沒人聽得懂、四家的證據沒人湊得齊、
> 不會有人決定要呼叫哪個 tool、算完的數值也沒人講得成人話。
> 不靠模型就只能做 App——要有介面、要使用者自己填、要自建資料管線。
> **原則 4「不做 UI、不搶對話」能成立，前提就是有模型在前面。**

**禁的只有一件事：Fitness MCP 自己的程式不呼叫模型來產生決策。** 決策必須是確定性的。
（也不訓練、不 fine-tune 語言模型。）

語言理解、對話、意圖推理一律用 **Claude / ChatGPT 的腦袋**（host 那層）。

> ⚠️ **不得再把這一條讀成「碰到模型就違規」。** 開發期的評測工具呼叫模型 API 與本條無關
> ——那不是產品在產生決策（另見下方例外條款）。此誤讀曾被用來取消第一里程碑的評測。

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
量測源頭（裝置）

  Garmin 手錶 · Apple Watch · Oura Ring · Whoop 帶

        │ Garmin Connect / Connect IQ · HealthKit 等向外同步
        ▼

平台（都是下游，涵蓋範圍各不相同）

  Apple Health          聚合容器，本身不量測
  Google Health Connect 聚合容器，本身不量測
  Garmin Connect        最完整（含睡眠 · HRV · readiness）
  Oura / Whoop          自家裝置的完整資料 ＋ 廠商複合分數
  Strava                最窄：只有運動當下的資料
                        沒有睡眠 · 沒有 HRV · 沒有靜息心率

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

**這張圖就是護城河**——差異在 **MCP 與回覆之間有一個獨立的 Fitness Decision Engine 層**，
而它上游接的是使用者授權的多來源證據。別人的 MCP 之後直接就是回覆。

**現實對照（2026-07-30 查證，取代原本的 Peloton 例子）：**

| | 做法 |
|---|---|
| **Strava MCP** | 官方頁原文：**Access coming soon**、逐步開放中、**目前只連 Anthropic Claude**。定位是把 Strava 的表現資料開給 Claude，由 **Claude** 去看訓練模式、給改進建議、加油打氣——**建議由 Claude 產生，不是 Strava 的引擎產生** |
| **COROS**（2026-05） | 同型（`mcp.coros.com`） |
| **Garmin** | 無官方 connector |
| **Evidra** | 不持有資料，**在 MCP 與回覆之間放決策層** |

**Strava 與 Evidra 是同一條管線的相鄰兩段，不是競爭。** 使用者的 Claude 同時裝兩個：
Claude 先向 Strava 取證據 → 再把證據當參數呼叫 Evidra → Evidra 回 from → to 與依據
→ Claude 講人話。

**應用做 MCP 的核心用意是「出現在使用者現在發問的地方」。** 使用者已經改成先問 AI；
在那裡拿不到的服務，就在使用者真正想知道事情的那一刻缺席。
**對 Strava 那是防守**（保護既有 App 與訂閱）；**對 Evidra 那是唯一的出口**
——我們沒有 App、沒有介面、沒有資料，**tool call 本身就是產品的全部**。

架構圖的**層次與分工**不得偏離。圖上的事實敘述（誰量測、誰是下游、各家涵蓋什麼）
**查證後有錯就要改**——照著錯的圖做，才是真的偏離。
實作進度另記於 [implementation plan](fitness-mcp-implementation-plan.md)，不反映在架構圖上。

## 資料如何進來（重要）

架構圖上 `User OAuth 授權` 的箭頭指向 **Claude / ChatGPT**，不是指向 Fitness MCP。

- **授權對象是 AI 那層**，不是我們。
- 證據經由 **MCP Tool Call 以參數傳入**；**Fitness MCP 不去廠商雲端拉資料、不持有原始資料**。
- 因此各來源有沒有伺服器端 API（例如 Apple Health 沒有）**與本架構無關**——我們從不 fetch。

這是原則 1「Data stays with the user」的結構性保證：我們對原始資料無狀態，只收證據、回決策。

## 部署模式與資料處理邊界（2026-07-30 定案）

「不 fetch、不持有原始資料」不等於「完全不處理資料」。只要 hosted
Fitness MCP 收到 caller 傳入的 Evidence 並進行標準化或決策計算，它就是
**transient data processor**：可以不持久化、不保管、不販售、不訓練利用，
但不能宣稱 never processes health data。

產品支援兩種部署模式：

### Phase 1：Hosted decision service

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

Phase 1 的 hosted MCP：

- 不直接連 Apple Health、Garmin、Strava 等資料供應商
- 不持有來源 OAuth refresh token
- 只接收完成請求所需的最小 Evidence
- 不將 raw Evidence 寫入 database、file、object storage、queue 或 analytics
- 不把 Evidence 用於訓練、廣告、profiling 或無關的二次目的
- request 完成後不保留 Evidence；log、trace、error telemetry 必須遮蔽 payload、token 與健康欄位

因此對外 Privacy Policy 應使用以下準確表述：

> We process only the minimum health-related evidence submitted by the caller,
> solely to compute the requested fitness decision. We do not retain, sell, use
> for training, or use it for unrelated purposes.

不得使用以下不準確表述：

> We never process health data.

### Phase 2：User-controlled private engine

```
Apple Health / Garmin / Strava
        │
        ▼
User device / private gateway / private VPC
  ├─ source connectors
  ├─ packages/evidence
  ├─ packages/semantic-engine
  ├─ decision computation
  └─ local/private MCP server
        │ 只回傳最小化 Decision 結果
        ▼
Claude / ChatGPT / internal AI host
```

Phase 2 將 source connectors、`packages/evidence`、
`packages/semantic-engine` 與 decision computation 放在使用者控制的環境。
Hosted service 不接觸 raw health Evidence；這是高隱私、離線、企業 private
VPC 或資料 residency 情境的部署選項。這不代表該使用者或企業環境不需要
自己的存取控制、加密、保留與刪除政策。

兩種模式共用同一套純 domain packages；差別只在於 source adapter、MCP
transport 與 Evidence 的處理位置。Phase 1 是 hosted transient processing；
Phase 2 才是 hosted service 不接觸健康 Evidence 的模式。

> 用詞：內部討論 input 一律稱 **Evidence** 不稱 Data。架構圖層級名稱維持原文。
> `Data Access` 的語意＝**使用者授權 AI 取用，資料所有權仍屬使用者**。

## 資料主權界線（已定案）

**Fitness MCP 自身不保存任何使用者資料。** 純函數：證據進來、決策出去。

```
Apple Health / Garmin …  →  AI Agent（持有授權與記憶）
                                  │  經 tool call 傳入證據
                                  ▼
                          Fitness MCP（無狀態）
                                  │
                                  ▼
              負荷曲線 · 基線 · Decision/Action/Reason
                                  │  回傳
                                  ▼
                        AI Agent 記憶（可回溯查看）
```

| 我們不存 | 由 AI Agent 記憶 |
|---|---|
| 原始 HRV／心率／睡眠讀數 | **負荷曲線（ATL/CTL/TSB）** |
| 使用者計畫 | **個人基線** |
| 任何個人歷史 | **決策紀錄（何時、為何、改了什麼）** |

> 🔴 **本文件內部尚未解決的矛盾（2026-07-30 標記，本次不解）**
>
> | 這裡說 | 但別處說 |
> |---|---|
> | 「使用者計畫」列在**我們不存** | 「Decision ≠ Recommendation」說**計畫是決策的基底**，沒有計畫只能推薦 |
> | Feedback Learning **需保存**「狀態→決策→結果」三元組（護城河章末） | implementation plan 的 Phase 6 寫「我們這端不留三元組」 |
>
> 現況（2026-07-30）：`packages/planning/src/planStore.js` 已改為**無狀態 patch/preview 驗證器**，不再持有 plan、preview 或版本歷史；
> `packages/db` 的 schema 寫好但未接 runtime。**決策的基底目前不存在於任何地方。**
>
> **使用者已指定此題另開 session 討論，不得在其他 session 展開或自行改寫。**

**為什麼記憶在 agent 端**：膝傷、上週腿日、100 公里健行、昨天的 tabata——這些本來就在 agent 的記憶裡，我們沒理由也不該複製一份。

**但決策紀錄必須可回溯。** 像醫囑一樣，事後要查得到「那天為什麼把強度降下來、依據哪些證據」。所以我們的輸出必須是**自足的紀錄**：帶時間、證據值、規則依據，離開我們之後仍然看得懂。

## 客戶

| 客戶 | 計價 | 現況（2026-07-30 查證） |
|---|---|---|
| AI Agent 開發者（Running / Cycling / PT coach） | API / Intelligence usage | 需要 REST API／SDK，尚未做 |
| **來源方**（Strava · Garmin · COROS 等） | Intelligence Layer 授權 | Strava 把建議交給 Claude 產生；**Garmin 連 connector 都沒有**——想在自家 connector 後面放確定性決策，就要自建或授權 |
| 握有課表的一方（教練平台 · 健身房 · 企業健康） | Intelligence Layer 授權 | 他們本來就握著課表，正好補上「決策必須有原本要做什麼」這個前提 |
| 直接對使用者（目錄上架訂閱） | 訂閱 | 使用者已在付 Claude 訂閱，我們是第二筆 |

| **AI 平台 Marketplace** | 平台分潤 | **保留為商業模式之一。** 第三方 MCP marketplace 已有分潤機制在運作（見 plan）；Anthropic 目錄現階段無抽成，這是**當下的市場現況，不是永久條件** |

> ⚠️ **本文件不記載會變動的市場現況。** 各平台此刻有沒有抽成、費率多少、誰家可以收錢，
> 一律記在 [implementation plan](fitness-mcp-implementation-plan.md)，那裡可以隨查證更新。
> **宣言只寫原則**：金流的控制權要在我們手上，不把收入唯一寄託在任何單一平台的政策上。
>
> 這條是 2026-07-30 訂正——當時把「Anthropic 目錄沒有抽成」寫進宣言，
> **等於用一句當下的查證結果封掉一個還在評估的商業模式**。宣言不該這樣用。

商品名是 **Fitness Decision Engine**，不是「Garmin Connector」。

> 🔴 **「商業單位 = Decision Tools」與實測成本不符，未解。** 實測顯示成本隨**人數**變動
> （authorization server 按月活躍使用者計費），不隨呼叫次數（單次決策 0.443ms、
> 零次外部 API 呼叫）。按次計價會與成本錯配，也會讓使用者省著問。
> **兩者要對齊，但這是使用者的決定，本次不改。**

## 第一里程碑（2026-07-30 改寫）

> **舊版寫的是**：證明「沒有這個 MCP，Claude / ChatGPT 的 fitness decision quality
> 會明顯下降」，做法是裸模型 vs 模型＋MCP 的對照評分。
> **這與本文件自己的「模型無關」相牴觸**（見上節推論第 2 條），因此改寫。

**那個對照要量的是模型品質，不是我們的東西**：

1. 模型不歸我們——它屬於 Claude／OpenAI／Google。
2. **模型好不好，使用者用了就知道**，不需要我們證明；不好就換一個模型。
3. 它一直在變，下一版模型出來，量出來的數字就作廢。

**而訓練資料不會變。** 拿一個會變動又不歸我們的東西，去量一個固定的輸入，
量出來的數字沒有保存期限。

### 改為：證明三件跑兩次就驗得出來的事

| # | 要證明的 | 怎麼驗 |
|---|---|---|
| 1 | **同一份證據永遠得到同一個決策** | 跑兩次，比對輸出 |
| 2 | **理由指得回具體的數字與門檻** | 每條 reason 都能追到觸發它的證據值 |
| 3 | **確定性程式不會被說服繞過** | 使用者盧、模型改口，門檻不動 |

**加上一項前提**：這三件事只有在**輸入沒有被編造**時才成立（見「第三條」）。

> 這與「模型無關」一致：我們證明的是自己那一段的性質，不是別人家模型的分數。

## 明確不做

健身 App · 健身社群 · 聊天介面 · 內容資料庫 · 資料湖
