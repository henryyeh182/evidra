# Fitness MCP — Implementation Plan

> 依 [Design Manifesto](design-manifesto.md) 推導 · 位階次於宣言，衝突時以宣言為準。
> **本文件只留「現況」與「下一步」。** 每個決定的完整理由、原文引述、查證過程、
> 失敗嘗試與否決掉的方案，全部在
> [fitness-mcp-implementation-plan-history.md](fitness-mcp-implementation-plan-history.md)
> ——**現況表格裡的每一項，出處都指得回那裡，不是憑空冒出來的結論。**
>
> **2026-08-07 拆分**：v8 那份累積到 1558 行，同時扛「決策稽核軌跡」與「下一步清單」，
> 後者越來越難找。拆分不代表任何一句舊結論被撤回，只是換了放的位置。
>
> **與 [user-journey.html](user-journey.html) 的分工（2026-08-07 定）**：
> 那份是**對外敘事正本**（stakeholder / marketing narrative）——產品是什麼、
> 為什麼難被取代、今天走得通哪些路，講給沒有領域知識的人聽。
> **本文件是工程 roadmap 正本**——開工順序、技術債、待裁決問題、上架清單。
> 兩份都要說真話，但**只有本文件排順序**；user-journey 不列開工順位，也不寫技術債編號。
> **事實衝突時以本文件的現況表為準**，並回頭修 user-journey。

---

## 現況

### 對外元件

- **6 個對外決策 tool**：`evidra_assess_fitness_state`、`evidra_decide_session`、
  `evidra_decide_exercise_substitution`、`evidra_generate_plan`、
  `evidra_preview_adjust_plan`、`evidra_commit_adjust_plan`
- **430 tests** 全綠（dependency-free，Node 20+）；**eval 20 golden cases**，5 個 gate 全綠
- **知識圖譜** 889 節點 / 5,785 邊；進退階 34 條（17 組互逆）；訓練目標五值域
- **Rule Library**（`packages/rules` v1.4.0）：**12 條規則**，每條帶 `ruleId`／`version`／
  `category`／`priority`／`basis`／`evidence`（`studyDesign` ＋ `recommendationStrength`，
  舊的單軸 `evidenceLevel` 由兩軸推導後照常輸出）／`sources`／`contested`／`limitations`。
  `sources`／`supportingLiterature`／`contested` 三個陣列的每一筆都**必須**帶合法的
  `verificationStatus`（`contested` 自 2026-08-08 起，見下 R5-C）。
  決策引擎沒有自己的門檻——`RULES = THRESHOLDS`，改 JSON 就改行為。
  門檻清單自 2026-08-09 起按引擎分組（`ENGINE_THRESHOLD_KEYS`：session 13／plan 1／
  planChange 2／catalog 1），聯集由 `assertThresholdsMatch` 雙向驗，並額外驗每條規則的
  `appliedBy` 與它宣告的門檻屬於同一個引擎。**`decisionBasis` 現在四個 tool 都回傳**
  （`decide_session`＋`generate_plan`＋`preview`／`commit_adjust_plan`＋
  `decide_exercise_substitution`），規則開火與否都帶。剩下未進庫的是 ATL／CTL、TSB、
  phase multiplier、return ramp，見技術債 C9
- **來源 parser：6 家**（Apple Health／Garmin／Google Health／Strava／Oura／WHOOP，
  Strava 另有 API 與 bulk export 兩種方言）。schema registry 共宣告 6 個平台（8 種方言）。
  **前四家是照真實匯出檔寫的；Oura 與 WHOOP 是照各家自己的 OpenAPI 文件寫的
  （2026-08-07），還沒對過任何一份真實回應**——見技術債 C13。
  Garmin 已消化 2026-08-06 交接檔提到的 GDPR 匯出差異：Health Status HRV 已補 parser，
  `hrvWeeklyAverage` sentinel 仍不映射；剩下的來源成熟度缺口不是 Garmin 欄位路徑，
  而是真實 AI host / 第三方 MCP server 傳進來的 evidence 形狀（C6）
- **transport**：stdio ✅ · Streamable HTTP ✅（僅 `localhost:8787`，未公開部署）
- **OAuth**：resource server 已實作（RFC 9728 metadata、audience 驗證、issuer 白名單、
  scope 檢查）；**簽章驗證器是空插槽、`http.js` 進入點沒接線、沒有 authorization
  server**——三者補齊前，`serve:http` 跑起來是共用密碼模式，不是真的 OAuth
- **協定版本**：`2025-06-18`／`2025-03-26`／`2024-11-05`（legacy 握手式）。
  最新規格 `2026-07-28`（stateless）尚未跟進，做法已定為 dual-era，未開工
- **`npm run review:phase` 十三條 gate 現況全綠**（G11 於 2026-08-09 加入：規則庫改動必須跑過 Decision Harness 且指紋已被承認）

### 三種形態（與 user-journey 共用的名稱）

同一顆引擎、同一份決策實作，差別在跑在誰的機器上、證據怎麼進來、誰付錢。
**這不是三個階段，是三種使用者處境**——remote 上線不會取代 desktop extension，
Phase 2 也不是 remote 的續集。

| 形態 | 是什麼 | 現況 | 對應本文件哪裡 |
|---|---|---|---|
| **Form 1** desktop extension（MCPB） | 跑在使用者自己的電腦上，stdio；**第一個可用形態** | ✅ v0.4.0 可裝（2026-08-09），registry 同版已上架；MCPB 表單審查中 | 「通路與上架」順位 1／3 |
| **Form 2** remote MCP server | 跑在我們的機器上；**手機唯一可行的路，也是商業化形態**（計價暫定 per-MAU） | 🔴 NO-GO（現在），四個缺口 | 「remote 的四個缺口」、下一步順位 9 |
| **Form 3** user-controlled deployment | 整組搬進使用者／機構控制的環境；**高隱私與企業形態**，唯一能保存個人縱向歷史的形態 | 🔴 一行程式都沒有 | CLAUDE.md 的 Phase 2；本文件尚無工作包 |

Form 1 與 Form 3 的計算都在使用者那邊；**Form 2 是唯一把計算放在我們這裡的**，
也因此是唯一需要 hosted 無狀態這條硬約束的。排序依核心宗旨，不依 Phase 編號——
**Form 3 排最後是因為最晚開工，不是因為最不重要**。

### 護城河缺口

**護城河正本（從 `Evidra_Decision_Engine_開發計畫.md` 保留）**：
Evidra 的護城河不是 MCP server、不是資料庫、不是動作內容庫，也不是「比 AI 更會講健身」。
它是 **Rule Library + Decision Graph + Evidence Model** 組成的 Decision Infrastructure：
把使用者交出的 evidence 轉成可解釋、可重現、vendor-neutral 的訓練決策。

| 護城河 | 現在對應 | 下一步怎麼加深 |
|---|---|---|
| **Evidence Model** | `packages/evidence`、source schema、6 家 parser、coverage／freshness | 補 C8/R7 的 evidence basis；驗 C6 真實 host 傳入形狀；補 C13 Oura／WHOOP 真實回應 |
| **Rule Library** | `packages/rules` v1.4.0，**12 條規則**（9 條 session ＋ EVD-R-010／011／012 分屬 plan／planChange／catalog），含出處、限制與仲裁欄位；證據兩軸與 `verificationStatus` 皆為載入期強制，三個引用陣列（含 `contested`）一律必填；`injury` 那格由四條規則填滿。每條規則必填 `appliedBy`，門檻按引擎分組雙向驗 | 收編 C9 其餘門檻（ATL/CTL、TSB、recovery 權重、readiness 懲罰係數、phase multiplier、return ramp）；R2／R3／R5／C10 已完成 |
| **Decision Graph** | `decide_session` 的 rule arbitration、knowledge graph 的替代／進退階不變量、planning patch validator | 把 injury、substitution、plan generation 的決策路徑接上 rule id 與 `decisionBasis`，讓多 tool 都能 trace |

**定位句**：A deterministic exercise-science decision engine that converts evidence into explainable training decisions.
LLM 負責理解使用者與表達結果；決策本身必須由 Evidra 的 evidence、rules、graph 算出來。
這就是它和「另一個 AI Coach」的分界。

**不能從開發計畫照搬的部分**：商業分級、Rule Package 自動更新、IP 加密／機器指紋、
四個新 tool、Cloud 排序仍以本文件「已定案方向」與 history §4.6 的處置為準。

| # | 能力 | 現況 | 缺口 |
|---|---|---|---|
| 1 | Semantic Fitness Layer | 🟡 | 6/6 平台有 parser；Apple Health／Garmin／Google Health／Strava 已用真實匯出或真實 API 匯出形狀驗證，Oura／WHOOP 只在 spec 與模擬文件上 |
| 2 | Fitness Intelligence Engine | 🟢 | 確定性五層決策；ATL/CTL/TSB ＋ detraining 軸線 ＋ 個人基線 |
| 3 | Fitness Knowledge Graph | 🟢 | 889 節點 / 5,785 邊，進退階與訓練目標皆有不變量把關 |
| 4 | Feedback Learning | ✅ 已結（設計如此） | 三元組由呼叫端保存，hosted 不留 |
| 5 | Multi-LLM Interface | 🟡 | stdio／HTTP 已上；OAuth 三缺口（見上）；無 REST API、無 SDK |

### 通路與上架

| 順位 | 通路 | 判定 |
|---|---|---|
| 1 | 官方 MCP registry | ✅ **已上架**（`io.github.henryyeh182/evidra` v0.4.0，`status: active`／`isLatest: true`，2026-08-09；registry 無審查流程，publish 即生效） |
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
| D-RULESCHEMA | ✅ **已實作**（`packages/rules` v1.4.0，12 條規則，見上「對外元件」）。2026-08-07 做過一次出處覆核：Gabbett 升為主文驗證，Mujika 撤回一組查不到的百分比並降級證據等級，ACSM 撤回一句摘要沒講的話。同日做 R3／R5：證據拆兩軸、`verificationStatus` 強制必填（見 §0）。2026-08-08 補上 `contested`，當場又撤回兩句（見 C11） |

每條的完整理由、出處、反對意見在 history 的 §5「決策日誌」。

---

## 下一步

上架三步（registry／MCPB／release）與 Rule Schema 都已完成，**沒有一件事擋著上架**。
但 2026-08-07 對 `開發計畫` §3–§5 做過一次逐節 review，產出一組**可直接開工**的項目，
列在第 0 節；其餘照舊分五類。

**交接檔對照（2026-08-06）**：本次交接以
`~/dev/claude-brain/journal/2026-08-06-evidra-mbp-rd.md` 為準。那份裡的上架待辦、
Rule Schema、Garmin HRV parser 已被後續 v0.3.7 與本文件消化；Google Health API v4
仍只停在 `scripts/`，見第 5 節。

### 開工順序（目前建議）

這裡只排「接下來陸續完成什麼」，不重寫 history 的決策理由。原則是：
**先補可驗證的不變量，再補規則覆蓋，再補來源成熟度；remote 仍等使用者決定後才開工。**

| 順位 | 工作包 | 包含項目 | 為什麼排這裡 | 狀態 |
|---|---|---|---|---|
| **1** | Rule schema guardrails | R5 `verificationStatus` enum／`sources` 強制帶狀態；R3 證據等級拆成「研究設計」與「建議強度」兩軸；**R5-C** `contested` 也強制帶狀態 | 這兩項是規則庫的地基。先把資料形狀鎖住，後面加傷病規則或收編 C9 數字才不會繼續累積無法稽核的欄位 | ✅ 已完成（2026-08-07，`8b15468`／`e171966`；R5-C 於 2026-08-08，庫升 v1.2.0。**當時未進 v0.3.7 bundle，已隨 v0.4.0 出貨**） |
| **2** | Injury rules 入庫 | R2／C12：把現有 injury restriction、contraindication filter 變成有 rule id、category、priority、來源與限制的規則 | `injury` 是仲裁矩陣最高類別，但現況規則庫裡沒有 injury 規則；這是 rule coverage 最大洞 | ✅ 已完成（2026-08-09，庫 1.3.0／引擎 1.5.0）。四處全數入庫：`decide_session`＝EVD-R-009（2026-08-08）、`generatePlan`＝EVD-R-010、`adaptPlan` 的 `add_injury`＝EVD-R-011、catalog＝EVD-R-012。**入庫過程查出 `generatePlan` 的傷病限制不會移除任何動作**（實測：帶膝傷、restriction 寫明 back squat，產出的計畫仍排深蹲）——依使用者決定不改行為，改為誠實記錄在 EVD-R-010 的 `limitations` 與計畫的 `reasoning` 裡 |
| **3** | 收編非 `decide_session` 門檻 | C9／C10：ATL/CTL、TSB、detraining、baseline fallback、staleness、phase multiplier、return ramp 的數字進治理；先處理兩套 detraining 衝突 | 這決定 R1 能不能做。沒有規則與來源，其他 tool 就算補 `decisionBasis` 也無 rule 可 trace | 🟡 **一半（2026-08-08 起，2026-08-09 更新）**：會進決策的三組（detraining、baseline fallback、staleness）收進 `engine-parameters.json`（當時 EVD-P-001～009 九項），值一個都沒改、決策一條都沒動。**兩套 detraining 衝突已解（2026-08-09）**：EVD-P-001／002 移進 EVD-R-007 成為它自己的門檻，參數集降為七項，觸發它的數字現在會出現在 `decisionBasis` 裡。**過程中量出第二個惰性門檻**：`detrainingMinCtlLossPct`（25%）在閒置第 12 天就跨過，而閘門要第 14 天才開，所以它跟 `returnSevereIdleDays`（42）一樣永遠不是決定因素——EVD-R-007 四個門檻有兩個不做事，兩個都留著並在 limitations 講明。**ATL/CTL、TSB、recovery 權重、readiness 懲罰係數、phase multiplier、return ramp 仍未動** |
| **4** | 擴大 decision trace | R1：視第 2–3 項結果，決定要不要把 `decisionBasis` 補到另外五個 tool | 對外已誠實縮回「只有 `evidra_decide_session` 有」，所以這是能力擴充，不是修誠信缺口 | ✅ 已完成（2026-08-09）：`generate_plan`／`preview_adjust_plan`／`commit_adjust_plan`／`decide_exercise_substitution` 四支都帶，輸出契約與 `schemas/tools/` 同步。`assess_fitness_state` 不帶——它回傳狀態不做決策，沒有規則可指 |
| **5** | Evidence quality 形狀 | R7／C8：用既有 `*Basis` 類 enum 表示數字站在哪裡，不做 `quality: 0.94` 純量 | 這是 Semantic Fitness Layer 下一個真缺口，但要避開發明權重去影響 confidence | 可設計，實作需小心契約 |
| **6** | Source maturity | C13：拿 Oura／WHOOP 去識別化真實回應驗 parser；Google Health API v4 決定是否升格正式 connector；C6 對照 AI host／第三方 MCP server 傳入形狀 | 六家 parser 已有，下一步不是再加家數，是確認真實流程裡進來的形狀不會偏 | Oura／WHOOP 需要真實回應；Google API 需使用者決定是否升格 |
| **7** | 小但硬的技術債 | C1 `maxSampleGapSeconds = 30` 出處或改成 caller 提供；C2 移除 `trainingLoad ?? 分鐘數` 編造負荷 | 這些不擋上架，但會直接影響「不編造」承諾 | 可開工 |
| **8** | 產品裁決 | A4 tool 改名、A5 理由由引擎寫或交給 Claude、A6 商業分級、A8 local-first vs remote、B2 宣言字句 | 這些不是工程可自行決定；決定後才會改 schema、文案、部署路線 | 等使用者 |
| **9** | Remote path | A1 authorization server 選型 → OAuth 三缺口 → HTTPS 公開部署 → privacy policy 改寫 → remote 上架清單 | 目前 remote 是 NO-GO（現在）。一旦 A8/A1 決定推進，這條才變成主線 | 暫不開工 |
| **10** | Protocol dual-era | Phase 9：`2026-07-28` stateless dual-era | 不急；唯一前置影響是 authorization server 選型要支援 CIMD | 暫不開工 |

**版號基準（2026-08-08 使用者定）**：順位 1 完成的這份規則庫就是 **Rule Library v1.0.0
正式版**，從 1.0 起算。引擎另有自己的版號（`packages/decision-engine/src/version.js`，
同樣從 1.0.0 起），與產品版號 `server.json` 脫鉤；兩個都隨每個決策回傳
（`decisionBasis.libraryVersion`／`engineVersion`）。**已發布的 v0.3.7 bundle 內嵌的
`"version":"1.0.0"` 是先前自編的 pre-release**，內容是出處覆核之前的舊規則庫，就地作廢
——archive 改不了，只能在這裡記一句。**v0.4.0 起內嵌的是正式的庫 1.4.0**，
那個撞號只存在於 v0.3.7 以前的 archive 裡。

**下一個最小可完成版本**：順位 2 與 4 已完成（injury 類別四條規則、四支 tool 帶 trace）；
做完順位 3 得到 `decide_session` 以外的關鍵門檻開始被治理。**順位 3 剩下的是 ATL／CTL、
TSB、phase multiplier、return ramp 與兩套 detraining 衝突。**

### 0. Rule Library 治理（2026-08-07 review 產出）

**依賴關係先講**：R1 卡在 R2／C9 後面——沒有規則就沒有 rule 可以 trace。
**兩項都已於 2026-08-09 完成**（R2 四處入庫、R1 四支 tool 帶 trace），依賴關係留著，
因為它是下一次新增決策路徑時同樣要走的順序。

| # | 項目 | 為什麼 | 位置 |
|---|---|---|---|
| ~~**R2**~~ | ✅ **已完成（2026-08-09，庫 1.3.0）**：四處傷病過濾全部入庫並帶 `decisionBasis`——`decideSession` ＝ **EVD-R-009**（2026-08-08）、`generatePlan` 的高衝擊降強度 ＝ **EVD-R-010**、`adaptPlan` 的 `add_injury` ＝ **EVD-R-011**、catalog 的 contraindication 交集 ＝ **EVD-R-012**。現在 `generatePlan` 在尋找 fallback movement 時若被 catalog hard-filter，也會把 EVD-R-012 與被排除候選寫進 plan trace；純 `searchExercises` 仍是查詢，不產生 decisionBasis。四條寫成四條而不是一條，因為**它們的比對方式互不相同**（自由文字 token >3 字元／四個字面 regex／區域 token >=3 字元且 avoid 無長度下限／catalog tag 相等），寫成一條等於宣稱一致性。**入庫查出兩件與宣稱不符的事，都改為誠實記錄而非改行為（使用者決定）**：一，`generatePlan` 的 active injury restrictions **不會移除任何動作**（per-slot 過濾讀的是 `avoidMovements`，restrictions 落在另一個欄位），原本 `reasoning` 卻寫「Active injury constraints applied」；二，substitution 只要呼叫端有傳 avoid list 就無條件印「were hard-filtered out」，**即使一個候選都沒濾掉**（demo 5 正是這種情況：器材過濾先一步移除了那個候選）。兩句話都已改成與實際相符 | 仲裁矩陣把 `injury` 排在最上面，**而排最上面的那一格曾經是空的**（當時：recovery 7、training_goal 1；現在 injury 4） | `packages/decision-engine/src/decideSession.js`、`packages/planning/src/generatePlan.js`、`packages/planning/src/adaptPlan.js`、`packages/knowledge-graph/src/graph.js` |
| ~~**R1**~~ | ✅ **已完成（2026-08-09，引擎 1.5.0）**：`decisionBasis` 由 `packages/rules/src/basis.js` 的 `buildDecisionBasis` 統一產生，四支 tool 共用同一個形狀（`decide_session` 也改用它，輸出逐欄不變）。**沒有規則開火時欄位照樣回傳、內容為空**——這是這次的重點：缺欄位無法與「這條路徑不檢查」區分。`assess_fitness_state` 不帶，它回傳狀態不做決策 | 對外宣稱已於 2026-08-07 縮回事實，2026-08-09 隨能力擴充改回；server `INSTRUCTIONS` 同步改寫（2042／2048 bytes） | `apps/mcp-server/src/outputSchemas.js` ＋ `schemas/tools/` 四份契約 |
| ~~**R3**~~ | ✅ **已完成（2026-08-07）**：`evidence` 物件取代單軸 `evidenceLevel`——`studyDesign`（八值，含新增的 `narrative_review`）＋ `recommendationStrength`（`supports_threshold`／`supports_direction_only`／`internal_heuristic`）。EVD-R-007 卡的那個缺口關掉了：它現在直接寫 `narrative_review`，不再四捨五入到 `expert_consensus`。**舊 `evidenceLevel` 由兩軸推導後照常輸出**，當時 8 條規則的值逐字不變，契約不動。**目前全庫沒有任何一條是 `supports_threshold`**——每筆引用的 `doesNotSupport` 都寫著數字不被支持，這件事現在由欄位講，不是由散文講 | `packages/rules/src/models.js`、`session-rules.json` |
| **R4** | **出處覆核要有觸發點。** `lastReview` 有欄位，但過期不會有人失敗、不會有人提醒 | 2026-08-07 那次覆核**兩個既定入口都不是**（沒有新文獻、沒有 outcome 異常），是人工重讀已有的引用，結果撤回兩項。生命週期缺這第三個入口。**到期天數未定，不得自行決定** | `scripts/review-phase.js` 加一條 gate |
| ~~**R5**~~ | ✅ **已完成（2026-08-07）**：`VERIFICATION_STATUSES` 成為載入期 enum，`sources` 與 `supportingLiterature` 兩邊都強制必填。**強制之後翻出一筆**：EVD-R-002 的 Javaloyes 引用是全庫唯一沒有 status 的，因為 2026-08-07 那次覆核只碰了 R-004／006／007（`git show 0337166 --stat` 可核）——**從來沒有人查證過它**。詞彙加第六格 `unverified`（比 `citation_not_read_in_full` 更弱，後者仍暗示有讀過一點），該規則的 `limitations` 也加一行明講。`describeRule` 改成無條件輸出這個欄位：原本「有才帶出」讓沒查過的引用和沒東西可講的引用長得一模一樣。順帶把「檔案宣告的詞彙 vs 載入器強制的詞彙」也綁成不變量 | `packages/rules/src/models.js` |
| ~~**R6**~~ | ✅ **已完成（2026-08-07）**：雙軌寫進 [`schemas/README.md`](../schemas/README.md) 的「the vocabulary has two tracks」一節，含為什麼不能併成單一 `enum [Low, Moderate, High]`（三家複合分數不是同一個量；而且 readiness 門檻切在 40／60／85，三格裝不下） | 放在 schemas/README 而非 product-spec：那裡才是**加平台的人真的會讀的地方**，而這件事最容易在加平台時做錯 | — |
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
| §4「用既有 Decision Corpus 回測」 | 那個 corpus 我們不會有（同 D-DATA）。載體是 `eval/` 20 golden cases ＋ 430 tests ＋ 9 gates，性質不同：**只能說「行為變了」，不能說「醫學上變錯了」**。而且 2026-08-07 真正攔住改動的是 12 KB frame 上限那條測試，不是 golden case——守住規則庫的是**不變量**，不是案例集 |
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

**已發布的 v0.4.0 與 main 的落差**：**目前沒有落差。** v0.4.0（2026-08-09 發布，
sha256 `294acd57b50cad0d0…eeb8`）打包自 `c678df2`，而那就是 main 的 HEAD。
下載回來解開與本機打包那顆 `diff -rq` 逐檔相同。

**v0.3.7 留下的那批落差，這一版全數關閉**，逐項對照如下——列出來是因為每一項都曾經
是「公開可安裝的版本仍在宣稱一件已經撤回的事」：

| v0.3.7 那顆的行為 | v0.4.0 |
|---|---|
| 規則庫 **1.0.0**，EVD-R-007 仍宣稱 `systematic_review` 並帶著已撤回的「VO₂max 兩到三週掉 4–7%」 | 庫 **1.4.0**，該引用降為 `narrative_review`、數字撤回 |
| Gabbett 停在 `numbers_from_secondary_sources`、`verificationStatus` 不強制 | 三個引用陣列一律強制，Gabbett 升為主文驗證 |
| `vendorAssessments` 不在 tool schema——引擎讀得到、呼叫端無從得知 | **已命名**。兩顆 bundle 各自跑起來問 `tools/list` 實測：v0.3.7 三支工具皆 `false`，v0.4.0 皆 `true` |
| 沒有 EVD-R-009；有傷病限制的日子 `governingRule` 歸給旁邊的恢復規則或整個從缺 | 四條傷病規則（EVD-R-009～012），四支 tool 都帶 `decisionBasis` |
| 沒有排定課表的呼叫完全不帶 `decisionBasis`，而它是必填欄位 | 一律回傳；沒有規則開火時內容為空 |
| 目標肌群沒有讀數時報「target-muscle fatigue 0」，那個 0 是加總器初始值 | 改成講「近一週沒有負荷落在這些肌群」 |
| 沒有 `packages/decision-engine/src/version.js`，引擎版本無對應物可比 | 引擎 **1.6.0**，與庫版號、發布版號三者分開 |

**三邊已對齊**：GitHub release、`server.json` 與官方 registry 的 `isLatest` 都是 v0.4.0，
sha256 同為 `294acd57b50cad0d0…eeb8`，`review:release` 六條全綠。

**這幾段刻意不寫進 user-journey 或 README**：那是產品頁與對外敘事，build 落差屬於本文件。

**這段會過期，而 G9 攔不到**：G9 驗的是這個章節存不存在，不驗內容跟不跟得上 main。
2026-08-08 就是這樣漏掉整批的——當天三次引擎變動都進了 main，這段仍停在前一天的量測。
**動到 `packages/decision-engine`、`packages/rules` 或 tool schema 就要回來補這裡。**

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
| C9 | 🟡 **一半已收編（2026-08-08 起，2026-08-09 更新）**：`DEFAULT_BASELINES`（HRV 52／RHR 57／週負荷 360）與 `SIGNAL_STALENESS_DAYS` 移入 `packages/rules/data/engine-parameters.json`，現為 **EVD-P-003～009 共七項**（參數集 1.1.0），各自帶 `basis`／`sources`（**七項全是 `internal_composite`、全部空陣列**）／`limitations`，由 `assertParametersMatch` 兩向檢查、進 `rule-fingerprint.json`。**原本的 EVD-P-001／002（detraining 14 天／25%）已於 2026-08-09 移出參數集、成為 EVD-R-007 自己的門檻**——它們決定那條規則開不開火，卻被放在規則的下一層且不進 `decisionBasis`；移進去之後呼叫端看到的門檻就是觸發它的門檻（見 C10）。**收編不等於有出處**——搬過去只是讓「沒有出處」變成資料裡的欄位。**仍在庫外、仍是裸常數**：ATL/CTL 時間常數（42／7）、TSB 分帶（5／−10／−30）、recovery 權重與 readiness 懲罰係數、`PHASE_MULTIPLIERS`、`RETURN_RAMP`。**七項參數一樣不進 `decisionBasis`**，呼叫端看不到——R1 已完成但只涵蓋規則，參數仍在外面 | `packages/rules/data/engine-parameters.json`、`packages/training-load/src/trainingLoad.js`、`packages/semantic-engine/src/generateSemanticFitnessState.js`、`packages/planning/src/generatePlan.js` |
| ~~C10~~ | ✅ **已解（2026-08-09）**：14 天／25% 從 `engine-parameters.json` 的 EVD-P-001／002 移進 EVD-R-007，成為那條規則自己的門檻。分工不再與直覺相反——觸發它的兩個數字現在跟決定降幾級的兩個數字在同一條規則裡，`decisionBasis` 回傳的門檻就是觸發它的門檻。值一個都沒改，harness 37 情境 10 項檢查全過。**但這條留著不刪，因為它查出的東西比原本記的多**：42 天是死的（第 38 天就由另一臂成立）之外，**25% 也是死的**——閒置第 12 天就跨過 25%，而 `&&` 的另一臂要第 14 天才成立，所以 `idle >= 14` 一為真，`loss >= 25` 必然早已為真。2026-08-09 用 `computeTrainingLoad` 量八組訓練史（3～90 堂課、負荷 30～200、間隔 1～3 天）：閒置 11 天一律 23%、12 天一律 25%、14 天最低 27%；代數同意——`(41/42)^14 = 0.714`。**EVD-R-007 四個門檻有兩個永遠不決定任何事**，兩個都保留、都在自己的 limitations 講明，DH-BND 各掛一條書面豁免，每次跑會印 | `packages/rules/data/session-rules.json`、`harness/lib/quantities.js` |
| ~~C11~~ | ✅ **已關閉（2026-08-07，R5；2026-08-08 補完 `contested`）**：`verificationStatus` 成為載入期 enum，**三個陣列**（`sources`／`supportingLiterature`／`contested`）都強制必填，檔案宣告的詞彙與載入器強制的詞彙也綁成不變量。`contested` 原本刻意豁免並在庫的 readMe 裡記為 known gap，2026-08-08 收掉——**收掉當場抓到兩筆**：Impellizzeri 那筆的第三個子句摘要沒講，Lolli 那筆沒有標題、對不到單一文獻，且本身是 editorial 沒有摘要（所以「兩筆都取自已發表摘要」這句敘述對後者為假）。兩筆都下修，撤回的原文留在各自 `verification` 區塊。**當時未進 v0.3.7 bundle**（commit 晚於發布），**已隨 v0.4.0 出貨** | `packages/rules/src/models.js`、`packages/rules/data/session-rules.json` |
| C12 | 🟡 **一半已完成（2026-08-08）**：`decide_session` 那處成為 EVD-R-009，`injury` 那格不再是空的。`generatePlan` 與 catalog 兩處仍在庫外 | 見 §0 的 R2 |
| C13 | **Oura／WHOOP 的 parser 沒對過真實回應。** 欄位路徑與單位來自兩家自己的 OpenAPI（權威），但**沒有任何一份真實 API 回應驗證過**——spec 說得對不等於實際回傳長那樣（真實資料裡的哨兵值、空陣列、部分欄位缺漏，前四家都是在真檔案上才發現的）。這是 C6 的加強版：C6 是「照匯出檔寫、沒對過真實流程」，這裡連匯出檔都沒有 | `packages/connectors/src/providers/oura`、`.../whoop` |

### 5. 來源覆蓋（Phase 5 剩餘）

**六個平台都有 parser 了**（2026-08-07 補上 Oura 與 WHOOP）。**剩下的不是家數，是成熟度**：
Oura／WHOOP 照兩家自己的 OpenAPI 寫，尚未對過任何真實回應——見技術債 C13，
關掉它只需要一份去識別化的真實回應。

Google Health API v4（非 Takeout；Google Health API 匯出／轉換腳本）目前停在 `scripts/`
的 `import:google-health-api`，是否升格為正式 connector 未定案。交接檔裡的剩餘問題仍是
`dailyRollUp` steps、sleep filter 成員名、是否把 API 方言納入 schema registry／scenario／測試；
出貨前還要把目前測試用 Web client + 手貼 authorization code 路徑改成 Desktop app client + loopback。

### 6. Phase 9 協定升級（不急，非主軸）

十二個月 deprecation window，唯一耦合點是 7.1-C 的 authorization server 選型要照新版選 CIMD。
