# Pacevera 產品策略與下一階段開發規劃

> 更新：2026-08-12
>
> 本文件把現有的 `product-spec.md`、`design-manifesto.md`、`user-journey.html`
> 與 implementation plan 轉成產品決策稿。它不取代工程 roadmap；它回答的是：先服務誰、
> 先解哪個問題、什麼叫做隱私承諾成立，以及 pacevera.com 應該如何把產品講清楚。

## 審查更新（2026-08-10）

本次以目前 repository 實作與測試結果校正文案，而不是只沿用原先 roadmap 的假設：

- Decision Trace Registry 已全面接入四個原先列為待完成的工具：
  `decide_exercise_substitution`、`generate_plan`、`preview_adjust_plan`、
  `commit_adjust_plan`。它們共用同一個 `decisionRecords` writer，均回傳
  `decisionId`／`decisionBasis`，並由 `explain_decision` 回查統一的
  Decision → Rule → Evidence → Source → Version trace。
- 目前 registry 仍是 process-local、bounded／TTL store；這代表 P2 的 trace
  契約已完成，但 durable adapter、user-controlled private engine 與跨重啟持久化
  仍屬後續工作，不能因此宣稱已完成 P1 或 private data plane。
- 因此，本次已完成的工程項目不是再次接入 Decision Trace，而是
  **R0 — Rule Package boundary**：把現有 Rule Library 封裝成可驗證、可相容性檢查的
  `base_rules` package，並保留 `running_rules`、`strength_rules` 的邊界。下一步是 R1
  的本機更新／審核流程；rollback 屬 R1，尚未完成。

## 一句話定位

**Pacevera 讓你用自己熟悉的 AI，根據你持續累積的身體證據，做出今天可執行、可解釋的訓練決策；原始 Evidence 保留在你控制的裝置或環境裡。**

對外主標可用：

> **Your AI coach can know how you are today—without your health history leaving your computer.**

中文核心論點：

> **Evidence 不離開你的電腦。AI 負責理解與對話，Pacevera 負責在你的資料邊界內，把連續的身體狀態轉成今天的決策。**

「不離開你的電腦」必須只用在真正 user-controlled 的部署形態。Remote hosted MCP 可以讓手機 AI 使用，但若原始或最小化 Evidence 傳到 Pacevera 雲端，就不能把它描述成同一個隱私承諾。

對外精準定位固定為：

> **The decision layer for adaptive training.**
>
> **Turn your planned workout into the right workout for today.**

中文表述：

> **保留你熟悉的 AI coach，補上一層可追溯的訓練決策。**

這個定位是產品邊界，不是單純的 marketing 文案。Pacevera 不取代 AthleteSpace、TrainState 或其他 AI coach app，而是提供一層可嵌入的決策能力，讓不同 AI host、教練軟體或企業系統共用同一套 Evidence、規則與決策紀錄。

## 競品與 Decision Layer 差異

| 產品 | 定位 | 主要產品單位 | 與 Pacevera 的關係 |
|---|---|---|---|
| AthleteSpace | 面向耐力運動員的完整 AI training platform | 自適應訓練計畫、session、賽事與 performance analytics | 直接幫 athlete 安排、調整與執行訓練的 AI coach app |
| TrainState | 面向 athlete 的 AI performance coaching app | readiness、HRV／睡眠／training load insight 與每日訓練建議 | 直接把穿戴資料轉成 coaching insight 與 workout recommendation |
| Pacevera | Adaptive training 的 decision layer／fitness decision engine | 一次可追溯的 training decision | 讓任何 AI coach 根據可追溯、可控的資料做出一致決策的 engine |

核心差異不是「Pacevera 也有一個 readiness score」，而是產品單位從 insight／score 變成一次可追溯的 training decision。核心輸出固定為：

```text
keep / adjust / substitute / defer / advance
scheduled workout (from) → resulting workout (to)
```

Decision Layer 必須讓使用者與整合方看見：

- 同一份 Evidence、規則版本與輸入，應產生相同的結構化結果；
- 哪些 Rule 被觸發、哪些 Rule 被 suppressed，以及最後如何仲裁；
- 使用了哪些 Evidence、時間窗與來源，哪些訊號缺失或過期；
- 為何原定課表從 `from` 變成今日的 `to`，以及使用者是否採用、結果如何。

因此 Pacevera 的核心差異化固定為 **decision provenance、privacy boundary、AI-host independence、可嵌入性**。網站或 demo 仍必須用一個簡單的使用者入口呈現價值：**原定課表 → 今日調整後課表**；不能只展示抽象分數、資料整合數量或 AI 對話。
## 明確不做的事情

- 不做另一個 readiness／recovery dashboard。
- 不以「AI 會替你規劃一切」作為主要承諾。
- 不把 connector 數量當作產品價值。
- 不把 hosted remote 或尚未完成的 connector 說成目前已可用。
- 不建立一個要求使用者交出完整健康歷史的集中式產品。

## 對首頁架構的影響

公司首頁採用 `Home / Product / Solutions / Privacy / About / Contact`；`user-journey.html` 改定位為 Product 底下的深度案例頁，而不是公司首頁。

首頁的 Hero 應先講清楚「decision layer」與 `from → to`，接著展示一個具體案例，再分別說明 AI host、coach workflow 與 private deployment。readiness、training load 與 recovery 只作為 Evidence 的輸入，不作為首頁主角。

## 用戶真正要買的是什麼

用戶不是在買另一個健康資料 dashboard，也不是在買一個會背運動知識的聊天機器人。他們要的是：

1. **今天能不能照原課表做？**
2. **如果不能，具體改成什麼？**
3. **這個改動是根據哪些新鮮訊號？缺了什麼？**
4. **換 AI、換對話視窗、換裝置後，對「我」的理解不要歸零。**
5. **健康歷史不要變成 Pacevera、AI 平台或第三方的資料資產。**

Pacevera 的核心流程固定為：

```text
Evidence → State → Decision → Action → Outcome
```

產品單位不是回答，而是這條可持續回饋的決策鏈：

```text
原始來源 → Evidence → State → 今日 Decision → Action from → to → Outcome
```

其中 AI host（ChatGPT、Claude、Gemini 等）負責理解問題、選工具與把結果講成人話；Pacevera 負責標準化、縱向計算、規則仲裁與可追溯輸出。這是「換模型不會讓理解歸零」的核心。

## 目標客群與切入順序

| 優先 | 客群 | 第一個高價值情境 | 為什麼先／後 |
|---|---|---|---|
| 1 | 重視隱私的個人運動者 | 「我今天該照課表做嗎？」；睡眠、HRV、近期負荷只在自己的電腦處理 | 最短 feedback loop，能直接使用 Claude Desktop／本機 MCPB 驗證產品價值 |
| 2 | 個人教練與小型訓練團隊 | 教練與 AI 共用一致的 Evidence 與 decision trace，但不把運動員原始資料上傳 SaaS | 付費意願與痛點清楚，可驗證多人／多角色權限需求 |
| 3 | 運動隊與高績效團隊 | 每位運動員的資料留在隊方 VPC，教練只看到必要的狀態與決策 | 高價值，但需要 roster、權限、稽核、資料隔離與部署支援 |
| 4 | 醫療／復健合作場景 | 在明確同意與醫療流程內提供訓練負荷／恢復證據摘要 | 風險、法規與責任邊界最高；先做 wellness／training，不先宣稱醫療診斷 |

第一個 beachhead 建議是「privacy-conscious serious athlete」：不是泛用健身大眾，而是已經有 Apple Health、Garmin 或相近穿戴資料，也已經在使用 AI，且不願再把資料搬進另一個平台的人。

## 使用者旅程

### A. 現在可交付：桌面本機版

```text
安裝 Pacevera Desktop MCP
  ↓
使用者選擇本機 Evidence 來源／匯出資料／手動補齊課表
  ↓
Claude Desktop（或其他支援本機 MCP 的 host）提出工具呼叫
  ↓
Pacevera 在本機計算 readiness、負荷、疲勞與規則
  ↓
回傳 Decision / Action / Reason / signalCoverage
  ↓
AI 用自然語言回答，使用者決定是否採用
```

首次成功（activation）應定義為：**使用者在 10 分鐘內完成一次「原本課表 → 今天調整後課表」的可追溯決策，並能看見哪些 Evidence 沒有離開本機。**

### B. 下一個核心版本：本機 private data plane

這是「Evidence 不離開你的電腦」真正完整的產品版本：

```text
Apple Health / Google Health / Garmin Connect
  ↓ 使用者明確授權
本機 connector / private gateway
  ├─ token 與原始資料只在使用者控制的環境
  ├─ normalized evidence、縱向 history、plan 存在本機
  ├─ Pacevera deterministic engine
  └─ local MCP server
  ↓
AI host 只拿到完成當次問題所需的最小化結果
```

這裡要把「授權 AI app 存取健康資料」改成更精確的體驗：**使用者授權本機 connector，AI 只透過 MCP 請求必要的計算結果。** 不應讓每個模型各自持有 Apple／Google／Garmin refresh token，也不應讓 Pacevera hosted service 代替使用者保存這些 token。

### C. 手機 AI：Remote MCP 是接觸面，不是隱私核心

手機上的 Claude／ChatGPT 通常不能直接連使用者電腦的 stdio server，因此需要其中一種路徑：

- **受控 tunnel 到使用者本機 private engine**：資料與計算留在本機，網路只提供受控入口；需端到端加密、裝置配對、短期 token、撤銷、重播防護與清楚的連線狀態。
- **企業私有部署**：Pacevera engine 跑在隊方／醫療機構的 VPC，手機 host 連私有 endpoint；適合 B2B。
- **Pacevera hosted Remote MCP**：作為低門檻手機路徑，但只可承諾「最小化 Evidence、transient processing、不留存」，不能承諾「Evidence 不離開你的電腦」。

MCP `2026-07-28` 的 stateless HTTP 對 remote scaling 有幫助，但它解決的是 transport／session，不是資料主權。Remote MCP 是否開工，應排在 local private engine 的產品契約之後，而不是反過來。

## 產品對齊與 Phase Review Gate

本文件是每次新功能開發、phase review、release review 與網站文案 review 的產品對齊基準。任何工作在進入實作前與完成 review 時，都必須回答以下問題；若無法回答，功能不得被描述為 Pacevera 的核心能力：

1. 這項功能服務的是 `Evidence → State → Decision → Action → Outcome` 哪一段？是否讓完整流程更可用，而不是新增孤立的 dashboard、score 或 chatbot 能力？
2. 它是否強化「一次可追溯的 training decision」與 `from → to` 輸出？若只是新增 insight／score，必須說明它如何影響或解釋 Decision。
3. 同一份 Evidence、輸入、Engine／Rule 版本是否能重現相同的結構化結果？是否保留 Rule、Evidence、source、version、missing signal 與 confidence trace？
4. 它是否維持 privacy boundary、AI-host independence 與可嵌入性？是否不必要地把 Pacevera 變成另一個 AI coach app、資料倉庫或泛用 fitness dashboard？
5. 使用者是否能在簡單情境中看懂「原定課表 → 今日調整後課表」，並知道是否採用及後續 Outcome？

Phase review 必須留下：對齊的產品問題、影響的流程節點、輸入／輸出契約、Decision provenance 變更、privacy mode 影響、成功指標，以及刻意不做的範圍。若功能改變 verdict、threshold、Rule precedence 或 from／to 行為，還必須走 Rule Package／regression／human review gate；不能只更新測試 fingerprint。

## 下一階段開發優先序

### P0 — 把隱私承諾變成可驗證的產品契約

目標：讓使用者能回答「資料在哪裡、誰看得到、如何刪除、AI 拿到什麼」。

- 定義三種 deployment mode：`local-desktop`、`user-controlled-private`、`hosted-remote`。
- 每種 mode 明確列出資料流、儲存位置、token 所在、log／telemetry 行為與刪除方式。
- 建立 `Evidence Boundary Report`：每次決策可顯示來源、freshness、傳入欄位、輸出欄位與缺失訊號。
- 補威脅模型與 acceptance tests：DNS rebinding、token 泄漏、log payload、未授權 connector、撤銷後仍可讀取。
- 對外文案禁止把 hosted remote 寫成「資料不離開你的電腦」。

完成標準：一個非工程使用者看 privacy screen 或文件，能在 60 秒內理解三種模式的差異；測試能證明 raw Evidence 未被意外寫入 hosted log／DB／trace。

### P1 — Local private engine MVP

目標：先完成核心護城河，不先做 marketplace 或漂亮 dashboard。

- 把 `packages/evidence`、connectors、semantic engine、decision engine、plan persistence 綁成可安裝的 local bundle／Docker image。
- 完成 SQLite 優先的 repository adapter；保留 Postgres adapter 給企業私有部署。
- 補 plan／planned workout migration，讓「今天原本排什麼」可以持續存在本機。
- 實作 connector permission scopes、token 加密儲存、撤銷與本機資料刪除。
- 第一批 connector 只做 Apple Health、Garmin、Google Health；Oura／WHOOP 先維持 parser readiness，不擴張表面支援。
- 保留 stdio 作為桌面預設；local HTTP 只 listen loopback，避免預設暴露區網。

完成標準：無 hosted MCP 時，三個關鍵情境能跑通：今日課表決策、睡眠／HRV 低下的降載、傷病限制下的動作替代；原始 Evidence、token、縱向 history 都只在 user-controlled environment。

### P2 — Evidence continuity 與模型切換體驗

目標：把「換模型不歸零」做成看得見的產品能力。

- 建立每日 `semantic_fitness_state` 與 state version；不把原始資料塞給 AI，而是讓引擎保留可重算的狀態與來源指標。
- 讓每次 Decision 帶 `stateId`、`evidenceWindow`、`engineVersion`、`ruleLibraryVersion` 與 `decisionBasis`。
- 提供「新 AI host 讀取我的 Pacevera context」的最小化 bootstrap，不讓 host 重新解析完整歷史。
- 讓使用者能查看、匯出、刪除自己的 state／plan／decision history。
- 做 cross-host conformance tests：同一份本機 state 由 Claude、ChatGPT、Gemini 呼叫時，決策結構一致，只有語言表達不同。

完成標準：換對話視窗／換 host 後，仍能針對同一人的連續狀態回答；任何數字都能追到來源、時間窗與規則版本。

#### P2：Decision Trace Registry 全面接入（已完成契約與目前實作）

所有對外 decision tool 現已回傳 `decisionId`，並透過同一個 registry writer 由
`explain_decision` 讀取統一的 Decision → Rule → Evidence → Source → Version trace。
四個 decision tool 都已完成接入，且已有 contract／rule-coverage／golden case 與
commit 關聯測試。`commit_adjust_plan` 沿用 preview trace，不重新計算；沒有 governing
rule 時也保存空的 rule 節點，明確表示「已評估但沒有規則觸發」。

目前保留的邊界：registry 預設為 process-local、最多 256 筆、TTL 15 分鐘；hosted
mode 仍維持 bounded／stateless。durable registry adapter、跨重啟保存、user ownership
與本機刪除／匯出體驗，應在 P1 local private engine 中實作，不能把目前記憶體 registry
誤寫成完整的 private history。

### P3 — 受控 mobile access（本機安全垂直切片已完成；production 仍 blocked）

目標：讓手機可用，但不犧牲 P0 的資料邊界。

- 先做 device pairing、短期 access token、明確「目前連到哪台裝置」與一鍵撤銷。
- 本 repository 已完成 process-local authorization-server adapter：一次性
  pairing code、audience-bound JWT、scope／expiry、refresh rotation、device
  unlink、access-token revocation 與 replay／log-redaction 測試。這是可測試的
  private-development slice，不是 hosted authorization service。
- 評估官方／標準化 tunnel 能否被所有目標 host 使用；不能就先把 mobile path 定位為 private VPC 或 hosted remote。
- 若開 hosted remote，仍須完成 production authorization server、JWKS／issuer／audience／scope、HTTPS、payload redaction、DPA 與新的 privacy policy。
- hosted remote 的 Phase 3 connector 可在使用者授權後讀取 Google Health API，取得後立即
  正規化為最小化 Evidence；不把 provider refresh token 或長期 raw health history 留在
  hosted Pacevera。`4175a1a` 的 `scripts/import-google-health-api.js` 仍是 desktop local
  importer，不是 hosted OAuth client。
- hosted Google connector 必須完成最小 scopes、token vault／rotation／revocation、raw
  response 與 normalized Evidence 的 retention／delete／export 邊界，以及 Google OAuth
  review、provider terms 與 privacy policy 審查。
- 用產品 UI 清楚標示：`Private local`、`Private deployment`、`Hosted transient`。

完成標準：使用者在連線前就知道資料是否離開本機；撤銷後既有 token 不能再呼叫；所有 mode 都有可重現的資料流測試。

### P4 — B2B 私有部署與團隊治理

目標：從個人隱私價值延伸到醫療／隊伍／企業的資料治理價值。

P4 的第一個工程切片是 **G0 — Governance contract**：先固定「誰能看哪位
athlete 的哪一層資料」與「稽核事件能記錄什麼」，再接入 SSO、VPC／on-prem
部署與 durable audit store。G0 不接受 caller 自己傳入的 tenant 作為信任來源，
也不把 raw Evidence 放入團隊輸出或 audit metadata。

- tenant／athlete isolation、角色權限、教練只看必要摘要、不預設看 raw payload。
- 私有 VPC／on-prem deployment、SSO、audit log、retention／deletion policy、資料區域選擇。
- 團隊層級只輸出 readiness／availability／decision summary，保留 athlete 的細節控制權。
- 提供 exportable decision trace，方便教練與醫療合作方審閱，但不變成醫療診斷系統。

G0 的角色與資料面契約：`athlete` 只能讀自己的 self scope；`coach`、`clinician`
與 `team_admin` 只能讀 verified principal 所列的 athlete scope，且團隊工具預設
只產生 readiness／availability／decision summary；`auditor` 只讀 trace／audit，
不讀 raw Evidence。每個 principal 必須帶 `tenant_id`、`sub`、`roles`，跨 tenant
或 scope 外的請求 fail closed。

G0 完成標準：policy contract tests 覆蓋 self／assigned athlete／cross-tenant／
role denial；team summary 不含 raw payload；audit event 固定記錄 tenant、actor、
action、resource、outcome，並對 token、claims、Evidence 與 health metrics 做
redaction。G0 完成後，G1 才把 verified principal 接到 MCP request context 與
SQLite／Postgres repository 的 row-level scope；G2 再做 SSO／SCIM、retention、
deletion 與部署控制面。

完成標準：一個隊伍能在自己的環境管理多位運動員，且任一角色的可見範圍都能被測試與稽核。

## 商業模式建議

先不要把 connector 數量或模型數量當主要計價單位；那會把 Pacevera 變成資料搬運工具。建議用三層驗證：

1. **個人本機版**：免費或低價，目標是安裝、首次決策、連續使用與跨 host 留存。價值指標是每週有多少次「原課表被證據改寫」以及使用者是否採納，而不是聊天次數。
2. **Private Pro**：按使用者／裝置或月活躍使用者計價，包含本機縱向 history、connector sync、decision trace 與 mobile pairing。按 MAU 比按 tool call 更符合成本與「可以放心多問」的行為。
3. **Team／Enterprise**：按 active athlete、private deployment、support／SLA 與治理能力計價；不要把隊員 raw data 變成 Pacevera 的集中資料庫。

在 Remote MCP 未完成授權、部署與合規前，不先承諾 marketplace 分潤、AI coach white-label 或按次 API 定價。先用 P0–P2 找到願意付費的 privacy outcome，再決定 remote 的商業包裝。

## pacevera.com 產品頁規劃

### 首頁資訊架構

1. **Hero**：The decision layer for adaptive training；用你熟悉的 AI，把原定課表變成今天適合你的課表。
2. **問題**：一般 AI 知道運動知識，但每個新視窗都重新理解你；身體狀態卻是連續的。
3. **一個真實情境**：原本 Tempo Run → 根據低 readiness／睡眠不足 → Moderate run；顯示 from → to、reason、觸發／被壓過的 Rule、缺少的訊號。
4. **Decision Layer**：AthleteSpace／TrainState 幫 athlete 直接安排與執行訓練；Pacevera 讓任何 AI coach 根據可追溯、可控資料做出一致的 training decision。
5. **How it works**：AI host、Pacevera Decision Layer、user-controlled Evidence 三段分工。
6. **Privacy modes**：清楚並列 Local desktop／Private deployment／Hosted remote，標示目前可用與未來路徑。
7. **護城河**：Evidence Model + Rule Library + Decision Graph；用一個例子說明換模型仍保留狀態與決策可追溯性。
8. **適合誰**：privacy-conscious athletes → coaches／teams → enterprise／clinical partners。
9. **現在能做什麼**：目前可用的 MCPB、支援的 host、三個範例 prompts、安裝入口。
10. **信任區**：資料流圖、privacy policy、source code／release、非醫療診斷聲明、聯絡方式。
11. **CTA**：`Install for Claude Desktop`、`Join private beta`、`Talk to us about team deployment`。

### 產品頁第一版文案草稿

> **Your AI coach should know how you are today—not own your health history.**
>
> Pacevera runs the fitness decision engine where your evidence lives. Connect the AI you already use, keep your health history under your control, and turn today’s scheduled session into a decision you can understand and act on.

Decision Layer 輔助文案：

> AthleteSpace and TrainState coach the athlete directly. Pacevera is the decision layer that lets any AI coach turn controlled evidence into a consistent, traceable training decision.

中文輔助文案：

> AI 已經知道運動知識；它不知道的是你這幾週的負荷、昨晚的睡眠，以及今天原本排了什麼。Pacevera 不搶走你的 AI，也不建立另一個健康資料庫。它把連續的 Evidence 轉成有依據的 `from → to` 決策。

### 網站製作順序

- **第一版**：先以現有 `user-journey.html` 作為敘事原型，補上三種 privacy mode、目前／未來界線、安裝 CTA 與一個互動式 from → to 案例。
- **第二版**：接上 pacevera.com 的註冊／waitlist，記錄來源客群、選擇的部署模式、使用的 AI host 與最想解決的問題；不要收集健康資料。
- **第三版**：有 3–5 個真實訪談後，再為個人、教練／隊伍、企業拆 landing page，不要一開始做四套品牌故事。

網站不應先放「Apple Health／Google Health／Garmin 已經能一鍵即時同步」這種尚未完成的承諾。現在應寫成「支援本機 Evidence workflow；private connectors／mobile access 正在開發」，並以可驗證的 release 狀態取代模糊的 roadmap marketing。

## 產品指標與 go／no-go

### P0–P2 的核心指標

- 10 分鐘內完成首次決策的比例
- 首次決策後 7 日內再次使用比例
- 每週有至少一次 `keep／adjust／substitute／defer／advance` 的比例
- 使用者查看 `reason`／`signalCoverage` 後仍採納決策的比例
- 換 host 後仍成功完成決策的比例
- privacy boundary test 的零違規率

### Remote MCP 開工條件

只有同時滿足以下條件才進入 remote production sprint：

- local/private engine 的資料契約與使用者旅程已被至少一批個人使用者驗證；
- authorization server、HTTPS、OAuth claims、scope、撤銷、log redaction 已有實作與測試；
- privacy policy 能精確區分 hosted transient processing 與 user-controlled processing；
- 目標 host 的實際接入與 mobile UX 已被端到端測試；
- 有明確客群願意為 mobile convenience 或 team private deployment 付費。

## 最終建議

下一個 sprint 不應先做 Remote MCP 的公開上線，也不應先做泛用產品 dashboard。應先完成 **P0 隱私契約 + P1 local private engine MVP**，再用 **P2 Evidence continuity** 把 Pacevera 的護城河變成可見體驗；Remote MCP 是 P3 的 access channel，B2B 私有部署是 P4 的商業化形態。

這條順序可以同時保住三件事：第一個使用者很快得到價值、核心隱私論點是真實可驗證的、而 Pacevera 的長期價值累積在「連續 Evidence → 可追溯 Decision」而不是任何單一 AI 平台的政策裡。

## Rule Package 化與 Governance（Phase 1 補強）

Rule Library 不是一包會隨產品版本一起任意變動的常數；它是會影響使用者決策的可審核產品資產。未來更新可以分別發生在三個層次：

| 層次 | 目前版本來源 | 允許改動 | 變更時必須重跑 |
|---|---|---|---|
| Decision Engine | `ENGINE_VERSION` | 條件評估、仲裁順序、效果合併、輸出契約 | 全部 regression／golden cases |
| Rule Package | `LIBRARY_VERSION` + package manifest | Rule、threshold、priority、evidence provenance | package validation、Decision Harness、golden cases |
| Distribution bundle | `.mcpb` manifest／artifact checksum | MCP server、文件、打包內容 | install smoke test、package-to-runtime check |

這三個版本必須在每次 `decide_session` 輸出中同時可見。更新 Rule Package 不應要求重新安裝 Decision Engine；更新 Engine 也不應偷偷替使用者換掉已核准的 Rule Package。

### 目前狀態與缺口

已具備的基礎：

- `packages/rules` 已將 rule data、parameter set、arbitration、decision basis 分開；目前可視為 Rule Library 的第一個實作。
- Rule 有 category／priority／evidence metadata，Decision 可回溯 governing rule 與仲裁理由。
- `ENGINE_VERSION`、`LIBRARY_VERSION`、package／MCPB 版本已是不同概念；Decision Harness 與 `review:phase` 的 G11 已能攔截未審核的決策漂移。

仍需補強的部分：

- 把現有 `packages/rules/data` 明確搬進 `base_rules` 套件邊界，並停止由 Engine 直接假設資料路徑。
- 建立 package manifest、checksum、相容性檢查與本機安裝／匯入流程。
- 把人工 Rule Review 變成有 request、review、decision、release record 的可追溯流程；單人審核也不能省略紀錄。
- 建立固定的 Decision Case corpus 與 Decision Graph debug viewer，讓每次 rule／engine 更新都有同一套驗證入口。
- 對 Phase 1 內部 Rule 建立 evidence packet，逐步把 `expert_consensus` 升級到有文獻支持的 evidence level；不得因為有文獻就擴大文獻原本沒有支持的結論。

### 目標資料結構

第一階段先以本機 git 版控與檔案匯入，不導入資料庫或線上 marketplace。資料夾邊界先切好，未實作的 package 也保留 manifest 與空的 README：

```text
rule-packages/
  base_rules/
    package.json
    rules/
    evidence/
    regression/
    CHANGELOG.md
  running_rules/
    package.json       # future: same contract, no rules required yet
    README.md
  strength_rules/
    package.json       # future: same contract, no rules required yet
    README.md
  schemas/
    rule-package.schema.json
    evidence-packet.schema.json
  reviews/
    RR-YYYY-NNNN.md
```

各 Rule Package 的最小 manifest 應包含：

```json
{
  "packageId": "base_rules",
  "version": "1.0.0",
  "schemaVersion": "1.0.0",
  "status": "released",
  "tier": "base",
  "engineCompatibility": { "min": "1.6.0", "max": "<2.0.0" },
  "rules": [{ "id": "EVD-R-001", "path": "rules/EVD-R-001.json" }],
  "evidencePackets": ["evidence/EP-001.json"],
  "regressionCases": "regression/cases.json",
  "contentChecksum": "sha256:...",
  "reviewRecord": "reviews/RR-2026-0001.md"
}
```

`running_rules` 負責訓練量／負荷／週期性等「訓練如何安排」的規則；`strength_rules` 負責強度、阻力訓練或進退階的規則。`base_rules` 只放跨場景的安全邊界、資料不足時的退化、基本決策型別與仲裁契約。任何新 rule 都必須先回答「為什麼不屬於另一個 package」，避免把所有邏輯重新堆回 base。

Package 依賴只允許單向：`base_rules` 不依賴其他 domain package；domain package 可以引用 base 的 schema／capability，但不能覆寫 base 的 safety rule。若兩個 package 同時觸發，仍由 Decision Engine 的 Priority Matrix 仲裁，不由 package 載入順序決定結果。

### Rule Package 更新機制（Phase 1）

初期採可重現的手動／半自動匯入：

1. 使用者取得新版 package archive 或新版 `.mcpb`，先在本機保留原檔與 checksum。
2. `package validate` 檢查 manifest schema、packageId／version、Rule ID 唯一性、Engine compatibility、evidence reference、tier 與檔案 checksum。
3. `package install --dry-run` 以目前 active package 與新版跑 regression cases，顯示 verdict、confidence、governing rule、Decision Graph 的差異。
4. 使用者確認後，以 immutable version 目錄安裝；active pointer 一次只指向一個已核准版本，舊版保留以便 rollback。
5. 安裝後跑 MCPB smoke test 與一次完整 Harness；任何失敗都不得切換 active pointer。

最小可用介面可以先是 CLI 或本機 MCP admin tool，不需要自動更新服務。UI／CLI 必須明確顯示：目前 active package、候選 package、來源、checksum、review status、相容的 Engine version，以及 rollback 目標。`latest` 不可作為執行時的隱含依賴。

### Rule Review 人工審核流程

每個新增、刪除、threshold／priority／evidence_level 變更都建立一筆 `RR-YYYY-NNNN` review record，並以以下狀態流轉：

```text
draft → evidence-check → regression-check → human-review → approved
                                                   ↘ rejected
approved → released → superseded / withdrawn
```

Review record 至少記錄：

- proposer、reviewer、日期、變更理由與影響的 Rule ID／package；
- rule 的 intended decision、適用與不適用情境、輸入訊號、缺失訊號時的退化行為；
- evidence packet、文獻識別碼、支持的 claim、不能由文獻推出的 claim；
- category、priority、與其他規則衝突時的預期仲裁；
- before／after Decision Case 數量、golden diff、confidence／coverage 變化；
- reviewer 的核准／退回理由、release version、checksum 與 rollback version。

目前 reviewer 可以只有產品負責人自己，但流程仍需「提出者欄位、審核者欄位、核准日期、核准理由」四者齊全。對涉及 Injury 或其他高風險限制的 rule，未來應要求第二位 reviewer；在此之前標記 `single_reviewer: true`，不可把單人審核寫成獨立專家驗證。

### Evidence 升級計畫

Phase 1 不一次追求完整文獻庫，而是挑 5–10 個會實際改變決策的 claims，建立 evidence packet。優先從 PubMed 的 systematic review／meta-analysis、ACSM position stand／consensus statement、ISSN position stand／review 選取；每筆 packet 只核准文獻真正支持的範圍。

建議首批涵蓋：睡眠與恢復、訓練負荷與過度訓練風險、阻力訓練進退階、耐力訓練強度分配、傷後回訓的保守邊界，以及 HRV／恢復訊號的限制。每個主題先選一篇最高相關的 review 或 position stand，再視 claim 的不確定性補第二篇；不要用單篇研究替整個 domain 背書。

Evidence level 採可解釋的梯度：`expert_consensus` → `narrative_review` → `systematic_review` → `meta_analysis`，另加 `position_statement` 作為來源型別，不把它假裝成研究設計。Rule 的 evidence level 只描述「這條 claim 的來源品質」，不直接等同於個人化決策的 confidence；後者仍要受 evidence freshness、coverage、個體適用性與衝突規則影響。

每個 evidence packet 的固定欄位：`claim`、`population`、`intervention_or_exposure`、`outcome`、`limitations`、`source_type`、`pmid_or_doi`、`retrieved_at`、`applicable_rule_ids`、`reviewer`。引用 PubMed／ACSM／ISSN 時保存識別碼與查閱日期，讓未來可以重新核對，而不是只在 Rule description 留一個裸 URL。

### Regression Test 與 Decision Case Corpus

Decision Corpus 分成三層，全部存在本機：

| 層 | 內容 | 更新規則 |
|---|---|---|
| Golden cases | 5–10 個最重要、預期答案固定的 known-correct cases | 只有經人工 review 才能改答案 |
| Boundary cases | 缺資料、門檻邊界、同類別 tie、跨 package conflict、傷病限制 | 每次新增 Rule 必須至少新增或確認一個 |
| Replay corpus | 個人訓練資料抽象化／去識別後的 100–500 筆案例 | 可發現分布漂移，不直接當 ground truth |

每個 case 固定輸入 snapshot、原定 session、期待的 decision type／from→to、不可違反的 limits、最低 reason／coverage 要求，以及允許變動與禁止變動的欄位。Regression 不只比對最終 `keep／adjust／substitute／defer／advance`，也比對 governing Rule、仲裁理由、confidence 區間、rule／engine／package version；文字措辭則用結構化欄位比對，避免不必要的 prose 變更阻塞 release。

Rule 或 Engine 更新前的 gate：schema validation → package validator → golden／boundary cases → replay corpus → Decision Graph diff → MCPB install smoke test → human review。Golden verdict 改變時預設 fail；若變更是刻意的，必須在 review record 附上 before／after、理由與新的已核准答案，不能只更新 fingerprint 讓測試變綠。

### Decision Graph 內部工具

Decision Graph 是 debug／審核工具，不是對外健康 dashboard。每次 decision 產生一個可序列化 graph：

```text
Evidence / State
      ↓
Signal coverage + derived metrics
      ↓
Triggered rules ──→ conflicts ──→ Priority Matrix arbitration
                                      ↓
                              Decision / Action / Limits
```

每個 node 帶 `id`、`type`、`value`、`source`、`ruleId`、`packageVersion`；每條 edge 帶 `reason` 或 `suppressedBy`。內部 viewer 至少支援依 `decisionId` 載入、展開／收合節點、只看觸發規則、顯示被壓過的規則、比較兩個 package／engine 版本，以及匯出 JSON／SVG。初期可以是本機靜態 HTML，直接讀 Decision Graph artifact，不引入遠端 telemetry，也不把 raw Evidence 送出本機。

### 交付順序與完成標準

1. ~~**R0 — package boundary**~~：✅ **已完成（2026-08-10）**。建立 `base_rules` manifest／schema，預留 `running_rules`、`strength_rules`，將現有 Rule Library 對應到 package；正式 schema validator 會檢查 manifest identity、semver、tier、Rule ID、content files、checksum 與 review record；runtime 從 package 載入，package-to-runtime／Decision Harness／decision trace contract tests 全部通過。空的 domain package 明確維持 `draft`、零規則、零 content files 與 zero checksum。G1 的 5 個 localhost HTTP 測試 sandbox 例外已隔離；G7 的 local athlete state store 已明確列為既有本機持久層，不再誤報為 LLM 或 outbound data sink。
2. ~~**R1 — update and review**~~：✅ **已完成（2026-08-10）**。本機 package manager 支援目錄、tar／tar.gz 與 `.mcpb` 匯入；`validate`、`dry-run`、明確 `--confirm` install、immutable version 目錄、active pointer 與 rollback 已完成。dry-run 會在候選 package 子程序跑 37 個 Decision Harness scenarios，呈現決策／action／decisionBasis／governing rule／confidence diff；Harness、checksum 或 compatibility 失敗時不會切換 pointer。
3. ~~**R2 — evidence uplift**~~：✅ **已完成（2026-08-10）**。`base_rules@1.1.0` 新增 5 個正式 schema 驗證的 evidence packets，涵蓋 HRV 導引訓練、阻力訓練進階、ACWR、detraining 與急性睡眠不足；R-006／R-007 的 study design 提升為 systematic review 方向性證據。沒有把文獻誤掛到 Pacevera 的 readiness、fatigue、ACWR 1.4 或 detraining cut points；R-001／R-002 維持 internal composite。
4. ~~**R3 — regression gate**~~：✅ **已完成（2026-08-10）**。新增 `harness/regression-baseline.json` 與正式 schema，固定 37 個 Harness golden／boundary cases；release dry-run 會比較 baseline、active package、candidate package 的 structured decision surface 與 Decision Graph，任何 verdict、action、confidence、governing rule、coverage、limit 或 graph edge 漂移都會 fail。這份 corpus 明確標記為 `behavioral_regression_baseline`，不冒充醫學 ground truth。
5. **R4 — graph viewer**：提供本機 Decision Graph viewer，能定位一次決策為何觸發、為何被壓過、最後如何形成 from→to。

這組 R0–R4 完成後，才把 Rule Package 當成可獨立發布的產品資產。R0–R3 現在已完成；下一步是 R4 graph viewer。signed package、遠端 registry、分批 rollout 與自動更新仍不開工；目前的本機匯入、Harness gate、regression gate 與 rollback 足以支撐 Free tier 的 `base_rules` 與 Pro／Enterprise 未來的 domain package 邊界。

## 下一個新對話的實作任務

下一個對話直接實作 **R4 — graph viewer**，範圍固定如下：

1. 提供本機 Decision Graph artifact viewer。
2. 支援依 `decisionId` 載入、展開／收合、只看觸發規則與顯示 suppressed rules。
3. 支援比較兩個 package／engine regression artifacts。
4. 不在此任務實作 signed package、remote registry、自動更新或新的 connector。

完成條件：R3 baseline schema 通過驗證；current／candidate package 都通過 37 cases 的 structured decision 與 graph diff；任何 intentional verdict change 都必須附 review record 的 before／after 與新核准答案。

## 技術依據

- [MCP 2026-07-28 release candidate／stateless protocol 說明](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/)
- [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization)
- [Anthropic MCP documentation](https://docs.anthropic.com/en/docs/mcp)
