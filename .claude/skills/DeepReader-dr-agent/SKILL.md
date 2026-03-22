---
name: DeepReader-dr-agent
description: Use when working with the agent module of DeepReader — an AI reading assistant built on Obsidian implementing Adler's "How to Read a Book" methodology through a cognitive state machine architecture.
---

# DeepReader Agent Module

## Module Purpose & Capabilities

The agent module is the core intelligence layer of DeepReader, an Obsidian plugin that transforms how users interact with their digital library. It implements a **cognitive state machine** based on Mortimer Adler's four levels of reading from "How to Read a Book".

### What This Module Does

This module provides a complete AI agent system that:
- **Routes user queries** to appropriate reading depth levels (elementary, inspectional, analytical, syntopical)
- **Orchestrates LLM interactions** with streaming support and tool calling
- **Manages document retrieval** through semantic search, TOC navigation, and chapter extraction
- **Maintains user memory** across sessions (preferences, reading history, milestones)
- **Generates formatted Obsidian notes** with proper wikilinks and block references

### Key Public API Surface

**Main Entry Point:**
```typescript
// /Users/lizhao/workspace/DeepReader/frontend/src/agent/index.ts
import { FrontendAgent } from './index.js';

const agent = new FrontendAgent({
  apiKey: string,
  baseUrl?: string,          // default: 'https://api.deepseek.com'
  model?: string,            // default: 'deepseek-chat'
  providerName?: string,     // for logging
  skillsDir: string,         // path to skill .md files
  app: ObsidianApp           // Obsidian App instance
});

// Core methods
await agent.initialize();
await agent.chat(userMessage, toolContext, callbacks);
await agent.continueChat(history, userMessage, toolContext, callbacks);
const systemPrompt = await agent.getSystemPromptAsync(documentMetadata, docDescription);
```

**Cognitive Engine (State Machine):**
```typescript
// /Users/lizhao/workspace/DeepReader/frontend/src/agent/cognitive-engine/index.ts
import { runCognitiveEngine, createSharedContext } from './cognitive-engine/index.js';

const ctx = createSharedContext({
  indexId: string,
  pdfName: string,
  rawUserQuery: string,
  chatHistory?: ChatMessage[],
  markdownFiles?: Record<string, string>,
  abortSignal?: AbortSignal,
  llmClient?: LLMClient,
  toolRegistry?: ToolRegistry,
  toolContext?: ToolContext
});

await runCognitiveEngine(ctx, callbacks);
```

**LLM Client (Streaming + Tool Calling):**
```typescript
// /Users/lizhao/workspace/DeepReader/frontend/src/agent/llm-client.ts
const client = new LLMClient({ apiKey, baseUrl, model, providerName });

await client.streamChat(messages, tools, {
  onContent: (text) => void,
  onToolCall: (calls) => void,
  onComplete: (finishReason) => void,
  onError: (error) => void,
  onReasoning?: (text) => void  // for DeepSeek R1 / Kimi K2.5
}, { signal: abortSignal });
```

---

## Core Design Logic

### Why This Architecture?

The module is designed around three key principles:

#### 1. **Cognitive State Machine (Adler's Reading Levels)**

Instead of a traditional ReAct loop, the system uses a deterministic state machine that mirrors how humans read books:

```
User Query
    │
    ▼
┌─────────────────┐
│ S0: Router      │  → Classify depth (0-3), rewrite to standalone query
└────────┬────────┘
         │
    ┌────┴────┬─────────┬─────────┐
    ▼         ▼         ▼         ▼
depth=0   depth=1   depth=2   depth=3
(闲聊)    (检视)    (分析)    (主题)
    │         │         │         │
    │    S1:Inspectional  │    (deferred)
    │    (get_toc only)   │
    │         │           │
    │         └─────┬─────┘
    │               ▼
    │         S2: Analytical
    │         (search_doc + get_chapter)
    │               │
    └───────────────┼───────────────┐
                    ▼               │
              S4: Formatter         │
              (no tools, output)    │
                    │               │
                    ▼               │
              Final Response        │
```

**Key Design Decision:** Each state has *physical* tool restrictions:
- **S1 Inspectional**: Only `get_toc` and `search_doc` — physically cannot read chapter content
- **S2 Analytical**: `search_doc` + `get_chapter`, but with **scope interceptor** that locks search to specific chapters
- **S4 Formatter**: No tools at all — pure output formatting

This prevents the LLM from "cheating" by reading content before establishing scope.

#### 2. **Cumulative State Guarantee**

States can call preceding states if needed:
- S2 (Analytical) internally calls S1 (Inspectional) if `scopeNodeIds` is not set
- This ensures robustness — even if the state machine is entered mid-stream, prerequisites are satisfied

```typescript
// /Users/lizhao/workspace/DeepReader/frontend/src/agent/cognitive-engine/states/analytical.ts
async execute(ctx: SharedContext): Promise<void> {
  // Cumulative guarantee: call S1 if scope not set
  if (!ctx.scopeNodeIds || ctx.scopeNodeIds.length === 0) {
    await this.inspectionalState.execute(ctx);
  }
  // ... proceed with scope locked
}
```

#### 3. **Tool Interception for Scope Locking**

The `ScopeInterceptor` physically enforces scope boundaries:

```typescript
// /Users/lizhao/workspace/DeepReader/frontend/src/agent/cognitive-engine/interceptor/scope-interceptor.ts
export function createScopeInterceptor(scopeNodeIds: string[]): ToolInterceptor {
  return (toolName, toolArgs) => {
    // search_doc: inject scopeNodeIds to limit search
    if (toolName === 'search_doc') {
      return { ...toolArgs, scopeNodeIds };
    }
    // get_chapter: check if node_id is in scope
    if (toolName === 'get_chapter' && !scopeNodeIds.includes(toolArgs.node_id)) {
      return { ...toolArgs, _error: '章节不在允许范围内' };
    }
    return toolArgs;
  };
}
```

### Trade-offs Made

| Decision | Trade-off |
|----------|-----------|
| State machine vs ReAct loop | Less flexibility, but more predictable behavior and easier debugging |
| Physical tool restrictions | LLM cannot "self-correct" by using wrong tools, but requires careful state design |
| Scope locking | Prevents context dilution, but may miss relevant content outside locked scope |
| Separate Formatter state | Extra LLM call, but cleaner separation of concerns and consistent output format |
| Token compression in agent-loop | May lose detail, but prevents context explosion |

---

## Core Data Structures

### ChatMessage (Message Format)

**File:** `/Users/lizhao/workspace/DeepReader/frontend/src/agent/types.ts`

```typescript
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;    // for role='tool' messages
  name?: string;
  hidden?: boolean;          // for profile updates (sent to LLM, not shown in UI)
  timestamp?: string;
  reasoning_content?: string; // for DeepSeek R1 / Kimi K2.5 thinking models
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string }; // arguments is JSON string
}
```

### SharedContext (State Machine Context)

**File:** `/Users/lizhao/workspace/DeepReader/frontend/src/agent/cognitive-engine/types.ts`

```typescript
export interface SharedContext {
  // Chat History
  chatHistory: ChatMessage[];
  rawUserQuery: string;

  // S0 Output (Router)
  depth: ReadingDepth;           // 0 | 1 | 2 | 3
  detectedIntents: string[];
  standaloneQuery?: string;

  // S1 Output (Inspectional)
  scopeNodeIds?: string[];       // Locked chapter scope
  tocSummary?: string;

  // S2 Output (Analytical)
  rawResults?: RawToolResult[];  // Tool results with block_ids
  analysisResult?: string;

  // S3 Output (Syntopical - deferred)
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

  // State Tracking
  executedStates: Set<string>;
  stateResults: Map<string, StateResult>;

  // Methods
  markStateExecuted(stateName: string, success: boolean, error?: string, duration?: number, innerIterations?: number): void;
  needsStateExecution(stateName: string): boolean;
  isStateSuccessful(stateName: string): boolean;
}
```

### ReadingDepth (Adler's Levels)

**File:** `/Users/lizhao/workspace/DeepReader/frontend/src/agent/cognitive-engine/types.ts`

```typescript
export type ReadingDepth = 0 | 1 | 2 | 3;

// depth=0: Elementary/Casual - greetings, non-book questions
// depth=1: Inspectional - TOC browsing, overview questions
// depth=2: Analytical - specific concepts, definitions, arguments
// depth=3: Syntopical - cross-book comparison, critical analysis (deferred)
```

### ToolContext (Tool Execution Context)

**File:** `/Users/lizhao/workspace/DeepReader/frontend/src/agent/tools/types.ts`

```typescript
export interface ToolContext {
  indexId: string;
  pdfName: string;
  markdownFiles?: Record<string, string>;  // node_id → Markdown file path
  useLLMTreeSearch?: boolean;              // Deep search mode
  scopeNodeIds?: string[];                 // Scope-locked search
  app?: App;                               // Obsidian App instance
  readingProgress?: ReadingProgress;
  sessionId?: string;
  documentMetadata?: { title?, page_count?, author? };
  docDescription?: string;                 // Book summary from router
}
```

### StateResult (State Execution Tracking)

**File:** `/Users/lizhao/workspace/DeepReader/frontend/src/agent/cognitive-engine/types.ts`

```typescript
export interface StateResult {
  success: boolean;
  timestamp: number;
  error?: string;
  duration?: number;
  innerIterations?: number;  // LLM call rounds within the state
}
```

---

## State Flow

### Complete Execution Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          FrontendAgent.chat()                           │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 1. INITIALIZATION                                                       │
│    - createToolRegistry(skillLoader, context)                          │
│    - createSharedContext({ ...params, llmClient, toolRegistry })       │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 2. COGNITIVE ENGINE (runCognitiveEngine)                                │
│                                                                         │
│    ┌──────────────────────────────────────────────────────────────┐    │
│    │ S0: Router State                                              │    │
│    │   - LLM classifies depth (0-3)                                │    │
│    │   - Rewrites to standalone query                              │    │
│    │   - Tools: none (pure classification)                         │    │
│    │   - Output: depth, standaloneQuery                            │    │
│    └──────────────────────────────────────────────────────────────┘    │
│                              │                                          │
│         ┌────────────────────┼────────────────────┐                    │
│         ▼                    ▼                    ▼                    │
│    depth=0              depth=1              depth=2/3                 │
│    (skip to S4)         │                    │                         │
│                         ▼                    ▼                         │
│    ┌──────────────────────────────────────────────────────────────┐    │
│    │ S1: Inspectional State                                        │    │
│    │   - Get TOC, lock chapter scope                               │    │
│    │   - Tools: get_toc, search_doc                                │    │
│    │   - Output: scopeNodeIds, tocSummary                          │    │
│    └──────────────────────────────────────────────────────────────┘    │
│                              │                                          │
│                              ▼ (depth=2 only)                          │
│    ┌──────────────────────────────────────────────────────────────┐    │
│    │ S2: Analytical State                                          │    │
│    │   - Deep analysis within locked scope                         │    │
│    │   - Tools: search_doc, get_chapter                            │    │
│    │   - Interceptor: scopeNodeIds enforced                        │    │
│    │   - Output: rawResults, analysisResult                        │    │
│    └──────────────────────────────────────────────────────────────┘    │
│                              │                                          │
│                              ▼                                          │
│    ┌──────────────────────────────────────────────────────────────┐    │
│    │ S4: Formatter State                                           │    │
│    │   - Transform raw data to Obsidian notes                      │    │
│    │   - Tools: none                                               │    │
│    │   - Output: streamed via onContent callback                   │    │
│    └──────────────────────────────────────────────────────────────┘    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 3. SESSION SAVE                                                         │
│    - Save user query + assistant response to chatHistory               │
│    - Discard intermediate data (scopeNodeIds, rawResults)              │
└─────────────────────────────────────────────────────────────────────────┘
```

### State Loop (Inner LLM Iterations)

Each state can run multiple LLM iterations internally via `runStateLoop`:

**File:** `/Users/lizhao/workspace/DeepReader/frontend/src/agent/cognitive-engine/states/run-state-loop.ts`

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          runStateLoop()                                  │
│                                                                         │
│  while (iterations < maxIterations):                                    │
│      │                                                                  │
│      ▼                                                                  │
│  ┌───────────────────┐                                                  │
│  │ LLM streamChat()  │ ←── messages + tools                             │
│  └─────────┬─────────┘                                                  │
│            │                                                            │
│      ┌─────┴─────┐                                                      │
│      ▼           ▼                                                      │
│  finishReason  tool_calls?                                              │
│  = 'stop'      present?                                                 │
│      │           │                                                      │
│      ▼           ▼                                                      │
│   return      ┌───────────────────┐                                     │
│               │ Execute tools     │                                     │
│               │ (parallel)        │                                     │
│               └─────────┬─────────┘                                     │
│                         │                                               │
│                         ▼                                               │
│               Add tool results to messages                              │
│                         │                                               │
│                         ▼                                               │
│               Clear accumulatedContent                                  │
│                         │                                               │
│                         └──────► loop continues                         │
│                                                                         │
│  [If maxIterations reached]                                             │
│      │                                                                  │
│      ▼                                                                  │
│  Force conclusion (no tools, just output)                               │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Error Handling Paths

1. **State Timeout**: `StateTimeoutError` thrown after configurable timeout (default 30s)
2. **State Parse Error**: `StateParseError` when JSON parsing fails (with auto-fix attempts)
3. **Tool Execution Error**: Returns error string to LLM for retry
4. **LLM Error**: Graceful degradation to fallback response
5. **Abort Signal**: Clean cancellation at any point

---

## Common Modification Scenarios

### Scenario 1: Add a New Tool

**Files to modify:**

1. Create tool file: `/Users/lizhao/workspace/DeepReader/frontend/src/agent/tools/my-tool.ts`
   ```typescript
   import type { ToolDefinition } from '../types.js';
   import type { ToolExecutor, ToolContext } from './types.js';

   const MY_TOOL_DEFINITION: ToolDefinition = {
     type: 'function',
     function: {
       name: 'my_tool',
       description: 'Description of what this tool does',
       parameters: {
         type: 'object',
         properties: {
           param1: { type: 'string', description: '...' }
         },
         required: ['param1']
       }
     }
   };

   export const myTool: ToolExecutor = {
     definition: MY_TOOL_DEFINITION,
     async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
       // Implementation
       return 'result';
     }
   };
   ```

2. Register tool: `/Users/lizhao/workspace/DeepReader/frontend/src/agent/tools/index.ts`
   ```typescript
   import { myTool } from './my-tool.js';
   // In createToolRegistry():
   registry.set('my_tool', myTool);
   ```

3. If tool should be available in specific states, update:
   - `/Users/lizhao/workspace/DeepReader/frontend/src/agent/cognitive-engine/states/inspectional.ts` (tools array)
   - `/Users/lizhao/workspace/DeepReader/frontend/src/agent/cognitive-engine/states/analytical.ts` (tools array)

### Scenario 2: Change Router Classification Logic

**Files to modify:**

1. **Prompt changes**: `/Users/lizhao/workspace/DeepReader/frontend/src/agent/cognitive-engine/prompts/router-prompt.ts`
   - Modify `PROMPT_S0_ROUTER` to change classification rules
   - Modify `depth_rules` section to add/remove depth levels

2. **Schema changes**: `/Users/lizhao/workspace/DeepReader/frontend/src/agent/cognitive-engine/states/router.ts`
   ```typescript
   const RouterOutputSchema = z.object({
     depth: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
     standalone_query: z.string().optional(),
     reason: z.string().optional(),
     // Add new fields here
   });
   ```

3. **Routing logic**: `/Users/lizhao/workspace/DeepReader/frontend/src/agent/cognitive-engine/engine.ts`
   - Modify the `switch (ctx.depth)` block to handle new depth values

### Scenario 3: Modify Output Formatting

**Files to modify:**

1. **Formatter prompt**: `/Users/lizhao/workspace/DeepReader/frontend/src/agent/cognitive-engine/prompts/formatter-prompt.ts`
   - `PROMPT_S4_FORMATTER` - system prompt for formatting
   - `buildFormatterUserMessage()` - user message construction

2. **Formatter state**: `/Users/lizhao/workspace/DeepReader/frontend/src/agent/cognitive-engine/states/formatter.ts`
   - Modify how `ctx.analysisResult` and `ctx.rawResults` are processed

3. **Wikilink format**: `/Users/lizhao/workspace/DeepReader/frontend/src/agent/context/builder.ts`
   - `buildIdentityLayer()` contains the Obsidian citation rules

### Scenario 4: Add New Memory Type

**Files to modify:**

1. **Memory store**: `/Users/lizhao/workspace/DeepReader/frontend/src/agent/memory/store.ts`
   - Add new file path (e.g., `get preferencesPath()`)
   - Add read/write methods

2. **Memory tool**: `/Users/lizhao/workspace/DeepReader/frontend/src/agent/tools/memory.ts`
   - Add new tool definition for reading/writing the new memory type

3. **Context builder**: `/Users/lizhao/workspace/DeepReader/frontend/src/agent/context/builder.ts`
   - Include new memory in `buildSystemPrompt()`

### Scenario 5: Change LLM Provider

**Files to modify:**

1. **LLM client**: `/Users/lizhao/workspace/DeepReader/frontend/src/agent/llm-client.ts`
   - Constructor accepts `baseUrl` and `model` parameters
   - `streamChat()` method handles API format
   - If new provider has different API format, modify request body in `streamChat()`

2. **Provider-specific features**:
   - For reasoning models (DeepSeek R1, Kimi K2.5): Handle `reasoning_content` in `StreamChunk`
   - For different tool calling formats: Modify `onToolCall` handling

### Scenario 6: Add New Cognitive State

**Files to modify:**

1. Create state file: `/Users/lizhao/workspace/DeepReader/frontend/src/agent/cognitive-engine/states/my-state.ts`
   ```typescript
   import { StateNode } from './base';
   import type { SharedContext } from '../types';

   export class MyState extends StateNode {
     readonly name = 'MyState';
     readonly model = 'main' as const;
     readonly tools = ['search_doc'];

     constructor() {
       super();
       this.options = { timeout: 30000, retries: 1 };
     }

     async execute(ctx: SharedContext): Promise<void> {
       // Implementation
       ctx.markStateExecuted(this.name, true, undefined, duration);
     }

     buildSystemPrompt(ctx: SharedContext): string {
       return '...';
     }
   }
   ```

2. Create prompt file: `/Users/lizhao/workspace/DeepReader/frontend/src/agent/cognitive-engine/prompts/my-state-prompt.ts`

3. Register in engine: `/Users/lizhao/workspace/DeepReader/frontend/src/agent/cognitive-engine/engine.ts`
   - Import the new state
   - Add to the execution flow

4. Export from index: `/Users/lizhao/workspace/DeepReader/frontend/src/agent/cognitive-engine/index.ts`

---

## Key File Paths Index

### Core Architecture
| File | Purpose |
|------|---------|
| `/Users/lizhao/workspace/DeepReader/frontend/src/agent/index.ts` | Main entry point, FrontendAgent class |
| `/Users/lizhao/workspace/DeepReader/frontend/src/agent/types.ts` | Core type definitions |
| `/Users/lizhao/workspace/DeepReader/frontend/src/agent/agent-loop.ts` | Legacy ReAct loop (still used by SubagentManager) |
| `/Users/lizhao/workspace/DeepReader/frontend/src/agent/llm-client.ts` | LLM streaming client |

### Cognitive Engine
| File | Purpose |
|------|---------|
| `/Users/lizhao/workspace/DeepReader/frontend/src/agent/cognitive-engine/index.ts` | Engine public API |
| `/Users/lizhao/workspace/DeepReader/frontend/src/agent/cognitive-engine/engine.ts` | Main orchestrator |
| `/Users/lizhao/workspace/DeepReader/frontend/src/agent/cognitive-engine/types.ts` | Engine-specific types |
| `/Users/lizhao/workspace/DeepReader/frontend/src/agent/cognitive-engine/context.ts` | SharedContext implementation |
| `/Users/lizhao/workspace/DeepReader/frontend/src/agent/cognitive-engine/parse.ts` | JSON parsing with auto-fix |
| `/Users/lizhao/workspace/DeepReader/frontend/src/agent/cognitive-engine/errors.ts` | Custom error classes |

### State Implementations
| File | Purpose |
|------|---------|
| `/Users/lizhao/workspace/DeepReader/frontend/src/agent/cognitive-engine/states/base.ts` | StateNode abstract class |
| `/Users/lizhao/workspace/DeepReader/frontend/src/agent/cognitive-engine/states/router.ts` | S0: Depth classification |
| `/Users/lizhao/workspace/DeepReader/frontend/src/agent/cognitive-engine/states/inspectional.ts` | S1: TOC + scope locking |
| `/Users/lizhao/workspace/DeepReader/frontend/src/agent/cognitive-engine/states/analytical.ts` | S2: Deep analysis |
| `/Users/lizhao/workspace/DeepReader/frontend/src/agent/cognitive-engine/states/formatter.ts` | S4: Output formatting |
| `/Users/lizhao/workspace/DeepReader/frontend/src/agent/cognitive-engine/states/run-state-loop.ts` | Inner LLM iteration loop |

### Prompts
| File | Purpose |
|------|---------|
| `/Users/lizhao/workspace/DeepReader/frontend/src/agent/cognitive-engine/prompts/router-prompt.ts` | S0 system prompt |
| `/Users/lizhao/workspace/DeepReader/frontend/src/agent/cognitive-engine/prompts/inspectional-prompt.ts` | S1 system prompt |
| `/Users/lizhao/workspace/DeepReader/frontend/src/agent/cognitive-engine/prompts/analytical-prompt.ts` | S2 system prompt |
| `/Users/lizhao/workspace/DeepReader/frontend/src/agent/cognitive-engine/prompts/formatter-prompt.ts` | S4 system prompt |

### Tools
| File | Purpose |
|------|---------|
| `/Users/lizhao/workspace/DeepReader/frontend/src/agent/tools/index.ts` | Tool registry creation |
| `/Users/lizhao/workspace/DeepReader/frontend/src/agent/tools/types.ts` | Tool types |
| `/Users/lizhao/workspace/DeepReader/frontend/src/agent/tools/base.ts` | BaseTool abstract class |
| `/Users/lizhao/workspace/DeepReader/frontend/src/agent/tools/search-doc.ts` | Semantic search |
| `/Users/lizhao/workspace/DeepReader/frontend/src/agent/tools/get-toc.ts` | Table of contents |
| `/Users/lizhao/workspace/DeepReader/frontend/src/agent/tools/get-chapter.ts` | Chapter content |
| `/Users/lizhao/workspace/DeepReader/frontend/src/agent/tools/write-note.ts` | Note writing |
| `/Users/lizhao/workspace/DeepReader/frontend/src/agent/tools/memory.ts` | Memory management |

### Context & Memory
| File | Purpose |
|------|---------|
| `/Users/lizhao/workspace/DeepReader/frontend/src/agent/context/builder.ts` | System prompt builder |
| `/Users/lizhao/workspace/DeepReader/frontend/src/agent/context/index.ts` | Context module exports |
| `/Users/lizhao/workspace/DeepReader/frontend/src/agent/memory/store.ts` | MEMORY.md & HISTORY.md |
| `/Users/lizhao/workspace/DeepReader/frontend/src/agent/memory/types.ts` | Memory types |

### Supporting Modules
| File | Purpose |
|------|---------|
| `/Users/lizhao/workspace/DeepReader/frontend/src/agent/router/intent-router.ts` | Regex-based intent routing |
| `/Users/lizhao/workspace/DeepReader/frontend/src/agent/subagent/manager.ts` | Sub-agent task management |
| `/Users/lizhao/workspace/DeepReader/frontend/src/agent/skills/loader.ts` | Skill file loading |
| `/Users/lizhao/workspace/DeepReader/frontend/src/agent/ui/humanized-adapter.ts` | Progress display adapter |
| `/Users/lizhao/workspace/DeepReader/frontend/src/agent/debug/logger.ts` | Debug logging |
