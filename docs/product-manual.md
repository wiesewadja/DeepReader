# DeepReader 产品说明书

> **奚童**：Obsidian 深度阅读插件，PDF/EPUB 智能索引、语义搜索与 AI 辅助阅读。

---

## 1. 产品概述

### 1.1 定位与目标

DeepReader 是一款面向 Obsidian 的深度阅读插件，定位为**纯前端本地化智能阅读助手**。无需后端服务器，所有索引和搜索均在本地完成，保护用户隐私。

**核心目标**：
- 将 PDF/EPUB 文档转化为结构化知识库
- 实现本地混合搜索（BM25 + 向量语义）
- 提供基于认知科学的 AI 阅读辅助（四层次阅读法）

### 1.2 核心能力矩阵

| 能力 | 描述 |
|------|------|
| 文档解析 | PDF/EPUB 解析，提取结构化目录和内容 |
| 智能索引 | LLM 辅助摘要生成，向量化存储 |
| 混合搜索 | BM25 关键词 + 向量语义融合排序 |
| AI 对话 | 基于 LangGraph 的认知引擎，支持四层次阅读 |
| 摘录笔记 | 高亮、摘录、保存到 Obsidian |
| 微信读书 | 同步微信读书标注和笔记 |

### 1.3 技术栈

| 层级 | 技术 |
|------|------|
| 语言 | TypeScript 5.x |
| 运行时 | Electron (Obsidian) |
| 构建 | esbuild 0.19 |
| Agent 框架 | LangGraph + LangChain |
| LLM | OpenAI 兼容 API（DeepSeek/Kimi/智谱/SiliconFlow） |
| 单元测试 | Vitest 1.x |
| E2E 测试 | WebdriverIO + wdio-obsidian-service |

---

## 2. 核心功能详解

### 2.1 文档索引系统（PageIndex Engine）

#### 2.1.1 索引流程

```
PDF/EPUB → 解析器 → 章节树 → LLM 摘要 → 向量化 → BM25 索引 → 导出 Markdown
```

**核心文件**：
- `src/pageindex/pageindex.ts` — 核心索引引擎
- `src/pageindex/book-indexer.ts` — 索引编排器
- `src/pageindex/parsers/` — 文档解析器（pdf.ts, epub.ts, ocr.ts）
- `src/pageindex/exporters/` — Obsidian Markdown 导出

**索引产物**：
```
.pageindex/{bookId}/
├── book-meta.json     # 书籍元数据（章节、摘要）
├── tree.json          # 章节树结构
├── bm25.json          # BM25 倒排索引
├── vectors.jsonl      # 向量数据（可选）
└── propositions/     # 命题卡片（可选）
```

**Book ID 生成**：
- 使用 SHA-256(文件前 64KB + 文件大小) 前 8 字符
- 内容哈希保证 ID 稳定性（文件移动/重命名不变）

#### 2.1.2 支持的文档格式

| 格式 | 解析器 | OCR 支持 |
|------|--------|---------|
| PDF | pdf-parse | 图像页 OCR（API） |
| EPUB | epub-parse | - |
| Markdown | md-parse | - |

### 2.2 混合搜索系统

#### 2.2.1 搜索架构

**搜索核心**（`src/pageindex/vault/` 目录下的 `search.ts` + `search-v2.ts` + `search-index.ts`）：
```
Query → BM25 检索 → 向量检索 → RRF 融合 → Top-K → L2 上下文
```

**v2 搜索**（`book-search-v2.ts`）— 8 阶段管线：
1. 动态召回 K 值计算
2. BM25 搜索
3. 向量语义搜索（可选）
4. 命题卡片搜索（可选）
5. 范围过滤（scope filter）
6. 分数融合 + 层级加权
7. LLM 树搜索（可选）
8. Cross-encoder 重排（可选）

#### 2.2.2 搜索工具

**Agent 搜索工具**（`src/agent/tools/local/`）：
- `search_book` — 多关键词并行检索 + RRF 融合
- `read_book_section` — 读取指定章节内容

### 2.3 AI 对话系统（FrontendAgent）

#### 2.3.1 认知引擎架构

基于《如何阅读一本书》的四层次阅读法：

| 层次 | 节点 | 功能 | 模型 |
|------|------|------|------|
| S0 | Router | 意图路由 + 查询重写 | Fast |
| S1 | Inspectional | 检视阅读（目录导航、结构概览） | Fast |
| S2 | Analytical | 分析阅读（ReAct 循环） | Main |
| S3 | Syntopical | 主题阅读（多书对比） | Main |
| S4 | Formatter | 格式化输出 + 自校验 | Main |

**状态流**：
```
S0 → (S1 | Formatter) → (S2-Pre → S2 | S3 | Visualizer) → S4
```

#### 2.3.2 工具集

| 工具 | 功能 |
|------|------|
| `search_book` | 书中搜索 |
| `read_book_section` | 读取章节 |
| `search_read_books` | 跨已读书搜索 |
| `search_journal` | 搜索用户个人笔记 |
| `write_note` | 写笔记 |
| `memory` | 记忆系统 |
| `weread_search` | 微信读书搜书 |
| `weread_recommend` | 微信读书推荐 |
| `weread_readdata` | 微信读书阅读统计 |
| `weread_notebooks` | 微信读书笔记概览 |
| `weread_book_info` | 微信读书书籍详情 |

#### 2.3.3 Agent 执行路径

```
FrontendAgent.chat() → runGraphEngine() → LangGraph stream()
```

**关键文件**：
- `src/agent/index.ts` — FrontendAgent 主入口
- `src/agent/graph/index.ts` — LangGraph StateGraph 编译
- `src/agent/graph/nodes/` — 各节点实现
- `src/agent/index.ts` — FrontendAgent 类（唯一入口）

### 2.4 阅读模式

**核心文件**：`src/components/reading-mode/reading-mode-orchestrator.ts`

**功能**：
- 分页阅读（章节导航）
- 文字选择与高亮
- 摘录保存

**子组件**：
- `page-paginator.ts` — 分页器
- `chapter-nav.ts` — 章节导航
- `selection-toolbar.ts` — 选择工具栏

### 2.5 摘录与笔记

**核心文件**：`src/services/excerpt-service.ts`

**功能**：
- 高亮保存
- 摘录格式化
- 笔记组织（按书籍/日期）

**保存路径**：`书籍摘录/{书名}/摘录-{日期}.md`

### 2.6 微信读书同步

**核心文件**：`src/weread/index.ts`

**功能**：
- 微信读书账号绑定
- 书库同步
- 标注/笔记导入
- 与本地索引关联

---

## 3. 用户界面

### 3.1 视图结构

```
src/views/
├── sidebar-view.ts      # 主侧边栏（对话界面）
├── sidebar/             # 侧边栏子组件
│   ├── chat-container.ts
│   ├── chat-header.ts
│   └── ...
└── library-view.ts      # 书库视图（书籍管理）
```

### 3.2 核心组件

```
src/components/
├── chat-input/          # 聊天输入框
├── message/             # 消息气泡
├── message-list/        # 消息列表
├── reading-mode/        # 阅读模式
├── question-minimap/    # 问题导航
├── index-manager/       # 索引管理
└── ...
```

### 3.3 主要交互

1. **侧边栏对话**：与 AI 助手交互，引用书籍内容
2. **书库管理**：添加、删除、搜索书籍
3. **阅读模式**：分页阅读，高亮摘录
4. **设置面板**：配置 API、角色、模型

---

## 4. 配置系统

### 4.1 两层架构

```
providers（服务商账号）
    └── roles（角色配置：chat/router/pageindex/embedding/reranker）
```

**内置服务商**：
- minimax
- deepseek
- kimi
- siliconflow
- openai
- xiaomi
- sensenova
- mineru

### 4.2 角色配置

| 角色 | 用途 | 默认模型 |
|------|------|---------|
| chat | 主对话 | mimo-v2.5 |
| router | 意图路由 | mimo-v2-flash |
| pageindex | 索引摘要 | mimo-v2.5 |
| proposition | 命题卡片 | mimo-v2.5 |
| embedding | 向量化 | BAAI/bge-m3 |
| reranker | 重排 | - |
| tts | 语音 | mimo-v2.5-tts |
| imagegen | 图片生成 | - |

### 4.3 设置文件

**核心文件**：`src/config/settings.ts`

**配置项**：
- API 密钥和端点
- 索引参数（每节点页数/Token 数）
- 阅读模式设置
- 微信读书配置
- 日志开关

---

## 5. Skill 系统

### 5.1 概述

Skill 是带有 frontmatter 的 Markdown 文件，存放在 Vault 的 `DeepReader/skills/`。

### 5.2 内置 Skills

**文件**：`src/built-in-skills.ts`

**内置 Skill**：
1. `reading-methodology.md` — 分层阅读方法论
2. `knowledge-cards.md` — 知识卡片生成
3. 其他...

### 5.3 Skill 加载

- 插件启动时同步到 Vault
- 在 System Prompt 中作为 XML Summary 注入

---

## 6. 数据存储

### 6.1 目录结构

| 目录 | 用途 |
|------|------|
| `.pageindex/` | 索引数据 |
| `DeepReader/` | 导出书籍、封面 |
| `DeepReader/skills/` | 内置 Skill 文件 |
| `书籍摘录/` | 用户摘录 |

### 6.2 索引文件

```
.pageindex/{bookId}/
├── book-meta.json      # 元数据
├── tree.json           # 章节树
├── bm25.json           # BM25 索引
├── vectors.jsonl       # 向量
├── propositions/       # 命题卡片
└── reading-progress.json # 阅读进度
```

---

## 7. 使用流程

### 7.1 首次配置

1. 安装插件
2. 在设置中配置 LLM API Key
3. 选择模型服务商和角色模型
4. 完成首次配置向导

### 7.2 索引书籍

**方式 1：书库界面**
1. 打开侧边栏 → 书库
2. 点击 "+" 添加 PDF/EPUB
3. 等待索引完成

**方式 2：直接索引**
1. 在 Obsidian 中打开 PDF
2. 点击工具栏 "索引" 按钮

### 7.3 搜索与对话

1. 选择一本书
2. 在对话框输入问题
3. AI 自动检索相关内容
4. 点击引用跳转到原文

### 7.4 阅读与摘录

1. 打开阅读模式
2. 选择文字触发工具栏
3. 高亮/摘录/保存笔记

---

## 8. 扩展功能

### 8.1 标签系统（规划中）

**数据模型**：
- 标签定义：`tags.json`
- 书籍标签：`book-meta.json.tags`

**功能**：
- 用户自定义标签
- 多维过滤（标签/类型/状态）
- 标签管理（重命名/合并/删除）

详见 [SPEC: 书库标签系统](../../SPEC.md)

### 8.2 记忆系统

**文件**：`src/agent/memory/`

**功能**：
- 短期记忆：对话历史
- 长期记忆：重要信息持久化
- 记忆整合：自动归纳总结

### 8.3 追踪系统

**支持**：
- LangSmith 追踪
- Langfuse 追踪

---

## 9. 目录结构总览

```
src/
├── main.ts                      # 插件入口
├── views/                       # UI 视图
│   ├── sidebar-view.ts
│   ├── sidebar/
│   └── library-view.ts
├── components/                   # UI 组件
│   ├── chat-input/
│   ├── message/
│   ├── reading-mode/
│   └── ...
├── agent/                       # AI Agent 系统
│   ├── index.ts                 # FrontendAgent
│   ├── graph/                   # LangGraph 认知引擎
│   │   ├── nodes/               # 节点实现
│   │   ├── prompts/             # System Prompt
│   │   └── state.ts             # 状态定义
│   ├── tools/                   # 工具集
│   │   ├── local/              # 本地搜索
│   │   └── definitions/         # 工具定义
│   ├── router/                  # 意图路由
│   ├── memory/                  # 记忆系统
│   └── models/                  # ChatModel 封装
├── pageindex/                   # PageIndex 引擎
│   ├── pageindex.ts
│   ├── book-indexer.ts
│   ├── book-search-v2.ts
│   ├── parsers/                # 文档解析
│   ├── exporters/              # 导出
│   └── vault/                  # 向量存储
├── services/                    # 业务服务
├── config/                      # 配置
├── settings/                    # 设置面板
├── weread/                      # 微信读书集成
└── built-in-skills.ts           # 内置 Skills
```

---

## 10. 关键技术决策

### 10.1 纯前端架构

- 不依赖后端服务器
- 所有数据存储在 Obsidian Vault
- 离线可用（仅需 LLM API）

### 10.2 内容哈希 Book ID

- 使用文件内容（前 64KB + 大小）生成哈希
- 文件移动/重命名后 ID 不变
- 支持索引迁移

### 10.3 认知引擎设计

- 基于《如何阅读一本书》的四层次模型
- S0 Fast 模型做路由，减少 token 消耗
- ReAct 循环支持深度分析

### 10.4 混合搜索

- BM25：精确关键词匹配
- 向量：语义相似度
- RRF 融合：结合两种方式优势

---

## 附录

### A. 构建与部署

```bash
npm install
npm run dev      # 开发模式
npm run build    # 完整构建
npm run deploy   # 部署到测试 Vault
```

### B. 调试

```javascript
// 在 Obsidian Console 中
app.plugins.plugins['deepreader']  // 插件实例
```

### C. 相关文档

- [agent-overview.md](architecture/agent-overview.md) — Agent 全景图
- [agent-state-machine/](architecture/agent-state-machine/) — L0-L8 分层架构文档
- [features/README.md](features/README.md) — 功能特征索引
