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
| 內容 | security／tool annotations／OAuth（僅認證服務）／隱私政策／文件 | Publicly available on GitHub／**MIT licensed**／Node.js／`manifest.json` 的 `author` 指向 GitHub profile |
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
引擎有三處會拿母體基準或中性值頂替缺席的證據，三處都在 tool 路徑上：

| 位置 | 缺什麼時 | 頂替成什麼 |
|---|---|---|
| `generateSemanticFitnessState.js:3` | 呼叫端沒傳 baselines（`toolHandlers.js:199` 就沒傳） | `hrvMs: 52`／`restingHrBpm: 57`／`weeklyTrainingLoadTarget: 360` |
| 同檔 `:76` | 觀察到的慢性負荷低於 360 | `Math.max(observed, 360)`，ACWR 改對著 360 量，標記 `chronicBasis: "baseline_floor"` |
| 同檔 `:263` | 完全沒有新鮮的恢復訊號 | 中性分數（註解：「neutral score, but say so via coverage」） |

三處都會說出來（第二處進 `decideSession.js:600` 的 `limits`，第三處進 reasoning 的
「Recovery score **defaults to** X」），所以真正的不變量是**推估不會沉默**，不是不推估。

**這與紀律 2 不衝突**：原始輸入不被捏造（沒有 RPE 就是沒有，`model.js` 的 `?? null`），
母體基準頂替發生在**導出分數**那層。兩件事都真，是不同層。

**其餘必填欄位尚未定案**，這節只涵蓋 Description 一題——GitHub Link 填哪個 repo 仍與 MIT
決定綁著（見上方兩條紅），`manifest.json` 的 `author.url` 未補。**不要因為這節存在就以為表單可以送了。**

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
| artifact 掛在 GitHub／GitLab Release | ✅ **`v0.1.1`** 的 `evidra.mcpb`（251,337 bytes，`/releases/latest` 指向它） |
| `identifier` 網址**須含 "mcp"** | ✅ `.mcpb` 副檔名即可（文件明說可來自副檔名） |
| 須附 `fileSha256` | ✅ `af6c142b09378ca9ee28b8a1ddec4d6de2018f2c7b3e9e8d739ac8be185f1217` |

缺的只有 `server.json` ＋ 一次 `mcp-publisher` 登入。

**要填的是 v0.1.1 那顆，不是 v0.1.0。** v0.1.0 仍在（sha `6affeab9…caa9351`，bundle 內 README 停在
288 tests），刻意沒有覆蓋——已照舊 checksum 驗過的人不會對不上。v0.1.1 是純打包發布：
server 未變，同樣 87 檔，只有 bundle 內的 README 更新到 328。

**重打包必驗**（照 CLAUDE.md）：用 `unzip -l` 直接看 archive，**不要信 `mcpb pack` 自報的
ignored 數字**。2026-08-03 打 v0.1.1 時實驗過的五項：`data/private`／`*.test.js`／`schemas/`／
`data/vendor`／`.env` 命中數皆為 0，檔案清單與前一顆逐項相同。

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

---

## 相關但不在本檔

- 完整盤點、門檻清單與價格比較：[implementation plan §3.5「通路決策」](fitness-mcp-implementation-plan.md)
- remote portal 的 11 個步驟：交接 `journal/2026-08-03-evidra-mbp-rd.md`
