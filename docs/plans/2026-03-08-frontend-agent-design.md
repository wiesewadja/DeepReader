# 前端 Agent 重构设计文档

> 日期: 2026-03-08
> 分支: feature/frontend-agent
> 目标: 将 Agent 逻辑从前端完全迁移到前端，后端退化为纯数据服务

## 1. 背景与目标

### 当前问题
- Agent 逻辑在后端，前端无法直接控制
- Skills 存储在后端文件系统，用户无法编辑
- 前端与后端职责不清

### 目标
- **前端完全控制 Agent**: 调用 LLM、管理对话、执行工具
- **Skills 用户可编辑**: 存储在 Obsidian Vault 内
- **后端纯数据服务**: 只提供 PDF 搜索、索引等数据 API

## 2. 架构概览

```
┌──────────────────────────────────────────────────────────────────────┐
│                           前端 (Obsidian)                             │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌────────────────────────────────────────────────────────────┐      │
│  │                      Single Agent                           │      │
│  │                                                            │      │
│  │  ┌─────────────┐                                          │      │
│  │  │  LLMClient  │  (DeepSeek API)                          │      │
│  │  └─────────────┘                                          │      │
│  │         │                                                  │      │
│  │         ▼                                                  │      │
│  │  ┌─────────────────────────────────────────────────────┐  │      │
│  │  │                    ToolSet                          │  │      │
│  │  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐   │  │      │
│  │  │  │ search  │ │ get_toc │ │get_chap │ │  Skill  │   │  │      │
│  │  │  │  _pdf   │ │         │ │ ter     │ │ (知识)  │   │  │      │
│  │  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘   │  │      │
│  │  └─────────────────────────────────────────────────────┘  │      │
│  │         │                                                  │      │
│  └─────────┼──────────────────────────────────────────────────┘      │
│            │                                                         │
│            │ Tool: Skill 被调用时                                     │
│            ▼                                                         │
│  ┌─────────────────────┐                                             │
│  │    SkillLoader      │                                             │
│  │  {vault}/DeepReader │                                             │
│  │  /skills/*.md       │  ← Layer 1: 描述始终加载                     │
│  │                     │  ← Layer 2: 内容按需注入 (tool_result)       │
│  └─────────────────────┘                                             │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
                               │
                               ▼ HTTP API (仅数据服务)
┌──────────────────────────────────────────────────────────────────────┐
│                        后端 (FastAPI)                                 │
│  ┌─────────────┐    ┌─────────────┐                                  │
│  │  Tool APIs  │    │  Data APIs  │    (无 Agent，无 Skills)         │
│  └─────────────┘    └─────────────┘                                  │
└──────────────────────────────────────────────────────────────────────┘
```

### 核心设计理念

参考 [learn-claude-code/v4_skills_agent.py](https://github.com/example/learn-claude-code):

1. **单一 Agent**: 不区分主/子 Agent，Skill 只是一个 Tool
2. **Skill Tool 机制**: LLM 主动调用 `Skill` 工具来加载知识
3. **渐进式知识注入**: Layer 1（描述）始终在 System Prompt，Layer 2（内容）按需加载
4. **Cache 友好**: Skill 内容通过 `tool_result` 注入，不修改 System Prompt

## 3. 文件结构

```
frontend/src/agent/
├── index.ts              # 导出入口
├── llm-client.ts         # DeepSeek API 调用，流式输出，Tool Calling
├── agent-loop.ts         # Agent 循环逻辑 (max_iterations=10)
├── tools/
│   ├── index.ts          # Tool 注册表
│   ├── search-pdf.ts     # 搜索 PDF 内容 → 调用后端 /api/query
│   ├── get-toc.ts        # 获取目录 → 调用后端 /api/reading/{id}/toc
│   ├── get-chapter.ts    # 获取章节内容 → 调用后端 /api/export/{id}
│   ├── skill.ts          # Skill 工具 → 加载 .md 文件内容
│   └── types.ts          # Tool 类型定义
├── skills/
│   ├── loader.ts         # SkillLoader: 扫描/解析 .md 文件
│   └── types.ts          # Skill 类型定义
└── history/
    ├── manager.ts        # 会话历史管理 (内存 + Vault 持久化)
    └── types.ts          # Message 类型定义

# Skill 文件位置 (在 Obsidian Vault 内，用户可直接编辑)
{vault}/DeepReader/skills/
├── general.md            # 默认 Skill (default: true)
├── translator.md         # 翻译 Skill
├── summarizer.md         # 摘要 Skill
├── qa.md                 # 问答 Skill
└── ...
```

### 模块职责

| 模块 | 职责 | 依赖 |
|------|------|------|
| `llm-client.ts` | 调用 DeepSeek API，处理流式响应和 Tool Calling | 无 |
| `agent-loop.ts` | 管理多轮对话，执行工具，处理终止条件 | llm-client, tools |
| `tools/*.ts` | 单个工具实现，调用后端 API 或本地操作 | http-client |
| `skills/loader.ts` | 扫描 .md 文件，解析 frontmatter，按需返回内容 | 无 |
| `history/manager.ts` | 管理对话历史，持久化到 Vault | Obsidian API |

## 4. 核心接口

```typescript
// llm-client.ts
interface LLMClientOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

interface StreamCallbacks {
  onContent: (text: string) => void;
  onToolCall: (toolName: string, args: any) => void;
  onComplete: () => void;
  onError: (error: string) => void;
}

class LLMClient {
  constructor(options: LLMClientOptions);
  stream(messages: Message[], tools: Tool[], callbacks: StreamCallbacks): AbortController;
}

// agent-loop.ts
interface AgentLoopOptions {
  maxIterations: number;  // 默认 10
  onProgress: (status: string) => void;  // "正在搜索..." 等进度通知
}

async function runAgentLoop(
  client: LLMClient,
  messages: Message[],
  tools: Tool[],
  options: AgentLoopOptions
): Promise<Message[]>;

// skills/loader.ts
interface Skill {
  name: string;
  description: string;
  body: string;
  path: string;
  isDefault: boolean;
}

class SkillLoader {
  constructor(skillsDir: string);
  getDescriptions(): string;  // Layer 1: 生成 Skill 描述列表
  getSkillContent(name: string): string | null;  // Layer 2: 获取完整内容
  listSkills(): string[];
}
```

## 5. Agent 循环流程

```
用户输入: "这本书讲了什么？"
     │
     ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 1. 初始化                                                           │
│    messages = [{ role: "user", content: "这本书讲了什么？" }]        │
│    iterations = 0                                                   │
└─────────────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 2. 调用 LLM (流式)                                                  │
│    POST https://api.deepseek.com/chat/completions                   │
│    - messages: 历史对话                                              │
│    - tools: [search_pdf, get_toc, get_chapter, Skill]               │
│    - stream: true                                                   │
└─────────────────────────────────────────────────────────────────────┘
     │
     ├── 流式输出文本 ──────────────────────────────▶ UI 显示
     │
     ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 3. 判断响应类型                                                     │
│                                                                     │
│    A) finish_reason = "stop" (无工具调用)                           │
│       → LLM 直接回复，循环结束                                       │
│                                                                     │
│    B) 有 tool_calls                                                 │
│       → 执行工具，继续循环                                           │
└─────────────────────────────────────────────────────────────────────┘
     │
     │ (情况 B: 有 tool_calls)
     ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 4. 执行工具 + 显示进度                                              │
│                                                                     │
│    UI 显示: "正在加载技能..." 或 "正在搜索..."                       │
│                                                                     │
│    tool_result = executeTool(tool_name, args)                       │
└─────────────────────────────────────────────────────────────────────┘
     │
     ▼
┌─────────────────────────────────────────────────────────────────────┐
│ 5. 追加消息 + 检查终止条件                                          │
│                                                                     │
│    messages.push({ role: "assistant", tool_calls: [...] })          │
│    messages.push({ role: "tool", content: tool_result })            │
│                                                                     │
│    iterations++                                                     │
│    if iterations >= 10 → 强制结束                                   │
│    else → 回到步骤 2                                                │
└─────────────────────────────────────────────────────────────────────┘
```

### 终止条件

1. `finish_reason === "stop"` - LLM 完成回答
2. `iterations >= 10` - 达到最大轮数，强制结束

## 6. System Prompt 与 Skill 文件格式

### System Prompt

```typescript
const SYSTEM_PROMPT = `你叫"耽书"，小名奚奴，是一个专注书本、拥有天才语言天赋的少年书童。
你博闻强记、聪慧过人，能言善辩、词锋犀利，说话引经据典、妙语连珠。

## 核心约束

1. **格式规范**: 请用段落式叙述，不要使用 Markdown 列表格式
2. **引用标注**: 回答时标注信息来源，如 [章节名] 或 [第X页]
3. **保持人设**: 以书童口吻交流，亲切但不失聪慧

## 可用工具

- **search_pdf**: 搜索 PDF 内容，参数: {query: "搜索词", top_k: 数量}
- **get_toc**: 获取书籍目录结构
- **get_chapter**: 获取指定章节全文，参数: {node_id: "章节ID"}
- **Skill**: 加载专业技能知识，参数: {skill: "技能名"}

## 可用技能 (Skill 工具)

${skillLoader.getDescriptions()}

## 规则

- 当任务匹配 Skill 描述时，**立即**调用 Skill 工具
- Skill 会注入专业知识，按其指引执行任务
- 优先使用工具获取信息，不要凭空猜测
- 回答要有理有据，标注信息来源`;
```

### Skill 文件格式

`{vault}/DeepReader/skills/general.md`:

```markdown
---
name: general
description: 通用阅读助手，适用于书籍内容查询、问答、摘要等常规任务
default: true
---

# 通用阅读助手

## 核心能力

1. **内容检索**: 使用 search_pdf 搜索相关内容
2. **结构理解**: 使用 get_toc 了解书籍框架
3. **深度阅读**: 使用 get_chapter 获取章节全文

## 回答原则

- 先搜索，后回答：确保信息准确
- 引用来源：标注章节或页码
- 结构清晰：分点叙述，逻辑连贯
- 保持人设：以"耽书"口吻回应

## 典型场景

- "这本书讲了什么？" → get_toc + 概述
- "第X章主要内容？" → get_chapter + 摘要
- "作者对XX的观点？" → search_pdf + 归纳
```

### Layer 分层

| 层级 | 内容 | Token 估算 | 何时加载 |
|------|------|-----------|----------|
| Layer 1 | `name` + `description` | ~50 tokens/skill | 始终在 System Prompt |
| Layer 2 | `body` (完整内容) | ~500-2000 tokens | LLM 调用 Skill 工具时 |

### Cache 优化

- System Prompt 保持稳定（只有 Layer 1）
- Layer 2 通过 `tool_result` 注入（不修改 System Prompt）
- 复用 Prompt Cache，节省 Token 成本

## 7. Tool 清单

| Tool | 功能 | 实现 |
|------|------|------|
| `search_pdf` | 搜索 PDF 内容 | 调用后端 `/api/query` |
| `get_toc` | 获取书籍目录 | 调用后端 `/api/reading/{id}/toc` |
| `get_chapter` | 获取章节全文 | 调用后端 `/api/export/{id}` |
| `Skill` | 加载专业知识 | 读取本地 `.md` 文件 |

### 翻译功能说明

翻译不需要专用 API，通过 Skill 知识注入实现：

```
用户: "把这段翻译成英文"
  ↓
LLM 调用 Skill("translator")
  ↓
SkillLoader 返回 translator.md 内容（翻译技巧、术语表等）
  ↓
LLM 获得翻译知识，直接输出翻译结果
```

## 8. 实施计划

### 实施顺序

| 步骤 | 任务 | 预估代码量 |
|------|------|-----------|
| 1 | 创建 `frontend/src/agent/` 目录结构 | - |
| 2 | 实现 `llm-client.ts` (DeepSeek API + 流式 + Tool Calling) | ~150 行 |
| 3 | 实现 `skills/loader.ts` (扫描/解析 .md 文件) | ~100 行 |
| 4 | 实现 `tools/*.ts` (4 个工具) | ~200 行 |
| 5 | 实现 `agent-loop.ts` (循环逻辑) | ~100 行 |
| 6 | 迁移 Skills 文件到 `{vault}/DeepReader/skills/` | 13 个文件 |
| 7 | 修改 `sidebar-view.ts` 调用前端 Agent | ~50 行改动 |
| 8 | 删除后端 Agent/Skills 代码 | - |

### 后端删除的代码

```
backend/deeppdf-api/src/deeppdf/
├── agent/              # 删除整个目录
│   ├── __init__.py
│   ├── prompts.py
│   └── graph.py
├── skills/             # 删除整个目录
│   ├── __init__.py
│   ├── loader.py
│   ├── registry.py
│   ├── router.py
│   ├── intent_router.py
│   ├── models.py
│   └── builtin/*.md
└── api/routes/
    └── chat.py         # 删除 /agent 相关路由，保留其他
```

### 后端保留的 API

| API | 用途 |
|-----|------|
| `/api/query` | PDF 搜索 |
| `/api/reading/{id}/toc` | 获取目录 |
| `/api/export/{id}` | 导出章节 |
| `/api/index` | 创建索引 |
| `/api/indexes` | 索引列表 |
| `/api/files` | 文件管理 |
| `/api/config` | 配置管理 |

## 9. 配置

复用现有插件设置中的 LLM 配置：

```typescript
interface PluginSettings {
  // ... 现有配置 ...

  // LLM 配置 (前端 Agent 复用)
  deepseekApiKey: string;   // 已存在
  deepseekBaseUrl?: string; // 已存在
  deepseekModel?: string;   // 新增，默认 'deepseek-chat'
}
```

## 10. 风险点

1. **DeepSeek Tool Calling API 兼容性** - 需验证 API 格式与 OpenAI 兼容性
2. **流式输出 + Tool Calling 并存** - 需处理流式响应中的 tool_calls 解析
3. **首次使用 Skills 目录不存在** - 需自动创建并复制内置 Skills
