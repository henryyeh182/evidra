# /eval/scenarios — Source-schema simulation

模擬場景的目的是**讓 Semantic Fitness Layer 學會讀懂各家 schema**（護城河 #1），
不是拿模擬資料回頭校準決策門檻。

> **這裡不做參數調校。** 場景裡的生理數值只是「貨物」——用來確認它有沒有被正確
> 搬運到 canonical vocabulary。任何「readiness 應該低於 40」這類斷言都不屬於這裡：
> 那是拿捏造的人去 fit 引擎，既不可驗證，也違反 [design manifesto](../../docs/design-manifesto.md)
> 承諾 B（價值以決策品質衡量，不以 connector 數衡量）。

## 場景的軸線是「匯出檔的形狀」

五種形狀，每個來源各考一次自己的方言版本：

| Scenario | Garmin 的形狀考什麼 | Google Health Takeout 的形狀考什麼 |
|---|---|---|
| `complete_export` | registry 宣告的訊號完整匯出時真的解析得出來；單位換算 | 同左，含 Fitbit 複合分數（sleep_score、Stress Score、Cardio Load）都在的樣子 |
| `sentinels_and_gaps` | `level: NONE`、`restingHeartRate: 0`、`averageStressLevel: -1`、整晚沒有 sleep record | `0.0` bpm、`CALCULATION_FAILED` 的 stress 列、睡眠檔沒有那一晚的列——手機還在計步 |
| `dialect_equivalence` | 同一天 `{typeKey}` vs 裸字串、`calendarDate` vs epoch | 同一個每日靜息心率寫成 ISO CSV（local midnight 以 UTC 表示）vs 按月 JSON（`04/06/26`）|
| `lossy_export` | 無 EPOC load、有時長無評分、bodyBattery 缺 HIGHEST | Garmin 同步的現實：複合分數檔只剩表頭、cardio_load 全 0、session 心率全 0——load 退回 active energy 並說明 |
| `sparse_wear` | 一週只戴一兩次 | 錶三天量一次（實測匯出 120 天只有 47 天有靜息心率），手機持續計步 |

共同紀律：沒有紀錄的日子不得憑空生出讀數，coverage 要誠實縮水。

**OAuth API 來源（Oura／WHOOP）考的是同五種形狀，但形狀長得不一樣**——它們沒有匯出檔，
呼叫端交來的是已經解析好的 JSON，所以「哨兵值」在這裡是**閘門**而不是特殊數值：

| Scenario | Oura 的形狀考什麼 | WHOOP 的形狀考什麼 |
|---|---|---|
| `complete_documents` | 四個端點都給，registry 宣告的訊號都要出得來 | recovery／sleep／cycle／workout 全部 `SCORED` |
| 閘門那一種 | `naps_and_rejected`：`sleep`／`late_nap`／`rest`／`deleted` 四種都不是一夜，只有 `long_sleep` 是 | `pending_scores`：`PENDING_SCORE`／`UNSCORABLE` 沒有 `score` 物件，**當 0 讀會報出「整晚沒睡」** |
| 端點混淆 | `scorecard_only`：只給 `daily_sleep`（記分卡）不給 `sleep`（量測），時長／HRV／心率必須回報 missing | `calibrating`：`user_calibrating` 為真時扣住複合分數，但保留底下的 HRV 與靜息心率 |
| 單位陷阱 | `unloaded_workouts`：Oura 不算任何負荷，`trainingLoad` 必須是 `null` | `restless_nights`：在床 8h、睡著 5h30m，**讀成在床時間會高估兩個半小時** |
| `sparse_wear` | 戒指三天戴一次 | 手環三天戴一次 |

**沒有 `dialect_equivalence`**：這兩家各只有一種方言（自家 API），沒有第二種寫法可以對照。
有匯出檔的四家才考這一項。

## 斷言的類型（只有這幾種）

1. **命名**：emit 出來的每個訊號都在 `CANONICAL_SIGNALS` 裡，且帶 `source: "garmin"`。
2. **單位**：`sleepTimeSeconds / 3600 = 小時`、`duration ms → 分鐘`，與 registry 宣告一致。
3. **Registry ↔ Parser 一致**：`VENDOR_SCHEMAS.garmin` 宣告的每個 signal，完整匯出時必須產出。
4. **Sentinel**：`-1`／`0`／`NONE` 不得成為讀數。
5. **誠實**：沒有的訊號出現在 `signalCoverage.recovery.missing`／`signalCoverage.training.missing`，不是被填成中間值。
6. **決策仍成立**：不論形狀多殘缺，`evidra_decide_session` 仍回得出帶 `reason` 與 `evidence` 的決策
   （manifesto 承諾 A）。**不斷言決策內容或數值。**

## 執行

```bash
npm run simulate:garmin
npm run simulate:google-health
npm run simulate:oura
npm run simulate:whoop
```

```bash
npm run simulate:garmin -- --scenario sentinels_and_gaps --json
npm run simulate:whoop -- --scenario restless_nights --json
```

同一份 runner 由 [`../test/garminScenarios.test.js`](../test/garminScenarios.test.js)／
[`../test/googleHealthScenarios.test.js`](../test/googleHealthScenarios.test.js)
在 `npm test` 內執行，所以 CLI 印出來的就是被斷言的內容。

## 檔案

- [`garmin.js`](garmin.js) — 場景（形狀 ＋ 檢查）與 Garmin dialect 的 renderer
- [`run.js`](run.js) — Garmin 的完整路徑：raw → `/schemas/sources` 驗證 → 正規化 →
  `/schemas/evidence` 驗證 → 經 JSON-RPC 呼叫 `evidra_assess_fitness_state` / `evidra_decide_session`
- [`google-health.js`](google-health.js) — Google Health Takeout 的場景與 renderer
  （產出的是檔案 bundle：CSV ＋ 按月 JSON，多一步 `parseGoogleHealthExport`）
- [`google-health.run.js`](google-health.run.js) — 同一條路徑的 Google Health 版
- [`oura.js`](oura.js)／[`whoop.js`](whoop.js) — 兩家 OAuth API 來源的場景
- [`apiVendor.run.js`](apiVendor.run.js) — **Oura 與 WHOOP 共用的 runner**。
  有匯出檔的四家各自有 runner，因為各有自己的解析步驟（zip／CSV 包／XML 串流）；
  這兩家沒有——呼叫端交來的 JSON 已經是形狀好的，所以一份 runner 服務兩家，
  差異全部留在場景檔裡。**檢查是宣告式的**（場景寫「適用哪幾種斷言」，runner 知道怎麼跑），
  這樣場景長不出一條會斷言門檻的檢查。

## 加一個新來源時

1. 在 `packages/evidence/src/schemaRegistry.js` 補上該來源的欄位對應。
   **若該家有公開的 OpenAPI，先抓下來對**——Oura 與 WHOOP 都有，而且 registry
   原本憑印象寫的 12 條映射裡有 4 條是錯的，其中一條把 1–100 的分項評分當成 HRV 毫秒值。
2. 在 `schemas/sources/<vendor>.export.json`（匯出檔）或 `<vendor>.api.json`（API 回應）
   寫下它的原始格式（含缺洞與 sentinel）。
3. 寫 parser，讓「registry 宣告的訊號都解析得出來」這條檢查通過。
4. 加場景：完整、sentinel／閘門、有損、稀疏，以及**若該家有第二種方言**才加方言等價。
5. 在 `package.json` 加一條 `simulate:<vendor>`。
