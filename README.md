

  **DeepPDF** - 为 Obsidian 提供的 PDF 智能索引插件，基于 FastAPI 后端实现语义搜索。

  **前端**: Obsidian 插件（TypeScript）
  **后端**: FastAPI 服务（Python）
  **通信**: HTTP REST API（默认端口 6088）
  **API 文档**: http://localhost:6088/docs

  ---

  ## 开发工作流

  ### 启动开发环境

  **后端（带热重载）**
  ```bash
  cd backend
  uv run uvicorn deeppdf.main:app --port 6088 --reload --loop asyncio
  # 或使用脚本
  ./scripts/start_server.sh

  前端插件（带自动构建）
  cd frontend
  npm run dev                         # 监听文件变化，自动重新构建
  插件修改后，在 Obsidian 中使用命令面板重新加载插件（Ctrl/Cmd+R）

  代码质量检查

  后端
  cd backend
  uv run black deeppdf-api/src/          # 格式化
  uv run ruff check deeppdf-api/src/     # 代码检查
  uv run mypy deeppdf-api/src/           # 类型检查

  前端
  cd frontend
  npm run build                          # 构建时进行类型检查（tsc -noEmit）

  运行测试

  后端（pytest）
  cd backend
  uv run pytest deeppdf-api/tests/ -v              # 全部测试
  uv run pytest deeppdf-api/tests/test_api.py -v  # 单个文件

  前端插件（vitest 单元测试）
  cd frontend
  npm run test:run                      # 命令行运行
  npm run test:ui                       # UI 界面

  部署到 Obsidian 测试

  cd frontend
  npm run deploy                        # 构建并复制到 vault 插件目录
  然后在 Obsidian 设置中重新启用插件。

  Obsidian 插件调试

  1. 在 Obsidian 中按 Ctrl+Shift+I（Mac: Cmd+Option+I）打开开发者工具
  2. Console 中查看日志
  3. 使用 app.plugins.plugins['deeppdf'] 访问插件实例

  ---
  开发规范

  Python 代码规范
  ┌──────────┬──────────────┬───────────────────┐
  │   项目   │     规范     │       工具        │
  ├──────────┼──────────────┼───────────────────┤
  │ 行长度   │ 100 字符     │ black             │
  ├──────────┼──────────────┼───────────────────┤
  │ 目标版本 │ Python 3.10+ │ -                 │
  ├──────────┼──────────────┼───────────────────┤
  │ 格式化   │ black 风格   │ uv run black      │
  ├──────────┼──────────────┼───────────────────┤
  │ 代码检查 │ ruff 规则    │ uv run ruff check │
  ├──────────┼──────────────┼───────────────────┤
  │ 类型检查 │ mypy         │ uv run mypy       │
  └──────────┴──────────────┴───────────────────┘
  TypeScript 代码规范
  ┌──────────┬────────────┬─────────────┐
  │   项目   │    规范    │    工具     │
  ├──────────┼────────────┼─────────────┤
  │ 编译目标 │ ES2020     │ tsc         │
  ├──────────┼────────────┼─────────────┤
  │ 模块系统 │ ESNext     │ tsc         │
  ├──────────┼────────────┼─────────────┤
  │ 类型检查 │ 构建时检查 │ tsc -noEmit │
  ├──────────┼────────────┼─────────────┤
  │ 构建工具 │ esbuild    │ esbuild     │
  └──────────┴────────────┴─────────────┘
  Git 提交规范

  # 格式
  <type>: <subject>

  # 类型
  feat:     新功能
  fix:      修复 bug
  refactor: 重构（不改变功能）
  docs:     文档更新
  test:     测试相关
  chore:    构建/工具链相关

  # 示例
  git commit -m "feat: 添加批量索引功能"
  git commit -m "fix: 修复查询返回空结果的问题"

  代码审查原则

  1. 测试先行: 修改功能前先运行相关测试
  2. 类型安全: 确保类型检查通过（mypy/tsc）
  3. 格式统一: 提交前运行格式化工具
  4. 简洁原则: 避免过度工程化，按需实现

  ---
  项目内部结构

  关键文件路径

  backend/deeppdf-api/src/deeppdf/
  ├── main.py              # FastAPI 入口，添加路由需要修改
  ├── config.py            # 全局配置，添加新配置项
  ├── api/
  │   ├── routes.py        # API 端点定义，添加接口
  │   └── models.py        # Pydantic 模型，定义请求/响应
  ├── services/
  │   ├── indexer.py       # PDF 索引逻辑
  │   ├── querier.py       # 查询逻辑
  │   ├── manager.py       # 索引管理（列表/删除）
  │   └── smart_search.py  # 智能搜索
  └── storage/
      ├── chroma_store.py  # 向量数据库封装
      └── embeddings.py    # 嵌入模型配置

  frontend/src/
  ├── main.ts              # 插件入口，注册命令和视图
  ├── api/
  │   ├── http-client.ts   # API 调用封装
  │   └── server-manager.ts # 后端服务管理
  ├── views/
  │   └── sidebar-view.ts  # 侧边栏视图（查询界面）
  └── ui/
      └── index-manager-modal.ts  # 索引管理弹窗

  分层架构

  请求流：API → Services → Storage

  API 层 (api/)
    - 定义 HTTP 端点
    - 请求参数验证（Pydantic）
    - 响应格式化

  Services 层 (services/)
    - 业务逻辑处理
    - CPU 密集型任务（ThreadPoolExecutor）
    - I/O 密集型任务（asyncio）

  Storage 层 (storage/)
    - ChromaDB 向量存储
    - 元数据持久化

  数据流

  索引流程
  用户上传 PDF → indexer.py 调用 PageIndex
  → 解析章节结构 → LLM 生成摘要
  → embeddings.py 向量化 → chroma_store.py 存储

  查询流程
  用户输入查询 → querier.py 向量化查询
  → chroma_store.py 检索相似片段
  → 返回结果给前端

  ---
  开发注意事项

  异步编程策略

  CPU 密集型任务（如 PDF 索引）
  # 使用 ThreadPoolExecutor
  cpu_executor = ThreadPoolExecutor(max_workers=settings.cpu_workers)
  result = await loop.run_in_executor(cpu_executor, cpu_intensive_function)

  I/O 密集型任务（如数据库查询）
  # 使用 asyncio.to_thread
  result = await asyncio.to_thread(io_intensive_function)

  配置参数（config.py）
  - cpu_workers: 2 - CPU 并发工作线程数
  - max_concurrent_requests: 10 - 最大并发 HTTP 请求数
  - llm_concurrent_limit: 3 - LLM 调用并发限制

  nest_asyncio 兼容性

  PageIndex 使用同步代码，需要 nest_asyncio 支持：

  import nest_asyncio
  nest_asyncio.apply()  # 允许在事件循环中嵌套事件循环

  服务器启动必须使用：
  uvicorn deeppdf.main:app --port 6088 --loop asyncio
  否则会报错：ValueError: Can't patch loop of type <class 'uvloop.Loop'>

  CORS 配置

  开发环境允许所有来源（main.py）：
  app.add_middleware(
      CORSMiddleware,
      allow_origins=["*"],
      allow_credentials=True,
      allow_methods=["*"],
      allow_headers=["*"],
  )
  生产环境应限制为具体域名。

  端口冲突

  默认端口 6088，如被占用需修改：
  1. 后端：启动命令 --port 6089
  2. 前端：插件设置中修改 apiPort
  3. 确保前后端端口一致

  向量数据库

  ChromaDB 数据存储在 backend/data/chroma/：
  - 清理索引时需删除此目录
  - 首次运行自动下载中文嵌入模型（bge-small-zh-v1.5）

  LLM API

  PageIndex 需要配置 LLM API（默认 DeepSeek）：
  # backend/.env
  DEEPSEEK_API_KEY=your_key
  # 或
  OPENAI_API_KEY=your_key

  ---
  故障排除（开发向）

  服务器无法启动

  错误: ValueError: Can't patch loop of type <class 'uvloop.Loop'>

  原因: 使用了 uvloop 而非 asyncio

  解决:
  uv run uvicorn deeppdf.main:app --port 6088 --loop asyncio

  ---
  测试失败：ModuleNotFoundError

  错误: ModuleNotFoundError: No module named 'deeppdf'

  原因: 未在 backend 目录运行或未安装依赖

  解决:
  cd backend
  uv sync
  uv run pytest deeppdf-api/tests/ -v

  ---
  Pydantic 验证错误

  错误: Extra inputs are not permitted

  原因: .env 文件包含未在 Settings 中定义的环境变量

  解决:
  1. 检查 backend/.env，移除未使用的变量
  2. 或在 Settings.Config 中设置 extra = "ignore"

  ---
  前端类型错误

  错误: TypeScript 类型检查失败

  解决:
  cd frontend
  npm run build  # 查看具体类型错误
  常见问题：
  - Obsidian API 类型：确保安装了 obsidian 最新包
  - 缺少类型定义：使用 // @ts-ignore 临时跳过（需注释原因）

  ---
  插件无法连接后端

  检查步骤:
  1. 确认后端运行：curl http://localhost:6088/health
  2. 确认端口配置：插件设置中 apiPort 与后端一致
  3. 查看后端日志：检查是否有 CORS 或请求错误

  ---
  PageIndex 测试超时

  错误: LLM 调用超时

  解决:
  1. 检查 API Key 配置
  2. 检查网络连接
  3. 调整超时配置（如适用）

  ---
  调试技巧

  后端: 在服务启动时查看日志，使用 print() 或 logging

  前端: 在 Obsidian 中按 Ctrl+Shift+I 打开开发者工具
  // 访问插件实例
  app.plugins.plugins['deeppdf']

  ---
  相关文档

  详细的架构和开发文档请查看 docs/ 目录。核心参考：

  - API 文档：http://localhost:6088/docs（服务器启动后访问）
  - 架构设计：docs/设计/架构设计.md
  - 后端开发：docs/开发/后端开发.md
  - 前端开发：docs/开发/前端开发.md

  ---
  版本: v1.0.0
  最后更新: 2026-01-17