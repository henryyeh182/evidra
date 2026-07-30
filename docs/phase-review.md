# 階段任務完成審查

> 每次要宣告「某個 Phase／偏差／修正完成」之前走一次。
> 也用在回頭抽查：**已經宣告完成的東西，現在還成立嗎？**
>
> 這份文件不問「做得好不好」，只問兩件事：說的跟做的一不一致、有沒有往
> [Design Manifesto](design-manifesto.md) 以外的方向漂。

---

## 步驟 0 — 先讀，不要憑印象

順序有意義：先知道「上次學到什麼」，再知道「現在該是什麼樣子」，最後才看程式。

| # | 讀什麼 | 為什麼在這個位置 |
|---|---|---|
| 1 | `~/.claude/projects/-Users-henryyeh-dev-fitness-mcp/memory/MEMORY.md` 及其索引的檔案 | 跨 session 的結論與踩過的坑。跳過這步會重複已經做過的決定 |
| 2 | [CLAUDE.md](../CLAUDE.md) | 每個 session 自動載入的紀律，含三條反覆失守的 |
| 3 | [README.md](../README.md) | 對外的定位敘述——漂移最先出現在這裡 |
| 4 | [design-manifesto.md](design-manifesto.md) | 位階最高。與其他文件衝突時以它為準 |
| 5 | [fitness-mcp-implementation-plan.md](fitness-mcp-implementation-plan.md) | 完成度宣稱的正本 |
| 6 | [user-journey.html](user-journey.html) | 對外承諾的產品長相。它畫的東西必須真的存在 |

其他機器的記憶在 `~/dev/claude-brain/memory/<機器名>/`，交接在 `~/dev/claude-brain/journal/`。

## 步驟 1 — 跑機械 gate

```bash
npm run review:phase
```

一次跑七條，任一條紅就 exit 1：

| Gate | 守什麼 | 對應 |
|---|---|---|
| G0 | 五份 repo 內的真相文件都在（memory 不是 repo 檔案，由步驟 0 人工把關） | — |
| G1 | 文件寫的數字＝工具跑出來的數字 | 已漂移過兩次 |
| G2 | 對外 tool ≤10 且全在決策白名單 | 原則 5 · D-TOOL · R2 |
| G2b | 每個對外 tool 說得出使用者會怎麼問，並說明證據從哪來 | 分發面——host 在一堆 connector 裡挑，靠的就是描述 |
| G3 | 每個 tool 的輸出契約帶得動自我解釋 | 承諾 A |
| G4 | 五種決策型別在引擎／契約／user-journey 三處一致 | Decision ≠ Recommendation |
| G5 | 有 parser 的來源，registry／source schema／scenario 都在 | schemas/README 自訂規則 |
| G6 | runtime 沒有寫死的日曆日 | P5 |
| G7 | 系統內沒有 LLM，也不落地健康資料 | D-LLM · D-DATA |

再跑既有的三支（它們守的是品質不是定位）：

```bash
npm test && npm run eval && npm run audit:graph
```

**新增對外 tool 時**：白名單在 `scripts/review-phase.js` 的 `APPROVED_DECISION_TOOLS`。
改它之前先過下面的 GPT-6 判準——白名單是刻意要人動手改的，不是自動同步的。

## 步驟 2 — 判斷題（機械驗不到的那半）

每題只有「是／否／不確定」。任何一題答「否」，就不能宣告完成；答「不確定」要寫下要查什麼。

### Q1 · GPT-6 判準

> 如果明天 GPT-6 已經知道所有運動知識，這次做的東西還有存在價值嗎？

有價值的只有三樣：**證據**（沒有這個人的資料）、**計算**（沒有執行縱向運算）、
**保證**（確定性過濾器不會被說服繞過）。答案若是「它讓回答更完整／更方便」，那是知識查詢，砍掉或降為內部。

### Q2 · Decision ≠ Recommendation

新增或改動的輸出，是否**對既有狀態的變更**（from → to），而不是憑空發出的建議？
是否需要知道「今天原本要做什麼」？`keep` 也算決策，但要說出為什麼維持。

### Q3 · 任何單一來源都必須能用

這次的改動，對**只有 Strava 的跑者**、對**不戴錶睡覺的人**，是否仍產得出決策？
敘述時有沒有把某組來源寫成「缺這缺那」——缺漏只該出現在 `signalCoverage.missing` 與
confidence，不當敘事主軸。

> 已偏移三次。這題不是形式。

### Q4 · 沒有拿單一使用者的資料特性當設計依據

門檻、權重、常數，是否來自運動科學或匯出檔的形狀，而**不是**某個人的資料好不好看？
模擬的生理數值不是 ground truth，不得用來回頭 fit `readiness < 40` 這類門檻。

### Q5 · 退化是否誠實

證據不足時是回退化標記（`insufficient_history`／`signalCoverage.missing`／`limits`），
還是猜一個看起來合理的數值？替代品沒保住原本的訓練刺激時，有沒有寫進 `limits`？

### Q6 · 承諾 B

這次的價值敘述是用**決策品質**講的，還是用 connector 數／tool 數／動作數講的？
後者是把自己重新定義成內容庫（R2）。

### Q7 · 定位邊界

有沒有不小心蓋出：健身 App／社群／聊天介面／內容資料庫／資料湖 的一角？
新增的檢索能力，是決策的中間層，還是又一個 `search_*`？

## 步驟 3 — 回頭抽查已宣告完成的項目

宣告完成之後會壞掉的，是**只驗過一次**的那些。下表的第三欄是關鍵：有常設證據的，
壞掉時 CI 會叫；沒有的，只能靠這份文件定期回頭看。

| 已宣告完成 | 常設證據 | 壞掉時會不會有人知道 |
|---|---|---|
| D1 證據由 tool call 傳入 | `packages/evidence` 測試 ＋ 回應帶 `provenance` | 🟡 **沒有 gate 擋「新程式碼又自己去讀健康資料檔」**——只有 G7 擋寫檔 |
| D2 五層決策 | `assertValidDecision` ＋ G3 ＋ G4 | ✅ |
| D3 工具面 14 → 6 | G2 白名單 | ✅ |
| D4 `recommend_workout` 下架 | G2（在白名單外且標 deprecated） | ✅ |
| Phase 3 MCP 協定相容 | `apps/mcp-server/test/server.test.js` | ✅ |
| 4.1 Training Load ＋ detraining 軸線 | `packages/training-load` 測試 | ✅ |
| 4.2 個人基線取代寫死常數 | `computePersonalBaselines` 測試 | 🟡 沒有 gate 擋「又冒出一個族群常數當唯一來源」 |
| 4.3 進退階 | `assertValidProgressions` 四條不變量 ＋ `audit:graph` 覆蓋率 gate | ✅ |
| 4.3 三層命名 | `assertUniqueExerciseNaming` ＋ eval plan → catalog gate | ✅ |
| 4.3 訓練目標 | `assertValidTrainingGoals` 四條不變量 ＋ `audit:graph` 兩條 gate | ✅ |
| Garmin 方言 | source schema ＋ registry ↔ parser 一致測試 ＋ scenarios | ✅ |
| Strava bulk export 方言 | `stravaExport.test.js`（含 registry ↔ parser 一致） | 🟡 **G5 紅**：缺 source schema 與 scenario；且與 Strava API 方言之間**沒有等價測試** |
| P5 預設日期由 server 解析 | G6 ＋ `packages/domain/test/dates.test.js` | ✅ |

**這張表的用法**：🟡 那幾列是下次有人動到相關程式時，最可能無聲壞掉的地方。
補上常設證據比再驗一次更有價值。

## 步驟 4 — 判定

| 結果 | 意思 |
|---|---|
| 機械 gate 全綠 ＋ 判斷題無「否」 | 可以宣告完成，並把數字寫進 plan |
| 機械 gate 有紅 | **不得宣告完成**。紅的是宣稱與現況的落差，不是待辦功能 |
| 判斷題有「否」 | 收回宣稱，或在 plan 寫明「完成的是哪一部分、沒完成的是哪一部分」 |
| 判斷題有「不確定」 | 先去查。依 CLAUDE.md：沒有證據就不要輸出因果與解法結論 |

宣告完成時，plan 裡要一起更新的：該 Phase 的狀態記號、§1 的數字、§3 護城河那列、
§7 工程原則那列。G1 會在下次跑的時候抓沒改到的。

## 審查紀錄

| 日期 | 審查對象 | 機械 gate | 判斷題 | 結論 |
|---|---|---|---|---|
| 2026-07-29 | 機制建立時的基線掃描 | G1 ✖ → 已修（README 兩處測試數 184／138 → 221）· **G5 ✖ 未修**（Apple Health／Strava 缺 source schema 與 scenario）· 其餘 ✔ | 未走 | 兩條紅都是既有漂移，非本次改動造成。G5 是實作工作，列入待辦 |
| 2026-07-30 | 當日全部工作：P5 日期、review:phase 機制、心率區間分佈、user-journey 授權段、提議評估、OAuth resource server、Phase 8 重寫、tool 描述 ＋ G2b | **G5 ✖**（Apple Health／Strava 缺 source schema 與 scenario）· 其餘八條 ✔ · 247 tests / eval / audit 全綠 | **Q4 不確定**（`timeInZone.js:106` 的 `maxSampleGapSeconds ?? 30` 無來源，已 commit）· **Q5 否**（`model.js:154-155` 的 `rpe ?? 5` 與 `trainingLoad ?? 分鐘數` 仍在）· 其餘五題 ✔ | **不得宣告完成。** 程式可 commit，但「做完了」不成立。另抓到三處宣言 vs 計畫衝突（Phase 6 三元組、D5 取消理由、Phase 8 計價單位），以及 user-journey 未寫入今天出貨的兩個能力 |
