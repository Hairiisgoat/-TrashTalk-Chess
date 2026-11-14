# 棋逢嘴手 · TrashTalk Chess — 项目工程架构与目录规范 (`PROJECT_STRUCTURE.md`)

> **文档定位**：本文档为「棋逢嘴手」双模式（中国象棋 / 国际象棋）Hybrid AI 微信小程序的唯一工程结构与安全隔离契约。前后端并行开发须严格遵循本目录划分、职责边界及密钥管理规范。

---

## 1. 总体架构概览

本项目采用 **前后端分离 + Hybrid AI（端侧引擎算步 + 云端多模型拟人化决策与吐槽）** 架构：

- **前端（`/frontend`）**：基于 `uni-app`（Vue 3 + `<script setup>` + TypeScript/JavaScript），使用 HBuilderX 编译为微信小程序。
  - **端侧棋规与搜索引擎**：内置中国象棋与国际象棋的完整走法生成、合法性校验、FEN 解析/序列化，以及轻量级 Alpha-Beta（含迭代加深 / 置换表 / 走法排序）搜索引擎，在用户本地零成本计算 Top-K 候选走法及评估分。
  - **超时兜底机制**：网络异常或请求超时时，前端直接采用本地 Top-1 候选步落子，保证对局永不卡死。
- **后端（`/backend`）**：基于 `Python 3.11+` + `FastAPI` + `Pydantic v2` + `httpx`。
  - **无状态决策网关**：不保存完整对局棋盘，仅接收前端压缩后的 FEN、Top-K 候选走法及最近 3 步滑动窗口上下文，极大降低 Token 消耗与服务端内存开销。
  - **多模型统一路由**：通过 `httpx.AsyncClient` 异步封装 DeepSeek、OpenAI (GPT)、Anthropic (Claude) 三家模型 API，并将不同人格（Persona）绑定至指定模型与系统提示词。
  - **结构化校验与降级**：通过 Pydantic v2 强校验大模型输出（所选走法必须属于 `candidates` 白名单）；若上游超时、限流或返回非法格式，自动降级为 `candidates[0]`（保底走法）。

---

## 2. 仓库标准目录结构

```text
TrashTalk-Chess/
├── .gitignore                      # 全局 Git 忽略规则（严格隔离密钥、编译产物、IDE 缓存）
├── .env.example                    # 后端环境变量模板（仅含键名与示例格式，严禁填入真实 Key）
├── PROJECT_STRUCTURE.md            # 本文档：工程目录与安全隔离契约
├── API_SPEC.md                     # 前后端通信协议与接口契约（唯一 API 规范）
│
├── frontend/                       # uni-app 微信小程序工程（HBuilderX 打开此目录）
│   ├── manifest.json               # uni-app 应用配置（微信小程序 AppID、权限、分包设置）
│   ├── pages.json                  # 页面路由、导航栏样式、全局主题配置
│   ├── App.vue                     # 应用生命周期、全局样式与异常兜底监听
│   ├── main.js                     # Vue 3 应用入口（或 main.ts）
│   ├── index.html                  # H5 调试入口模板
│   ├── package.json                # 前端依赖声明（如 TypeScript 类型、vitest 单测等）
│   ├── tsconfig.json               # TypeScript 编译配置（若启用 TS）
│   │
│   ├── config/                     # 前端环境与常量配置
│   │   ├── env.js                  # 区分 dev / prod 的后端 BaseURL 与超时阈值（如 8000ms）
│   │   └── constants.js            # 棋种枚举、难度映射、默认占位头像与本地兜底台词
│   │
│   ├── api/                        # 网络请求层（严格对齐 API_SPEC.md）
│   │   ├── request.js              # uni.request 统一封装（Request-ID 注入、超时控制、错误拦截）
│   │   └── ai.js                   # 封装 getPersonas()、requestAiMove() 及其本地 Fallback 逻辑
│   │
│   ├── engine/                     # 【核心】端侧双棋种规则与轻量 Alpha-Beta 引擎（纯逻辑，零 UI 依赖）
│   │   ├── common/
│   │   │   ├── types.js            # 统一走法对象、Candidate、FEN 接口约定
│   │   │   └── evaluator.js        # 评估分转胜率工具（centipawn -> 胜率与 win_rate_delta 计算）
│   │   ├── xiangqi/                # 中国象棋模块
│   │   │   ├── board.js            # 9x10 棋盘状态、WXF FEN 解析/生成、红黑方切换
│   │   │   ├── rules.js            # 走法生成（马腿、象眼、将帅照面、长将/杀棋判定）
│   │   │   ├── uci.js              # 内部坐标 <-> UCI 坐标（如 h2e2）与中文纵线着法转换
│   │   │   └── search.js           # Alpha-Beta 搜索 + 位置价值表，输出 Top-K 候选步
│   │   └── chess/                  # 国际象棋模块
│   │       ├── board.js            # 8x8 棋盘状态、标准 FEN 解析/生成（王车易位、吃过路兵、半回合计数）
│   │       ├── rules.js            # 合法走法生成、升变（q/r/b/n）、将军/逼和/三次重复判定
│   │       ├── uci.js              # 内部坐标 <-> UCI 坐标（如 e2e4, e7e8q）转换
│   │       └── search.js           # Alpha-Beta 搜索 + PST 评估，输出 Top-K 候选步
│   │
│   ├── stores/                     # 状态管理（Pinia 或 Vue 3 reactive store）
│   │   ├── game.js                 # 当前棋种、FEN、recent_history(滑动窗口3步)、胜率曲线、回合锁
│   │   └── persona.js              # 已加载角色列表、当前选中角色、主题色动态绑定
│   │
│   ├── components/                 # 可复用业务组件
│   │   ├── ChessBoard.vue          # 国际象棋 8x8 交互棋盘（Canvas / Grid 渲染、可走点提示、升变弹窗）
│   │   ├── XiangqiBoard.vue        # 中国象棋 9x10 交互棋盘（楚河汉界、九宫斜线、最后一步高亮）
│   │   ├── TrashTalkBubble.vue     # AI 拟人化吐槽气泡（打字机效果、情绪标签样式、主题色适配）
│   │   ├── PersonaSelector.vue     # 对手角色切换卡片（展示绑定模型标识、人设标签、主题色）
│   │   └── EvalBar.vue             # 局势评估/胜率条组件
│   │
│   ├── pages/                      # 小程序页面
│   │   ├── index/
│   │   │   └── index.vue           # 首页：棋种切换（象棋/国象）、难度选择、对手选择入口
│   │   └── battle/
│   │       └── battle.vue          # 对弈主界面：棋盘、AI 头像/吐槽气泡、悔棋/认输/重开控制
│   │
│   ├── static/                     # 静态资源（微信小程序包体限制 2MB，图片需严格压缩）
│   │   ├── avatars/                # 角色头像占位图（如 deepseek_master.png, gpt_toxic.png 等）
│   │   └── sfx/                    # 落子、吃子、将军轻量音效
│   │
│   └── tests/                      # 端侧引擎单元测试（FEN 校验、UCI 转换、Alpha-Beta 耗时基准）
│
└── backend/                        # FastAPI 后端服务工程（Python 3.11+）
    ├── pyproject.toml              # 项目元信息与依赖管理（FastAPI, pydantic>=2.6, httpx, uvicorn, pytest）
    ├── requirements.txt            # 锁定版本依赖（便于 CI/Docker/宝塔/云托管快速安装）
    ├── .env                        # 【本地私有，严禁提交】真实 API Key 与运行环境配置
    │
    ├── app/
    │   ├── __init__.py
    │   ├── main.py                 # FastAPI 应用实例、CORS/日志中间件、生命周期管理（共享 httpx.AsyncClient）
    │   │
    │   ├── core/                   # 基础设施与配置
    │   │   ├── config.py           # Pydantic BaseSettings 读取 .env（API Keys、超时阈值、日志级别）
    │   │   ├── exceptions.py       # 统一业务异常类与全局异常处理器（对齐 API_SPEC 错误码）
    │   │   └── logging.py          # 结构化日志配置（强制脱敏 Authorization / API Key）
    │   │
    │   ├── schemas/                # Pydantic v2 请求/响应/大模型结构化输出契约
    │   │   ├── common.py           # 通用枚举（GameType, Difficulty, Emotion, ErrorCode）与错误响应模型
    │   │   ├── move.py             # MoveRequest, CandidateMove, HistoryItem, MoveResponse, LLMDecisionOutput
    │   │   └── persona.py          # PersonaPublicConfig, PersonaListResponse
    │   │
    │   ├── personas/               # 拟人化角色配置与提示词工程（服务端独占，不向前端暴露 system_prompt）
    │   │   ├── registry.py         # 角色注册表（绑定 model_provider、model_name、主题色、头像占位、人设标签）
    │   │   └── prompts.py          # System Prompt 模板与动态上下文拼装器（注入 FEN/候选步/胜率变化/最近3步）
    │   │
    │   ├── llm/                    # 多模型异步统一路由层（基于 httpx.AsyncClient）
    │   │   ├── base.py             # 抽象 BaseLLMClient（统一超时、重试策略、JSON 模式解析接口）
    │   │   ├── deepseek_client.py  # DeepSeek API 适配（OpenAI 兼容协议 + JSON Output）
    │   │   ├── openai_client.py    # OpenAI (GPT) API 适配（Structured Outputs / json_object）
    │   │   ├── claude_client.py    # Anthropic (Claude) API 适配（Messages API + JSON 约束）
    │   │   └── router.py           # 根据 persona 绑定的 provider 分发请求，统一异常捕获
    │   │
    │   ├── services/               # 核心业务编排层
    │   │   ├── decision_service.py # 校验请求 -> 组装 Prompt -> 调用 LLM -> Pydantic 白名单校验 -> 降级兜底
    │   │   └── fallback.py         # 降级策略：锁定 candidates[0]，按角色与局势生成离线保底吐槽
    │   │
    │   └── api/                    # HTTP 路由层（仅做参数绑定与响应序列化）
    │       └── v1/
    │           ├── router.py       # v1 路由聚合
    │           ├── ai.py           # POST /api/v1/ai/move
    │           └── personas.py     # GET /api/v1/personas
    │
    ├── static/                     # 后端托管的占位静态资源（若需由后端统一下发头像占位）
    │   └── avatars/
    │
    └── tests/                      # 后端自动化测试（pytest + pytest-asyncio + respx mock httpx）
        ├── test_move_contract.py   # Schema 校验、候选步白名单校验测试
        ├── test_fallback.py        # 模拟 LLM 超时、乱码输出、非法走法时的自动降级测试
        └── test_personas.py        # 角色列表接口测试
```

---

## 3. 前后端职责边界约定

| 关注点 | 前端 (`uni-app` 小程序) | 后端 (`FastAPI` 服务) |
| :--- | :--- | :--- |
| **棋盘状态维护** | 维护完整对局历史、悔棋栈、走法合法性、将死/和棋裁判 | **无状态**，仅单次消费请求中的 `fen` 与 `recent_history`（最多 3 步） |
| **算力开销** | 本地 JS/TS Alpha-Beta 搜索计算 Top-K 候选步与评估分 (`score_cp`) | **不做棋类搜索**，仅通过 LLM 在 `candidates` 内结合人设与难度挑选走法 |
| **胜率计算** | 由搜索引擎评估分转换并计算单步胜率变化 `win_rate_delta` | 消费 `win_rate_delta` 作为情绪触发信号（如大劣势慌张、大优势嘲讽） |
| **System Prompt** | 无权访问，不得下发到小程序端 | 严格托管于 `backend/app/personas/prompts.py` |
| **容错保底** | 请求超过前端阈值（建议 `8000ms`）或遇 5xx/断网时，直接走 `candidates[0]` | 上游 LLM 超时（建议 `6000ms`）或校验失败时，返回 HTTP 200 + `is_fallback: true` + `candidates[0]` |

---

## 4. 安全隔离与防泄露规范

### 4.1 环境变量模板 (`/backend/.env.example` 规范)

> 本文件必须提交至 Git 仓库，所有密钥值**必须留空或使用无害占位符**。真实密钥仅保存在本地 `/backend/.env` 中，通过 `pydantic-settings` 加载。

```dotenv
# ============================================================
# TrashTalk Chess - Backend Environment Configuration Example
# 复制本文件为 .env 后填入真实密钥，切勿将 .env 提交至 Git！
# ============================================================

# --- 基础运行配置 ---
APP_ENV=development
APP_HOST=0.0.0.0
APP_PORT=8000
LOG_LEVEL=INFO
CORS_ALLOW_ORIGINS=["*"]

# --- 超时与容错阈值 (单位: 秒) ---
# 注意：须小于前端 wx.request 超时时间（如前端 8.0s，后端上游 LLM 限制 6.0s）
LLM_REQUEST_TIMEOUT_SEC=6.0
LLM_MAX_RETRIES=0

# --- DeepSeek API 配置 ---
DEEPSEEK_API_KEY=your_deepseek_api_key_here
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_DEFAULT_MODEL=deepseek-chat

# --- OpenAI (GPT) API 配置 ---
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_DEFAULT_MODEL=gpt-4o-mini

# --- Anthropic (Claude) API 配置 ---
ANTHROPIC_API_KEY=your_anthropic_api_key_here
ANTHROPIC_BASE_URL=https://api.anthropic.com/v1
ANTHROPIC_DEFAULT_MODEL=claude-3-5-sonnet-latest
```

### 4.2 全局 `.gitignore` 规范

> 根目录 `.gitignore` 必须同时覆盖 Python 后端密钥/虚拟环境、uni-app / HBuilderX 编译产物以及微信小程序敏感配置：

```gitignore
# ============================================================
# 1. 密钥与环境文件（最高优先级隔离，防止泄露 API Key）
# ============================================================
.env
.env.*
!.env.example
*.pem
*.key
secrets/

# ============================================================
# 2. Python 后端缓存与虚拟环境
# ============================================================
__pycache__/
*.py[cod]
*$py.class
.venv/
venv/
ENV/
.pytest_cache/
.mypy_cache/
.ruff_cache/
*.log

# ============================================================
# 3. uni-app / HBuilderX / 微信小程序编译产物与私有配置
# ============================================================
frontend/unpackage/
frontend/node_modules/
frontend/dist/
frontend/.hbuilderx/
# 若 manifest.json 需隔离正式 AppID，可在 CI 注入或使用 local 配置
project.private.config.json

# ============================================================
# 4. 操作系统与 IDE 杂项
# ============================================================
.DS_Store
Thumbs.db
.vscode/
.idea/
*.swp
```

### 4.3 运行时防泄露红线

1. **日志脱敏**：后端 `httpx` 请求日志与异常堆栈严禁打印 `Authorization`、`x-api-key` 等 Header，严禁将完整的 `config` 对象直接写入错误响应或日志。
2. **前端零密钥**：微信小程序代码包可被反编译，前端代码、`manifest.json`、本地缓存中**绝对禁止**出现任何大模型 API Key、BaseURL 或 System Prompt。
3. **提交前检查**：建议在团队本地启用 `pre-commit` 或 Git Hook，拦截包含 `sk-`、`sk-ant-` 等密钥特征的误提交。
