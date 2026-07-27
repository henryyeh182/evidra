# /eval/scenarios — Source-schema simulation

模擬場景的目的是**讓 Semantic Fitness Layer 學會讀懂各家 schema**（護城河 #1），
不是拿模擬資料回頭校準決策門檻。

> **這裡不做參數調校。** 場景裡的生理數值只是「貨物」——用來確認它有沒有被正確
> 搬運到 canonical vocabulary。任何「readiness 應該低於 40」這類斷言都不屬於這裡：
> 那是拿捏造的人去 fit 引擎，既不可驗證，也違反 [design manifesto](../../docs/design-manifesto.md)
> 承諾 B（價值以決策品質衡量，不以 connector 數衡量）。

## 場景的軸線是「匯出檔的形狀」

| Scenario | 這個形狀在考什麼 |
|---|---|
| `complete_export` | registry 宣告 Garmin 有的訊號，完整匯出時是否真的解析得出來；單位是否換算 |
| `sentinels_and_gaps` | `level: NONE`、`restingHeartRate: 0`、`averageStressLevel: -1`、整晚沒有 sleep record —— sentinel 不得變成生理值 |
| `dialect_equivalence` | 同一天用兩種寫法（`{typeKey}` vs 裸字串、`calendarDate` vs epoch）必須正規化成**完全相同**的 canonical evidence |
| `lossy_export` | Garmin 常缺的欄位（無 EPOC load、有睡眠時長無評分、bodyBattery 缺 HIGHEST）—— 只能縮小宣稱，不得填補 |
| `sparse_wear` | 一週只戴一兩次 —— 沒有紀錄的日子不得憑空生出讀數，coverage 要誠實縮水 |

## 斷言的類型（只有這幾種）

1. **命名**：emit 出來的每個訊號都在 `CANONICAL_SIGNALS` 裡，且帶 `source: "garmin"`。
2. **單位**：`sleepTimeSeconds / 3600 = 小時`、`duration ms → 分鐘`，與 registry 宣告一致。
3. **Registry ↔ Parser 一致**：`VENDOR_SCHEMAS.garmin` 宣告的每個 signal，完整匯出時必須產出。
4. **Sentinel**：`-1`／`0`／`NONE` 不得成為讀數。
5. **誠實**：沒有的訊號出現在 `signalCoverage.missing`，不是被填成中間值。
6. **決策仍成立**：不論形狀多殘缺，`decide_session` 仍回得出帶 `reason` 與 `evidence` 的決策
   （manifesto 承諾 A）。**不斷言決策內容或數值。**

## 執行

```bash
npm run simulate:garmin
```

```bash
npm run simulate:garmin -- --scenario sentinels_and_gaps --json
```

同一份 runner 由 [`../test/garminScenarios.test.js`](../test/garminScenarios.test.js)
在 `npm test` 內執行，所以 CLI 印出來的就是被斷言的內容。

## 檔案

- [`garmin.js`](garmin.js) — 場景（形狀 ＋ 檢查）與 Garmin dialect 的 renderer
- [`run.js`](run.js) — 走完整條路徑：raw → `/schemas/sources` 驗證 → 正規化 →
  `/schemas/evidence` 驗證 → 經 JSON-RPC 呼叫 `assess_fitness_state` / `decide_session`

## 加一個新來源時

1. 在 `packages/evidence/src/schemaRegistry.js` 補上該來源的欄位對應。
2. 在 `schemas/sources/<vendor>.export.json` 寫下它的原始格式（含缺洞與 sentinel）。
3. 寫 parser，讓「registry 宣告的訊號都解析得出來」這條檢查通過。
4. 加場景：完整、sentinel、方言等價、有損、稀疏——五種形狀。
