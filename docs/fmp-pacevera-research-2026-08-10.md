# FMP Fitness AI Connector 與 Pacevera 研究

日期：2026-08-10

## 研究問題

研究第三方工具 [FMP Fitness AI Connector](https://fmp.it.com/en/fitness-ai/)
的產品架構與商業模式，評估是否能用相同方式取得 Garmin Connect data。

Pacevera 與 FMP 的定位不同：

- FMP：接到 ChatGPT / Claude，讓 AI 直接讀取 Garmin 運動與健康資料。
- Pacevera：整理資料，根據 evidence、規則與訓練脈絡，產生可解釋的訓練決策。

## 結論

技術上可以採用類似 FMP 的架構：

```text
Garmin OAuth 授權
  -> Garmin Health / Activity API
  -> 正規化成 Pacevera Evidence
  -> Pacevera Decision Engine
  -> MCP 回傳 ChatGPT / Claude
  -> AI 以自然語言解釋結果
```

但不能直接複製 FMP。Garmin Connect API 需要申請 Garmin Connect Developer Program；商業使用需要 license fee，且 Garmin 對資料保存、傳輸、展示、品牌 attribution 與第三方使用有合約限制。

最重要的產品判斷是：

> FMP 負責把 Garmin Connect 接進來；Pacevera 負責判斷這些資料代表什麼，以及今天的訓練應該怎麼改。

## FMP 的產品架構

FMP 公開資料顯示，它是一個 hosted remote MCP server：

```text
ChatGPT / Claude
       |
       | MCP over HTTPS
       v
FMP Remote MCP Server
       |
       | Garmin OAuth
       v
Garmin Connect / Garmin Health API
       |
       v
Wellness data + activity data
       |
       v
FMP MCP tools
       |
       v
AI 產生自然語言說明
```

公開頁面所宣稱的功能包括：

- 不需本機安裝，支援 ChatGPT 與 Claude 的 web / mobile 介面。
- 使用者在 Garmin 授權頁面登入，FMP 不直接取得 Garmin 密碼。
- 約 12 個針對常見 fitness query 設計的 tools。
- 每日健康資料：步數、心率、睡眠、壓力、Body Battery、HRV。
- 運動資料：跑步、騎車、游泳、配速、距離、卡路里、心率區間、lap splits。
- 身體組成：體重、BMI、體脂、肌肉量。
- 長期趨勢、VO2max、fitness age，以及部分女性健康資料。
- 宣稱使用 Garmin Health API 的 webhook / pull 自動同步。
- 公開頁面宣稱 Free tier 與 Basic $3 / month，以及 5,000+ users。

最後兩項是 FMP 自己的產品宣稱，不能視為已由 Garmin 或獨立資料核實。

FMP 的核心價值不是複雜的決策演算法，而是：

> 把 Garmin 資料變成 ChatGPT / Claude 可以直接使用的上下文。

## Garmin Connect data 是否可取得

Garmin 官方提供的 API 能力大致如下：

| 資料類型 | 官方 API | Pacevera 用途 |
|---|---|---|
| 每日健康 | Health API | 睡眠、心率、壓力、Body Battery、HRV、步數 |
| 運動摘要 | Activity API | 跑步、騎車、游泳、力量訓練 |
| 運動細節 | Activity API / FIT | 配速、心率區間、lap、GPS、逐秒資料 |
| 訓練計畫 | Training API | 未來將訓練計畫寫回 Garmin |
| 女性健康 | Women’s Health API | 視產品範圍支援 |
| 課程 | Courses API | 未來導航或課程同步 |

Garmin Health API 支援 REST、push / pull、客製化 data feeds。使用者同意並將裝置資料同步至 Garmin Connect 後，資料才可透過 API 取得。

主要風險不是技術，而是商務與合規：

1. 必須申請並通過 Garmin 審核。
2. 商業使用需要 license fee。
3. Garmin 可能要求應用審查、修改或特定 attribution。
4. Garmin 可以更新 API 或撤銷 License Key。
5. 健康資料是高度敏感的個人資料。
6. 不可以任意把 Garmin 資料轉成未經核准的通用第三方 API。

因此，如果 Pacevera 要讓 ChatGPT / Claude 讀取 Garmin 資料，應在 Garmin 申請時明確說明：

- 使用場景是 hosted MCP / AI assistant integration。
- ChatGPT、Claude 等是產品使用介面，而不是未授權的資料轉售平台。
- 資料會如何保存、刪除、撤銷授權與傳輸。
- Pacevera 會如何顯示 Garmin attribution。

## Pacevera 與 FMP 的定位差異

| 面向 | FMP Fitness AI Connector | Pacevera |
|---|---|---|
| 核心價值 | 讓 AI 讀到 Garmin 資料 | 把證據轉成可稽核的訓練決策 |
| 產品角色 | Data connector | Decision engine |
| 主要輸出 | 睡眠、跑步、趨勢的自然語言回答 | keep / adjust / substitute / defer / advance |
| AI 角色 | 直接解讀資料 | 理解問題、呼叫工具、表達決策 |
| 規則 | 可能由 LLM 自由歸納 | Rule Library 明確治理 |
| 可重現性 | 依 AI 回答而變動 | 相同 evidence、規則、版本得到相同結果 |
| Provider | 目前以 Garmin 為主 | Garmin、Apple Health、Strava、Oura、WHOOP 等 |
| 護城河 | OAuth、資料同步、MCP 分發 | Evidence Model、Decision Graph、Rule Library |

Pacevera 不應定位成「另一個 AI Coach」，而應定位成：

> Vendor-neutral fitness decision infrastructure：將多來源健康與訓練 evidence 轉成有證據、有規則、有版本、有限制說明的訓練決策。

## 建議架構

```text
Provider Connector Layer
  Garmin OAuth / Apple Health / Strava / Oura / WHOOP
              |
              v
Semantic Fitness Layer
  provider payload -> vendor-neutral Evidence
              |
              v
Pacevera Decision Engine
  Evidence -> Fitness State -> Rule -> Decision -> Action
              |
              v
MCP Presentation Layer
  ChatGPT / Claude 以自然語言解釋結果
```

目前 repo 已具備中間兩層：

- Garmin 與其他 provider parser。
- Vendor-neutral Evidence schema。
- Recovery、readiness、training load 計算。
- Deterministic rule engine。
- Decision trace 與 signal coverage。
- stdio 與 Streamable HTTP transport。

目前缺少的主要是：

- Garmin OAuth authorization flow。
- Garmin API client。
- Token 安全保存，或 user-controlled deployment。
- Webhook / backfill / 同步機制。
- Hosted remote MCP 正式部署。
- Garmin 授權、商業合約與對應 privacy policy。

## 建議產品路線

### 第一階段：Connector-neutral MCP

維持 Pacevera 目前的邊界，讓它接收已取得並正規化的 evidence：

```json
{
  "evidence": {
    "healthMetrics": [],
    "vendorAssessments": [],
    "workouts": []
  }
}
```

資料可來自 Garmin export、第三方 connector、Apple Health、Strava 或使用者手動輸入。

### 第二階段：官方 Garmin Connector

若 Garmin 授權通過，再加入獨立的 connector service：

```text
Pacevera Garmin Connector
  |- Garmin OAuth
  |- Health API
  |- Activity API
  |- webhook / backfill
  |- Garmin attribution
  `- Evidence normalization
```

Connector 與 Decision Engine 仍應分開，避免 Garmin API、token、原始資料與決策規則互相耦合。

### 第三階段：跨來源決策與解釋

差異化範例：

> 你昨晚睡眠 6 小時、Body Battery 42，近三天 training load 上升，且腿部力量訓練已連續兩天，因此今天原定間歇跑改為低強度有氧。以下列出使用的證據、缺失資料與適用規則。

這不是重新念一次 Garmin 數字，而是把多來源 evidence 轉為可解釋、可追溯、可執行的決策。

## 商業模式方向

FMP 的低價訂閱適合「資料查詢 connector」。Pacevera 可以考慮：

- Free：本機 MCP、手動或匯入資料、基本 fitness state。
- Pro：官方 provider sync、歷史趨勢、完整 decision trace。
- Coach / Studio：多使用者、訓練週期、教練 dashboard。
- Enterprise：私有部署、資料不離開組織、客製 Rule Package。

這些目前應視為待驗證方向，不應在 Garmin license、remote OAuth 與部署成本確認前寫成已決定方案。

## 最終判斷

FMP 證明了「在 ChatGPT / Claude 中直接詢問自己的 Garmin 資料」具有產品需求。

但 Pacevera 不應和 FMP 競爭「誰能查到更多 Garmin 欄位」，而應建立更上層的能力：

> 任何 connector 都可以供應資料；Pacevera 將資料轉成有證據、有規則、有版本、有限制說明的訓練決策。

因此：

**技術上可採用 Garmin OAuth + remote MCP 架構；產品上應把 FMP 視為 Connector 參考，而 Pacevera 定位為上層的 vendor-neutral fitness decision infrastructure。**

## 參考資料

- [FMP Fitness AI Connector](https://fmp.it.com/en/fitness-ai/)
- [FMP Connector public listing](https://mcp.so/servers/fitness-ai-connector)
- [Garmin Health API](https://developer.garmin.com/gc-developer-program/health-api/)
- [Garmin Activity API](https://developer.garmin.com/gc-developer-program/activity-api/)
- [Garmin Connect Developer Program](https://developerportal.garmin.com/developer-programs/connect-developer-api)
- [Garmin Connect Developer Program Agreement](https://www8.garmin.com/en-US/GARMINCONNECTDEVELOPERPROGRAMAGREEMENT/GARMINCONNECTDEVELOPERPROGRAMAGREEMENT_EN.pdf)
