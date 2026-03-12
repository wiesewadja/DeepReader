# Phase 5: Agent 可见性 UX 设计 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**目标**: 让用户看到 Agent 像真人一样工作的过程——翻书、思考、整理回答

**核心原则**: 拟人化、自然、无技术术语

**技术栈**: TypeScript, Obsidian Plugin API, CSS Animation

---

## 设计理念

### 用户视角 vs 技术视角

| 技术术语 | 用户看到 |
|----------|----------|
| `search_doc("核心观点")` | 📖 正在书页间搜索... |
| `get_chapter("第一章")` | 📜 翻到第一章细读... |
| `tool_calls: [...]` | （隐藏，展示为自然动作） |
| `LLM reasoning` | 💭 思考中... |

### 核心体验

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  用户: 这本书的核心观点是什么？                                   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  奚童                                                     │   │
│  │                                                          │   │
│  │  📖 让我先翻翻这本书...                                    │   │
│  │                                                          │   │
│  │  ┌────────────────────────────────────────────────┐     │   │
│  │  │  📖 阅读书籍中...                               │     │   │
│  │  │                                                │     │   │
│  │  │  · 浏览目录结构                        ✓       │     │   │
│  │  │  · 翻阅"序言"了解主旨                  ✓       │     │   │
│  │  │  · 细读"结论"部分                      ◌       │     │   │
│  │  │                                                │     │   │
│  │  │  [████████████░░░░░░░░] 60%                   │     │   │
│  │  └────────────────────────────────────────────────┘     │   │
│  │                                                          │   │
│  │  💭 嗯...这本书的脉络是这样的...                          │   │
│  │                                                          │   │
│  │  ┌────────────────────────────────────────────────┐     │   │
│  │  │  📝 整理回答中...                               │     │   │
│  │  │                                                │     │   │
│  │  │  阁下，这本书的核心观点可以从三个层面来理解：    │     │   │
│  │  │                                                │     │   │
│  │  │  首先是认知层面...（流式显示）                   │     │   │
│  │  └────────────────────────────────────────────────┘     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Task 1: 定义拟人化状态类型

**文件:**
- 创建: `frontend/src/agent/ui/humanized-types.ts`

**Step 1: 定义拟人化状态**

```typescript
/**
 * 拟人化 Agent 状态类型
 *
 * 所有状态都用用户友好的语言描述
 */

/**
 * Agent 动作类型（拟人化）
 */
export type AgentAction =
  | { type: 'reading'; detail: string }      // 阅读书籍
  | { type: 'searching'; detail: string }    // 搜索内容
  | { type: 'thinking'; detail: string }     // 思考中
  | { type: 'writing'; detail: string }      // 整理回答
  | { type: 'waiting'; detail: string };     // 等待中

/**
 * 阅读进度项
 */
export interface ReadingProgressItem {
  /** 动作描述（用户视角） */
  action: string;
  /** 状态 */
  status: 'done' | 'current' | 'pending';
  /** 耗时（可选） */
  duration?: number;
}

/**
 * 拟人化进度信息
 */
export interface HumanizedProgress {
  /** 当前主状态 */
  mainAction: AgentAction;
  /** 阅读进度列表 */
  readingSteps: ReadingProgressItem[];
  /** 思考气泡内容（可选） */
  thoughtBubble?: string;
  /** 已生成的内容（流式） */
  generatedContent: string;
  /** 整体进度 0-100 */
  overallProgress: number;
}

/**
 * 工具名称到拟人化动作的映射
 */
export const TOOL_TO_ACTION: Record<string, (args: Record<string, unknown>) => string> = {
  search_doc: (args) => `搜索「${(args.query as string)?.slice(0, 20) || '相关内容'}」`,
  get_chapter: (args) => `翻阅「${args.chapter || '章节'}」`,
  get_toc: () => '浏览目录结构',
  search_read_books: (args) => `在已读书中查找「${(args.query as string)?.slice(0, 15) || '相关内容'}」`,
  add_memory: () => '记下这个要点',
  search_memory: () => '回忆之前的内容',
  write_note: (args) => `整理笔记「${args.path || ''}」`,
  create_sub_agent: () => '分头查找资料',
};

/**
 * 生成思考气泡内容
 */
export function generateThoughtBubble(
  context: 'starting' | 'found' | 'confused' | 'summarizing' | 'reflecting'
): string {
  const thoughts: Record<string, string[]> = {
    starting: [
      '让我想想从哪里开始...',
      '这个问题很有意思...',
      '让我先了解一下背景...',
    ],
    found: [
      '找到了一些相关内容...',
      '这里有个关键点...',
      '嗯，这段话说得很清楚...',
    ],
    confused: [
      '让我换个角度看看...',
      '这个概念需要再确认一下...',
      '我需要更多信息来回答这个问题...',
    ],
    summarizing: [
      '让我整理一下思路...',
      '核心观点应该是...',
      '可以从这几个层面来概括...',
    ],
    reflecting: [
      '这个角度也值得考虑...',
      '用户可能还想知道...',
      '让我再补充一点...',
    ],
  };

  const options = thoughts[context] || thoughts.starting;
  return options[Math.floor(Math.random() * options.length)];
}
```

**Step 2: Commit**

```bash
git add frontend/src/agent/ui/humanized-types.ts
git commit -m "feat(ui): add humanized agent state types"
```

---

## Task 2: 创建 HumanizedProgressAdapter

**文件:**
- 创建: `frontend/src/agent/ui/humanized-adapter.ts`

**Step 1: 实现适配器**

```typescript
/**
 * HumanizedProgressAdapter - 将技术状态转换为拟人化显示
 *
 * 输入: 工具调用、LLM 状态
 * 输出: 用户友好的动作描述
 */

import type { HumanizedProgress, ReadingProgressItem, AgentAction } from './humanized-types';
import { TOOL_TO_ACTION, generateThoughtBubble } from './humanized-types';

/**
 * 工具调用记录（内部）
 */
interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  status: 'running' | 'completed' | 'failed';
  duration?: number;
}

export class HumanizedProgressAdapter {
  private toolCalls: ToolCallRecord[] = [];
  private currentContent: string = '';
  private iteration: number = 0;
  private maxIterations: number = 10;

  /**
   * 记录工具调用开始
   */
  recordToolStart(name: string, args: Record<string, unknown>): void {
    this.toolCalls.push({
      name,
      args,
      status: 'running',
    });
  }

  /**
   * 记录工具调用完成
   */
  recordToolComplete(name: string, duration: number): void {
    const tool = this.toolCalls.find(t => t.name === name && t.status === 'running');
    if (tool) {
      tool.status = 'completed';
      tool.duration = duration;
    }
  }

  /**
   * 记录工具调用失败
   */
  recordToolFailed(name: string, error: string): void {
    const tool = this.toolCalls.find(t => t.name === name && t.status === 'running');
    if (tool) {
      tool.status = 'failed';
    }
  }

  /**
   * 更新生成内容
   */
  updateContent(content: string): void {
    this.currentContent = content;
  }

  /**
   * 设置迭代轮数
   */
  setIteration(iteration: number, maxIterations: number): void {
    this.iteration = iteration;
    this.maxIterations = maxIterations;
  }

  /**
   * 转换为拟人化进度
   */
  toHumanizedProgress(): HumanizedProgress {
    // 确定当前主动作
    const mainAction = this.determineMainAction();

    // 生成阅读步骤
    const readingSteps = this.generateReadingSteps();

    // 生成思考气泡
    const thoughtBubble = this.shouldShowThought()
      ? generateThoughtBubble(this.determineThoughtContext())
      : undefined;

    // 计算整体进度
    const overallProgress = this.calculateProgress();

    return {
      mainAction,
      readingSteps,
      thoughtBubble,
      generatedContent: this.currentContent,
      overallProgress,
    };
  }

  /**
   * 确定当前主动作
   */
  private determineMainAction(): AgentAction {
    const runningTools = this.toolCalls.filter(t => t.status === 'running');

    if (runningTools.length > 0) {
      const tool = runningTools[runningTools.length - 1];
      const actionFn = TOOL_TO_ACTION[tool.name];

      if (tool.name.includes('search') || tool.name.includes('get_chapter') || tool.name.includes('toc')) {
        return { type: 'reading', detail: actionFn?.(tool.args) || '阅读中...' };
      }

      if (tool.name.includes('memory')) {
        return { type: 'thinking', detail: actionFn?.(tool.args) || '回忆中...' };
      }

      if (tool.name.includes('note') || tool.name.includes('write')) {
        return { type: 'writing', detail: actionFn?.(tool.args) || '整理中...' };
      }
    }

    if (this.currentContent) {
      return { type: 'writing', detail: '整理回答中...' };
    }

    return { type: 'thinking', detail: '思考中...' };
  }

  /**
   * 生成阅读步骤列表
   */
  private generateReadingSteps(): ReadingProgressItem[] {
    return this.toolCalls.map(tool => {
      const actionFn = TOOL_TO_ACTION[tool.name];
      const action = actionFn?.(tool.args) || tool.name;

      let status: ReadingProgressItem['status'] = 'pending';
      if (tool.status === 'completed') status = 'done';
      else if (tool.status === 'running') status = 'current';

      return {
        action,
        status,
        duration: tool.duration,
      };
    });
  }

  /**
   * 是否显示思考气泡
   */
  private shouldShowThought(): boolean {
    // 在以下情况显示思考气泡：
    // 1. 刚开始（没有工具调用）
    // 2. 完成一批工具调用后
    // 3. 开始生成内容时

    const completedCount = this.toolCalls.filter(t => t.status === 'completed').length;
    const runningCount = this.toolCalls.filter(t => t.status === 'running').length;

    return (
      this.toolCalls.length === 0 ||
      (completedCount > 0 && runningCount === 0) ||
      (completedCount >= 2 && !this.currentContent)
    );
  }

  /**
   * 确定思考上下文
   */
  private determineThoughtContext(): 'starting' | 'found' | 'confused' | 'summarizing' | 'reflecting' {
    const failedCount = this.toolCalls.filter(t => t.status === 'failed').length;
    const completedCount = this.toolCalls.filter(t => t.status === 'completed').length;

    if (failedCount > 0) return 'confused';
    if (this.toolCalls.length === 0) return 'starting';
    if (this.currentContent) return 'summarizing';
    if (completedCount >= 3) return 'reflecting';
    return 'found';
  }

  /**
   * 计算整体进度
   */
  private calculateProgress(): number {
    const completedCount = this.toolCalls.filter(t => t.status === 'completed').length;
    const total = Math.max(this.toolCalls.length, 1);

    // 工具调用占 60%，内容生成占 40%
    const toolProgress = (completedCount / total) * 60;
    const contentProgress = this.currentContent ? 40 : 0;

    return Math.min(100, toolProgress + contentProgress);
  }

  /**
   * 重置
   */
  reset(): void {
    this.toolCalls = [];
    this.currentContent = '';
    this.iteration = 0;
  }
}
```

**Step 2: Commit**

```bash
git add frontend/src/agent/ui/humanized-adapter.ts
git commit -m "feat(ui): add HumanizedProgressAdapter for user-friendly display"
```

---

## Task 3: 创建 HumanizedAgentView 组件

**文件:**
- 创建: `frontend/src/agent/ui/humanized-view.ts`

**Step 1: 实现组件**

```typescript
/**
 * HumanizedAgentView - 拟人化 Agent 状态视图
 *
 * 展示像真人一样的阅读、思考、回答过程
 */

import type { HumanizedProgress, ReadingProgressItem } from './humanized-types';

/**
 * 创建拟人化状态元素
 */
export function createHumanizedStatusElement(progress: HumanizedProgress): HTMLElement {
  const container = document.createElement('div');
  container.className = 'deepreader-agent-humanized';

  // 主动作区域
  const actionArea = container.createDiv({ cls: 'agent-action-area' });
  renderMainAction(actionArea, progress.mainAction);

  // 阅读进度（如果有）
  if (progress.readingSteps.length > 0) {
    const readingArea = container.createDiv({ cls: 'agent-reading-area' });
    renderReadingProgress(readingArea, progress.readingSteps, progress.overallProgress);
  }

  // 思考气泡（如果有）
  if (progress.thoughtBubble) {
    const thoughtArea = container.createDiv({ cls: 'agent-thought-bubble' });
    thoughtArea.createSpan({ cls: 'thought-icon', text: '💭' });
    thoughtArea.createSpan({ cls: 'thought-text', text: progress.thoughtBubble });
  }

  // 生成内容（如果有）
  if (progress.generatedContent) {
    const contentArea = container.createDiv({ cls: 'agent-content-area' });
    renderGeneratedContent(contentArea, progress.generatedContent);
  }

  return container;
}

/**
 * 渲染主动作
 */
function renderMainAction(container: HTMLElement, action: AgentAction): void {
  const icons: Record<string, string> = {
    reading: '📖',
    searching: '🔍',
    thinking: '🧠',
    writing: '📝',
    waiting: '⏳',
  };

  const icon = icons[action.type] || '🔄';

  container.createSpan({ cls: 'action-icon', text: icon });

  const textSpan = container.createSpan({ cls: 'action-text' });

  // 根据动作类型添加动画效果
  if (action.type === 'reading') {
    textSpan.innerHTML = `<span class="typing-text">${action.detail}</span>`;
  } else if (action.type === 'thinking') {
    textSpan.innerHTML = `<span class="thinking-text">${action.detail}</span>`;
  } else {
    textSpan.textContent = action.detail;
  }
}

/**
 * 渲染阅读进度
 */
function renderReadingProgress(
  container: HTMLElement,
  steps: ReadingProgressItem[],
  overallProgress: number
): void {
  // 标题
  const title = container.createDiv({ cls: 'reading-title' });
  title.createSpan({ text: '📖 阅读书籍中...' });

  // 步骤列表
  const stepsList = container.createDiv({ cls: 'reading-steps' });

  for (const step of steps) {
    const stepItem = stepsList.createDiv({ cls: `step-item step-${step.status}` });

    // 状态图标
    const statusIcon = step.status === 'done' ? ' ✓' :
                       step.status === 'current' ? ' ◌' : ' ○';
    stepItem.createSpan({ cls: 'step-status', text: statusIcon });

    // 动作描述
    stepItem.createSpan({ cls: 'step-action', text: ` ${step.action}` });

    // 耗时（已完成时显示）
    if (step.duration && step.status === 'done') {
      const duration = step.duration < 1000
        ? `${step.duration}ms`
        : `${(step.duration / 1000).toFixed(1)}s`;
      stepItem.createSpan({ cls: 'step-duration', text: ` ${duration}` });
    }
  }

  // 进度条
  const progressBar = container.createDiv({ cls: 'progress-bar-container' });
  const bar = progressBar.createDiv({ cls: 'progress-bar' });
  bar.style.setProperty('--progress', `${overallProgress}%`);

  const progressText = progressBar.createSpan({ cls: 'progress-text' });
  progressText.textContent = `${Math.round(overallProgress)}%`;
}

/**
 * 渲染生成内容
 */
function renderGeneratedContent(container: HTMLElement, content: string): void {
  const title = container.createDiv({ cls: 'content-title' });
  title.createSpan({ text: '📝 整理回答中...' });

  const contentBox = container.createDiv({ cls: 'content-box' });

  // 内容预览（最多显示前 300 字符）
  const preview = content.length > 300
    ? content.slice(0, 300) + '...'
    : content;

  contentBox.textContent = preview;

  // 添加流式动画效果
  contentBox.addClass('streaming');
}

/**
 * 更新现有元素（用于流式更新）
 */
export function updateHumanizedStatusElement(
  element: HTMLElement,
  progress: HumanizedProgress
): void {
  // 清空并重新渲染
  element.empty();
  const newElement = createHumanizedStatusElement(progress);

  // 复制子元素
  while (newElement.firstChild) {
    element.appendChild(newElement.firstChild);
  }
}
```

**Step 2: Commit**

```bash
git add frontend/src/agent/ui/humanized-view.ts
git commit -m "feat(ui): add HumanizedAgentView component"
```

---

## Task 4: 添加拟人化 CSS 样式

**文件:**
- 创建: `frontend/src/styles/agent-humanized.css`

**Step 1: 编写样式**

```css
/* Agent Humanized Status Styles */

.deepreader-agent-humanized {
  padding: 16px;
  margin: 12px 0;
  background: linear-gradient(135deg, var(--background-secondary) 0%, var(--background-primary) 100%);
  border-radius: 12px;
  border-left: 3px solid var(--interactive-accent);
  animation: fadeIn 0.3s ease;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

/* 主动作区域 */
.agent-action-area {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  margin-bottom: 12px;
}

.action-icon {
  font-size: 20px;
  animation: bounce 1s infinite;
}

@keyframes bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-3px); }
}

.action-text {
  font-weight: 500;
  color: var(--text-normal);
}

/* 打字效果 */
.typing-text::after {
  content: '▋';
  animation: blink 0.8s infinite;
  margin-left: 2px;
}

@keyframes blink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}

/* 思考效果 */
.thinking-text {
  animation: pulse-opacity 2s infinite;
}

@keyframes pulse-opacity {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

/* 阅读进度区域 */
.agent-reading-area {
  background: var(--background-primary);
  border-radius: 8px;
  padding: 12px;
  margin-bottom: 12px;
}

.reading-title {
  font-size: 13px;
  color: var(--text-muted);
  margin-bottom: 10px;
}

.reading-steps {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 10px;
}

.step-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  padding: 4px 8px;
  border-radius: 4px;
  transition: all 0.3s ease;
}

.step-item.step-done {
  color: var(--text-success);
  background: var(--background-secondary);
}

.step-item.step-current {
  color: var(--text-normal);
  background: var(--interactive-accent-hover);
  animation: highlight 1.5s infinite;
}

@keyframes highlight {
  0%, 100% { background: var(--interactive-accent-hover); }
  50% { background: var(--background-secondary); }
}

.step-item.step-pending {
  color: var(--text-muted);
}

.step-status {
  font-family: monospace;
  width: 20px;
  text-align: center;
}

.step-action {
  flex: 1;
}

.step-duration {
  font-size: 11px;
  color: var(--text-faint);
}

/* 进度条 */
.progress-bar-container {
  display: flex;
  align-items: center;
  gap: 10px;
}

.progress-bar {
  flex: 1;
  height: 6px;
  background: var(--background-modifier-border);
  border-radius: 3px;
  overflow: hidden;
}

.progress-bar::after {
  content: '';
  display: block;
  height: 100%;
  width: var(--progress, 0%);
  background: linear-gradient(90deg, var(--interactive-accent), var(--text-accent));
  border-radius: 3px;
  transition: width 0.5s ease;
}

.progress-text {
  font-size: 12px;
  color: var(--text-muted);
  min-width: 35px;
  text-align: right;
}

/* 思考气泡 */
.agent-thought-bubble {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: var(--background-primary);
  border-radius: 16px;
  margin-bottom: 12px;
  font-size: 14px;
  color: var(--text-muted);
  font-style: italic;
  position: relative;
}

.agent-thought-bubble::before {
  content: '';
  position: absolute;
  left: 20px;
  bottom: -8px;
  width: 16px;
  height: 16px;
  background: var(--background-primary);
  transform: rotate(45deg);
}

.thought-icon {
  font-size: 18px;
}

.thought-text {
  animation: fade-in-out 3s infinite;
}

@keyframes fade-in-out {
  0%, 100% { opacity: 0.7; }
  50% { opacity: 1; }
}

/* 生成内容区域 */
.agent-content-area {
  margin-top: 12px;
}

.content-title {
  font-size: 13px;
  color: var(--text-muted);
  margin-bottom: 8px;
}

.content-box {
  padding: 12px;
  background: var(--background-primary);
  border-radius: 8px;
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
  max-height: 200px;
  overflow-y: auto;
}

.content-box.streaming::after {
  content: ' ▋';
  animation: blink 0.8s infinite;
}

/* 暗色主题 */
.theme-dark .deepreader-agent-humanized {
  background: linear-gradient(135deg, var(--background-secondary-alt) 0%, var(--background-primary-alt) 100%);
}

/* 响应式 */
@media (max-width: 600px) {
  .deepreader-agent-humanized {
    padding: 12px;
    margin: 8px 0;
  }

  .step-item {
    font-size: 12px;
  }
}
```

**Step 2: 在 main.ts 中引入**

```typescript
import './styles/agent-humanized.css';
```

**Step 3: Commit**

```bash
git add frontend/src/styles/agent-humanized.css frontend/src/main.ts
git commit -m "style(ui): add humanized agent status CSS with animations"
```

---

## Task 5: 集成到 AgentLoop

**文件:**
- 修改: `frontend/src/agent/agent-loop.ts`

**Step 1: 添加拟人化回调**

```typescript
import { HumanizedProgressAdapter } from './ui/humanized-adapter';
import type { HumanizedProgress } from './ui/humanized-types';

export interface AgentLoopOptions {
  // ... 现有选项 ...

  /** 拟人化进度回调 */
  onHumanizedProgress?: (progress: HumanizedProgress) => void;
}

export async function runAgentLoop(
  client: LLMClient,
  messages: ChatMessage[],
  tools: ToolDefinition[],
  toolRegistry: ToolRegistry,
  context: ToolContext,
  options: AgentLoopOptions
): Promise<ChatMessage[]> {
  // 创建拟人化适配器
  const humanizer = options.onHumanizedProgress
    ? new HumanizedProgressAdapter()
    : null;

  // 初始状态
  humanizer?.setIteration(0, maxIterations);
  options.onHumanizedProgress?.(humanizer.toHumanizedProgress());

  // ... 现有代码 ...

  while (iterations < maxIterations) {
    iterations++;
    humanizer?.setIteration(iterations, maxIterations);

    // 更新状态
    options.onHumanizedProgress?.(humanizer.toHumanizedProgress());

    // ... LLM 调用 ...

    // 工具调用
    for (const tc of toolCalls) {
      const toolStartTime = Date.now();

      // 记录开始
      humanizer?.recordToolStart(tc.name, args);
      options.onHumanizedProgress?.(humanizer.toHumanizedProgress());

      try {
        const result = await executeTool(toolRegistry, tc.name, args, context);
        humanizer?.recordToolComplete(tc.name, Date.now() - toolStartTime);
      } catch (error) {
        humanizer?.recordToolFailed(tc.name, String(error));
      }

      // 更新显示
      options.onHumanizedProgress?.(humanizer.toHumanizedProgress());
    }

    // 流式内容
    // 在 onContent 回调中
    humanizer?.updateContent(accumulatedContent);
    options.onHumanizedProgress?.(humanizer.toHumanizedProgress());
  }

  return workingMessages;
}
```

**Step 2: Commit**

```bash
git add frontend/src/agent/agent-loop.ts
git commit -m "feat(agent): integrate humanized progress into agent loop"
```

---

## Task 6: 集成到 ChatView

**文件:**
- 修改: `frontend/src/views/ChatView.ts` 或相关聊天组件

**Step 1: 在聊天界面显示拟人化状态**

```typescript
import { createHumanizedStatusElement, updateHumanizedStatusElement } from '../agent/ui/humanized-view';
import type { HumanizedProgress } from '../agent/ui/humanized-types';

class ChatView {
  private statusContainer: HTMLElement | null = null;

  /**
   * 发送消息时显示拟人化状态
   */
  async sendMessage(content: string) {
    // 创建状态容器
    this.statusContainer = this.messageContainer.createDiv({
      cls: 'agent-status-wrapper',
    });

    // 运行 Agent
    await runAgentLoop(client, messages, tools, registry, context, {
      ...options,
      onHumanizedProgress: (progress: HumanizedProgress) => {
        this.updateHumanizedStatus(progress);
      },
    });

    // 完成后淡出状态容器
    this.statusContainer?.addClass('fade-out');
    setTimeout(() => {
      this.statusContainer?.remove();
      this.statusContainer = null;
    }, 500);
  }

  /**
   * 更新拟人化状态显示
   */
  private updateHumanizedStatus(progress: HumanizedProgress) {
    if (!this.statusContainer) return;

    if (!this.statusContainer.firstChild) {
      const el = createHumanizedStatusElement(progress);
      this.statusContainer.appendChild(el);
    } else {
      updateHumanizedStatusElement(
        this.statusContainer.firstChild as HTMLElement,
        progress
      );
    }
  }
}
```

**Step 2: Commit**

```bash
git add frontend/src/views/ChatView.ts
git commit -m "feat(ui): integrate humanized status into chat view"
```

---

## 验收清单

- [ ] 工具调用显示为拟人化动作（如"翻阅章节"）
- [ ] 不显示技术术语（如 `search_doc`）
- [ ] 阅读进度以自然方式展示
- [ ] 思考气泡显示自然的思考过程
- [ ] 流式内容有打字机效果
- [ ] 进度条平滑动画
- [ ] 整体体验像与真人对话

---

## UX 效果预览

### 完整交互流程

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  用户: 这本书的核心观点是什么？                                   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  📖 让我先翻翻这本书...                                    │   │
│  │                                                          │   │
│  │  ┌────────────────────────────────────────────────┐     │   │
│  │  │  📖 阅读书籍中...                               │     │   │
│  │  │                                                │     │   │
│  │  │   ✓ 浏览目录结构                               │     │   │
│  │  │   ✓ 翻阅「序言」了解主旨                        │     │   │
│  │  │   ◌ 细读「结论」部分                            │     │   │
│  │  │                                                │     │   │
│  │  │  [████████████░░░░░░░░] 60%                   │     │   │
│  │  └────────────────────────────────────────────────┘     │   │
│  │                                                          │   │
│  │  ┌───────────────────────────────────────────────────┐  │   │
│  │  │  💭 嗯...这本书的脉络是这样的...                    │  │   │
│  │  └───────────────────────────────────────────────────┘  │   │
│  │                                                          │   │
│  │  ┌────────────────────────────────────────────────┐     │   │
│  │  │  📝 整理回答中...                               │     │   │
│  │  │                                                │     │   │
│  │  │  阁下，这本书的核心观点可以从三个层面来理解：    │     │   │
│  │  │                                                │     │   │
│  │  │  首先是认知层面，作者认为阅读不仅仅是获取信息，  │     │   │
│  │  │  更是一种主动的思维活动... ▋                    │     │   │
│  │  └────────────────────────────────────────────────┘     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 工具名称映射表

| 内部工具 | 用户看到 |
|----------|----------|
| `search_doc` | 搜索「...」 |
| `get_chapter` | 翻阅「...」 |
| `get_toc` | 浏览目录结构 |
| `search_read_books` | 在已读书中查找 |
| `add_memory` | 记下这个要点 |
| `search_memory` | 回忆之前的内容 |
| `write_note` | 整理笔记 |
| `create_sub_agent` | 分头查找资料 |

---

## 后续工作

Phase 5 完成后，整个 Agent 优化项目完成！

建议进行最终验收测试：
1. 验证所有 Phase 功能正常工作
2. 测试长对话的自动整合
3. 测试子 Agent 并行任务
4. 测试拟人化 UX 效果
5. 收集用户反馈
