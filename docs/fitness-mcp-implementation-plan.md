# Fitness MCP — Implementation Plan (Phase 0 → Phase 8)

> 個人運動規劃生成與推薦系統 · 跨模型 MCP Server
> 版本：v2（以 Peloton MCP 實測缺口反推設計）

---

## 0. 這份計畫的核心判斷

Peloton 已經證明了兩件事：

1. **需求成立**：使用者確實想用自然語言規劃訓練，而不是用篩選器。
2. **淺層整合會失敗**：把既有搜尋 API 包成 MCP tool，LLM 拿到的是不夠結構化的資料，結果就是幻覺、錯排序、假計畫。

因此本計畫的第一原則是：**Semantic Layer 先於 MCP，MCP 先於 App**。
資料沒有語意結構之前，開再多 tool 都只是把幻覺搬到另一個介面。

### 六條設計原則（從 Peloton 的破口反推）

| # | 原則 | 對應的 Peloton 失敗 |
|---|---|---|
| P1 | Tool 回傳結構化資料，不回傳自然語言敘述 | 課程結構被 LLM 編造 |
| P2 | Plan 由 Planning Engine 產生，LLM 只做編排與說明 | 18 週計畫出現不存在的課 |
| P3 | 所有輸出 item 必須帶可驗證 ID，server 端在回傳前做存在性驗證 | 幻覺課名 |
| P4 | 寫入動作一律 two-phase：`preview_*` → `commit_*`，帶 idempotency key | 加錯課、加到過去 |
| P5 | 日期、時區、相對時間（「下週一」）一律由 server 解析，不交給 LLM | 排到上週一 |
| P6 | 用 MCP elicitation 一次收齊參數，不靠多輪追問 | 免費帳號撞額度 |

### 一個貫穿全程的量化紀律

每個 Phase 都要通過一組 **offline evaluation set**（做法上等同你熟悉的回測）：

- 固定 50–100 條 golden query（含正例、邊界、陷阱題）
- 三個指標：
  - **Grounding rate**：回應中所有具體 item 都能對應到真實 ID 的比例（目標 ≥ 99%）
  - **Tool selection accuracy**：LLM 選對 tool 的比例（目標 ≥ 90%）
  - **Plan validity rate**：產出的計畫通過 schema + 業務規則驗證的比例（目標 100%）
- 每條 query 都在 GPT / Claude / Gemini 三家各跑一次，分開記分

沒有這組數字，「AI 教練做得好不好」是說不清楚的。有了，每個 Phase 的通過與否就是客觀的。

---

## Phase 0 — 骨架與不可逆決策

**時間**：2 週
**目標**：把之後很難改的東西先定下來。

### 交付物

1. **Repo 骨架**（monorepo）
   ```
   /packages
     /mcp-server        # MCP 協定層，薄
     /core-domain       # Exercise / Workout / Program / UserState 模型
     /planning-engine
     /recommendation-engine
     /knowledge-graph
     /connectors        # 之後才長肉
   /schemas             # JSON Schema，唯一真實來源
   /eval                # golden set 與評測 runner
   ```

2. **協定基線**（照 2026 現行規範，不要走老路）
   - Transport：**Streamable HTTP**（SSE 已標記 deprecated，新 server 不應採用）
   - Auth：**OAuth 2.1 Resource Server**，實作 RFC 8707 Resource Indicators，支援 Client ID Metadata Documents
   - Spec version：`2025-11-25` 起跳，並預留 extension 機制（MCP Apps 走的就是這條路）

3. **Schema-first 決策**
   所有 tool 的 input/output 先寫 JSON Schema，程式碼從 schema 生成。跨模型時 schema 就是契約。

4. **Golden set v0**：30 條 query，先手寫預期答案。

### 驗收標準
- `initialize` handshake 在 Claude、ChatGPT、Gemini 三個 client 都能成功（即使一個 tool 都還沒有）
- OAuth flow 走得通，token 可 refresh

### 風險
- 這個階段沒有任何 demo 價值，容易被跳過。但 transport 與 auth 之後改成本極高。

---

## Phase 1 — Workout Knowledge Base

**時間**：4–6 週
**目標**：把「動作」變成有語意的圖，而不是一張表。這是整個專案唯一的護城河。

### 交付物

1. **Exercise Ontology**（最優先，Peloton 缺的就是這層）
   - 節點屬性：`primary_muscle`, `secondary_muscles`, `movement_pattern`(推/拉/蹲/髖鉸鏈/旋轉/位移), `equipment`, `plane_of_motion`, `unilateral`, `skill_level`, `contraindications`
   - 關係邊：
     - `IS_VARIANT_OF` — 槓鈴臥推 → 啞鈴臥推
     - `PROGRESSES_TO` / `REGRESSES_TO` — 跪姿伏地挺身 → 標準伏地挺身
     - `SIMILAR_TO`（帶 similarity score 與相似維度）
     - `SUBSTITUTES_FOR_WHEN` — 帶條件的替代（無器材 / 膝傷 / 空間不足）
     - `ANTAGONIST_OF`, `REQUIRES_EQUIPMENT`, `LOADS_JOINT`

   > 關鍵設計：「幫我找一個不傷膝蓋的深蹲替代動作」應該是一次 graph traversal，不是一次 prompt。

2. **Workout Structure Schema**
   Peloton 最大的錯誤是課程結構沒結構化。這裡要求每個 workout 可分解為：
   ```
   Workout
     └─ Block[]  (warmup / main / accessory / cooldown)
          └─ Set[]  (exercise_id, reps|duration, intensity{type,value}, rest, tempo)
   ```
   有了這個，「找一堂主課表全程在 Zone 2 的課」是一次 SQL/Cypher，不是一次猜測。

3. **Program Template Library**
   線性週期、雙分化、三分化、Push/Pull/Legs、5/3/1、Zone 2 base building 等，以模板 + 參數化表示。

4. **資料匯入 pipeline**
   - 種子資料：公開動作資料庫 + 自建
   - 每筆資料標記 `source` 與 `confidence`
   - 建立 human-in-the-loop 的審核佇列

### 資料儲存（Polyglot）
| 用途 | 選型 |
|---|---|
| User / Workout / Program / Log | PostgreSQL |
| Exercise & Knowledge Graph | Neo4j 或 Memgraph |
| 健康時序資料 | TimescaleDB |
| Embedding / RAG | pgvector（初期）→ Qdrant（規模化） |
| 快取、MCP session | Redis |

> 建議：Phase 1 先只用 PostgreSQL + pgvector，Graph 用 recursive CTE 硬撐。等 traversal 深度超過 3 層或查詢明顯變慢，再導入 Neo4j。過早引入第二個資料庫會拖慢迭代。

### 驗收標準
- ≥ 800 個動作節點，≥ 3000 條關係邊
- 隨機抽 50 個動作，「找 3 個替代動作」的結果經人工評分，合理率 ≥ 85%
- 「全程 Zone 2」「純上肢」「無器材 20 分鐘」這類 Peloton 查不到的 query，在 DB 層能查到正確結果

### 風險
- **資料是瓶頸，不是程式**。這個階段 70% 的工時會花在資料清理與關係標註。要及早接受這件事，並考慮用 LLM 做初標 + 人工複核。

---

## Phase 2 — MCP Read API（第一次能被三家模型連上）

**時間**：3 週
**目標**：讓 GPT / Claude / Gemini 都能查到 Phase 1 的知識庫。**唯讀，零副作用。**

### Tool Surface（首批 6 個，刻意精簡）

| Tool | 說明 | 關鍵設計 |
|---|---|---|
| `search_exercises` | 多維度動作檢索 | 支援 muscle / equipment / pattern / exclude_contraindication；回傳一律含 `exercise_id` |
| `get_exercise` | 單一動作詳情 | 含 graph 鄰居（變化式、進階、替代） |
| `search_workouts` | 課表檢索 | **支援結構化條件**（強度區間、時長、器材），這是與 Peloton 的分水嶺 |
| `get_workout` | 課表詳情 | 回傳完整 Block/Set 結構，**不回傳散文描述** |
| `get_user_profile` | 使用者偏好、器材、傷病、可用時間 | |
| `get_training_history` | 訓練紀錄查詢 | 預設按時間倒序，**排序邏輯在 server 端**（Peloton 就是這裡出錯） |

### 跨模型注意事項
- Tool 描述用英文寫（各家模型對英文 tool description 的理解一致性較高），回傳內容可多語
- 每個 tool 的 description 要寫「什麼時候不要用這個 tool」，能顯著降低誤選率
- 回傳 payload 控制在 ~4KB 以內，超過的走分頁；Gemini 對長 tool result 的處理最不穩定

### 驗收標準
- Golden set 在三家模型上 tool selection accuracy ≥ 90%
- Grounding rate ≥ 99%（所有提到的動作/課表都存在）
- 針對 Peloton 失敗的那七題，全數通過

### 這個 Phase 結束時，你已經有一個能公開的 demo
且它在「結構化查詢」這個維度上明確優於現有產品。

---

## Phase 3 — Rule-based Recommendation

**時間**：3–4 週
**目標**：從「查得到」進化到「知道該練什麼」。**還不要用 LLM 做決策。**

### 核心：Recommendation Engine ≠ LLM

```
LLM  →  MCP  →  Recommendation Engine  →  Knowledge Graph
                       ↑
                  Rule Set + 使用者狀態
```

LLM 的角色是 **orchestrator 與 explainer**，不做計算。

### 規則層（第一版全部是確定性規則）
- 肌群輪替：同一肌群 48 小時內不重複高強度刺激
- 器材可用性過濾
- 傷病禁忌硬過濾（這是安全紅線，永遠不可由 LLM 覆寫）
- 時間預算匹配（可用 30 分鐘就不推 60 分鐘課表）
- 偏好權重：喜好動作加分、明確排除的動作直接剔除
- 新鮮度：避免連續推薦相同課表

### 新增 Tool
| Tool | 說明 |
|---|---|
| `recommend_workout` | 給定時間/器材/目標，回傳 3–5 個候選，**每個都附 `reasoning` 欄位** |
| `suggest_alternatives` | 動作替代，帶替代原因 |

### 關鍵設計：Explainability 欄位
每個推薦回傳結構化理由：
```json
{
  "workout_id": "...",
  "score": 0.87,
  "reasons": [
    {"rule": "muscle_recovery", "detail": "chest last trained 72h ago"},
    {"rule": "time_budget", "detail": "fits 35min window"},
    {"rule": "equipment", "detail": "requires only dumbbells"}
  ]
}
```
LLM 拿到這個就能講出人話，而且**講的是真的**。這是防幻覺最有效的一招。

### 驗收標準
- 傷病禁忌違反率 = 0（硬性）
- 推薦結果人工評分合理率 ≥ 80%
- LLM 轉述 reasoning 時的事實正確率 100%

---

## Phase 4 — AI Planning Engine

**時間**：4–6 週
**目標**：產生多週訓練計畫。這是 Peloton 明確失敗的地方。

### 分層架構（不要讓 LLM 生成計畫）

```
1. Intent Parsing      ← LLM（把「想在 12 週後跑半馬 sub-2」轉成結構化目標）
2. Periodization       ← 演算法（週期化、負荷分配、減量週）
3. Session Assembly    ← Engine（從 KG 挑真實課表填入每個 slot）
4. Validation          ← 硬性檢查（所有 ID 存在、總負荷合理、無禁忌）
5. Narration           ← LLM（解釋這個計畫為什麼這樣排）
```

只有第 1 和第 5 步是 LLM。第 3 步保證了「不會出現不存在的課」。

### 新增 Tool
| Tool | 說明 |
|---|---|
| `generate_plan` | 產生完整計畫，**同步回傳 `plan_id`** |
| `get_plan` | 取回計畫（避免 LLM 在對話中重述時走樣） |
| `adjust_plan` | 局部調整（換掉某天、整體降低強度、延後一週） |
| `explain_plan` | 回傳計畫的設計理由，結構化 |

### 兩個關鍵設計

**Plan 是 server 端持有的物件，不是對話裡的文字。**
Peloton 的計畫活在對話裡，所以會走樣、會遺失、會被重述錯。這裡的計畫有 ID、有版本、有 diff。

**用 elicitation 一次收齊參數。**
不要讓 LLM 追問十輪（Peloton 就是這樣燒掉使用者額度）。`generate_plan` 在參數不足時回傳一個 elicitation request，客戶端一次性呈現表單。

### 驗收標準
- 12 週計畫的 plan validity rate = 100%
- 任何長度的計畫，item grounding rate = 100%
- 三家模型產出的計畫在同樣輸入下，結構一致（因為是 engine 產的）

---

## Phase 5 — Health Integration & Connector Layer

**時間**：6–8 週
**目標**：讓系統知道「你今天狀態如何」，而不只是「你有什麼器材」。

### Connector 原則：AI 永遠不碰外部 API

```
Apple Health / Garmin / Strava / WHOOP / Oura / Google Calendar
        ↓  (OAuth / Sync / Webhook / Normalize)
   Normalized Health Graph
        ↓
   Recovery / Fatigue / Readiness Score
        ↓
   MCP Tool（只露出分數與趨勢，不露出資料來源）
```

每個 connector 只做四件事：OAuth、Sync、Webhook、Normalize。加一個新資料源不應該動到上層任何一行程式。

### Training Load Graph
- ATL（急性負荷，7 日）、CTL（慢性負荷，42 日）、TSB（訓練壓力平衡）
- **分肌群疲勞百分比** — 這是「今天別再練胸」這種建議的前提
- 這部分的數學跟你熟悉的指數移動平均與均值回歸幾乎同構，可以直接複用直覺

### 新增 Tool
| Tool | 說明 |
|---|---|
| `get_readiness` | 今日 readiness / recovery / fatigue score + 一句話結論 |
| `get_training_load` | ATL/CTL/TSB 與分肌群疲勞 |
| `get_availability` | 從行事曆推出可訓練時段 |

### 隱私設計（不能事後補）
- 健康資料分級，MCP 層預設只露出**分數**不露出**原始讀數**
- 使用者可逐項授權「哪些資料可以被 AI 看到」
- 原始資料加密靜態儲存，跨境傳輸需明確同意
- 對外文件明確寫出：本系統不提供醫療建議

### 驗收標準
- 至少 3 個 connector 上線並穩定同步 30 天
- Readiness score 與使用者主觀感受的相關性 > 0.5（做一個 30 人的小樣本驗證）

---

## Phase 6 — Write Actions

**時間**：3 週
**目標**：讓 AI 能真的改東西。Peloton 在這裡摔得最重，所以這裡最需要紀律。

### Two-phase commit（強制）

```
preview_schedule_change(...)  →  回傳 diff + preview_token
              ↓  使用者在 client 端確認
commit_schedule_change(preview_token, idempotency_key)
```

**沒有 preview_token 的 commit 一律拒絕。** 這一條規則就消滅了 Peloton 「加錯課、加到過去」的整類問題。

### 日期解析歸 server
「下週一」「明天早上」「這個週末」全部由 server 用使用者時區解析，並在 preview 中顯示絕對日期（`2026-08-03 (Mon) 07:00 GMT+8`）讓使用者確認。LLM 不被允許自己算日期。

### 新增 Tool
| Tool | 說明 |
|---|---|
| `preview_schedule_change` / `commit_schedule_change` | 排程寫入 |
| `log_workout` | 記錄完成的訓練（含主觀 RPE） |
| `preview_plan_apply` / `commit_plan_apply` | 把計畫寫進行事曆 |
| `update_user_preferences` | 更新偏好、器材、傷病 |

### 驗收標準
- 100 次重複 commit（同 idempotency key）只產生 1 筆變更
- 所有寫入都有 audit log，可回溯到觸發它的 tool call
- 混沌測試：在 preview 與 commit 之間插入狀態變更，系統應拒絕 commit 而非寫錯

---

## Phase 7 — Cross-LLM 深化與 MCP Apps UI

**時間**：4 週
**目標**：從「三家都能連」進化到「三家都好用」。

> 注意：協定層的跨模型從 Phase 2 就已完成。這個 Phase 處理的是**體驗差異**，不是連通性。

### MCP Apps（SEP-1865）
2026-01-26 起，MCP Apps 成為 MCP 的第一個官方 extension，由 Anthropic 與 OpenAI 共同制定。Server 可透過 `ui://` URI 宣告 HTML 資源，host 在沙箱 iframe 中渲染，UI 與 host 之間走 JSON-RPC over postMessage。Claude、ChatGPT、VS Code Copilot、Goose 均已支援。

這代表：**你可以寫一套 UI，在多個模型平台上重用。**

適合做成 MCP App 的三個介面：
1. **週計畫檢視器** — 可拖曳調整、點擊換課，比純文字強太多
2. **Readiness 儀表板** — 分數 + 趨勢圖 + 分肌群疲勞熱區
3. **訓練意圖表單**（elicitation UI）— 一次收齊目標、時間、器材、限制

### 各家差異處理
| 面向 | 處理方式 |
|---|---|
| Tool 數量預算 | 總數控制在 20 個以內；用 namespace 分組，必要時做動態 tool 曝光 |
| Tool result 長度 | 統一分頁，單次 ≤ 4KB |
| UI 能力偵測 | 用 capability negotiation，不支援 MCP Apps 的 client 降級成結構化文字 |
| 錯誤語意 | 統一錯誤碼與可讀訊息，避免各家模型自行編造失敗原因 |

### 驗收標準
- 同一組 golden set，三家模型的指標差距 < 10 個百分點
- MCP Apps UI 在 Claude 與 ChatGPT 兩邊渲染一致

---

## Phase 8 — Agent Ecosystem / Fitness OS

**時間**：持續
**目標**：從「被呼叫的工具」變成「會主動運作的系統」。

### 主要方向
1. **Proactive Agent** — 用 MCP 的 async tasks 能力，做週日晚上自動產生下週計畫、連續三天高疲勞時主動提醒降量
2. **Nutrition MCP** — 第二個獨立 MCP server，與 Workout MCP 共享 Semantic Layer
3. **Coach MCP** — 對話式教練，具備長期記憶與訓練哲學
4. **Third-party 開放** — 讓別人的 agent 呼叫你的 Semantic Layer，這才是「Plaid of fitness」的兌現
5. **Web Dashboard / Mobile App** — 注意角色：**Dashboard，不是 AI**。AI 的入口永遠是使用者已經在用的模型

---

## 附錄 A：Tool Surface 演進表

| Tool | P2 | P3 | P4 | P5 | P6 |
|---|:-:|:-:|:-:|:-:|:-:|
| `search_exercises` | ● | | | | |
| `get_exercise` | ● | | | | |
| `search_workouts` | ● | | | | |
| `get_workout` | ● | | | | |
| `get_user_profile` | ● | | | | |
| `get_training_history` | ● | | | | |
| `recommend_workout` | | ● | | | |
| `suggest_alternatives` | | ● | | | |
| `generate_plan` | | | ● | | |
| `get_plan` / `adjust_plan` / `explain_plan` | | | ● | | |
| `get_readiness` | | | | ● | |
| `get_training_load` | | | | ● | |
| `get_availability` | | | | ● | |
| `preview_*` / `commit_*` | | | | | ● |
| `log_workout` | | | | | ● |
| `update_user_preferences` | | | | | ● |

合計 19 個，落在多數 client 的舒適區間內。

---

## 附錄 B：關鍵決策點

| 決策 | 時機 | 建議 |
|---|---|---|
| Graph DB 何時導入 | Phase 1 中段 | 等 traversal 深度 > 3 或 p95 延遲 > 200ms 再導 |
| 自建動作庫 vs 授權 | Phase 1 開始前 | 自建。這是護城河，不該外包 |
| 是否做 App | Phase 5 之後 | 除非 MCP 端的留存數據支持，否則不做 |
| 開源程度 | Phase 2 完成時 | 建議開源 MCP server 與 schema，閉源 Knowledge Base 與 Engine |
| 商業模式 | Phase 4 完成時 | Semantic Layer 訂閱 + API 計價，不做 content 訂閱 |

---

## 附錄 C：最大的三個風險

1. **資料品質決定一切，而資料工作沒有捷徑。**
   Phase 1 若草率，後面每個 Phase 都在幫它擦屁股。寧可 Phase 1 拖長兩個月。

2. **Tool 太多會讓所有模型變笨。**
   每加一個 tool 都要問：能不能用參數合併進既有 tool？19 個是上限不是目標。

3. **健康建議的責任邊界。**
   系統必須在 UI 與 tool description 兩個層級明確聲明非醫療用途，傷病禁忌規則必須是硬過濾且不可被 LLM 覆寫。這一條在 Phase 3 就要立起來，不能等到出事。
