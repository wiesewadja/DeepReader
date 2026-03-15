# CLAUDE.md

## 项目定位
**DeepReader**: 通过 FastAPI 后端为 Obsidian 提供 PDF 智能索引的插件。
- **前端**: TypeScript (Obsidian Plugin API)
- **后端**: Python 3.10+ (FastAPI)，使用 `uv` 包管理
- **通信**: REST API @ `http://localhost:6088`
- **文档**: `/docs` 端点

---

## 架构说明

### 前后端解耦

DeepReader 采用前后端解耦架构：

- **前端（Obsidian 插件）**：完全独立，可以正常加载和运行
- **后端（FastAPI）**：可选的增强服务，提供 PDF 索引、文档搜索等功能
- **前端 Agent**：独立使用 LLM API，后端未连接时仍可工作

### 连接状态管理

- 状态类型：`connected | disconnected | connecting`
- 状态指示器：ReadingTopbar 右侧显示
- 健康检查：每 30 秒自动检查后端状态

---

## 命令

### 后端 (`/backend`)
- **启动**: `uv run uvicorn deeppdf.main:app --port 6088 --reload --loop asyncio`（关键：必须使用 `asyncio` loop，不能用 `uvloop`）
- **检查/格式化**: `uv run ruff check .` & `uv run black .`（行长度：100）
- **测试**: `uv run pytest tests/ -v`
- **类型检查**: `uv run mypy src/`

### 前端 (`/frontend`)
- **开发**: `npm run dev`（监听模式）-> 在 Obsidian 中重新加载（Cmd+R）
- **前端调试**: 使用 obsidian cli，可以使用 `Obsidian --help` 查看Developer或其他使用方式
- **构建**: `npm run build`（包含类型检查）
- **测试**: `npm run test:run`（Vitest）
- ***部署**： `npm run deploy && obsidian plugin:reload id=deepreader`

---

## 架构与文件映射

### 后端结构 (`backend/deeppdf-api/src/deeppdf`)
- `api/`: 仅包含路由和 Pydantic 模型。禁止业务逻辑。
- `services/`: 业务逻辑。
    - `indexer.py`: PDF 解析（CPU 密集型 -> 使用 `ThreadPoolExecutor`）
    - `querier.py`: 搜索逻辑
- `storage/`: ChromaDB 和嵌入模型相关代码
- **配置**: `config.py`（环境变量）。禁止硬编码密钥。

### 前端结构 (`frontend/src`)
- `main.ts`: 入口点
- `api/`: `http-client.ts`（fetch API 封装）
- `views/`: Obsidian UI 组件

---

## 关键开发规则

1. **异步策略**:
   - I/O 密集型: `await asyncio.to_thread(...)`
   - CPU 密集型（PDF/索引）: `await loop.run_in_executor(...)`
   - **关键**: `nest_asyncio.apply()` 是 PageIndex 同步代码兼容所必需的

2. **端口**: 默认 6088。如修改，需同步更新后端 CLI 和 Obsidian 插件设置

3. **LLM**: 通过 `config.py` 使用 DeepSeek/OpenAI。密钥在 `.env` 中

4. **错误处理**: 严格类型化。禁止返回原始 dict；使用 Pydantic schema

---

## 常见陷阱（切勿忽略）

- **启动错误**: `ValueError: Can't patch loop of type uvloop`。**修复**: 确保存在 `--loop asyncio` 标志

- **Pydantic**: `Extra inputs not permitted`。**修复**: 检查 `.env` 与 `Settings` 类匹配，或设置 `extra="ignore"`

- **Obsidian**: 如果类型检查失败，确保存在 `obsidian` 类型包，或使用 `// @ts-ignore` 并注明原因， 测试部署的 vault 路径： `/Users/lizhao/workspace/deepreadertest`
- 无明确指定，不要自行提交代码