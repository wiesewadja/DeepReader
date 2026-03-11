# 用户洞察系统实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 实现用户洞察系统，让 AI 更理解用户，回答更能触动用户，并将阅读进度从 frontmatter 迁移到隐藏的插件数据目录

**Architecture:**
- 阅读进度数据从 frontmatter 迁移到 `.obsidian/plugins/deepreader/data/reading-progress/` JSON 文件
- Memory 系统路径从 `DeepReader/memory/` 迁移到 `.obsidian/plugins/deepreader/data/memory/`
- 保持 `DeepReader/DeepReader.md` 作为用户可见的画像配置文件
- 新增隐藏消息机制实现画像更新即时生效

**Tech Stack:** TypeScript, Obsidian Plugin API, JSON storage

---

## Phase 1: 数据迁移基础设施

### Task 1.1: 创建插件数据目录工具函数

**Files:**
- Create: `frontend/src/agent/utils/plugin-data.ts`

**Step 1: 创建插件数据工具模块**

```typescript
/**
 * 插件数据目录工具函数
 *
 * 管理隐藏在 .obsidian/plugins/deepreader/data/ 下的数据
 */

import type { App } from 'obsidian';
import { toolsLog as log, error } from '../../utils/logger.js';

/** 插件数据根目录 */
export const PLUGIN_DATA_DIR = '.obsidian/plugins/deepreader/data';

/** 阅读进度目录 */
export const READING_PROGRESS_DIR = `${PLUGIN_DATA_DIR}/reading-progress`;

/** Memory 目录 */
export const MEMORY_DATA_DIR = `${PLUGIN_DATA_DIR}/memory`;

/** Memory 条目目录 */
export const MEMORY_ENTRIES_DIR = `${MEMORY_DATA_DIR}/entries`;

/**
 * 确保插件数据目录结构存在
 */
export async function ensurePluginDataDirs(app: App): Promise<void> {
  const dirs = [
    PLUGIN_DATA_DIR,
    READING_PROGRESS_DIR,
    MEMORY_DATA_DIR,
    MEMORY_ENTRIES_DIR,
  ];

  for (const dir of dirs) {
    const exists = await app.vault.adapter.exists(dir);
    if (!exists) {
      await app.vault.createFolder(dir);
      log('[PluginData] Created directory:', dir);
    }
  }
}

/**
 * 获取书籍阅读进度文件路径
 */
export function getReadingProgressPath(bookName: string): string {
  // 清理书名，生成合法文件名
  const safeName = bookName.replace(/[\/\\?%*:|"<>]/g, '_');
  return `${READING_PROGRESS_DIR}/${safeName}.json`;
}

/**
 * 读取书籍阅读进度
 */
export async function readReadingProgress(
  app: App,
  bookName: string
): Promise<ReadingProgressData | null> {
  const path = getReadingProgressPath(bookName);

  try {
    const exists = await app.vault.adapter.exists(path);
    if (!exists) {
      return null;
    }

    const content = await app.vault.adapter.read(path);
    return JSON.parse(content) as ReadingProgressData;
  } catch (err) {
    error('[PluginData] Failed to read reading progress:', err);
    return null;
  }
}

/**
 * 写入书籍阅读进度
 */
export async function writeReadingProgress(
  app: App,
  data: ReadingProgressData
): Promise<boolean> {
  const path = getReadingProgressPath(data.bookName);

  try {
    // 确保目录存在
    await ensurePluginDataDirs(app);

    // 更新时间戳
    data.lastUpdated = new Date().toISOString();

    await app.vault.adapter.write(path, JSON.stringify(data, null, 2));
    log('[PluginData] Wrote reading progress:', data.bookName);
    return true;
  } catch (err) {
    error('[PluginData] Failed to write reading progress:', err);
    return false;
  }
}

/**
 * 阅读进度数据结构
 */
export interface ReadingProgressData {
  bookName: string;
  bookId: string;
  totalChapters: number;
  chapterFamiliarity: Record<string, number>;
  totalInteractions: number;
  coverage: number;
  absorption: number;
  created: string;
  lastUpdated: string;
  readingHistory: Array<{
    round: number;
    started: string;
    finished?: string;
    finalFamiliarity?: Record<string, number>;
    notes?: string;
    currentRound?: boolean;
  }>;
  currentRound: number;
}

/**
 * 创建新的阅读进度数据
 */
export function createEmptyReadingProgress(
  bookName: string,
  bookId: string,
  totalChapters: number
): ReadingProgressData {
  const now = new Date().toISOString();
  return {
    bookName,
    bookId,
    totalChapters,
    chapterFamiliarity: {},
    totalInteractions: 0,
    coverage: 0,
    absorption: 0,
    created: now,
    lastUpdated: now,
    readingHistory: [
      {
        round: 1,
        started: now.split('T')[0],
        currentRound: true,
      },
    ],
    currentRound: 1,
  };
}

/**
 * 计算覆盖度和吸收度
 */
export function calculateProgressMetrics(
  data: ReadingProgressData
): { coverage: number; absorption: number } {
  const totalChapters = data.totalChapters || 1;
  const benchmark = 3; // 假设每章提及 3 次算"基本吸收"

  // 覆盖度：熟悉度 > 0 的章节数 / 总章节
  const coveredChapters = Object.values(data.chapterFamiliarity).filter(
    (v) => v > 0
  ).length;
  const coverage = Math.round((coveredChapters / totalChapters) * 100);

  // 吸收度：Σ熟悉度 / (总章节 × 基准值)
  const totalFamiliarity = Object.values(data.chapterFamiliarity).reduce(
    (a, b) => a + b,
    0
  );
  const absorption = Math.round(
    (totalFamiliarity / (totalChapters * benchmark)) * 100
  );

  return { coverage, absorption };
}
```

**Step 2: 验证模块编译**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 编译成功，无错误

---

### Task 1.2: 更新 book-note.ts 使用新的数据存储

**Files:**
- Modify: `frontend/src/agent/utils/book-note.ts`

**Step 1: 添加新的阅读进度更新函数**

在文件末尾添加：

```typescript
// ==================== 插件数据目录存储 ====================

import {
  ensurePluginDataDirs,
  readReadingProgress,
  writeReadingProgress,
  createEmptyReadingProgress,
  calculateProgressMetrics,
  type ReadingProgressData,
} from './plugin-data.js';

/**
 * 更新书籍阅读进度（存储到插件数据目录）
 *
 * @param app Obsidian App 实例
 * @param bookName 书名
 * @param bookId 书籍 ID（index_id）
 * @param totalChapters 总章节数
 * @param chapterIndex 章节索引
 * @param delta 增量值
 * @returns 是否更新成功
 */
export async function updateReadingProgress(
  app: App,
  bookName: string,
  bookId: string,
  totalChapters: number,
  chapterIndex: number,
  delta: number
): Promise<boolean> {
  try {
    // 读取现有进度或创建新的
    let progress =
      (await readReadingProgress(app, bookName)) ||
      createEmptyReadingProgress(bookName, bookId, totalChapters);

    // 更新章节熟悉度
    const key = String(chapterIndex);
    progress.chapterFamiliarity[key] =
      (progress.chapterFamiliarity[key] || 0) + delta;

    // 更新总互动次数
    progress.totalInteractions = Object.values(
      progress.chapterFamiliarity
    ).reduce((a, b) => a + b, 0);

    // 计算指标
    const metrics = calculateProgressMetrics(progress);
    progress.coverage = metrics.coverage;
    progress.absorption = metrics.absorption;

    // 写入
    const success = await writeReadingProgress(app, progress);

    if (success) {
      log(
        '[updateReadingProgress]',
        bookName,
        '章节',
        chapterIndex,
        '熟悉度+',
        delta
      );
    }

    return success;
  } catch (err) {
    error('[updateReadingProgress] 更新失败:', err);
    return false;
  }
}

/**
 * 获取书籍阅读进度
 */
export async function getBookReadingProgress(
  app: App,
  bookName: string
): Promise<ReadingProgressData | null> {
  return readReadingProgress(app, bookName);
}
```

**Step 2: 验证编译**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 编译成功

---

### Task 1.3: 迁移现有 frontmatter 数据到插件目录

**Files:**
- Create: `frontend/src/agent/utils/migrate-progress.ts`

**Step 1: 创建迁移脚本**

```typescript
/**
 * 数据迁移工具
 *
 * 将 frontmatter 中的阅读进度数据迁移到插件数据目录
 */

import type { App } from 'obsidian';
import { TFile } from 'obsidian';
import {
  writeReadingProgress,
  createEmptyReadingProgress,
  calculateProgressMetrics,
  type ReadingProgressData,
} from './plugin-data.js';
import { BOOK_NOTES_DIR, getBookNotePath } from './book-note.js';
import { toolsLog as log, error } from '../../utils/logger.js';

interface FrontmatterFamiliarity {
  chapter_familiarity?: Record<string, number>;
  total_interactions?: number;
  last_active?: string;
  index_id?: string;
}

/**
 * 迁移单本书籍的阅读进度
 */
export async function migrateBookProgress(
  app: App,
  bookName: string
): Promise<boolean> {
  const notePath = getBookNotePath(bookName);

  try {
    const file = app.vault.getAbstractFileByPath(notePath);
    if (!file || !(file instanceof TFile)) {
      log('[Migrate] 书籍笔记不存在:', bookName);
      return false;
    }

    // 读取 frontmatter
    const content = await app.vault.read(file);
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) {
      log('[Migrate] 无 frontmatter:', bookName);
      return false;
    }

    // 解析 YAML（简单解析，仅处理基本类型）
    const fm: FrontmatterFamiliarity = {};
    const yamlContent = fmMatch[1];

    // 提取 chapter_familiarity
    const familiarityMatch = yamlContent.match(
      /chapter_familiarity:\s*\n([\s\S]*?)(?=\n\w|\n?$)/
    );
    if (familiarityMatch) {
      const familiarityStr = familiarityMatch[1];
      const entries = familiarityStr.matchAll(/"(\d+)":\s*(\d+)/g);
      for (const match of entries) {
        if (!fm.chapter_familiarity) fm.chapter_familiarity = {};
        fm.chapter_familiarity[match[1]] = parseInt(match[2], 10);
      }
    }

    // 提取其他字段
    const indexIdMatch = yamlContent.match(/index_id:\s*"?([^"\n]+)"?/);
    if (indexIdMatch) fm.index_id = indexIdMatch[1].trim();

    const totalMatch = yamlContent.match(/total_interactions:\s*(\d+)/);
    if (totalMatch) fm.total_interactions = parseInt(totalMatch[1], 10);

    const lastActiveMatch = yamlContent.match(/last_active:\s*"?([^"\n]+)"?/);
    if (lastActiveMatch) fm.last_active = lastActiveMatch[1].trim();

    // 如果没有熟悉度数据，跳过
    if (!fm.chapter_familiarity || Object.keys(fm.chapter_familiarity).length === 0) {
      log('[Migrate] 无熟悉度数据:', bookName);
      return false;
    }

    // 计算总章节数（需要读取书籍索引）
    // 这里暂时使用熟悉度中的最大章节索引 + 1
    const maxChapter = Math.max(
      ...Object.keys(fm.chapter_familiarity).map((k) => parseInt(k, 10))
    );
    const totalChapters = maxChapter + 1;

    // 创建进度数据
    const progress: ReadingProgressData = {
      bookName,
      bookId: fm.index_id || bookName,
      totalChapters,
      chapterFamiliarity: fm.chapter_familiarity,
      totalInteractions: fm.total_interactions || 0,
      coverage: 0,
      absorption: 0,
      created: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      readingHistory: [
        {
          round: 1,
          started: fm.last_active || new Date().toISOString().split('T')[0],
        },
      ],
      currentRound: 1,
    };

    // 计算指标
    const metrics = calculateProgressMetrics(progress);
    progress.coverage = metrics.coverage;
    progress.absorption = metrics.absorption;

    // 写入插件数据目录
    const success = await writeReadingProgress(app, progress);

    if (success) {
      log(
        '[Migrate] 迁移成功:',
        bookName,
        '章节数:',
        Object.keys(fm.chapter_familiarity).length
      );

      // 可选：清理 frontmatter 中的熟悉度字段
      // await cleanupFrontmatter(app, file);
    }

    return success;
  } catch (err) {
    error('[Migrate] 迁移失败:', bookName, err);
    return false;
  }
}

/**
 * 迁移所有书籍的阅读进度
 */
export async function migrateAllProgress(app: App): Promise<{
  success: number;
  failed: number;
  skipped: number;
}> {
  const result = { success: 0, failed: 0, skipped: 0 };

  try {
    const exists = await app.vault.adapter.exists(BOOK_NOTES_DIR);
    if (!exists) {
      log('[Migrate] 书籍笔记目录不存在');
      return result;
    }

    const bookDirs = await app.vault.adapter.list(BOOK_NOTES_DIR);

    for (const bookDir of bookDirs.folders) {
      const bookName = bookDir.split('/').pop() || '';
      const migrated = await migrateBookProgress(app, bookName);

      if (migrated) {
        result.success++;
      } else {
        result.skipped++;
      }
    }

    log('[Migrate] 迁移完成:', result);
    return result;
  } catch (err) {
    error('[Migrate] 批量迁移失败:', err);
    return result;
  }
}
```

**Step 2: 验证编译**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 编译成功

---

## Phase 2: 更新熟悉度工具

### Task 2.1: 更新 familiarity.ts 使用新存储

**Files:**
- Modify: `frontend/src/agent/tools/familiarity.ts`

**Step 1: 修改工具使用插件数据目录**

将 `updateBookFamiliarity` 调用改为 `updateReadingProgress`：

```typescript
// 在文件开头添加导入
import {
  updateReadingProgress,
  getBookReadingProgress,
} from '../utils/book-note.js';

// 修改 execute 函数
async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
  const chapterIndex = args.chapterIndex as number;
  const reason = (args.reason as FamiliarityReason) || 'user_question';
  const delta = (args.delta as number) ?? FAMILIARITY_DELTAS[reason] ?? 1;

  if (typeof chapterIndex !== 'number') {
    return 'Error: chapterIndex 参数必须是数字';
  }

  if (!context.app) {
    return 'Error: Obsidian App 实例不可用';
  }

  if (!context.pdfName) {
    return 'Error: pdfName 不可用，无法更新熟悉度';
  }

  // 获取 indexId 和 totalChapters（从 markdownFiles 或 context）
  const indexId = context.indexId || context.pdfName;
  const totalChapters = context.readingProgress?.totalChapters || 100; // 默认值

  const success = await updateReadingProgress(
    context.app,
    context.pdfName,
    indexId,
    totalChapters,
    chapterIndex,
    delta
  );

  if (success) {
    return `章节 ${chapterIndex} 熟悉度已更新 (+${delta})，原因: ${reason}`;
  } else {
    return `更新熟悉度失败`;
  }
}
```

**Step 2: 验证编译**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 编译成功

---

## Phase 3: 迁移 Memory 系统

### Task 3.1: 更新 ContextLoader 使用插件数据目录

**Files:**
- Modify: `frontend/src/agent/context/loader.ts`

**Step 1: 更新目录常量**

```typescript
// 添加导入
import {
  MEMORY_DATA_DIR,
  MEMORY_ENTRIES_DIR,
  ensurePluginDataDirs,
} from '../utils/plugin-data.js';

// 修改 deepReaderDir 相关代码
// 将 memory 相关路径改为使用插件数据目录

// 修改 loadMemorySummary 方法
private async loadMemorySummary(): Promise<string> {
  const summaryPath = `${MEMORY_DATA_DIR}/summary.md`;

  try {
    const exists = await this.app.vault.adapter.exists(summaryPath);
    if (!exists) {
      return '（暂无记忆摘要）';
    }

    const content = await this.app.vault.adapter.read(summaryPath);
    return content.trim() || '（记忆摘要为空）';
  } catch (err) {
    error('[ContextLoader] Failed to load memory summary:', err);
    return '（无法读取记忆摘要）';
  }
}

// 修改 searchMemory 方法
async searchMemory(query: string): Promise<string[]> {
  const entriesDir = MEMORY_ENTRIES_DIR;

  // ... 其余逻辑不变
}

// 修改 addMemoryEntry 方法
async addMemoryEntry(content: string): Promise<boolean> {
  const entriesDir = MEMORY_ENTRIES_DIR;
  // ... 其余逻辑不变，但先确保目录存在
  await ensurePluginDataDirs(this.app);
  // ... 其余逻辑
}

// 修改 ensureDirectories 方法
async ensureDirectories(): Promise<void> {
  // 确保插件数据目录
  await ensurePluginDataDirs(this.app);

  // 保留 DeepReader 目录（用于用户配置文件）
  const dirs = [this.deepReaderDir];

  for (const dir of dirs) {
    const exists = await this.app.vault.adapter.exists(dir);
    if (!exists) {
      await this.app.vault.createFolder(dir);
      log('[ContextLoader] Created directory:', dir);
    }
  }
}
```

**Step 2: 验证编译**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 编译成功

---

### Task 3.2: 更新 memory.ts 工具

**Files:**
- Modify: `frontend/src/agent/tools/memory.ts`

**Step 1: 更新路径引用**

```typescript
// 添加导入
import {
  MEMORY_DATA_DIR,
  MEMORY_ENTRIES_DIR,
  ensurePluginDataDirs,
} from '../utils/plugin-data.js';

// 修改 createSummarizeMemoryTool 中的路径
async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
  if (!context.app) {
    return 'Error: Obsidian App 实例不可用';
  }

  const loader = new ContextLoader(context.app);

  try {
    // 读取所有记忆条目
    const entriesDir = MEMORY_ENTRIES_DIR;
    // ... 其余逻辑

    // 写入摘要文件
    const summaryPath = `${MEMORY_DATA_DIR}/summary.md`;
    // ... 其余逻辑
  }
}
```

**Step 2: 验证编译**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 编译成功

---

## Phase 4: 更新 ToolContext 和阅读进度感知

### Task 4.1: 扩展 ToolContext 加载阅读进度

**Files:**
- Modify: `frontend/src/agent/tools/types.ts`

**Step 1: 确认 ReadingProgress 接口**

文件中已有 `ReadingProgress` 接口，确保与新数据结构一致。

**Step 2: 无需修改（已有定义）**

---

### Task 4.2: 在构建 ToolContext 时加载阅读进度

**Files:**
- Modify: `frontend/src/main.ts`

**Step 1: 找到 ToolContext 构建位置并添加阅读进度加载**

```typescript
// 添加导入
import {
  getBookReadingProgress,
  calculateProgressMetrics,
} from './agent/utils/book-note.js';

// 在构建 ToolContext 的地方添加
async buildToolContext(): Promise<ToolContext> {
  // ... 现有代码

  // 加载阅读进度
  let readingProgress: ReadingProgress | undefined;
  if (this.app && this.pdfName) {
    const progressData = await getBookReadingProgress(this.app, this.pdfName);
    if (progressData) {
      // 找到最熟悉的章节
      const familiarity = progressData.chapterFamiliarity;
      const entries = Object.entries(familiarity);
      const mostFamiliar = entries.reduce(
        (a, b) => (b[1] > a[1] ? b : a),
        ['0', 0]
      );
      const leastFamiliar = entries
        .filter(([, v]) => v === 0)
        .map(([k]) => k);

      readingProgress = {
        bookName: progressData.bookName,
        totalChapters: progressData.totalChapters,
        chapterFamiliarity: familiarity,
        totalInteractions: progressData.totalInteractions,
        coverage: progressData.coverage,
        absorption: progressData.absorption,
        mostFamiliarChapter: mostFamiliar[0],
        leastFamiliarChapters: leastFamiliar,
        lastActiveTime: progressData.lastUpdated,
        daysSinceLastRead: Math.floor(
          (Date.now() - new Date(progressData.lastUpdated).getTime()) /
            (1000 * 60 * 60 * 24)
        ),
      };
    }
  }

  return {
    indexId: this.indexId,
    pdfName: this.pdfName,
    markdownFiles: this.markdownFiles,
    useLLMTreeSearch: this.useLLMTreeSearch,
    app: this.app,
    readingProgress,
  };
}
```

**Step 2: 验证编译**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 编译成功

---

## Phase 5: 更新 System Prompt

### Task 5.1: 添加阅读进度感知指引

**Files:**
- Modify: `frontend/src/agent/prompts/system.ts`

**Step 1: 添加阅读进度感知部分**

在 System Prompt 中添加：

```typescript
// 在 buildSystemPrompt 函数中添加
const READING_PROGRESS_GUIDE = `
## 阅读进度感知

用户可能会问"读到哪了"、"我理解了多少"。你可以：

1. **告知进度** - 使用覆盖度和吸收度两个指标
   - "您已经涉及了 70% 的章节，整体吸收度约 77%"
   - "最熟悉的是第三章（8次互动），建议深入第五、八章"

2. **建议下一步** - 推荐阅读未涉及的章节
   - "您还没涉及第五章，那里讨论了..."

3. **回顾上次** - 如果有上次对话记录，简要回顾关键内容

4. **阅读目标** - 如果用户设定了目标，提醒进度状态
`;
```

**Step 2: 验证编译**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 编译成功

---

## Phase 6: 清理不匹配的旧代码

### Task 6.1: 清理 book-note.ts 中的旧 frontmatter 熟悉度函数

**Files:**
- Modify: `frontend/src/agent/utils/book-note.ts`

**Step 1: 标记旧函数为 deprecated**

```typescript
/**
 * 更新书籍笔记的章节熟悉度
 * @deprecated 请使用 updateReadingProgress，数据已迁移到插件数据目录
 */
export async function updateBookFamiliarity(
  app: App,
  bookName: string,
  chapterIndex: number,
  delta: number
): Promise<boolean> {
  // 转发到新函数
  const indexId = bookName; // 简化处理
  const totalChapters = 100; // 默认值
  return updateReadingProgress(app, bookName, indexId, totalChapters, chapterIndex, delta);
}
```

**Step 2: 验证编译**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 编译成功

---

### Task 6.2: 清理旧 memory 路径检查

**Files:**
- Modify: `frontend/src/agent/tools/memory.ts`

**Step 1: 移除旧的 DeepReader/memory 路径引用**

确保所有路径都使用 `MEMORY_DATA_DIR` 和 `MEMORY_ENTRIES_DIR`。

**Step 2: 验证编译**

Run: `cd /Users/lizhao/workspace/DeepReader/frontend && npm run build`
Expected: 编译成功

---

## Phase 7: 集成测试

### Task 7.1: 手动测试迁移功能

**Steps:**
1. 在 Obsidian 中重新加载插件
2. 打开一本已读书籍
3. 使用 AI 对话功能，触发熟悉度更新
4. 检查 `.obsidian/plugins/deepreader/data/reading-progress/` 是否生成 JSON 文件
5. 验证文件内容正确

### Task 7.2: 测试 memory 系统迁移

**Steps:**
1. 添加新记忆条目
2. 检查 `.obsidian/plugins/deepreader/data/memory/entries/` 是否有新文件
3. 测试搜索记忆功能

---

## 执行选项

**Plan complete and saved to `docs/plans/2026-03-11-user-insight-implementation.md`. Two execution options:**

**1. Subagent-Driven (this session)** - I dispatch fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** - Open new session with executing-plans, batch execution with checkpoints

**Which approach?**
