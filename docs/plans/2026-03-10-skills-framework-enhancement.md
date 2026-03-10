# Skills 框架增强实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 为 DeepReader Agent 新增 `write_note` 和 `create_sub_agent` 工具，实现知识卡片的保存和复杂任务的子任务拆分。

**Architecture:**
- 新增 `write_note` 工具：写入笔记到 Obsidian vault，支持 `aicreate` 权限控制
- 新增 `create_sub_agent` 工具：创建子 Agent 处理子任务，串行执行
- 改进 `get_chapter` 工具：智能路由（本地优先，fallback 后端）
- 更新 System Prompt：添加新工具描述

**Tech Stack:** TypeScript, Obsidian Plugin API

---

## Task 1: 扩展 ToolContext 类型

**Files:**
- Modify: `frontend/src/agent/tools/types.ts`

**Step 1: 添加 app 字段到 ToolContext**

```typescript
import type { App } from 'obsidian';

/**
 * Tool 执行上下文
 */
export interface ToolContext {
  indexId: string;
  pdfName: string;
  /** node_id 到 Markdown 文件路径的映射 */
  markdownFiles?: Record<string, string>;
  /** 是否使用 LLM 树搜索（深度思考模式） */
  useLLMTreeSearch?: boolean;
  /** Obsidian App 实例（用于 vault 操作） */
  app?: App;
}
```

**Step 2: 验证类型定义正确**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 构建成功，无类型错误

---

## Task 2: 实现 write_note 工具

**Files:**
- Create: `frontend/src/agent/tools/write-note.ts`

**Step 1: 创建 write_note 工具定义和执行器**

```typescript
/**
 * write_note Tool - 写入笔记到 Obsidian vault
 *
 * 行为规则：
 * 1. 新建文件：添加 aicreate frontmatter
 * 2. 覆盖/追加：检查 aicreate，有则允许，否则拒绝
 * 3. 目录不存在：自动创建
 */

import type { ToolDefinition } from '../types.js';
import type { ToolExecutor, ToolContext } from './types.js';
import { TFile, TFolder, normalizePath } from 'obsidian';
import { log, error as logError } from '../../utils/logger.js';

const WRITE_NOTE_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'write_note',
    description: 'Write a note to Obsidian vault. AI-created notes are marked with aicreate frontmatter and can only be modified by AI.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path for the note (e.g., "知识卡/概念/神经网络.md")',
        },
        content: {
          type: 'string',
          description: 'Note content in Markdown format',
        },
        mode: {
          type: 'string',
          enum: ['create', 'overwrite', 'append'],
          description: 'Write mode: create (new only), overwrite (replace), append (add to end). Default: create',
        },
      },
      required: ['path', 'content'],
    },
  },
};

/**
 * 生成带有 aicreate frontmatter 的内容
 */
function generateContentWithFrontmatter(
  content: string,
  mode: 'create' | 'overwrite' | 'append',
  existingContent?: string
): string {
  const now = new Date().toISOString();

  if (mode === 'create') {
    return `---
aicreate: true
created_at: ${now}
---

${content}`;
  }

  if (mode === 'overwrite') {
    return `---
aicreate: true
created_at: ${now}
updated_at: ${now}
---

${content}`;
  }

  // append: 直接追加，不修改 frontmatter
  return existingContent + '\n\n' + content;
}

/**
 * 检查文件是否有 aicreate frontmatter
 */
async function hasAicreateFrontmatter(app: any, file: TFile): Promise<boolean> {
  try {
    const content = await app.vault.read(file);
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) return false;

    const frontmatter = frontmatterMatch[1];
    return frontmatter.includes('aicreate: true');
  } catch {
    return false;
  }
}

/**
 * 确保目录存在
 */
async function ensureFolderExists(app: any, folderPath: string): Promise<void> {
  const normalizedPath = normalizePath(folderPath);
  const parts = normalizedPath.split('/');
  let currentPath = '';

  for (const part of parts) {
    currentPath = currentPath ? `${currentPath}/${part}` : part;
    const folder = app.vault.getAbstractFileByPath(currentPath);

    if (!folder) {
      await app.vault.createFolder(currentPath);
      log('[write_note] 创建目录:', currentPath);
    }
  }
}

export const writeNoteTool: ToolExecutor = {
  definition: WRITE_NOTE_DEFINITION,

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const path = args.path as string;
    const content = args.content as string;
    const mode = (args.mode as 'create' | 'overwrite' | 'append') || 'create';

    if (!path || !content) {
      return 'Error: path and content parameters are required';
    }

    const app = context.app;
    if (!app) {
      return 'Error: Obsidian app instance not available in context';
    }

    try {
      log('[write_note] 执行:', { path, mode, contentLength: content.length });

      const normalizedPath = normalizePath(path);
      const existingFile = app.vault.getAbstractFileByPath(normalizedPath);

      // 文件已存在
      if (existingFile instanceof TFile) {
        // 检查 aicreate 权限
        const hasPermission = await hasAicreateFrontmatter(app, existingFile);
        if (!hasPermission) {
          return `Error: Cannot modify "${path}" - file was not created by AI (no aicreate frontmatter)`;
        }

        if (mode === 'create') {
          return `Error: File "${path}" already exists. Use mode="overwrite" or mode="append" to modify.`;
        }

        const existingContent = await app.vault.read(existingFile);
        const newContent = generateContentWithFrontmatter(content, mode, existingContent);

        await app.vault.modify(existingFile, newContent);
        log('[write_note] 文件已更新:', normalizedPath);
        return `Note updated successfully: ${path}`;
      }

      // 文件不存在，创建新文件
      if (mode !== 'create' && mode !== 'overwrite') {
        return `Error: File "${path}" does not exist. Use mode="create" to create a new file.`;
      }

      // 确保目录存在
      const folderPath = normalizedPath.substring(0, normalizedPath.lastIndexOf('/'));
      if (folderPath) {
        await ensureFolderExists(app, folderPath);
      }

      const newContent = generateContentWithFrontmatter(content, 'create');
      await app.vault.create(normalizedPath, newContent);

      log('[write_note] 文件已创建:', normalizedPath);
      return `Note created successfully: ${path}`;
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      logError('[write_note] 写入失败:', errorMsg);
      return `Error writing note: ${errorMsg}`;
    }
  },
};
```

**Step 2: 验证构建成功**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 构建成功

---

## Task 3: 改进 get_chapter 工具（智能路由）

**Files:**
- Modify: `frontend/src/agent/tools/get-chapter.ts`

**Step 1: 添加本地优先读取逻辑**

修改 `execute` 函数，在调用后端之前先检查本地文件：

```typescript
async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
  const nodeId = args.node_id as string;

  if (!nodeId) {
    return 'Error: node_id parameter is required';
  }

  try {
    log('[get_chapter] 获取章节:', { nodeId, indexId: context.indexId });

    // 优先从本地读取
    if (context.markdownFiles && context.markdownFiles[nodeId] && context.app) {
      const localPath = context.markdownFiles[nodeId];
      log('[get_chapter] 尝试从本地读取:', localPath);

      try {
        const file = context.app.vault.getAbstractFileByPath(localPath);
        if (file instanceof TFile) {
          const content = await context.app.vault.read(file);
          log('[get_chapter] 本地读取成功:', localPath);
          return content;
        }
      } catch (localError) {
        log('[get_chapter] 本地读取失败，fallback 到后端:', localError);
      }
    }

    // Fallback: 从后端获取
    log('[get_chapter] 从后端获取章节');
    const exportData = await deeppdfClient.exportIndex(context.indexId);

    const node = exportData.nodes.find((n) => n.node_id === nodeId);

    if (!node) {
      const availableNodes = exportData.nodes
        .slice(0, 10)
        .map((n) => `- ${n.node_id}: ${n.node_name}`)
        .join('\n');
      const moreInfo = exportData.nodes.length > 10
        ? `\n... and ${exportData.nodes.length - 10} more nodes`
        : '';

      return `Chapter with node_id "${nodeId}" not found.\n\nAvailable nodes:\n${availableNodes}${moreInfo}`;
    }

    log('[get_chapter] 找到章节:', node.node_name);

    const header = `## ${node.node_name}
**Section:** ${node.section}
**Pages:** ${node.page_range}

---`;

    return `${header}\n\n${node.text}`;
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    logError('[get_chapter] 获取章节失败:', errorMsg);
    return `Error getting chapter content: ${errorMsg}`;
  }
}
```

**Step 2: 添加 TFile 导入**

在文件顶部添加：
```typescript
import { TFile } from 'obsidian';
```

**Step 3: 验证构建成功**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 构建成功

---

## Task 4: 实现 create_sub_agent 工具

**Files:**
- Create: `frontend/src/agent/tools/create-sub-agent.ts`

**Step 1: 创建 create_sub_agent 工具**

```typescript
/**
 * create_sub_agent Tool - 创建子 Agent 处理子任务
 *
 * 行为规则：
 * 1. 子 Agent 与主 Agent 串行执行（不允许多个子 Agent 并行）
 * 2. 子 Agent 通过 task_context 获取必要上下文
 * 3. 子 Agent 使用专属 log 标识
 * 4. 超时或取消时直接报错
 */

import type { ToolDefinition } from '../types.js';
import type { ToolExecutor, ToolContext } from './types.js';
import { LLMClient } from '../llm-client.js';
import { runAgentLoop } from '../agent-loop.js';
import { createToolRegistry, getToolDefinitions } from './index.js';
import { log, error as logError } from '../../utils/logger.js';

const CREATE_SUB_AGENT_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'create_sub_agent',
    description: `Create a sub-agent to handle a subtask. Use this when:
- The task involves multiple chapters
- Context might overflow
- Need focused processing on a specific part

The sub-agent executes independently and returns results to the main agent.`,
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'Clear description of the subtask',
        },
        context: {
          type: 'object',
          properties: {
            book_structure: {
              type: 'string',
              description: 'Book structure (TOC) information',
            },
            previous_results: {
              type: 'string',
              description: 'Results from previous steps',
            },
            focus_nodes: {
              type: 'array',
              items: { type: 'string' },
              description: 'Node IDs to focus on',
            },
            tool_context: {
              type: 'object',
              description: 'ToolContext info (indexId, pdfName, markdownFiles)',
            },
          },
        },
        output_format: {
          type: 'string',
          description: 'Expected output format (e.g., "概念列表，包含名称、定义、所在章节")',
        },
      },
      required: ['task'],
    },
  },
};

export const createSubAgentTool: ToolExecutor = {
  definition: CREATE_SUB_AGENT_DEFINITION,

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const task = args.task as string;
    const contextData = args.context as Record<string, unknown> | undefined;
    const outputFormat = args.output_format as string | undefined;

    if (!task) {
      return 'Error: task parameter is required';
    }

    try {
      log('[SubAgent] 创建子 Agent:', task);

      // 构建子 Agent 的 system prompt
      const subSystemPrompt = `你是一个专门处理子任务的 AI 助手。

## 任务
${task}

## 上下文
${contextData?.book_structure ? `书籍结构：\n${contextData.book_structure}` : ''}
${contextData?.previous_results ? `前置结果：\n${contextData.previous_results}` : ''}
${contextData?.focus_nodes ? `关注章节：${(contextData.focus_nodes as string[]).join(', ')}` : ''}

## 输出格式
${outputFormat || '根据任务要求自然输出'}

## 规则
- 专注完成指定任务
- 使用可用工具获取信息
- 完成后直接返回结果，不要多余的解释`;

      // 创建子 Agent 的 LLM 客户端（复用主 Agent 的配置）
      // 注意：这里需要从 context 或全局获取 API 配置
      // 暂时返回提示信息，实际实现需要获取 LLM 配置
      log('[SubAgent] 子 Agent 任务已定义，等待实际实现');
      log('[SubAgent] task:', task);
      log('[SubAgent] context:', JSON.stringify(contextData, null, 2));
      log('[SubAgent] output_format:', outputFormat);

      // TODO: 实际调用 runAgentLoop
      // 需要从外部传入 LLM 配置（apiKey, baseUrl, model 等）
      // 当前返回占位信息

      return `[SubAgent] 任务已接收：${task}

注意：create_sub_agent 工具需要 LLM 配置才能完整执行。
当前版本为占位实现，请在后续版本中完善。`;
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      logError('[SubAgent] 执行失败:', errorMsg);
      return `Error in sub-agent execution: ${errorMsg}`;
    }
  },
};
```

**Step 2: 验证构建成功**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 构建成功

---

## Task 5: 注册新工具到 ToolRegistry

**Files:**
- Modify: `frontend/src/agent/tools/index.ts`

**Step 1: 导入新工具**

在文件顶部添加导入：

```typescript
import { writeNoteTool } from './write-note.js';
import { createSubAgentTool } from './create-sub-agent.js';
```

**Step 2: 注册工具到 registry**

修改 `createToolRegistry` 函数：

```typescript
export function createToolRegistry(
  skillLoader: SkillLoader,
  context: ToolContext
): ToolRegistry {
  const registry: ToolRegistry = new Map();

  // 注册基础工具（读取）
  registry.set('search_doc', searchDocTool);
  registry.set('get_toc', getTocTool);
  registry.set('get_chapter', getChapterTool);

  // 注册写入工具
  registry.set('write_note', writeNoteTool);

  // 注册子 Agent 工具
  registry.set('create_sub_agent', createSubAgentTool);

  // 注册 Skill 工具（需要依赖注入）
  const skillTool = createSkillTool(skillLoader);
  registry.set('Skill', skillTool);

  log('[ToolRegistry] 已注册', registry.size, '个工具:', Array.from(registry.keys()));

  return registry;
}
```

**Step 3: 导出新工具**

在导出部分添加：

```typescript
export { writeNoteTool } from './write-note.js';
export { createSubAgentTool } from './create-sub-agent.js';
```

**Step 4: 验证构建成功**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 构建成功

---

## Task 6: 更新 System Prompt

**Files:**
- Modify: `frontend/src/agent/prompts.ts`

**Step 1: 更新工具描述**

修改 `TOOL_DESCRIPTIONS` 常量：

```typescript
const TOOL_DESCRIPTIONS = `## 可用工具

### 读取工具（从书籍获取信息）
- **search_doc**: 语义搜索文档内容，参数: {query: "搜索词", top_k: 数量}。返回结果包含 Link 字段，直接用作引用。
- **get_toc**: 获取书籍目录结构
- **get_chapter**: 获取指定章节全文，参数: {node_id: "章节ID"}。优先从本地读取，更快。

### 写入工具（保存到 Obsidian）
- **write_note**: 保存笔记到 Obsidian vault，参数: {path: "相对路径", content: "内容", mode: "create|overwrite|append"}
  - 只能创建或修改带有 aicreate frontmatter 的文件
  - 目录不存在时自动创建
  - 示例路径: "知识卡/概念/神经网络.md"

### 任务拆分工具
- **create_sub_agent**: 创建子 Agent 处理子任务，参数: {task: "任务描述", context: {...}, output_format: "期望格式"}
  - 用于处理涉及多章节的复杂任务
  - 子 Agent 串行执行，不可并行

### 技能加载
- **Skill**: 加载专业技能知识，参数: {skill: "技能名"}`;
```

**Step 2: 添加 AI 文档操作规则**

在 `CORE_CONSTRAINTS` 或新增常量中添加：

```typescript
const AI_DOCUMENT_RULES = `## AI 文档操作规则

- 使用 write_note 创建的文档会自动添加 aicreate: true 标记
- AI 只能修改带有 aicreate 标记的文档
- 用户手动创建的文档不会被 AI 覆盖`;
```

**Step 3: 更新 buildSystemPrompt 函数**

```typescript
export function buildSystemPrompt(skillLoader: SkillLoader): string {
  const skillDescriptions = skillLoader.getDescriptions();
  return `${PERSONA_BASE}

${CORE_CONSTRAINTS}

${TOOL_DESCRIPTIONS}

${AI_DOCUMENT_RULES}

## 可用技能 (Skill 工具)

${skillDescriptions}

${RULES}`;
}
```

**Step 4: 验证构建成功**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 构建成功

---

## Task 7: 传递 app 到 ToolContext

**Files:**
- Modify: `frontend/src/views/sidebar-view.ts`（或创建 ToolContext 的地方）

**Step 1: 找到创建 ToolContext 的位置**

搜索 `ToolContext` 的使用位置，确保在调用工具时传入 `app`。

**Step 2: 添加 app 到 context**

```typescript
const context: ToolContext = {
  indexId: ...,
  pdfName: ...,
  markdownFiles: ...,
  useLLMTreeSearch: ...,
  app: this.app,  // 添加这一行
};
```

**Step 3: 验证构建成功**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 构建成功

---

## Task 8: 集成测试

**Files:**
- 无需创建新文件

**Step 1: 启动后端服务**

Run: `cd /Users/lizhao/workspace/DeepReader/backend/deeppdf-api && uv run uvicorn deeppdf.main:app --port 6088 --reload --loop asyncio`

**Step 2: 在 Obsidian 中测试**

1. 重新加载插件（Cmd+R）
2. 打开 Agent 对话
3. 测试 write_note：
   - 发送：「帮我创建一个测试笔记，保存到 test/ai-test.md」
   - 验证文件是否创建成功，检查 frontmatter
4. 测试权限控制：
   - 手动创建一个没有 aicreate 的文件
   - 尝试用 AI 修改它，应该被拒绝
5. 测试 get_chapter 本地优先：
   - 选择一本已导出 markdown 的书
   - 请求获取章节内容
   - 检查日志是否显示「从本地读取」

**Step 3: 验证日志输出**

检查控制台日志，确认：
- `[write_note]` 日志正常
- `[get_chapter]` 显示本地或后端来源
- `[SubAgent]` 日志（如果测试了 create_sub_agent）

---

## 验收清单

- [ ] `write_note` 工具可正常创建笔记
- [ ] `write_note` 创建的笔记有 `aicreate: true` frontmatter
- [ ] `write_note` 无法修改非 aicreate 文档
- [ ] `write_note` 自动创建不存在的目录
- [ ] `get_chapter` 优先从本地读取
- [ ] `get_chapter` 本地失败时 fallback 到后端
- [ ] `create_sub_agent` 工具已注册（占位实现）
- [ ] System Prompt 包含新工具描述
- [ ] 构建无错误

---

## 后续优化（不在本次实施范围）

1. **完善 create_sub_agent**：传入 LLM 配置，实际调用 runAgentLoop
2. **添加单元测试**：为 write_note 添加测试用例
3. **错误提示优化**：更友好的错误消息
4. **性能监控**：记录工具执行时间
