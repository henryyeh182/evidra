# Evidra — Fitness Decision Engine

> 這份文件每個 session 自動載入。**動手之前先讀完。**
> 正本是 [docs/product-spec.md](docs/product-spec.md)（核心需求、架構、概念、使用者情境）；
> 原則與治理判準在 [docs/design-manifesto.md](docs/design-manifesto.md)。衝突時以規格需求書為準。

## 核心宗旨

使用者要 AI 的教練能力，但**不要 Claude、也不要我們的 hosted MCP 看見他完整的原始健康資料**。

所以 host 只當大腦與對話介面，Fitness MCP 只當背後的運動科學計算與安全判斷引擎，
收最小化證據、算完不留。

## 三段分工

| 段 | 誰做 | 做什麼 |
|---|---|---|
| 1 | 我們 | 把各家資料做成結構化、標準化的一份 |
| 2 | 我們 | 確定性計算：`acwr = atl / ctl` 就是一個除法，不需要模型 |
| 3 | Host | 組句子、用白話講給使用者聽 |

**我們的程式不呼叫模型來產生決策。** 但模型是前提不是選配——聽懂問題、湊齊證據、
選工具、講人話全在 host 那邊。這條管的是模型在誰家，不是有沒有模型。

## Decision ≠ Recommendation（最常失守的一條）

| | Recommendation | **Decision** |
|---|---|---|
| 例 | 「建議今天跑 Zone 2」 | 「今天的 VO₂max Intervals → 45 分鐘 Zone 2」 |
| 結構 | 憑空發出 | **from → to，對既有狀態的變更** |
| 前提 | 不需要 | **必須知道「今天原本要做什麼」** |
| GPT-6 | 做得到 | 做不到 |

**計畫是決策的基底。** 決策型別：`keep`（也是決策）· `adjust` · `substitute` · `defer` · `advance`

五層：`Evidence → Fitness State → Decision（意圖）→ Action（from → to）→ Reason（綁回證據）`

Decision 與 Action 必須分開：同一意圖在不同器材／時間／傷病下落成不同 Action。

## 邊界：能說什麼，不能說什麼

能說：

> We process only the minimum health-related evidence submitted by the caller,
> solely to compute the requested fitness decision. We do not retain, sell, use
> for training, or use it for unrelated purposes.

**不能說 `We never process health data`。** 接收並計算 Evidence 本身就是 transient processing。
「不 fetch、不持有原始資料」不等於「完全不處理資料」。

內部討論 input 一律稱 **Evidence** 不稱 Data。

## 兩種部署

- **Phase 1（hosted）**：短暫處理最小化 Evidence，不持久化、不保管、不二次利用；
  不直接連資料供應商、不持有來源 OAuth refresh token；log／trace 遮蔽 payload、token 與健康欄位。
- **Phase 2（user-controlled）**：connectors、`packages/evidence`、`packages/semantic-engine`、
  `packages/db` 與 decision computation 全在使用者控制的環境跑。MCP 變成 local data plane。

**Phase 2 是核心宗旨要的那個版本，不是選配。** 排序依核心宗旨，不依 Phase 編號。

**持久化只能存在於 Phase 2。** `packages/db` 會寫入 provider 原始 payload、HRV／睡眠、
每日狀態——Phase 1 界線禁止把 raw Evidence 寫進 database，所以那些表在 hosted 一張都不能建。
**Phase 1 hosted 永遠無狀態**，計畫由呼叫端持有並隨呼叫傳入。

**決策紀錄我們不留**（2026-07-31 使用者確認）：「狀態→決策→結果」三元組由呼叫端保存，
可作為證據回傳。Phase 1 存在 AI host 的記憶，Phase 2 存在使用者自己的 `packages/db`
——**兩種情況 hosted 都不留**。我們這端的學習在引擎規則與知識圖譜，不在個人資料。

## 工具准入判準（GPT-6 Test）

> 「如果明天 GPT-6 已經知道所有運動知識，這個 Tool 還有存在價值嗎？」

否 → 砍掉或降為內部。GPT-6 殺死**知識查詢**，殺不死三樣：
**證據**（沒有這個人的資料）· **計算**（沒有執行縱向運算）· **保證**（確定性過濾器不會被說服繞過）。

## 五條反覆失守的紀律

都因為實際偏移過而寫在這裡。動手前逐條自問。

### 1. 沒有同意不要動程式

使用者問設計問題時，先回答問題。要改程式先說要改什麼、為什麼，**得到同意才動手**。

### 2. 輸入不得由我們編造

沒給的值就是沒有。不用預設值代替缺失輸入（沒有 RPE 就是沒有，不是 5），
缺的走 `signalCoverage.recovery.missing`／`signalCoverage.training.missing` 並下調 confidence。

`signalCoverage` 分兩組：`recovery` 是今天的睡眠／HRV／靜息心率／壓力夠不夠新，
`training` 是近 7 天每一筆訓練有沒有帶負荷。**嚴格定義：全部都有才算 usable**，
一筆缺就整組進 missing。沒有負荷的訓練不計入分肌群疲勞，
`training.missing` 就是呼叫端得知這件事的唯一途徑。

**分肌群疲勞 = `trainingLoad × decay`，不再乘 `rpe/10`。** 廠商算好的負荷
（Garmin `activityTrainingLoad`、Strava Relative Effort、Apple Health 活動能量）
本身已含強度，`training-load` 也是直接用同一個數字算 ATL／CTL／ACWR。
RPE 仍當證據收進來，但不參與任何計算——所以不供 RPE 的來源不會被扣分。

**確定性門檻必須有出處**——`acwrHigh = 1.4`、`maxSampleGapSeconds = 30` 這類數字
要嘛附依據，要嘛標為未驗證，要嘛改由呼叫端傳入。**無出處的值不准進 repo。**

廠商算好的複合分數（readiness、Body Battery）當一等證據收進來，不重算。

### 3. 任何單一來源都必須能用

**沒有使用者需要湊齊 Strava ＋ Apple Watch ＋ Garmin。** 只有 Strava 的跑者靠訓練負荷拿決策；
不戴錶睡覺的人靠 HRV 與廠商複合分數拿決策。**這是設計，不是降級。**

談任何來源時講**這組來源能做出什麼決策**，不要講它缺什麼。缺漏只出現在
`signalCoverage.recovery.missing`／`signalCoverage.training.missing` 與 confidence，不當敘事主軸。

### 4. 不拿單一使用者的資料特性當設計依據

匯入 Apple Health／Garmin 是為了讓 Semantic Fitness Layer **學會讀懂各家 schema**，不是調參。

驗證軸線是**匯出檔的形狀**——完整／sentinel／缺洞／方言等價／有損／稀疏。
可驗證的斷言只有六類：canonical 命名、單位換算、registry ↔ parser 一致、sentinel 不外洩、
缺的列進 `signalCoverage` 對應那一組的 `missing`、決策仍成立且自我解釋。

**模擬的生理數值不是 ground truth**，不得用來回頭 fit `readiness < 40` 這類門檻。

### 5. 建議要帶自己的 `signalCoverage`

**這條是把 `Decision ≠ Recommendation` 套用在我自己的輸出上。** 產品要求每個決策帶
`signalCoverage`／`confidence`／`limits`，目的是讓沒有領域知識的人也看得出它站在多少證據上。
**我給使用者的建議一樣要帶**，否則就是憑空發出的 recommendation。

1. **講事實時附指令或原文**——使用者可以重跑、可以核對，不必懂這個領域。
2. **講建議時把「查了什麼／沒查什麼」寫在同一段**，不要藏在標題或章節名裡。
   記錄裡是 N 項清單而只查了 M 項時，**必須在結論那一句講明**——人讀的是結論，
   標題上的限定詞不會被讀進去。
3. **「這要不要改變計畫」預設是問句，不是答案。** 查到新事實就報事實；
   要不要因此改變既定計畫是使用者的決定，不是查證的附贈品。

**寫在這裡不等於做得到**——2026-08-03 實測：`D-CHANNEL` 早就列著四家通路的名字、
還註明「別再重新推導一次」，我照樣只查兩家就給了完整語氣的建議，
而且把那個結論寫進本檔與交接，下一段 session 便照著錯的範圍繼續做。
**當時九條 gate 一條都攔不到——它們檢查程式與文件是否一致，不檢查建議建立在多少查證上。**
（2026-08-07 補了 G9／G10 之後仍然如此：那兩條驗的是「落差有沒有被寫下來」與
「roadmap 內容有沒有跑進產品頁」，不驗一句建議站在多少查證上。）
所以這條沒有強制力，**不要拿「已經寫進 CLAUDE.md 了」當這件事的解法**。

另外兩個同形狀的錯，一併記著：**技術關係不要用形容詞代替**
（來源模糊就照引原文並標明「文件未定義」，不要翻成比喻）；
**兩個事實之間不要自行接「因為」**（沒有證據說 A 導致 B 就並列，不要接因果連接詞）。

## 現況（2026-08-01 查證）

- 對外 **6 個 tool**：`assess_fitness_state` · `decide_session` · `decide_exercise_substitution` ·
  `generate_plan` · `preview_adjust_plan` · `commit_adjust_plan`
  （**v0.4.1 起拿掉 `evidra_` 前綴**，改回 v0.1.1 那組名字——見發布章節）
- **443 tests**、eval 20 golden cases，全綠
- parser 實作 6 家（Apple Health／Garmin／Strava／Google Health Takeout／Oura／WHOOP；
  Strava 含 API 與 bulk export 兩種方言）；schema registry 涵蓋 6 個平台。
  **前四家照真實匯出檔寫；Oura 與 WHOOP 照兩家自己的 OpenAPI 寫（2026-08-07），
  尚未對過任何真實回應**——講成熟度時要分開講，那是技術債 C13
- Strava bulk export：CSV 按欄位**索引**解析（5 組同名欄單位不同）；`Activity Date` 是 UTC 無 offset，
  本地時區只能從 `activities/*.fit.gz` 的 `activity.local_timestamp − timestamp` 還原
  （opt-in `readLocalTimezone`）
- Google Health Takeout（＝ Fitbit 形狀的匯出，跟 Health Connect API 是同平台不同方言）：
  每日檔的 timestamp 是「本地午夜以 UTC 表示」（16:00Z ＝ +08:00 的 00:00，時刻本身就編碼了
  offset）；按月 JSON 日期是 `MM/DD/YY`；`0`／`0.0`／`UNSPECIFIED` 全是 not-measured sentinel；
  同一天的步數會同時來自 Garmin 與手機兩個 recorder（取單一 recorder 最大值，不相加）；
  Garmin 同步進來的值不會有 Fitbit 複合分數（sleep_score／Stress Score 只剩表頭、cardio_load 全 0）
- 知識圖譜 889 節點 / 5,785 邊（**內部證據來源，不是對外產品**）
- transport：stdio ✅ · Streamable HTTP ✅；OAuth 只有「檢查 token claims」那一半
  （`oauth.js`），**簽章驗證器是 `null`、`http.js` 進入點沒傳 `oauth`、沒有 authorization server**
  → 端到端還不能用
- 協定停在 `2025-06-18`；最新規格 `2026-07-28`（stateless）。升級走 dual-era
- `schemas/sources/` 與 `eval/scenarios/` 四家齊備（Garmin／Google Health Takeout／Apple Health／
  Strava）→ **`review:phase` 的 G5 綠**。Strava 那份量測自 mbp-rd 的真實 bulk export
  （39 個 CSV、7 筆活動、2026-06-26 → 07-26）：**這份匯出小**，契約裡的比率都是 7 筆的比率，
  當方言的證據看、不當發生頻率看。已在真實檔上驗證的三件：registry 宣告的欄號 37／88／89
  正確；`Intensity = round(NP/FTP×100)` 5/5 完全吻合；`Training Load` 是 TSS 公式取 floor。
  該匯出的 `maxHeartRateIsAgeEstimate` 為 **true**（171 ＝ 220−49），所以整條負荷序列
  站在 220−age 這個經驗法則上
- **Phase 2：一行程式都沒有**

## 未決（不得自行改寫）

- **計畫的表還沒做**：持久化位置已定（Phase 2），但 plan 與 planned workout 的 migration
  列在 `packages/db/schema.md` 的 Future Migrations，還沒寫。
- **計價單位定案**：已暫定 per-MAU（見下）。定案條件是 Claude／Codex 出明確的
  MCP server 商業與計價文件。
- **隱私政策要為 remote 改寫，但還不能改**（2026-08-04）：現在那份的範圍是 desktop
  extension，裡面「no database／no accounts／runs on your own machine」都是 extension
  的事實敘述，**不是跨版本承諾**——跨版本的 floor 只綁 evidence（最小化、算完丟棄、
  不留存、不販賣、不訓練），一個字都不提資料庫，這是對的。
  **remote 幾乎一定要一個資料庫**：per-MAU 要算「這個月幾個人用過」（識別碼＋活躍紀錄），
  authorization server 要記 client 註冊與授權狀態。**證據仍然不存**——Phase 1 hosted
  無狀態是核心宗旨那條線，不是可交換的東西。
  **現在不寫進政策的理由不是「先不講」，是現在寫的會是猜的**：per-MAU 還是暫定，
  authorization server 一行都沒寫，存什麼、存多久都沒定案。拿未定案的商業模式寫進
  已發布的隱私政策，就是把猜測變成對外承諾。
  **觸發點：per-MAU 定案、或 authorization server 開始寫的那一刻**，就要動政策，
  而且必須在 remote 對外開放**之前**改完。要改的五處：`PRIVACY.md` 的 `Applies to`、
  「As a desktop extension」那行範圍限定句（它罩住底下五個 bullet）、Summary 的
  「a calculator, not a data service」與「on your own machine」、`README.md` 的
  「It runs on your own machine」，加一條新揭露：hosted 版會處理識別碼。
  **五處全在 `evidra`**（公開 repo），改動要與這裡的敘述一致。

## 選定的方向（2026-08-01 定案，`D-CHANNEL`）

> **MCP-native distribution：以 Claude Connectors Directory 為第一上架目標，
> 維持 decision engine 定位 ＋ ChatGPT Health。不做 marketplace，不做 model router。**

**目標通路只有 host 內建目錄兩個**——Anthropic Connectors Directory ＋ ChatGPT（含 Health）。
使用者在自己已付費的 AI App 裡直接開啟，這才是通路。

**不做 marketplace。** Shopify App Store 能抽成，是因為它持有金流、商家關係與交易資料。
要複製那個位置就得當健康資料的中介與權限保管者——**那是資料湖**，是「明確不做」的最後一項。

**不做 model router／多模型層。** 三段分工第 3 段在 host。**MCP 本身就是 model-agnostic
的實現**：同一支 server 誰都叫得動，而且模型成本不在我們家。自建等於把第 3 段搬回來還要
自己付 token。唯一例外是既有的開放：**開發期 eval 呼叫模型 API 不受此限**。

**不是通路的東西**（別再重新推導一次）：官方 registry／Smithery／mcp.so／PulseMCP 是
**開發者 discovery**（官方 registry 自陳給 subregistry 消費、不給 end user），順手曝光即可；
GPTs／Copilot／Gemini Gems／AgentExchange／Zapier 的使用者是自動化建構者；
Trainerize／Mindbody／Wellhub 屬「賣給握有課表的一方」，需 REST／SDK；
wearable dev platform 要直連供應商，**違反 Phase 1 界線**，僅 Phase 2 適用。

### ⚠️ Phase 1 界線：只有「檔案送到使用者機器」那種路徑可以走

**任何會讓 Evidence 經過第三方伺服器的發佈方式都不能用**，包括代理。
Smithery 是踩過的例子：它的 **Local MCPB bundle** 可以（檔案下載到本機執行、不碰他們的伺服器），
但 **hosted 與 URL proxy 都不行**——proxy 一樣經手 Evidence，與 hosted 同罪。
**看到「免 infra 的 remote endpoint」不要直接用。**

### 上架的三個既定判斷

1. **Anthropic MCPB ＋ Smithery MCPB 兩邊都要可以上架**（2026-08-03 使用者定）——
   同一顆 `evidra.mcpb` 走兩條通路，不是二選一。**閉源不影響 Smithery，
   只影響 Anthropic 的優先順位**，所以 Smithery 那條不必等 MIT 的決定。
2. **不必為了上架先升 Team**——remote 的送審 portal 在 admin settings（個人方案進不去），
   但 **MCPB 走獨立表單、個人 Pro 即可，且 `stdio` 已綠**。確定要 remote 時再升。
3. **要不要為了進 Anthropic 的優先清單改 MIT，是使用者的商業決定，不得自行改寫。**
   閉源送得出去、不違反任何明文規定，只是不在優先清單。

**Claude 先的理由**：Anthropic 送審表單的「Data handling」步驟**明文詢問是否處理
personal health data → 是揭露事項，不是禁區**；OpenAI Apps SDK 則**明寫不得處理 PHI**。
ChatGPT 那側**平行查證不平行開工**。

> **要動上架計畫，先讀 [docs/distribution-channels.md](docs/distribution-channels.md)。**
> 那裡有每一家的原文引述、實測結果，以及**「尚未查證」清單**。
> 那份清單存在的理由是：曾經只查了四家裡的兩家，就把結論當成四家的答案寫進這裡與交接。
> **查了幾家，就只能講幾家。**

完整盤點、門檻清單與價格比較見
[implementation plan history §3.5「通路決策」](docs/fitness-mcp-implementation-plan-history.md)
（現況與下一步已搬到 [implementation plan](docs/fitness-mcp-implementation-plan.md)，
history 只留完整推理過程）。

## 計價（2026-07-31）

**計價暫定按月活躍使用者（per-MAU），不按呼叫次數。** 成本結構決定的：單次決策 0.443 ms、
零次外部 API 呼叫，唯一隨規模走的是人數。按次計價會與成本錯配，也會讓使用者省著問。

**商業模式哪一種有利、哪一種快，還沒決定——不要拿未定的商業模式去推導技術決策。**
已知限制：ChatGPT Apps SDK **只准販售實體商品**，數位訂閱須導向自有網域外部結帳；
Anthropic Software Directory Policy **通篇無分潤或付費條文**（金流自理，與「金流控制權
在我們手上」一致）。

## 兩個 repo 的分工

**開發在 `fitness-mcp`；只有改 LICENSE、隱私政策或對外宣稱時才需要同步
[`evidra`](https://github.com/henryyeh182/evidra)（公開、送審用）。**

evidra 只有三個檔，和這裡的關係各不相同——**唯一真正重複的是 `LICENSE`**：

| 檔案 | 關係 |
|---|---|
| `LICENSE` | **逐字相同的複本** → 改一邊必須改另一邊 |
| `README.md` | **同名但是兩份不同文件**（這裡開發用中文、evidra 對外英文版）→ **不同步內容，但事實必須一致** |
| `PRIVACY.md` | **只在 evidra** → 只在那邊改 |

**「事實一致」是什麼意思**（2026-08-03 使用者定）：兩份 README 是不同文件，**不必逐字同步**，
但**同一件事不能講得互相矛盾**。改動其中一份的事實敘述時，去看另一份有沒有講同一件事。

**evidra 那份刻意不寫測試數字**——`review:phase` 的 G1 只掃 `fitness-mcp`，
數字寫進 evidra 會在公開頁面慢慢腐爛而沒人發現。**這不是疏漏，是設計，不要「順手補上」。**
所以測試數這類數字**只有這裡有**，一致性自然成立；要同步的是**敘述句**
（支援哪些來源、做得到什麼、成熟度到哪），而**G1 不讀敘述句，那是它的已知盲區**。

另外兩條耦合，改到才要管：

- `manifest.json` 的 `homepage`／`documentation`／`support`／`privacy_policies` 四個欄位
  指向 evidra 的檔案。**那些路徑一改，隱私政策連結就斷——送審文件明寫
  missing or incomplete → immediate rejection。**
- Release 上的 `evidra.mcpb` 是從這裡打包的，用 `npm run pack`——那條指令**先 build 再打包，
  最後把版本、下載網址與 archive 的 sha256 寫回 `server.json`**。`dist/` 不進 git，所以
  單獨跑 `mcpb pack` 會打到過期或不存在的 build；**一律走 `npm run pack`**。
  驗證照舊：`unzip -l` 直接看 archive，不要信 `mcpb pack` 自報的 ignored 數字。
  **每次打包 sha 都會變**（zip 記錄打包時間），所以要送出去的必須是最後打的那一顆。

**bundle 現在是一顆編譯檔，不是原始碼樹**（2026-08-06）：`apps/` 與 `packages/` 由 esbuild
編成 `dist/evidra-server.mjs`，rule library 以字串內嵌，兩者都不進 archive。
**這不等於規則變私密**——每個決策的 `decisionBasis` 照樣回傳 governing rule 的門檻與引文。

**驗兩顆 bundle 要 `diff -rq` 解開比對，不是比清單**（2026-08-03 的教訓：檔名一致不等於內容
一致，只 diff `unzip -l` 的清單曾把一次行為修正誤判成「只換 README」）。

**`/releases/latest` 指向 `v0.4.1`**（2026-08-09 發布，sha256 `011e4ef84bf6219cc…4e4c`）。
**官方 MCP registry 已上架 v0.4.1**（2026-08-09，`isLatest: true`／`status: active`），
sha256 與 release asset 一致。用 `mcp-publisher publish` 送，**要在 repo 根目錄跑**——
它讀當前目錄的 `server.json`，在家目錄跑會回 "server.json not found"。
token 效期很短，幾乎每次都要重登（`mcp-publisher login github`）——**那是 device code
互動流程**（印出 `github.com/login/device` 與一組代碼後阻塞等待），要背景跑並把代碼貼給使用者，
不能當一般指令等它自己結束；
這台機器已用 `brew install mcp-publisher` 裝好。title `Evidra Fitness`。
**registry 拒收同版號重送**，所以連文案修正都要帶一個版號。
**Anthropic MCPB 送審表單已提交**（附的是 v0.3.6 那顆快照；表單自陳是表達興趣，
他們評估時看的是連結指向的最新版）。

**顯示名稱是 `Evidra Fitness`，識別碼仍是 `evidra`**——registry 上另有
`io.github.vitas/evidra`（DevOps flight recorder，早五個月），命名空間讓識別碼不會撞，
但**目錄清單上人看到的那個字會撞**，所以改的是顯示名稱那四處：
`server.json` 的 `title`、`manifest.json` 的 `display_name` 與 **`name`**、`server.js` 的 `serverInfo.title`。
**`manifest.json` 的 `name` 是 v0.4.1 才跟著改的**（2026-08-09 使用者定）——Claude Desktop 的
Configure 畫面讀的是 `name` 不是 `display_name`，不改的話那一頁還印著 `fitness-mcp`。
**repo 名與 registry 識別碼一律不動。**

**工具名在 v0.4.1 拿掉了 `evidra_` 前綴**（2026-08-09 使用者定，理由是 Claude Desktop 的
工具探索相容性，見上方 release notes）。這推翻了本檔原本「工具名一律不動」那句——
**改工具名不是零成本**：v0.3.7／v0.4.0 裝過的人升上來看到的是另一組名字。

**公開名 ≠ canonical 名。** v0.4.1 只換掉 `tools/list` 廣告出去的那組名字，**內部 canonical
仍是 `evidra_*`**，公開名透過 alias 路由過去，兩種名字送進來都解析到同一個 handler。
所以改文件時**逐份判斷，不要機械掃掉所有 `evidra_`**：

| 要改成公開名 | 保留 canonical |
|---|---|
| 對使用者說「Claude 會看到哪些 tools」 | `schemas/tools/evidra_*.json` |
| installation／release／registry／extension surface | `outputSchemas.js`、`toolHandlers.js` |
| examples 裡教使用者或 reviewer 看公開工具名 | eval golden／scenario runner／tests 呼叫 canonical 或 alias routing 的地方 |
| `docs/user-journey.html` 裡展示 release version／sha／published artifact | history 文件中描述當時版本事實的 `evidra_*` |

**事故歸因的正式說法**（2026-08-09 使用者定，取代「rename fix」那種講法）：

> v0.4.1 was not just a rename fix. It restored the public MCP wire shape that
> Claude Desktop had successfully used in v0.1.1: legacy public tool names, no
> advertised `outputSchema`, and content-only tool results. Internally, Evidra
> still keeps `evidra_*` as canonical tool names and routes the public names
> through aliases.

核心不是「前綴本身一定害 Claude 壞掉」，而是**公開 tool surface 從 v0.1.1 的工作形狀漂移了**，
前綴是這個漂移的一部分。

**v0.1.0 起的每一版都刻意保留不覆蓋**（已照舊 checksum 驗過的人不會對不上）。
每次發布後照規矩驗過：下載回來重算 sha256 相符，且與本地打包的那顆 `diff -rq` 逐檔相同。

## 動 MCP 介面之前先載 skill

改 tool 定義、transport、輸出契約或 `manifest.json` 之前，先用 `Skill` 工具載
**`anthropic-skills:mcp-builder`**（skill 不會自動載入，不叫就不會有）。

它帶的是 MCP 官方慣例——tool 命名與前綴、annotations 的定義、**呼叫端的失誤要回在
result 裡而不是協定層**、structured output、transport 選擇。**這些判準不在本檔，
十三條 gate 也一條都驗不到。** 2026-08-04 靠它一次查出：`evidra_decide_exercise_substitution`
的描述要呼叫端傳一個 schema 裡不存在的 `evidence`（同一句錯話還在 `manifest.json`
與 `evidra/README.md`）、3 個 tool 把呼叫端可以自己修的失誤送成 JSON-RPC error、
`evidra_generate_plan` 宣告會寫入但它是純函數、HTTP 綁全部介面卻印「local only」。

**要打包 `.mcpb` 之前先載 `mcp-server-dev:build-mcpb`。** 觸發條件：重新打包 bundle、
動 `.mcpbignore`、改 `manifest.json` 裡與打包有關的欄位、或發布新版本。
（這個 skill 的內容我沒讀過，只知道觸發條件——它宣稱管的是 bundle 封裝與本機安裝那一段。）

另兩個 `mcp-server-dev:*` 這裡用不到，不必叫：`build-mcp-server` 是決定部署模型的入口
（已定案）；`build-mcp-app` 是做互動 widget／Apps SDK 的（「聊天介面」在「明確不做」裡）。

## 發布／上架前後都要跑

```bash
npm run review:release
```

**每一次發布、每一次上架、每一次動對外文件，都要跑這支。** 它自己判斷驗哪一顆，
並在標頭印出來：

| `server.json` 宣告的版本 | 驗的 artifact | 用在 |
|---|---|---|
| GitHub 上已有該 release | **下載回來的那顆** | 發布後對帳、平常確認現況 |
| 還沒發布 | **本機 `dist/evidra.mcpb`** | 發布前對帳 |

**`.mcpb` 從來不進 git**（`dist/` 在 `.gitignore`），它只存在於 GitHub Release 的 asset。
所以本機模式驗的是 `npm run pack` 剛產出的那顆——**忘了重打包會被 R2 抓到**
（archive 內 `manifest.json` 的版本與 `server.json` 不符）。

六條：版號一致 · **sha256 一致（下載回來的 `.mcpb`、`server.json`、官方 registry 三方
＋版號＋`isLatest`）** · **`PRIVACY.md` 逐條可執行斷言**（搜 `node:http`／`fetch(`／
`writeFile` 應為零命中）· build-mcpb skill 的 `local-security` 出貨前清單 ·
公開 repo 的 README／PRIVACY 對版本與 tool 清單 ·
**R6：對外文件裡每個連結連得上，且點開是給人看的頁面**。

**手動抽驗不算做過。** 2026-08-09 使用者要求比對 `shasum -a 256 evidra.mcpb` 與 registry 的
`fileSha256`——那整件事就是 R2。手動只會查到自己想得到的那幾項，這支會查六項。

**R6 於 2026-08-09 加入，加的當下就抓到一個。** R5 的註解記著 registry 連結「改過三次才對，
三次都是我沒點開過自己放的連結」——那次修的是公開 repo 的 README，而
`docs/user-journey.html` 裡原封不動留著第一版那個 `?search=evidra`，點開是一串 JSON。
**教訓學在一個檔案、沒有套到另一個，在此之前沒有任何機制會發現。**
R6 不看連結講得對不對（那是人的事），只問連得上嗎、點開是不是給人看的東西。

**為什麼要獨立一支**：`manifest.json` 的 `documentation`／`privacy_policies` 指向
`blob/main/...`，讀者永遠讀到最新文件、卻裝到最後一個 release。**兩者分離是預設狀態。**
`review:phase` 全部在 working tree 上跑，驗不到這件事。2026-08-07 因此出過兩次錯：
對外 README 描述了當天才進 schema、還沒出貨的欄位；而 `PRIVACY.md` 對已編譯檔逐條做的
宣稱，從發布到那天為止**沒有人拿真正的 archive 核對過一次**。

## 動 Rule Library 的門檻／category／effect 之前

**改 `packages/rules/data/session-rules.json` 裡的 `thresholds`、`category`、`priority`、
`effect`、`status` 或 `appliedBy`，必須跑過 Decision Harness 才算數。**

`appliedBy`（2026-08-09 起必填）說的是哪個引擎套用這條規則，值必須是
`ENGINE_THRESHOLD_KEYS` 宣告的四個之一（`session`／`plan`／`planChange`／`catalog`），
且該規則宣告的門檻必須屬於同一個引擎——載入期就驗。**它會進指紋**，因為它決定這條規則歸哪個
覆蓋檢查管：改成非 `session` 就離開 Decision Harness 的射程，落到
`apps/mcp-server/test/ruleCoverage.test.js`，兩邊都不驗到的話沒有任何檢查替它說話。

這條有機制擋，不是靠這裡寫著：`harness/rule-fingerprint.json` 對那幾個欄位各存一個 digest，
`npm test` 在它與規則庫不一致時就紅。流程是

```bash
npm run harness                              # 先看決策變成什麼
node harness/runner.js --update-fingerprint  # 看過了，才承認它
```

**重點不是那個 hash，是 commit 裡同時有「動了哪個門檻」與「有人看過它動出什麼」。**

**它跟 `regression.test.js` 的差別要講準，不要誇大**（2026-08-08 實測）：那組案例刻意坐在
各自門檻邊上，`acwrHigh` 1.4→1.5 它**當場就紅**。指紋多出來的只有兩件事——
一是它涵蓋全部 12 條規則，regression 只有 7 條（EVD-R-005 與 EVD-R-007 明列為例外，
EVD-R-010／011／012 不是 session 規則、在 `apps/mcp-server/test/ruleCoverage.test.js` 驗）；
二是 regression 的案例本身是測試，**攔住你的那個案例可以在同一個 commit 裡一起改**：
門檻改 1.5、案例證據改 1.51，416 個測試全綠。指紋不是行為測試，紅的時候沒有一個測試在
邀請你去改它，所以它會一直紅到有人刻意動它為止。

## 常用指令

```bash
npm test                     # 全套測試
npm run eval                 # golden set 計分（tool 輸出契約）
npm run harness              # Decision Harness（決策鏈本身；改規則或引擎之後必跑）
npm run review:phase         # 階段完成審查（宣告「做完了」之前必跑）
npm run build:graph          # 重建知識圖譜
npm run audit:graph          # 圖譜品質稽核
npm run serve:http           # HTTP transport
```

## 宣告完成之前

要說某個 Phase／偏差／修正「做完了」，先走 [docs/phase-review.md](docs/phase-review.md)：
先讀（memory → 本檔 → product-spec → 宣言 → README → plan → user-journey），
再跑 `npm run review:phase` 的十三條 gate，最後回答機械驗不到的判斷題
（GPT-6 判準、Decision ≠ Recommendation、五條紀律…）。
**gate 紅的不得宣告完成**——紅的是宣稱與現況的落差，不是待辦功能。

**MCP server 是常駐行程，改程式不會熱重載**——要驗證改動必須開新 session 或重啟行程。

## 明確不做

健身 App · 健身社群 · 聊天介面 · 內容資料庫 · 資料湖
