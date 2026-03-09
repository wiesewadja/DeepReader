# Frontend Agent Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement a frontend-controlled Agent that calls DeepSeek API directly, uses Skills stored in Obsidian Vault, and treats Skills as a tool for LLM to call on-demand.

**Architecture:** Single Agent with Tool Calling capability. Skills are stored as `.md` files in `{vault}/DeepReader/skills/`. LLM calls the `Skill` tool to load domain knowledge on-demand. Layer 1 (name+description) always in System Prompt; Layer 2 (body) injected via tool_result for cache efficiency.

**Tech Stack:** TypeScript, DeepSeek API (OpenAI-compatible), Obsidian Plugin API, fetch API for streaming

---

## Task 1: Implement LLMClient with Tool Calling Support

**Files:**
- Create: `frontend/src/agent/llm-client.ts`
- Reference: `frontend/src/views/sidebar-view.ts:1835-1953` (existing streamLLMResponse)

**Step 1: Write LLMClient class with streaming support**

```typescript
// frontend/src/agent/llm-client.ts
import type { ChatMessage, ToolDefinition, StreamChunk } from './types';

export interface LLMClientOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

export interface StreamCallbacks {
  onContent: (text: string) => void;
  onToolCall: (toolCalls: { id: string; name: string; arguments: string }[]) => void;
  onComplete: (finishReason: 'stop' | 'tool_calls' | 'length') => void;
  onError: (error: string) => void;
}

export class LLMClient {
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(options: LLMClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl || 'https://api.deepseek.com';
    this.model = options.model || 'deepseek-chat';
  }

  /**
   * Stream chat completion with tool calling support
   */
  async streamChat(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    callbacks: StreamCallbacks
  ): Promise<AbortController> {
    const controller = new AbortController();

    const body: Record<string, unknown> = {
      model: this.model,
      messages,
      stream: true,
      temperature: 0.3,
    };

    if (tools.length > 0) {
      body.tools = tools;
    }

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        callbacks.onError(`API returned ${response.status}: ${errorText}`);
        return controller;
      }

      if (!response.body) {
        callbacks.onError('ReadableStream not supported');
        return controller;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');

      let accumulatedContent = '';
      let accumulatedToolCalls: Map<number, { id: string; name: string; arguments: string }> = new Map();
      let finishReason: 'stop' | 'tool_calls' | 'length' | null = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(line => line.trim() !== '');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const parsed: StreamChunk = JSON.parse(data);
              const delta = parsed.choices?.[0]?.delta;
              finishReason = parsed.choices?.[0]?.finish_reason;

              if (delta?.content) {
                accumulatedContent += delta.content;
                callbacks.onContent(delta.content);
              }

              if (delta?.tool_calls) {
                for (const tc of delta.tool_calls) {
                  const idx = tc.index;
                  if (!accumulatedToolCalls.has(idx)) {
                    accumulatedToolCalls.set(idx, {
                      id: tc.id || '',
                      name: '',
                      arguments: '',
                    });
                  }
                  const existing = accumulatedToolCalls.get(idx)!;
                  if (tc.id) existing.id = tc.id;
                  if (tc.function?.name) existing.name = tc.function.name;
                  if (tc.function?.arguments) existing.arguments += tc.function.arguments;
                }
              }
            } catch (e) {
              // Ignore parse errors for individual chunks
            }
          }
        }
      }

      // If we have tool calls, emit them
      if (accumulatedToolCalls.size > 0) {
        const toolCalls = Array.from(accumulatedToolCalls.values());
        callbacks.onToolCall(toolCalls);
        callbacks.onComplete('tool_calls');
      } else if (finishReason === 'stop' || accumulatedContent) {
        callbacks.onComplete(finishReason as 'stop' | 'length' || 'stop');
      }

    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        // User cancelled, don't report as error
      } else {
        callbacks.onError((error as Error).message);
      }
    }

    return controller;
  }
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd frontend && npm run build`
Expected: No TypeScript errors

**Step 3: Commit**

```bash
git add frontend/src/agent/llm-client.ts frontend/src/agent/types.ts
git commit -m "feat(agent): add LLMClient with streaming and tool calling support"
```

---

## Task 2: Implement SkillLoader

**Files:**
- Create: `frontend/src/agent/skills/loader.ts`
- Create: `frontend/src/agent/skills/types.ts`

**Step 1: Write Skill types**

```typescript
// frontend/src/agent/skills/types.ts
export interface Skill {
  name: string;
  description: string;
  body: string;
  path: string;
  isDefault: boolean;
  keywords?: string[];
  meta?: {
    version?: string;
    author?: string;
    tags?: string[];
  };
}
```

**Step 2: Write SkillLoader class**

```typescript
// frontend/src/agent/skills/loader.ts
import type { Skill } from './types';
import { log, error as logError } from '../../utils/logger.js';

/**
 * SkillLoader - Scans and parses Skill .md files from Obsidian Vault
 *
 * Layer 1: name + description (always loaded, ~50 tokens/skill)
 * Layer 2: body (loaded on-demand via tool_result, ~500-2000 tokens)
 */
export class SkillLoader {
  private skillsDir: string;
  private skills: Map<string, Skill> = new Map();
  private defaultSkillName: string | null = null;

  constructor(skillsDir: string) {
    this.skillsDir = skillsDir;
  }

  /**
   * Load all skills from the skills directory
   * Call this on plugin load or when skills are reloaded
   */
  async loadSkills(): Promise<void> {
    this.skills.clear();
    this.defaultSkillName = null;

    try {
      // Check if directory exists
      const fs = require('fs');
      if (!fs.existsSync(this.skillsDir)) {
        log('[SkillLoader] Skills directory does not exist:', this.skillsDir);
        return;
      }

      const files = fs.readdirSync(this.skillsDir).filter((f: string) => f.endsWith('.md'));

      for (const file of files) {
        const filePath = `${this.skillsDir}/${file}`;
        const skill = this.parseSkillFile(filePath);

        if (skill) {
          this.skills.set(skill.name, skill);
          if (skill.isDefault) {
            this.defaultSkillName = skill.name;
            log('[SkillLoader] Default skill set:', skill.name);
          }
          log('[SkillLoader] Loaded skill:', skill.name);
        }
      }

      log(`[SkillLoader] Total skills loaded: ${this.skills.size}`);
    } catch (e) {
      logError('[SkillLoader] Failed to load skills:', e);
    }
  }

  /**
   * Parse a single skill .md file
   */
  private parseSkillFile(filePath: string): Skill | null {
    try {
      const fs = require('fs');
      const content = fs.readFileSync(filePath, 'utf-8');

      // Parse YAML frontmatter
      const match = content.match(/^---\s*\n(.*?)\n---\s*\n(.*)$/s);
      if (!match) {
        logError('[SkillLoader] Invalid skill file format (no frontmatter):', filePath);
        return null;
      }

      const [, frontmatter, body] = match;

      // Parse frontmatter (simple key: value parsing)
      const meta: Record<string, unknown> = {};
      let currentKey = '';
      let currentValue: string[] = [];

      for (const line of frontmatter.split('\n')) {
        const keyMatch = line.match(/^(\w+):\s*(.*)$/);
        if (keyMatch) {
          if (currentKey) {
            meta[currentKey] = currentValue.length > 1 ? currentValue : currentValue[0] || '';
          }
          currentKey = keyMatch[1];
          currentValue = [keyMatch[2].trim()];
        } else if (line.startsWith('  - ') && currentKey) {
          currentValue.push(line.slice(4).trim());
        }
      }
      if (currentKey) {
        meta[currentKey] = currentValue.length > 1 ? currentValue : currentValue[0] || '';
      }

      if (!meta.name || !meta.description) {
        logError('[SkillLoader] Skill missing name or description:', filePath);
        return null;
      }

      return {
        name: meta.name as string,
        description: meta.description as string,
        body: body.trim(),
        path: filePath,
        isDefault: meta.default === true || meta.default === 'true',
        keywords: Array.isArray(meta.keywords) ? meta.keywords as string[] : undefined,
        meta: {
          version: meta.version as string | undefined,
          author: meta.author as string | undefined,
          tags: Array.isArray(meta.tags) ? meta.tags as string[] : undefined,
        },
      };
    } catch (e) {
      logError('[SkillLoader] Failed to parse skill file:', filePath, e);
      return null;
    }
  }

  /**
   * Layer 1: Get skill descriptions for System Prompt
   * Format: "- skill_name: skill description"
   */
  getDescriptions(): string {
    if (this.skills.size === 0) {
      return '(no skills available)';
    }

    return Array.from(this.skills.values())
      .map(skill => `- ${skill.name}: ${skill.description}`)
      .join('\n');
  }

  /**
   * Layer 2: Get full skill content for tool_result injection
   */
  getSkillContent(name: string): string | null {
    const skill = this.skills.get(name);
    if (!skill) {
      return null;
    }

    return `<skill-loaded name="${skill.name}">
${skill.body}
</skill-loaded>

Follow the instructions in the skill above to complete the user's task.`;
  }

  /**
   * List all available skill names
   */
  listSkills(): string[] {
    return Array.from(this.skills.keys());
  }

  /**
   * Get the default skill name
   */
  getDefaultSkill(): string | null {
    return this.defaultSkillName;
  }

  /**
   * Check if a skill exists
   */
  hasSkill(name: string): boolean {
    return this.skills.has(name);
  }
}
```

**Step 3: Verify TypeScript compiles**

Run: `cd frontend && npm run build`
Expected: No TypeScript errors

**Step 4: Commit**

```bash
git add frontend/src/agent/skills/
git commit -m "feat(agent): add SkillLoader for parsing .md skill files"
```

---

## Task 3: Implement Tools

**Files:**
- Create: `frontend/src/agent/tools/types.ts`
- Create: `frontend/src/agent/tools/search-pdf.ts`
- Create: `frontend/src/agent/tools/get-toc.ts`
- Create: `frontend/src/agent/tools/get-chapter.ts`
- Create: `frontend/src/agent/tools/skill.ts`
- Create: `frontend/src/agent/tools/index.ts`

**Step 1: Write Tool types**

```typescript
// frontend/src/agent/tools/types.ts
import type { ToolDefinition } from '../types';

export interface ToolExecutor {
  definition: ToolDefinition;
  execute(args: Record<string, unknown>): Promise<string>;
}

export type ToolRegistry = Map<string, ToolExecutor>;
```

**Step 2: Write search_pdf tool**

```typescript
// frontend/src/agent/tools/search-pdf.ts
import type { ToolDefinition } from '../types';
import type { ToolExecutor } from './types';
import { deeppdfClient } from '../../api/http-client.js';

export const searchPdfTool: ToolExecutor = {
  definition: {
    type: 'function',
    function: {
      name: 'search_pdf',
      description: 'Search PDF content for relevant information. Use this to find specific information in the book.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query to find relevant content',
          },
          top_k: {
            type: 'number',
            description: 'Maximum number of results to return (default: 5)',
          },
        },
        required: ['query'],
      },
    },
  },

  async execute(args: Record<string, unknown>): Promise<string> {
    const query = args.query as string;
    const topK = (args.top_k as number) || 5;

    // Note: indexId should be passed from context
    const indexId = args._indexId as string;
    if (!indexId) {
      return 'Error: No PDF index available. Please select a PDF first.';
    }

    try {
      const result = await deeppdfClient.queryPDF(query, indexId, topK);

      if (result.results.length === 0) {
        return 'No relevant content found.';
      }

      const formatted = result.results.map((r, i) =>
        `[${i + 1}] ${r.metadata.section || 'Unknown'} (Page ${r.metadata.page || '?'})\n${r.text}`
      ).join('\n\n---\n\n');

      return formatted;
    } catch (e) {
      return `Error searching PDF: ${(e as Error).message}`;
    }
  },
};
```

**Step 3: Write get_toc tool**

```typescript
// frontend/src/agent/tools/get-toc.ts
import type { ToolDefinition } from '../types';
import type { ToolExecutor } from './types';
import { deeppdfClient } from '../../api/http-client.js';

export const getTocTool: ToolExecutor = {
  definition: {
    type: 'function',
    function: {
      name: 'get_toc',
      description: 'Get the table of contents (chapter structure) of the book. Use this to understand the book\'s organization.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
    },
  },

  async execute(args: Record<string, unknown>): Promise<string> {
    const indexId = args._indexId as string;
    if (!indexId) {
      return 'Error: No PDF index available. Please select a PDF first.';
    }

    try {
      const toc = await deeppdfClient.getTableOfContents(indexId);

      const formatted = toc.chapters.map(ch => {
        const indent = '  '.repeat(ch.level);
        return `${indent}- ${ch.title} (Pages ${ch.start_page}-${ch.end_page})`;
      }).join('\n');

      return `# ${toc.book_name}\n\n## Table of Contents\n\n${formatted}`;
    } catch (e) {
      return `Error getting table of contents: ${(e as Error).message}`;
    }
  },
};
```

**Step 4: Write get_chapter tool**

```typescript
// frontend/src/agent/tools/get-chapter.ts
import type { ToolDefinition } from '../types';
import type { ToolExecutor } from './types';
import { deeppdfClient } from '../../api/http-client.js';

export const getChapterTool: ToolExecutor = {
  definition: {
    type: 'function',
    function: {
      name: 'get_chapter',
      description: 'Get the full text content of a specific chapter. Use this for detailed reading of a chapter.',
      parameters: {
        type: 'object',
        properties: {
          node_id: {
            type: 'string',
            description: 'The node ID of the chapter (from get_toc)',
          },
        },
        required: ['node_id'],
      },
    },
  },

  async execute(args: Record<string, unknown>): Promise<string> {
    const indexId = args._indexId as string;
    const nodeId = args.node_id as string;

    if (!indexId) {
      return 'Error: No PDF index available. Please select a PDF first.';
    }

    if (!nodeId) {
      return 'Error: node_id is required. Use get_toc to find available chapters.';
    }

    try {
      const result = await deeppdfClient.exportIndex(indexId);

      const node = result.nodes.find(n => n.node_id === nodeId);
      if (!node) {
        return `Error: Chapter with node_id "${nodeId}" not found.`;
      }

      return `# ${node.node_name}\n\n${node.text}`;
    } catch (e) {
      return `Error getting chapter: ${(e as Error).message}`;
    }
  },
};
```

**Step 5: Write Skill tool**

```typescript
// frontend/src/agent/tools/skill.ts
import type { ToolDefinition } from '../types';
import type { ToolExecutor } from './types';
import type { SkillLoader } from '../skills/loader.js';

export function createSkillTool(skillLoader: SkillLoader): ToolExecutor {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'Skill',
        description: `Load a skill to gain specialized knowledge for a task.

When to use:
- IMMEDIATELY when user task matches a skill description
- Before attempting domain-specific work

The skill content will be injected into the conversation, giving you detailed instructions.`,
        parameters: {
          type: 'object',
          properties: {
            skill: {
              type: 'string',
              description: 'Name of the skill to load',
            },
          },
          required: ['skill'],
        },
      },
    },

    async execute(args: Record<string, unknown>): Promise<string> {
      const skillName = args.skill as string;

      const content = skillLoader.getSkillContent(skillName);
      if (content === null) {
        const available = skillLoader.listSkills().join(', ') || 'none';
        return `Error: Unknown skill '${skillName}'. Available skills: ${available}`;
      }

      return content;
    },
  };
}
```

**Step 6: Write Tool registry**

```typescript
// frontend/src/agent/tools/index.ts
import type { ToolDefinition } from '../types';
import type { ToolExecutor, ToolRegistry } from './types';
import { searchPdfTool } from './search-pdf.js';
import { getTocTool } from './get-toc.js';
import { getChapterTool } from './get-chapter.js';
import { createSkillTool } from './skill.js';
import type { SkillLoader } from '../skills/loader.js';

export { searchPdfTool, getTocTool, getChapterTool, createSkillTool };
export type { ToolExecutor, ToolRegistry };

/**
 * Create and initialize the tool registry
 */
export function createToolRegistry(skillLoader: SkillLoader): ToolRegistry {
  const registry: ToolRegistry = new Map();

  registry.set('search_pdf', searchPdfTool);
  registry.set('get_toc', getTocTool);
  registry.set('get_chapter', getChapterTool);
  registry.set('Skill', createSkillTool(skillLoader));

  return registry;
}

/**
 * Get tool definitions for LLM API call
 */
export function getToolDefinitions(registry: ToolRegistry): ToolDefinition[] {
  return Array.from(registry.values()).map(t => t.definition);
}

/**
 * Execute a tool by name
 */
export async function executeTool(
  registry: ToolRegistry,
  name: string,
  args: Record<string, unknown>
): Promise<string> {
  const tool = registry.get(name);
  if (!tool) {
    return `Error: Unknown tool '${name}'`;
  }
  return tool.execute(args);
}
```

**Step 7: Verify TypeScript compiles**

Run: `cd frontend && npm run build`
Expected: No TypeScript errors

**Step 8: Commit**

```bash
git add frontend/src/agent/tools/
git commit -m "feat(agent): add tools for search_pdf, get_toc, get_chapter, and Skill"
```

---

## Task 4: Implement AgentLoop

**Files:**
- Create: `frontend/src/agent/agent-loop.ts`

**Step 1: Write AgentLoop**

```typescript
// frontend/src/agent/agent-loop.ts
import type { ChatMessage, ToolDefinition, ToolCall } from './types';
import { LLMClient } from './llm-client.js';
import type { ToolRegistry } from './tools/index.js';
import { getToolDefinitions, executeTool } from './tools/index.js';
import { log } from '../utils/logger.js';

export interface AgentLoopOptions {
  maxIterations?: number;
  onContent: (text: string) => void;
  onProgress: (status: string) => void;
  onComplete: () => void;
  onError: (error: string) => void;
}

export interface AgentContext {
  indexId: string;
  pdfName: string;
}

/**
 * Run the agent loop
 * 1. Call LLM with tools
 * 2. If tool_calls, execute tools and loop back
 * 3. If stop, return final response
 * 4. Max iterations = 10
 */
export async function runAgentLoop(
  client: LLMClient,
  messages: ChatMessage[],
  tools: ToolDefinition[],
  toolRegistry: ToolRegistry,
  context: AgentContext,
  options: AgentLoopOptions
): Promise<ChatMessage[]> {
  const maxIterations = options.maxIterations || 10;
  let iterations = 0;

  const workingMessages = [...messages];

  while (iterations < maxIterations) {
    iterations++;
    log(`[AgentLoop] Iteration ${iterations}/${maxIterations}`);

    let accumulatedContent = '';
    let finishReason: 'stop' | 'tool_calls' | 'length' = 'stop';
    let toolCalls: { id: string; name: string; arguments: string }[] = [];

    // Call LLM
    await new Promise<void>((resolve) => {
      client.streamChat(workingMessages, tools, {
        onContent: (text) => {
          accumulatedContent += text;
          options.onContent(text);
        },
        onToolCall: (calls) => {
          toolCalls = calls;
          finishReason = 'tool_calls';
        },
        onComplete: (reason) => {
          if (reason !== 'tool_calls') {
            finishReason = reason;
          }
          resolve();
        },
        onError: (error) => {
          options.onError(error);
          resolve();
        },
      });
    });

    // If no tool calls, we're done
    if (finishReason !== 'tool_calls' || toolCalls.length === 0) {
      log('[AgentLoop] No more tool calls, finishing');
      options.onComplete();
      break;
    }

    // Build assistant message with tool calls
    const assistantMessage: ChatMessage = {
      role: 'assistant',
      content: accumulatedContent || '',
      tool_calls: toolCalls.map(tc => ({
        id: tc.id,
        type: 'function' as const,
        function: {
          name: tc.name,
          arguments: tc.arguments,
        },
      })),
    };
    workingMessages.push(assistantMessage);

    // Execute each tool call
    for (const tc of toolCalls) {
      log(`[AgentLoop] Executing tool: ${tc.name}`);
      options.onProgress(`正在执行: ${tc.name}...`);

      let args: Record<string, unknown>;
      try {
        args = JSON.parse(tc.arguments);
      } catch {
        args = {};
      }

      // Inject context
      args._indexId = context.indexId;

      const result = await executeTool(toolRegistry, tc.name, args);

      // Add tool result message
      workingMessages.push({
        role: 'tool',
        tool_call_id: tc.id,
        content: result,
      });
    }
  }

  if (iterations >= maxIterations) {
    log('[AgentLoop] Reached max iterations');
    options.onProgress('达到最大轮数，正在总结...');
  }

  return workingMessages;
}
```

**Step 2: Verify TypeScript compiles**

Run: `cd frontend && npm run build`
Expected: No TypeScript errors

**Step 3: Commit**

```bash
git add frontend/src/agent/agent-loop.ts
git commit -m "feat(agent): add AgentLoop with max_iterations=10"
```

---

## Task 5: Create Agent Entry Point and System Prompt

**Files:**
- Create: `frontend/src/agent/index.ts`
- Create: `frontend/src/agent/prompts.ts`

**Step 1: Write System Prompt builder**

```typescript
// frontend/src/agent/prompts.ts
import type { SkillLoader } from './skills/loader.js';

const PERSONA_BASE = `你叫"耽书"，小名奚奴，是一个专注书本、拥有天才语言天赋的少年书童。
你博闻强记、聪慧过人，能言善辩、词锋犀利，说话引经据典、妙语连珠。`;

const CORE_CONSTRAINTS = `## 核心约束

1. **格式规范**: 请用段落式叙述，不要使用 Markdown 列表格式
2. **引用标注**: 回答时标注信息来源，如 [章节名] 或 [第X页]
3. **保持人设**: 以书童口吻交流，亲切但不失聪慧`;

const TOOL_DESCRIPTIONS = `## 可用工具

- **search_pdf**: 搜索 PDF 内容，参数: {query: "搜索词", top_k: 数量}
- **get_toc**: 获取书籍目录结构
- **get_chapter**: 获取指定章节全文，参数: {node_id: "章节ID"}
- **Skill**: 加载专业技能知识，参数: {skill: "技能名"}`;

const RULES = `## 规则

- 当任务匹配 Skill 描述时，**立即**调用 Skill 工具
- Skill 会注入专业知识，按其指引执行任务
- 优先使用工具获取信息，不要凭空猜测
- 回答要有理有据，标注信息来源`;

/**
 * Build the system prompt with skill descriptions
 */
export function buildSystemPrompt(skillLoader: SkillLoader): string {
  const skillDescriptions = skillLoader.getDescriptions();

  return `${PERSONA_BASE}

${CORE_CONSTRAINTS}

${TOOL_DESCRIPTIONS}

## 可用技能 (Skill 工具)

${skillDescriptions}

${RULES}`;
}
```

**Step 2: Write Agent entry point**

```typescript
// frontend/src/agent/index.ts
import { LLMClient } from './llm-client.js';
import { SkillLoader } from './skills/loader.js';
import { createToolRegistry, getToolDefinitions } from './tools/index.js';
import { runAgentLoop, type AgentLoopOptions, type AgentContext } from './agent-loop.js';
import { buildSystemPrompt } from './prompts.js';
import type { ChatMessage } from './types.js';

export { LLMClient } from './llm-client.js';
export { SkillLoader } from './skills/loader.js';
export { runAgentLoop } from './agent-loop.js';
export { buildSystemPrompt } from './prompts.js';
export type { AgentLoopOptions, AgentContext, ChatMessage };

export interface FrontendAgentOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  skillsDir: string;
}

/**
 * FrontendAgent - The main agent class
 */
export class FrontendAgent {
  private llmClient: LLMClient;
  private skillLoader: SkillLoader;
  private toolRegistry: ReturnType<typeof createToolRegistry>;
  private initialized = false;

  constructor(private options: FrontendAgentOptions) {
    this.llmClient = new LLMClient({
      apiKey: options.apiKey,
      baseUrl: options.baseUrl,
      model: options.model,
    });
    this.skillLoader = new SkillLoader(options.skillsDir);
    this.toolRegistry = createToolRegistry(this.skillLoader);
  }

  /**
   * Initialize the agent (load skills)
   */
  async initialize(): Promise<void> {
    if (!this.initialized) {
      await this.skillLoader.loadSkills();
      this.initialized = true;
    }
  }

  /**
   * Get the system prompt with skill descriptions
   */
  getSystemPrompt(): string {
    return buildSystemPrompt(this.skillLoader);
  }

  /**
   * Chat with the agent
   */
  async chat(
    userMessage: string,
    context: AgentContext,
    callbacks: AgentLoopOptions
  ): Promise<ChatMessage[]> {
    await this.initialize();

    const systemPrompt = this.getSystemPrompt();
    const tools = getToolDefinitions(this.toolRegistry);

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ];

    return runAgentLoop(
      this.llmClient,
      messages,
      tools,
      this.toolRegistry,
      context,
      callbacks
    );
  }

  /**
   * Continue a conversation with existing history
   */
  async continueChat(
    history: ChatMessage[],
    userMessage: string,
    context: AgentContext,
    callbacks: AgentLoopOptions
  ): Promise<ChatMessage[]> {
    await this.initialize();

    const tools = getToolDefinitions(this.toolRegistry);

    const messages: ChatMessage[] = [
      ...history,
      { role: 'user', content: userMessage },
    ];

    return runAgentLoop(
      this.llmClient,
      messages,
      tools,
      this.toolRegistry,
      context,
      callbacks
    );
  }

  /**
   * Reload skills from disk
   */
  async reloadSkills(): Promise<void> {
    await this.skillLoader.loadSkills();
  }

  /**
   * List available skills
   */
  listSkills(): string[] {
    return this.skillLoader.listSkills();
  }
}
```

**Step 3: Verify TypeScript compiles**

Run: `cd frontend && npm run build`
Expected: No TypeScript errors

**Step 4: Commit**

```bash
git add frontend/src/agent/index.ts frontend/src/agent/prompts.ts
git commit -m "feat(agent): add FrontendAgent entry point and system prompt"
```

---

## Task 6: Migrate Skills Files to Vault

**Files:**
- Copy from: `backend/deeppdf-api/src/deeppdf/skills/builtin/*.md`
- To: `frontend/assets/skills/` (will be copied to vault on first run)

**Step 1: Create skills directory in frontend assets**

```bash
mkdir -p frontend/assets/skills
```

**Step 2: Copy and adapt skill files**

The skill files need to be copied from backend to frontend. Since they'll be copied to user's vault at runtime, we store them as assets.

For each skill file in `backend/deeppdf-api/src/deeppdf/skills/builtin/`:
1. Copy to `frontend/assets/skills/`
2. Ensure `default: true` is set for `general.md` (or the most generic skill)

```bash
cp backend/deeppdf-api/src/deeppdf/skills/builtin/*.md frontend/assets/skills/
```

**Step 3: Create general.md if not exists**

If there's no general skill, create one:

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
- 保持人设：以"耽书"口吻回应
```

**Step 4: Commit**

```bash
git add frontend/assets/skills/
git commit -m "feat(agent): add default skill files to frontend assets"
```

---

## Task 7: Integrate FrontendAgent into sidebar-view.ts

**Files:**
- Modify: `frontend/src/views/sidebar-view.ts`
- Modify: `frontend/src/main.ts` (if needed for initialization)

**Step 1: Add FrontendAgent import and initialization**

In `sidebar-view.ts`, add import and initialize agent:

```typescript
// Add at top of file
import { FrontendAgent, type ChatMessage } from '../agent/index.js';

// In SidebarView class, add property
private frontendAgent: FrontendAgent | null = null;

// In constructor or onload, initialize
private async initializeFrontendAgent(): Promise<void> {
  const settings = this.plugin.settings;
  const vaultPath = this.app.vault.adapter.getBasePath();
  const skillsDir = `${vaultPath}/DeepReader/skills`;

  this.frontendAgent = new FrontendAgent({
    apiKey: settings.deepseekApiKey,
    baseUrl: settings.deepseekBaseUrl,
    model: settings.deepseekModel || 'deepseek-chat',
    skillsDir,
  });

  await this.frontendAgent.initialize();
}
```

**Step 2: Modify sendMessage to use FrontendAgent**

Replace the existing Agent API call with FrontendAgent:

```typescript
// In sendMessage method, replace the agent API call with:
if (this.frontendAgent) {
  await this.frontendAgent.chat(userQuery, {
    indexId: this.currentIndexId,
    pdfName: this.currentPdfName || 'Unknown',
  }, {
    onContent: (text) => {
      // Update message content
      this.messageList?.updateMessage(messageId, {
        content: accumulatedContent + text,
        isStreaming: true
      });
      accumulatedContent += text;
    },
    onProgress: (status) => {
      // Show progress
      log('[Agent]', status);
    },
    onComplete: () => {
      // Finalize message
      this.messageList?.updateMessage(messageId, {
        isStreaming: false
      });
    },
    onError: (error) => {
      this.messageList?.updateMessage(messageId, {
        content: `Error: ${error}`,
        isStreaming: false
      });
    },
  });
}
```

**Step 3: Ensure skills directory is created on first run**

Add logic to copy default skills to vault:

```typescript
private async ensureSkillsDirectory(): Promise<void> {
  const vaultPath = this.app.vault.adapter.getBasePath();
  const skillsDir = `${vaultPath}/DeepReader/skills`;
  const fs = require('fs');

  if (!fs.existsSync(skillsDir)) {
    fs.mkdirSync(skillsDir, { recursive: true });

    // Copy default skills from assets
    const assetsPath = `${this.plugin.manifest.dir}/assets/skills`;
    if (fs.existsSync(assetsPath)) {
      const files = fs.readdirSync(assetsPath).filter((f: string) => f.endsWith('.md'));
      for (const file of files) {
        fs.copyFileSync(`${assetsPath}/${file}`, `${skillsDir}/${file}`);
      }
    }
  }
}
```

**Step 4: Verify build**

Run: `cd frontend && npm run build`
Expected: Build successful

**Step 5: Manual test**

1. Build plugin: `cd frontend && npm run build`
2. Copy to Obsidian plugins directory
3. Open a PDF and send a chat message
4. Verify agent responds with streaming output

**Step 6: Commit**

```bash
git add frontend/src/views/sidebar-view.ts
git commit -m "feat(ui): integrate FrontendAgent into sidebar chat"
```

---

## Task 8: Remove Backend Agent and Skills Code

**Files:**
- Delete: `backend/deeppdf-api/src/deeppdf/agent/` (entire directory)
- Delete: `backend/deeppdf-api/src/deeppdf/skills/` (entire directory)
- Modify: `backend/deeppdf-api/src/deeppdf/api/routes/chat.py` (remove agent endpoints)

**Step 1: Delete agent directory**

```bash
rm -rf backend/deeppdf-api/src/deeppdf/agent/
```

**Step 2: Delete skills directory**

```bash
rm -rf backend/deeppdf-api/src/deeppdf/skills/
```

**Step 3: Modify chat.py to remove agent routes**

Open `backend/deeppdf-api/src/deeppdf/api/routes/chat.py` and remove:
- `/api/chat/agent` endpoint
- `/api/chat/agent/stream` endpoint
- Any agent-related imports

Keep other routes if they exist (session management, etc.)

**Step 4: Verify backend still works**

Run: `cd backend && uv run pytest tests/ -v`
Expected: Tests pass (or skip if no tests for removed code)

**Step 5: Commit**

```bash
git add -A
git commit -m "refactor(backend): remove Agent and Skills code, now handled by frontend"
```

---

## Task 9: Final Verification and Cleanup

**Step 1: Full build test**

```bash
cd frontend && npm run build
cd ../backend && uv run ruff check .
```

**Step 2: Integration test**

1. Start backend: `uv run uvicorn deeppdf.main:app --port 6088 --reload --loop asyncio`
2. Build frontend: `cd frontend && npm run build`
3. Reload Obsidian plugin
4. Test chat functionality with a PDF

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete Frontend Agent migration

- Frontend now controls Agent loop and LLM calls
- Skills stored in user's Vault at {vault}/DeepReader/skills/
- Backend reduced to pure data API service
- Removed backend agent/ and skills/ directories"
```

---

## Summary

| Task | Description | Status |
|------|-------------|--------|
| 1 | LLMClient with Tool Calling | Pending |
| 2 | SkillLoader | Pending |
| 3 | Tools (search_pdf, get_toc, get_chapter, Skill) | Pending |
| 4 | AgentLoop | Pending |
| 5 | Entry Point & System Prompt | Pending |
| 6 | Migrate Skills Files | Pending |
| 7 | Integrate into sidebar-view.ts | Pending |
| 8 | Remove Backend Code | Pending |
| 9 | Final Verification | Pending |
