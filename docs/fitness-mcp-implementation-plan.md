# Pacevera — Product & Implementation Plan

> 更新：2026-08-11
>
> 本文件是 Pacevera 的產品終局、發行現況與開工順序正本。
> 歷史判斷、舊代號與已淘汰方案保留在
> [fitness-mcp-implementation-plan-history.md](fitness-mcp-implementation-plan-history.md)，不再放進主閱讀路徑。
>
> 整合來源：
> [Evidra_Decision_Engine_開發計畫.md](Evidra_Decision_Engine_開發計畫.md) 的 Decision Infrastructure／九層能力，
> 以及 [pacevera-product-strategy.md](pacevera-product-strategy.md) 的客群、隱私、部署與產品頁策略。
> 兩份來源若與目前實作或已定版 release 衝突，以本文件與
> [release-plan-v0.5.0.md](release-plan-v0.5.0.md) 為準。

---

## 1. 產品最終樣貌

### 1.1 一句話

> **Pacevera 是 local-first、deterministic、可解釋的運動科學決策基礎設施：AI 負責理解與溝通，Pacevera 根據使用者持續累積的 Evidence，決定今天的訓練應該從什麼變成什麼。**

對外英文主張：

> **Your AI coach should know how you are today—not own your health history.**

Pacevera 最終不是另一個健身聊天機器人、健康 dashboard 或穿戴資料倉庫。它是一顆可被 Claude、ChatGPT、Gemini、教練系統或企業軟體呼叫的 Exercise Science Decision Engine。

### 1.2 使用者最後得到的體驗

```text
穿戴／健康資料／訓練紀錄／原定課表
                ↓
使用者控制的 Evidence 與縱向狀態
                ↓
Pacevera Decision Engine + versioned Rule Packages
                ↓
今天維持／調整／替代／延後／進階什麼
                ↓
from → to + reason + missing signals + confidence + rule trace
                ↓
使用者採用／拒絕／回報結果，形成下一次決策的連續脈絡
```

首次成功體驗固定為：**10 分鐘內完成一次「原定課表 → 今日調整後課表」的可追溯決策，並看得懂資料在哪裡、AI 看到了什麼、哪些訊號缺失。**

即使換對話視窗、換 AI host 或換裝置，Pacevera 對同一位使用者的 state、plan 與 decision history 不應歸零；同一份 Evidence 與版本組合必須產生相同的結構化決策，AI 只改變表達方式。

### 1.3 最終產品由六個部分組成

| 部分 | 最終責任 |
|---|---|
| Evidence layer | 將 Apple Health、Garmin、Google Health、Oura、WHOOP、Strava、手動輸入等資料轉成 vendor-neutral Evidence，明確標示來源、時間、freshness、coverage 與缺值。 |
| Semantic state | 保存可重算的 readiness、fatigue、load、injury constraints、plan 與 longitudinal state，不把原始歷史全部交給 AI。 |
| Decision Engine | 固定執行 condition evaluation、conflict resolution、priority arbitration 與 effect combination；LLM 不參與決策計算。 |
| Rule Packages | 以 `base_rules` 與未來 domain packages 管理 Rule Library、engine parameters、evidence packets、provenance、review 與 regression corpus。 |
| Explainability & learning | 每次決策都有 decision ID、Decision Graph、Rule／Evidence／Source／Version trace；結果回報是可選、可刪除、由使用者控制的資料。 |
| Interfaces & deployment | 先以 Desktop MCPB 交付，再延伸到 user-controlled private engine、受控 mobile access、REST／SDK 與 Team／Enterprise 私有部署。 |

### 1.4 三種部署形態與不可混用的隱私承諾

| 形態 | 最終用途 | 可以承諾什麼 |
|---|---|---|
| Local desktop | 個人使用者在自己的電腦安裝 MCPB／local engine。 | 原始 Evidence、token、state 與 plan 留在使用者控制的電腦。 |
| User-controlled private | 教練、隊伍或企業部署在自己的裝置、VPC 或 on-prem 環境。 | 資料留在客戶控制的環境，並有角色、稽核、保留與刪除政策。 |
| Hosted remote | 提供手機或低門檻 remote host 接入。 | 只能承諾資料最小化、transient processing 與不留存；不能宣稱 Evidence 沒離開使用者電腦。 |

Remote MCP 是 access channel，不是產品護城河，也不能先於 local/private 的資料契約上線。

### 1.5 核心護城河

Pacevera 的護城河是三者合一，而不是 MCP transport 或單一 AI 平台：

1. **Evidence Model**：不同來源進入同一個可稽核的語言。
2. **Rule Library / Rule Packages**：每個門檻、參數與效果都有版本、來源、限制及人工審核紀錄。
3. **Decision Graph**：保存哪些規則觸發、哪些被壓過、最後如何形成 `from → to`。

長期治理層再把 Decision → Outcome → Review → Rule update 串起來；LLM 可協助整理候選證據，不能自行核准新規則。

Pacevera 的核心流程固定為：**Evidence → State → Decision → Action → Outcome**。

### 1.6 目標客群與商業順序

1. 重視隱私、已有穿戴資料且正在使用 AI 的 serious athletes。
2. 個人教練與小型訓練團隊。
3. 運動隊、高績效團隊與企業 private deployment。
4. 在明確 consent 與責任邊界內的醫療／復健合作；產品仍不宣稱診斷或治療。

定價與 Free／Pro／Enterprise 邊界要在真實使用者驗證後定案。現階段不以 connector 數量、tool call 次數或 Rule 數量作為價值代理，也不先做 marketplace、白牌 AI coach 或健康資料廣告模式。

### 1.7 競品與視覺參考：AthleteSpace

[AthleteSpace](https://athletespace.ai/) 是 Pacevera 的相鄰競品與 Phase 0.5 視覺參考。它把
training、recovery、readiness、strain 與 HRV／sleep 等訊號集中成一個面向運動者的
AI endurance experience，產品方向接近 Pacevera 的 **Evidence → State → Action**：
先讀取身體與訓練訊號，形成目前狀態，再把狀態轉成下一步訓練行動。

Phase 0.5 可以參考 AthleteSpace 的資訊架構、狀態卡片、指標層次、視覺節奏與從資料到
行動的導覽方式，但不複製其「AI coach／dashboard」定位。Pacevera 必須把辨識度加深在
**deterministic decision engine**：

- Evidence 要顯示來源、時間窗、freshness、coverage 與缺失訊號。
- State 要顯示 readiness、fatigue、load、injury constraint 與 plan context 如何形成。
- Decision 要表達保留、調整、替代、延後或進階的確定性判斷。
- Action 要以明確的 `from → to` 呈現，而不是泛用 recommendation 或聊天回答。
- 每個 Decision 都要能展開 reason、confidence、triggered／suppressed rules、Rule → Evidence →
  Source → Version trace，並可在後續接收 Outcome。
- UI 可以有 AI coach 的入口，但 AI 只負責理解與溝通；畫面上的決策結果必須來自可重現、
  版本化、可稽核的 Rule／Engine 執行。

視覺驗證的成功標準不是「看起來像另一個健康 dashboard」，而是使用者在數秒內看懂：
**今天原本要做什麼、哪些 Evidence 改變了判斷、Pacevera 確定決定要改成什麼，以及這個
決定能否被追溯。**

---

## 2. 已完成與發行現況

### 2.1 已發行：Pacevera v0.4.2

v0.4.2 已於 2026-08-10 發行，是目前公開可安裝的 Desktop MCPB 基線。

| 項目 | 已發行內容 |
|---|---|
| Product / MCPB | `0.4.2` |
| Decision Engine | `1.6.0` |
| Legacy Rule Library | `1.4.0`；當時尚無可獨立識別的 `base_rules` package release line。 |
| Public tools | 6 個：`assess_fitness_state`、`decide_session`、`decide_exercise_substitution`、`generate_plan`、`preview_adjust_plan`、`commit_adjust_plan`。 |
| Decision capability | Deterministic session／plan／substitution decisions、injury-first arbitration、coverage／confidence、`decisionBasis` 與規則溯源。 |
| Evidence capability | 6 家 provider parser；Apple Health／Garmin／Google Health／Strava 已用真實資料形狀驗證，Oura／WHOOP 仍只有官方規格與模擬 fixture。 |
| Delivery | Local stdio MCPB；Streamable HTTP 為開發能力，不代表 hosted remote 已上線。 |

### 2.2 v0.4.2 之後，main 已完成

- `get_evidence_coverage`、`explain_decision`、`submit_outcome` 三個 support tools。
- 所有 decision tools 的 `decisionId` 與共用 bounded／TTL Decision Trace Registry。
- bounded outcome event registry，以及 cross-conversation athlete continuity／本機 state store 的工程基礎。
- `base_rules` package boundary、manifest、checksum、Engine compatibility、validate、dry-run、明確 install、immutable versions、active pointer 與 rollback。
- `base_rules@1.1.0` 的五個 evidence packets，以及不誇大文獻支持範圍的 provenance／limitations。
- Decision Harness、Plan Harness、substitution harness、37-case behavioral regression baseline、package diff gate 與 release-install smoke。
- 本機 Decision Graph viewer，可檢查 triggered／suppressed rules 與版本差異。
- provider-token rejection、hosted data boundary、authorization／governance 的 source-level foundation；這些不等於 hosted service 已可用。

### 2.3 已實作但尚未合入 main

- Commit `6992c32`：Decision Harness prompt-injection guards。
- Commit `62862fc`：完整的單次 `generate_workout` tool、schema、handler 與 tests。
- `single_workout_rules@0.1.0` 仍是 draft；EVD-R-013～015 尚未接 runtime。`generate_workout` 目前沿用 Decision Engine `1.6.0` 與 active `base_rules` 做個人化，因此不得宣稱 draft package 已啟用。

這兩個 commit 在同一條未合入的 commit line，且目前沒有 branch 包含它們；必須先整合與重跑 gates 才能列入公開版本。

---

## 3. 下一版已定版：Pacevera v0.5.0

### 3.1 使用者看到的版本

> **Pacevera v0.5.0，使用 Decision Engine v1.6.0 與 base_rules v1.1.0。**

從 v0.5.0 起，release gate 以三個 runtime identities 為準：

| Version line | v0.5.0 | 何時進版 |
|---|---:|---|
| Product / MCPB | `0.5.0` | tool surface、產品功能、bug fix、封裝或使用者可觀察行為改變。 |
| Decision Engine | `1.6.0` | condition evaluation、arbitration、effect combination 或 Engine output contract 改變。 |
| Rule Package(s) | `base_rules@1.1.0` | Rule Library、engine parameters、evidence packets、provenance 或 package lifecycle 的可觀察內容改變。 |

舊 `decisionBasis.libraryVersion` 暫留作相容欄位，但 Rule Library 不再是一條獨立 release line。歷史 release 仍保留該值，避免改寫已發布事實。

每次 MCPB release 都必須把 Product、Engine、所有 active Rule Package versions、checksums 與相容範圍寫入 [release-version-lines.json](release-version-lines.json)，並由 release gate 對實際 bundle 的 `initialize`、`tools/list` 與 decision output 核對。

### 3.2 v0.5.0 對外內容

- 既有 6 個 decision／planning tools。
- 新增 `generate_workout`，提供單次個人化 workout 的 `from → to` 結果。
- 新增 `get_evidence_coverage`、`explain_decision`、`submit_outcome`。
- 總計 10 個 public tools。
- 每次 decision 可回查 Rule → Evidence → Source → Version trace。
- 本機 continuity／state 能力只有在 privacy、retention、deletion 與 export 說法完成後才可出貨。
- `base_rules@1.1.0` package lifecycle、evidence packets、regression gate 與 rollback。
- Prompt-injection harness guard、完整 release smoke 與固定 runtime identity。

完整 release blocker 與功能歸屬見 [release-plan-v0.5.0.md](release-plan-v0.5.0.md)。在 blockers 關閉前，不先把 `package.json`、`manifest.json` 或 `server.json` bump 到 `0.5.0`。

---

## 4. 由終局倒推的剩餘 Roadmap

狀態只使用：`待開始`、`進行中`、`Blocked`、`完成`。每個 Phase 固定四個 Story；Story 完成後保留結果摘要，細節移到 history。

### Phase 0 — 完成並發行 v0.5.0

目標：把目前已完成的能力變成一顆公開、可安裝、版本資訊一致的 MCPB。

| Story | 交付結果 | 完成條件 | 狀態 |
|---|---|---|---|
| Phase 0 - Story 1 | 整合 prompt-injection guard 與 `generate_workout`。 | `6992c32`／`62862fc` 安全合入 main；tool、schema、manifest 與 tests 一致；draft rules 不被誤啟用。 | 待開始 |
| Phase 0 - Story 2 | 固定產品與隱私契約。 | 10 tools 的公開文件一致；continuity 的儲存、retention、export、delete 與 hosted boundary 寫入 privacy 文件並有測試。 | 待開始 |
| Phase 0 - Story 3 | 產出 v0.5.0 release candidate。 | Product `0.5.0`／Engine `1.6.0`／`base_rules@1.1.0` 寫入所有 runtime metadata；bundle 可安裝；checksum 固定。 | 待開始 |
| Phase 0 - Story 4 | 通過 release gates 並上架。 | 修正 G1 drift；tests、全部 harness、regression、package dry-run、install smoke、local release review 全綠；發布後再跑 published review 並同步 registry／release notes。 | 待開始 |

### Phase 0.5 — Decision Engine 視覺化 UI 原型

目標：從 2026-08-12 開始，建立一個可操作的視覺化 UI 原型，借鑑
[AthleteSpace](https://athletespace.ai/) 的資訊架構與視覺層次，將 Pacevera 的
Evidence → State → Decision → Action → Outcome 與 deterministic decision engine 變成
使用者一眼看懂的產品體驗。本階段是產品／視覺驗證，不改變 v0.5.0 的 runtime contract，
也不把 mock data 描述成已完成的 connector 或 private engine 能力。

| Story | 交付結果 | 完成條件 | 狀態 |
|---|---|---|---|
| Phase 0.5 - Story 1 | 視覺語言與頁面骨架。 | 定義 Evidence、State、Decision、Action、Outcome、Trace 的色彩、層級、卡片與狀態語言；完成 desktop-first 主畫面與 responsive 基本規則。 | 待開始 |
| Phase 0.5 - Story 2 | Evidence → State → Decision → Action 主流程。 | 以一個「原定 Tempo Run → 今日調整」案例呈現來源訊號、狀態判斷、`from → to`、reason、confidence 與 missing signals。 | 待開始 |
| Phase 0.5 - Story 3 | Deterministic Decision Graph。 | 可視化 triggered／suppressed rules、優先序／仲裁結果、Rule → Evidence → Source → Version trace；AI 對話不是主要視覺焦點。 | 待開始 |
| Phase 0.5 - Story 4 | Outcome 與 prototype review。 | 能記錄採用／拒絕／結果回報的入口；以 3–5 位目標使用者或內部 reviewer 檢查「是否看懂今天為何改課表」，並記錄 AthleteSpace 可借鑑處及 Pacevera 必須保持的差異。 | 待開始 |

### Phase 1 — pacevera.com 產品頁與市場驗證

目標：用一個真實、可操作的產品頁講清楚 Pacevera，讓目標使用者安裝或加入 private beta。**因此下一個產品階段是 pacevera.com；實作優先順序仍是先關閉 Phase 0 release，網站規劃可在 v0.5.0 scope freeze 後並行。**

| Story | 交付結果 | 完成條件 | 狀態 |
|---|---|---|---|
| Phase 1 - Story 1 | 定位與首頁資訊架構。 | Hero、問題、from→to 案例、How it works、適合誰、現在／未來界線與 CTA 完整；不宣稱尚未存在的一鍵 connector 或 hosted privacy。 | 待開始 |
| Phase 1 - Story 2 | 可理解的產品示範。 | 以 `user-journey.html` 為原型，做一個互動式「原定 Tempo → 根據 Evidence 調整」案例，顯示 reason、coverage、missing signals 與 trace。 | 待開始 |
| Phase 1 - Story 3 | 信任與安裝區。 | 並列 Local desktop／Private deployment／Hosted remote；顯示 Product／Engine／Rule Package 版本、資料流、privacy policy、非醫療聲明與 v0.5.0 安裝入口。 | 待開始 |
| Phase 1 - Story 4 | 上線與驗證。 | pacevera.com 第一版上線；waitlist 不收健康資料；完成 3–5 位目標使用者訪談，量測 10 分鐘 activation、7 日回訪與決策採用。 | 待開始 |

### Phase 2 — Local private engine MVP

目標：把「Evidence 不離開使用者控制環境」從 MCPB 敘事變成完整、可驗證的 private data plane。

| Story | 交付結果 | 完成條件 | 狀態 |
|---|---|---|---|
| Phase 2 - Story 1 | Durable local repository。 | SQLite 優先的 state／plan／decision／outcome repository；process restart 後仍可讀；有 migration、backup、export 與 delete。 | 待開始 |
| Phase 2 - Story 2 | Private connector boundary。 | 第一批只完成經驗證的 local Evidence workflow；connector token 加密、最小 scope、撤銷與刪除；Oura／WHOOP 先補真實去識別化 fixture，不以平台數量充當完成。 | 待開始 |
| Phase 2 - Story 3 | Evidence continuity。 | 每次 Decision 帶 state ID、evidence window、Product／Engine／Rule Package identity；新對話或新 host 只讀最小化 bootstrap，不重新取得完整健康歷史。 | 待開始 |
| Phase 2 - Story 4 | Private-engine acceptance。 | 無 hosted service 時，今日課表調整、低恢復降載、傷病替代、單次 workout 四個情境端到端通過；privacy boundary tests 證明 raw Evidence 與 token 未離開 user-controlled environment。 | 待開始 |

### Phase 3 — 受控手機與跨 AI host 體驗

目標：讓手機與不同 AI host 可使用同一個 private engine，同時維持清楚的資料邊界。

| Story | 交付結果 | 完成條件 | 狀態 |
|---|---|---|---|
| Phase 3 - Story 1 | Cross-host conformance。 | Claude、ChatGPT、Gemini 對同一 state／version 組合產生相同結構化 decision；差異只在自然語言表達。 | 待開始 |
| Phase 3 - Story 2 | Secure device pairing。 | 一次性 pairing code、短期 audience-bound token、scope、rotation、unlink、revocation、replay protection 與連線裝置顯示端到端成立。 | 待開始 |
| Phase 3 - Story 3 | User-controlled mobile path。 | 受控 tunnel 或 private VPC 路徑可用；連線前能知道資料流向；local endpoint 預設不暴露區網。 | 待開始 |
| Phase 3 - Story 4 | Hosted remote go／no-go。 | 除 authorization server、HTTPS、claims／scope、redaction、privacy policy、DPA、目標 host E2E 與明確付費需求外，完成 Google Health API mobile OAuth connector：以最小 scopes 取得 API response、正規化為 Evidence、不得把 provider refresh token 或長期 raw health history 留在 hosted Pacevera；desktop importer `4175a1a` 維持 local-only。全數成立才可 GO；否則維持 Blocked。 | Blocked |

### Phase 4 — Team／Enterprise 與平台介面

目標：把個人隱私價值延伸成團隊資料治理與可整合的 Decision Infrastructure。

| Story | 交付結果 | 完成條件 | 狀態 |
|---|---|---|---|
| Phase 4 - Story 1 | Tenant／athlete governance。 | Verified principal、tenant isolation、athlete scope、coach／clinician／admin／auditor 權限 fail closed；team output 不含 raw payload。 | 待開始 |
| Phase 4 - Story 2 | Private deployment operations。 | VPC／on-prem、SSO／SCIM、audit log、retention／deletion、資料區域、backup 與 SLA 可部署及稽核。 | 待開始 |
| Phase 4 - Story 3 | REST API 與 SDK。 | MCP、REST、SDK 共用同一 Decision contract、版本資訊與 authorization policy；不另做一套會漂移的判斷邏輯。 | 待開始 |
| Phase 4 - Story 4 | Team pilot 與商業定案。 | 至少一個受控 team pilot 驗證 active-athlete 計價、角色可見範圍、decision trace review 與 support 成本；之後才定 Free／Private Pro／Enterprise 包裝。 | 待開始 |

---

## 5. 跨 Phase 持續治理

以下不是獨立產品 Phase，而是每次變更都要遵守的 release discipline：

- Rule／parameter／evidence 變更：建立 review record，驗證 schema、checksum、compatibility、golden／boundary／replay behavior 與 Decision Graph diff。
- Engine 變更：Decision Engine 必須進版，全部 regression／harness 重跑，不能只更新 package version。
- Product surface 變更：Product／MCPB 進版，README、manifest、schemas、`tools/list`、privacy 與 release notes 同步。
- 新 domain package：先以 draft 發展；未接 runtime、未通過 review／regression、未列入 active packages 前，不得對外宣稱啟用。
- Evidence 文獻只支持它真正涵蓋的 claim；研究品質不直接等於個人 decision confidence。
- Hosted mode 不保存原始 Evidence；任何 telemetry、trace 或 log 都要有 payload redaction test。

## 6. 明確不在近期主線

- 泛用健康 dashboard、社群、內容庫或由 Pacevera 自建的聊天 UI。
- 讓 LLM 直接生成或核准決策規則。
- 在 local/private contract 完成前公開 hosted Remote MCP。
- 在有真實付費驗證前製作 Rule Marketplace、白牌 AI coach、複雜授權加密或多層定價。
- 宣稱 Oura／WHOOP 已完成真實流程驗證，或宣稱 Apple／Google／Garmin 已可一鍵即時同步。
- 把 behavioral regression corpus 描述成醫學 ground truth。

## 7. 舊代號說明

舊文件中的 `R1`、`R2`、`C9`、`P1` 等是不同時期的臨時工作包，不是產品版本；部分代號後來被重複使用，已無法讓人一眼辨識先後與歸屬。

從本版起：

- 未完成工作只使用 `Phase N - Story N`。
- 發行只使用 Product、Decision Engine、Rule Package identity。
- 歷史代號只留在 [fitness-mcp-implementation-plan-history.md](fitness-mcp-implementation-plan-history.md) 與舊 handoff，供稽核，不再拿來排新工作。

---

## 8. 現在開工順序

1. `Phase 0 - Story 1`：整合 `6992c32` 與 `62862fc`。
2. `Phase 0 - Story 2`：關閉 continuity privacy contract 與 10-tool 公開文件落差。
3. `Phase 0 - Story 3～4`：打包、驗證、發布 Pacevera v0.5.0。
4. `Phase 0.5 - Story 1～4`：以 AthleteSpace 為視覺參考，完成 Decision Engine UI 原型與 review。
5. `Phase 1 - Story 1～4`：完成 pacevera.com 第一版與 3–5 位目標使用者驗證。
6. 根據驗證結果進入 Phase 2；Phase 3 hosted remote 在 go／no-go 條件成立前維持 Blocked。
