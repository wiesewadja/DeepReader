# 用户洞察系统实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现用户洞察系统，让 AI 更理解用户，回答更能触动用户

**Architecture:** 基于 DeepReader.md 用户画像 + 隐藏消息注入机制 + 章节熟悉度追踪。通过扩展 ToolContext、新增工具、增强 System Prompt 三层架构实现。

**Tech Stack:** TypeScript, Obsidian Plugin API, FrontendAgent

---

## Task 1: ChatMessage 类型扩展

**Files:**
- Modify: `frontend/src/agent/types.ts:7-13`

**Step 1: 添加 hidden 字段到 ChatMessage**

```typescript
// 修改 frontend/src/agent/types.ts 第 7-13 行
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
  hidden?: boolean;  // 新增：标记是否对用户隐藏（用于画像更新消息注入）
}
```

**Step 2: 验证类型编译通过**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 构建成功，无类型错误

**Step 3: Commit**

```bash
git add frontend/src/agent/types.ts
git commit -m "feat: ChatMessage 添加 hidden 字段支持隐藏消息"
```

---

## Task 2: 隐藏消息渲染过滤

**Files:**
- Modify: `frontend/src/views/sidebar-view.ts`

**Step 1: 找到消息渲染逻辑**

搜索 `messageList` 或 `MessageData` 相关代码，定位消息列表渲染位置。

**Step 2: 过滤 hidden 消息**

在将消息传递给 MessageList 之前，过滤掉 `hidden: true` 的消息：

```typescript
// 在 sidebar-view.ts 中，找到传递消息给 MessageList 的地方
// 添加过滤逻辑
const visibleMessages = messages.filter(msg => !msg.hidden);
```

**Step 3: 验证过滤效果**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 构建成功

**Step 4: Commit**

```bash
git add frontend/src/views/sidebar-view.ts
git commit -m "feat: 消息列表过滤 hidden 消息"
```

---

## Task 3: 实现 update_profile 工具

**Files:**
- Create: `frontend/src/agent/tools/profile.ts`

**Step 1: 创建 profile.ts 文件**

```typescript
/**
 * Profile 工具 - 用户画像更新
 *
 * 提供：
 * - update_profile: 更新用户画像字段
 */

import type { ToolDefinition } from '../types.js';
import type { ToolExecutor, ToolContext } from './types.js';
import { log, error } from '../../utils/logger.js';

/**
 * update_profile 工具定义
 */
const updateProfileDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'update_profile',
    description: `更新用户画像的某个字段。

使用场景：
- 用户明确表达了新的偏好（如"我喜欢简洁的回答"）
- 用户纠正了你的行为（如"不要用列表形式"）
- 用户提供了个人信息（如"我是程序员"）

注意：
- 只更新明确提及的信息，不要过度推断
- 每次只更新一个字段
- 更新后会立即在后续对话中生效`,
    parameters: {
      type: 'object',
      properties: {
        section: {
          type: 'string',
          description: '画像部分：基础信息|阅读偏好|认知特点|阅读轨迹',
          enum: ['基础信息', '阅读偏好', '认知特点', '阅读轨迹'],
        },
        field: {
          type: 'string',
          description: '具体字段名，如 "称呼"、"风格"、"擅长"',
        },
        value: {
          type: 'string',
          description: '新的值',
        },
        mode: {
          type: 'string',
          description: '更新模式：append（追加）或 replace（替换，默认）',
          enum: ['append', 'replace'],
        },
      },
      required: ['section', 'field', 'value'],
    },
  },
};

/**
 * 创建 update_profile 工具执行器
 */
export function createUpdateProfileTool(app: any): ToolExecutor {
  return {
    definition: updateProfileDefinition,
    async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
      const section = args.section as string;
      const field = args.field as string;
      const value = args.value as string;
      const mode = (args.mode as string) || 'replace';

      if (!section || !field || !value) {
        return 'Error: section, field, value 参数都是必需的';
      }

      if (!context.app) {
        return 'Error: Obsidian App 实例不可用';
      }

      try {
        // 读取现有 DeepReader.md
        const profilePath = 'DeepReader/DeepReader.md';
        const exists = await context.app.vault.adapter.exists(profilePath);

        let content = '';
        if (exists) {
          content = await context.app.vault.adapter.read(profilePath);
        }

        // 更新内容
        const updatedContent = updateProfileSection(content, section, field, value, mode);

        // 写回文件
        await context.app.vault.adapter.write(profilePath, updatedContent);

        log('[update_profile] 已更新:', section, field, value);

        // 返回隐藏消息格式，供调用方注入
        return JSON.stringify({
          success: true,
          hiddenMessage: {
            role: 'user',
            content: `[用户画像更新]\n${section} - ${field}: ${value}`,
            hidden: true,
          },
        });
      } catch (err) {
        error('[update_profile] 执行失败:', err);
        return `更新画像时出错: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}

/**
 * 更新 DeepReader.md 的某个字段
 */
function updateProfileSection(
  content: string,
  section: string,
  field: string,
  value: string,
  mode: string
): string {
  const lines = content.split('\n');
  let inTargetSection = false;
  let sectionStartIndex = -1;
  let fieldIndex = -1;

  // 找到目标 section
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith(`## ${section}`)) {
      inTargetSection = true;
      sectionStartIndex = i;
    } else if (lines[i].startsWith('## ') && inTargetSection) {
      // 到达下一个 section，停止搜索
      break;
    } else if (inTargetSection && lines[i].startsWith(`${field}：`)) {
      fieldIndex = i;
      break;
    } else if (inTargetSection && lines[i].startsWith(`${field}:`)) {
      fieldIndex = i;
      break;
    }
  }

  // 如果找到字段，更新它
  if (fieldIndex !== -1) {
    if (mode === 'append') {
      lines[fieldIndex] = lines[fieldIndex] + '，' + value;
    } else {
      const colonIndex = lines[fieldIndex].indexOf('：') !== -1
        ? lines[fieldIndex].indexOf('：')
        : lines[fieldIndex].indexOf(':');
      lines[fieldIndex] = lines[fieldIndex].substring(0, colonIndex + 1) + value;
    }
  } else if (sectionStartIndex !== -1) {
    // section 存在但字段不存在，添加字段
    lines.splice(sectionStartIndex + 1, 0, `${field}：${value}`);
  } else {
    // section 不存在，添加 section 和字段
    lines.push(`\n## ${section}\n${field}：${value}`);
  }

  return lines.join('\n');
}

// 导出工具定义（用于注册）
export const updateProfileTool: ToolExecutor = {
  definition: updateProfileDefinition,
  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    if (!context.app) {
      return 'Error: Obsidian App 实例不可用';
    }
    return createUpdateProfileTool(context.app).execute(args, context);
  },
};
```

**Step 2: 验证编译**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 构建成功

**Step 3: Commit**

```bash
git add frontend/src/agent/tools/profile.ts
git commit -m "feat: 实现 update_profile 工具"
```

---

## Task 4: 注册 update_profile 工具

**Files:**
- Modify: `frontend/src/agent/tools/index.ts`

**Step 1: 导入并注册工具**

```typescript
// 在 frontend/src/agent/tools/index.ts 中

// 1. 添加导入
import { updateProfileTool } from './profile.js';

// 2. 添加导出
export { updateProfileTool } from './profile.js';

// 3. 在 createToolRegistry 函数中注册
// 找到 registry.set 的位置，添加：
registry.set('update_profile', updateProfileTool);
```

**Step 2: 验证编译**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 构建成功

**Step 3: Commit**

```bash
git add frontend/src/agent/tools/index.ts
git commit -m "feat: 注册 update_profile 工具到 ToolRegistry"
```

---

## Task 5: 隐藏消息注入机制

**Files:**
- Modify: `frontend/src/agent/agent-loop.ts`

**Step 1: 分析工具返回值，提取隐藏消息**

在 `runAgentLoop` 函数中，当工具返回 JSON 格式的隐藏消息时，将其注入到对话历史：

```typescript
// 在 agent-loop.ts 中，工具执行结果处理的位置
// 检查返回值是否包含 hiddenMessage

import type { ChatMessage } from './types.js';

// 在工具执行后
const result = await executor.execute(args, context);

// 尝试解析 JSON 返回值
try {
  const parsed = JSON.parse(result);
  if (parsed.success && parsed.hiddenMessage) {
    // 注入隐藏消息到对话历史
    messages.push(parsed.hiddenMessage as ChatMessage);
  }
} catch {
  // 不是 JSON，正常处理
}

// 继续原有逻辑...
```

**Step 2: 验证编译**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 构建成功

**Step 3: Commit**

```bash
git add frontend/src/agent/agent-loop.ts
git commit -m "feat: 工具返回值支持隐藏消息注入"
```

---

## Task 6: System Prompt 增强 - 画像使用指南

**Files:**
- Modify: `frontend/src/agent/prompts.ts`

**Step 1: 添加用户画像使用指南**

在 `buildUserContextSection` 函数后添加：

```typescript
const PROFILE_USAGE_GUIDE = `## 用户画像使用指南

你已获得用户的画像信息（见上方"关于用户"部分）。请遵循以下原则：

1. **主动关联**
   - 回答问题时，结合用户背景判断深度和角度
   - 例如：用户是程序员，解释概念时可以用技术类比

2. **情感共鸣**
   - 识别用户的困惑、兴奋、挫败等情绪
   - 在回答中给予适当的情感回应，不要只是冷冰冰地输出信息

3. **个性化表达**
   - 使用用户偏好的称呼
   - 采用用户喜欢的表达风格（简洁/详尽）
   - 关注用户感兴趣的方面

4. **适度推断**
   - 根据用户的认知特点调整解释方式
   - 如果用户在某类内容上反复提问，可能是难点，需要换个角度解释

5. **记住但不刻意**
   - 自然地运用画像信息，不要说"根据您的画像..."
   - 让用户感觉到被理解，而不是被分析`;
```

**Step 2: 在 buildSystemPrompt 中使用**

```typescript
export function buildSystemPrompt(skillLoader: SkillLoader, userContext?: UserContext): string {
  const skillDescriptions = skillLoader.getDescriptions();
  const userContextSection = buildUserContextSection(userContext);

  return `${PERSONA_BASE}

${userContextSection ? userContextSection + '\n\n' : ''}${PROFILE_USAGE_GUIDE}

${CORE_CONSTRAINTS}

${TOOL_DESCRIPTIONS}

${RULES}

${skillDescriptions}`;
}
```

**Step 3: 验证编译**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 构建成功

**Step 4: Commit**

```bash
git add frontend/src/agent/prompts.ts
git commit -m "feat: System Prompt 添加用户画像使用指南"
```

---

## Task 7: System Prompt 增强 - 情感共鸣与鼓励

**Files:**
- Modify: `frontend/src/agent/prompts.ts`

**Step 1: 添加情感共鸣场景指引**

```typescript
const EMOTIONAL_RESONANCE_GUIDE = `## 情感共鸣

在以下场景中，给予适当的情感回应：

### 洞察时刻
当用户摘录、高亮、或表达对某段落的感触时：
- 识别内容对用户的意义
- 给予情感回应，如"这段话确实触动人心"
- 适当延伸，但不过度解读

### 困惑时刻
当用户反复提问、表达不解时：
- 先确认理解："您是在问...对吗？"
- 换个角度解释，结合用户认知特点
- 提供类比或具体案例
- 鼓励："这个问题确实不简单"

### 成长时刻
当用户完成一本书、长期阅读某主题、或表达收获时：
- 回顾阅读轨迹
- 指出成长点
- 给予鼓励和下一步建议`;
```

**Step 2: 添加鼓励好问题指引**

```typescript
const ENCOURAGE_GOOD_QUESTIONS = `## 鼓励好问题

当用户提出有深度的问题时，给予适度鼓励：

**什么是好问题**：
- 追问本质/底层逻辑
- 建立跨概念/跨书籍的关联
- 对观点进行批判性思考
- 尝试迁移应用

**鼓励方式**（简短自然，不要夸张）：
- ✅ "这个问题问得好，触及了核心..."
- ✅ "您抓住了关键点..."
- ✅ "这个角度很有意思..."
- ❌ "太棒了！您真是太聪明了！"

**适度原则**：普通问答直接回答，只有真正有深度的问题才给予肯定`;
```

**Step 3: 更新 buildSystemPrompt**

将新的指引添加到 System Prompt 中。

**Step 4: 验证编译**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 构建成功

**Step 5: Commit**

```bash
git add frontend/src/agent/prompts.ts
git commit -m "feat: System Prompt 添加情感共鸣与鼓励好问题指引"
```

---

## Task 8: ToolContext 扩展 - 阅读进度

**Files:**
- Modify: `frontend/src/agent/tools/types.ts`

**Step 1: 添加阅读进度类型**

```typescript
// 在 frontend/src/agent/tools/types.ts 中

/**
 * 阅读进度信息
 */
export interface ReadingProgress {
  bookName: string;
  totalChapters: number;

  // 熟悉度数据
  chapterFamiliarity: Record<number, number>;
  totalInteractions: number;

  // 计算指标
  coverage: number;      // 覆盖度 %
  absorption: number;    // 吸收度 %

  // 热点章节
  mostFamiliarChapter: string;
  leastFamiliarChapters: string[];

  // 时间信息
  lastActiveTime: string;
  daysSinceLastRead: number;
}

/**
 * Tool 执行上下文
 */
export interface ToolContext {
  indexId: string;
  pdfName: string;
  markdownFiles?: Record<string, string>;
  useLLMTreeSearch?: boolean;
  app?: App;

  // 新增：阅读进度信息
  readingProgress?: ReadingProgress;
}
```

**Step 2: 验证编译**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 构建成功

**Step 3: Commit**

```bash
git add frontend/src/agent/tools/types.ts
git commit -m "feat: ToolContext 添加阅读进度信息"
```

---

## Task 9: 实现 update_familiarity 工具

**Files:**
- Create: `frontend/src/agent/tools/familiarity.ts`

**Step 1: 创建 familiarity.ts**

```typescript
/**
 * Familiarity 工具 - 章节熟悉度管理
 *
 * 提供：
 * - update_familiarity: 更新章节熟悉度
 */

import type { ToolDefinition } from '../types.js';
import type { ToolExecutor, ToolContext } from './types.js';
import { log, error } from '../../utils/logger.js';

/**
 * update_familiarity 工具定义
 */
const updateFamiliarityDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'update_familiarity',
    description: `更新章节的阅读熟悉度。

熟悉度权重：
- get_chapter 调用: +2
- 用户高亮: +2
- 用户提问涉及: +1
- AI 回答引用: +1

注意：此工具由系统自动调用，通常不需要手动触发。`,
    parameters: {
      type: 'object',
      properties: {
        chapterIndex: {
          type: 'number',
          description: '章节索引（从0开始）',
        },
        delta: {
          type: 'number',
          description: '增量（默认1）',
        },
        reason: {
          type: 'string',
          description: '原因',
          enum: ['get_chapter', 'user_question', 'highlight', 'ai_reference'],
        },
      },
      required: ['chapterIndex'],
    },
  },
};

/**
 * 创建 update_familiarity 工具执行器
 */
export function createUpdateFamiliarityTool(app: any): ToolExecutor {
  return {
    definition: updateFamiliarityDefinition,
    async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
      const chapterIndex = args.chapterIndex as number;
      const delta = (args.delta as number) || 1;
      const reason = args.reason as string || 'unknown';

      if (typeof chapterIndex !== 'number') {
        return 'Error: chapterIndex 参数必须是数字';
      }

      if (!context.app) {
        return 'Error: Obsidian App 实例不可用';
      }

      if (!context.indexId) {
        return 'Error: indexId 不可用，无法更新熟悉度';
      }

      try {
        // 构建书籍笔记路径
        const notePath = `读书笔记/${context.pdfName}/${context.pdfName}.md`;
        const exists = await context.app.vault.adapter.exists(notePath);

        if (!exists) {
          return `书籍笔记不存在: ${notePath}`;
        }

        // 读取笔记内容
        const content = await context.app.vault.adapter.read(notePath);

        // 更新 frontmatter 中的熟悉度
        const updatedContent = updateFamiliarityInFrontmatter(content, chapterIndex, delta, reason);

        // 写回文件
        await context.app.vault.adapter.write(notePath, updatedContent);

        log('[update_familiarity] 章节', chapterIndex, '熟悉度+', delta, '原因:', reason);

        return `章节 ${chapterIndex} 熟悉度已更新 (+${delta})`;
      } catch (err) {
        error('[update_familiarity] 执行失败:', err);
        return `更新熟悉度时出错: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}

/**
 * 更新 frontmatter 中的熟悉度
 */
function updateFamiliarityInFrontmatter(
  content: string,
  chapterIndex: number,
  delta: number,
  _reason: string
): string {
  // 解析 frontmatter
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) {
    return content; // 没有 frontmatter，直接返回
  }

  let frontmatter = frontmatterMatch[1];
  const body = content.slice(frontmatterMatch[0].length);

  // 解析 chapter_familiarity
  const familiarityMatch = frontmatter.match(/chapter_familiarity:\s*\n([\s\S]*?)(?=\n\w|$)/);

  let familiarity: Record<number, number> = {};

  if (familiarityMatch) {
    // 解析现有的熟悉度
    const lines = familiarityMatch[1].split('\n');
    for (const line of lines) {
      const match = line.trim().match(/^(\d+):\s*(\d+)/);
      if (match) {
        familiarity[parseInt(match[1])] = parseInt(match[2]);
      }
    }
  }

  // 更新熟悉度
  familiarity[chapterIndex] = (familiarity[chapterIndex] || 0) + delta;

  // 更新 total_interactions
  const totalInteractions = Object.values(familiarity).reduce((a, b) => a + b, 0);

  // 重建 frontmatter
  let newFrontmatter = frontmatter;

  // 添加或更新 chapter_familiarity
  const familiarityStr = Object.entries(familiarity)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([k, v]) => `  ${k}: ${v}`)
    .join('\n');

  if (familiarityMatch) {
    newFrontmatter = newFrontmatter.replace(
      /chapter_familiarity:\s*\n[\s\S]*?(?=\n\w|$)/,
      `chapter_familiarity:\n${familiarityStr}\n`
    );
  } else {
    newFrontmatter += `\nchapter_familiarity:\n${familiarityStr}`;
  }

  // 更新 total_interactions
  if (newFrontmatter.includes('total_interactions:')) {
    newFrontmatter = newFrontmatter.replace(
      /total_interactions:\s*\d+/,
      `total_interactions: ${totalInteractions}`
    );
  } else {
    newFrontmatter += `\ntotal_interactions: ${totalInteractions}`;
  }

  // 更新 last_active
  const today = new Date().toISOString().split('T')[0];
  if (newFrontmatter.includes('last_active:')) {
    newFrontmatter = newFrontmatter.replace(
      /last_active:\s*[\d-]+/,
      `last_active: ${today}`
    );
  } else {
    newFrontmatter += `\nlast_active: ${today}`;
  }

  return `---\n${newFrontmatter}\n---${body}`;
}

// 导出工具定义
export const updateFamiliarityTool: ToolExecutor = {
  definition: updateFamiliarityDefinition,
  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    if (!context.app) {
      return 'Error: Obsidian App 实例不可用';
    }
    return createUpdateFamiliarityTool(context.app).execute(args, context);
  },
};
```

**Step 2: 验证编译**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 构建成功

**Step 3: Commit**

```bash
git add frontend/src/agent/tools/familiarity.ts
git commit -m "feat: 实现 update_familiarity 工具"
```

---

## Task 10: 注册 update_familiarity 工具

**Files:**
- Modify: `frontend/src/agent/tools/index.ts`

**Step 1: 导入并注册**

```typescript
// 在 frontend/src/agent/tools/index.ts 中

// 1. 添加导入
import { updateFamiliarityTool } from './familiarity.js';

// 2. 添加导出
export { updateFamiliarityTool } from './familiarity.js';

// 3. 在 createToolRegistry 函数中注册
registry.set('update_familiarity', updateFamiliarityTool);
```

**Step 2: 验证编译**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 构建成功

**Step 3: Commit**

```bash
git add frontend/src/agent/tools/index.ts
git commit -m "feat: 注册 update_familiarity 工具"
```

---

## Task 11: get_chapter 自动更新熟悉度

**Files:**
- Modify: `frontend/src/agent/tools/get-chapter.ts`

**Step 1: 在 get_chapter 执行后调用 update_familiarity**

```typescript
// 在 get-chapter.ts 的 execute 函数中
// 在返回章节内容之前，调用 update_familiarity

import { updateFamiliarityTool } from './familiarity.js';

// 在 execute 函数的最后
// 成功获取章节后，更新熟悉度
if (chapterIndex !== undefined) {
  try {
    await updateFamiliarityTool.execute(
      { chapterIndex, delta: 2, reason: 'get_chapter' },
      context
    );
  } catch (err) {
    // 忽略熟悉度更新失败，不影响主流程
    log('[get_chapter] 熟悉度更新失败:', err);
  }
}
```

**Step 2: 验证编译**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 构建成功

**Step 3: Commit**

```bash
git add frontend/src/agent/tools/get-chapter.ts
git commit -m "feat: get_chapter 自动更新章节熟悉度"
```

---

## Task 12: 实现 search_read_books 工具

**Files:**
- Create: `frontend/src/agent/tools/search-books.ts`

**Step 1: 创建 search-books.ts**

```typescript
/**
 * Search Books 工具 - 关联阅读
 *
 * 提供：
 * - search_read_books: 在已读书籍中搜索相关章节
 */

import type { ToolDefinition } from '../types.js';
import type { ToolExecutor, ToolContext } from './types.js';
import { log, error } from '../../utils/logger.js';

/**
 * search_read_books 工具定义
 */
const searchReadBooksDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'search_read_books',
    description: `在已读书籍中搜索与某个主题相关的章节。

使用场景：
- 用户问"我之前读过类似的内容吗？"
- 用户问"帮我找相关章节"
- 需要建立跨书籍的知识关联

返回最相关的章节列表，包含摘要和 wikilink。`,
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '搜索主题/关键词',
        },
        maxResults: {
          type: 'number',
          description: '最大返回数量（默认5）',
        },
      },
      required: ['query'],
    },
  },
};

/**
 * 创建 search_read_books 工具执行器
 */
export function createSearchReadBooksTool(app: any): ToolExecutor {
  return {
    definition: searchReadBooksDefinition,
    async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
      const query = args.query as string;
      const maxResults = (args.maxResults as number) || 5;

      if (!query) {
        return 'Error: query 参数是必需的';
      }

      if (!context.app) {
        return 'Error: Obsidian App 实例不可用';
      }

      try {
        // 1. 获取已读书籍列表（从读书笔记目录）
        const notesDir = '读书笔记';
        const exists = await context.app.vault.adapter.exists(notesDir);

        if (!exists) {
          return '没有找到已读书籍。';
        }

        const bookDirs = await context.app.vault.adapter.list(notesDir);
        const results: Array<{
          bookName: string;
          chapterTitle: string;
          chapterIndex: number;
          summary: string;
          link: string;
          relevance: number;
        }> = [];

        // 2. 遍历每本书的章节，查找摘要匹配
        for (const bookDir of bookDirs.folders) {
          const bookName = bookDir.split('/').pop() || '';
          const chapters = await context.app.vault.adapter.list(bookDir);

          for (const chapterFile of chapters.files) {
            if (!chapterFile.endsWith('.md')) continue;

            // 跳过主笔记文件
            if (chapterFile.endsWith(`${bookName}.md`)) continue;

            const content = await context.app.vault.adapter.read(chapterFile);

            // 提取摘要（从 frontmatter 的 summary 字段）
            const summaryMatch = content.match(/summary:\s*"([^"]+)"/);
            const summary = summaryMatch ? summaryMatch[1] : '';

            // 简单的关键词匹配（实际可以使用更智能的方式）
            const queryWords = query.toLowerCase().split(/\s+/);
            const summaryLower = summary.toLowerCase();
            let relevance = 0;

            for (const word of queryWords) {
              if (summaryLower.includes(word)) {
                relevance += 1;
              }
            }

            if (relevance > 0) {
              // 提取章节信息
              const titleMatch = content.match(/^#\s+(.+)$/m);
              const chapterTitle = titleMatch ? titleMatch[1] : chapterFile.split('/').pop() || '';

              // 构建 wikilink
              const relativePath = chapterFile.replace(/\.md$/, '');
              const link = `[[${relativePath}|${chapterTitle}]]`;

              // 提取章节索引
              const indexMatch = chapterFile.match(/(\d+)-/);
              const chapterIndex = indexMatch ? parseInt(indexMatch[1]) : 0;

              results.push({
                bookName,
                chapterTitle,
                chapterIndex,
                summary,
                link,
                relevance,
              });
            }
          }
        }

        // 3. 按相关性排序，返回前 N 个
        results.sort((a, b) => b.relevance - a.relevance);
        const topResults = results.slice(0, maxResults);

        if (topResults.length === 0) {
          return `未找到与 "${query}" 相关的章节。`;
        }

        // 4. 格式化输出
        const output = topResults.map((r, i) => ({
          序号: i + 1,
          书籍: r.bookName,
          章节: r.chapterTitle,
          摘要: r.summary,
          链接: r.link,
        }));

        return `找到 ${topResults.length} 个相关章节：\n\n${JSON.stringify(output, null, 2)}`;
      } catch (err) {
        error('[search_read_books] 执行失败:', err);
        return `搜索时出错: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}

// 导出工具定义
export const searchReadBooksTool: ToolExecutor = {
  definition: searchReadBooksDefinition,
  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    if (!context.app) {
      return 'Error: Obsidian App 实例不可用';
    }
    return createSearchReadBooksTool(context.app).execute(args, context);
  },
};
```

**Step 2: 验证编译**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 构建成功

**Step 3: Commit**

```bash
git add frontend/src/agent/tools/search-books.ts
git commit -m "feat: 实现 search_read_books 关联阅读工具"
```

---

## Task 13: 注册 search_read_books 工具

**Files:**
- Modify: `frontend/src/agent/tools/index.ts`

**Step 1: 导入并注册**

```typescript
// 在 frontend/src/agent/tools/index.ts 中

// 1. 添加导入
import { searchReadBooksTool } from './search-books.js';

// 2. 添加导出
export { searchReadBooksTool } from './search-books.js';

// 3. 在 createToolRegistry 函数中注册
registry.set('search_read_books', searchReadBooksTool);
```

**Step 2: 验证编译**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 构建成功

**Step 3: Commit**

```bash
git add frontend/src/agent/tools/index.ts
git commit -m "feat: 注册 search_read_books 工具"
```

---

## Task 14: System Prompt 添加阅读进度和关联阅读指引

**Files:**
- Modify: `frontend/src/agent/prompts.ts`

**Step 1: 添加阅读进度感知指引**

```typescript
const READING_PROGRESS_GUIDE = `## 阅读进度感知

用户可能会问"读到哪了"、"我理解了多少"。你可以：

1. **告知进度** - 使用覆盖度和吸收度两个指标
   - "您已经涉及了 70% 的章节，整体吸收度约 77%"
   - "最熟悉的是第三章（8次互动），建议深入第五、八章"

2. **建议下一步** - 推荐阅读未涉及的章节
   - "您还没涉及第五章，那里讨论了..."

3. **回顾上次** - 如果有上次对话记录，简要回顾关键内容

注意：进度信息来自 ToolContext.readingProgress，由系统自动维护。`;
```

**Step 2: 添加关联阅读指引**

```typescript
const RELATED_READING_GUIDE = `## 关联阅读

当用户问"我之前读过类似的内容吗"或"帮我找相关章节"时：

1. 使用 search_read_books 工具搜索已读书籍
2. 工具会遍历所有已读书籍的章节摘要
3. 根据摘要推理相关性，返回最相关的章节
4. 如果需要详细内容，再调用 get_chapter 读取正文
5. 回答时使用 wikilink 引用相关章节`;
```

**Step 3: 更新 buildSystemPrompt**

将新的指引添加到 System Prompt 中。

**Step 4: 验证编译**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 构建成功

**Step 5: Commit**

```bash
git add frontend/src/agent/prompts.ts
git commit -m "feat: System Prompt 添加阅读进度和关联阅读指引"
```

---

## Task 15: 书籍笔记添加 aicreate 标记

**Files:**
- Modify: `frontend/src/services/markdown-exporter.ts`

**Step 1: 找到书籍笔记生成位置**

搜索 `generateBookNote` 或相关的笔记生成函数。

**Step 2: 在 frontmatter 中添加 aicreate: true**

```yaml
---
aicreate: true
book_name: "书名"
...
---
```

**Step 3: 验证编译**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 构建成功

**Step 4: Commit**

```bash
git add frontend/src/services/markdown-exporter.ts
git commit -m "feat: 书籍笔记添加 aicreate 标记"
```

---

## Task 16: 集成测试

**Step 1: 构建前端**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 构建成功

**Step 2: 在 Obsidian 中测试**

1. 重新加载插件
2. 测试 `update_profile` 工具：说"以后请叫我小明"
3. 验证 DeepReader.md 是否更新
4. 测试后续对话是否使用了新的称呼

**Step 3: 修复发现的问题**

如有问题，修复后提交。

---

## Task 17: 最终提交

**Step 1: 确认所有更改已提交**

Run: `git status`
Expected: working tree clean

**Step 2: 查看提交历史**

Run: `git log --oneline -10`

**Step 3: 完成**

实施计划已完成，可以合并到主分支。
