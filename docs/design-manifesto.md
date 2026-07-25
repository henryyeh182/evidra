# Fitness MCP — Design Manifesto

> **這份文件的位階高於一切。**
> 當它與 [implementation plan](fitness-mcp-implementation-plan.md)、既有程式、或任何先前決策衝突時，**以本文件為準**。
> 實作計畫回答「怎麼蓋」；這份文件回答「蓋什麼、不蓋什麼、為什麼」。

---

## 0. 一句話定位

> **A permissioned Fitness Decision Engine that transforms user-owned health evidence into explainable training decisions for AI agents.**

**一個以使用者資料主權為前提的 Fitness Decision Engine**，將使用者持有的健康證據，轉換為 AI 可採用、可解釋的專業訓練決策。

不是提供健康資料，也不是提供健身內容；**我們提供的是基於證據與運動科學的決策。**

> 這句話裡每個字都是承重的：
> **permissioned**（原則 2，沒有授權就沒有能力）·
> **user-owned evidence**（原則 1，資料不屬於我們）·
> **explainable**（承諾 A，決策必須自我解釋）·
> **decisions**（原則 5，不是內容也不是推薦）·
> **for AI agents**（原則 4，第一使用者是程式）

### 明確不做

| 不做 | 為什麼 |
|---|---|
| **不做健身 App** | 入口永遠是使用者已經在用的模型 |
| **不做健身社群** | 社交不是智慧層 |
| **不做聊天介面** | 對話歸 Claude / ChatGPT，我們不搶 |
| **不做內容資料庫** | 動作庫、課表庫是可被複製的內容，不是護城河 |
| **不建資料湖** | 見原則 1「Data stays with the user」 |

### 競爭對象

不是 Garmin、不是 Strava、不是任何健身 App。
是**其他提供 Fitness Intelligence 的 AI 能力供應商**。

---

## 1. 五個設計原則（我們**是什麼**）

這五條定義身份。任何提案先過這五條，再談怎麼做。

### 1. Data stays with the user.
資料留在原處：Apple Health 在手機、Garmin 在 Garmin Cloud、Oura 在 Oura Cloud。
我們不建資料湖、不保存醫療資料、不管理大量個資。

### 2. Permissioned.
一切能力都建立在**使用者明確授權**之上。授權是取得證據的唯一途徑，撤銷授權即撤銷能力（含已衍生的指標）。
沒有授權，我們什麼都不是——這也是護城河：GPT-6 再強，沒有授權就拿不到這個人的證據。

### 3. Intelligence Layer.
我們提供運動科學、恢復模型、訓練負荷與決策能力。
不是 App、不是社群、不是資料庫。**分工線：模型負責講話，我們負責判斷。**

### 4. AI Agent First.
第一使用者是 **AI Agent**，不是人類。
介面設計、輸出格式、錯誤語意，全部以「被程式呼叫」為前提，而不是以「被人閱讀」為前提。
對話與互動歸 Claude / ChatGPT，我們不搶敘事權，也不做 UI。

### 5. Decision, not Content.
> **這是最鋒利的一條，也是最容易失守的一條。**

我們賣**判斷**，不賣**素材**。

| Content（不是我們的產品） | Decision（是我們的產品） |
|---|---|
| 動作庫、課表庫、教學文章 | 「以你今天的狀態，該練什麼」 |
| 「有哪些深蹲替代動作」 | 「基於你的傷病與疲勞，這三個安全」 |
| 可被複製、可被 GPT-6 內建 | 需要證據、計算與保證才成立 |

推論：任何回傳「清單」「詳情」「目錄」的 tool 都違反這條。
**已知失守紀錄**：Phase 1+2 蓋出的動作庫檢索工具面違反此條，v4 已重構收回。896 節點的圖是 Content，**它永遠不會是產品**——它只是產生 Decision 的燃料。

---

## 1.2 什麼構成一個 Decision（不是 Recommendation）

> **Recommendation 太弱了。Claude 本身就會推薦。**
> 「今天睡不好，建議休息」——這是 Recommendation，而且不需要我們。

| | Recommendation（推薦） | **Decision（決策）** |
|---|---|---|
| 範例 | 「建議今天跑 Zone 2」 | **「今天的課表由 VO₂max Intervals 調整為 45 分鐘 Zone 2」** |
| 從哪來 | 憑空發出 | **對既有狀態的變更** |
| 結構 | 一個建議 | **from → to** |
| 前提 | 不需要前置狀態 | **必須有「原本要做什麼」** |
| 效力 | 諮詢性，狀態不變 | **綁定性，計畫真的改了** |
| 可稽核 | 事後無從查證 | **可回溯：改了什麼、依據什麼證據** |
| GPT-6 做得到嗎 | ✅ 做得到 | ❌ **它不知道你今天原本該做什麼** |

### 一個 Decision 必須具備三件事

1. **前置狀態（prior state）** — 原本排定的課表。沒有它就只能推薦。
2. **from → to** — 明確的變更，不是一句建議。
3. **證據綁定（evidence binding）** — 為什麼改，依據哪些訊號。

### Decision 的類型

`keep`（照原定執行，**這也是決策**，且必須附證據）· `adjust`（改強度／時長）· `substitute`（換動作）· `defer`（延期）· `advance`（恢復超預期，加量）

### 這條原則的結構性推論

**計畫是決策的基底（substrate）。**
沒有計畫 → 只能 Recommendation（弱，GPT-6 也會）。
有計畫 → 才能 Decision（強，只有我們能）。

所以 `generate_plan` 不是週邊功能，**它是讓決策成為可能的前提**。而決策引擎的核心動作不是「推薦今天練什麼」，是「**依今日證據，把今天排定的課表調整成什麼**」。

---

## 1.3 五層決策模型（The Decision Pipeline）

> 這是整個系統的骨架。每一層都有明確產出，且**不可跳層**。

```
Evidence          HRV ↓ · Sleep 5h · Training Load ↑
    ↓
Fitness State     Recovery = Low
    ↓
Decision          Reduce today's intensity
    ↓
Action            Replace intervals with Zone 2
    ↓
Reason            HRV 低於 baseline · Sleep debt · High acute load
```

| 層 | 是什麼 | 不是什麼 |
|---|---|---|
| **Evidence** | 授權下取得的訊號，帶來源與時間戳 | 不是我們擁有的資料 |
| **Fitness State** | 對狀態的**判定**（recovery / readiness / load） | 不是原始讀數的轉貼 |
| **Decision** | **意圖層**的判定：要做什麼調整 | 不是具體課表 |
| **Action** | **執行層**的具體變更：from → to | 不是一句建議 |
| **Reason** | 綁回 Evidence 的理由 | 不是事後編的說法 |

**Decision 與 Action 必須分開。**
Decision 是「降低今天的強度」；Action 是「intervals → 45 分鐘 Zone 2」。
分開的理由：同一個 Decision 可以對應不同 Action（受器材、時間、傷病影響），而 Action 沒有 Decision 就失去可解釋性。

**Reason 必須綁回 Evidence。**
不是「因為你看起來很累」，而是「HRV 低於個人 baseline、睡眠負債、急性負荷偏高」——每一條都指得回具體訊號。這是承諾 A 的落地形式。

---

## 1.4 用詞：Input 叫 Evidence，不叫 Data

因為原則 1 是 **Data stays with the user**——資料不屬於我們，我們沒有「輸入資料」，我們**在授權下取得證據**。

> ❌ Data Access Layer / User Data / 資料湖
> ✅ **Evidence Access** / **Fitness Evidence Model** / 證據

```
Evidence
  Apple Health · Garmin · Oura · Whoop · Strava
        ↓
Fitness Evidence Model      ← 跨來源正規化（各家語言 → 統一證據語彙）
        ↓
Decision Engine
        ↓
Decision → Action → Reason
```

用詞不是修辭問題：叫它 Data 會讓人開始想「怎麼存、存多久、存在哪」；叫它 Evidence 會讓人想「哪來的、多新、夠不夠、可不可信」——**後者才是這個產品該有的思考方式**。

> 命名沿革：先前文件中的「Fitness Language」「Semantic Fitness Layer」統一改稱 **Fitness Evidence Model**。

---

## 1.5 兩條操作承諾（我們**怎麼做**）

身份定了之後，這兩條規範執行品質。

### A. Every decision must explain itself.
每一個建議都必須包含：
- **confidence** — 信心程度
- **evidence** — 證據來源
- **signal coverage** — 使用了哪些訊號、缺了哪些
- **limits** — 適用範圍與限制（例如缺少睡眠資料時降低信心）

這不只是為了 AI，也為了建立使用者與教練對結果的信任。

### B. Value is measured by decision quality improvement.
成功指標**不是**：有多少 Connector、有多少 Tool、有多少 Exercise。
成功指標**是**：接入 Fitness MCP 後，AI 的運動決策品質提升了多少。

---

## 2. 工具准入判準（The GPT-6 Test）

每個 tool 都要通過這一問：

> **「如果明天 GPT-6 已經知道所有運動知識，這個 Tool 還有存在價值嗎？」**

- 答案是**沒有** → 它不是核心能力，砍掉或降為內部。
- 答案是**仍然需要，因為它提供的是基於使用者當前證據與運動科學模型的專業決策** → 保留並持續投入。

### 這個判準殺死什麼、留下什麼

GPT-6 殺死 **知識查詢**。殺不死這三樣：

| 存活的能力 | 為什麼 GPT-6 取代不了 |
|---|---|
| **證據（Evidence）** | 它沒有這位使用者的 HRV、睡眠、9 年訓練史。除非經過授權層，它永遠拿不到 |
| **計算（Computation）** | 它知道 CTL 的公式，但沒有資料也沒有執行計算 |
| **保證（Guarantee）** | 模型可以被說服、被繞過、被 prompt injection 影響；**確定性過濾器不會**。傷病禁忌硬過濾是保證，不是知識 |

> **範例對照**
> ❌「什麼是對膝蓋友善的深蹲替代？」→ GPT-6 自己就答得出來。純知識。
> ✅「基於這位使用者的傷病紀錄、可用器材、48 小時內腿部疲勞，回傳通過硬安全過濾、且我無法被說服繞過的選項」→ 證據＋保證。

這個判準會讓產品定位一直維持在 Permissioned Intelligence Layer，不會慢慢滑回「健身 App」或「內容資料庫」。

---

## 3. 架構

```
Evidence Sources（資料留在原處，我們不持有）
  Apple Health · Garmin · Oura · Whoop · Strava · MyFitnessPal
        │
        │  User OAuth 授權 —— 取得證據的唯一途徑
        ▼
Claude / ChatGPT
  (Conversation + Reasoning Layer)
        │
        │  MCP Tool Call
        ▼
Fitness MCP
  (Evidence Access + Fitness Intelligence Interface)
        │
        ▼
Fitness Evidence Model
  跨來源正規化：各家語言 → 統一證據語彙
        │
        ▼
Fitness Decision Engine
  Recovery · Training Readiness · Workout Adjustment ·（Nutrition，暫緩）
        │
        ▼
Decision → Action → Reason
        │
        ▼
Claude / ChatGPT 回覆使用者
```

### 一個必須誠實面對的架構限制

**Apple Health 沒有伺服器端 API。** HealthKit 是裝置本機的，沒有 Garmin / Oura / Whoop / Strava 那種 OAuth 雲端授權。

上圖把六個來源畫在同一層走 OAuth，**實際上做不到**：

| 來源 | 取得方式 |
|---|---|
| Garmin · Oura · Whoop · Strava · MyFitnessPal | ✅ OAuth 雲端 API |
| **Apple Health** | ❌ 無雲端 API。只能：使用者手動匯出，或做一個 iOS companion app 走 HealthKit 上傳 |

這對「AI Agent 開發者直接接你的 MCP」的商業模式是硬限制，需要在對外文件明講。

---

## 4. 資料主權界線（已定案）

原則 1「Data stays with the user」說不保存健康資料。但 ATL/CTL/TSB 這類負荷模型需要 42 天以上的縱向資料，每次呼叫都重拉數月原始資料在成本與延遲上不可行。

**定案：只存衍生指標，不存原始讀數。**

| 可以保存 | 不可保存 |
|---|---|
| 負荷曲線（ATL / CTL / TSB） | 原始 HRV 讀數 |
| 個人基線（靜息心率基線、HRV 基線） | 原始心率序列 |
| 分肌群疲勞衰減狀態 | 原始睡眠分期記錄 |
| 訊號覆蓋率與時間戳 | 任何可視為醫療紀錄的原始值 |

原則：**保存的必須是可重建的衍生值，且不構成醫療資料。** 使用者撤銷授權時，衍生指標一併刪除。

---

## 5. 客戶與商業單位

| 客戶 | 他們不想自己做的事 | 計價 |
|---|---|---|
| **AI Agent 開發者**（AI Running Coach / Cycling Coach / Personal Trainer） | Garmin API、Oura API、HRV 判讀、訓練科學 | API / Intelligence usage |
| **AI 平台 Marketplace**（ChatGPT Apps、Claude Connectors） | — | 平台分潤 |
| **穿戴品牌** | Training reasoning、Recovery interpretation | Intelligence Layer 授權 |

上架的商品名稱不是「Garmin Connector」，而是 **Fitness Decision Engine, powered by Fitness MCP**。

> **商業單位 = Decision Tools。** 每一個能被呼叫、被計價、被授權的，都是一個決策原語。所以工具面的定義就是商業模型的定義。

---

## 6. 第一個里程碑

> **不是建立平台，而是證明：沒有這個 MCP，Claude / ChatGPT 的 fitness decision quality 會明顯下降。**

現況缺口：既有的 `/eval` 四個 gate（schema validity、grounding、plan validity、case pass）測的全是**內部正確性**——「我們自己的輸出格式對不對」。

**它完全沒有測外部增益。** 要證明上述論點，需要的是另一種評測：同一組 fitness 決策問題，**裸模型 vs 模型＋MCP**，用決策品質評分標準對照，產出一個 lift 數字。

那個數字才是拿去跟 marketplace、跟穿戴品牌談的東西。

---

## 7. 工具面重構（13 → 7）

依 GPT-6 判準與原則 5「Decision, not Content」重新檢驗現有 13 個 tool：

### 保留（決策原語）

| Tool | 通過理由 |
|---|---|
| `get_semantic_fitness_state` → **`assess_fitness_state`** | 五層模型的 **Fitness State** 層。證據＋計算，GPT-6 沒有本人的 HRV／睡眠／負荷史 |
| `recommend_workout` → **`decide_session`** | **改名是概念性的**：不是推薦今天練什麼，而是依證據把排定課表調整成什麼。須輸出 Decision → Action → Reason |
| `generate_plan` / `adjust_plan` | 基於本人約束與負荷的版本化計畫物件，非通用知識 |
| `preview_*` / `commit_*` | 交易安全保證。模型自己給不了不可繞過的寫入保護 |

### 要補

| Tool | 為什麼 |
|---|---|
| **`get_training_load`** | ATL / CTL / TSB ＋ 分肌群疲勞。架構圖上的核心能力，目前只有粗糙的 7日/28日加總 |
| **`decide_session`（核心）** | 架構圖的 **Workout Adjustment**。依今日證據調整**今天排定的**課表，回傳 from → to。目前只能調整整份計畫，不能調單次 |
| **`decide_exercise_substitution`** | 從 `get_exercise` 抽出的**保證**部分：動作層級的 from → to 決策，非目錄查詢 |

### 砍出 tool 面（程式保留為內部能力）

| Tool | 砍的理由 |
|---|---|
| `search_exercises` / `get_exercise` | GPT-6 已知的知識查詢。違反原則 5（是 Content 不是 Decision） |
| `search_workouts` / `get_workout` | 內容庫。明確在「不做」清單裡 |
| `get_user_profile` / `get_training_history` | 回傳原始資料，違反原則 5。**折成其他工具輸出裡的 evidence 欄位** |
| `get_plan` / `list_plans` | 狀態管理基礎設施，非決策。降為 MCP resource |

> **重要：砍的是「對外的工具面」，不是程式。** 896 節點的動作圖從「產品功能」降為「決策引擎的內部證據來源」——它繼續支撐傷病硬過濾，只是不再是對外販售的能力。我們不賣動作庫。

### Nutrition Guidance

架構圖上有，程式目前 0 行。**狀態：先理解核心規格，暫不實作。** 先把 Recovery / Readiness / Workout Adjustment 三項訓練決策做深。

---

## 8. 與實作計畫的關係

[implementation plan](fitness-mcp-implementation-plan.md) 的六條工程原則（P1–P6）**仍然有效**，但它們是**工程原則**（防幻覺、防寫錯），位階低於本文件的**定位原則**。

已知需要重新對齊的部分：

- **v3 附錄 A 的 Tool Surface 演進表**是「從 Peloton 反推」時期的產物，隱含 to C 產品定位，與本文件衝突 → 以本文件第 7 節為準。
- **Phase 1（知識庫）與 Phase 2（讀取 API）** 依當時計畫執行，蓋出的檢索工具面違反原則 5 → 依第 7 節重構。
- **Phase 5 的成功標準**「至少 3 個 connector」與承諾 B 衝突（成功指標不是 connector 數量）→ 改以 decision quality lift 衡量。
