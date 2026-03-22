# DeepReader Agent Module - Reference

This file provides detailed data structures, complete function signatures, and implementation details for the agent module.

---

## Complete Type Definitions

### ChatMessage (Core Message Type)

**File:** `/Users/lizhao/workspace/DeepReader/frontend/src/agent/types.ts`

```typescript
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
  hidden?: boolean;
  timestamp?: string;
  reasoning_content?: string;  // DeepSeek R1 / Kimi K2.5 thinking
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;  // JSON string
  };
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, ToolParameterProperty>;
      required?: string[];
    };
  };
}

export interface ToolParameterProperty {
  type: string;
  description?: string;
  enum?: string[];
  items?: ToolParameterProperty;
  properties?: Record<string, ToolParameterProperty>;
  required?: string[];
  default?: unknown;
}

export interface ToolResult {
  tool_call_id: string;
  content: string;
}

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

export interface AgentConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  maxIterations?: number;
}

export interface AgentCallbacks {
  onContent: (text: string) => void;
  onToolCall: (toolName: string, args: Record<string, unknown>) => void;
  onProgress: (status: string) => void;
  onComplete: () => void;
  onError: (error: string) => void;
}

export interface LLMResponse {
  id: string;
  choices: {
    index: number;
    message: {
      role: 'assistant';
      content?: string;
      tool_calls?: ToolCall[];
    };
    finish_reason: 'stop' | 'tool_calls' | 'length' | null;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface StreamChunk {
  id: string;
  choices: {
    index: number;
    delta: {
      role?: 'assistant';
      content?: string;
      tool_calls?: {
        index: number;
        id?: string;
        type?: 'function';
        function?: {
          name?: string;
          arguments?: string;
        };
      }[];
    };
    finish_reason: 'stop' | 'tool_calls' | 'length' | null;
  }[];
}
```

---

### Cognitive Engine Types

**File:** `/Users/lizhao/workspace/DeepReader/frontend/src/agent/cognitive-engine/types.ts`

```typescript
export type ReadingDepth = 0 | 1 | 2 | 3;
export type ModelType = 'fast' | 'main';

export interface StateResult {
  success: boolean;
  timestamp: number;
  error?: string;
  duration?: number;
  innerIterations?: number;
}

export interface SearchResult {
  node_id: string;
  block_id: string;
  text: string;
  score: number;
}

export interface RawToolResult {
  block_id?: string;
  text: string;
  toolName?: string;
}

export interface SharedContext {
  // Chat History
  chatHistory: ChatMessage[];
  rawUserQuery: string;

  // S0 Output
  depth: ReadingDepth;
  detectedIntents: string[];
  standaloneQuery?: string;

  // S1 Output
  scopeNodeIds?: string[];
  tocSummary?: string;

  // S2 Output
  rawResults?: SearchResult[];
  analysisResult?: string;

  // S3 Output (deferred)
  globalPassages?: SearchResult[];
  syntopicalInsight?: string;

  // Runtime
  indexId: string;
  pdfName: string;
  abortSignal?: AbortSignal;
  markdownFiles?: Record<string, string>;

  // Engine Dependencies
  llmClient?: LLMClient;
  toolRegistry?: ToolRegistry;
  toolContext?: ToolContext;

  // State Execution Tracking
  executedStates: Set<string>;
  stateResults: Map<string, StateResult>;

  // Methods
  markStateExecuted(stateName: string, success: boolean, error?: string, duration?: number, innerIterations?: number): void;
  needsStateExecution(stateName: string): boolean;
  isStateSuccessful(stateName: string): boolean;
}

export interface StateNodeOptions {
  timeout?: number;
  retries?: number;
  retryDelay?: number;
}

export interface EngineCallbacks {
  onProgress: (status: string) => void;
  onContent: (text: string) => void;
  onReasoning?: (text: string) => void;
  onComplete: () => void;
  onError: (error: string) => void;
}

export type ToolInterceptor = (
  toolName: string,
  toolArgs: Record<string, unknown>
) => Record<string, unknown>;
```

---

### Tool System Types

**File:** `/Users/lizhao/workspace/DeepReader/frontend/src/agent/tools/types.ts`

```typescript
export interface ReadingProgress {
  bookName: string;
  totalChapters: number;
  chapterFamiliarity: Record<number, number>;
  totalInteractions: number;
  coverage: number;
  absorption: number;
  mostFamiliarChapter: string;
  leastFamiliarChapters: string[];
  lastActiveTime: string;
  daysSinceLastRead: number;
}

export interface ToolContext {
  indexId: string;
  pdfName: string;
  markdownFiles?: Record<string, string>;
  useLLMTreeSearch?: boolean;
  scopeNodeIds?: string[];
  app?: App;
  readingProgress?: ReadingProgress;
  sessionId?: string;
  documentMetadata?: {
    title?: string;
    page_count?: number;
    author?: string;
  };
  docDescription?: string;
}

export interface ToolExecutor {
  definition: ToolDefinition;
  execute(args: Record<string, unknown>, context: ToolContext): Promise<string>;
}

export type ToolRegistry = Map<string, ToolExecutor>;
```

---

### State Loop Types

**File:** `/Users/lizhao/workspace/DeepReader/frontend/src/agent/cognitive-engine/states/run-state-loop.ts`

```typescript
export interface StateLoopCallbacks {
  onContent?: (text: string) => void;
  onReasoning?: (text: string) => void;
  onProgress?: (status: string) => void;
}

export interface StateLoopOptions {
  stateName?: string;
  model: 'fast' | 'main';
  systemPrompt: string;
  userMessage: string;
  availableTools: string[];
  toolInterceptor?: ToolInterceptor;
  maxIterations?: number;
  timeout?: number;
  abortSignal?: AbortSignal;
}

export interface StateLoopResult {
  content: string;
  toolResults: Array<{
    toolName: string;
    args: Record<string, unknown>;
    result: string;
  }>;
  iterations: number;
  finishReason: 'stop' | 'max_iterations' | 'timeout' | 'error';
}
```

---

### Subagent Types

**File:** `/Users/lizhao/workspace/DeepReader/frontend/src/agent/subagent/types.ts`

```typescript
export interface SubagentTask {
  taskId: string;
  description: string;
  label: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  result?: string;
  error?: string;
  createdAt: number;
  completedAt?: number;
  sessionId?: string;
  fromCache?: boolean;
  abortController?: AbortController;
}

export interface SubagentConfig {
  maxIterations: number;       // default: 3
  timeout: number;             // default: 60000
  maxRetries: number;          // default: 3
  retryDelay: number;          // default: 5000
  cacheTTL: number;            // default: 300000
  allowedTools: string[];      // default: ['search_doc', 'get_chapter', 'get_toc']
}

export type SubagentCallback = (task: SubagentTask) => void;
```

---

### Humanized UI Types

**File:** `/Users/lizhao/workspace/DeepReader/frontend/src/agent/ui/humanized-types.ts`

```typescript
export type ReadingLevel = 'elementary' | 'inspectional' | 'analytical' | 'syntopical' | 'skill';

export const TOOL_TO_READING_LEVEL: Record<string, ReadingLevel> = {
  get_toc: 'inspectional',
  search_doc: 'inspectional',
  get_chapter: 'analytical',
  search_read_books: 'syntopical',
  analyze_chapter: 'analytical',
  Skill: 'skill',
  skill: 'skill',
};

export type AgentAction =
  | { type: 'reading'; detail: string }
  | { type: 'searching'; detail: string }
  | { type: 'thinking'; detail: string }
  | { type: 'writing'; detail: string }
  | { type: 'waiting'; detail: string };

export interface ReadingProgressItem {
  action: string;
  status: 'done' | 'current' | 'pending';
  duration?: number;
}

export interface HumanizedProgress {
  mainAction: AgentAction;
  readingSteps: ReadingProgressItem[];
  thoughtBubble?: string;
  generatedContent?: string;
  overallProgress: number;  // 0-100
  currentReadingLevel?: ReadingLevel;
}
```

---

## Key Function Signatures

### FrontendAgent Class

**File:** `/Users/lizhao/workspace/DeepReader/frontend/src/agent/index.ts`

```typescript
class FrontendAgent {
  constructor(options: FrontendAgentOptions);

  async initialize(): Promise<void>;

  async getSystemPromptAsync(
    documentMetadata?: DocumentMetadata,
    docDescription?: string
  ): Promise<string>;

  buildMessages(
    systemPrompt: string,
    history: ChatMessage[],
    userMessage: string,
    metadata?: DocumentMetadata,
    progress?: ReadingProgress,
    systemNote?: string
  ): ChatMessage[];

  async chat(
    userMessage: string,
    context: ToolContext,
    callbacks: AgentLoopOptions
  ): Promise<ChatMessage[]>;

  async continueChat(
    history: ChatMessage[],
    userMessage: string,
    context: ToolContext,
    callbacks: AgentLoopOptions
  ): Promise<ChatMessage[]>;

  async reloadSkills(): Promise<void>;
  listSkills(): string[];
  async reloadContext(): Promise<void>;
  getLLMClient(): LLMClient;
  getMemoryStore(): MemoryStore;
  setupSubagentManager(context: ToolContext): void;
}
```

### LLMClient Class

**File:** `/Users/lizhao/workspace/DeepReader/frontend/src/agent/llm-client.ts`

```typescript
class LLMClient {
  constructor(options: LLMClientOptions);

  get maskedApiKey(): string;
  getApiUrl(): string;
  getModel(): string;

  async streamChat(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    callbacks: StreamCallbacks,
    options?: StreamOptions
  ): Promise<AbortController>;

  async chat(
    messages: ChatMessage[],
    tools?: ToolDefinition[]
  ): Promise<{
    content: string;
    toolCalls: { id: string; name: string; arguments: string }[];
    finishReason: 'stop' | 'tool_calls' | 'length';
  }>;
}
```

### StateNode Abstract Class

**File:** `/Users/lizhao/workspace/DeepReader/frontend/src/agent/cognitive-engine/states/base.ts`

```typescript
abstract class StateNode {
  abstract readonly name: string;
  abstract readonly model: ModelType;
  abstract readonly tools: string[];

  protected options: StateNodeOptions = {
    timeout: 30000,
    retries: 1,
    retryDelay: 1000,
  };

  abstract execute(ctx: SharedContext): Promise<void>;
  abstract buildSystemPrompt(ctx: SharedContext): string;

  getToolDefinitions(allTools: Map<string, { definition: ToolDefinition }>): ToolDefinition[];
  setOptions(options: Partial<StateNodeOptions>): void;
}

// Utility functions
async function withTimeout<T>(
  promise: Promise<T>,
  timeout: number,
  stateName: string
): Promise<T>;

async function withRetry<T>(
  fn: () => Promise<T>,
  retries: number,
  delay: number
): Promise<T>;

async function executeStateWithProtection<T>(
  stateName: string,
  fn: () => Promise<T>,
  options: StateNodeOptions
): Promise<T>;
```

### State Loop Runner

**File:** `/Users/lizhao/workspace/DeepReader/frontend/src/agent/cognitive-engine/states/run-state-loop.ts`

```typescript
async function runStateLoop(
  llmClient: LLMClient,
  toolRegistry: ToolRegistry,
  toolContext: ToolContext,
  options: StateLoopOptions,
  callbacks?: StateLoopCallbacks
): Promise<StateLoopResult>;
```

### Tool Registry Functions

**File:** `/Users/lizhao/workspace/DeepReader/frontend/src/agent/tools/index.ts`

```typescript
function createToolRegistry(
  skillLoader: SkillLoader,
  context: ToolContext
): ToolRegistry;

function getToolDefinitions(registry: ToolRegistry): ToolDefinition[];

async function executeTool(
  registry: ToolRegistry,
  name: string,
  args: Record<string, unknown>,
  context: ToolContext,
  timeout?: number  // default: 60000
): Promise<string>;
```

### Memory Store

**File:** `/Users/lizhao/workspace/DeepReader/frontend/src/agent/memory/store.ts`

```typescript
class MemoryStore {
  constructor(app: App);

  async readLongTermMemory(): Promise<string | null>;
  async writeLongTermMemory(content: string): Promise<void>;
  async getMemoryLineCount(): Promise<number>;

  async appendHistory(entry: string): Promise<void>;
  async readHistory(limit?: number): Promise<string>;
  async searchHistory(query: string, limit?: number): Promise<string[]>;
  async getReadingSummary(): Promise<string>;

  async getMemoryContext(): Promise<string>;
  async needsCompression(): Promise<boolean>;
  async initializeMemory(): Promise<void>;

  static readonly MAX_MEMORY_CHARS = 8000;
}
```

### Context Builder

**File:** `/Users/lizhao/workspace/DeepReader/frontend/src/agent/context/builder.ts`

```typescript
class ContextBuilder {
  constructor(app: App, store: MemoryStore, config?: ContextBuilderConfig);

  async buildSystemPrompt(
    skillsSummary: string,
    documentMetadata?: DocumentMetadata,
    docDescription?: string
  ): Promise<string>;

  static buildRuntimeContext(): string;
  static buildMessages(
    systemPrompt: string,
    history: ChatMessage[],
    currentMessage: string,
    runtimeContext?: string,
    systemNote?: string
  ): ChatMessage[];
  static buildMessagesWithMetadata(
    systemPrompt: string,
    history: ChatMessage[],
    currentMessage: string,
    metadata?: DocumentMetadata,
    progress?: ReadingProgress,
    systemNote?: string
  ): ChatMessage[];
}
```

### Skill Loader

**File:** `/Users/lizhao/workspace/DeepReader/frontend/src/agent/skills/loader.ts`

```typescript
class SkillLoader {
  constructor(skillsDir: string);

  async loadSkills(): Promise<void>;
  getDescriptions(): string;  // deprecated
  buildSkillsSummary(): string;
  getSkillContent(name: string): string | null;
  listSkills(): string[];
  getDefaultSkill(): string | null;
  hasSkill(name: string): boolean;
  getSkillInfo(name: string): { name: string; description: string } | null;
  getAllSkillInfos(): { name: string; description: string; isDefault: boolean }[];
}
```

### Subagent Manager

**File:** `/Users/lizhao/workspace/DeepReader/frontend/src/agent/subagent/manager.ts`

```typescript
class SubagentManager {
  constructor(
    client: LLMClient,
    toolRegistry: ToolRegistry,
    context: ToolContext,
    config?: Partial<SubagentConfig>,
    onResult?: SubagentCallback
  );

  spawn(description: string, label?: string, sessionId?: string): string;
  getTask(taskId: string): SubagentTask | undefined;
  listTasks(sessionId?: string): SubagentTask[];
  async cancel(taskId: string): Promise<boolean>;
  async cancelBySession(sessionId: string): Promise<number>;
  cleanup(): number;
  cleanupCache(): number;
  async waitForAll(): Promise<void>;
  async waitFor(taskId: string, timeout?: number): Promise<SubagentTask | undefined>;
}
```

---

## Constants

### Agent Loop Constants

**File:** `/Users/lizhao/workspace/DeepReader/frontend/src/agent/agent-loop.ts`

```typescript
const MAX_TOOL_RESULT_LENGTH = 4000;   // Tool result max chars
const MAX_CONTEXT_TOKENS = 20000;      // Message history max tokens
const TOOL_MAX_RETRIES = 2;            // Tool failure max retries
```

### State Loop Constants

**File:** `/Users/lizhao/workspace/DeepReader/frontend/src/agent/cognitive-engine/states/run-state-loop.ts`

```typescript
const MAX_TOOL_RESULT_LENGTH = 4000;   // Tool result max chars
```

### Memory Constants

**File:** `/Users/lizhao/workspace/DeepReader/frontend/src/agent/memory/store.ts`

```typescript
const DEEPREADER_DIR = 'DeepReader';
const HISTORY_ARCHIVE_DIR = 'DeepReader/history';
const HISTORY_RETENTION_DAYS = 30;
const MAX_HISTORY_ENTRIES = 200;
const MAX_MEMORY_LINES = 200;
static readonly MAX_MEMORY_CHARS = 8000;
```

---

## Registered Tools

| Tool Name | Description | File |
|-----------|-------------|------|
| `search_doc` | Semantic search in document | `tools/search-doc.ts` |
| `get_toc` | Get table of contents | `tools/get-toc.ts` |
| `get_chapter` | Get chapter content | `tools/get-chapter.ts` |
| `write_note` | Write note to Obsidian | `tools/write-note.ts` |
| `create_sub_agent` | Create sub-agent task | `tools/create-sub-agent.ts` |
| `check_sub_agent` | Check sub-agent status | `tools/create-sub-agent.ts` |
| `add_memory` | Save to memory | `tools/memory.ts` |
| `search_memory` | Search memory | `tools/memory.ts` |
| `update_profile` | Update user profile | `tools/profile.ts` |
| `search_read_books` | Search read books | `tools/search-read-books.ts` |
| `analyze_chapter` | Analyze chapter (terms + arguments) | `tools/analyze-chapter.ts` |
| `canvas` | Create Obsidian Canvas | `tools/canvas.ts` |
| `excalidraw` | Create Excalidraw diagram | `tools/excalidraw.ts` |

---

## Error Classes

**File:** `/Users/lizhao/workspace/DeepReader/frontend/src/agent/cognitive-engine/errors.ts`

```typescript
class StateParseError extends Error {
  constructor(message: string, public readonly rawContent: string);
  readonly name = 'StateParseError';
}

class StateTimeoutError extends Error {
  constructor(public readonly stateName: string, public readonly timeout: number);
  readonly name = 'StateTimeoutError';
}

class StateExecutionError extends Error {
  constructor(public readonly stateName: string, public readonly cause: Error);
  readonly name = 'StateExecutionError';
}
```
