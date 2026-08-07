# Fitness MCP — Implementation Plan

> 依 [Design Manifesto](design-manifesto.md) 推導 · 位階次於宣言，衝突時以宣言為準。
> **本文件只留「現況」與「下一步」。** 每個決定的完整理由、原文引述、查證過程、
> 失敗嘗試與否決掉的方案，全部在
> [fitness-mcp-implementation-plan-history.md](fitness-mcp-implementation-plan-history.md)
> ——**現況表格裡的每一項，出處都指得回那裡，不是憑空冒出來的結論。**
>
> **2026-08-07 拆分**：v8 那份累積到 1558 行，同時扛「決策稽核軌跡」與「下一步清單」，
> 後者越來越難找。拆分不代表任何一句舊結論被撤回，只是換了放的位置。

---

## 現況

### 對外元件

- **6 個對外決策 tool**：`evidra_assess_fitness_state`、`evidra_decide_session`、
  `evidra_decide_exercise_substitution`、`evidra_generate_plan`、
  `evidra_preview_adjust_plan`、`evidra_commit_adjust_plan`
- **368 tests** 全綠（dependency-free，Node 20+）；**eval 20 golden cases**，5 個 gate 全綠
- **知識圖譜** 889 節點 / 5,785 邊；進退階 34 條（17 組互逆）；訓練目標五值域
- **Rule Library**（`packages/rules` v1.1.0）：**8 條規則**，每條帶 `ruleId`／`version`／
  `category`／`priority`／`basis`／`evidenceLevel`／`sources`／`contested`／`limitations`。
  決策引擎沒有自己的門檻——`RULES = THRESHOLDS`，改 JSON 就改行為。
  **只涵蓋 `decide_session` 的 11 個門檻**（`assertThresholdsMatch` 的清單）；
  另五個 tool 的數字不在庫裡，見技術債 C9。連帶：**`decisionBasis` 也只有
  `evidra_decide_session` 回傳**（六個 tool 實測一個命中），server `instructions`
  已據此指名，不再宣稱每個決策都帶
- **來源 parser：4 家**（Apple Health／Garmin／Google Health／Strava，Strava 另有 API
  與 bulk export 兩種方言）。**Oura／Whoop 只有 registry 宣告，無 parser**——schema
  registry 共宣告 6 個平台（8 種方言）
- **transport**：stdio ✅ · Streamable HTTP ✅（僅 `localhost:8787`，未公開部署）
- **OAuth**：resource server 已實作（RFC 9728 metadata、audience 驗證、issuer 白名單、
  scope 檢查）；**簽章驗證器是空插槽、`http.js` 進入點沒接線、沒有 authorization
  server**——三者補齊前，`serve:http` 跑起來是共用密碼模式，不是真的 OAuth
- **協定版本**：`2025-06-18`／`2025-03-26`／`2024-11-05`（legacy 握手式）。
  最新規格 `2026-07-28`（stateless）尚未跟進，做法已定為 dual-era，未開工
- **`npm run review:phase` 九條 gate 現況全綠**

### 護城河缺口

| # | 能力 | 現況 | 缺口 |
|---|---|---|---|
| 1 | Semantic Fitness Layer | 🟡 | 4/6 平台有 parser；已有的四家方言等價已驗證 |
| 2 | Fitness Intelligence Engine | 🟢 | 確定性五層決策；ATL/CTL/TSB ＋ detraining 軸線 ＋ 個人基線 |
| 3 | Fitness Knowledge Graph | 🟢 | 889 節點 / 5,785 邊，進退階與訓練目標皆有不變量把關 |
| 4 | Feedback Learning | ✅ 已結（設計如此） | 三元組由呼叫端保存，hosted 不留 |
| 5 | Multi-LLM Interface | 🟡 | stdio／HTTP 已上；OAuth 三缺口（見上）；無 REST API、無 SDK |

### 通路與上架

| 順位 | 通路 | 判定 |
|---|---|---|
| 1 | 官方 MCP registry | ✅ **已送出**（2026-08-07，`io.github.henryyeh182/evidra` v0.3.7） |
| 2 | PulseMCP | 🟢 隨順位 1 自動抓取，或使用者自行填表 |
| 3 | Anthropic MCPB 表單 | ✅ **已送出，審查中**（2026-08-07，閉源） |
| 4 | Smithery（Local MCPB） | 🟡 低優先，未做 |
| 5 | mcp.so 免費送審 | 🟡 順手做，未做 |
| 6 | Anthropic remote portal | 🔴 **NO-GO（現在）**——見下方四缺口 |
| 7 | ChatGPT App Directory／Health | 🔴 **NO-GO（現在）**——PHI 條款是否涵蓋消費性穿戴資料未查證 |

**remote 的四個缺口**（其中兩件互為同一個缺口）：

| # | 缺口 | 現況 |
|---|---|---|
| 1 | Team／Enterprise 帳號 | 個人 Pro 進不去 admin settings |
| 2 | authorization server | `http.js:95`，與 per-MAU 是同一個缺口，選型硬條件：支援 CIMD |
| 3 | HTTPS 公開部署 | 只跑 `localhost:8787` |
| 4 | 隱私政策改寫 | 計畫已寫在 [privacy-policy-rewrite-plan.md](privacy-policy-rewrite-plan.md)，觸發點是 #2 開工 |

**Connectors Directory 上架前置清單（14 項，remote 專用）**：✅ 2 項（tool annotations、
讀寫分離）、🟡 5 項（OAuth／描述自審／icon／data handling／compliance 聲明）、
❌ 7 項（Team 帳號、HTTPS、privacy policy、公開文件、測試帳號、範例 prompt、
自行跑過每個 tool）。逐項細節見 history。

### 已定案方向

| 決策 | 現在的定案 |
|---|---|
| D-POSITION | Permissioned Fitness Decision Engine，不做 App／社群／內容庫 |
| D-EVIDENCE | 證據由 AI 經 tool call 傳入，我們不 fetch、不持有原始資料 |
| D-DATA | hosted 不保存任何個人資料；持久層只存在於 Phase 2 使用者控制環境 |
| D-LLM | 我們的程式不呼叫模型產生決策；host 端的模型使用不受此限 |
| D-TOOL | 對外收斂為 6 個決策 tool |
| D-INTERFACE | 目標不只 MCP，還要 REST API ＋ SDK（Phase 7，未開始） |
| D-CONNECTOR | 不自建來源 connector；來源方官方 connector（Strava／COROS）供資料，我們供決策 |
| D-CHANNEL | 只走 host 內建目錄（Anthropic Connectors Directory ＋ ChatGPT）；不做 marketplace、不做 model router |
| D-PROTOCOL | 協定升級走 dual-era，不直接切版本 |
| D-REGISTRATION | authorization server 選型硬條件：支援 CIMD |
| D-LICENSE | 閉源送 Anthropic MCPB；已送出，退件理由決定要不要公開 |
| D-IPGUARD | `開發計畫` §8 的 IP 保護（加密／License Token／機器指紋）全部 NO-GO（現在） |
| D-RULESCHEMA | ✅ **已實作**（`packages/rules` v1.1.0，8 條規則，見上「對外元件」）。2026-08-07 做過一次出處覆核：Gabbett 升為主文驗證，Mujika 撤回一組查不到的百分比並降級 evidenceLevel，ACSM 撤回一句摘要沒講的話 |

每條的完整理由、出處、反對意見在 history 的 §5「決策日誌」。

---

## 下一步

上架三步（registry／MCPB／release）與 Rule Schema 都已完成，**沒有一件事擋著上架**。
但 2026-08-07 對 `開發計畫` §3–§5 做過一次逐節 review，產出一組**可直接開工**的項目，
列在第 0 節；其餘照舊分五類。

### 0. Rule Library 治理（2026-08-07 review 產出）

**依賴關係先講**：R1 卡在 R2／C9 後面——沒有規則就沒有 rule 可以 trace。
不要先做 R1。

| # | 項目 | 為什麼 | 位置 |
|---|---|---|---|
| **R2** | **傷病邏輯有實作但不在規則庫**：`graph.js:176` 依 `contraindications` 過濾動作、`generatePlan.js:119` 依 active injury 的 `restrictions` 過濾。**沒有 rule id、沒有出處、不受仲裁。** | 仲裁矩陣把 `injury` 排在最上面，**而排最上面的那一格是空的**（現況：recovery 7、training_goal 1）。傷病決策每天在跑，卻是規則庫看不見的那部分。這是 C9 裡優先級最高的一塊 | `packages/knowledge-graph/src/graph.js`、`packages/planning/src/generatePlan.js` |
| **R1** | `decisionBasis` **只有 `evidra_decide_session` 有**（實測 `outputSchemas`，六個 tool 一個命中）。要不要補到另外五個是實作決定 | 對外宣稱已於 2026-08-07 縮回事實（`INSTRUCTIONS` 現在指名是哪一個 tool，並說明其他沒有）。**所以這不是誠信問題了，是功能決定**——但補之前那些 tool 的數字得先進庫，否則沒有 rule 可指 | `apps/mcp-server/src/outputSchemas.js` 五份契約 |
| **R3** | **證據等級階梯拆成兩軸。** 現 `EVIDENCE_LEVELS` 把研究設計（`systematic_review`／`rct`／`observational`）與機構背書（`guideline`／`position_stand`／`expert_consensus`）混在同一條 | GRADE 分開 *certainty of evidence*（研究設計、偏誤風險）與 *strength of recommendation*（另計利弊、價值觀、資源）。**強建議可以建立在低確定性證據上**，混成一條會讓規則從一份 recommendation 繼承強度，而沒有任何欄位顯示它自己的證據被評為多少。順帶補 `narrative_review`（EVD-R-007 卡在這個缺口） | `packages/rules/src/models.js`、`session-rules.json` |
| **R4** | **出處覆核要有觸發點。** `lastReview` 有欄位，但過期不會有人失敗、不會有人提醒 | 2026-08-07 那次覆核**兩個既定入口都不是**（沒有新文獻、沒有 outcome 異常），是人工重讀已有的引用，結果撤回兩項。生命週期缺這第三個入口。**到期天數未定，不得自行決定** | `scripts/review-phase.js` 加一條 gate |
| **R5** | `verificationStatus` 加 enum 硬檢查，並讓 `sources` 強制帶它 | 五級詞彙已於 2026-08-07 寫進 `readMe`，但**打錯字不會有人發現**（＝C11）。做法照 `assertProvenanceHonesty`：結構性禁止，不靠慣例 | `packages/rules/src/models.js` |
| **R6** | **把 canonical model 是「雙軌」寫進現行文件。** `healthMetrics`（6 型別）與 `vendorAssessments`（4 型別）是兩軌，各有自己的新鮮度窗與權重 | **現在沒有任何一份現行文件描述雙軌**，而 `開發計畫` §3.1 寫的是把四家複合分數併成一個 `enum [Low, Moderate, High]` 的單軌——**文件講的和程式做的相反**，會誤導下一個讀它的人 | `docs/product-spec.md` 或本檔現況 |
| **R7** | **C8（Evidence Quality）的形狀已定：用既有 `*Basis` 分類事實，不做純量。** 既有模式：`loadSources`／`rpeBasis`／`maxHeartRateIsAgeEstimate`——記「這個數字站在什麼上面」的 enum | `開發計畫` §3.2 的 `quality: 0.94` 是 `internal_composite`，而它會乘進 confidence。**confidence 正是使用者用來判斷「要不要信」的那個數字**，拿發明的權重去調它就是把可信度指標本身變成不可稽核 | 尚未有檔案 |

#### 0.1 明確不採用（**別再重新推導一次**）

| 來源 | 不採用的理由 |
|---|---|
| §3.2 `quality: 0.94` 純量 | 見 R7 |
| §3.3 `trigger: RPE_previous >= 8` | 違反紀律 2 與已實作的決定。`generateSemanticFitnessState.js:129-132`：乘 RPE 會 double-count 強度（廠商負荷已含強度），且讓不供 RPE 的來源算不出疲勞——「which is most of them」 |
| §3.3 規則級 `confidence: 0.93` | 類別錯誤。confidence 隨每次呼叫的 coverage 變動，規則本身沒有。而 §3.5 的 case 又有一個 `confidence: 0.82`，同名兩個意思 |
| §3.5／§3.6 Decision Case／Outcome Record | D-DATA 已定：三元組由呼叫端保存。**另外設計上也有問題**：`evidence_coverage: 0.87` 是純量，藏掉缺的是 recovery 還是 training；`rule_applied` 是單數，存不下「哪些規則輸了」 |
| §3.7 Rule Package | 兩個存在理由都已被否決（`tier` 屬 A6 未定、自動更新牴觸已發布的 `PRIVACY.md`）。**類比本身也要拆**：病毒碼更新失敗是 fail-closed，訓練規則更新失敗是 fail-open |
| §4「Confidence: High，幾乎不需質疑」 | 與整個庫的設計相反——每個引用強制填 `doesNotSupport`，理由是「in every case so far there is one」。repo 裡就住著反例：EVD-R-006 引 Gabbett，同時載入 Impellizzeri 的反對 |
| §4 Exercise Science Board | **那個 board 不存在。** 維持 `reviewer` 實名。宣稱一個不存在的審查機構，跟宣稱一個撐不住的證據等級是同一類錯 |
| §4「用既有 Decision Corpus 回測」 | 那個 corpus 我們不會有（同 D-DATA）。載體是 `eval/` 20 golden cases ＋ 368 tests ＋ 9 gates，性質不同：**只能說「行為變了」，不能說「醫學上變錯了」**。而且 2026-08-07 真正攔住改動的是 12 KB frame 上限那條測試，不是 golden case——守住規則庫的是**不變量**，不是案例集 |
| §5 四個新 tool | 逐個理由見 history §4.6.5。**補一條**：§5 自己的表格就顯示五列缺口**全在既有 tool 的輸出欄位裡**，沒有一列是「少一個口」 |

#### 0.2 版號規則（2026-08-07 起照這個走）

生命週期圖只寫「Release（version bump）」，沒說 bump 哪一個。實際同時有三個版號：

- **規則 patch**（`1.0.0 → 1.0.1`）＝只動出處，行為不變
- **規則 minor**＝門檻或 `effect` 改了
- **library minor**（`1.0.0 → 1.1.0`）＝任何規則變動
- **門檻一改就必須重打 `.mcpb`**——bundle 是把 `session-rules.json` 內嵌進去的

### 1. 等外部結果（不是我們的工作）

官方 registry 與 MCPB 表單審查結果。收到 MCPB 退件理由時，那就是 D-LICENSE 待查證項
（MIT 條文是否真的存在）的答案，不是失敗訊號。

### 2. 待使用者裁決的開放問題

| # | 問題 | 卡在哪 |
|---|---|---|
| A1 | authorization server 選哪家（Auth0／WorkOS／Clerk／自建） | 硬條件：支援 CIMD |
| A3 | max HR 171（220−49 估計值）要不要做一次真實最大努力測試 | 使用者身體資料，只有使用者能決定 |
| A4 | 4 個 tool 要不要改名（現名遮住 connector 名稱後看不出是健身領域） | `deprecatedToolAliases` 已在，改名不斷既有呼叫 |
| A5 | 決策理由句子該由引擎寫（現況）還是只回結構化數值交給 Claude 組句 | 牽動 `decideSession.js` 全部 `reason.push(...)`、schema 契約 |
| A6 | 商業分級（Free／Pro／Enterprise）要不要做 | 與計價單位（暫定 per-MAU）綁在一起，尚未定案前不得寫進資料結構 |
| A8 | 部署終局是 local-first 還是 remote | 取決於主客群是誰（醫療／企業 vs 個人使用者），非技術問題 |
| B2 | 宣言內部字句衝突（L40 模型無關 vs L188 里程碑要證明 MCP 增益） | 要改的是宣言，不是計畫；不得自行改宣言 |

### 3. 若使用者決定推進 remote（目前 NO-GO，僅供之後參考）

7.1 OAuth 三缺口（簽章驗證器／進入點接線／authorization server）＋ 7.2 公開部署（HTTPS）
＋ Phase 8 上架前置清單剩餘 12 項（見上）＋ 隱私政策改寫（觸發點是 authorization server
開工那一刻，且必須在 remote 開放前改完）。

### 4. 技術債（無出處或未驗證，不擋上架）

| # | 項目 | 位置 |
|---|---|---|
| C1 | `maxSampleGapSeconds = 30` 沒有出處 | `packages/connectors/src/timeInZone.js:106` |
| C2 | `trainingLoad ?? 分鐘數` 仍在編造負荷值 | `packages/evidence/src/model.js:155` |
| C6 | 我們的 parser 是照**匯出檔**寫的，沒對照過真實流程裡「Claude 從別家 MCP server 拿到的證據」形狀 | `packages/connectors/src/providers/*/normalize.js` |
| C8 | Evidence Quality 維度不存在（只有 coverage 與新鮮度，沒有「這個來源多可信」） | 尚未有檔案 |
| C9 | **Rule Library 只治理 `decide_session`**。ATL/CTL 時間常數（42／7）、TSB 分帶（5／−10／−30）、`DETRAINING`（14 天／25%）、`DEFAULT_BASELINES`（HRV 52／RHR 57／週負荷 360）、`SIGNAL_STALENESS_DAYS` 八個值、`PHASE_MULTIPLIERS`、`RETURN_RAMP`＝全部無出處，且不受 `assertThresholdsMatch` 兩向檢查保護 | `packages/training-load/src/trainingLoad.js`、`packages/semantic-engine/src/generateSemanticFitnessState.js`、`packages/planning/src/generatePlan.js` |
| C10 | **兩套 detraining 門檻並存且數字不同**：`trainingLoad.js` 是 14 天／25%，EVD-R-007 是 42 天／60%。前者無出處，後者在庫裡 | 同上第一項 ＋ `packages/rules/data/session-rules.json` |
| C11 | `verificationStatus` 沒有型別檢查，`sources` 也不強制帶它（EVD-R-002 的 Javaloyes 就沒有）。詞彙已定義在 `readMe`，但打錯字不會有人發現 | `packages/rules/src/models.js` |
| C12 | **傷病邏輯在規則庫外執行**——有實作、每天在跑，但沒有 rule id、沒有出處、不受仲裁。`injury` 是仲裁矩陣最高的一格，而它是空的 | 見 §0 的 R2 |

### 5. 來源覆蓋（Phase 5 剩餘）

Oura／Whoop 只有 registry 宣告、無 parser。Google Health Connect（API 方言，非
Takeout）目前停在 `scripts/`，是否升格為正式 connector 未定案。

### 6. Phase 9 協定升級（不急，非主軸）

十二個月 deprecation window，唯一耦合點是 7.1-C 的 authorization server 選型要照新版選 CIMD。
