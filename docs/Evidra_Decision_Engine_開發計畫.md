# Evidra Decision Engine 開發計畫

> 🔴 **已於 2026-08-06 併入 [fitness-mcp-implementation-plan.md](fitness-mcp-implementation-plan.md) v8，
> 本檔是併入前的原稿，不再是有效計畫。**
> 逐章處置（4 章併入／2 章列為提案／3 章與已定案項目衝突未併入）見該文件 **§4.6.1**。
> **不要照本檔開工**——其中的定價分級、IP 保護、新增 4 個 tool、Cloud 排序四項
> 與已定案的決策衝突，處置理由在 §4.6.5 與 §0.0.2。
> 本檔提到的 tool 名稱是 v0.2.0 改名前的舊名（現為 `evidra_*`）。
>
> **仍保留的價值**：本檔是 Evidra 護城河與定位語言的來源之一，尤其是
> **Decision Infrastructure**、**Rule Library + Decision Graph + Evidence Model**、
> 以及「LLM 只做理解與表達，決策由 Evidra 決定」這三件事。這些已在
> [fitness-mcp-implementation-plan.md](fitness-mcp-implementation-plan.md) 的「護城河正本」收斂；
> 開工順序仍以那份正本為準。

> 整合來源：AthleteData vs Evidra 定位分析、Exercise Science Decision Infrastructure、Evidence Governance（證據治理）、Decision Science Architecture（決策科學架構）、`.mcpb` 本機部署策略調整
> 對應現況：Evidra 既有 MCP tools — `assess_fitness_state`、`decide_session`、`generate_plan`、`decide_exercise_substitution`、`preview_adjust_plan`、`commit_adjust_plan`

**一句話定位（來自 Decision Science Architecture）：**
> A deterministic exercise-science decision engine that converts evidence into explainable training decisions.
> LLM 只是呼叫它：`decision = evidra.decide(evidence)`，LLM 負責解釋與溝通，決策本身永遠來自 Evidra。這代表底層模型換成 GPT / Claude / Gemini 都不影響決策一致性——這是把 Evidra 定位成 **Exercise Science Operating System (ESOS)** 而非「另一個 AI 判斷器」的關鍵。

---

## 0. 核心定位重申（Phase 1 調整：本機優先）

| | AthleteData | Evidra |
|---|---|---|
| 角色 | Data Infrastructure | **Decision Infrastructure** |
| 回答 | What happened? | **What should today's session become?** |
| 護城河 | 資料整合、Source-of-Truth、Dataset 規模 | **Rule Library + Decision Graph + Evidence Model**（不是 Server） |
| Phase 1 商業模式 | Consumer SaaS 訂閱 | **`.mcpb` 本機 Desktop Extension**（Free / Pro / Enterprise） |
| 長期商業模式 | Consumer SaaS 訂閱 | Local-first，Cloud 是後續「加值」而非取代 |

**產品定位修正：** Evidra 不是「MCP Server」，而是 **Exercise Science Engine packaged as an MCP Desktop Extension**。真正的產品是 Decision Engine 本身，`.mcpb` 只是封裝與交付方式。

Evidra 不做 Dashboard、不保存 HRV 原始值，只消費 Evidence，輸出 **可解釋、可重現、vendor-neutral** 的決策——現在多一條：**Evidence 不離開使用者的電腦**。這個定位是所有後續架構決策的錨點,任何功能如果讓 Evidra 往「另一個 AI Coach」或「必須把健康資料上雲」靠攏，都要重新檢視。

**為什麼本機優先反而是更好的 Phase 1（而不是妥協）：**
- 核心價值主張本來就是 Deterministic、Explainable、Evidence 不外流——`.mcpb` 讓這個承諾可以被具體驗證，而不只是口頭保證
- 對醫療、運動隊、企業、重視隱私的個人客群，「資料完全在本機」是直接的銷售論點
- 不用一開始就處理 Cloud 基礎建設、OAuth 認證、資料保留政策這些跟核心決策邏輯無關的工程量
- 真正的 IP（Rule Library / Decision Graph / Evidence Model）跟部署方式解耦，未來要不要做 Cloud 是「加不加一層」的問題，不是重寫

**唯一要付出的代價：** 沒有 Usage Data、沒有集中的 Outcome Database，Layer 7（Outcome Learning）會變慢——這點在下面風險章節會再處理。

---

## 1. 系統架構：Evidra Core Decision Engine v1（九層）

三層模型（Evidence / Decision / Learning）是概念分組，實作上要落地成九個責任明確的層：

```
              Evidence Sources
   Apple  Garmin  WHOOP  Oura  Polar  Manual  CSV  FHIR
                        │
                        ▼
   Layer 0  Evidence Canonical Model（vendor-neutral 中介語言）
                        │
                        ▼
   Layer 1  Evidence Quality Engine（每個 signal 的可信度打分）
                        │
                        ▼
   Layer 2  Evidence Coverage Engine（缺值誠實回報，不靜默推論）
                        │
                        ▼
   Layer 3  Rule Library（版本化，核心 IP）
                        │
                        ▼
   Layer 4  Conflict Resolver（Priority Matrix 解決規則衝突）
                        │
                        ▼
   Layer 5  Decision Engine（輸出 from/to/reason/rule/confidence）
                    ┌───┴───┐
                    ▼       ▼
   Layer 6  Explainability   Confidence Scoring
            Engine（Rule Trace）
                    └───┬───┘
                        ▼
                Training Decision（對外 API 輸出）
                        │
                        ▼
   Layer 7  Outcome Learning（Decision → Outcome → Coach Review → Rule Review）
                        │
                        ▼
   Layer 8  Knowledge Governance（Exercise Science Board 治理流程）
```

**Packaging（.mcpb 部署形態）：** 九層邏輯全部跑在本機，`.mcpb` 只是外層封裝：

```
Claude Desktop
      │
   Evidra.mcpb   ← 封裝層，不含任何決策邏輯本身
      │
Decision Engine（Layer 0-6，本機執行）
      │
Rule Library（本機檔案，可分套件更新）
```

所有資料（Apple Health 匯出、Garmin 匯出、HRV、睡眠、課表、決策紀錄）全部留在使用者電腦上，不經過 Evidra 的伺服器。這件事必須是架構上「做不到外洩」而不是「政策上承諾不外洩」——兩者對重視隱私的客群說服力完全不同。

**九層對應到之前三層分組：**
- **Evidence Layer** = Layer 0-2（Canonical Model → Quality → Coverage）
- **Decision Layer** = Layer 3-6（Rule Library → Conflict Resolver → Decision Engine → Explainability）
- **Learning Layer** = Layer 7-8（Outcome Learning → Knowledge Governance）

**設計原則（貫穿全部九層）：**
1. Rule 永遠引用 Canonical Signal，不直接寫 `if Garmin...`
2. 沒有 Evidence 就回報「缺失」，不做靜默推論
3. 每個 Decision 必須能回答「為什麼」——引用 Rule ID + Evidence + Source + Priority
4. LLM 不直接改變決策邏輯，只做「輸入理解」與「輸出表達」；真正的邏輯在 Layer 3-5
5. 有衝突時一定要有明確、可預期的仲裁機制（Layer 4），不能靠 LLM 臨場判斷
6. **Decision Engine 與 Rule Library 要做成獨立模組**，不要跟 `.mcpb` 封裝層或任何特定部署方式耦合——這樣未來若要推出 Cloud 版或 Enterprise 內部部署版，只是換一層 Packaging，核心邏輯不用重寫

---

## 2. 商業模式與定價

### 2.1 為什麼不用純「Rule 數量」切 Free/Pro

路線圖中 Rule Library 要到 Phase 3（3-6 個月）才擴充到 30-50 條，代表上線初期 Free 版幾乎等於全部——用數量門檻（例如「30 條 Free / 100+ Pro」）在早期沒有意義，而且「數量多寡」跟 Evidra 真正的護城河（可解釋、有證據等級、Deterministic）錯位，容易被理解成「貴是因為量大」而不是「貴是因為精準」。

改用 **Rule Package（套件）** 做切分，正好對齊第 3.7 節已經設計好的資料結構（`package` / `tier` 欄位），不用另外想差異化維度。

### 2.2 分級架構

| | Free | Pro（US$20/月，或年費方案） | Enterprise |
|---|---|---|---|
| Rule Package | `base_rules`（恢復／睡眠／HRV／訓練負荷） | `base` + 專項套件（running / strength / triathlon 等，依實際開發進度上架） | 全部套件 + 客製 Rule |
| Explainability | 基本 reason 文字 | 完整 Rule Trace（Rule ID + Evidence + Source + Version） | 同 Pro + 稽核紀錄匯出 |
| Conflict Resolver | 有（核心引擎邏輯不分級，所有 tier 都是同一套 Deterministic Engine） | 同 Free | 同 Free |
| Rule 更新頻率 | 季更 | 即時跟進文獻更新 | 客製審查週期 |
| 部署 | 個人 `.mcpb` | 個人 `.mcpb` | Team License / Internal Deployment，可完全離線 |

**關鍵原則：Conflict Resolver、Evidence Quality/Coverage Engine 這些核心決策邏輯不分級。** 分級的是「你能用哪些 Rule 套件」跟「你能看到多完整的 Explainability」，而不是「決策準不準」——這樣才不會讓 Free 版使用者覺得自己拿到的是「打折的決策」，這對信任感很重要，尤其對醫療/運動科學這種需要建立信任的產品。

### 2.3 定價落點

US$20/月對照 AthleteData（MCP 版 US$9/月，AI Coach 版 US$25-39/月），落在合理偏保守的位置——Evidra 沒有 Dashboard、沒有 Coaching UX，純粹賣決策引擎，這個定價可以接受，重點是 Free tier 要好用到讓人想升級，而不是定價數字本身。

### 2.4 訂閱制與「完全離線」定位的張力，及建議解法

月費訂閱隱含「要定期驗證授權」，這跟 `.mcpb` 的核心賣點「不用連網」有觀感上的矛盾，尤其對你的目標客群（醫療、運動隊、重視隱私的個人）而言，訂閱制容易讓人聯想到「SaaS 隨時可能斷線鎖死」。建議：

- **個人 Pro：** 可以維持訂閱制，但要在文案上明確拆開「授權驗證」跟「資料外流」是兩件事——例如「授權驗證約每 30 天需連網一次，Evidence 與決策資料本身完全不上傳」
- **或改成年費／買斷制：** 比照桌面軟體慣例（例如 US$180/年 而非 US$20/月），使用者對「桌面軟體年費」的接受度通常高於「桌面軟體月費」
- **Enterprise：** 不做訂閱制驗證，改成年約 + 完全離線的 license file——這正是企業客戶願意多付錢買的東西

授權驗證機制本身（金鑰驗證 vs 定期連線 vs 加密套件）仍是待決的技術問題，見第 7 節風險清單第 6 點。

### 2.5 Rule Package 上架順序建議

對齊第 6 節開發階段路線圖，Rule Package 上架順序建議：

1. `base_rules`（Free，Phase 1 就要有，涵蓋恢復/睡眠/HRV/訓練負荷）
2. 依你自己最熟悉、或最多既有使用者需求的運動類型，優先做 1-2 個專項套件（例如 `running_rules`）作為 Pro 版上線時的第一個差異化賣點，不用一次把 running/strength/triathlon/older_adult/acl_rehab 全部做完
3. 其餘套件依市場回饋逐步擴充——這也呼應 Phase 3「用質化訪談代替統計數據學習」的策略，先做一個套件深、驗證市場反應，再擴橫向

---

## 3. 資料模型設計

### 3.1 Canonical Signal（中介語言，解決 Vendor Lock-in）

```yaml
canonical_signal: RecoveryState
maps_from:
  - vendor: Garmin
    field: Training Readiness
  - vendor: WHOOP
    field: Recovery
  - vendor: Oura
    field: Readiness Score
  - vendor: Polar
    field: Nightly Recharge
value_type: enum [Low, Moderate, High]
```

```yaml
canonical_signal: HRVTrend
maps_from:
  - vendor: Apple
    field: HRV (SDNN)
  - vendor: Garmin
    field: HRV Status
value_type: percentage_change_from_baseline
```

### 3.2 Evidence Quality Record（Layer 1，每個 signal 都要有）

不是所有 Evidence 都等值可信，來源、時效、量測方式都會影響可信度：

```yaml
signal: autonomic_state
value: low
source: Apple
timestamp: "2026-08-04T06:00:00+08:00"
quality: 0.94        # 依來源可靠度、量測方式打分
age_hours: 12
```

Coverage 與 Quality 是兩個獨立維度：Coverage 回答「有沒有這個資料」，Quality 回答「這個資料有多可信」。兩者都會回饋到最終 Decision 的 confidence 計算。

### 3.3 Rule Schema（核心 IP，需嚴格版控）

```yaml
rule_id: EX-042
version: 1.3
title: Reduce Intensity after Recovery Decline
trigger:
  autonomic_state: low
  sleep_quality: poor
  RPE_previous: ">= 8"
decision:
  replace_with: Zone2
reason: Recovery insufficient
priority: 85          # 用於 Layer 4 Conflict Resolver 仲裁
package: base          # 對應 Rule Package：base / running / strength / triathlon / older_adult / acl_rehab
tier: free             # free / pro / enterprise，決定哪個授權等級可使用這條 Rule
evidence_level: Systematic Review   # Guideline > Position Stand > Systematic Review > RCT > Expert Consensus > Internal Outcome
sources:
  - ACSM 2024
  - ISSN Position Stand
  - Seiler 2019
confidence: 0.93
last_review: 2026-01-01
reviewer: Exercise Science Board
status: active   # draft / active / deprecated
```

### 3.4 Conflict Resolution：Priority Matrix（Layer 4）

當多條 Rule 同時觸發、結論互相衝突時（例如「該降低強度」vs「維持課表」），不靠 LLM 臨場判斷，而是固定的優先序：

```
Injury > Illness > Recovery > Training Goal > Preference
```

實作上每條 Rule 除了自己的 `priority` 數值，也要標註屬於哪個仲裁類別（Injury / Illness / Recovery / Training Goal / Preference），Conflict Resolver 先比類別、同類別再比 priority 數值。

### 3.5 Decision Case（案例庫，累積 Decision Corpus）

```yaml
case_id: CASE-000123
evidence:
  sleep_hours: 5.2
  HRV_change: -18%
  RPE_yesterday: 9
  soreness: quadriceps
scheduled: "6x1km Threshold"
decision: "40min Zone2"
rule_applied: EX-042
evidence_coverage: 0.87
missing_signals: [nutrition, hydration, DOMS]
confidence: 0.82
```

### 3.6 Outcome Record（Learning Layer 用）

```yaml
outcome_id: OUT-000456
case_id: CASE-000123
outcome_observed_at: "+3 days"
result: improved   # improved / neutral / adverse
notes: "HRV rebounded to baseline"
triggers_rule_review: false
```

### 3.7 Rule Package（更新與商業分級單位）

Rule 更新不需要更新 Decision Engine 本身——就像防毒軟體「病毒碼」跟「掃毒引擎」分開：Engine 穩定不動，Rule Package 定期下載更新。

```yaml
package_id: base
version: 1.4
rule_ids: [EX-001, EX-002, ..., EX-030]
tier: free
last_updated: 2026-08-01
```

未來 Rule Package 可以依運動類型/族群拆分成獨立套件（形成 Rule Marketplace 的基礎）：

```
base_rules        （free，涵蓋恢復/睡眠/HRV/訓練負荷基本邏輯）
running_rules
strength_rules
triathlon_rules
older_adult_rules
acl_rehab_rules
```

每個套件都是獨立版控、獨立審查、獨立定價的單位。這也代表 Layer 8（Knowledge Governance）的審查流程要能對應到「套件」而非只對應到單條 Rule，方便未來授權特定套件給特定客群（例如只把 ACL Rehab Rules 授權給復健診所）。

#### 3.7.1 邊界：Rule Package 裝什麼、不裝什麼

Rule Package **只包含 Rule Library 治理流程跑完之後的「結果」**，不包含 Rule Governance 的「過程」：

| 資料類型 | 例子 | 是否進 Rule Package |
|---|---|---|
| Rule 可執行內容 | `condition`/`trigger`、`decision`、`priority` | ✅ 要——Decision Engine 執行時的必要輸入 |
| Explainability 溯源資訊 | `evidence_level`、`sources`、`confidence`、`version`、`last_review`、`reviewer` | ✅ 要——Layer 6 Explainability 在本機執行，`explain_decision` 需要這些欄位才能當場解釋決策依據 |
| 治理過程中間產物 | Rule Draft 歷次修改稿、Exercise Scientist Board 內部討論紀錄、被否決的候選規則、Regression Test 原始測試資料與 log、文獻篩選的完整工作過程 | ❌ 不要——留在內部（git repo / 內部資料庫），不隨 `.mcpb` 或 Rule Package 送到使用者端 |

原則：**使用者拿到的是「治理流程跑完之後的結果 + 結果的溯源標籤」，拿不到「治理流程是怎麼跑的」。** 這條邊界也是第 8 節 IP 保護範圍的前提——就算 Rule Package 加密被破解，外洩的頂多是已核准規則的內容，不會連帶洩漏內部治理方法論、審查紀錄或文獻篩選過程。

---

## 4. Rule Governance 流程（Evidence Governance）

證據等級由高到低：

1. **國際指南**（ACSM、NSCA、AHA、ESC、ISSN）— Confidence: High，幾乎不需質疑
2. **Position Stand**（多位研究者共同撰寫）
3. **Systematic Review / Meta-analysis**
4. **RCT** — Confidence: Medium
5. **專家共識**（IOC、USOPC、AIS）
6. **內部 Outcome Data**（自己累積的實證，長期而言可能比單篇論文更有價值）

**Rule 生命週期：**

```
文獻更新 / Outcome 異常
        ↓
   Rule Draft
        ↓
Exercise Scientist Review
        ↓
   Regression Test（用既有 Decision Corpus 回測，確保不破壞既有正確決策）
        ↓
   Release（version bump）
```

關鍵原則：**LLM 不自己決定新規則**，只協助（a）從文獻中萃取候選 Rule 草稿、（b）解釋既有 Rule 給使用者聽。核准與版控是人工流程。

---

## 5. MCP Tool 對應現況架構

把你既有的 Evidra tools 對應進九層架構，找出目前缺口：

| 既有 Tool | 對應層級 | 現況對應到架構的缺口 |
|---|---|---|
| `assess_fitness_state` | Layer 0-2（Canonical Model / Quality / Coverage） | 需確認是否已用 Canonical Signal，而非直接暴露 vendor 欄位；回傳值應同時附上 quality 與 coverage，不只是單一分數 |
| `decide_session` | Layer 3-5（Rule Library → Conflict Resolver → Decision Engine） | **這是 Rule Engine 的主要出口** — 需要接上 Rule Library，且遇到多條 Rule 衝突時要能透過 Priority Matrix（Layer 4）仲裁，而非目前可能的 prompt-based 判斷 |
| `decide_exercise_substitution` | Layer 3-5 子模組 | 同上，應該引用具體 Rule ID（如 EX-042 的替換邏輯），且替換動作本身可能觸發 Conflict Resolver（例如 Injury 類 Rule 優先於 Training Goal 類 Rule） |
| `generate_plan` | Layer 3-5（多步驟決策） | 需要串連多條 Rule 的組合輸出，並保留 Decision Graph 可追溯性；多日課表中若不同天觸發不同優先類別的 Rule，仲裁邏輯要一致 |
| `preview_adjust_plan` / `commit_adjust_plan` | Layer 5 執行面 | 需確保 preview 階段就回傳 Rule Trace（Layer 6），讓使用者/呼叫端能先看到解釋再 commit |

**建議新增的 Tool（目前架構中還沒有對應）：**

- `explain_decision(decision_id)` — 對應 Layer 6，回傳完整 Rule Trace（Decision → Rule → Evidence → Source → Version）
- `get_evidence_coverage(user_context)` — 對應 Layer 1-2，回傳目前輸入的 Evidence Quality/Coverage 分數與缺失項目
- `submit_outcome(case_id, outcome)` — 對應 Layer 7，讓上游應用回報結果，累積 Outcome Database（即使初期是手動或半自動也要先有介面）
- `resolve_conflict(triggered_rules)`（內部用，不一定要對外暴露）— 對應 Layer 4，輸入多條同時觸發的 Rule，輸出仲裁後的最終決策與仲裁理由

---

## 6. 開發階段路線圖

### Phase 0（現況延伸，2-4 週）— 打穩地基
- [ ] 盤點 `decide_session` / `decide_exercise_substitution` 目前的判斷邏輯是 prompt-based 還是已有結構化 Rule；若是前者，優先重構成 Rule Schema
- [ ] 定義 5-10 個最高頻情境的 Canonical Signal（HRV Trend、Recovery State、Sleep Quality、RPE、Soreness Location）
- [ ] 把現有邏輯改寫成 3-5 條正式 Rule（照 3.3 Rule Schema），標註 evidence_level 與 source（即使初期是「Internal / Expert Consensus」也要標）

### Phase 1（1-2 個月）— `.mcpb` MVP + Rule Library 基礎
- [ ] 建立 Rule 儲存（YAML/JSON + git 版控，本機讀取，不用資料庫）
- [ ] 定義 Priority Matrix 的仲裁類別（Injury / Illness / Recovery / Training Goal / Preference），為每條既有 Rule 標上類別與 priority 數值
- [ ] 實作最小可用的 Conflict Resolver：輸入多條觸發 Rule，先比類別、同類別比 priority
- [ ] 實作 `explain_decision` tool，讓每個 `decide_session` 輸出都能回溯 Rule ID + Evidence + 仲裁理由（若有衝突）
- [ ] 建立 Evidence Quality + Coverage 計算邏輯，`decide_session` 回傳時附帶 confidence 分數
- [ ] 累積前 100-500 筆 Decision Case（用自己的訓練資料先跑，建立 Decision Corpus 雛形，全部存在本機）
- [ ] **封裝成 `.mcpb`**：確認 Decision Engine + Rule Library 打包後能在 Claude Desktop 本機安裝、離線運作
- [ ] 定義 Free tier 範圍（例如 3 個 tool、只含 `base` Rule Package）與 Pro/Enterprise 的功能邊界，Rule schema 的 `tier` 欄位對應到實際的授權檢查邏輯（見風險章節的授權機制待決）

### Phase 2（2-3 個月）— Rule Package 化 + Governance 流程落地
- [ ] 把 Rule Library 拆成 `base_rules` 套件，定義未來 `running_rules`、`strength_rules` 等套件的邊界（即使還沒寫，先把資料結構切好）
- [ ] 實作 Rule Package 更新機制：使用者能手動或半自動下載新版 Rule Package（初期可以只是「重新安裝 .mcpb 或匯入新的 rule package 檔案」，不用做成自動更新服務）
- [ ] 設計 Rule Review 的人工審核流程（哪怕現階段審核者只有你自己，也要走完整流程並記錄）
- [ ] 從 PubMed / ACSM / ISSN 挑 5-10 篇關鍵文獻，把 Phase 1 的內部 Rule 逐步升級 evidence_level（從 Expert Consensus → Systematic Review 等）
- [ ] Regression Test：建立一組「已知正確答案」的 Decision Case 集合，每次 Rule 更新前跑一次，避免改壞
- [ ] Decision Graph 視覺化（至少內部工具能看，方便你自己 debug）

### Phase 3（3-6 個月）— 擴充與獲取早期使用者
- [ ] Rule Library 擴充到 30-50 條，涵蓋主要訓練情境（強度調整、傷後替代、恢復不足、過度訓練預警等）
- [ ] 針對重視隱私的目標客群（醫療、運動隊、企業、重視隱私的個人）做早期推廣，把「Evidence 不離開你的電腦」作為主要銷售論點
- [ ] 收集質化回饋（既然沒有集中 Outcome Database，Phase 3 階段的學習主要靠直接跟早期使用者訪談，而非統計數據）
- [ ] 評估是否加入**選擇性、明確 opt-in 的匿名 Outcome 回報**——使用者可以選擇「只上傳 Decision + Outcome 結果（不含原始 Evidence）」來幫助改進 Rule，但預設關閉，且要非常清楚說明上傳的是什麼、不是什麼

### Phase 4（累積 1000+ 使用者後）— Evidra Cloud 作為「加值」而非取代
- [ ] 推出 Evidra Cloud，明確定位成「附加選項」：Rule Sync（自動更新 Rule Package）、Team License、Analytics、集中 Outcome Learning
- [ ] `.mcpb` 本機版持續存在且功能完整，不因為 Cloud 版上線而被閹割——這是維持「Local-first」定位可信度的關鍵
- [ ] 若要進 Claude Connector Directory（遠端 MCP），此時再處理 OAuth 2.1 + PKCE；這是 Cloud 版才需要的東西，不是 `.mcpb` 版的必要條件
- [ ] Outcome 累積到能做初步統計後，評估 B2B（對接其他 AI Coach / Gym SaaS / 保險健康平台）的 Cloud API 商業模式，作為 `.mcpb` 之外的第二條產品線，而非取代

---

## 7. 關鍵風險與待決策事項

1. **Rule 從哪裡起步？** 初期 Rule 大概率是你自己的經驗 + 少量文獻，evidence_level 誠實標成「Expert Consensus / Internal」即可，不要一開始就自稱 Guideline 等級——這件事本身也是 Evidence Governance 的誠信原則。
2. **Outcome Learning 會變慢，這是本機優先的已知代價：** 沒有 Server，就沒有集中的 Usage/Outcome 數據，Layer 7 短期內幾乎是空的。這不算意外，是選擇 `.mcpb` 優先必然要接受的取捨——建議把「Learning 慢」明確定位成 Phase 1-3 的已知限制，而不是要在這個階段硬解決的問題；真正的解法是 Phase 4 的 opt-in Cloud Outcome Sync。
3. **LLM 的角色邊界：** 要明確界定 LLM 只做「自然語言輸入解析」與「Rule Trace 的口語化表達」，決策邏輯本身必須是 Rule Engine（deterministic）算出來的——這是 Evidra 和「另一個 AI Coach」的分水嶺，架構上要從一開始就把這條線劃清楚，避免之後為了方便直接讓 LLM 生成決策。
4. **Conflict Resolver 的 Priority Matrix 需要及早定案：** Rule 數量少的時候（<10 條）衝突機率低，容易忽略這塊；但一旦 Rule Library 擴充到 30-50 條，沒有明確仲裁機制會讓決策變得不可預期。建議在 Phase 1 就先把 Injury > Illness > Recovery > Training Goal > Preference 這個類別體系定案，之後只需要幫新 Rule 分類別，不用重新設計仲裁邏輯。
5. **Rule Engine 選型：** 初期不建議自建規則引擎，用簡單的 condition-matching（YAML 讀進來轉成 Python dict 比對）就夠用；等 Rule 數量成長到需要更複雜的組合邏輯（例如多條件加權、模糊匹配）再考慮導入正式的 Rule Engine 框架，避免一開始就過度工程化。
6. **本機版的授權機制：已定案，見第 8 節。** License Token 採 Ed25519 簽章、離線可驗證，搭配 Machine Fingerprint 綁定；訂閱制與離線承諾的張力用「授權驗證」與「資料外流」分開說明來處理。
7. **`.mcpb` 更新機制：已查證官方文件，見第 8 節。** 官方目錄、Team/Enterprise 自訂擴充、個人側載三種情境的更新方式不同，個人版（Free/Pro 主力客群）目前沒有內建自動更新，因此 Rule Package 更新機制設計成獨立於 `.mcpb` 版本，由 Decision Engine 內部自行處理。

---

## 8. IP 保護與更新機制

### 8.1 範圍界定：只做三項，不做 Cloud Offloading

評估過 Binary Compilation、Obfuscation、Cloud Offloading（核心邏輯搬雲端）三個方向後，**確定不做 Cloud Offloading**——把 Decision Engine 搬到雲端雖然技術上最安全，但直接抵觸 Phase 1「`.mcpb` 本機優先」的定位，尤其會排除掉 Enterprise 目標客群（醫療、運動隊、企業合規要求資料不得離開內網/air-gapped 環境）。真正投入的三項：

| 保護對象 | 做法 | 實作工具 |
|---|---|---|
| Rule Package 內容 | **加密** | AES-256-GCM，金鑰用 HKDF/scrypt 從 License Token secret + Machine Fingerprint + App salt 衍生，執行時才在記憶體解密，不落地明文 |
| Decision Engine 核心邏輯 | **編譯成原生機器碼** | Python：Nuitka `--standalone --onefile`（不用 PyInstaller，那只是打包直譯器，仍可被 `pyinstxtractor` + `decompyle3` 還原成接近原始碼）；Node/TS：Bun compile 或 Node 20+ 內建 SEA |
| 編譯產物本身 | **混淆** | 疊加在編譯結果上：Node 端用 javascript-obfuscator；Python 端 Nuitka 編出的機器碼已經不需要額外混淆層 |

**投資報酬率排序：** Rule Package 加密 > License/Engine 保護，因為 Rule Library 內容才是真正的資產（見 3.7.1 節的邊界界定），Decision Engine 的比對邏輯本身即使被看穿，重寫難度也遠低於重建一份有審查、有溯源的 Rule Library。

### 8.2 License Token（離線可驗證，支撐第 2 節分級與第 8.1 節的金鑰衍生）

- 非對稱簽章用 **Ed25519**：私鑰留在授權伺服器，App 只內嵌公鑰（外洩也無妨，只能驗證不能簽發）
- 付款成功（Stripe webhook）後由後端簽發 token，內含 `license_id`、`tier`、`packages`、`machine_fingerprint`、`issued_at`、`expires_at`（建議 30-35 天效期）
- App 端驗證完全離線，只在快過期前（例如剩 3 天）才連網換新 token；斷網超過寬限期則優雅降級回 Free tier，**不直接鎖死整個軟體**
- Token 儲存用 OS 原生憑證系統（Python：`keyring` 套件），不存明碼檔案
- Machine Fingerprint 用 `py-machineid` / `node-machine-id` 取得穩定機器 GUID，避免自己土炮讀硬碟序號

### 8.3 Rule Package 更新機制：獨立於 `.mcpb` 版本

查證 Anthropic 官方文件後確認：`.mcpb` 的更新支援分三種情境，差異很大：

| 安裝情境 | 更新方式 |
|---|---|
| 上架官方 Extension Directory | Claude Desktop 原生自動更新，不用自己處理 |
| Team/Enterprise 自訂擴充功能 | 管理員修改 manifest.json 版本號即可推送更新給團隊，不需重新安裝 |
| 個人側載（Free/Pro 主力客群走這條路） | **目前沒有內建自動更新機制**，使用者要手動重新下載安裝 |

因此 **Rule Package 更新不能依賴 `.mcpb` 本身的更新機制**，改成 Decision Engine 內建的獨立更新模組，跟 `.mcpb` 版本脫鉤：

```
Evidra.mcpb（很少更新，只在 Decision Engine 邏輯改變/修 bug 時才需要）
      │
      ├── Decision Engine（binary，見 8.1）
      │
      └── Rule Package Updater（Decision Engine 內部模組）
              │
              ├── 啟動時 / 每 24-48hr：呼叫輕量 API 檢查最新 Rule Package 版本
              │     GET /rule-packages/latest?tier=pro&packages=base,running
              ├── 有新版：下載加密的 rules.bin（沿用 8.1 的加密機制）
              ├── 驗證簽章（同 8.2 的 Ed25519）
              ├── 覆寫本機 rules.bin
              └── 離線或檢查失敗：沿用本機既有版本，不阻擋正常運作
```

**Decision Engine 本身（`.mcpb` 重新打包）的更新頻率應壓到最低**，只在 Engine 邏輯真的變動（新增 Layer、修 bug）時才需要；個人版使用者透過 App 內「有新版本」提示自行下載，Team/Enterprise 客戶則走管理員推送。這樣 Rule Package 可以維持高頻更新（病毒碼式），Decision Engine 保持低頻更新（穩定不動），兩者更新節奏解耦。

---

## 9. 一句話總結給自己

> Evidra 賣的不是「AI 建議」，而是「可以被追溯到 ACSM 指南第幾條、哪篇 Meta-analysis、哪個 Rule 版本」的訓練決策，而且這個決策現在完全在使用者的電腦上完成，不需要她/他問「我的健康資料會不會被你們保存」。技術上先讓 `decide_session` 從 prompt-based 變成 Rule-Engine-based，並把它跟 `.mcpb` 封裝層徹底解耦，就是這整個計畫最關鍵的第一步——這樣 Phase 1 做的每一件事，未來不管走 Cloud 還是繼續 Local-first，都不會被丟掉重來。
