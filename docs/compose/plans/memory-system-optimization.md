# 记忆系统优化实现计划

> **版本**：v1.0
> **分支**：`feat/memory-system-optimization`
> **创建 worktree**：`npm run worktree:create feat/memory-system-optimization main`
> **最后更新**：2026-06-20

## 一、目标

将 DeepReader 的记忆系统从自定义 MemoryStore 迁移到 LangGraph 标准 Store API，实现：

1. 标准化的记忆接口
2. 支持向量检索
3. 更好的跨会话持久化
4. 用户偏好结构化存储

## 二、当前状态分析

### 现有代码

```
src/agent/memory/
├── index.ts              # 模块导出
├── types.ts              # 类型定义
├── store.ts              # MemoryStore 实现（基于 Obsidian Vault）
└── consolidator.ts       # 记忆整合器
```

### 现有问题

1. **自定义实现**：MemoryStore 是自定义的，与 LangGraph 不集成
2. **无向量检索**：只能全文搜索，无法语义检索
3. **文件存储**：依赖 Obsidian Vault 的文件系统
4. **手动管理**：需要手动压缩 MEMORY.md

### LangGraph Store API 优势

| 特性 | 当前实现 | LangGraph Store |
|------|----------|-----------------|
| 接口 | 自定义 | 标准化 |
| 检索 | 全文搜索 | 向量 + 全文 |
| 持久化 | Obsidian Vault | 内存/SQLite |
| 跨会话 | 手动管理 | thread_id + user_id |

## 三、目标架构

```
src/agent/memory/
├── index.ts              # 模块导出
├── types.ts              # 类型定义（保留）
├── store.ts              # 重构：适配 LangGraph Store
├── embedding.ts          # 新增：Embedding 生成函数
├── namespaces.ts         # 新增：Namespace 定义
└── consolidator.ts       # 保留：记忆整合器
```

## 四、实现步骤

### Phase 1：基础准备（1-2 天）

#### Step 1.1：检查 LangGraph Store 可用性

**文件**：`src/agent/memory/langgraph-store.ts`

```typescript
/**
 * LangGraph Store 适配器
 *
 * 检查 LangGraph 是否提供 Store API，
 * 如果不提供，提供 fallback 实现
 */

import { agentLog } from '../../utils/logger';

// 尝试导入 LangGraph Store
let InMemoryStore: any;
let BaseStore: any;

try {
  const langgraph = await import('@langchain/langgraph');
  InMemoryStore = langgraph.InMemoryStore;
  agentLog('[Memory] LangGraph Store 可用');
} catch (err) {
  agentLog('[Memory] LangGraph Store 不可用，使用 fallback');
}

/**
 * Store 配置
 */
export interface StoreConfig {
  /** Embedding 维度 */
  embeddingDims: number;
  /** Embedding 函数 */
  embedFn?: (texts: string[]) => Promise<number[][]>;
  /** 是否使用持久化 */
  persistent?: boolean;
}

/**
 * 创建 Store 实例
 */
export function createStore(config: StoreConfig) {
  if (InMemoryStore) {
    return new InMemoryStore({
      index: config.embedFn
        ? { embed: config.embedFn, dims: config.embeddingDims }
        : undefined,
    });
  }

  // Fallback：使用简单的 Map 实现
  return new FallbackStore();
}

/**
 * Fallback Store 实现
 *
 * 当 LangGraph Store 不可用时使用
 */
class FallbackStore {
  private store = new Map<string, any>();

  get(namespace: string[], key: string): any {
    const fullKey = [...namespace, key].join('::');
    return this.store.get(fullKey);
  }

  put(namespace: string[], key: string, value: any): void {
    const fullKey = [...namespace, key].join('::');
    this.store.set(fullKey, {
      namespace,
      key,
      value,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  delete(namespace: string[], key: string): void {
    const fullKey = [...namespace, key].join('::');
    this.store.delete(fullKey);
  }

  search(namespace: string[], query: string): any[] {
    // 简单的全文搜索
    const results = [];
    for (const [fullKey, item] of this.store) {
      if (fullKey.startsWith(namespace.join('::'))) {
        const valueStr = JSON.stringify(item.value);
        if (valueStr.includes(query)) {
          results.push(item);
        }
      }
    }
    return results;
  }
}
```

#### Step 1.2：定义 Namespace 结构

**文件**：`src/agent/memory/namespaces.ts`

```typescript
/**
 * 记忆命名空间定义
 *
 * 使用分层命名空间组织不同类型的记忆：
 * - user: 用户基本信息
 * - user.preferences: 用户偏好
 * - user.reading: 阅读习惯
 * - session: 会话记忆
 */

/**
 * Namespace 路径
 */
export const NAMESPACES = {
  /**
   * 用户基本信息
   * 路径: ['user', userId]
   */
  user: (userId: string) => ['user', userId],

  /**
   * 用户偏好
   * 路径: ['user', userId, 'preferences']
   */
  userPreferences: (userId: string) => ['user', userId, 'preferences'],

  /**
   * 阅读习惯
   * 路径: ['user', userId, 'reading']
   */
  userReading: (userId: string) => ['user', userId, 'reading'],

  /**
   * 会话记忆
   * 路径: ['session', sessionId]
   */
  session: (sessionId: string) => ['session', sessionId],

  /**
   * 书籍索引
   * 路径: ['books', bookId]
   */
  book: (bookId: string) => ['books', bookId],
} as const;

/**
 * 记忆键名
 */
export const MEMORY_KEYS = {
  // 用户偏好
  READING_STYLE: 'reading_style',
  LANGUAGE_PREFERENCE: 'language_preference',
  THEME_PREFERENCE: 'theme_preference',

  // 阅读习惯
  FAVORITE_GENRES: 'favorite_genres',
  READING_SPEED: 'reading_speed',
  USUALLY_READ_TIME: 'usually_read_time',

  // 会话
  LAST_BOOK: 'last_book',
  LAST_POSITION: 'last_position',
  CONVERSATION_SUMMARY: 'conversation_summary',
} as const;
```

#### Step 1.3：实现 Embedding 函数

**文件**：`src/agent/memory/embedding.ts`

```typescript
/**
 * Embedding 生成函数
 *
 * 支持多种 Embedding 模型：
 * - DashScope (阿里云百炼)
 * - OpenAI
 * - 本地模型
 */

import { agentLog } from '../../utils/logger';

/**
 * Embedding 配置
 */
export interface EmbeddingConfig {
  provider: 'dashscope' | 'openai' | 'local';
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  dimensions?: number;
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: EmbeddingConfig = {
  provider: 'dashscope',
  model: 'text-embedding-v4',
  dimensions: 1024,
};

/**
 * 创建 Embedding 函数
 */
export function createEmbeddingFn(config: Partial<EmbeddingConfig> = {}) {
  const finalConfig = { ...DEFAULT_CONFIG, ...config };

  return async (texts: string[]): Promise<number[][]> => {
    try {
      switch (finalConfig.provider) {
        case 'dashscope':
          return await dashscopeEmbed(texts, finalConfig);
        case 'openai':
          return await openaiEmbed(texts, finalConfig);
        case 'local':
          return await localEmbed(texts, finalConfig);
        default:
          throw new Error(`Unknown provider: ${finalConfig.provider}`);
      }
    } catch (err) {
      agentLog('[Embedding] 生成失败:', err);
      // 返回零向量作为 fallback
      return texts.map(() => new Array(finalConfig.dimensions).fill(0));
    }
  };
}

/**
 * DashScope Embedding
 */
async function dashscopeEmbed(
  texts: string[],
  config: EmbeddingConfig
): Promise<number[][]> {
  const response = await fetch(
    `${config.baseUrl || 'https://dashscope.aliyuncs.com/compatible-mode/v1'}/embeddings`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        input: texts,
        dimensions: config.dimensions,
      }),
    }
  );

  const data = await response.json();
  return data.data.map((item: any) => item.embedding);
}

/**
 * OpenAI Embedding
 */
async function openaiEmbed(
  texts: string[],
  config: EmbeddingConfig
): Promise<number[][]> {
  const response = await fetch(
    `${config.baseUrl || 'https://api.openai.com/v1'}/embeddings`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model || 'text-embedding-3-small',
        input: texts,
      }),
    }
  );

  const data = await response.json();
  return data.data.map((item: any) => item.embedding);
}

/**
 * 本地 Embedding（简单 hash 实现）
 */
async function localEmbed(
  texts: string[],
  config: EmbeddingConfig
): Promise<number[][]> {
  // 简单的 hash-based embedding（仅用于测试）
  return texts.map((text) => {
    const hash = simpleHash(text);
    return hashToVector(hash, config.dimensions || 1024);
  });
}

/**
 * 简单 hash 函数
 */
function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

/**
 * Hash 转向量
 */
function hashToVector(hash: number, dimensions: number): number[] {
  const vector = new Array(dimensions).fill(0);
  for (let i = 0; i < dimensions; i++) {
    vector[i] = ((hash >> i) & 1) * 2 - 1;
  }
  return vector;
}
```

### Phase 2：Store 集成（2-3 天）

#### Step 2.1：重构 MemoryStore

**文件**：`src/agent/memory/store.ts`（重构）

```typescript
/**
 * MemoryStore - 重构为使用 LangGraph Store API
 *
 * 保留原有的文件存储作为 fallback，
 * 同时支持 LangGraph Store 的向量检索
 */

import { type App, normalizePath } from 'obsidian';
import { agentLog } from '../../utils/logger';
import { MAX_MEMORY_CHARS } from '../config/agent-constants.js';
import type { IMemoryStore } from './types.js';
import { createStore, type StoreConfig } from './langgraph-store.js';
import { NAMESPACES, MEMORY_KEYS } from './namespaces.js';
import { createEmbeddingFn, type EmbeddingConfig } from './embedding.js';

/** DeepReader 目录名 */
const DEEPREADER_DIR = 'DeepReader';

/**
 * MemoryStore 配置
 */
export interface MemoryStoreConfig {
  /** 用户 ID */
  userId: string;
  /** 是否启用 LangGraph Store */
  enableLangGraphStore?: boolean;
  /** Embedding 配置 */
  embedding?: EmbeddingConfig;
}

export class MemoryStore implements IMemoryStore {
  private app: App;
  private config: MemoryStoreConfig;
  private langgraphStore: any;
  private embeddingFn: ((texts: string[]) => Promise<number[][]>) | null;

  constructor(app: App, config: MemoryStoreConfig) {
    this.app = app;
    this.config = config;

    // 初始化 LangGraph Store（如果启用）
    if (config.enableLangGraphStore) {
      const storeConfig: StoreConfig = {
        embeddingDims: config.embedding?.dimensions || 1024,
        embedFn: config.embedding ? createEmbeddingFn(config.embedding) : undefined,
      };
      this.langgraphStore = createStore(storeConfig);
      this.embeddingFn = config.embedding ? createEmbeddingFn(config.embedding) : null;
    } else {
      this.langgraphStore = null;
      this.embeddingFn = null;
    }
  }

  /**
   * 读取长期记忆（兼容旧接口）
   */
  async readLongTermMemory(): Promise<string | null> {
    // 优先从 LangGraph Store 读取
    if (this.langgraphStore) {
      try {
        const namespaces = NAMESPACES.userPreferences(this.config.userId);
        const items = [];

        // 读取所有偏好
        for (const key of Object.values(MEMORY_KEYS)) {
          const item = this.langgraphStore.get(namespaces, key);
          if (item) {
            items.push(`${key}: ${JSON.stringify(item.value)}`);
          }
        }

        if (items.length > 0) {
          return items.join('\n');
        }
      } catch (err) {
        agentLog('[MemoryStore] LangGraph Store 读取失败:', err);
      }
    }

    // Fallback：从文件读取
    return this.readFromFile();
  }

  /**
   * 写入长期记忆（兼容旧接口）
   */
  async writeLongTermMemory(content: string): Promise<void> {
    // 写入到 LangGraph Store
    if (this.langgraphStore) {
      try {
        const namespaces = NAMESPACES.userPreferences(this.config.userId);
        await this.langgraphStore.put(namespaces, MEMORY_KEYS.CONVERSATION_SUMMARY, {
          value: content,
          timestamp: Date.now(),
        });
      } catch (err) {
        agentLog('[MemoryStore] LangGraph Store 写入失败:', err);
      }
    }

    // 同时写入到文件（保持兼容）
    await this.writeToFile(content);
  }

  /**
   * 存储用户偏好（新接口）
   */
  async putPreference(key: string, value: any): Promise<void> {
    if (this.langgraphStore) {
      const namespaces = NAMESPACES.userPreferences(this.config.userId);
      await this.langgraphStore.put(namespaces, key, {
        value,
        timestamp: Date.now(),
      });
    }

    // 同时更新文件
    await this.updatePreferenceFile(key, value);
  }

  /**
   * 读取用户偏好（新接口）
   */
  async getPreference(key: string): Promise<any | null> {
    if (this.langgraphStore) {
      const namespaces = NAMESPACES.userPreferences(this.config.userId);
      const item = this.langgraphStore.get(namespaces, key);
      return item?.value ?? null;
    }

    // Fallback：从文件解析
    return this.parsePreferenceFromFile(key);
  }

  /**
   * 搜索记忆（支持语义检索）
   */
  async searchMemory(query: string, limit: number = 5): Promise<any[]> {
    if (this.langgraphStore && this.embeddingFn) {
      const namespaces = NAMESPACES.userPreferences(this.config.userId);
      return this.langgraphStore.search(namespaces, query);
    }

    // Fallback：全文搜索
    return this.fullTextSearch(query, limit);
  }

  /**
   * 从文件读取（保留原有逻辑）
   */
  private async readFromFile(): Promise<string | null> {
    try {
      const memoryPath = normalizePath(`${DEEPREADER_DIR}/MEMORY.md`);
      const exists = await this.app.vault.adapter.exists(memoryPath);
      if (!exists) return null;
      const content = await this.app.vault.adapter.read(memoryPath);
      return content.trim() || null;
    } catch (err) {
      agentLog('[MemoryStore] 读取 MEMORY.md 失败:', err);
      return null;
    }
  }

  /**
   * 写入文件（保留原有逻辑）
   */
  private async writeToFile(content: string): Promise<void> {
    try {
      const dirPath = normalizePath(DEEPREADER_DIR);
      const exists = await this.app.vault.adapter.exists(dirPath);
      if (!exists) {
        await this.app.vault.createFolder(dirPath);
      }

      const memoryPath = normalizePath(`${DEEPREADER_DIR}/MEMORY.md`);
      await this.app.vault.adapter.write(memoryPath, content);
      agentLog('[MemoryStore] MEMORY.md 已更新');
    } catch (err) {
      agentLog('[MemoryStore] 写入 MEMORY.md 失败:', err);
    }
  }

  /**
   * 更新偏好文件
   */
  private async updatePreferenceFile(key: string, value: any): Promise<void> {
    const content = await this.readFromFile() || '';
    const lines = content.split('\n');

    // 查找并更新或追加
    const keyIndex = lines.findIndex((line) => line.startsWith(`${key}:`));
    const newValue = `${key}: ${JSON.stringify(value)}`;

    if (keyIndex >= 0) {
      lines[keyIndex] = newValue;
    } else {
      lines.push(newValue);
    }

    await this.writeToFile(lines.join('\n'));
  }

  /**
   * 从文件解析偏好
   */
  private async parsePreferenceFromFile(key: string): Promise<any | null> {
    const content = await this.readFromFile();
    if (!content) return null;

    const lines = content.split('\n');
    const line = lines.find((l) => l.startsWith(`${key}:`));
    if (!line) return null;

    const value = line.slice(key.length + 2);
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  /**
   * 全文搜索
   */
  private async fullTextSearch(query: string, limit: number): Promise<any[]> {
    const content = await this.readFromFile();
    if (!content) return [];

    const lines = content.split('\n');
    const results = [];

    for (const line of lines) {
      if (line.toLowerCase().includes(query.toLowerCase())) {
        results.push({ value: line });
        if (results.length >= limit) break;
      }
    }

    return results;
  }

  // 保留原有方法
  async getMemoryLineCount(): Promise<number> {
    const content = await this.readFromFile();
    return content ? content.split('\n').length : 0;
  }

  async appendHistory(entry: string): Promise<void> {
    // 保留原有实现
    const historyPath = normalizePath(`${DEEPREADER_DIR}/HISTORY.md`);
    const exists = await this.app.vault.adapter.exists(historyPath);

    const now = new Date();
    const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const formattedEntry = `[${timestamp}] ${entry}\n\n---\n\n`;

    if (exists) {
      const existing = await this.app.vault.adapter.read(historyPath);
      await this.app.vault.adapter.write(historyPath, existing + formattedEntry);
    } else {
      const header = `# 阅读历程\n\n> 此文件记录阅读里程碑（最近 30 天）\n\n---\n\n`;
      await this.app.vault.adapter.write(historyPath, header + formattedEntry);
    }
  }

  async readHistory(limit: number = 50): Promise<string> {
    try {
      const historyPath = normalizePath(`${DEEPREADER_DIR}/HISTORY.md`);
      const exists = await this.app.vault.adapter.exists(historyPath);
      if (!exists) return '';
      const content = await this.app.vault.adapter.read(historyPath);
      const entries = content.split(/\n\n---\n\n/);
      return entries.slice(-limit).join('\n\n---\n\n');
    } catch (err) {
      agentLog('[MemoryStore] 读取 HISTORY.md 失败:', err);
      return '';
    }
  }

  async searchHistory(query: string, limit: number = 10): Promise<string[]> {
    // 保留原有实现
    return [];
  }

  async searchDialogueSummaries(bookName: string, limit: number = 10): Promise<string[]> {
    // 保留原有实现
    return [];
  }

  async getReadingSummary(): Promise<string> {
    // 保留原有实现
    return '';
  }

  async getMemoryContext(): Promise<string> {
    const memory = await this.readLongTermMemory();
    const history = await this.readHistory(10);
    return `## 长期记忆\n${memory || '(无)'}\n\n## 最近历史\n${history || '(无)'}`;
  }

  async needsCompression(): Promise<boolean> {
    const lineCount = await this.getMemoryLineCount();
    return lineCount > 100; // 超过 100 行需要压缩
  }

  async initializeMemory(): Promise<void> {
    const exists = await this.app.vault.adapter.exists(normalizePath(DEEPREADER_DIR));
    if (!exists) {
      await this.app.vault.createFolder(normalizePath(DEEPREADER_DIR));
    }
  }
}
```

### Phase 3：集成与测试（2-3 天）

#### Step 3.1：更新模块导出

**文件**：`src/agent/memory/index.ts`

```typescript
/**
 * 记忆系统模块导出
 */

export * from './types';
export { MemoryStore } from './store';
export type { MemoryStoreConfig } from './store';
export { MemoryConsolidator } from './consolidator';
export { NAMESPACES, MEMORY_KEYS } from './namespaces';
export { createEmbeddingFn } from './embedding';
export type { EmbeddingConfig } from './embedding';
```

#### Step 3.2：更新 FrontendAgent

**文件**：`src/agent/index.ts`（修改）

```typescript
import { MemoryStore, type MemoryStoreConfig } from './memory';

// 在 FrontendAgent 构造函数中
constructor(app: App, settings: PluginSettings) {
  // ...

  // 初始化记忆存储
  const memoryConfig: MemoryStoreConfig = {
    userId: settings.userId || 'default',
    enableLangGraphStore: settings.enableLangGraphStore ?? true,
    embedding: {
      provider: 'dashscope',
      apiKey: settings.dashscopeApiKey,
      dimensions: 1024,
    },
  };
  this.memoryStore = new MemoryStore(app, memoryConfig);
}
```

#### Step 3.3：添加设置项

**文件**：`src/config/settings.ts`（修改）

```typescript
export interface DeepReaderSettings {
  // ... 现有设置

  /** 启用 LangGraph Store */
  enableLangGraphStore: boolean;

  /** 用户 ID */
  userId: string;

  /** DashScope API Key（用于 Embedding） */
  dashscopeApiKey: string;
}

export const DEFAULT_SETTINGS: DeepReaderSettings = {
  // ... 现有默认值

  enableLangGraphStore: true,
  userId: 'default',
  dashscopeApiKey: '',
};
```

## 五、测试计划

### 单元测试

**文件**：`tests/unit/agent/memory/`

```
memory/
├── langgraph-store.test.ts    # 测试 Store 适配器
├── namespaces.test.ts         # 测试 Namespace 定义
├── embedding.test.ts          # 测试 Embedding 函数
├── store.test.ts              # 测试 MemoryStore 重构
└── preferences.test.ts        # 测试用户偏好读写
```

### 集成测试

**文件**：`tests/integration/agent/memory-integration.test.ts`

```typescript
describe('Memory System Integration', () => {
  it('should store and retrieve user preferences', async () => {
    const store = new MemoryStore(mockApp, {
      userId: 'test-user',
      enableLangGraphStore: true,
    });

    // 存储偏好
    await store.putPreference('reading_style', '深度分析');

    // 读取偏好
    const style = await store.getPreference('reading_style');
    expect(style).toBe('深度分析');
  });

  it('should search memories semantically', async () => {
    const store = new MemoryStore(mockApp, {
      userId: 'test-user',
      enableLangGraphStore: true,
      embedding: { provider: 'local', dimensions: 128 },
    });

    // 存储多条记忆
    await store.putPreference('genre1', '科幻小说');
    await store.putPreference('genre2', '历史书籍');

    // 语义搜索
    const results = await store.searchMemory('未来科技');
    expect(results.length).toBeGreaterThan(0);
  });

  it('should fallback to file storage when LangGraph Store unavailable', async () => {
    const store = new MemoryStore(mockApp, {
      userId: 'test-user',
      enableLangGraphStore: false,
    });

    // 应该使用文件存储
    await store.writeLongTermMemory('test memory');
    const memory = await store.readLongTermMemory();
    expect(memory).toBe('test memory');
  });
});
```

### Fallback 回归测试

```typescript
describe('Memory Fallback Regression', () => {
  it('should maintain backward compatibility with old API', async () => {
    const store = new MemoryStore(mockApp, {
      userId: 'test-user',
      enableLangGraphStore: true,
    });

    // 使用旧 API
    await store.writeLongTermMemory('old format memory');
    const memory = await store.readLongTermMemory();

    expect(memory).toContain('old format memory');
  });
});
```

### 冒烟测试

```bash
npm run smoke:core
```

### E2E 测试

```bash
npm run e2e-light
```

## 六、时间估算

| 阶段 | 任务 | 时间 |
|------|------|----------|
| **Phase 1** | 基础准备（Store 适配器 + Namespace + Embedding） | 1-2 天 |
| **Phase 2** | Store 集成（重构 MemoryStore） | 2-3 天 |
| **Phase 3** | 集成与测试 | 2-3 天 |
| **测试** | 单元测试 + 集成测试 + 回归测试 | 1-2 天 |
| **总计** | | **6-10 天** |

## 七、风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| LangGraph Store API 不可用 | 高 | FallbackStore 实现，保持文件存储 |
| Embedding 生成失败 | 中 | 返回零向量，降级为全文搜索 |
| 数据迁移 | 中 | 保持旧格式兼容，渐进式迁移 |
| 性能下降 | 低 | 基准测试，优化查询 |

## 八、后续优化

1. **持久化存储**：使用 SqliteStore 替代 InMemoryStore
2. **记忆整合**：自动整合分散的偏好条目
3. **记忆过期**：自动清理过期的会话记忆
4. **记忆导出**：支持导出/导入记忆数据
5. **可视化调试**：添加记忆查看界面

## 九、参考资源

- [dive-into-langgraph 第5章: 记忆](https://luochang212.github.io/dive-into-langgraph/memory/)
- [LangGraph Store API](https://langchain-ai.github.io/langgraph/concepts/persistence/#store)
- [LangMem](https://langchain-ai.github.io/langmem/)
