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
| artifact 掛在 GitHub／GitLab Release | ✅ `v0.1.0` 的 `evidra.mcpb` |
| `identifier` 網址**須含 "mcp"** | ✅ `.mcpb` 副檔名即可（文件明說可來自副檔名） |
| 須附 `fileSha256` | ✅ `6affeab9…633ce`，已公布在 release notes |

缺的只有 `server.json` ＋ 一次 `mcp-publisher` 登入。

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

## 三家對照（MCPB 上架 ＋ remote ＋ Evidra 適用）

| | 官方 registry | PulseMCP | Smithery |
|---|---|---|---|
| 上架需求 | `server.json` ＋ `mcp-publisher` | 一個 URL（或發官方 registry 後自動） | 上傳 `.mcpb` ＋ config schema ＋ metadata |
| 開源／公開 repo | 無 | 無 | 無 |
| 審查 | 極寬鬆 | 未驗證 | 無強制審查 |
| MCPB 支援 | ✅ | 未驗證（它只列目錄） | ✅ |
| remote 支援 | ✅ | 未驗證 | ✅ 但兩種 remote 模式我們都不能用 |
| Phase 1 界線 | ✅ 不經手 Evidence | ✅ 不經手 | ⚠️ 只有 MCPB 那條可以 |
| per-MAU | ❌ | ❌ | ❌ |
| Evidra 現況 | **三項要求已滿足**，缺 `server.json` | **現在就合格** | `.mcpb` 已有，缺 config schema ＋ metadata |

**三者是三個獨立動作**（PulseMCP 若走官方 registry 那條則可省下）。

---

## 尚未查證 —— 動計畫前先看這裡

| # | 未查的事 | 為什麼重要 | 掛著多久 |
|---|---|---|---|
| 1 | **Smithery 會不會也從官方 registry 抓** | 決定是「發一次全解決」還是「發兩次」 | 2026-08-03 起 |
| 2 | Smithery 對 **MCPB 路徑**收不收費 | 文件無 pricing 頁 | 2026-08-03 上午起 |
| 3 | PulseMCP 的審查政策、remote／MCPB 顯示方式、營利模式 | 影響它算不算通路 | 2026-08-03 起 |
| 4 | GitHub MCP Registry（moderation policy 點名的 subregistry）是否從官方 registry 抓 | 同 #1 | 2026-08-03 起 |
| 5 | PulseMCP 自稱會自動收錄，**實際收錄結果未驗** | 那是它的說法，不是驗證過的結果 | 2026-08-03 起 |
| 6 | ChatGPT Health 內第三方 app 能否讀到 Apple Health 數值；PHI 條款適用範圍 | 決定 ChatGPT 那側是不是主線 | 更早 |

---

## 相關但不在本檔

- 完整盤點、門檻清單與價格比較：[implementation plan §3.5「通路決策」](fitness-mcp-implementation-plan.md)
- remote portal 的 11 個步驟：交接 `journal/2026-08-03-evidra-mbp-rd.md`
