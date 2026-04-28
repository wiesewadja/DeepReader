# Midwife 主动引导 — 第一期实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 DeepReader 的主动阅读引导（Midwife）功能第一期——系统在用户首次打开新书时自动发起检视阅读引导，以及划线累积后章节追问。

**Architecture:** 在 LangGraph 认知引擎中新增 `isProactive` 路径，跳过 S0 Router 直接进入 S1→S4。独立的 ProactiveEngine 类负责事件监听、触发条件判断和状态持久化。新建 proactive-formatter-prompt 用于"提问模式"输出。

**Tech Stack:** TypeScript, LangGraph (@langchain/langgraph), Vitest

**Spec:** `docs/superpowers/specs/2026-04-24-midwife-proactive-guidance-design.md`

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `src/agent/proactive/types.ts` | ProactiveState, ProactiveParams, ChapterTrigger 类型定义 |
| Create | `src/agent/proactive/state.ts` | ProactiveState 的纯函数 + 持久化 I/O |
| Create | `src/agent/proactive/engine.ts` | ProactiveEngine 类：事件处理、触发判断、节流 |
| Create | `src/agent/graph/prompts/proactive-formatter-prompt.ts` | 主动引导提问模式的 prompt |
| Modify | `src/agent/graph/state.ts:22-51` | 新增 isProactive, proactiveTrigger, highlightContext 字段 |
| Modify | `src/agent/graph/edges.ts:5-47` | 新增 routeFromStart, routeAfterInspectional 增加 proactive 分支 |
| Modify | `src/agent/graph/index.ts:22-31` | 替换 START edge 为条件边 |
| Modify | `src/agent/graph/nodes/formatter.ts:97-274` | formatterNode 增加 proactive 模式分支 |
| Modify | `src/agent/index.ts:272-362` | runGraphEngine 支持 proactive 入参 |
| Modify | `src/views/sidebar-view.ts` | 接入 ProactiveEngine（章节切换、消息发送） |
| Modify | `src/main.ts:460-461` | 划线回调中通知 ProactiveEngine |
| Modify | `src/config/settings.ts:70-158` | 新增 proactiveGuidanceEnabled, proactiveCooldownMinutes |
| Test | `src/agent/proactive/__tests__/state.test.ts` | ProactiveState 纯函数测试 |
| Test | `src/agent/proactive/__tests__/engine.test.ts` | ProactiveEngine 触发逻辑测试 |
| Test | `src/agent/graph/__tests__/proactive-edges.test.ts` | Edge routing 测试 |

---

## Chunk 1: 类型定义与状态持久化

### Task 1: ProactiveState 类型定义

**Files:**
- Create: `src/agent/proactive/types.ts`

- [ ] **Step 1: 创建类型文件**

```ts
// src/agent/proactive/types.ts

/** 单个章节的触发状态 */
export interface ChapterTrigger {
  highlightCount: number;
  highlights: string[];       // 划线文本内容
  triggered: boolean;
}

/** 每本书的主动引导状态 */
export interface ProactiveState {
  version: 1;
  bookId: string;
  /** 检视引导是否已完成 */
  inspectionalDone: boolean;
  /** 各章节的触发状态 */
  chapterTriggers: Record<string, ChapterTrigger>;
  /** 上次主动提问的 ISO 时间戳 */
  lastProactiveAt: string | null;
}

/** 主动引导触发参数 */
export type ProactiveTrigger = 'inspectional' | 'highlight' | 'chapter';

export interface ProactiveParams {
  trigger: ProactiveTrigger;
  bookId: string;
  chapterId?: string;
  highlightContext?: string[];
}
```

- [ ] **Step 2: Commit**

```bash
git add src/agent/proactive/types.ts
git commit -m "feat(proactive): add ProactiveState and ProactiveParams types"
```

### Task 2: ProactiveState 纯函数与持久化

**Files:**
- Create: `src/agent/proactive/state.ts`
- Test: `src/agent/proactive/__tests__/state.test.ts`

**参考模式:** `src/pageindex/reading-progress.ts`（同级目录、相同的 fs 读写模式）

- [ ] **Step 1: 写失败的测试**

```ts
// src/agent/proactive/__tests__/state.test.ts
import { describe, it, expect } from 'vitest';
import {
  createEmptyState,
  recordHighlight,
  markChapterTriggered,
  markInspectionalDone,
  shouldTriggerInspectional,
  shouldTriggerChapter,
} from '../state';
import type { ProactiveState } from '../types';

describe('ProactiveState pure functions', () => {
  const baseState: ProactiveState = {
    version: 1,
    bookId: 'book-1',
    inspectionalDone: false,
    chapterTriggers: {},
    lastProactiveAt: null,
  };

  describe('createEmptyState', () => {
    it('creates empty state with bookId', () => {
      const state = createEmptyState('book-1');
      expect(state.bookId).toBe('book-1');
      expect(state.inspectionalDone).toBe(false);
      expect(state.chapterTriggers).toEqual({});
      expect(state.lastProactiveAt).toBeNull();
    });
  });

  describe('recordHighlight', () => {
    it('adds highlight to new chapter', () => {
      const next = recordHighlight(baseState, 'ch-1', 'some text');
      expect(next.chapterTriggers['ch-1'].highlightCount).toBe(1);
      expect(next.chapterTriggers['ch-1'].highlights).toEqual(['some text']);
      expect(next.chapterTriggers['ch-1'].triggered).toBe(false);
    });

    it('appends highlight to existing chapter', () => {
      const s1 = recordHighlight(baseState, 'ch-1', 'text a');
      const s2 = recordHighlight(s1, 'ch-1', 'text b');
      expect(s2.chapterTriggers['ch-1'].highlightCount).toBe(2);
      expect(s2.chapterTriggers['ch-1'].highlights).toEqual(['text a', 'text b']);
    });

    it('does not add highlight to triggered chapter', () => {
      const s1 = recordHighlight(baseState, 'ch-1', 'text a');
      const s2 = markChapterTriggered(s1, 'ch-1');
      const s3 = recordHighlight(s2, 'ch-1', 'text b');
      // count stays at 1, no new highlight added
      expect(s3.chapterTriggers['ch-1'].highlightCount).toBe(1);
    });
  });

  describe('shouldTriggerInspectional', () => {
    it('returns true when not done and no history', () => {
      expect(shouldTriggerInspectional(baseState, false, 0)).toBe(true);
    });

    it('returns false when already done', () => {
      const done = markInspectionalDone(baseState);
      expect(shouldTriggerInspectional(done, false, 0)).toBe(false);
    });

    it('returns false when has conversation history', () => {
      expect(shouldTriggerInspectional(baseState, true, 0)).toBe(false);
    });

    it('returns false when progress >= 10%', () => {
      expect(shouldTriggerInspectional(baseState, false, 15)).toBe(false);
    });
  });

  describe('shouldTriggerChapter', () => {
    it('returns true when highlights >= 2 and not triggered', () => {
      const s = recordHighlight(recordHighlight(baseState, 'ch-1', 'a'), 'ch-1', 'b');
      const result = shouldTriggerChapter(s, 'ch-1');
      expect(result.canTrigger).toBe(true);
      expect(result.highlights).toEqual(['a', 'b']);
    });

    it('returns false when already triggered', () => {
      const s = markChapterTriggered(
        recordHighlight(recordHighlight(baseState, 'ch-1', 'a'), 'ch-1', 'b'),
        'ch-1'
      );
      expect(shouldTriggerChapter(s, 'ch-1').canTrigger).toBe(false);
    });

    it('returns false when highlights < 2', () => {
      const s = recordHighlight(baseState, 'ch-1', 'a');
      expect(shouldTriggerChapter(s, 'ch-1').canTrigger).toBe(false);
    });

    it('returns false for unknown chapter', () => {
      expect(shouldTriggerChapter(baseState, 'ch-unknown').canTrigger).toBe(false);
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/agent/proactive/__tests__/state.test.ts`
Expected: FAIL — modules not found

- [ ] **Step 3: 实现纯函数**

```ts
// src/agent/proactive/state.ts
import * as path from 'path';
import * as fs from 'fs/promises';
import type { ProactiveState, ChapterTrigger } from './types';
import { serviceLog as log } from '../../utils/logger.js';

// ============ Pure Functions ============

export function createEmptyState(bookId: string): ProactiveState {
  return {
    version: 1,
    bookId,
    inspectionalDone: false,
    chapterTriggers: {},
    lastProactiveAt: null,
  };
}

export function recordHighlight(
  state: ProactiveState,
  chapterId: string,
  content: string,
): ProactiveState {
  const existing = state.chapterTriggers[chapterId];
  if (existing?.triggered) return state;

  const trigger: ChapterTrigger = existing
    ? { ...existing, highlightCount: existing.highlightCount + 1, highlights: [...existing.highlights, content] }
    : { highlightCount: 1, highlights: [content], triggered: false };

  return {
    ...state,
    chapterTriggers: { ...state.chapterTriggers, [chapterId]: trigger },
  };
}

export function markChapterTriggered(state: ProactiveState, chapterId: string): ProactiveState {
  const existing = state.chapterTriggers[chapterId];
  if (!existing) return state;
  return {
    ...state,
    chapterTriggers: {
      ...state.chapterTriggers,
      [chapterId]: { ...existing, triggered: true },
    },
  };
}

export function markInspectionalDone(state: ProactiveState): ProactiveState {
  return { ...state, inspectionalDone: true };
}

export function updateLastProactiveAt(state: ProactiveState): ProactiveState {
  return { ...state, lastProactiveAt: new Date().toISOString() };
}

export function shouldTriggerInspectional(
  state: ProactiveState,
  hasHistory: boolean,
  progressPercent: number,
): boolean {
  if (state.inspectionalDone) return false;
  if (hasHistory) return false;
  if (progressPercent >= 10) return false;
  return true;
}

export function shouldTriggerChapter(
  state: ProactiveState,
  chapterId: string,
): { canTrigger: boolean; highlights: string[] } {
  const trigger = state.chapterTriggers[chapterId];
  if (!trigger || trigger.triggered) return { canTrigger: false, highlights: [] };
  if (trigger.highlightCount < 2) return { canTrigger: false, highlights: [] };
  return { canTrigger: true, highlights: trigger.highlights };
}

// ============ File I/O ============

function getStateFilePath(baseDir: string, bookId: string): string {
  return path.join(baseDir, '.pageindex', bookId, 'proactive-state.json');
}

export async function loadProactiveState(baseDir: string, bookId: string): Promise<ProactiveState | null> {
  const filePath = getStateFilePath(baseDir, bookId);
  try {
    const data = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(data);
    if (parsed.version !== 1) return null;
    return parsed as ProactiveState;
  } catch {
    return null;
  }
}

export async function saveProactiveState(baseDir: string, state: ProactiveState): Promise<void> {
  const filePath = getStateFilePath(baseDir, state.bookId);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(state, null, 2), 'utf-8');
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/agent/proactive/__tests__/state.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agent/proactive/state.ts src/agent/proactive/__tests__/state.test.ts
git commit -m "feat(proactive): add ProactiveState pure functions with persistence"
```

---

## Chunk 2: Graph 层改动

### Task 3: Graph State 扩展

**Files:**
- Modify: `src/agent/graph/state.ts:22-51`

- [ ] **Step 1: 新增 proactive 字段到 CognitiveEngineAnnotation**

在 `state.ts` 的 `CognitiveEngineAnnotation` 中，在 `pdfName`（第 50 行）后面、闭合 `});` 之前追加：

```ts
// src/agent/graph/state.ts — 在 pdfName 行后追加

  // === Proactive guidance ===
  isProactive: Annotation<boolean>(),
  proactiveTrigger: Annotation<string>(),
  highlightContext: Annotation<string[]>(),
```

- [ ] **Step 2: 运行构建确认无类型错误**

Run: `npm run build`
Expected: 编译通过（新字段默认 undefined，不影响现有逻辑）

- [ ] **Step 3: Commit**

```bash
git add src/agent/graph/state.ts
git commit -m "feat(proactive): add isProactive, proactiveTrigger, highlightContext to graph state"
```

### Task 4: Edge routing 改动

**Files:**
- Modify: `src/agent/graph/edges.ts`
- Test: `src/agent/graph/__tests__/proactive-edges.test.ts`

- [ ] **Step 1: 写失败的测试**

```ts
// src/agent/graph/__tests__/proactive-edges.test.ts
import { describe, it, expect } from 'vitest';
import { routeFromStart, routeByDepth, routeAfterInspectional } from '../edges';

describe('proactive edge routing', () => {
  describe('routeFromStart', () => {
    it('routes to inspectional when isProactive=true', () => {
      const state = { isProactive: true, depth: 1 } as any;
      expect(routeFromStart(state)).toBe('inspectional');
    });

    it('routes to router when isProactive=false', () => {
      const state = { isProactive: false } as any;
      expect(routeFromStart(state)).toBe('router');
    });

    it('routes to router when isProactive is undefined', () => {
      const state = {} as any;
      expect(routeFromStart(state)).toBe('router');
    });
  });

  describe('routeAfterInspectional — proactive', () => {
    it('routes to done when isProactive=true', () => {
      const state = { isProactive: true, depth: 1, structuralAnalysis: '...' } as any;
      expect(routeAfterInspectional(state)).toBe('done');
    });

    it('routes to done even at depth=2 when isProactive=true', () => {
      const state = { isProactive: true, depth: 2 } as any;
      expect(routeAfterInspectional(state)).toBe('done');
    });
  });

  describe('routeByDepth — unchanged', () => {
    it('still routes depth=0 to formatter', () => {
      const state = { depth: 0 } as any;
      expect(routeByDepth(state)).toBe('formatter');
    });

    it('still routes depth>=1 to inspectional', () => {
      const state = { depth: 2 } as any;
      expect(routeByDepth(state)).toBe('inspectional');
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/agent/graph/__tests__/proactive-edges.test.ts`
Expected: FAIL — `routeFromStart` is not exported

- [ ] **Step 3: 修改 edges.ts**

```ts
// src/agent/graph/edges.ts — 新增 routeFromStart，修改 routeAfterInspectional

import type { CognitiveEngineState } from './state';

function hasDiagramIntent(state: CognitiveEngineState): boolean {
  return (state.allowedTools ?? []).includes('excalidraw');
}

/**
 * Route from START node.
 * - isProactive: skip router, go directly to inspectional
 * - otherwise: go to router (normal flow)
 */
export function routeFromStart(state: CognitiveEngineState): string {
  if (state.isProactive) return 'inspectional';
  return 'router';
}

/**
 * Route after S0 Router based on classified depth. (unchanged)
 */
export function routeByDepth(state: CognitiveEngineState): string {
  if (state.depth === 0) return 'formatter';
  return 'inspectional';
}

/**
 * Route after S1 Inspectional.
 */
export function routeAfterInspectional(state: CognitiveEngineState): string {
  // Proactive: skip S2/S3/visualizer, go straight to formatter
  // 'done' 在 index.ts 的映射表中对应 'formatter' 节点
  if (state.isProactive) return 'done';

  if (state.depth === 3) return 'syntopical';
  if (state.depth === 1 && state.structuralAnalysis) {
    return hasDiagramIntent(state) ? 'visualizer' : 'done';
  }
  return 'continue';
}

/**
 * Route after S2 Analytical or S3 Syntopical.
 */
export function routeAfterAnalysis(state: CognitiveEngineState): string {
  return hasDiagramIntent(state) ? 'visualizer' : 'formatter';
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/agent/graph/__tests__/proactive-edges.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agent/graph/edges.ts src/agent/graph/__tests__/proactive-edges.test.ts
git commit -m "feat(proactive): add routeFromStart edge and proactive branch in routeAfterInspectional"
```

### Task 5: Graph 入口 edge 替换

**Files:**
- Modify: `src/agent/graph/index.ts`

- [ ] **Step 1: 替换 START edge 为条件边**

```ts
// src/agent/graph/index.ts

// 修改 import 行（第22行）:
import { routeFromStart, routeByDepth, routeAfterInspectional, routeAfterAnalysis } from './edges';

// 替换第31行的无条件边:
// .addEdge(START, 'router')
// 改为:
.addConditionalEdges(START, routeFromStart, {
  router: 'router',
  inspectional: 'inspectional',
})
```

- [ ] **Step 2: 运行构建确认无类型错误**

Run: `npm run build`
Expected: 编译通过，无 TS 错误

- [ ] **Step 3: Commit**

```bash
git add src/agent/graph/index.ts
git commit -m "feat(proactive): replace START edge with conditional routing for proactive path"
```

---

## Chunk 3: Prompt 与 Formatter 改动

### Task 6: Proactive Formatter Prompt

**Files:**
- Create: `src/agent/graph/prompts/proactive-formatter-prompt.ts`

- [ ] **Step 1: 创建 prompt 文件**

```ts
// src/agent/graph/prompts/proactive-formatter-prompt.ts

const PROACTIVE_FORMATTER_SYSTEM = `<role>
你是奚童，用户的阅读伙伴。你现在不是在回答问题，而是在引导用户主动思考。你是"助产士"角色——通过提问帮助用户自己生出理解。
</role>

<rules>
1. 基于提供的结构分析，提出**一个**具体的问题。不要给出答案或总结
2. 问题必须让用户思考才能回答，不能用"是/否"敷衍
3. 问题必须锚定在书的具体章节、概念或论证结构上，不能泛泛而谈
4. 语气自然、温暖，像朋友在聊天中随口问了一句，不像老师在考试
5. 回复不超过 3 句话。简短有力
6. 不要用"你觉得"开头（太模板化），用更自然的方式引出问题
</rules>`;

const PROACTIVE_FORMATTER_SYSTEM_HIGHLIGHT = `<role>
你是奚童，用户的阅读伙伴。你现在不是在回答问题，而是在引导用户主动思考。你是"助产士"角色——通过提问帮助用户自己生出理解。
</role>

<rules>
1. 基于用户划线的内容，提出**一个**追问。不要总结划线内容
2. 问题要挖掘用户为什么划这些内容——它戳到了用户的什么经历、假设或困惑
3. 如果多条划线之间有关联或张力，指出这种关系并追问
4. 语气自然、温暖，像朋友在聊天中随口问了一句
5. 回复不超过 3 句话。简短有力
6. 不要用"你觉得"开头（太模板化），用更自然的方式引出问题
</rules>`;

export function buildProactiveSystemPrompt(trigger: 'inspectional' | 'highlight' | 'chapter'): string {
  if (trigger === 'inspectional') return PROACTIVE_FORMATTER_SYSTEM;
  return PROACTIVE_FORMATTER_SYSTEM_HIGHLIGHT;
}

export function buildProactiveUserMessage(params: {
  structuralAnalysis?: string;
  tocSummary?: string;
  highlightContext?: string[];
  bookName: string;
}): string {
  const parts: string[] = [];

  if (params.structuralAnalysis) {
    parts.push(`<structural_analysis>\n${params.structuralAnalysis}\n</structural_analysis>`);
  }
  if (params.tocSummary) {
    parts.push(`<toc>\n${params.tocSummary}\n</toc>`);
  }
  if (params.highlightContext && params.highlightContext.length > 0) {
    parts.push(`<user_highlights>\n${params.highlightContext.map((h, i) => `${i + 1}. ${h}`).join('\n')}\n</user_highlights>`);
  }
  parts.push(`<book>${params.bookName}</book>`);

  return parts.join('\n\n');
}
```

- [ ] **Step 2: Commit**

```bash
git add src/agent/graph/prompts/proactive-formatter-prompt.ts
git commit -m "feat(proactive): add proactive formatter prompt for questioning mode"
```

### Task 7: Formatter Node 增加 proactive 分支

**Files:**
- Modify: `src/agent/graph/nodes/formatter.ts`

在 `formatterNode` 函数中，在 depth=0 casual mode 之前（约第112行），插入 proactive mode 分支。

- [ ] **Step 1: 添加 proactive mode 分支**

在 `formatter.ts` 的 `formatterNode` 函数中，在 `if (!mainModel)` 检查之后、`if (state.depth === 0)` 之前插入：

```ts
// formatter.ts — 在 depth=0 分支之前插入

import {
  buildProactiveSystemPrompt,
  buildProactiveUserMessage,
} from '../prompts/proactive-formatter-prompt';

// ... 在 formatterNode 函数中，第 112 行之后：

  // === Proactive mode: ask a question, don't answer ===
  if (state.isProactive) {
    const trigger = (state.proactiveTrigger || 'inspectional') as 'inspectional' | 'highlight' | 'chapter';
    callbacks?.onProgress?.('思考中...');
    const proactivePrompt = buildProactiveSystemPrompt(trigger);
    const proactiveUserMsg = buildProactiveUserMessage({
      structuralAnalysis: state.structuralAnalysis || undefined,
      tocSummary: state.tocSummary || undefined,
      highlightContext: state.highlightContext || undefined,
      bookName: state.pdfName || '',
    });
    const stream = await mainModel.stream([
      new SystemMessage(proactivePrompt),
      new HumanMessage(proactiveUserMsg),
    ], config);

    let content = '';
    for await (const chunk of stream) {
      if (typeof chunk.content === 'string') {
        content += chunk.content;
        callbacks?.onContent?.(content);
      }
    }

    return { formattedOutput: stripThinkTags(content) };
  }
```

- [ ] **Step 2: 运行构建确认无类型错误**

Run: `npm run build`
Expected: 编译通过

- [ ] **Step 3: Commit**

```bash
git add src/agent/graph/nodes/formatter.ts
git commit -m "feat(proactive): add proactive questioning mode to formatter node"
```

---

## Chunk 4: ProactiveEngine

### Task 8: ProactiveEngine 实现

**Files:**
- Create: `src/agent/proactive/engine.ts`
- Test: `src/agent/proactive/__tests__/engine.test.ts`

- [ ] **Step 1: 写失败的测试**

```ts
// src/agent/proactive/__tests__/engine.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProactiveEngine } from '../engine';
import type { ProactiveParams } from '../types';

describe('ProactiveEngine', () => {
  let triggered: ProactiveParams[];
  let engine: ProactiveEngine;

  beforeEach(() => {
    triggered = [];
    engine = new ProactiveEngine(
      { vault: { adapter: { basePath: '/tmp/test-vault' } } } as any,
      { proactiveGuidanceEnabled: true, proactiveCooldownMinutes: 5 } as any,
      (params) => { triggered.push(params); },
    );
  });

  // 注意：所有 async 方法必须 await，否则断言时序不可靠

  describe('场景一：检视引导', () => {
    it('triggers inspectional on first book open with no history', async () => {
      await engine.onBookOpen('book-1', false, 0);
      expect(triggered).toHaveLength(1);
      expect(triggered[0].trigger).toBe('inspectional');
      expect(triggered[0].bookId).toBe('book-1');
    });

    it('does not trigger when has history', async () => {
      await engine.onBookOpen('book-1', true, 0);
      expect(triggered).toHaveLength(0);
    });

    it('does not trigger when progress >= 10%', async () => {
      await engine.onBookOpen('book-1', false, 15);
      expect(triggered).toHaveLength(0);
    });

    it('does not trigger twice for same book', async () => {
      await engine.onBookOpen('book-1', false, 0);
      await engine.onBookOpen('book-1', false, 0);
      expect(triggered).toHaveLength(1);
    });
  });

  describe('场景二：划线追问', () => {
    it('does not trigger with < 2 highlights', async () => {
      await engine.onHighlight('book-1', 'ch-1', 'text a');
      await engine.onChapterLeave('book-1', 'ch-1');
      expect(triggered).toHaveLength(0);
    });

    it('triggers on chapter leave with >= 2 highlights', async () => {
      await engine.onHighlight('book-1', 'ch-1', 'text a');
      await engine.onHighlight('book-1', 'ch-1', 'text b');
      await engine.onChapterLeave('book-1', 'ch-1');
      expect(triggered).toHaveLength(1);
      expect(triggered[0].trigger).toBe('chapter');
      expect(triggered[0].highlightContext).toEqual(['text a', 'text b']);
    });

    it('triggers in-chapter with >= 3 highlights', async () => {
      await engine.onHighlight('book-1', 'ch-1', 'text a');
      await engine.onHighlight('book-1', 'ch-1', 'text b');
      await engine.onHighlight('book-1', 'ch-1', 'text c');
      expect(triggered).toHaveLength(1);
      expect(triggered[0].trigger).toBe('highlight');
    });

    it('does not trigger twice for same chapter', async () => {
      await engine.onHighlight('book-1', 'ch-1', 'text a');
      await engine.onHighlight('book-1', 'ch-1', 'text b');
      await engine.onHighlight('book-1', 'ch-1', 'text c');
      // 已经触发了，再划也不会再触发
      await engine.onChapterLeave('book-1', 'ch-1');
      expect(triggered).toHaveLength(1);
    });
  });

  describe('节流', () => {
    it('respects global cooldown', async () => {
      await engine.onBookOpen('book-1', false, 0); // 触发检视引导
      // 立即尝试另一个触发
      await engine.onHighlight('book-2', 'ch-1', 'a');
      await engine.onHighlight('book-2', 'ch-1', 'b');
      await engine.onChapterLeave('book-2', 'ch-1');
      // 冷却时间内，不触发
      expect(triggered).toHaveLength(1);
    });
  });

  describe('设置开关', () => {
    it('does not trigger when disabled', async () => {
      const disabledEngine = new ProactiveEngine(
        {} as any,
        { proactiveGuidanceEnabled: false, proactiveCooldownMinutes: 5 } as any,
        (params) => { triggered.push(params); },
      );
      await disabledEngine.onBookOpen('book-1', false, 0);
      expect(triggered).toHaveLength(0);
    });
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/agent/proactive/__tests__/engine.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现 ProactiveEngine**

```ts
// src/agent/proactive/engine.ts
import type { App } from 'obsidian';
import type { ProactiveState, ProactiveParams } from './types';
import {
  createEmptyState,
  recordHighlight,
  markChapterTriggered,
  markInspectionalDone,
  updateLastProactiveAt,
  shouldTriggerInspectional,
  shouldTriggerChapter,
  loadProactiveState,
  saveProactiveState,
} from './state';
import type { DeepPDFSettings } from '../../config/settings.js';

export class ProactiveEngine {
  private states = new Map<string, ProactiveState>();
  private processing = false;

  constructor(
    private app: App,
    private settings: DeepPDFSettings,
    private onTrigger: (params: ProactiveParams) => void,
  ) {}

  private async getState(bookId: string): Promise<ProactiveState> {
    let state = this.states.get(bookId);
    if (!state) {
      const baseDir = (this.app.vault.adapter as any).basePath as string;
      state = (await loadProactiveState(baseDir, bookId)) ?? createEmptyState(bookId);
      this.states.set(bookId, state);
    }
    return state;
  }

  private async persistState(state: ProactiveState): Promise<void> {
    this.states.set(state.bookId, state);
    const baseDir = (this.app.vault.adapter as any).basePath as string;
    await saveProactiveState(baseDir, state);
  }

  private isInCooldown(state: ProactiveState): boolean {
    if (!state.lastProactiveAt) return false;
    const elapsed = Date.now() - new Date(state.lastProactiveAt).getTime();
    return elapsed < (this.settings.proactiveCooldownMinutes ?? 5) * 60 * 1000;
  }

  /** 计算 trigger 后的新 state（不调用 onTrigger） */
  private prepareTriggerState(params: ProactiveParams, state: ProactiveState): ProactiveState {
    let next = updateLastProactiveAt(state);
    if (params.trigger === 'inspectional') {
      next = markInspectionalDone(next);
    } else if (params.chapterId) {
      next = markChapterTriggered(next, params.chapterId);
    }
    return next;
  }

  async onBookOpen(bookId: string, hasHistory: boolean, progressPercent: number): Promise<void> {
    if (!this.settings.proactiveGuidanceEnabled) return;
    if (this.processing) return;

    const state = await this.getState(bookId);
    if (!shouldTriggerInspectional(state, hasHistory, progressPercent)) return;
    if (this.isInCooldown(state)) return;

    const params: ProactiveParams = { trigger: 'inspectional', bookId };
    const next = this.prepareTriggerState(params, state);
    await this.persistState(next);
    this.onTrigger(params);
  }

  async onHighlight(bookId: string, chapterId: string, content: string): Promise<void> {
    if (!this.settings.proactiveGuidanceEnabled) return;
    if (this.processing) return;

    let state = await this.getState(bookId);
    state = recordHighlight(state, chapterId, content);
    await this.persistState(state);

    // 条件 B：章节内累积 >= 3 条划线
    const trigger = state.chapterTriggers[chapterId];
    if (trigger && !trigger.triggered && trigger.highlightCount >= 3 && !this.isInCooldown(state)) {
      const params: ProactiveParams = {
        trigger: 'highlight',
        bookId,
        chapterId,
        highlightContext: trigger.highlights,
      };
      const next = this.prepareTriggerState(params, state);
      await this.persistState(next);
      this.onTrigger(params);
    }
  }

  async onChapterLeave(bookId: string, chapterId: string): Promise<void> {
    if (!this.settings.proactiveGuidanceEnabled) return;
    if (this.processing) return;

    const state = await this.getState(bookId);
    const { canTrigger, highlights } = shouldTriggerChapter(state, chapterId);
    if (!canTrigger || this.isInCooldown(state)) return;

    const params: ProactiveParams = {
      trigger: 'chapter',
      bookId,
      chapterId,
      highlightContext: highlights,
    };
    const next = this.prepareTriggerState(params, state);
    await this.persistState(next);
    this.onTrigger(params);
  }

  onChapterEnter(_bookId: string, _chapterId: string): void {
    // 预留：当前不需要在进入章节时做任何事
  }

  onUserMessage(): void {
    // 预留：冷却计时豁免（第二期实现）
  }

  /** 标记正在处理 LLM 请求，防止重入 */
  setProcessing(value: boolean): void {
    this.processing = value;
  }

  destroy(): void {
    this.states.clear();
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run src/agent/proactive/__tests__/engine.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agent/proactive/engine.ts src/agent/proactive/__tests__/engine.test.ts
git commit -m "feat(proactive): implement ProactiveEngine with trigger logic and throttling"
```

---

## Chunk 5: 接入层

### Task 9: runGraphEngine 支持 proactive 入参

**Files:**
- Modify: `src/agent/index.ts`

- [ ] **Step 1: 新增 runProactiveGuidance 方法**

在 `FrontendAgent` 类中新增方法，复用 `buildGraphConfigurable` 但传入不同的初始 state：

```ts
// src/agent/index.ts — 在 runGraphEngine 方法之后新增

async runProactiveGuidance(
  context: ToolContext,
  callbacks: AgentLoopOptions,
  chatHistory: ChatMessage[],
  params: ProactiveParams,
): Promise<{ messages: ChatMessage[] }> {
  await this.initialize();

  const rawQuery = params.trigger === 'inspectional'
    ? '请对这本书做检视阅读引导'
    : `用户在阅读中划了以下内容，请追问：\n${(params.highlightContext || []).join('\n')}`;

  const threadId = `proactive-${context.indexId || Date.now()}`;
  const { _langsmithTracer: tracer, ...configurable } = await this.buildGraphConfigurable(
    context, callbacks, threadId, rawQuery, chatHistory,
  );

  const initialMessages = [new HumanMessage(rawQuery)];

  const stream = await this.getCompiledEngine().stream({
    messages: initialMessages,
    bookId: context.indexId || '',
    pdfName: context.pdfName || '',
    isProactive: true,
    proactiveTrigger: params.trigger,
    highlightContext: params.highlightContext || [],
    depth: 1,
  }, {
    streamMode: 'updates',
    configurable,
    signal: callbacks.abortSignal,
    ...(tracer ? { callbacks: [tracer] } : {}),
  });

  return this.processGraphStream(stream, callbacks, { configurable });
}
```

注意：
- 需要 import `ProactiveParams` 类型（`import type { ProactiveParams } from './proactive/types'`）
- `processGraphStream` 第三个参数是 `{ configurable }`（不是 `context`）——函数签名期望 `{ configurable?: Record<string, any> }`
- `buildGraphConfigurable` 返回值含 `_langsmithTracer`，必须解构掉再作为 configurable 传入
- 传入 `rawQuery` 而非 `undefined`，确保 `createSharedContext` 的 `rawUserQuery` 字段非空

- [ ] **Step 2: 运行构建确认无类型错误**

Run: `npm run build`
Expected: 编译通过

- [ ] **Step 3: Commit**

```bash
git add src/agent/index.ts
git commit -m "feat(proactive): add runProactiveGuidance method to FrontendAgent"
```

### Task 10: Settings 新增字段

**Files:**
- Modify: `src/config/settings.ts`

- [ ] **Step 1: 在 DeepPDFSettings interface 中新增字段**

在 `langsmithEnabled` 之后、deprecated 字段之前追加：

```ts
// src/config/settings.ts — 在 langsmithEnabled 行后追加

  // Proactive guidance settings
  proactiveGuidanceEnabled: boolean;
  proactiveCooldownMinutes: number;
```

- [ ] **Step 2: 在 DEFAULT_SETTINGS 中追加默认值**

```ts
  proactiveGuidanceEnabled: true,
  proactiveCooldownMinutes: 5,
```

- [ ] **Step 3: Commit**

```bash
git add src/config/settings.ts
git commit -m "feat(proactive): add proactive guidance settings with defaults"
```

**注意**：第一期不在设置 UI 中渲染这两个字段。用户需要手动编辑 `.obsidian/plugins/deepreader/data.json` 修改。设置 UI 的渲染留到第二期（需要新增设置 tab section）。默认值 `enabled: true, cooldown: 5` 对绝大多数用户合理。

**Files:**
- Modify: `src/views/sidebar-view.ts`

这是改动最复杂的接入步骤。需要：
1. 新增 `proactiveEngine` 和 `currentChapterId` 实例变量
2. 在 `trackReadingProgress` 中检测章节变化
3. 在书籍初始化时调用 `onBookOpen`
4. 在 `sendMessage` 中调用 `onUserMessage`
5. 处理 `onTrigger` 回调：调用 `runProactiveGuidance` 并将结果插入对话流

- [ ] **Step 1: 新增实例变量**

在 sidebar-view 类的字段声明区（约第 107 行 `readingProgress` 附近）新增：

```ts
private currentChapterId: string | null = null;
private proactiveEngine: ProactiveEngine | null = null;
```

- [ ] **Step 2: 初始化 ProactiveEngine**

在 sidebar-view 的 `initializeFrontendAgent()` 方法（line 126）中，在 `this.frontendAgent = agent` 之后初始化 engine：

```ts
// 在 initializeFrontendAgent() 中，this.frontendAgent = agent 之后
this.proactiveEngine = new ProactiveEngine(
  this.app,
  this.plugin.settings,
  async (params) => {
    if (!this.frontendAgent || !this.messageList) return;
    this.proactiveEngine?.setProcessing(true);
    try {
      // 创建 AI 消息占位（参考 sendMessage 中行 2246-2263 的模式）
      const aiMessageId = `proactive-${Date.now()}`;
      const aiMessageData: MessageData = {
        id: aiMessageId,
        role: "assistant" as MessageRole,
        content: "",
        timestamp: new Date().toISOString(),
        isStreaming: true,
        isAgentMessage: true,
        currentStatus: '思考中...',
        pdfName: this.currentPdfName || undefined,
        conversationId: this.sessionId || undefined,
        bookCoverUrl: this.currentBookCoverUrl || undefined,
        bookAuthor: this.currentBookAuthor || undefined,
      };
      this.messageList.addMessage(aiMessageData);

      // 构建 ToolContext（参考 sendMessage 中行 2392-2418 的模式）
      const context: ToolContext = {
        indexId: this.currentIndexId || '',
        pdfName: this.currentPdfName || '未知文档',
        markdownFiles: this.currentMarkdownFiles,
        app: this.app,
        plugin: this.plugin,
        currentNodeId: this.currentChapterId || undefined,
        documentMetadata: { title: this.currentPdfName || '未知文档' },
      };

      const callbacks = {
        onContent: (content: string) => {
          this.messageList?.updateMessage(aiMessageId, { content });
        },
        onProgress: (msg: string) => {
          this.messageList?.updateMessage(aiMessageId, { currentStatus: msg });
        },
      };
      const result = await this.frontendAgent.runProactiveGuidance(
        context, callbacks, this.agentChatHistory, params,
      );
      // 将结果加入对话历史
      const assistantContent = result.messages[0]?.content || '';
      this.agentChatHistory = [
        ...this.agentChatHistory,
        { role: 'assistant', content: assistantContent },
      ];
      // 标记消息流式完成
      this.messageList?.updateMessage(aiMessageId, {
        isStreaming: false,
        content: assistantContent,
      });
    } finally {
      this.proactiveEngine?.setProcessing(false);
    }
  },
);
```

注意：需要 import `MessageData` 和 `MessageRole` 类型，以及 `ToolContext` 类型。

- [ ] **Step 3: 修改 trackReadingProgress — 检测章节切换 + 离开书籍**

在 `trackReadingProgress()` 中需要做两处改动：

**改动 A**：函数开头（line 1158 的 early return 之前）增加"离开书籍"检测。

当前 `trackReadingProgress` 在 `!activeFile.path.startsWith(bookPath)` 时直接 return，此时不会触发 `onChapterLeave`。用户从章节 A（有 2 条划线）跳到其他书或 vault 文件时，leave 事件丢失。

```ts
// 在 trackReadingProgress() 函数体内，所有现有逻辑之前插入：

// === Proactive: 检测离开整本书 ===
// 如果之前有章节在读，但当前文件不属于这本书 → 触发 leave
const bookPath = `DeepReader/${this.currentPdfName}/`;
if (this.currentChapterId && this.readingProgress) {
  const activeFile = this.app.workspace.getActiveFile();
  if (!activeFile || !activeFile.path.startsWith(bookPath)) {
    this.proactiveEngine?.onChapterLeave(
      this.readingProgress.bookId, this.currentChapterId,
    );
    this.currentChapterId = null;
  }
}
```

**改动 B**：在获取 `chapterId` 之后、`markChapterVisited` 之前，插入章节内切换检测：

```ts
// 在获取 chapterId 之后、markChapterVisited 之前
const prevChapterId = this.currentChapterId;
this.currentChapterId = chapterId;

if (prevChapterId && prevChapterId !== chapterId) {
  this.proactiveEngine?.onChapterLeave(
    this.readingProgress!.bookId, prevChapterId,
  );
}
this.proactiveEngine?.onChapterEnter(
  this.readingProgress!.bookId, chapterId,
);
```

这样改动 A 覆盖"离开整本书"的场景，改动 B 覆盖"同书内章节切换"的场景。

- [ ] **Step 4: 书籍初始化时触发检视引导**

在 `initReadingProgress()` 方法（line 1136）的末尾，`log` 语句之后调用：

```ts
// 在 initReadingProgress() 末尾
const hasHistory = this.agentChatHistory.filter(m => m.role === 'user').length > 0;
const totalChapters = this.getTotalChapters();
const progressPercent = getProgressPercent(this.readingProgress, totalChapters);
this.proactiveEngine?.onBookOpen(indexId, hasHistory, progressPercent);
```

注意：`getProgressPercent` 和 `getTotalChapters` 已在 sidebar-view 中定义，无需额外 import。

- [ ] **Step 5: sendMessage 中调用 onUserMessage**

在 `sendMessage()` 方法开头调用：

```ts
this.proactiveEngine?.onUserMessage();
```

- [ ] **Step 6: 运行构建确认无类型错误**

Run: `npm run build`
Expected: 编译通过（可能有 TS 小错误需要根据实际代码调整）

- [ ] **Step 7: Commit**

```bash
git add src/views/sidebar-view.ts
git commit -m "feat(proactive): integrate ProactiveEngine into sidebar-view"
```

### Task 12: main.ts 划线回调接入

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: 在 onSaveHighlight 回调中通知 ProactiveEngine**

在 `readingModeCallbacks`（行 460）中扩展 `onSaveHighlight`。由于 `onSaveHighlight` 回调中没有 `chapterId` 参数，需要从当前活动文件推断。但 `main.ts` 没有直接的 `currentIndexId`，需要通过 sidebar-view 获取。

最简方案：通过 sidebar-view 暴露一个 public 方法来代理调用。

```ts
// sidebar-view.ts 新增 public 方法：
public async notifyHighlight(text: string): Promise<void> {
  if (!this.currentIndexId || !this.currentChapterId) return;
  this.proactiveEngine?.onHighlight(this.currentIndexId, this.currentChapterId, text);
}
```

然后在 main.ts 的回调中：
```ts
onSaveHighlight: async (text: string, color: HighlightColorId) => {
  await this.saveHighlightToFile(text, color);
  // 通知 ProactiveEngine
  const sidebar = this.sidebarView;
  if (sidebar) {
    await sidebar.notifyHighlight(text);
  }
},
```

- [ ] **Step 2: 运行构建确认无类型错误**

Run: `npm run build`
Expected: 编译通过

- [ ] **Step 3: Commit**

```bash
git add src/main.ts
git commit -m "feat(proactive): notify ProactiveEngine on highlight events"
```

---

## Chunk 6: 集成测试与收尾

### Task 13: 端到端手动测试

- [ ] **Step 1: 构建并部署到 test-vault**

Run: `npm run deploy`

- [ ] **Step 2: 在 Obsidian 中测试场景一**

1. 打开一本从未读过的书（无对话记录）
2. 确认侧边栏自动出现一条奚童的引导问题
3. 确认问题锚定在书的章节结构上
4. 关闭后重新打开同一本书，确认不重复触发

- [ ] **Step 3: 在 Obsidian 中测试场景二**

1. 打开一本书的某个章节
2. 用高亮工具划 2 条线
3. 翻到下一章节
4. 确认侧边栏出现一条基于划线内容的追问
5. 回到原章节再划线，确认不重复触发

- [ ] **Step 4: 测试设置开关**

1. 关闭"主动阅读引导"开关
2. 打开新书，确认不触发
3. 重新开启

- [ ] **Step 5: 最终 Commit**

```bash
git add -A
git commit -m "feat(proactive): Midwife proactive guidance v1 complete"
```
