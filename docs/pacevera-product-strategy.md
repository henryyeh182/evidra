# Pacevera 產品策略與下一階段開發規劃

> 2026-08-10
>
> 本文件把現有的 `product-spec.md`、`design-manifesto.md`、`user-journey.html`
> 與 implementation plan 轉成產品決策稿。它不取代工程 roadmap；它回答的是：先服務誰、
> 先解哪個問題、什麼叫做隱私承諾成立，以及 pacevera.com 應該如何把產品講清楚。

## 一句話定位

**Pacevera 讓你用自己熟悉的 AI，根據你持續累積的身體證據，做出今天可執行、可解釋的訓練決策；原始 Evidence 保留在你控制的裝置或環境裡。**

對外主標可用：

> **Your AI coach can know how you are today—without your health history leaving your computer.**

中文核心論點：

> **Evidence 不離開你的電腦。AI 負責理解與對話，Pacevera 負責在你的資料邊界內，把連續的身體狀態轉成今天的決策。**

「不離開你的電腦」必須只用在真正 user-controlled 的部署形態。Remote hosted MCP 可以讓手機 AI 使用，但若原始或最小化 Evidence 傳到 Pacevera 雲端，就不能把它描述成同一個隱私承諾。

## 用戶真正要買的是什麼

用戶不是在買另一個健康資料 dashboard，也不是在買一個會背運動知識的聊天機器人。他們要的是：

1. **今天能不能照原課表做？**
2. **如果不能，具體改成什麼？**
3. **這個改動是根據哪些新鮮訊號？缺了什麼？**
4. **換 AI、換對話視窗、換裝置後，對「我」的理解不要歸零。**
5. **健康歷史不要變成 Pacevera、AI 平台或第三方的資料資產。**

Pacevera 的產品單位不是回答，而是連續的決策鏈：

```text
原始來源 → 本機 Evidence / 狀態 → 今日 Decision → Action from → to → 結果回饋
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

### P3 — 受控 mobile access

目標：讓手機可用，但不犧牲 P0 的資料邊界。

- 先做 device pairing、短期 access token、明確「目前連到哪台裝置」與一鍵撤銷。
- 評估官方／標準化 tunnel 能否被所有目標 host 使用；不能就先把 mobile path 定位為 private VPC 或 hosted remote。
- 若開 hosted remote，先完成 authorization server、JWKS／issuer／audience／scope、HTTPS、payload redaction、DPA 與新的 privacy policy。
- hosted remote 只接最小化 Evidence；不直接連 Apple／Google／Garmin，也不持有 provider refresh token。
- 用產品 UI 清楚標示：`Private local`、`Private deployment`、`Hosted transient`。

完成標準：使用者在連線前就知道資料是否離開本機；撤銷後既有 token 不能再呼叫；所有 mode 都有可重現的資料流測試。

### P4 — B2B 私有部署與團隊治理

目標：從個人隱私價值延伸到醫療／隊伍／企業的資料治理價值。

- tenant／athlete isolation、角色權限、教練只看必要摘要、不預設看 raw payload。
- 私有 VPC／on-prem deployment、SSO、audit log、retention／deletion policy、資料區域選擇。
- 團隊層級只輸出 readiness／availability／decision summary，保留 athlete 的細節控制權。
- 提供 exportable decision trace，方便教練與醫療合作方審閱，但不變成醫療診斷系統。

完成標準：一個隊伍能在自己的環境管理多位運動員，且任一角色的可見範圍都能被測試與稽核。

## 商業模式建議

先不要把 connector 數量或模型數量當主要計價單位；那會把 Pacevera 變成資料搬運工具。建議用三層驗證：

1. **個人本機版**：免費或低價，目標是安裝、首次決策、連續使用與跨 host 留存。價值指標是每週有多少次「原課表被證據改寫」以及使用者是否採納，而不是聊天次數。
2. **Private Pro**：按使用者／裝置或月活躍使用者計價，包含本機縱向 history、connector sync、decision trace 與 mobile pairing。按 MAU 比按 tool call 更符合成本與「可以放心多問」的行為。
3. **Team／Enterprise**：按 active athlete、private deployment、support／SLA 與治理能力計價；不要把隊員 raw data 變成 Pacevera 的集中資料庫。

在 Remote MCP 未完成授權、部署與合規前，不先承諾 marketplace 分潤、AI coach white-label 或按次 API 定價。先用 P0–P2 找到願意付費的 privacy outcome，再決定 remote 的商業包裝。

## pacevera.com 產品頁規劃

### 首頁資訊架構

1. **Hero**：Evidence 不離開你的電腦；用你熟悉的 AI，做出今天的訓練決策。
2. **問題**：一般 AI 知道運動知識，但每個新視窗都重新理解你；身體狀態卻是連續的。
3. **一個真實情境**：原本 Tempo Run → 根據低 readiness／睡眠不足 → Moderate run；顯示 from → to、reason、缺少的訊號。
4. **How it works**：AI host、Pacevera engine、user-controlled Evidence 三段分工。
5. **Privacy modes**：清楚並列 Local desktop／Private deployment／Hosted remote，標示目前可用與未來路徑。
6. **護城河**：Evidence Model + Rule Library + Decision Graph；用一個例子說明換模型仍保留狀態與決策可追溯性。
7. **適合誰**：privacy-conscious athletes → coaches／teams → enterprise／clinical partners。
8. **現在能做什麼**：目前可用的 MCPB、支援的 host、三個範例 prompts、安裝入口。
9. **信任區**：資料流圖、privacy policy、source code／release、非醫療診斷聲明、聯絡方式。
10. **CTA**：`Install for Claude Desktop`、`Join private beta`、`Talk to us about team deployment`。

### 產品頁第一版文案草稿

> **Your AI coach should know how you are today—not own your health history.**
>
> Pacevera runs the fitness decision engine where your evidence lives. Connect the AI you already use, keep your health history under your control, and turn today’s scheduled session into a decision you can understand and act on.

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

## 技術依據

- [MCP 2026-07-28 release candidate／stateless protocol 說明](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/)
- [MCP authorization specification](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization)
- [Anthropic MCP documentation](https://docs.anthropic.com/en/docs/mcp)
