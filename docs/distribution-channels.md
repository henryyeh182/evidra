# 通路查證明細

> CLAUDE.md 的 `D-CHANNEL` 只留**判斷結論與界線**。這裡放**支撐那些結論的查證**——
> 原文引述、實測結果、以及**還沒查的東西**。
>
> **怎麼用**：要改變上架計畫之前，先看本檔最後一節「尚未查證」。
> 那份清單存在的理由是：曾經有一次只查了四家裡的兩家，就把結論當成四家的答案寫進 CLAUDE.md
> 與交接，下一段 session 照著錯的範圍繼續做。**查了幾家，就只能講幾家。**

---

## 分類（不變）

官方 registry／Smithery／mcp.so／PulseMCP 都是**開發者 discovery**，**曝光通路，不是收入通路**。
四家都沒有創作者分潤。真正的通路只有 host 內建目錄兩個：Anthropic Connectors Directory
＋ ChatGPT（含 Health）。

---

## Anthropic MCPB 送審表單

**表單全文**：`docs/MCPB Desktop Extensions Submission Form.pdf`（2026-08-03，使用者自己登入
Google 匯出）。**進版控**（本 repo 私有，跨機 clone 就有，填表時不必再匯出一次）。
那是**空白表單的存檔，不是填好的送審件**。
**不要複製到 `evidra`**——那是 public repo，PDF 第 2／3／5 頁帶著使用者 email。

**表單只有 8 題**：email 記錄／是否為既有 extension 的更新／Primary Contact Name＊／
Primary Contact Email＊／**MCP Server Description＊（50 words max）**／
Desktop Extension GitHub Link＊／Primary Party Confirmation＊／`.mcpb` 附檔＊（1GB 上限）／
MCP Directory T&C 同意＊／feedback（選填）。

**一題都沒問** data handling、personal health data、OAuth、test account、pricing
——那些全在 remote portal（11 步）。要打勾的 MCP Directory T&C 也沒有健康資料／金流／授權條款。
→ **授權檢查、evidence、per-MAU 三件事不阻擋 MCPB 送審。**

### ⚠️ 表單第 2 頁有另一組要求，跟 submission guide 的通用五項不是同一組

| | submission guide 通用五項 | **表單第 2 頁** |
|---|---|---|
| 內容 | security／tool annotations／**會做認證的服務要用 OAuth 2.0**／隱私政策／文件（[五項原文見下](#送審要求的原文2026-08-04-查證來源-claudecomdocsconnectorsbuildingsubmission)） | Publicly available on GitHub／**MIT licensed**／Node.js／`manifest.json` 的 `author` 指向 GitHub profile |
| 現況 | 全綠 | **兩條紅** |

紅的兩條（2026-08-03 實測）：`LICENSE` 是「All rights reserved」專有授權；
`author` 只有 `{"name": "Henry Yeh"}`、**沒有 `url`**。

**強制？否。** Terms／Policy 全文無開源條款；closed-source 不接受被明確限縮在 **plugins**
（「Plugins must link a public GitHub repo; closed-source is not accepted」——
若 MCPB 也適用，那行沒必要單獨點名 plugins）。

**優先？是。** 表單原文：「we're **primarily considering** extensions that: ... MIT licensed」。

→ **閉源送得出去，但不在優先清單。** 且表單自陳 "does not guarantee inclusion"、
Anthropic 主動挑人——**這是報名表達興趣，不是審查流程的開始**。

**要不要為了進優先清單改 MIT，是使用者的商業決定，不得自行改寫。**
改 MIT 等於 decision engine／知識圖譜／四家 parser 要公開。

### 已定稿的欄位：MCP Server Description（2026-08-03，使用者定稿）

表單原問句（PDF 第 4 頁）：

> **MCP Server Description \*** — Briefly describe what your MCP server does and its core functionality (50 words max).

問的是**做什麼 ＋ 核心功能**，所以定稿不寫 feature list、不寫賣點：

> An exercise-science MCP server for AI assistants. Evidra takes caller-supplied evidence
> and returns a from→to change for today's scheduled session, together with the supporting
> evidence and decision rule. Missing signals are reported, never silently inferred.

**35 字**，上限 50。

**第一句是分類，不是標語**：MCP server ／ 給 AI assistant 用 ／ 運動科學引擎——
讀者一眼排除 chatbot 與 fitness app。第二句是 `Evidence → 決策` 的資料流，
主詞動詞受詞一路到底，不用名詞子句（早期稿寫 `what today's scheduled session should
become as a from→to change`，讀者要先扛一個子句再回頭接 `as a...`，已棄用）。
`decision rule` 讓 decision 這個字留在句子裡——回傳的是**變更**，而變更由**決策規則**產生。

**`silently` 那個字是量出來的，不要拿掉。** 「missing signals 不會被推估」字面上不成立——
引擎仍有兩處會拿母體基準頂替缺席的證據，兩處都在 tool 路徑上（2026-08-06 複查）：

| 位置 | 缺什麼時 | 頂替成什麼 |
|---|---|---|
| `generateSemanticFitnessState.js:7-9` | 呼叫端沒傳 baselines（`toolHandlers.js` 就沒傳） | `hrvMs: 52`／`restingHrBpm: 57`／`weeklyTrainingLoadTarget: 360` |
| 同檔 `:79` | 觀察到的慢性負荷低於 360 | `Math.max(observed, 360)`，ACWR 改對著 360 量，標記 `chronicBasis: "baseline_floor"`（`:104`） |

兩處都會說出來（第二處進 `decideSession.js:735` 的 `limits`），所以真正的不變量是
**推估不會沉默**，不是不推估。

**原本有第三處，2026-08-06 移除了。** 完全沒有新鮮恢復訊號時，恢復分數回傳中性的 50，
readiness 因此也是 50——而 `readinessReduce = 60` 的規則就在那個編出來的 50 上觸發，
把使用者的 VO2max 課表降成 moderate。coverage 一直誠實回報那個缺口，**但決策早就做完了**。
現在 `recoveryScore` 與 `readinessScore` 在沒有量測時都是 `null`，讀 readiness 的規則不觸發，
決策改由分肌群疲勞、急慢性負荷與距上次訓練天數落地。
所以「頂替」只剩母體基準那一層，**恢復分數那層已經不頂替了**。

**這與紀律 2 不衝突**：原始輸入不被捏造（沒有 RPE 就是沒有，`model.js` 的 `?? null`），
母體基準頂替發生在**導出分數**那層。兩件事都真，是不同層。

**其餘欄位已於 2026-08-06 定案**（表單實際是 8 個必填 ＋ 1 個選填）：

| 題 | 答案 | 依據 |
|---|---|---|
| Is this an update to an existing extension? | **No** | 從未進過目錄 |
| Primary Contact Name | `Henry Yeh` | — |
| Primary Contact Email | `evidramcp@icloud.com` | 與 `PRIVACY.md`／README 的對外聯絡信箱一致 |
| MCP Server Description | 上面那段（36 字，主詞已改為 **Evidra Fitness**） | 上限 50 字 |
| Desktop Extension GitHub Link | `https://github.com/henryyeh182/evidra` | **`fitness-mcp` 是 PRIVATE**，表單要求 publicly available on GitHub，所以只有這一個能填。與 MIT 決定無關 |
| Primary Party Confirmation | **No** | 原問句問的是「你是否任職於這個 MCP server **連接的**那個 application／service 的公司」。Evidra 不連任何外部服務，沒有那個公司存在。表單自陳 not required |
| Attach your .mcpb | v0.3.4 那顆 | — |
| MCP Directory T&C | **使用者自己勾** | 法律同意，不代答 |
| Feedback（選填） | 留白 | — |

`manifest.json` 的 `author.url` **已補**（`https://github.com/henryyeh182`，v0.3.0 時補的）。

**四條「primarily considering」符合三條**：Publicly available on GitHub ✅／MIT licensed ❌／
Built with Node.js ✅／valid manifest.json with author pointing at GitHub profile ✅。
授權那條是偏好不是門檻，**送得出去，只是不在優先清單**——見上方兩條紅。

---

## Smithery（2026-08-03 一手）

### 三條發佈路徑，只有一條可以用

| 路徑 | 誰在跑我們的程式 | 可否 |
|---|---|---|
| **Local MCPB bundle** | **使用者自己的機器**——原文「Smithery distributes a pre-built MCPB bundle that clients download and run locally」 | ✅ 不碰他們的伺服器，Phase 1 界線不受影響 |
| Smithery hosted | 他們的伺服器 | ❌ Evidence 流經第三方，log／trace 遮蔽與不持久化都無法保證 |
| URL（bring your own hosting） | 他們**代理**到我們的上游（"Smithery proxies to your upstream server"） | ❌ **代理一樣經手 Evidence**，與 hosted 同罪 |

**看到「免 infra 的 remote endpoint」不要直接用。**

MCPB 路徑文件明載：**無開源要求、無公開 repo 要求、無強制審查**（"Get verified" 選配）。
現有的 `evidra.mcpb` 就是它要的東西，只差 config schema 與 server page metadata。
發佈入口 `smithery.ai/new`。

---

## 官方 MCP registry（2026-08-03 一手）

**是 `registry.modelcontextprotocol.io`，不是 GitHub。** 實際打過它的 REST API，回得出真實資料。

GitHub 在這件事出現三次但都不是它本身：repo 放原始碼與文件／拿來做認證（所以命名須為
`io.github.<帳號>/`）／artifact 存在 Release。

- **支援 MCPB**：`registryType: "mcpb"`
- **支援 remote**：實際回應裡看到 `remotes: [{type: "streamable-http", url}]`
- **只存 metadata 不存檔案**：「hosts metadata that points to those packages」
- **審查極寬鬆**：只移除違法／惡意軟體／垃圾／完全壞掉；**不移除**低品質、有漏洞、功能重複。
  **無開源要求、無公開 repo 要求**
- **自述可靠度**：currently in **preview**、「Breaking changes or **data resets** may occur」、
  「**does not provide uptime or data durability guarantees**」→ **低成本曝光，不是可靠通路**
- repo 屬 GitHub org `modelcontextprotocol`（已驗證徽章），自述 community driven，
  授權正從 MIT 轉 Apache-2.0；**無 GOVERNANCE.md、ToS 不指名任何法律主體**（適用加州法）。
  文件寫 `backed by ... Anthropic, GitHub, PulseMCP, and Microsoft`，
  **但沒有定義 `backed by` 是什麼關係**——不要翻譯成任何比喻

### MCPB 的三項硬性要求，Evidra 已全部滿足

| 要求 | 現況 |
|---|---|
| artifact 掛在 GitHub／GitLab Release | ✅ **`v0.2.0`** 的 `evidra.mcpb`（264,328 bytes、88 檔，`/releases/latest` 指向它） |
| `identifier` 網址**須含 "mcp"** | ✅ `.mcpb` 副檔名即可（文件明說可來自副檔名） |
| 須附 `fileSha256` | ✅ `aab0f5efc88a9829efffb96924bede551a83da397796a8788a2f533dbbf1d803` |

**`server.json` 已寫好（2026-08-04，repo 根目錄）**，缺的只有一次 `mcp-publisher` 登入
（GitHub OAuth，授權對象是使用者本人，Claude 不能代登）。

schema 為 `2025-12-11`。**必填只有三個**：`name`／`description`／`version`。
逐項對過的限制：`name` 須符合 `^[a-zA-Z0-9.-]+/[a-zA-Z0-9._-]+$`（用
`io.github.henryyeh182/evidra`，命名空間就是 GitHub 認證的依據）、
**`description` 上限 100 字元**、`fileSha256` 須為 64 位小寫十六進位、
`registryType` 限 `npm`／`pypi`／`oci`／`nuget`／`mcpb`、`transport` 用 `stdio`。

**`description` 不能用 Anthropic 表單那份定稿**——那份 259 字元，超過上限一倍半。
registry 這欄另寫一句 93 字元：

> Turns caller-supplied training evidence into a from->to change for today's scheduled session.

**兩份文案是不同欄位、不同上限，不是同一句話的長短版**。表單那份問「做什麼＋核心功能」，
這欄問的是一句人看得懂的功能說明。

發布前最後一道驗證（已做）：拿 `server.json` 裡的 `identifier` 直接 `curl` 下載，
264,328 bytes、sha256 與 `fileSha256` 欄位相符。

**要填的是 v0.2.0 那顆。** v0.1.0 仍在（sha `6affeab9…caa9351`），刻意沒有覆蓋
——已照舊 checksum 驗過的人不會對不上。

**v0.1.1 不是純打包發布。** v0.1.0 打包後又有 9 個 commit 動到 runtime，bundle 內 **10 個程式檔**
與 v0.1.0 不同，含兩個行為修正（`cc43122`：缺 `type`／`intensity` 時不再宣稱做了沒做的變更；
`96f820f`：沒有負荷的場次改為進 `signalCoverage.training.missing`）。所以 **0.1.1 這個版本號是對的**
——第三位就是給 bug 修正用的。

### ⚠️ 驗兩顆 bundle 不能只比檔名

2026-08-03 曾把 v0.1.1 誤判成「只換了 README」，並把那句話寫進公開的 release notes（後已改）。
成因：只 diff 了 `unzip -l` 的**檔名清單**，兩邊都 87 檔、名字逐項相同 → 當成內容相同。
**檔名一致不等於內容一致。** 當時大小 244,579 → 251,337 bytes（+6.7KB）就在同一份輸出裡，是反證。

正確做法兩件，缺一不可：

1. **內容比對**：兩顆都解開後 `diff -rq`，看的是檔案內容
2. **安全掃描**：用 `unzip -l` 直接看 archive，**不要信 `mcpb pack` 自報的 ignored 數字**。
   打 v0.1.1 時驗過的五項：`data/private`／`*.test.js`／`schemas/`／`data/vendor`／`.env` 命中數皆為 0

---

## PulseMCP（2026-08-03 一手，來源 `pulsemcp.com/submit`）

**兩條路：**

1. **官方 MCP registry（自動）** — PulseMCP **每天抓、每週處理**。
   原文：「If it has been a week since you published there, or want to make other
   adjustments to your listing on pulsemcp.com, please email us at hello@pulsemcp.com」
2. **直接送件** — 一個表單，**只要一個 URL**。
   原文：「Can be a GitHub repository, a subfolder of a repository, or a standalone website」

→ 走第 1 條**不需要單獨上架**；走第 2 條是獨立動作但門檻極低，
`github.com/henryyeh182/evidra` 現在就合格。**兩條路都不需要為它另外準備任何東西。**

---

## mcp.so（2026-08-03 一手，用瀏覽器；WebFetch 回 403）

首頁自稱 "MCP Marketplace"，**但那是品牌用語**：submit 頁是表單（repo URL ＋ 名稱），
並提供 **$39 一次性刊登費**（免審上架、verified badge、featured 版位、dofollow 連結）。

**金流是我們付給它買曝光，沒有分潤，也沒有終端使用者結帳。**
自報 DR 72／12 個月 2.2M unique visitors／266K MAU，但招商文案自己寫
「in front of **developers** building agents」——**受眾自承是開發者**。

→ **免費送審可做；$39 先不要。**

---

## per-MAU：四家都不支援，原因不在通路

**MCPB 這個分發形態沒有訊號可數**（本機實測）：

| 檢查 | 結果 |
|---|---|
| 對外連線 | 零（唯一命中是 `http.js:270` 的 localhost `console.log`） |
| 相依套件 | `dependencies`／`devDependencies` 皆空 |
| `stdio.js` 的 auth／oauth | **0 次命中** |
| `userId` | tool 的**選填**輸入，由呼叫端自填——是標籤不是身分 |

per-MAU 需要身分 → 需要 authorization server。`oauth.js` 的 resource-server 那半已寫好
（RFC 9728 metadata、401 challenge、claims 檢查），`http.js:95` 缺的是 authorization server 本身。
**這與最終的 remote connector 是同一個缺口，不是兩套工。**

**附帶限制**：若改在 MCPB 裡回報用量，會牴觸已公開發布的 `PRIVACY.md` 與 release notes：
「performs **no outbound network requests** … **no telemetry, model calls, or accounts**」。

---

## 四家對照（2026-08-03 更新，Anthropic 併入同表）

**Anthropic 要與那三家列在同一張表。** 分類上它是通路、那三家是 discovery，
但盤點「上架還缺什麼」時分兩張表會漏掉第一目標——曾經漏過一次。

| | 官方 registry | PulseMCP | Smithery | **Anthropic Directory** |
|---|---|---|---|---|
| 定位 | 開發者 discovery | 開發者 discovery | 開發者 discovery | **真通路**（終端使用者在 Claude app 內） |
| 上架需求 | `server.json` ＋ `mcp-publisher` | 一個 URL（或發官方 registry 後自動） | 上傳 `.mcpb` ＋ config schema ＋ metadata | 8 題表單 ＋ `.mcpb` 附檔 ＋ T&C |
| 開源／公開 repo | 無 | 無 | 無 | **不強制**，但 MIT ＋ public GitHub 在「primarily considering」 |
| 審查 | 極寬鬆 | **官方未公布**（submit／about 兩頁都沒寫） | 無強制審查 | "does not guarantee inclusion"，Anthropic 主動挑人 |
| 上架費用 | 免費 | 免費 | **免費**（pricing FAQ 原文見下） | 免費 |
| MCPB 支援 | ✅ | 未驗證（它只列目錄） | ✅ | ✅ |
| remote 支援 | ✅ | 未驗證 | ✅ 但兩種 remote 模式我們都不能用 | ✅（另一個 portal，需 Team） |
| Phase 1 界線 | ✅ 不經手 Evidence | ✅ 不經手 | ⚠️ 只有 MCPB 那條可以 | ✅ MCPB 本地執行 |
| per-MAU | ❌ | ❌ | ❌ | ❌ |
| **Evidra 還缺什麼** | `server.json` ＋ 一次登入 | **零** | config schema ＋ metadata | `author.url`；GitHub Link 填哪個 repo（綁 MIT 決定） |

**四者是四個獨立動作**（PulseMCP 若走官方 registry 那條則可省下）。

Smithery 收費原文（`smithery.ai/pricing` FAQ，2026-08-03 瀏覽器實查）：
「Yes, listing your MCP server on Smithery's registry is completely free.
You only pay for RPC calls when **consuming** MCP servers.」
→ 付費在**消費端**，我們走 Local MCPB 不經過，與我們無關。

### Anthropic 那格展開

| 項目 | 狀態 |
|---|---|
| MCP Server Description（50 字上限） | ✅ 已定稿 35 字，見上方小節 |
| `.mcpb` 附檔 | ✅ Release 上有（2026-08-03 實打 `gh` 確認） |
| 隱私政策三處 ＋ tool annotations | ✅ 全綠 |
| `manifest.json` 的 `author.url` | ❌ 未補 |
| Desktop Extension GitHub Link | ❌ 未解，綁 MIT 決定 |
| LICENSE | 專有 → 送得出去，不在優先清單 |
| 升 Team | 不必（MCPB 走獨立表單，個人 Pro 即可） |

---

## 分潤與商業模式：四家都不是收入通路

| | 創作者分潤 | 終端使用者結帳 | 金流方向 |
|---|---|---|---|
| 官方 registry | 無 | 無 | **無金流**（只存 metadata） |
| PulseMCP | 無 | 無 | 營利模式**官方未公布** |
| Smithery | 無 | 無 | **反向**：收費在消費端 RPC |
| Anthropic Directory | 無 | 無 | **金流自理**（Policy 通篇無分潤或付費條文） |
| mcp.so | 無 | 無 | **反向**：$39 我們付錢買曝光 |

**沒有一家能替我們收錢，商業模式 100% 自建。**

兩條外部限制：ChatGPT Apps SDK **只准販售實體商品**，數位訂閱須導向自有網域外部結帳；
Anthropic Policy 禁「software that transfers money… **on behalf of users**」——
**禁的是軟體代替使用者轉錢，不是禁開發者收訂閱費**（曾經差點誤讀成後者）。

**自建收費 → 要知道誰是誰 → authorization server**（`http.js:95`）。
**商業模式與 per-MAU 是同一個依賴，不是兩件事。**

不做 marketplace 的理由也在這裡：Shopify 能抽成是因為它持有金流、商家關係與交易資料，
要複製那個位置就得當健康資料的中介與權限保管者——**那是資料湖**，「明確不做」的最後一項。

---

## 送審要求的原文（2026-08-04 查證，來源 `claude.com/docs/connectors/building/submission`）

上面幾節的摘要以這一節的原文為準。四句話逐字抄下來，因為其中兩句原本只有中文摘要，
而摘要讀起來的意思與原文不同。

**五項 submission requirements 全文**：

> 1. **Security**: Meet Anthropic's security standards
> 2. **Tool annotations**: All tools must include a `title` and the applicable `readOnlyHint` or `destructiveHint`
> 3. **Authentication**: Use OAuth 2.0 for authenticated services
> 4. **Privacy Policy**: Local connectors must include privacy policies
> 5. **Documentation**: Provide clear setup and usage instructions

**第 3 條不是限制，是條件句。** 原文是「Use OAuth 2.0 for **authenticated** services」——
**會做認證的服務要用 OAuth 2.0**，而不是「只有認證類服務才可以用 OAuth」。本檔先前那格
摘要寫成「OAuth（僅認證服務）」，容易被讀成後者。portal 的 Authentication 一步明列
「**no authentication**」是合法選項，所以：**認證不是上架門檻**；要做認證才必須是 OAuth 2.0。
（注意原文寫 OAuth **2.0**；`oauth.js` 那半實作的是 2.1 的 resource server。）

**隱私政策那句，原文在一個 Warning 區塊裡**：

> Missing or incomplete privacy policies result in immediate rejection.

適用範圍是**本機 connector**（第 4 條原文即「**Local** connectors must include privacy
policies」）。要求三件：README.md 的 "Privacy Policy" 段、`manifest.json` 的
`privacy_policies` 陣列（`manifest_version` 0.2+）、**HTTPS URL**。內容要涵蓋 data
collection／usage and storage／third-party sharing／data retention／contact information。
→ Evidra 三件都有，GitHub 的 `https://` 連結符合「HTTPS URLs」這一條。

**另外三件本檔原本沒記的**：

- **remote portal 的 Company 一步要「Company name and website」**——所以走 remote 時
  **會被問到網站**，不只是文件與隱私政策的 URL。
- **MCPB 送審表單的網址是 `clau.de/desktop-extention-submission`**（官方文件裡的拼字如此）。
- **另有 pre-submission checklist**：`/docs/connectors/building/review-criteria`；
  認證模式細節在 `/docs/connectors/building/authentication`（**兩份都還沒讀**）。

---

## Pre-submission checklist 逐條對照（2026-08-04，來源 `claude.com/docs/connectors/building/review-criteria`）

這頁自陳是「最常見的退件原因」。**送審預設先以 community connector 上架並自動掃描政策合規；
Anthropic 再自行把「highly useful」的挑去 verified review，那一關 reviewer 會實際跑過每個 tool**
——挑選是自動的，我們不必也不能申請。

| 條件 | 原文要點 | Evidra 現況 |
|---|---|---|
| 讀寫要分開 | 同時吃安全與不安全 HTTP 方法的單一 tool 直接退；`api_request` 加 `method` 參數是點名的反例 | ✅ 沒有萬用 tool |
| 自由查詢型 tool 要指名 API | 只適用讓呼叫端自組 endpoint／query／body 的 tool | ✅ 不適用，沒有這種 tool |
| annotations | 「Every tool must include a `title` and the applicable hint」；**read-only 可以免逐次確認，destructive 一定會提示** | ✅ 六個都有 `title` 與 hint。`evidra_commit_adjust_plan` 見下方風險 |
| tool 名稱 ≤ 64 字元 | — | ✅ 最長 `evidra_decide_exercise_substitution`＝28 |
| 描述要窄且準確 | 「The description must match the tool's actual behavior」 | ✅ P0 修的正是這條 |
| 功能品質 | 「Every tool must return a successful response when called with valid parameters」；籠統錯誤（Internal Server Error／無細節的 Bad Request）退件；要驗證輸入並回可行動的錯誤 | ✅ P1 修的正是這條 |
| 不碰對話資料 | 不得查 Claude 的 memory／chat history／對話摘要／使用者檔案 | ✅ 沒有 |
| **API ownership** | 「Your server must call your own first-party APIs, or APIs you legitimately proxy. **The MCP server domain should match your service.**」 | ✅ 現在零外部呼叫。**接 Garmin 會直接踩到這條**——見下 |
| 不支援的用途 | 金錢／加密資產移轉、AI 生成圖像影音 | ✅ 都不做 |
| test credentials | 必填，且要是資料完整的帳號 | remote 才要；本產品沒有帳號，要另想 reviewer 怎麼端到端跑 |
| public documentation | 「required by your publish date」——部落格或說明文章即可 | ✅ `evidra/README.md` |
| plugins 必須公開 repo | 「closed-source is not accepted」 | 不適用，我們是 MCPB 不是 plugin |
| **MCPB 的 open-source 條文** | 「**MCPB** open-source and "spec will evolve" clauses in the Software Directory Terms are **required and not waivable**」 | ⚠️ **找不到那條文**——見下 |
| 送審前 | 每個 tool 都要用 **MCP Inspector** 跑過，並以 **custom connector in Claude** 跑過 | ❌ **還沒做**，這是可以現在做的動作 |

### ⚠️ 風險一：我們的描述在指示 Claude 怎麼行為

那頁的 prompt-injection 段落結尾是一句直述：

> Describe what the tool does. Do not tell Claude how to behave.

被列為退件的五種寫法裡，與我們有關的是「Interfere with Claude calling other tools」與
「Tell Claude to behave in ways unrelated to the tool's function, attempt to override system
instructions」。而 `evidra_decide_session` 的描述寫著「**Do NOT re-derive or override the intensity,
duration or movements it returns**」，`evidra_decide_exercise_substitution` 寫著「**do NOT override or
reason past the result**」「**Do NOT use this to browse exercises**」，P2 加的 server
`instructions` 也有「do not re-derive them or reason past the result」。

**這是不是踩線，我沒有定論**：那些句子講的是本 tool 的職能範圍（確定性過濾器不可被繞過），
不是叫 Claude 去做無關的事，也不是覆寫系統指令。但形式上就是在指示行為。
**低風險的改法是改成陳述句**——「Injury contraindications and load limits are applied
server-side; the values returned are the decision」——同樣的意思，不用命令句。

### ⚠️ 風險二：`evidra_commit_adjust_plan` 既不是 read-only 也不是 destructive

那頁把 hint 講成二分（read-only 或 destructive），而 `evidra_commit_adjust_plan` 兩者都不是：
它什麼都不存，但**不可以在使用者沒看過 preview 的情況下被呼叫**，所以刻意留
`readOnlyHint: false` ＋ `destructiveHint: false` 來換取 host 的確認提示。
若審查按二分法讀，可能被要求選一邊。**要不要改成 `destructiveHint: true` 是判斷題**：
它確實會讓呼叫端手上的計畫版本被取代（「always prompt」正是我們要的行為），
但那個字面意思是刪除或破壞資料，我們沒有。**先不動，記在這裡。**

### Garmin 與 API ownership

「must call your own first-party APIs, or APIs you legitimately proxy」與 portal 的 Data
handling 一題（選項含「a third party's you don't control」）**看起來張力相反**：一邊要求
first-party，一邊把「不受控的第三方」列成可揭露的選項。**哪一邊是實際判準，我沒有定論**，
但「The MCP server domain should match your service」意味著走 remote 時 endpoint 要在自己的網域上。

---

## 送審前動作

checklist 的最後一段要求：「For MCP servers, exercise every tool through the **MCP Inspector**
and as a **custom connector in Claude**」。**MCPB 那張 8 題表單不問這件事，remote portal 的
step 9 要勾選聲明**，所以對 MCPB 它是品質動作、對 remote 是必填。

| 動作 | 狀態 |
|---|---|
| MCP Inspector 跑過六個 tool | ✅ **2026-08-04 完成**，結果見下 |
| 在 Claude 裡以 custom connector 跑過 | ❌ **只有使用者能做**——要在 Claude app 裡設定並實際對話 |

### MCP Inspector 實測結果（2026-08-04）

指令（不進 `package.json`，一次性 npx）：

```bash
npx -y @modelcontextprotocol/inspector --cli node apps/mcp-server/src/stdio.js --method tools/list
```

六個 tool 全部以 `tools/call` 實跑，**全部成功、全部帶 `structuredContent`**：

| tool | result frame | `structuredContent` |
|---|---|---|
| `evidra_assess_fitness_state` | 4,580 bytes | ✅ |
| `evidra_decide_session` | 約 4,400 bytes | ✅ |
| `evidra_decide_exercise_substitution` | 2,564 bytes | ✅ |
| `evidra_generate_plan`（2 週） | 9,296 bytes | ✅ |
| `evidra_preview_adjust_plan` | **12,576 bytes** | ✅ |
| `evidra_commit_adjust_plan` | **10,120 bytes** | ✅ |

這是**外部客戶端**驗到的，不是自家測試——`outputSchema` 與 `structuredContent` 在真的 MCP
客戶端上成立。

### 這次實測查出來的兩件事（都還沒修）

**1. 兩個 plan tool 的回應超過自訂的 8KB 上限，而且會隨計畫長度成長。**
`evidra_preview_adjust_plan` 回的 `patch` 裡含整份 `resultingPlan`，加上 `diff` 與 `summary`，
再被「text ＋ structured 各一份」乘二——2 週計畫就 12.5KB，12 週會更大。
checklist 有一條「Keep responses reasonably sized for the task」。
本機測試只對 `evidra_decide_session` 斷言 8KB，沒有蓋到這兩個。

**2. 呼叫端填的 `source` 不會出現在 provenance 裡——已修（2026-08-04）。**
input schema 寫著 `source`「Where the reading came from, e.g. garmin | strava | apple_health」，
`packages/evidence/src/model.js:189` 也確實存下來，但 `describeEvidence` 的 `signalWriters`
當時只讀 `metric.metadata?.recorders` 與 `metadata?.sourceName`，**不是 `source`**——照文件填
`source: "garmin"` 的呼叫端會拿到 `writers: []`，看起來像沒人說來源。
**修法是回報它，而不是改文件**：`signalWriters` 每一項多一個 `sources`（呼叫端說的來源）
與原有的 `writers`（那個來源底下哪個裝置記錄的）並列——兩者是不同問題，
`writers` 要回答的是 Google Health 那個 Garmin 與手機同時記步數的案例。
兩份輸出契約（`evidra_assess_fitness_state`／`evidra_decide_session`）與 `outputSchemas.js` 一起更新，
Inspector 複驗：`{"hrv_ms":{"sources":["garmin"],"writers":[],"latest":"…"}}`。

---

## 尚未查證 —— 動計畫前先看這裡

| # | 事項 | 狀態（2026-08-03 晚更新） | 為什麼重要 |
|---|---|---|---|
| 1 | Smithery 會不會也從官方 registry 抓 | ❌ **查過仍無定論**。Smithery 文件 59 頁全無提及；官方 registry 的 README／`community-projects.md`／`registry-aggregators.mdx`／發佈公告都不點名任何消費者；站內抽查 2 筆官方 registry 項目，1 筆在（命名空間不同）1 筆不在。**唯一給答案的第三方部落格，同句話把 PulseMCP 講錯，不可用。剩下的路只有問 Smithery 本人。** | 決定「發一次全解決」還是「發兩次」 |
| 2 | Smithery 對 MCPB 路徑收不收費 | ✅ **已解：免費**（pricing FAQ 原文見上） | — |
| 3 | PulseMCP 的審查政策與營利模式 | ✅ **已解：官方未公布**。`submit` 與 `about` 兩頁都沒有審查、把關、營利的敘述。**「未公布」不等於「沒有審查」** | 影響它算不算通路 |
| 4 | GitHub MCP Registry 是否從官方 registry 抓 | ❌ 未查 | 同 #1 |
| 5 | PulseMCP 自稱會自動收錄，實際收錄結果未驗 | ❌ 未驗——**要發完官方 registry 才驗得到** | 那是它的說法 |
| 6 | ChatGPT Health 內第三方 app 能否讀到 Apple Health 數值；PHI 條款適用範圍 | ❌ 未查 | 決定 ChatGPT 那側是不是主線 |
| 7 | 官方 registry 支不支援 Docker／OCI | ✅ **已解：支援**。`server.json` 的 `registryType` 含 `oci`（另有 npm／pypi／nuget／cargo／mcpb）。**但 API 抽樣 30 筆只見 npm／pypi** | 影響 remote 之外還有沒有第三種分發形態 |
| 8 | Garmin Connect Developer Program 是不是暫停中 | ❌ **無定論**。官方 Health API 頁與 FAQ 都寫「Stay tuned for more updates on the program」，同時 FAQ 又寫「please request … we'll quickly review your application」（約兩個工作日）。**說暫停的只有一份第三方部落格**，Garmin 論壇 thread 438046 零回覆。剩下的路是寄 `connect-support@developer.garmin.com` | 已確認的是**只給企業／商業用途**、要申請要審核（見 [implementation plan P4](fitness-mcp-implementation-plan.md)）。是否暫停決定「能不能排程」而不是「能不能做」 |
| 9 | remote portal 的「不同使用者連不同 URL」實際怎麼運作 | ❌ 未查。官方文件只確認**這個選項存在**（Connection 一步：「whether every user connects to the same URL or different users connect to different URLs」），沒有說明審查怎麼驗、reviewer 用哪個 URL | 決定「使用者自己 host、我們不持有 evidence」這條路能不能上架 |
| 10 | Team／Enterprise 方案的費用 | ❌ 未查 | remote portal 在 admin settings，個人方案進不去；這是走 remote 的固定成本 |
| 11 | `review-criteria`（pre-submission checklist） | ✅ **已讀，逐條對照見上一節。** 查出三件本檔原本沒有的：讀寫必須分開、tool 名稱 64 字元上限、送審前要用 MCP Inspector ＋ custom connector 跑過每個 tool | — |
| 12 | `authentication` 那份官方文件 | ❌ **還沒讀**（`/docs/connectors/building/authentication`：哪些認證模式開箱支援、哪些要與審查團隊協調） | 決定 OAuth 要走 DCR、client ID metadata document 還是 Anthropic 持有的 static client ID |
| 13 | **`review-criteria` 指的「MCPB open-source 條文」在哪** | ❌ **找不到**。原文說那條在 Software Directory **Terms** 裡且 required and not waivable。實際查了三處都沒有：Terms 全文搜 `MCPB`／`bundle`／`open source`／`license`／`source code`／`waive`／`specification`／`evolve` **八個詞全部零命中**（2026-08-04）；Software Directory **Policy** 也沒有（它只有 3.A 要求隱私政策連結）；MCPB 送審表單要打勾的 T&C 也沒有（2026-08-03 查過）。剩下的路是寄 `mcp-review@anthropic.com` 問 | **這條可能把 MIT 從商業決定變成門檻。** 目前的證據不足以說「必須開源」，也不足以說「不必」——**不得據此自行改寫授權決定** |
| — | 隱私政策放 GitHub 會不會被接受 | ✅ **已解：可以**。要求原文是「HTTPS URLs to privacy policies」，沒有限定自有網域（見上一節） | — |

---

## 相關但不在本檔

- 完整盤點、門檻清單與價格比較：[implementation plan §3.5「通路決策」](fitness-mcp-implementation-plan.md)
---

## Anthropic remote portal 的 11 個步驟（2026-08-03 查證，將來走 remote 直接照這個準備）

**進 portal 要 Team 或 Enterprise**（admin settings，個人方案沒有）。MCPB 不需要，走獨立表單。

1. **Introduction**
2. **Connection** — server URL 必須 `https://`；transport 選 streamable HTTP 或 SSE；所有人同一 URL 還是各自不同
3. **Tools** — 從連上的 server 自動同步，缺 `title`／annotations 會被標記
4. **Listing** — name ≤100 字元、tagline ≤55、description ≤2000、1–5 個 category、文件 URL、隱私政策 URL、support 聯絡、icon、**永久 slug**
5. **Use cases** — 主要用途、使用者連線前需要什麼、讀資料／寫資料／兩者
6. **Company**
7. **Authentication** — OAuth with DCR／client ID metadata document／Anthropic 持有的 static client ID；或使用者自帶 URL／credential；或無認證
8. **Data handling** — API 是自己的／經同意代理夥伴的／不受控的第三方；**是否處理 personal health data**（**揭露事項，不是禁區**）；是否有 sponsored content
9. **Test & launch** — test account 要詳細到 reviewer 能端到端跑完，且要確認自己已用 MCP Inspector 或 custom connector 跑過每個 tool
10. **Compliance** — **七項政策確認全部必填**：directory guidelines／first-party API usage／financial transactions／AI media generation／prompt injection／conversation data collection／public documentation
11. **Review**

**對照**：MCPB 表單只有 8 題，**一題都沒問** data handling、personal health data、OAuth、test account、pricing
——那些全在這個 portal。所以授權檢查、evidence、per-MAU 三件事**不阻擋 MCPB 送審**，純屬 remote 階段。
