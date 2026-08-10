# Pacevera Fitness Decision Engine

Pacevera 是以 Model Context Protocol（MCP）提供的確定性健身決策引擎。它接收由呼叫端整理的訓練與健康證據，計算恢復狀態、訓練負荷與限制條件，並回傳可追溯的決策結果。

本專案的核心決策是「既有課表應如何調整」，而不是在沒有既定課表時產生一般性的訓練建議。對 `decide_session` 而言，輸出會明確描述：

```text
scheduled session (from) -> resulting session (to)
```

每個決策同時包含適用的證據、規則、信心程度、訊號涵蓋範圍與限制條件。

## 功能

- 從標準化 Evidence 計算 readiness、恢復狀態、分肌群疲勞與 ATL/CTL/TSB/ACWR。
- 根據既有課表與當日證據，執行 `keep`、`adjust`、`substitute`、`defer` 或 `advance` 決策。
- 對傷病、器材與可用時間套用確定性的限制與替代規則。
- 產生訓練計畫，並以 caller-owned state 執行計畫預覽與提交。
- 回傳結構化 MCP 結果與 `decisionBasis`，支援規則、讀數、來源與版本的稽核。
- 支援 Apple Health、Google Health Takeout、Garmin、Strava、Oura 與 WHOOP 的資料標準化。

Pacevera 不會代替呼叫端登入或讀取上述服務。資料供應商的匯出檔或 API 回應必須先由呼叫端轉換為本專案的 Evidence 格式，再傳入工具。

## 架構

```text
AI host
  └─ 收集問題與 Evidence，呼叫 MCP tool
       └─ MCP server / local engine
            ├─ Evidence normalization
            ├─ Semantic fitness state
            ├─ Training-load calculation
            ├─ Deterministic rules
            ├─ Decision and planning
            └─ Structured Decision / Action / Reason response
```

模型負責理解使用者問題、整理輸入與呈現結果；決策計算由本專案的程式碼與規則套件完成，不依賴模型產生決策。相同版本的程式、規則與輸入會產生相同結果。

### Decision 與 Recommendation

| 類型 | 說明 |
|---|---|
| Recommendation | 在沒有既定狀態時提出訓練建議。 |
| Decision | 對既有課表或計畫執行可追溯的 `from -> to` 變更。 |

`decide_session` 沒有收到 `scheduledSession` 時，不會自行建立課表，而會回傳 `no_scheduled_session`。沒有既定計畫時，應使用 `generate_plan`。

## MCP tools

公開工具名稱如下；內部實作可能保留 `evidra_` canonical name，但 MCP client 使用公開名稱。

### 決策與計畫

| Tool | 說明 |
|---|---|
| `assess_fitness_state` | 回傳恢復、readiness、分肌群疲勞與訓練負荷狀態。 |
| `decide_session` | 根據既有課表與 Evidence 決定今日課表的變更。 |
| `decide_exercise_substitution` | 根據限制條件決定動作替代，並套用傷病與器材過濾。 |
| `generate_plan` | 產生具週期化結構的訓練計畫。 |
| `preview_adjust_plan` | 對 caller-owned plan 產生 deterministic patch 與差異。 |
| `commit_adjust_plan` | 驗證版本後套用 caller-owned plan 的 patch。 |

### 查詢、追蹤與資料讀取

| Tool | 說明 |
|---|---|
| `get_evidence_coverage` | 回傳 Evidence 的訊號涵蓋範圍與缺漏。 |
| `explain_decision` | 回傳同一個 process 中已產生決策的規則與來源追蹤。 |
| `submit_outcome` | 接收既有 case 的結果；持久化責任在 caller 或 private engine。 |
| `search_exercises` / `get_exercise` | 查詢動作目錄與圖譜關聯。 |
| `search_workouts` / `get_workout` | 查詢結構化訓練內容。 |
| `get_user_profile` | 取得 caller 提供的使用者限制與訓練設定。 |
| `get_training_history` / `get_training_context` | 取得訓練歷史與上下文。 |

`recommend_workout` 為 deprecated tool，不應用於新的整合。

## Evidence 格式

Evidence 必須由呼叫端提供。支援的主要欄位包括：

```json
{
  "profile": { "timezone": "Asia/Taipei", "fitnessLevel": "intermediate" },
  "constraints": {
    "injuries": [],
    "equipment": ["barbell"],
    "availableMinutes": 45,
    "avoidMovements": []
  },
  "healthMetrics": [
    {
      "type": "sleep_duration_hours",
      "value": 7.2,
      "recordedAt": "2026-08-10T08:00:00+08:00",
      "source": "apple_health"
    }
  ],
  "vendorAssessments": [],
  "workouts": [
    {
      "startedAt": "2026-08-09T07:00:00+08:00",
      "durationMinutes": 50,
      "trainingLoad": 72,
      "muscleGroups": ["legs"]
    }
  ]
}
```

輸入規則：

- 只傳送實際取得的訊號；缺少的訊號會列入 `signalCoverage`，並可能降低 `confidence`。
- 沒有訓練負荷的課程不會被當成負荷為 0，也不會納入分肌群疲勞計算。
- RPE 可作為 Evidence 回傳，但不直接參與負荷或疲勞計算。
- 廠商提供的 readiness、recovery 或 Body Battery 等複合分數會以原值使用，不由 Pacevera 重新推算。

## 輸出模型

決策輸出遵循以下層次：

```text
Evidence -> Fitness State -> Decision -> Action -> Reason
```

典型的 `decide_session` 結果包含：

```json
{
  "decision": { "type": "adjust", "intent": "reduce_today_intensity" },
  "action": {
    "from": { "focus": "Tempo Run", "durationMinutes": 50, "intensity": "high" },
    "to": { "focus": "Moderate run", "durationMinutes": 50, "intensity": "moderate" },
    "changed": ["focus", "intensity"]
  },
  "confidence": "high",
  "signalCoverage": {
    "recovery": { "usable": ["readiness"], "missing": ["sleep"] },
    "training": { "usable": ["trainingLoad"], "missing": [] }
  },
  "decisionBasis": {
    "governingRule": {
      "ruleId": "EVD-R-002",
      "measured": { "quantity": "readiness_score", "value": 48 }
    }
  }
}
```

Pacevera 不會以預設值填補缺失輸入。`signalCoverage` 分為 `recovery` 與 `training` 兩組，讓呼叫端能區分恢復訊號不足與訓練負荷資料不足。

## Deployment 與隱私

目前支援或規劃中的部署模式如下：

| Mode | 狀態 | 說明 |
|---|---|---|
| `local-desktop` | available | 透過 stdio 在使用者電腦上執行的 desktop bundle。Pacevera process 不會擷取外部資料、持久化 Evidence 或寫入工具輸入內容。 |
| `user-controlled-private` | planned | 在使用者裝置、私有網路或 VPC 執行完整資料處理與儲存。 |
| `hosted-remote` | no-go | HTTPS resource server readiness scaffold 已存在，但尚未完成可供 production 使用的部署、authorization server 與 hosted privacy controls。 |

本專案會處理呼叫端傳入的健康相關 Evidence，以計算要求的健身決策。local desktop bundle 不連接 Apple Health、Garmin、Strava、Oura 或 WHOOP，也不接受或保存 provider OAuth token。

完整的部署邊界與驗證要求請參閱 [privacy deployment contract](docs/privacy-deployment-contract.md)。

## Transport

| Transport | 啟動方式 | 適用情境 |
|---|---|---|
| stdio | `node apps/mcp-server/src/stdio.js` | Claude Desktop、Claude Code 與本機 MCP client。 |
| Streamable HTTP | `npm run serve:http` | 本機或受控環境中的 remote MCP client。 |

HTTP transport 的設定與 OAuth/JWKS 參數請參閱 [MCP Server](docs/mcp-server.md)。目前的 HTTP/OAuth 程式碼是 resource-server readiness implementation，不代表 hosted production 已完成。

## 安裝與使用

需求：Node.js 20 以上。

```bash
git clone https://github.com/henryyeh182/fitness-mcp.git
cd fitness-mcp
npm install
npm test
```

### Claude Desktop

在 Claude Desktop 設定檔中加入 `mcpServers`，並使用 Node.js 與 repository 的絕對路徑：

```json
{
  "mcpServers": {
    "pacevera": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/fitness-mcp/apps/mcp-server/src/stdio.js"]
    }
  }
}
```

macOS 設定檔位置通常是 `~/Library/Application Support/Claude/claude_desktop_config.json`。請將上述 `mcpServers` 合併到既有設定，不要覆蓋其他欄位。修改後重新啟動 Claude Desktop。

可使用 [examples/README.md](examples/README.md) 的 sample Evidence 與測試情境驗證工具行為。

## 開發指令

```bash
npm test                    # 執行單元、整合與契約測試
npm run eval                # 執行 golden evaluation
npm run harness             # 執行 Decision Harness
npm run review:phase        # 執行階段審查
npm run serve:http          # 啟動 Streamable HTTP transport
npm run serve:local         # 啟動本機 local engine
npm run demo:mcp            # 執行 MCP tool demo
npm run build:graph         # 重建運動動作圖譜
npm run audit:graph         # 執行圖譜稽核
```

## Repository structure

| Path | 內容 |
|---|---|
| `apps/mcp-server` | MCP protocol、stdio 與 HTTP transport。 |
| `apps/local-engine` | 使用者控制環境中的 local engine entrypoint。 |
| `packages/` | Evidence、connectors、semantic engine、training load、decision engine、planning、rules 與資料層。 |
| `schemas/` | Evidence、source、tool、REST 與 privacy schemas。 |
| `rule-packages/` | 可驗證的決策規則套件。 |
| `eval/` | Golden scenarios 與 evaluation runner。 |
| `harness/` | 決策鏈與規則覆蓋驗證。 |
| `docs/` | API、部署、隱私與設計文件。 |
| `examples/` | Sample Evidence 與可重現的示例情境。 |

## Project status

目前版本為 `0.4.2`。stdio transport、Streamable HTTP transport、公開決策工具、規則套件與測試框架已實作；hosted remote deployment 仍未達 production readiness。

`npm test` 目前包含 487 個測試。完整測試結果與環境限制應以實際執行輸出為準。

## Documentation

- [MCP Server](docs/mcp-server.md) — transport、tools、HTTP 與 OAuth 設定
- [Privacy deployment contract](docs/privacy-deployment-contract.md) — 三種部署模式的資料邊界
- [Product specification](docs/product-spec.md) — 產品需求、概念與使用情境
- [Design Manifesto](docs/design-manifesto.md) — 設計原則與治理判準
- [Implementation Plan](docs/fitness-mcp-implementation-plan.md) — 工程 roadmap
- [Examples](examples/README.md) — sample Evidence 與可重現情境
- [Schemas](schemas/README.md) — 輸入與輸出 schema

Pacevera 僅供一般健身與訓練用途，不是醫療器材，也不提供醫療建議。
