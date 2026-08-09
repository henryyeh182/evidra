# Demo prompts 與 sample evidence

裝好 `evidra.mcpb` 之後，把底下任何一段貼進 Claude Desktop 就會拿到決策。

**每一段的輸出都是引擎真的跑出來的，不是示意。** 重跑指令在最後一節，
數字對不上就是程式或這份文件其中一邊壞了。

---

## 為什麼沒有「連接你的帳號」這一步

Evidra 不連任何廠商雲端、不持有 OAuth token、不保存任何健康資料。
證據以**參數**進入 tool call：Claude 讀你貼的檔案或你講的話，整理成參數傳進來，
算完就沒了。所以底下每一段都是自足的——貼上去就能跑，不需要任何帳號。

---

## 1 · 零設定：只用嘴巴講

不需要任何檔案。這是沒有裝任何 connector 的人的起點。

```
我昨天跑了 80 分鐘，感覺蠻累的，昨晚睡了 6 小時。
今天課表排的是 VO₂max 間歇 60 分鐘，我還該照做嗎？
```

實際輸出：

| | |
|---|---|
| decision | `keep` / `proceed_as_planned` |
| reason | Readiness 75 and target-muscle fatigue 0 are both within range, so the session runs as planned. |
| confidence | **low** |
| 缺的訊號 | `hrv` · `restingHeartRate` · `stress` |

**這一則的重點是它沒有改課表。** `keep` 也是決策——「檢查過了，可以執行」，
不是「沒事發生」。而且它老實說信心低：只有睡眠一個恢復訊號，另外三個沒有。
**一句「今天照練」配上「我只看得到這些」，才是誠實的答案。**

---

## 2 · 只有 Strava：完全沒有恢復訊號

Strava 不量 HRV、不量睡眠。它有的是每一場訓練的負荷——這樣就夠做出決策。

> 附上 [`evidence-strava-only.json`](evidence-strava-only.json)

```
這是我最近四週的 Strava 訓練紀錄（附檔）。
今天排的是 Threshold Repeats 60 分鐘高強度，該照跑嗎？
```

實際輸出：

| | |
|---|---|
| decision | `adjust` / `reduce_today_intensity` |
| action | Threshold Repeats 60min **high → moderate**（`changed: focus, intensity`）|
| 治理規則 | **EVD-R-006** · acute:chronic workload ratio = **1.61**（門檻 1.4）|
| confidence | **low** |
| 缺的訊號 | `sleep` · `hrv` · `restingHeartRate` · `stress`（全部）|

問一句「這個 1.4 是誰定的」，會拿到 Gabbett 2016 的引用、
**以及同時載入的反對意見**（Impellizzeri 2020、Lolli），
還有一句「1.4 兩個發表數字都不是，是我們挑的」。

---

## 3 · 只有 Garmin：廠商複合分數當一等證據

Body Battery 是 Garmin 自己算的分數。Evidra **不重算它**——
錶在手腕上，它整合了我們看不到的訊號。

> 附上 [`evidence-garmin-hard-day.json`](evidence-garmin-hard-day.json)

```
這是我今天的 Garmin 數據（附檔）。今天排 Tempo Run 50 分鐘高強度。
```

實際輸出：

| | |
|---|---|
| decision | `adjust` / `reduce_today_intensity` |
| action | Tempo Run 50min **high → moderate** |
| 治理規則 | **EVD-R-002** · readiness score = **48**（門檻 60）|
| confidence | **high** |
| 缺的訊號 | 無 |

**跟第 2 則對照著看**：同樣是 `adjust`、同樣降一級，但**理由完全不同**
（負荷爬太快 vs 今天恢復不良），而且這次信心是 high——
恢復訊號四項齊全，還帶著 Body Battery。

---

## 4 · 只有 Oura：沒有訓練負荷，一樣做得出決策

Oura 不算訓練負荷。**所以我們也不算**——不會拿時長乘強度標籤湊一個數字出來。

> 附上 [`evidence-oura-only.json`](evidence-oura-only.json)

```
這是我今天的 Oura 數據（附檔）。今天排了低強度的 VO₂max 間歇 60 分鐘，
我感覺很好，可以加強度嗎？
```

實際輸出：

| | |
|---|---|
| decision | **`advance`** / `increase_today_intensity` |
| action | VO₂max Intervals 60min **low → moderate** |
| 治理規則 | **EVD-R-008** · readiness score = **96**、目標肌群疲勞 0 |
| confidence | **low** |
| 缺的訊號 | `stress` |

**這則是往上調，不是往下。** 決策不是只會叫你少練——證據支持就往上加。
信心仍是 low：沒有任何訓練負荷資料，所以 ACWR 那一側是空的。

---

## 5 · 傷病替代：硬過濾，不是建議

```
我膝蓋不舒服，今天的深蹲能換成什麼？我有槓鈴、深蹲架跟啞鈴。
```

實際輸出：

| | |
|---|---|
| decision | `substitute` / `replace_contraindicated_exercise` |
| action | Back Squat → **Bodyweight Squat** |
| 其他選項 | Goblet Squat |
| 治理規則 | **EVD-R-012** · 剔除 **Front Squat**（`matchedTags: ["knee"]`） |
| reason | Movements contraindicated for knee were **hard-filtered out: Front Squat**. · The substitute still serves the original training goal (strength, hypertrophy). |
| confidence | high |

**「hard-filtered」是字面意思**：對膝蓋有禁忌的動作不是被扣分，是根本不在候選名單裡。
模型可以被說服繞過安全規則，確定性的過濾器不會。

**器材列到深蹲架是有意的。** Front Squat 要槓鈴加深蹲架，少一樣它就會先被器材篩掉——
那一次替代就成了器材問題，硬過濾根本沒開火，這一則也就證明不了自己的標題。
原本這裡寫「我只有啞鈴跟徒手」，正是那個情況。

---

## 6 · 只有 Whoop：把課表拿走，不是調軟

> 附上 [`evidence-whoop-flat.json`](evidence-whoop-flat.json)

```
這是我今天的 Whoop 數據（附檔）。今天排的是 VO₂max 間歇 60 分鐘高強度，
我還是照做嗎？
```

實際輸出：

| | |
|---|---|
| decision | **`defer`** / `swap_to_recovery` |
| action | VO₂max Intervals 60min high → **Recovery + mobility 30min low** |
| changed | `focus` · `type` · `durationMinutes` · `intensity` · `exercises` |
| 換上的動作 | Recovery Walk · Mobility Flow |
| 治理規則 | **EVD-R-001** · readiness score = **6** |
| reason | Readiness 6 is below 40: no training load today, swapped to a recovery session of at most 30 minutes. |
| confidence | **high** |
| 缺的訊號 | `stress` |

**這則和前面五則的差別在 `changed` 那一列**：五個欄位全動，連運動項目都換掉。
其他幾則最多動兩三項。`adjust` 是把課表調軟，**`defer` 是把課表拿走換成別的**——
兩者是不同的決策型別，不是程度差異。

**而且 confidence 是 high。** Whoop 不量壓力，所以 `stress` 缺著，但四個恢復訊號裡
有三個加上廠商自己的 recovery 分數都在——**證據足夠時它照樣敢把一整堂高強度課取消**。

---

## 檔案

| 檔案 | 是什麼 |
|---|---|
| [`evidence-strava-only.json`](evidence-strava-only.json) | 24 場跑步、只有 `trainingLoad`，零恢復訊號 |
| [`evidence-garmin-hard-day.json`](evidence-garmin-hard-day.json) | 四項恢復訊號 ＋ `vendorAssessments` 的 Body Battery ＋ 一場硬跑 |
| [`evidence-oura-only.json`](evidence-oura-only.json) | 睡眠／HRV／靜息心率 ＋ Oura Readiness，**沒有任何訓練** |
| [`evidence-whoop-flat.json`](evidence-whoop-flat.json) | HRV／靜息心率／睡眠 ＋ WHOOP Recovery 12%，前一天一場硬跑——**恢復訊號全面見底** |
| [`scheduled-session.json`](scheduled-session.json) | 今天排定的課表——**沒有這個就沒有決策，只有建議** |

`scheduled-session.json` 值得單獨講一句。沒有它，`decide_session` 不會編一個課表出來，
而是回 `intent: no_scheduled_session`、`action.from` 與 `action.to` 都是 `null`，並附上這句：

> Nothing is scheduled today, so there is no prior state to change.
> **This is a recommendation question, not a decision.**

**決策是對既有狀態的變更，前提是知道原本要做什麼。** 引擎自己講得出這條界線在哪，
而不是假裝跨過去了——問「今天練什麼」該用 `generate_plan`。

`vendorAssessments` 是獨立於 `healthMetrics` 的欄位。Body Battery、Oura Readiness、
WHOOP Recovery 都放這裡；放錯到 `healthMetrics` 會被拒絕並告訴你正確欄位。

## 重跑

日期錨在 `2026-08-06`，樣本裡的時間戳都相對於它，所以輸出不會隨今天是幾號而變。

```bash
node --test "apps/mcp-server/test/*.test.js"
```
