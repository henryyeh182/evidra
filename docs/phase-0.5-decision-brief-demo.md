# Phase 0.5 — Today’s Decision Brief 實跑與截圖清單

這五個案例用來驗證 Pacevera 的視覺化 UI 與產品差異。每個案例都用同一段 prompt，分別執行：

1. 一般 AI：停用 Pacevera，不呼叫任何 fitness decision tool。
2. Pacevera：安裝 v0.5.0，附上指定 Evidence，讓 AI host 呼叫 Pacevera。

每個案例各截一張畫面，保留完整 prompt、輸入檔名、AI 回答與 Pacevera 結構化輸出。不要把一般 AI 的結果改寫成看起來像 engine output。

## 五個核心案例

| 編號 | Decision type | 案例 | Evidence | 期待的 from → to |
|---|---|---|---|---|
| 1 | `keep` | 證據不足但仍可照原定執行 | 口述 | VO₂max Intervals 60min high → 原定執行 |
| 2 | `adjust` | Garmin readiness 低，降一級 | `evidence-garmin-hard-day.json` | Tempo Run 50min high → Tempo Run 50min moderate |
| 3 | `advance` | Oura readiness 高，允許加強度 | `evidence-oura-only.json` | VO₂max Intervals 60min low → VO₂max Intervals 60min moderate |
| 4 | `substitute` | 膝蓋限制，硬過濾禁忌動作 | 口述 | Back Squat → Bodyweight Squat |
| 5 | `defer` | 恢復狀態過低，整堂課換成 recovery | `evidence-whoop-flat.json` | VO₂max Intervals 60min high → Recovery + mobility 30min low |

---

## 01 · Keep：證據不足，但不憑空改課表

### Prompt

```text
我昨天跑了 80 分鐘，感覺蠻累的，昨晚睡了 6 小時。
今天課表排的是 VO₂max 間歇 60 分鐘，我還該照做嗎？
請明確說明：原定課表、今天的決策、使用了哪些訊號、缺少哪些訊號，以及信心程度。
```

### Pacevera 預期

- decision：`keep`
- action：`VO₂max Intervals 60min high → proceed as planned`
- 缺少：`hrv`、`restingHeartRate`、`stress`
- confidence：`low`

### 截圖重點

一般 AI 是否直接給建議；Pacevera 是否能說出「keep 也是決策」，並誠實列出 coverage 不足。

---

## 02 · Adjust：Garmin readiness 低，降一級

### 附件

`examples/evidence-garmin-hard-day.json`

### Prompt

```text
這是我今天的 Garmin 數據（附檔）。
今天排 Tempo Run 50 分鐘高強度。
請判斷今天是否應照做，並輸出原定課表、調整後課表、決策理由、缺少的訊號與信心程度。
```

### Pacevera 預期

- decision：`adjust`
- action：`Tempo Run 50min high → Tempo Run 50min moderate`
- rule：`EVD-R-002`
- evidence：readiness `48`
- confidence：`high`
- 缺少：無

### 截圖重點

兩邊是否都能說「降低強度」；只有 Pacevera 應能穩定呈現 decision type、rule、exact from → to 與 evidence binding。

---

## 03 · Advance：readiness 高，允許加強度

### 附件

`examples/evidence-oura-only.json`

### Prompt

```text
這是我今天的 Oura 數據（附檔）。
今天排了低強度的 VO₂max 間歇 60 分鐘，我感覺很好，可以加強度嗎？
請說明是否適合提高強度，以及 training load 或其他缺少的訊號會如何影響信心。
```

### Pacevera 預期

- decision：`advance`
- action：`VO₂max Intervals 60min low → moderate`
- rule：`EVD-R-008`
- evidence：readiness `96`、target muscle fatigue `0`
- confidence：`low`
- 缺少：training load／`stress`

### 截圖重點

一般 AI 是否只會保守地說「可以試試」；Pacevera 是否能做出往上調的結構化決策，同時因缺少 training load 而降低信心。

---

## 04 · Substitute：膝蓋限制不是一般建議

### Prompt

```text
我膝蓋不舒服，今天的 Back Squat 能換成什麼？
我有槓鈴、深蹲架跟啞鈴。
請保留原本的訓練目標，列出主要替代動作、其他可接受選項，並說明哪些動作因膝蓋限制被排除。
```

### Pacevera 預期

- decision：`substitute`
- action：`Back Squat → Bodyweight Squat`
- alternative：`Goblet Squat`
- rule：`EVD-R-012`
- hard filter：`Front Squat` 被排除
- confidence：`high`

### 截圖重點

一般 AI 可能列出一串看似合理的動作；Pacevera 必須顯示 hard-filtered movement，證明安全限制不是排序偏好，而是候選集合外的硬邊界。

---

## 05 · Defer：把整堂課換掉

### 附件

`examples/evidence-whoop-flat.json`

### Prompt

```text
這是我今天的 Whoop 數據（附檔）。
今天排的是 VO₂max 間歇 60 分鐘高強度，我還是照做嗎？
請比較「降低強度」與「延後整堂課」的差異，並給出今天實際要執行的 from → to、理由、缺少訊號與信心程度。
```

### Pacevera 預期

- decision：`defer`
- action：`VO₂max Intervals 60min high → Recovery + mobility 30min low`
- changed：`focus`、`type`、`durationMinutes`、`intensity`、`exercises`
- rule：`EVD-R-001`
- evidence：readiness `6`
- confidence：`high`
- 缺少：`stress`

### 截圖重點

這是最能展示 Pacevera 差異的案例：`adjust` 是把課表調軟，`defer` 是把整堂課拿走換成 recovery session。畫面必須能看出五個欄位都改變，而不是只改了 intensity。

---

## 統一截圖規格

每個案例建議保留兩張截圖：

1. **一般 AI 回答**：完整顯示 prompt、回答、是否使用資料、是否說明不確定性。
2. **Pacevera Today’s Brief**：完整顯示 `from → to`、decision、evidence、reason、missing signals、confidence、rule／trace。

檔名建議：

```text
01-keep-general-ai.png
01-keep-pacevera-v0.5.0.png
02-adjust-general-ai.png
02-adjust-pacevera-v0.5.0.png
...
```

## 驗收問題

五組截圖完成後，逐組回答：

- 一般 AI 是否容易給出看似合理、但沒有 prior state 的 recommendation？
- Pacevera 是否明確輸出既有課表的變更，而不是重新生成一份 workout？
- `reason` 是否能綁回 evidence 與 rule？
- `missing signals` 是否真的影響 confidence，而不是只出現在附註？
- 五種 decision type 是否在視覺上容易區分？
- 使用者是否一眼看懂 Pacevera 不是另一個 readiness dashboard？

若五組對照仍看不出差異，先調整 Decision Brief UI 與產品敘事，不先增加 metrics 或 connector。
