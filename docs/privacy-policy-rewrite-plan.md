# 隱私政策改寫計畫 — 本機 Google Health 取用版

> **這份文件現在不執行。** 它是一張逐處對照表，等 connector 真的要進 bundle 時照著改，
> 不必到時候重新逐行點一次。
>
> 盤點日 2026-08-06，對照的是當時的 `evidra` HEAD 與 v0.2.0 那顆 bundle。

## 觸發點與順序

**觸發點：Google Health connector 的程式進 bundle 的那一刻。**

**順序不能反**：必須在含 connector 的 bundle **發布之前**改完。Anthropic 送審文件原文
「Missing or incomplete privacy policies result in immediate rejection.」——政策落後於程式，
就是 incomplete。

**為什麼現在不改**：今天已發布的 v0.2.0 裡，下面每一句話都是**真的**（connector 一行都還沒寫）。
現在改等於把不存在的行為寫進已經對外發布的政策。這與 CLAUDE.md 未決第三條
（隱私政策為 remote 改寫）擋下來的理由相同：**現在寫的會是猜的**。

那兩件事**不是同一件**，但改的是同一份檔——真的動手時一起看，別各改一次。

## 涉及四個檔案

| 檔案 | repo | 處數 |
|---|---|---|
| `PRIVACY.md` | evidra（公開） | 13 |
| `README.md` | evidra（公開） | 4 |
| `README.md` | fitness-mcp | 5 |
| `manifest.json` 的 `long_description` | fitness-mcp（會進 bundle） | 1 |

---

## 一、`evidra/PRIVACY.md`

| 行 | 現在寫的 | 為什麼失真 | 改法方向 |
|---|---|---|---|
| 8 | "Evidra is a calculator, **not a data service**" | 會去取資料了 | 改成「計算引擎，附一個你自己授權的本機取用器」 |
| 9 | "It **receives** the evidence your AI assistant passes into a tool call" | 不再只有這一個來源 | 並列兩種來源：呼叫端傳入、或你授權後由本機取用 |
| **15** | **"Evidra never goes and gets your data."** | **直接反過來。這句最嚴重** | 整句換掉，改成「只在你明確授權後、以你的身分、從你指定的來源取用」 |
| 24 | "Evidence is supplied per call, **by the caller**" | 同上 | 同上 |
| 34 | "What we do not do is **keep it**." | 存進本機目錄就是 keep | 區分「我們的伺服器不留」與「你的機器上會留，且由你控制」 |
| 44 | "Because **nothing is retained**, withdrawal leaves nothing behind to erase" | 會有本機檔案要刪 | 撤回方式改成：撤銷 Google 授權 ＋ 刪除本機資料夾，並寫出路徑 |
| 51 | "performs **no outbound network requests**" | 會呼叫 `accounts.google.com`、`oauth2.googleapis.com`、`health.googleapis.com` | 收窄成「只對你授權的那個來源、只在你要求同步時」，並列出網域 |
| 56 | "**no database, no cache, no log file, and no history**" | 原始回應與正規化結果會落地 | 改成「存什麼、存哪、誰能讀、怎麼刪」的正面描述 |
| 62 | "No third-party code. **zero dependencies**" | **這句撐得住** | **不改——但它變成設計約束，見下** |
| **66** | **"No accounts… no user identifier"** | 會有 Google 授權與 refresh token | 改成「我們沒有帳號系統；你授權的是 Google 帳號，token 存在你機器上，我們看不到」 |
| 73 | "Evidence exists **only in memory** for the duration of a single tool call" | 失真 | 同 34 的區分 |
| 75–83 | **Data retention 整節** | 前提整個換掉 | 重寫：存什麼、存多久、怎麼自己刪、我們這端仍然零留存 |
| 91 | "We have nothing to share, **because we do not retain**" | 結論成立、理由失真 | 理由換成「資料沒離開你的機器」 |

### 不必改的兩處

- 第 4 行 `Applies to:` 仍然是 desktop extension，範圍沒變。
- 第 105–111 節那個 floor（minimum evidence, computed and discarded, never retained）**綁的是 hosted**，
  本機取用不影響它。但要**加一段區分**：本機版會在你的機器上留東西、hosted 不會。

---

## 二、`evidra/README.md`（公開對外那份）

| 行 | 現在寫的 |
|---|---|
| 10 | "It runs on your own machine, and it **does not retain your evidence**." |
| 25 | "link an account. It **reads what you or your assistant hand it in the call**" |
| 121 | "Evidra runs locally and **does not retain your evidence**." |
| 128–129 | "performs **no outbound network requests**, **does not persist** your evidence, and has **no dependencies, telemetry, model calls, or accounts**." |

「runs on your own machine」本身**仍然對**，不用動；失真的是它後面接的那半句。

**這份刻意不寫測試數字**（見 CLAUDE.md「兩個 repo 的分工」）——**改的時候不要順手補上**。
要同步的是敘述句，`review:phase` 的 G1 讀不到敘述句，這是它的已知盲區。

---

## 三、`fitness-mcp/README.md`

| 行 | 現在寫的 |
|---|---|
| 91 | "Evidra runs locally on your own machine and **does not retain your evidence**." |
| 94 | "…**We do not retain**, sell, use for training…"（floor 引文，綁 hosted，**這句不改**） |
| **97** | **"Evidra never fetches your data"** — 與 PRIVACY.md 第 15 行是同一句話的副本 |
| 102 | "performs **no outbound network requests**" |
| 104 | "**No database, no cache, no log file**" |

兩份 README 是不同文件、不必逐字同步，但**同一件事不能講得互相矛盾**。

---

## 四、`fitness-mcp/manifest.json`

`long_description` 寫著：

> "the server computes; it **does not fetch**, store, or retain evidence"

**同一句錯話的第三個副本，而且這個檔會進 bundle。**

---

## 一條要一起訂下來的設計約束

`PRIVACY.md` 第 62 行的 **"zero dependencies"** 是這次唯一撐得住的一句——**前提是 OAuth 與 HTTP
只用 Node 標準庫寫**（`fetch`、`node:crypto`、`node:http`）。

**一旦為了 OAuth 裝進第一個套件，這句也一起沒了**，而它同時出現在 `evidra/README.md:128`。
所以這不只是偏好，是寫進政策的宣稱。

---

## 還沒查的

- **`data/private` 落地要不要加密**：Google 的 Developer and User Data Policy 要求 stored user data
  加密，條文含「Stored on portable devices or portable electronic media」。
  **筆電算不算 portable device，我沒查到定義。** 若算，明文 JSON 落地就與政策有落差，
  這會回頭影響上面第 56 行怎麼寫。
- **evidra 那份 README 有沒有第 5 處**：上面四處是 grep 命中的，**沒有逐行讀完全文**。
