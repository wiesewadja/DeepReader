# DeepReader 功能点清单

> **用户视角的产品功能全集**。与 [`product-manual.md`](./product-manual.md) 互补：
> - `product-manual.md` = 架构师/开发者视角（讲文件、API、模块）
> - `features.md` = 产品/QA 视角（讲用户能做什么、怎么算成功）
>
> 每个 feature 含 7 个字段：**用户故事 / 前置条件 / 输入 / 输出 / 验收标准 / 对应测试 / 详见 manual**。

---

## 1. 总览表

| ID | 功能 | 类别 | 状态 | 测试覆盖 |
|----|------|------|------|----------|
| F-01 | 索引 PDF 书籍 | 索引 | ✅ 已实现 | ✅ 强 |
| F-02 | 索引 EPUB 书籍 | 索引 | ✅ 已实现 | ✅ 强 |
| F-03 | 索引 Markdown 文件 | 索引 | ✅ 已实现 | ⚠️ 间接 |
| F-04 | 索引导出为 Obsidian 笔记 | 索引 | ✅ 已实现 | ✅ 强 |
| F-05 | 单书混合搜索 | 搜索 | ✅ 已实现 | ⚠️ 核心被排除 |
| F-06 | 跨已读书搜索 | 搜索 | ✅ 已实现 | ❌ 无 |
| F-07 | 闲聊问答（depth=0） | 对话 | ✅ 已实现 | ✅ 强 |
| F-08 | 检视阅读（depth=1） | 对话 | ✅ 已实现 | ✅ 强 |
| F-09 | 分析阅读（depth=2） | 对话 | ✅ 已实现 | ✅ 强 |
| F-10 | 主题阅读（多书对比） | 对话 | ✅ 已实现 | ✅ 强 |
| F-11 | 主动阅读引导 | 对话 | ✅ 已实现 | ✅ 强 |
| F-12 | 工具：search_book | 工具 | ✅ 已实现 | ✅ 强 |
| F-13 | 工具：read_book_section | 工具 | ✅ 已实现 | ✅ 强 |
| F-14 | 工具：write_note | 工具 | ✅ 已实现 | ❌ 无 |
| F-15 | 工具：canvas 可视化 | 工具 | ✅ 已实现 | ✅ 强 |
| F-16 | 工具：excalidraw 图形 | 工具 | ✅ 已实现 | ⚠️ 间接 |
| F-17 | 分页阅读 + 章节导航 | 阅读 | ✅ 已实现 | ✅ 强 |
| F-18 | 文字选择 + 工具栏 | 阅读 | ✅ 已实现 | ❌ 无 |
| F-19 | 阅读进度追踪 | 阅读 | ✅ 已实现 | ✅ 强 |
| F-20 | 高亮 + 摘录保存 | 摘录 | ✅ 已实现 | ❌ 无 |
| F-21 | 摘录按书籍/日期组织 | 摘录 | ✅ 已实现 | ❌ 无 |
| F-22 | Sidebar 聊天界面 | UI | ✅ 已实现 | ⚠️ 部分 |
| F-23 | Library 书库管理 | UI | ✅ 已实现 | ❌ 无 |
| F-24 | Quick Setup 向导 | UI | ✅ 已实现 | ✅ 强 |
| F-25 | Settings 面板 | UI | ✅ 已实现 | ✅ 强 |
| F-26 | 微信读书账号绑定 | 微信 | ✅ 已实现 | ✅ 强 |
| F-27 | 微信读书标注同步 | 微信 | ✅ 已实现 | ✅ 强 |
| F-28 | 微信强制全量 + 重匹配 | 微信 | ✅ 已实现 | ⚠️ 间接 |
| F-29 | Z-Library 搜索 + 下载 | ZLib | ✅ 已实现 | ✅ 强 |
| F-30 | PI 子进程 | PI | ✅ 已实现 | ✅ 强 |
| F-31 | PI 可视化器 | PI | ✅ 已实现 | ✅ 强 |
| F-32 | 用户画像 + 长期记忆 | 记忆 | ✅ 已实现 | ✅ 强 |
| F-34 | LangSmith 追踪 | 可观测 | ✅ 已实现 | ❌ 无 |
| F-35 | 提早停止 | 稳定 | ✅ 已实现 | ✅ 强 |

> 覆盖状态图例：✅ 强 = 单元 + E2E 都有；⚠️ 间接 = 部分覆盖或核心被排除；❌ 无 = 无专门测试。

---

## 2. 详细功能列表

### F-01: 索引 PDF 书籍

- **用户故事**: 作为读者，我希望把 PDF 文件交给 DeepReader，3 分钟内能搜到里面的内容
- **前置条件**: 已配置 LLM API Key（任一 provider）；扫描件需启用 OCR（API 或本地 poppler）
- **输入**: 一个 PDF 文件（任意大小；文本型/扫描型均可）
- **输出**:
  - `.pageindex/{bookId}/book-meta.json` + `tree.json` + `bm25.json`（+ `vectors.jsonl` 若启用 embedding）
  - Library 视图出现该书
  - 若开启自动导出：`DeepReader/{书名}/` 目录下生成章节 Markdown
- **验收标准**:
  - [ ] 100 页文本型 PDF 在 LLM API 正常时 < 3 分钟完成
  - [ ] 100 页扫描型 PDF 启用 OCR 时 < 10 分钟完成
  - [ ] 失败时显示进度卡 + 可重试
  - [ ] 同一文件二次索引命中缓存（< 5s 完成，不重新调 LLM）
  - [ ] Book ID 基于内容哈希生成（文件移动/重命名后 ID 不变）
  - [ ] 索引过程控制台无 error 级别日志
  - [ ] 索引完成后 sidebar 中可搜到该书内容
- **对应测试**:
  - 单元: `tests/unit/pageindex/book-indexer.test.ts`、`book-id-migration.test.ts`、`path-migration.test.ts`、`chunker.test.ts`、`parsers/mineru.test.ts`、`index-tracer.test.ts`
  - E2E: `tests/e2e/specs/pdf-parsing.e2e.ts`、`pdf-index-export.e2e.ts`
  - 覆盖状态: ✅ 强
- **详见**: product-manual §2.1

---

### F-02: 索引 EPUB 书籍

- **用户故事**: 作为读者，我希望把 EPUB 文件交给 DeepReader，能像 PDF 一样被搜索和提问
- **前置条件**: 已配置 LLM API Key
- **输入**: 一个 EPUB 文件
- **输出**: 同 F-01，目录结构一致
- **验收标准**:
  - [ ] 标准 EPUB 2/3 格式 < 1 分钟完成
  - [ ] 包含图片/表格的 EPUB 能正确提取章节结构
  - [ ] EPUB 章节切分边界正确（不切断段落）
  - [ ] 失败时显示进度卡 + 可重试
  - [ ] 同一文件二次索引命中缓存
  - [ ] 索引过程无 error 日志
- **对应测试**:
  - 单元: `tests/unit/pageindex/epub-splitting.test.ts`
  - E2E: `tests/e2e/specs/epub-parsing-quality.e2e.ts`、`epub-user-flow.e2e.ts`、`epub-index-export.e2e.ts`
  - 覆盖状态: ✅ 强
- **详见**: product-manual §2.1

---

### F-03: 索引 Markdown 文件

- **用户故事**: 作为用户，我希望把已有的 Markdown 笔记也纳入 DeepReader 的搜索范围
- **前置条件**: 已配置 LLM API Key
- **输入**: 一个或多个 `.md` 文件
- **输出**: `.pageindex/{bookId}/` 索引文件 + Library 视图收录
- **验收标准**:
  - [ ] 含 YAML frontmatter 的 MD 文件能正确解析标题
  - [ ] 包含 `[[wiki-link]]` 的 MD 文件保留链接关系
  - [ ] 大文件（> 10000 行）能分段索引
  - [ ] 失败时显示进度卡 + 可重试
  - [ ] 索引过程无 error 日志
- **对应测试**: 无专门测试（由 F-01/F-04 间接覆盖）
- **对应测试**:
  - 覆盖状态: ⚠️ 间接
- **详见**: product-manual §2.1.2

---

### F-04: 索引导出为 Obsidian 笔记

- **用户故事**: 作为用户，我希望索引完成后，章节内容自动出现在 Vault 里，能用 Obsidian 的搜索/链接
- **前置条件**: F-01/F-02/F-03 已完成索引；设置中开启"自动导出"
- **输入**: 已索引的书籍
- **输出**:
  - `DeepReader/{书名}/章节-{N}-{章节名}.md` 文件
  - 每章含 YAML frontmatter（书名、章节号、bookId、tags）
  - 包含 `^block-ref` 锚点供反向引用
- **验收标准**:
  - [ ] 每章生成独立 MD 文件
  - [ ] 章节文件能用 Obsidian 搜索到
  - [ ] 文件包含正确的 frontmatter
  - [ ] 块引用锚点可被 LangGraph 工具使用
  - [ ] 重新导出不会产生重复文件
  - [ ] 失败的单章不影响其他章节导出
- **对应测试**:
  - 单元: `tests/unit/pageindex/asterisk-fix.test.ts`
  - E2E: `tests/e2e/specs/pdf-index-export.e2e.ts`、`epub-index-export.e2e.ts`
  - 覆盖状态: ✅ 强
- **详见**: product-manual §2.1

---

### F-05: 单书混合搜索

- **用户故事**: 作为读者，我希望在选中一本书后，能用关键词或语义问句找到相关章节
- **前置条件**: 至少一本书已索引
- **输入**: 搜索关键词或自然语言问句
- **输出**: 排序后的章节片段列表（含页码、原文片段、bookId）
- **验收标准**:
  - [ ] BM25 关键词搜索结果与查询词强相关
  - [ ] 启用 embedding 时向量搜索能召回语义近似段落
  - [ ] 搜索结果按 RRF 融合分数排序
  - [ ] 支持章节范围过滤（scope filter）
  - [ ] 100ms 内返回 Top-10 结果（< 10k 节点的书籍）
  - [ ] 无匹配时返回明确空结果（非错误）
- **对应测试**:
  - 单元: `tests/unit/pageindex/bm25.test.ts`、`proposition-search.test.ts`、`vector-storage.test.ts`
  - 排除项: `tests/unit/pageindex/book-search-v2.test.ts`（在 vitest.config.ts 排除列表）
  - 覆盖状态: ⚠️ 核心被排除
- **详见**: product-manual §2.2

---

### F-06: 跨已读书搜索

- **用户故事**: 作为用户，我希望搜一个概念时能同时召回我所有已读书里的相关内容
- **前置条件**: 至少 2 本书已索引
- **输入**: 搜索关键词
- **输出**: 跨书结果列表（含书名、章节、原文片段）
- **验收标准**:
  - [ ] 结果按书聚合，每本书 Top-K
  - [ ] 支持按书名/作者/标签过滤
  - [ ] 跨书结果数 < 50 时 < 500ms 返回
  - [ ] 无匹配时返回明确空结果
  - [ ] 来源标注清楚（避免幻觉）
- **对应测试**:
  - 单元: `tests/unit/agent/router-syntopical.test.ts`、`utils/syntopical-search.test.ts`（间接）
  - 覆盖状态: ❌ 无
- **详见**: product-manual §2.2.2

---

### F-07: 闲聊问答（depth=0）

- **用户故事**: 作为用户，我希望和 AI 闲聊（不涉及具体书籍）也能得到自然回复
- **前置条件**: 已配置 LLM API Key
- **输入**: 自然语言问句（无书籍上下文需求）
- **输出**: AI 自然回复 + 流式输出
- **验收标准**:
  - [ ] Router 正确识别为 depth=0（不调用搜索工具）
  - [ ] 响应时间 < 15s
  - [ ] 流式输出无截断
  - [ ] 切换话题时正确路由
  - [ ] 闲聊不引用任何书籍内容
- **对应测试**:
  - 单元: `tests/unit/agent/router/intent-router.test.ts`
  - E2E: `tests/e2e/specs/langgraph-agent.e2e.ts`（depth=0 用例）
  - 覆盖状态: ✅ 强
- **详见**: product-manual §2.3.1

---

### F-08: 检视阅读（depth=1）

- **用户故事**: 作为读者，我希望快速了解一本书讲什么（不深挖细节）
- **前置条件**: 至少一本书已索引
- **输入**: 关于某本书的结构性问题（"讲什么 / 几章 / 主题"）
- **输出**: AI 回复 + 目录导航
- **验收标准**:
  - [ ] Router 正确识别为 depth=1
  - [ ] 使用目录树（tree.json）而非全文检索
  - [ ] 响应时间 < 45s
  - [ ] 引用了正确的 bookId
  - [ ] 不调用 `search_book` / `read_book_section` 工具
- **对应测试**:
  - 单元: `tests/unit/agent/graph/pre-search.test.ts`
  - E2E: `tests/e2e/specs/langgraph-agent.e2e.ts`（depth=1 用例）
  - 覆盖状态: ✅ 强
- **详见**: product-manual §2.3.1

---

### F-09: 分析阅读（depth=2）

- **用户故事**: 作为读者，我希望对书中某个具体概念深挖（找到原文 + 跨章节分析）
- **前置条件**: 至少一本书已索引
- **输入**: 关于某本书的具体问题（"作者怎么解释 X / 第三章讲了什么"）
- **输出**: AI 回复 + 引用片段 + 章节定位
- **验收标准**:
  - [ ] Router 正确识别为 depth=2
  - [ ] 调用 `search_book` 和 `read_book_section` 工具
  - [ ] ReAct 循环支持多轮工具调用（最多 N 轮）
  - [ ] 响应时间 < 120s
  - [ ] 引用片段含正确页码/章节
  - [ ] 跨章节分析能识别一致/矛盾观点
  - [ ] 提早停止生效（无新信息时停止搜索）
- **对应测试**:
  - 单元: `tests/unit/agent/graph/{react-loop,edges,stream-processor}.test.ts`、`agent/tools/local/{search-text,read-section,integration,state-machine-flow,performance,utils,get-outline}.test.ts`、`agent/tools/langchain-tools.test.ts`
  - E2E: `tests/e2e/specs/langgraph-agent.e2e.ts`（depth=2 用例）、`early-stop.e2e.ts`
  - 覆盖状态: ✅ 强
- **详见**: product-manual §2.3.1

---

### F-10: 主题阅读（多书对比）

- **用户故事**: 作为研究者，我希望同时问多本书，AI 能对比不同作者的观点
- **前置条件**: 至少 2 本书已索引
- **输入**: 跨书主题性问题（"X 在 A 和 B 里分别怎么解释"）
- **输出**: AI 对比回复 + 每本书的引用
- **验收标准**:
  - [ ] Router 正确识别为 syntopical
  - [ ] 跨书检索返回 Top-K 命中
  - [ ] 对比回复中能区分"书 A 说...书 B 说..."
  - [ ] 响应时间 < 180s
  - [ ] 引用每本书至少 1 处
  - [ ] 矛盾观点能被识别并标注
- **对应测试**:
  - 单元: `tests/unit/agent/router-syntopical.test.ts`、`utils/syntopical-search.test.ts`
  - 覆盖状态: ✅ 强
- **详见**: product-manual §2.3.1

---

### F-11: 主动阅读引导

- **用户故事**: 作为读者，我希望在阅读某本书时，AI 能主动引导我思考（而非我主动提问）
- **前置条件**: 至少一本书已索引且已读了一部分；设置中开启"主动引导"
- **输入**: 用户的阅读位置（章节/页码）
- **输出**: 主动推送的引导消息（卡片形式）
- **验收标准**:
  - [ ] 引导引擎在用户切到新章节时触发
  - [ ] 引导消息含可操作的"问题按钮"（用户可一键发送）
  - [ ] 不在用户主动聊天时打扰
  - [ ] 关闭设置后不再触发
  - [ ] 引导历史可查看/清除
  - [ ] 一次只推送一条引导（避免刷屏）
- **对应测试**:
  - 单元: `tests/unit/agent/proactive/{engine,state}.test.ts`、`graph/proactive-edges.test.ts`
  - 覆盖状态: ✅ 强
- **详见**: product-manual §2.3.1

---

### F-12: 工具 — search_book

- **用户故事**: 作为 Agent，我需要在 LangGraph 节点中调用搜索工具获取章节片段
- **前置条件**: LangGraph 状态机已初始化；目标书已索引
- **输入**: `bookId` + 关键词数组
- **输出**: 排序后的搜索结果（章节、页码、片段、分数）
- **验收标准**:
  - [ ] 多关键词并行检索
  - [ ] 返回 Top-K（默认 5）
  - [ ] 支持按章节范围过滤
  - [ ] 100ms 内返回结果
  - [ ] 无匹配返回空数组（不抛错）
  - [ ] 错误时返回明确错误信息
- **对应测试**:
  - 单元: `tests/unit/agent/tools/local/{search-text,utils}.test.ts`
  - 覆盖状态: ✅ 强
- **详见**: product-manual §2.2.2

---

### F-13: 工具 — read_book_section

- **用户故事**: 作为 Agent，我需要读取指定章节的完整内容用于分析
- **前置条件**: LangGraph 状态机已初始化；目标书已索引
- **输入**: `bookId` + 章节定位（章节号 / 标题 / 页码）
- **输出**: 章节完整 Markdown 内容
- **验收标准**:
  - [ ] 按章节号/标题/页码都能定位
  - [ ] 内容包含 YAML frontmatter
  - [ ] 大章节（> 5000 字）能正确返回
  - [ ] 无效章节返回明确错误
  - [ ] 200ms 内返回结果
- **对应测试**:
  - 单元: `tests/unit/agent/tools/local/read-section.test.ts`
  - 覆盖状态: ✅ 强
- **详见**: product-manual §2.2.2

---

### F-14: 工具 — write_note

- **用户故事**: 作为 Agent，我需要把对话中产生的洞察写入 Vault 笔记
- **前置条件**: LangGraph 状态机已初始化；路径可写
- **输入**: 笔记内容（Markdown）+ 目标路径 + 可选 frontmatter
- **输出**: 写入成功的文件路径
- **验收标准**:
  - [ ] 写入到正确路径
  - [ ] 保留 frontmatter
  - [ ] 文件已存在时询问/追加/覆盖（按设置）
  - [ ] 路径非法时返回明确错误
  - [ ] 成功后返回的文件路径可在 Obsidian 中打开
  - [ ] 不影响 Obsidian 当前打开的文件
- **对应测试**: 无
- **覆盖状态**: ❌ 无
- **详见**: product-manual §2.3.2

---

### F-15: 工具 — canvas 可视化

- **用户故事**: 作为用户，我希望 Agent 能把对比/分析结果生成 Canvas 关系图
- **前置条件**: LangGraph 状态机已初始化；Obsidian Canvas 插件可用
- **输入**: 节点（概念）+ 边（关系）
- **输出**: `.canvas` 文件 + 文件路径
- **验收标准**:
  - [ ] 生成的 Canvas 在 Obsidian 中能打开
  - [ ] 节点/边数量与输入一致
  - [ ] 颜色按概念类型分组
  - [ ] 失败时返回明确错误
  - [ ] 输出路径遵循 Vault 约定
- **对应测试**:
  - 单元: `tests/unit/agent/tools/canvas.test.ts`
  - 覆盖状态: ✅ 强
- **详见**: product-manual §2.3.2

---

### F-16: 工具 — excalidraw 图形

- **用户故事**: 作为用户，我希望 Agent 能生成手绘风格的 Excalidraw 思维导图
- **前置条件**: LangGraph 状态机已初始化；Excalidraw 插件已安装
- **输入**: 思维导图结构（中心节点 + 分支）
- **输出**: Excalidraw `.excalidraw` 文件
- **验收标准**:
  - [ ] 生成的 Excalidraw 在 Obsidian 中能打开
  - [ ] 包含手绘风格元素
  - [ ] 节点/边关系正确
  - [ ] 大型思维导图（> 50 节点）能正确生成
  - [ ] 失败时返回明确错误
- **对应测试**:
  - 单元: `tests/unit/agent/tools/langchain-tools.test.ts`（间接）
  - 覆盖状态: ⚠️ 间接
- **详见**: product-manual §2.3.2

---

### F-17: 分页阅读 + 章节导航

- **用户故事**: 作为读者，我希望在 DeepReader 里像翻书一样阅读 PDF/EPUB
- **前置条件**: 文件已索引
- **输入**: 选择书籍 + 进入阅读模式
- **输出**: 分页渲染的章节内容 + 章节导航栏
- **验收标准**:
  - [ ] 上一页/下一页快捷键工作（←/→）
  - [ ] 章节导航栏能跳转到指定章节
  - [ ] 当前页码/总页码显示
  - [ ] 翻页 < 200ms
  - [ ] 字号可调
  - [ ] 阅读位置退出后保留
- **对应测试**:
  - 单元: `tests/unit/components/page-paginator.test.ts`、`chapter-nav-keyboard.test.ts`
  - E2E: `tests/e2e/specs/reading-mode-pagination.e2e.ts`、`epub-user-flow.e2e.ts`
  - 覆盖状态: ✅ 强
- **详见**: product-manual §2.4

---

### F-18: 文字选择 + 工具栏

- **用户故事**: 作为读者，我希望选中一段文字后能立即高亮、摘录或基于它提问
- **前置条件**: 阅读模式已打开
- **输入**: 鼠标选择文字
- **输出**: 悬浮工具栏（含高亮/摘录/提问按钮）
- **验收标准**:
  - [ ] 工具栏在选择后 < 300ms 出现
  - [ ] 点击外部区域自动关闭
  - [ ] 三个按钮都可点击
  - [ ] 工具栏位置不遮挡选中文本
  - [ ] 移动端长按触发
- **对应测试**: 无
- **覆盖状态**: ❌ 无
- **详见**: product-manual §2.4

---

### F-19: 阅读进度追踪

- **用户故事**: 作为读者，我希望我的阅读位置自动保存，下次打开从上次位置继续
- **前置条件**: 文件已索引；阅读模式已打开过
- **输入**: 用户的翻页操作
- **输出**: `.pageindex/{bookId}/reading-progress.json` 持久化进度
- **验收标准**:
  - [ ] 进度自动保存（每翻 1 页或 5 秒）
  - [ ] 重启 Obsidian 后从上次位置继续
  - [ ] 跨设备同步（如开启 Vault 同步）
  - [ ] 进度可视化（已完成 X% / 当前章节）
  - [ ] 支持重置进度
- **对应测试**:
  - 单元: `tests/unit/pageindex/index-tracer.test.ts`
  - E2E: `tests/e2e/specs/index-trace.e2e.ts`
  - 覆盖状态: ✅ 强
- **详见**: product-manual §2.4

---

### F-20: 高亮 + 摘录保存

- **用户故事**: 作为读者，我希望把重要的段落高亮保存为可搜索的摘录
- **前置条件**: 阅读模式已打开
- **输入**: 选中的文字 + 触发"高亮"或"摘录"
- **输出**: 摘录文件 `书籍摘录/{书名}/摘录-{日期}.md`
- **验收标准**:
  - [ ] 高亮在阅读模式中可视
  - [ ] 摘录文件含原文 + 出处（书名/章节/页码）
  - [ ] 摘录含时间戳
  - [ ] 同一段落二次摘录不重复
  - [ ] 摘录可被 Obsidian 全局搜索
  - [ ] 失败时显示提示
- **对应测试**: 无
- **覆盖状态**: ❌ 无
- **详见**: product-manual §2.5

---

### F-21: 摘录按书籍/日期组织

- **用户故事**: 作为用户，我希望摘录按书名分组、按日期命名，方便回看
- **前置条件**: 已有摘录
- **输入**: 触发"整理摘录"
- **输出**: 整理后的目录结构
- **验收标准**:
  - [ ] `书籍摘录/{书名}/` 目录结构
  - [ ] 文件命名 `摘录-YYYY-MM-DD.md`
  - [ ] 同一日多次摘录合并到一个文件
  - [ ] 旧摘录不被破坏
  - [ ] 整理操作可撤销
- **对应测试**: 无
- **覆盖状态**: ❌ 无
- **详见**: product-manual §2.5

---

### F-22: Sidebar 聊天界面

- **用户故事**: 作为用户，我希望在右侧栏直接和 AI 对话，无需切换窗口
- **前置条件**: 插件已加载
- **输入**: 点击 DeepReader 图标 / 命令面板打开 sidebar
- **输出**: 右侧栏出现聊天界面（含书库选择、消息列表、输入框）
- **验收标准**:
  - [ ] 命令 `DeepReader: Open DeepReader sidebar` 可打开
  - [ ] sidebar 包含书库选择、消息区、输入框
  - [ ] 消息流式输出（逐字显示）
  - [ ] 操作按钮（重新生成/复制）可点击
  - [ ] 支持多轮对话
  - [ ] sidebar 可关闭/重开不丢消息
- **对应测试**:
  - 单元: `tests/unit/components/{chat-input,drawer,top-nav,chapter-nav-keyboard}.test.ts`（`message.test.ts` 和 `views/sidebar-view.test.ts` 被排除）
  - E2E: `tests/e2e/specs/langgraph-agent.e2e.ts`、`weread-ui.e2e.ts`
  - 覆盖状态: ⚠️ 部分
- **详见**: product-manual §3.1

---

### F-23: Library 书库管理

- **用户故事**: 作为用户，我希望在一个集中视图里管理所有已索引的书籍
- **前置条件**: 插件已加载
- **输入**: 命令 `DeepReader: Open Library` / sidebar 中的"书库"按钮
- **输出**: Library 视图（书籍列表 + 添加按钮 + 搜索框）
- **验收标准**:
  - [ ] 书籍列表显示书名、作者、进度
  - [ ] 添加 PDF/EPUB 按钮可点击
  - [ ] 支持搜索书名/作者
  - [ ] 支持按标签/状态过滤
  - [ ] 删除书籍二次确认
  - [ ] 大库（> 100 本）滚动流畅
- **对应测试**: 无
- **覆盖状态**: ❌ 无
- **详见**: product-manual §3.1

---

### F-24: Quick Setup 向导

- **用户故事**: 作为新用户，我希望有个引导帮我配置 API Key 和模型
- **前置条件**: 首次安装或主动触发
- **输入**: 命令 `DeepReader: 打开快速配置`
- **输出**: 模态框（含 API Key 输入、provider 选择、模型选择）
- **验收标准**:
  - [ ] 模态框含 API Key 输入（密码类型）
  - [ ] provider 下拉列表（DeepSeek/Kimi/MiniMax/...）
  - [ ] 选择 provider 后显示对应模型
  - [ ] 配置保存后可立即使用
  - [ ] 已有配置时显示"重新配置"选项
  - [ ] 关闭后下次启动不再弹出
- **对应测试**:
  - 单元: `tests/unit/config/setup-complete.test.ts`
  - 覆盖状态: ✅ 强
- **详见**: product-manual §4

---

### F-25: Settings 面板（双层 providers/roles）

- **用户故事**: 作为高级用户，我希望精细控制每个角色（chat/router/embedding/...）用哪个模型
- **前置条件**: 插件已加载
- **输入**: Obsidian Settings → DeepReader
- **输出**: 多 tab 设置面板
- **验收标准**:
  - [ ] 含 6 个 tab：API/Embedding/Indexing/Reading/Tracing/Advanced
  - [ ] 双层结构：providers（账号）→ roles（角色）
  - [ ] 添加 provider 时校验 endpoint
  - [ ] 修改角色模型立即生效
  - [ ] 配置可导出/导入（备份）
  - [ ] 旧配置自动迁移（settings-migrator）
- **对应测试**:
  - 单元: `tests/unit/config/{providers,presets,presets-detect,apply-preset,embedding-dimensions,settings-migrator}.test.ts`、`settings/helpers.test.ts`
  - 覆盖状态: ✅ 强
- **详见**: product-manual §4

---

### F-26: 微信读书账号绑定

- **用户故事**: 作为微信读书用户，我希望把微信读书的书库同步到 DeepReader
- **前置条件**: 微信读书 API Key 已获取（通过 `微信读书：打开设置配置 API Key` 命令）
- **输入**: API Key
- **输出**: 微信书库出现在 Library 视图中
- **验收标准**:
  - [ ] API Key 加密保存
  - [ ] 拉取书库 < 30s
  - [ ] 失败时显示明确错误（401/网络/限流）
  - [ ] 支持清除/重新配置 API Key
  - [ ] 隐私提示：Key 仅本地存储
- **对应测试**:
  - 单元: `tests/unit/weread/{client,shelf,bookid}.test.ts`
  - E2E: `tests/e2e/specs/weread-api-debug.e2e.ts`
  - 覆盖状态: ✅ 强
- **详见**: product-manual §2.6

---

### F-27: 微信读书标注同步

- **用户故事**: 作为用户，我希望把微信读书里的标注/想法自动同步到本地
- **前置条件**: F-26 已完成
- **输入**: 触发 `微信读书：同步笔记`
- **输出**: 标注 + 想法写入 `DeepReader/微信读书/{书名}/`
- **验收标准**:
  - [ ] 增量同步（仅拉取新标注）
  - [ ] 保留章节/页码信息
  - [ ] 想法（thoughts）和标注（highlights）分别保存
  - [ ] 同步进度可见
  - [ ] 失败时不破坏已有数据
  - [ ] 同步日志可查看
- **对应测试**:
  - 单元: `tests/unit/weread/{diff,highlight-importer,markdown-renderer,time,mapping-stats}.test.ts`
  - E2E: `tests/e2e/specs/weread-sync.e2e.ts`、`weread-ui.e2e.ts`
  - 覆盖状态: ✅ 强
- **详见**: product-manual §2.6

---

### F-28: 微信强制全量同步 + 重匹配

- **用户故事**: 作为用户，我希望在增量同步出错时强制全量重拉，或重新匹配本地书与微信书
- **前置条件**: F-26 已完成
- **输入**: 命令 `微信读书：强制全量同步` / `微信读书：重新匹配书籍`
- **输出**: 全量数据 / 重新匹配的映射表
- **验收标准**:
  - [ ] 强制全量会清空旧标注后重新拉取
  - [ ] 重匹配基于书名+作者相似度
  - [ ] 手动指定匹配对可保存
  - [ ] 操作有二次确认
  - [ ] 失败时回滚
- **对应测试**:
  - 单元: `tests/unit/weread/{matcher,text-matcher}.test.ts`（间接）
  - 覆盖状态: ⚠️ 间接
- **详见**: product-manual §2.6

---

### F-29: Z-Library 搜索 + 下载

- **用户故事**: 作为用户，我希望能在 DeepReader 里直接搜 Z-Library 找电子书
- **前置条件**: 用户主动启用 Z-Library（默认关闭）；已阅读并同意免责
- **输入**: 关键词 / 作者 / ISBN
- **输出**: Z-Library 搜索结果（书名/作者/格式/大小）+ 下载链接
- **验收标准**:
  - [ ] 默认禁用（需在设置中显式开启）
  - [ ] 首次启用显示完整免责声明
  - [ ] 搜索结果 < 30s 返回
  - [ ] 下载到 `DeepReader/Downloads/`
  - [ ] 下载后可一键加入书库
  - [ ] cookie 持久化（避免重复登录）
- **对应测试**:
  - 单元: `tests/unit/zlibrary/{client,cookie-jar}.test.ts`
  - 覆盖状态: ✅ 强
- **详见**: product-manual §1.2（README Features）

---

### F-30: PI 子进程

- **用户故事**: 作为开发者/高级用户，我希望 DeepReader 用持久化 PI 子进程管理 AI 任务，而非每次都重启
- **前置条件**: 已配置 LLM API Key
- **输入**: 启动 Obsidian / 触发 AI 任务
- **输出**: PI 子进程（Node.js）常驻，接收 RPC 调用
- **验收标准**:
  - [ ] 启动 Obsidian 时自动拉起 PI
  - [ ] PI 崩溃后自动重启（最多 3 次）
  - [ ] RPC 调用支持超时和重试
  - [ ] PI 配置（skills、tools）通过参数注入
  - [ ] 关闭 Obsidian 时 PI 也关闭
  - [ ] PI 日志可查看
- **对应测试**:
  - 单元: `tests/unit/agent/pi/{pi-client,pi-config,pi-context,pi-manager}.test.ts`
  - E2E: `tests/e2e/specs/pi-rpc.e2e.ts`、`pi-agent.e2e.ts`、`pi-detection.e2e.ts`
  - 覆盖状态: ✅ 强
- **详见**: product-manual §2.3

---

### F-31: PI 可视化器

- **用户故事**: 作为开发者/调试者，我希望实时看到 PI 子进程的内部状态（节点、tokens、tool calls）
- **前置条件**: F-30 已激活
- **输入**: 命令 `Debug: Test mindmap skill` / 自动触发
- **输出**: 可视化面板（含图、节点状态、统计）
- **验收标准**:
  - [ ] 显示当前 LangGraph 节点
  - [ ] 显示 token 用量
  - [ ] 显示工具调用历史
  - [ ] 实时刷新（每秒）
  - [ ] 关闭后不残留 DOM
- **对应测试**:
  - E2E: `tests/e2e/specs/pi-visualizer.e2e.ts`、`visualizer-pi.e2e.ts`
  - 覆盖状态: ✅ 强
- **详见**: product-manual §2.3

---

### F-32: 用户画像 + 长期记忆

- **用户故事**: 作为用户，我希望 AI 记住我的阅读偏好和重要洞察（跨对话）
- **前置条件**: 已配置 LLM API Key；至少 5 轮对话
- **输入**: 对话历史 + 主动确认
- **输出**: 用户画像（`profile-facts.json`）+ 长期记忆条目
- **验收标准**:
  - [ ] 提取用户偏好（喜欢/不喜欢/关心的话题）
  - [ ] 长期记忆按主题组织
  - [ ] 记忆在 System Prompt 中注入
  - [ ] 用户可查看/编辑/删除记忆
  - [ ] 关闭后记忆持久化
  - [ ] 嵌入画像支持语义搜索
- **对应测试**:
  - 单元: `tests/unit/services/{profile-facts,voice-profile}.test.ts`、`tests/unit/services/profile-builder-embedding.e2e.test.ts`
  - 覆盖状态: ✅ 强
- **详见**: product-manual §8.2

---

### F-34: LangSmith 追踪

- **用户故事**: 作为开发者/调试者，我希望把 Agent 执行 trace 上传到 LangSmith 用于分析
- **前置条件**: 已配置 LangSmith API Key（设置中）
- **输入**: 触发 Agent 对话
- **输出**: LangSmith 项目中可查看完整 trace
- **验收标准**:
  - [ ] 包含所有 LangGraph 节点
  - [ ] 包含 LLM 调用的 prompt/response
  - [ ] 包含工具调用的 args/result
  - [ ] 包含错误堆栈（如有）
  - [ ] 关闭后不上传（隐私开关）
  - [ ] 项目名可配置
- **对应测试**: 无（langsmith-tracer skill 用于手动调试）
- **覆盖状态**: ❌ 无
- **详见**: product-manual §8.3

---

### F-35: 提早停止（Early Stop）

- **用户故事**: 作为用户，我希望 AI 在没有新信息时停止搜索（不浪费 token/时间）
- **前置条件**: 分析阅读（depth=2）执行中
- **输入**: 连续 N 轮工具调用结果重复/无新意
- **输出**: ReAct 循环提前终止，进入 Formatter
- **验收标准**:
  - [ ] 检测到重复搜索关键词时停止
  - [ ] 检测到结果无新信息时停止
  - [ ] 最大轮数限制（防失控）
  - [ ] 停止原因可在 trace 中查看
  - [ ] 响应时间 < 配置上限
  - [ ] 不影响其他对话流
- **对应测试**:
  - 单元: `tests/unit/agent/graph/{react-loop,stream-processor}.test.ts`、`agent/tools/langchain-tools.test.ts`
  - E2E: `tests/e2e/specs/{early-stop,summary-description,scope-nodefilemap,l2-vectorization}.e2e.ts`
  - 覆盖状态: ✅ 强
- **详见**: product-manual §2.3.1

---

## 3. 迁移记录

### 2026-06: Skill 系统移交 PI

- **背景**: 原 `src/built-in-skills.ts` 和 `src/agent/skills/loader.ts` 维护成本高，与 LangGraph 状态机耦合。
- **变更**: Skill 文件（`DeepReader/skills/*.md`）由 PI 子进程通过 `--skill` 参数注入（见 `src/agent/pi/pi-config.ts:65`）。
- **Breaking Change**: skills 目录从 `.pi/skills` 迁移到 `DeepReader/skills`（见 `pi-config.ts:44`）。
- **TODO**: 同步更新 `docs/product-manual.md` §5 / §9 移除 Skill 章节。
- **TODO**: 补一份 `docs/decisions/ADR-XXX-skill-to-pi.md` 记录此决策的完整 ADR。

---

## 4. 文档维护说明

- **如何添加新 feature**: 在 §2 中按 ID 顺序追加（最新 ID 递增），并在 §1 总览表补一行。
- **如何标记测试覆盖**:
  - ✅ 强：单元测试 + E2E 都有覆盖
  - ⚠️ 间接：部分覆盖或核心被排除
  - ❌ 无：无专门测试（需补）
  - 🆕 待实现：功能未实装或未文档化
- **如何更新迁移记录**: 在 §3 中按时间倒序追加，新条目放最前面。
- **对应关系**: §1 总览表 + §2 详细列表 + §3 迁移记录 + product-manual.md 共同构成 DeepReader 完整文档。
