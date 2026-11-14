# 棋逢嘴手 · TrashTalk Chess — 前后端通信协议与接口契约 (`API_SPEC.md`)

> **文档版本**：`v1.0.0`  
> **适用范围**：`frontend` (uni-app 微信小程序) 与 `backend` (FastAPI 服务端)  
> **数据格式**：JSON (`UTF-8`)，字段命名统一采用 `snake_case`

---

## 1. 基础通信约定

### 1.1 协议与 Base URL

- **协议**：生产环境强制 `HTTPS`（微信小程序要求）；本地开发支持 `HTTP`。
- **Base Path**：`/api/v1`
- **通用请求头**：

| Header | 必填 | 示例值 | 说明 |
| :--- | :---: | :--- | :--- |
| `Content-Type` | 是 | `application/json` | 请求体格式 |
| `X-Request-ID` | 推荐 | `req_20261114_8f3a1c` | 前端生成的 UUID/短链路 ID，用于全链路日志排查与错误追踪 |
| `X-Client-Version` | 否 | `1.0.0` | 小程序客户端版本号 |

---

## 2. 棋盘与走法编码规范（成本与无歧义约束）

为最小化传输体积与大模型 Token 消耗，并消除中文纵线/代数记谱法的二义性，前后端严格采用 **FEN + UCI 坐标表示法**。

### 2.1 棋种枚举 (`game_type`)

| 枚举值 | 含义 | 棋盘规格 | FEN 规范 |
| :--- | :--- | :--- | :--- |
| `"xiangqi"` | 中国象棋 | 9 列 × 10 行 | WXF FEN 规范 |
| `"chess"` | 国际象棋 | 8 列 × 8 行 | 标准 Forsyth-Edwards Notation |

### 2.2 FEN 局面字符串规范

1. **国际象棋 (`chess`)**：标准 6 段式 FEN，例如初始局面：
   `rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1`
2. **中国象棋 (`xiangqi`)**：WXF FEN 规范（从黑方底线第 9 行自上而下至红方底线第 0 行），大写为红方（先手 `w`/`r` 统一约定使用 `w` 表示红方走、`b` 表示黑方走），小写为黑方：
   - 棋子字符：`K/k`（帅/将）、`A/a`（仕/士）、`B/b` 或 `E/e`（相/象，**统一约定使用 `B/b`**）、`N/n` 或 `H/h`（马，**统一约定使用 `N/n`**）、`R/r`（车）、`C/c`（炮）、`P/p`（兵/卒）。
   - 初始局面示例：
     `rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1`
   - 行动方字段统一使用 `w`（红方/白方）与 `b`（黑方），以便前后端通用解析。

### 2.3 无歧义 UCI 走法格式

- **国际象棋 (`chess`)**：`[起始列 a-h][起始行 1-8][目标列 a-h][目标行 1-8][可选升变子 q|r|b|n]`
  - 示例：`e2e4`、`g1f3`、`e1g1`（王车易位）、`e7e8q`（兵升变后）
  - 正则约束：`^[a-h][1-8][a-h][1-8][qrbn]?$`
- **中国象棋 (`xiangqi`)**：`[起始列 a-i][起始行 0-9][目标列 a-i][目标行 0-9]`
  - 坐标系（红方视角）：列从左到右为 `a` ~ `i`（共 9 路，对应红方九路到一路）；行从下到上为 `0` ~ `9`（红方底线为 `0`，黑方底线为 `9`）。
  - 示例：`h2e2`（红方炮二平五）、`b0c2`（红方马八进七）、`h9g7`（黑方马 8 进 7）。
  - 正则约束：`^[a-i][0-9][a-i][0-9]$`

---

## 3. 接口一：核心对弈决策接口 (`POST /api/v1/ai/move`)

前端在本地 Alpha-Beta 引擎计算出 Top-K 候选走法后调用本接口。后端结合角色人设、难度强度、最近 3 步滑动历史与胜率波动，驱动指定大模型从 `candidates` 中选择 1 步并生成拟人化吐槽。

### 3.1 Request 字段定义

| 字段名 | 类型 | 必填 | 约束 / 枚举 | 说明 |
| :--- | :--- | :---: | :--- | :--- |
| `game_type` | `string` | 是 | `"xiangqi"` \| `"chess"` | 当前对弈棋种 |
| `fen` | `string` | 是 | `minLength: 10`, `maxLength: 128` | 当前待 AI 行动的局面 FEN 字符串 |
| `candidates` | `array<CandidateMove>` | 是 | `minItems: 1`, `maxItems: 10` | 前端引擎算出的 Top-K 候选走法，**必须按评估分从高到低降序排列**（`candidates[0]` 为保底最佳步） |
| `persona_id` | `string` | 是 | `minLength: 1`, `maxLength: 64` | 选中的 AI 角色 ID（须存在于 `/api/v1/personas`） |
| `difficulty` | `string` | 是 | `"casual"` \| `"balanced"` \| `"tryhard"` | 难度 / 思考强度（见 3.2 说明） |
| `recent_history` | `array<HistoryItem>` | 是 | `minItems: 0`, `maxItems: 3` | 最近 3 步滑动窗口历史（按时间从旧到新排列，开局第 1 步可传 `[]`） |
| `win_rate_delta` | `number` | 是 | `float`, `[-100.0, 100.0]` | **上一步玩家落子后，相对 AI 视角的胜率变化值（百分点）**。正值代表 AI 胜率上升（玩家失误/送子），负值代表 AI 胜率下降（玩家妙手） |
| `move_number` | `integer` | 否 | `>= 1` | 当前完整回合数，用于辅助判断开局/中局/残局语境 |

#### 嵌套对象 `CandidateMove`

| 字段名 | 类型 | 必填 | 约束 | 说明 |
| :--- | :--- | :---: | :--- | :--- |
| `uci` | `string` | 是 | 符合 2.3 UCI 正则 | 候选走法坐标（如 `h2e2` 或 `e2e4`） |
| `score_cp` | `integer` | 是 | `[-30000, 30000]` | **AI 视角的厘兵评估分**（正值对 AI 有利；`±29000` 以上表示杀棋分） |
| `notation` | `string` | 否 | `maxLength: 24` | 人类可读着法（如 `"炮二平五"` 或 `"Nf3"`），供 LLM 吐槽时直接引用 |
| `is_capture` | `boolean` | 否 | 默认 `false` | 是否为吃子步 |
| `is_check` | `boolean` | 否 | 默认 `false` | 是否将军 |

#### 嵌套对象 `HistoryItem`

| 字段名 | 类型 | 必填 | 约束 | 说明 |
| :--- | :--- | :---: | :--- | :--- |
| `side` | `string` | 是 | `"player"` \| `"ai"` | 该步走子方 |
| `uci` | `string` | 是 | 符合 2.3 UCI 正则 | 历史走法 UCI |
| `notation` | `string` | 否 | `maxLength: 24` | 可读着法（如 `"马八进七"`） |
| `eval_cp_after` | `integer` | 否 | `[-30000, 30000]` | 走完该步后 AI 视角的盘面评估分 |

### 3.2 `difficulty` 难度 / 思考强度约定

| 枚举值 | 语义 | 后端决策与选步策略 |
| :--- | :--- | :--- |
| `"casual"` | 娱乐 / 放水模式 | 允许 LLM 根据性格（如浪、傲慢）在评估分差值允许范围内选择次优趣味步（如 Top-3~5），吐槽更偏向轻松互动 |
| `"balanced"` | 均衡 / 正常模式 | 优先在分差接近（如 `score_cp` 差距 ≤ 50）的 Top-2~3 候选步中结合风格选步，兼顾棋力与性格 |
| `"tryhard"` | 认真 / 全力模式 | 强约束 LLM 优先选择 `candidates[0]` 或分差极微（≤ 15cp）的走法，并赋予更强硬的竞技向吐槽 |

### 3.3 Request JSON Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "AIMoveRequest",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "game_type",
    "fen",
    "candidates",
    "persona_id",
    "difficulty",
    "recent_history",
    "win_rate_delta"
  ],
  "properties": {
    "game_type": {
      "type": "string",
      "enum": ["xiangqi", "chess"]
    },
    "fen": {
      "type": "string",
      "minLength": 10,
      "maxLength": 128
    },
    "candidates": {
      "type": "array",
      "minItems": 1,
      "maxItems": 10,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["uci", "score_cp"],
        "properties": {
          "uci": { "type": "string", "minLength": 4, "maxLength": 5 },
          "score_cp": { "type": "integer", "minimum": -30000, "maximum": 30000 },
          "notation": { "type": "string", "maxLength": 24 },
          "is_capture": { "type": "boolean", "default": false },
          "is_check": { "type": "boolean", "default": false }
        }
      }
    },
    "persona_id": {
      "type": "string",
      "minLength": 1,
      "maxLength": 64
    },
    "difficulty": {
      "type": "string",
      "enum": ["casual", "balanced", "tryhard"]
    },
    "recent_history": {
      "type": "array",
      "minItems": 0,
      "maxItems": 3,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["side", "uci"],
        "properties": {
          "side": { "type": "string", "enum": ["player", "ai"] },
          "uci": { "type": "string", "minLength": 4, "maxLength": 5 },
          "notation": { "type": "string", "maxLength": 24 },
          "eval_cp_after": { "type": "integer", "minimum": -30000, "maximum": 30000 }
        }
      }
    },
    "win_rate_delta": {
      "type": "number",
      "minimum": -100.0,
      "maximum": 100.0
    },
    "move_number": {
      "type": "integer",
      "minimum": 1
    }
  }
}
```

### 3.4 Request 示例

```json
{
  "game_type": "xiangqi",
  "fen": "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/9/RNBAKABNR b - - 0 1",
  "candidates": [
    { "uci": "b9c7", "score_cp": 15, "notation": "马2进3", "is_capture": false, "is_check": false },
    { "uci": "h9g7", "score_cp": 12, "notation": "马8进7", "is_capture": false, "is_check": false },
    { "uci": "h7e7", "score_cp": 5, "notation": "炮8平5", "is_capture": false, "is_check": false }
  ],
  "persona_id": "deepseek_master",
  "difficulty": "balanced",
  "recent_history": [
    { "side": "player", "uci": "h2e2", "notation": "炮二平五", "eval_cp_after": 10 }
  ],
  "win_rate_delta": -1.8,
  "move_number": 1
}
```

### 3.5 Response 字段定义 (HTTP 200)

| 字段名 | 类型 | 必填 | 约束 / 枚举 | 说明 |
| :--- | :--- | :---: | :--- | :--- |
| `selected_move` | `string` | 是 | 必为请求 `candidates` 中的某一项 `uci` | AI 最终选定走法；Pydantic 强制校验白名单，异常时锁定 `candidates[0].uci` |
| `comment` | `string` | 是 | `minLength: 1`, `maxLength: 140` | 角色拟人化吐槽台词（适配小程序气泡展示，限制长度防溢出） |
| `emotion` | `string` | 是 | `"neutral"` \| `"smug"` \| `"taunting"` \| `"panicked"` \| `"impressed"` \| `"rage"` | 情绪状态标签，前端据此切换头像表情或气泡动效 |
| `persona_id` | `string` | 是 | — | 实际执行决策的角色 ID |
| `model_provider` | `string` | 是 | `"deepseek"` \| `"openai"` \| `"anthropic"` \| `"fallback"` | 实际响应的模型厂商标识；降级时为 `"fallback"` |
| `model_name` | `string` | 是 | — | 底层调用模型名（如 `deepseek-chat`），降级时为 `"engine_top1"` |
| `is_fallback` | `boolean` | 是 | — | 是否触发了后端降级兜底（`true` 表示已自动采用 `candidates[0]`） |
| `fallback_reason` | `string \| null` | 是 | `null` \| `"llm_timeout"` \| `"llm_api_error"` \| `"invalid_json"` \| `"illegal_move"` | 若 `is_fallback=true`，记录具体降级原因；正常响应为 `null` |
| `latency_ms` | `integer` | 是 | `>= 0` | 后端处理总耗时（毫秒） |
| `request_id` | `string` | 是 | — | 回传链路追踪 ID |

### 3.6 Response JSON Schema

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "AIMoveResponse",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "selected_move",
    "comment",
    "emotion",
    "persona_id",
    "model_provider",
    "model_name",
    "is_fallback",
    "fallback_reason",
    "latency_ms",
    "request_id"
  ],
  "properties": {
    "selected_move": { "type": "string", "minLength": 4, "maxLength": 5 },
    "comment": { "type": "string", "minLength": 1, "maxLength": 140 },
    "emotion": {
      "type": "string",
      "enum": ["neutral", "smug", "taunting", "panicked", "impressed", "rage"]
    },
    "persona_id": { "type": "string" },
    "model_provider": {
      "type": "string",
      "enum": ["deepseek", "openai", "anthropic", "fallback"]
    },
    "model_name": { "type": "string" },
    "is_fallback": { "type": "boolean" },
    "fallback_reason": {
      "type": ["string", "null"],
      "enum": [null, "llm_timeout", "llm_api_error", "invalid_json", "illegal_move"]
    },
    "latency_ms": { "type": "integer", "minimum": 0 },
    "request_id": { "type": "string" }
  }
}
```

### 3.7 Response 示例（正常 vs 后端自动降级）

**场景 A：正常大模型结构化决策**
```json
{
  "selected_move": "b9c7",
  "comment": "中炮开局？正合我意，跳个屏风马先给你架好阵势。",
  "emotion": "smug",
  "persona_id": "deepseek_master",
  "model_provider": "deepseek",
  "model_name": "deepseek-chat",
  "is_fallback": false,
  "fallback_reason": null,
  "latency_ms": 1140,
  "request_id": "req_20261114_8f3a1c"
}
```

**场景 B：大模型超时或返回不在 `candidates` 中的非法走法（自动降级，仍返回 HTTP 200）**
```json
{
  "selected_move": "b9c7",
  "comment": "（沉思片刻）且看我这一步稳扎稳打。",
  "emotion": "neutral",
  "persona_id": "deepseek_master",
  "model_provider": "fallback",
  "model_name": "engine_top1",
  "is_fallback": true,
  "fallback_reason": "llm_timeout",
  "latency_ms": 6012,
  "request_id": "req_20261114_9b2d04"
}
```

---

## 4. 接口二：角色配置获取接口 (`GET /api/v1/personas`)

用于小程序启动或切换对手时拉取全部可用 AI 角色元数据、绑定模型标识、UI 主题色与占位头像。**注意：后端严禁在响应中暴露 `system_prompt`。**

### 4.1 Query 参数（可选）

| 参数名 | 类型 | 必填 | 说明 |
| :--- | :--- | :---: | :--- |
| `game_type` | `string` | 否 | 传入 `"xiangqi"` 或 `"chess"` 过滤支持该棋种的角色；不传则返回全量启用角色 |

### 4.2 Response 字段定义 (HTTP 200)

| 字段名 | 类型 | 必填 | 说明 |
| :--- | :--- | :---: | :--- |
| `personas` | `array<PersonaItem>` | 是 | 角色列表 |
| `total` | `integer` | 是 | 角色总数 |
| `request_id` | `string` | 是 | 链路追踪 ID |

#### 嵌套对象 `PersonaItem`

| 字段名 | 类型 | 必填 | 说明 |
| :--- | :--- | :---: | :--- |
| `persona_id` | `string` | 是 | 角色唯一标识（用于传给 `/ai/move`） |
| `name` | `string` | 是 | 角色展示名称（如 `"毒舌宗师·D"`） |
| `title` | `string` | 是 | 一句话副标题 / 头衔（如 `"擅长冷嘲热讽的深度计算派"`） |
| `model_provider` | `string` | 是 | 绑定的底层模型厂商（`"deepseek"` \| `"openai"` \| `"anthropic"`） |
| `model_name` | `string` | 是 | 绑定的底层模型标识（如 `"deepseek-chat"`, `"gpt-4o-mini"`, `"claude-3-5-sonnet-latest"`） |
| `theme_color` | `string` | 是 | 角色主题色（Hex 格式，如 `"#E63946"`，用于气泡边框与卡片高亮） |
| `avatar_url` | `string` | 是 | 头像占位路径或 CDN URL（如 `"/static/avatars/deepseek_master.png"`） |
| `tags` | `array<string>` | 是 | 人设标签列表（如 `["阴阳怪气", "攻击性强", "DeepSeek 驱动"]`） |
| `supported_games` | `array<string>` | 是 | 支持棋种（如 `["xiangqi", "chess"]`） |
| `greeting` | `string` | 是 | 开局首句固定开场白 |
| `is_enabled` | `boolean` | 是 | 当前后端是否配置好对应 Key 并可用 |

### 4.3 Response 示例

```json
{
  "personas": [
    {
      "persona_id": "deepseek_master",
      "name": "毒舌棋圣·深求",
      "title": "算无遗策的国风毒舌老前辈",
      "model_provider": "deepseek",
      "model_name": "deepseek-chat",
      "theme_color": "#2563EB",
      "avatar_url": "/static/avatars/deepseek_master.png",
      "tags": ["国风毒舌", "算路深沉", "DeepSeek"],
      "supported_games": ["xiangqi", "chess"],
      "greeting": "小友请落子吧，让我看看你的棋艺配不配得上这盘棋。",
      "is_enabled": true
    },
    {
      "persona_id": "gpt_showman",
      "name": "狂傲嘴炮·G酱",
      "title": "情绪价值拉满的脱口秀棋手",
      "model_provider": "openai",
      "model_name": "gpt-4o-mini",
      "theme_color": "#10B981",
      "avatar_url": "/static/avatars/gpt_showman.png",
      "tags": ["疯狂玩梗", "话痨挑衅", "GPT"],
      "supported_games": ["xiangqi", "chess"],
      "greeting": "Oh! 准备好被我的脑回路碾压了吗？请开始你的表演！",
      "is_enabled": true
    },
    {
      "persona_id": "claude_zen",
      "name": "腹黑学者·克劳德",
      "title": "表面温和实则扎心的心理学大师",
      "model_provider": "anthropic",
      "model_name": "claude-3-5-sonnet-latest",
      "theme_color": "#D97706",
      "avatar_url": "/static/avatars/claude_zen.png",
      "tags": ["温柔刀", "哲学嘲讽", "Claude"],
      "supported_games": ["xiangqi", "chess"],
      "greeting": "下棋如同修行，不过你这一步……似乎暴露了些许焦躁呢。",
      "is_enabled": true
    }
  ],
  "total": 3,
  "request_id": "req_20261114_1a0c7e"
}
```

---

## 5. 辅助健康检查接口 (`GET /api/v1/health`)

用于部署探活与前端启动连通性检测：

```json
{
  "status": "ok",
  "providers_configured": {
    "deepseek": true,
    "openai": true,
    "anthropic": false
  },
  "version": "1.0.0"
}
```

---

## 6. 统一错误码规范

仅当发生**客户端参数非法、资源不存在或服务端未捕获异常**时，返回非 200 HTTP 状态码及以下统一错误结构（注：大模型超时、限流、输出格式错误由后端内部降级处理，**不返回错误码**，直接返回 HTTP 200 + `is_fallback: true`）。

### 6.1 统一错误响应结构

```json
{
  "code": 40002,
  "message": "Unknown persona_id: invalid_bot",
  "detail": {
    "field": "persona_id",
    "reason": "persona not found in registry"
  },
  "request_id": "req_20261114_7c1e2a",
  "timestamp": "2026-11-14T10:50:00Z"
}
```

### 6.2 错误码清单

| HTTP 状态码 | 业务 `code` | 常量名 | 触发场景 | 前端处理建议 |
| :---: | :---: | :--- | :--- | :--- |
| `400` | `40001` | `INVALID_FEN` | `fen` 格式不符合对应棋种规范 | 提示本地棋盘状态异常并重置/校验 |
| `400` | `40002` | `PERSONA_NOT_FOUND` | `persona_id` 不存在或当前已下线 | 自动切回默认可用角色重试 |
| `400` | `40003` | `UNSUPPORTED_GAME_FOR_PERSONA` | 所选角色不支持当前 `game_type` | 拦截或切换角色 |
| `400` | `40004` | `INVALID_CANDIDATES` | `candidates` 为空或包含非法 UCI 字符串 | 不应发生；立即检查本地引擎输出 |
| `422` | `42200` | `VALIDATION_ERROR` | Pydantic v2 请求体字段缺失、类型或范围越界 | 本地降级为 `candidates[0]` 落子并上报日志 |
| `429` | `42900` | `RATE_LIMITED` | 客户端请求频率触发网关限流 | **直接执行前端本地 Fallback** |
| `500` | `50000` | `INTERNAL_SERVER_ERROR` | 后端未预期异常 | **直接执行前端本地 Fallback** |
| `503` | `50300` | `PROVIDER_NOT_CONFIGURED` | 该角色绑定的 API Key 未在服务端配置 | 若未开启降级则触发前端本地 Fallback |

---

## 7. 多层超时与降级（Fallback）约定

为保证微信小程序在弱网、模型 API 抖动、甚至后端宕机时**对局绝对不卡死**，系统设立三层防御体系：

### 7.1 三层降级链路

1. **第一层（后端 Pydantic 结构化强校验）**：
   - 后端要求 LLM 输出严格 JSON：`{"selected_move": "...", "comment": "...", "emotion": "..."}`。
   - Pydantic 校验器验证 `selected_move in {c.uci for c in req.candidates}` 且 `comment` 非空、`emotion` 合法。
   - 若 LLM 幻觉输出了不在候选集内的走法（如非法走子）或 JSON 解析失败，立即判定为 `illegal_move` / `invalid_json` 并落入第二层。
2. **第二层（后端超时与上游异常兜底）**：
   - 后端 `httpx.AsyncClient` 单次请求 LLM 硬超时设为 **`6000ms`**（`LLM_REQUEST_TIMEOUT_SEC=6.0`），不进行长重试（`LLM_MAX_RETRIES=0`），防止累加超时。
   - 捕获 `httpx.TimeoutException`、`httpx.HTTPStatusError` 及校验失败后，直接选取 `candidates[0].uci`，匹配角色预设的本地降级台词库，返回 **HTTP 200** 且 `is_fallback = true`。
3. **第三层（前端网络超时与 5xx 本地保底）**：
   - 小程序端 `uni.request` 硬超时设为 **`8000ms`**（必须严格大于后端 6s 超时，确保优先由后端下发带角色口吻的降级回复）。
   - 若遭遇断网、DNS 失败、超时（8s）或 HTTP `>= 429 / 5xx`：
     - 前端立即中断等待，**直接采用本地引擎已算好的 `candidates[0].uci` 执行落子**；
     - 气泡展示前端本地预设兜底文案（如 `"信号不太好，我先按本能走这步！"`），并解锁棋盘允许玩家继续走棋。

### 7.2 时序与超时预算对照

```text
玩家落子
  ├─► [0ms ~ 800ms]    前端 Alpha-Beta 算步，产出 Top-K candidates & win_rate_delta
  ├─► [800ms]          发起 POST /api/v1/ai/move (uni.request timeout = 8000ms)
  │     ├─► 正常路径: 后端调用 LLM (≤ 6000ms) -> Pydantic 校验通过 -> 返回 HTTP 200 (is_fallback=false)
  │     ├─► 后端降级: LLM 超时(6000ms) / 乱码 / 非法走法 -> 选 candidates[0] -> 返回 HTTP 200 (is_fallback=true)
  │     └─► 前端降级: 断网 / 5xx / 请求超 8000ms -> 前端直接落子 candidates[0] + 本地默认气泡
  └─► 落子动画 + 气泡弹出 + 归还操作权给玩家
```
