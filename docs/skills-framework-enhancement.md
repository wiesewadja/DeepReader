# Skills 框架增强技术方案

> 文档版本：v1.0
> 创建日期：2026-03-09
> 状态：技术设计（待开发）

---

## 一、背景与目标

### 1.1 背景

DeepReader 的 Skills 系统为 Agent 提供了场景化的专业能力支持。当前已创建 3 个知识图谱相关的 Skills：

| Skill | 功能 |
|-------|------|
| `knowledge-graph` | 知识图谱构建 - 概念提取 + 关系抽取 |
| `knowledge-cards` | 知识卡片生成 - 5种卡片模板 |
| `cross-book-links` | 跨书关联发现 - 概念对比 + 知识整合 |

### 1.2 问题

当前 Skills 存在以下不足：

1. **缺少工具指导**：Skill 描述了任务流程，但 Agent 不知道用什么工具执行
2. **数据来源混乱**：工具多了之后，Agent 不知道从后端获取数据还是从 Obsidian 获取
3. **无法保存结果**：生成的知识卡片无法自动保存到 Obsidian

### 1.3 核心问题：数据来源混乱

**问题根源**：当工具同时支持从"后端书籍"和"Obsidian 笔记"读取数据时，Agent 需要做选择，这增加了复杂度。

**知识图谱任务的数据流**：

```
书籍（后端）  ──提取知识──>  分析处理  ──保存──>  Obsidian（笔记）
     ↑                                        ↑
   读取                                     写入
```

- **输入源**：书籍（后端 ChromaDB）
- **输出目标**：笔记（Obsidian vault）

**结论**：
- **读取**：只需要从书籍读取，不需要从 Obsidian 读取
- **写入**：直接写入 Obsidian，不存在歧义

### 1.4 目标

增强 Skills 框架，使其具备：

1. **工具导航**：明确告知 Agent 可用的工具及其使用方式
2. **数据流清晰**：读取固定来自书籍，写入固定到 Obsidian
3. **完整工作流**：从 PDF 知识提取 → 生成 → 保存的闭环

---

## 二、现有系统分析

### 2.1 Skills 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Skills 系统架构                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  frontend/assets/skills/      DeepReader/skills/           │
│  (插件内置默认 Skills)         (用户自定义 Skills)          │
│        │                              │                    │
│        │ 首次加载时复制                │                    │
│        └──────────┬───────────────────┘                    │
│                   ▼                                          │
│          SkillLoader 扫描                                   │
│          (loader.ts)                                        │
│                   │                                          │
│                   ▼                                          │
│          解析 .md 文件                                       │
│          - YAML frontmatter                                 │
│          - body 内容                                        │
│                   │                                          │
│                   ▼                                          │
│          FrontendAgent 使用                                  │
│          - buildSystemPrompt()                              │
│          - Skill 工具调用                                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 现有工具

| 工具 | 功能 | 适用范围 |
|------|------|----------|
| `get_toc` | 获取书籍目录结构 | 当前 PDF |
| `search_doc` | 搜索 PDF 内容 | 当前 PDF |
| `get_chapter` | 获取章节全文 | 当前 PDF |
| `Skill` | 加载 Skill | 系统级 |

### 2.3 ToolContext

```typescript
interface ToolContext {
  indexId: string;           // 当前 PDF 索引 ID
  pdfName: string;           // PDF 文件名
  markdownFiles?: Record<string, string>;  // node_id → Markdown 文件映射
  useLLMTreeSearch?: boolean;  // 是否使用深度搜索
}
```

---

## 三、技术方案

### 3.1 设计原则：数据流单向清晰

**核心原则**：
- **读取**：固定从书籍（后端）获取，不从 Obsidian 读取
- **写入**：固定写入 Obsidian，不存在歧义

**工具简化**：

| 工具 | 数据方向 | 数据源 | 说明 |
|------|----------|--------|------|
| `get_toc` | 读取 | 书籍（后端） | 获取书籍目录结构 |
| `search_doc` | 读取 | 书籍（后端） | 搜索书籍内容 |
| `get_chapter` | 读取 | 书籍（后端） | 获取书籍章节全文 |
| `write_note` | 写入 | Obsidian | 保存知识卡片 |

**不需要的工具**（根据数据流分析）：
- `read_note`：知识图谱任务不需要从笔记读取
- `list_notes`：知识图谱任务不需要列出已有笔记
- `search_notes`：知识图谱任务不需要搜索笔记

### 3.2 扩展 ToolContext

新增 `vaultPath` 字段，用于写入笔记时定位 vault：

```typescript
interface ToolContext {
  indexId: string;
  pdfName: string;
  markdownFiles?: Record<string, string>;
  useLLMTreeSearch?: boolean;
  vaultPath: string;  // 新增：vault 根目录路径
}
```

### 3.3 新增工具：write_note

唯一需要新增的工具，用于将生成的知识卡片保存到 Obsidian：

```typescript
const WRITE_NOTE_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'write_note',
    description: 'Create or update an Obsidian note. Use this to save generated knowledge cards.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path for the note (e.g., "知识卡/概念-神经网络.md")'
        },
        content: {
          type: 'string',
          description: 'Note content in Markdown format'
        },
        mode: {
          type: 'string',
          enum: ['create', 'overwrite', 'append'],
          description: 'Write mode: create (create new), overwrite (replace), append (add to end)'
        }
      },
      required: ['path', 'content']
    }
  }
};
```

**执行逻辑**：
1. 拼接 vaultPath + path 得到绝对路径
2. 确保目标目录存在（如不存在则创建）
3. 检查文件是否已存在（根据 mode 处理）
4. 使用 `app.vault.create()` 或 `app.vault.modify()` 写入
5. 返回成功/失败信息

### 3.4 新增工具：create_sub_agent（子 Agent 创建）

用于处理复杂任务时拆分给子 Agent：

```typescript
const CREATE_SUB_AGENT_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'create_sub_agent',
    description: `Create a sub-agent to handle a subtask. Use this when:
- The task involves multiple chapters
- Context might overflow
- Parallel processing is needed

The sub-agent will execute independently and return results to the main agent.`,
    parameters: {
      type: 'object',
      properties: {
        task_description: {
          type: 'string',
          description: 'Description of the subtask'
        },
        task_context: {
          type: 'string',
          description: 'Context information needed for the subtask (e.g., book structure, previous results)'
        },
        expected_output: {
          type: 'string',
          description: 'Expected output format'
        }
      },
      required: ['task_description']
    }
  }
};
```

**执行逻辑**：
1. 解析任务描述和上下文
2. 创建新的 FrontendAgent 实例（子 Agent）
3. 构建子任务消息
4. 执行子任务（调用 search_doc、get_chapter 等）
5. 格式化并返回子任务结果
6. 主 Agent 接收结果并继续处理

**子 Agent 与主 Agent 的区别**：
- 子 Agent 有独立的工具列表（可限制）
- 子 Agent 有独立的消息历史
- 子 Agent 完成后结果合并到主流程

### 3.5 工具注册

修改 `createToolRegistry` 函数：

```typescript
export function createToolRegistry(
  skillLoader: SkillLoader,
  context: ToolContext
): ToolRegistry {
  const registry: ToolRegistry = new Map();

  // 读取工具（书籍）
  registry.set('get_toc', getTocTool);
  registry.set('search_doc', searchDocTool);
  registry.set('get_chapter', getChapterTool);

  // 写入工具（Obsidian）
  registry.set('write_note', createWriteNoteTool(context));

  // 子 Agent 工具
  registry.set('create_sub_agent', createSubAgentTool(context));

  // Skill 工具
  const skillTool = createSkillTool(skillLoader);
  registry.set('Skill', skillTool);

  return registry;
}
```

### 3.4 工具注册

修改 `createToolRegistry` 函数：

```typescript
export function createToolRegistry(
  skillLoader: SkillLoader,
  context: ToolContext
): ToolRegistry {
  const registry: ToolRegistry = new Map();

  // 读取工具（书籍）
  registry.set('get_toc', getTocTool);
  registry.set('search_doc', searchDocTool);
  registry.set('get_chapter', getChapterTool);

  // 写入工具（Obsidian）
  registry.set('write_note', createWriteNoteTool(context));

  // Skill 工具
  const skillTool = createSkillTool(skillLoader);
  registry.set('Skill', skillTool);

  return registry;
}
```

### 3.6 工具对比

| 工具 | 功能 | 数据来源 | 适用场景 |
|------|------|----------|----------|
| `get_toc` | 获取目录结构 | 书籍（后端） | 了解书籍整体结构 |
| `search_doc` | 语义搜索 | 书籍（后端） | 快速定位概念/关键词 |
| `get_chapter` | 获取章节全文 | 书籍（后端） | 深度阅读特定章节 |
| `write_note` | 写入笔记 | Obsidian | 保存生成的知识卡片 |
| `create_sub_agent` | 创建子 Agent | 系统 | 复杂任务拆分处理 |

### 3.7 子 Agent 触发机制

**触发方式**：LLM 自主决策，通过调用 `create_sub_agent` 工具

**触发时机**（由 LLM 判断）：
- 任务涉及多个章节
- 上下文可能溢出
- 需要并行处理多个子任务

**执行流程**：

```
主 Agent 推理：
  1. get_toc → 了解书籍结构（10 章）
  2. 思考：内容很多，需要拆分
  3. create_sub_agent({
      task_description: "提取前 3 章的概念",
      task_context: "书籍目录...",
      expected_output: "概念列表"
    })

工具执行：
  → 创建子 Agent 实例
  → 子 Agent 执行 search_doc + get_chapter
  → 子 Agent 返回结果

主 Agent 接收：
  → 继续处理后续章节
  → 汇总所有结果
  → write_note 保存
```

### 3.8 决策流程

```
任务：构建知识图谱
  │
  ├─ 需要了解书籍结构？→ get_toc
  │
  ├─ 需要搜索概念？→ search_doc
  │
  ├─ 需要深度阅读章节？→ get_chapter
  │
  └─ 需要保存结果？→ write_note（写入 Obsidian）
```

---

## 四、Skills 更新方案

### 4.1 knowledge-graph 更新

在现有 Skill 中添加「工具箱」章节：

```markdown
## 工具箱（必须使用）

### PDF 工具
- get_toc: 获取目录结构
- search_doc: 搜索 PDF 内容
- get_chapter: 获取章节全文

### Obsidian 工具
- read_note: 读取已有知识卡片
  - 参数：path（笔记路径）
- write_note: 保存生成的知识卡片
  - 参数：path（保存路径）, content（内容）
- list_notes: 列出已有知识卡片
  - 参数：folder（文件夹路径）

## 执行流程

### 阶段1：检查现有知识
1. list_notes("知识卡") → 查看已有哪些知识卡片
2. read_note("知识卡/概念-XXX.md") → 读取特定卡片

### 阶段2：提取知识
3. get_toc → 了解书籍结构
4. search_doc → 搜索核心概念

### 阶段3：保存结果
5. write_note → 保存新生成的知识卡片
```

### 4.2 knowledge-cards 更新

类似更新，添加 Obsidian 工具使用说明。

### 4.3 cross-book-links 更新

添加跨书籍搜索的替代方案说明。

---

## 五、数据流设计

### 5.1 知识图谱构建流程

```
用户输入
    │
    ▼
┌─────────────────┐
│  加载 Skill     │ ◄── knowledge-graph
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  检查现有知识   │ ◄── list_notes + read_note
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  获取书籍结构   │ ◄── get_toc
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  搜索概念       │ ◄── search_doc (多次)
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  生成知识卡片   │ ◄── LLM 处理
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  保存到 Obsidian│ ◄── write_note
└────────┬────────┘
         │
         ▼
    返回结果
```

### 5.2 文件存储结构

```
DeepReader/
├── skills/                    # Skills 目录
├── 知识卡/                    # 知识卡片目录
│   ├── 概念/
│   │   ├── 神经网络.md
│   │   ├── 深度学习.md
│   │   └── ...
│   ├── 金句/
│   ├── 问题/
│   ├── 方法/
│   └── 总结/
└── 笔记.md                   # 阅读笔记
```

---

## 六、错误处理

### 6.1 工具错误类型

| 错误类型 | 原因 | 处理方式 |
|----------|------|----------|
| 文件不存在 | path 错误 | 返回友好提示，建议使用 list_notes |
| 目录不存在 | 目标文件夹未创建 | 自动创建目录 |
| 权限错误 | vault 权限问题 | 返回错误信息 |
| 内容过长 | 笔记内容过大 | 分片处理或截断 |

### 6.2 错误响应格式

```json
{
  "success": false,
  "error": "File not found: 知识卡/概念-test.md",
  "suggestion": "Use list_notes to see available notes"
}
```

---

## 七、实施计划

### 7.1 第一阶段：基础设施（0.5天）

- [ ] 扩展 ToolContext，添加 vaultPath
- [ ] 在 SidebarView 中传递 vaultPath 到 ToolContext

### 7.2 第二阶段：工具实现（1.5天）

- [ ] 实现 write_note 工具
- [ ] 实现 create_sub_agent 工具
- [ ] 注册到 ToolRegistry
- [ ] 更新 System Prompt 添加工具描述

### 7.3 第三阶段：集成测试（0.5天）

- [ ] 端到端测试：主 Agent → 子 Agent → 保存结果

### 7.4 第四阶段：Skills 更新（0.5天）

- [ ] 更新 knowledge-graph Skill（添加工具箱说明 + 子 Agent 提示）
- [ ] 更新 knowledge-cards Skill
- [ ] 更新 cross-book-links Skill

### 7.5 工具列表

| 工具 | 数据方向 | 说明 |
|------|----------|------|
| get_toc | 读取（书籍） | 获取书籍目录结构 |
| search_doc | 读取（书籍） | 搜索书籍内容 |
| get_chapter | 读取（书籍） | 获取书籍章节全文 |
| write_note | 写入（Obsidian） | 保存知识卡片 |
| create_sub_agent | 系统 | 创建子 Agent 处理子任务 |
| Skill | 系统 | 加载 Skill |

---

## 八、兼容性

### 8.1 向后兼容

- 新工具不影响现有工具的使用
- 现有 Skills 无需修改即可使用（但建议更新以获得更好体验）

### 8.2 依赖项

- Obsidian API（通过插件上下文访问）
- Node.js fs 模块（用于路径处理）

---

## 九、附录

### A. 工具参数速查表

| 工具 | 数据方向 | 参数 | 返回 |
|------|----------|------|------|
| get_toc | 读取（书籍） | - | 书籍目录树 |
| search_doc | 读取（书籍） | query, top_k | 搜索结果列表 |
| get_chapter | 读取（书籍） | node_id | 章节内容 |
| write_note | 写入（Obsidian） | path, content, mode | 写入结果 |
| create_sub_agent | 系统 | task_description, task_context, expected_output | 子任务结果 |

### B. 路径规范

- 所有路径相对于 vault 根目录
- 使用正斜杠 `/` 分隔目录
- 示例：`知识卡/概念/神经网络.md`

### C. 数据流与 Agent 架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         完整数据流与 Agent 架构                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   主 Agent                                                             │
│   ┌─────────────────────────────────────────────────────────────┐     │
│   │ 1. get_toc → 了解书籍结构                                      │     │
│   │ 2. 判断是否需要拆分                                            │     │
│   │    ↓ (需要时)                                                  │     │
│   │ 3. create_sub_agent → 创建子 Agent                             │     │
│   └─────────────────────────────────────────────────────────────┘     │
│                              │                                         │
│                              │ 创建子 Agent                            │
│                              ▼                                         │
│   ┌─────────────────────────────────────────────────────────────┐     │
│   │                    子 Agent                                  │     │
│   │  - search_doc → 搜索概念                                      │     │
│   │  - get_chapter → 获取章节                                     │     │
│   │  - 提取概念和关系                                             │     │
│   │  - 返回结果                                                   │     │
│   └─────────────────────────────────────────────────────────────┘     │
│                              │                                         │
│                              │ 返回结果                                 │
│                              ▼                                         │
│   ┌─────────────────────────────────────────────────────────────┐     │
│   │ 4. 汇总所有子 Agent 结果                                      │     │
│   │ 5. write_note → 保存到 Obsidian                              │     │
│   └─────────────────────────────────────────────────────────────┘     │
│                                                                         │
│   数据来源：                                                           │
│   - 读取：书籍（后端 ChromaDB）← get_toc, search_doc, get_chapter      │
│   - 写入：Obsidian（Vault）← write_note                                │
│   - 调度：系统 ← create_sub_agent                                      │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

**文档版本**：v1.2
**更新日期**：2026-03-09
**文档状态**：技术设计完成
**更新内容**：新增 create_sub_agent 工具 + 子 Agent 架构设计
**下一步**：开发实施