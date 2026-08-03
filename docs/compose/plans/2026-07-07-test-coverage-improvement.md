# 测试覆盖率提升实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 DeepReader 项目补充单元测试，将整体文件级覆盖率从 43% 提升至 65%+

**Architecture:** 按模块分批补充测试，优先覆盖核心业务逻辑和工具函数，遵循现有测试模式（Vitest + jsdom + Mock Obsidian API）

**Tech Stack:** Vitest, TypeScript, jsdom

## Global Constraints

- 测试文件位置: `tests/unit/<module>/`
- 路径别名: `@` → `./src`, `@tests` → `./tests`
- Mock: `tests/__mocks__/obsidian.ts` 提供 TFile/TFolder/App/Notice 等
- Setup: `tests/setup.ts` 挂载 Obsidian DOM 扩展方法
- 环境: jsdom, globals: true
- 运行: `npm run test:run`

---

## Phase 1: utils 模块 (25% → 60%)

### Task 1.1: 补充 utils/time.ts 测试

**Covers:** utils 模块时间工具函数

**Files:**
- Create: `tests/unit/utils/time.test.ts`
- Reference: `src/utils/time.ts`

**Interfaces:**
- Consumes: 时间格式化/解析函数
- Produces: 测试覆盖时间工具

- [ ] **Step 1: 查看源码了解函数签名**

```bash
cat src/utils/time.ts
```

- [ ] **Step 2: 编写测试**

```typescript
import { describe, it, expect } from 'vitest';
// import { formatTime, parseTime } from '@/utils/time';

describe('time utils', () => {
  it('should format timestamp to readable string', () => {
    // Arrange & Act & Assert
  });

  it('should parse time string to milliseconds', () => {
    // Arrange & Act & Assert
  });
});
```

- [ ] **Step 3: 运行测试确认失败**

Run: `npx vitest run tests/unit/utils/time.test.ts`

- [ ] **Step 4: 实现最小代码**

- [ ] **Step 5: 运行测试确认通过**

Run: `npx vitest run tests/unit/utils/time.test.ts`

---

### Task 1.2: 补充 utils/error-handler.ts 测试

**Covers:** utils 模块错误处理

**Files:**
- Create: `tests/unit/utils/error-handler.test.ts`
- Reference: `src/utils/error-handler.ts`

- [ ] **Step 1: 查看源码了解函数签名**

```bash
cat src/utils/error-handler.ts
```

- [ ] **Step 2: 编写测试**

```typescript
import { describe, it, expect, vi } from 'vitest';
// import { handleError } from '@/utils/error-handler';

describe('error-handler', () => {
  it('should handle Error objects', () => {
    // Arrange & Act & Assert
  });

  it('should handle string errors', () => {
    // Arrange & Act & Assert
  });

  it('should log error to console', () => {
    // Arrange & Act & Assert
  });
});
```

- [ ] **Step 3-5:** 同 Task 1.1

---

### Task 1.3: 补充 utils/markdown-utils.ts 测试

**Covers:** utils 模块 Markdown 处理

**Files:**
- Create: `tests/unit/utils/markdown-utils.test.ts`
- Reference: `src/utils/markdown-utils.ts`

- [ ] **Step 1: 查看源码**

```bash
cat src/utils/markdown-utils.ts
```

- [ ] **Step 2: 编写测试**

```typescript
import { describe, it, expect } from 'vitest';
// import { extractHeadings, stripMarkdown } from '@/utils/markdown-utils';

describe('markdown-utils', () => {
  it('should extract headings from markdown', () => {
    const md = '# Title\n## Subtitle\nContent';
    // expect(extractHeadings(md)).toEqual(['Title', 'Subtitle']);
  });

  it('should strip markdown formatting', () => {
    const md = '**bold** and *italic*';
    // expect(stripMarkdown(md)).toBe('bold and italic');
  });
});
```

- [ ] **Step 3-5:** 同 Task 1.1

---

## Phase 2: settings 模块 (18% → 50%)

### Task 2.1: 补充 settings/types.ts 测试

**Covers:** settings 模块类型定义验证

**Files:**
- Create: `tests/unit/settings/types.test.ts`
- Reference: `src/settings/types.ts`

- [ ] **Step 1: 查看源码**

```bash
cat src/settings/types.ts
```

- [ ] **Step 2: 编写测试**

```typescript
import { describe, it, expect } from 'vitest';
// import { DEFAULT_SETTINGS } from '@/settings/types';

describe('settings types', () => {
  it('should have valid default settings', () => {
    // expect(DEFAULT_SETTINGS).toBeDefined();
    // expect(typeof DEFAULT_SETTINGS.apiKey).toBe('string');
  });

  it('should have required fields', () => {
    // expect(DEFAULT_SETTINGS).toHaveProperty('provider');
    // expect(DEFAULT_SETTINGS).toHaveProperty('model');
  });
});
```

- [ ] **Step 3-5:** 同 Task 1.1

---

### Task 2.2: 补充 settings/helpers.ts 测试

**Covers:** settings 模块辅助函数

**Files:**
- Create: `tests/unit/settings/helpers.test.ts`
- Reference: `src/settings/helpers.ts`

- [ ] **Step 1: 查看源码**

```bash
cat src/settings/helpers.ts
```

- [ ] **Step 2: 编写测试**

```typescript
import { describe, it, expect } from 'vitest';
// import { getProviderApiKey, getModelDisplayName } from '@/settings/helpers';

describe('settings helpers', () => {
  it('should get provider api key', () => {
    // Arrange & Act & Assert
  });

  it('should get model display name', () => {
    // Arrange & Act & Assert
  });
});
```

- [ ] **Step 3-5:** 同 Task 1.1

---

## Phase 3: pageindex 模块 (35% → 55%)

### Task 3.1: 补充 pageindex/paths.ts 测试

**Covers:** pageindex 模块路径处理

**Files:**
- Create: `tests/unit/pageindex/paths.test.ts`
- Reference: `src/pageindex/paths.ts`

- [ ] **Step 1: 查看源码**

```bash
cat src/pageindex/paths.ts
```

- [ ] **Step 2: 编写测试**

```typescript
import { describe, it, expect } from 'vitest';
// import { getBookPath, getIndexPath } from '@/pageindex/paths';

describe('pageindex paths', () => {
  it('should generate correct book path', () => {
    // expect(getBookPath('book-id')).toBe('DeepReader/Books/book-id');
  });

  it('should generate correct index path', () => {
    // expect(getIndexPath('book-id')).toBe('DeepReader/Indexes/book-id');
  });
});
```

- [ ] **Step 3-5:** 同 Task 1.1

---

### Task 3.2: 补充 pageindex/bm25.ts 测试

**Covers:** pageindex 模块 BM25 搜索算法

**Files:**
- Create: `tests/unit/pageindex/bm25.test.ts`
- Reference: `src/pageindex/bm25.ts`

- [ ] **Step 1: 查看源码**

```bash
cat src/pageindex/bm25.ts
```

- [ ] **Step 2: 编写测试**

```typescript
import { describe, it, expect } from 'vitest';
// import { BM25 } from '@/pageindex/bm25';

describe('BM25 search', () => {
  it('should rank relevant documents higher', () => {
    const docs = ['hello world', 'foo bar', 'hello foo'];
    const bm25 = new BM25(docs);
    const results = bm25.search('hello');
    // expect(results[0].index).toBe(0); // 'hello world' should rank first
  });

  it('should return empty array for no matches', () => {
    const docs = ['hello world'];
    const bm25 = new BM25(docs);
    const results = bm25.search('xyz');
    // expect(results).toHaveLength(0);
  });
});
```

- [ ] **Step 3-5:** 同 Task 1.1

---

### Task 3.3: 补充 pageindex/core/utils.ts 测试

**Covers:** pageindex 模块核心工具

**Files:**
- Create: `tests/unit/pageindex/core-utils.test.ts`
- Reference: `src/pageindex/core/utils.ts`

- [ ] **Step 1: 查看源码**

```bash
cat src/pageindex/core/utils.ts
```

- [ ] **Step 2: 编写测试**

```typescript
import { describe, it, expect } from 'vitest';
// import { chunkText, countTokens } from '@/pageindex/core/utils';

describe('pageindex core utils', () => {
  it('should chunk text by max length', () => {
    // const chunks = chunkText('hello world foo bar', 10);
    // expect(chunks.length).toBeGreaterThan(1);
  });

  it('should count tokens approximately', () => {
    // const count = countTokens('hello world');
    // expect(count).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3-5:** 同 Task 1.1

---

## Phase 4: components 模块 (44% → 60%)

### Task 4.1: 补充 components/message/utils.ts 测试

**Covers:** components 模块消息工具

**Files:**
- Create: `tests/unit/components/message-utils.test.ts`
- Reference: `src/components/message/utils.ts`

- [ ] **Step 1: 查看源码**

```bash
cat src/components/message/utils.ts
```

- [ ] **Step 2: 编写测试**

```typescript
import { describe, it, expect } from 'vitest';
// import { formatMessageTime, truncateText } from '@/components/message/utils';

describe('message utils', () => {
  it('should format message time', () => {
    // expect(formatMessageTime(new Date('2024-01-01'))).toBeDefined();
  });

  it('should truncate long text', () => {
    // expect(truncateText('hello world', 5)).toBe('hello...');
  });
});
```

- [ ] **Step 3-5:** 同 Task 1.1

---

### Task 4.2: 补充 components/message/types.ts 测试

**Covers:** components 模块类型定义

**Files:**
- Create: `tests/unit/components/message-types.test.ts`
- Reference: `src/components/message/types.ts`

- [ ] **Step 1: 查看源码**

```bash
cat src/components/message/types.ts
```

- [ ] **Step 2: 编写测试**

```typescript
import { describe, it, expect } from 'vitest';
// import { MessageRole } from '@/components/message/types';

describe('message types', () => {
  it('should define MessageRole enum', () => {
    // expect(MessageRole.USER).toBe('user');
    // expect(MessageRole.ASSISTANT).toBe('assistant');
  });
});
```

- [ ] **Step 3-5:** 同 Task 1.1

---

## Phase 5: config 模块 (45% → 65%)

### Task 5.1: 补充 config/features.ts 测试

**Covers:** config 模块功能开关

**Files:**
- Create: `tests/unit/config/features.test.ts`
- Reference: `src/config/features.ts`

- [ ] **Step 1: 查看源码**

```bash
cat src/config/features.ts
```

- [ ] **Step 2: 编写测试**

```typescript
import { describe, it, expect } from 'vitest';
// import { FEATURES, isFeatureEnabled } from '@/config/features';

describe('features config', () => {
  it('should have feature flags defined', () => {
    // expect(FEATURES).toBeDefined();
  });

  it('should check feature enabled status', () => {
    // expect(isFeatureEnabled('tts')).toBeDefined();
  });
});
```

- [ ] **Step 3-5:** 同 Task 1.1

---

### Task 5.2: 补充 config/providers.ts 测试

**Covers:** config 模块提供商配置

**Files:**
- Create: `tests/unit/config/providers.test.ts`
- Reference: `src/config/providers.ts`

- [ ] **Step 1: 查看源码**

```bash
cat src/config/providers.ts
```

- [ ] **Step 2: 编写测试**

```typescript
import { describe, it, expect } from 'vitest';
// import { PROVIDERS, getProviderConfig } from '@/config/providers';

describe('providers config', () => {
  it('should list all providers', () => {
    // expect(PROVIDERS).toBeDefined();
    // expect(Object.keys(PROVIDERS).length).toBeGreaterThan(0);
  });

  it('should get provider config by name', () => {
    // const config = getProviderConfig('openai');
    // expect(config).toBeDefined();
  });
});
```

- [ ] **Step 3-5:** 同 Task 1.1

---

## Phase 6: weread 模块 (48% → 65%)

### Task 6.1: 补充 weread/types.ts 测试

**Covers:** weread 模块类型定义

**Files:**
- Create: `tests/unit/weread/types.test.ts`
- Reference: `src/weread/types.ts`

- [ ] **Step 1: 查看源码**

```bash
cat src/weread/types.ts
```

- [ ] **Step 2: 编写测试**

```typescript
import { describe, it, expect } from 'vitest';
// import { WereadBook, WereadHighlight } from '@/weread/types';

describe('weread types', () => {
  it('should have WereadBook interface', () => {
    // 类型检查测试
    const book: WereadBook = {
      bookId: '123',
      title: 'Test Book',
    };
    expect(book.bookId).toBe('123');
  });
});
```

- [ ] **Step 3-5:** 同 Task 1.1

---

### Task 6.2: 补充 weread/utils/helpers.ts 测试

**Covers:** weread 模块辅助函数

**Files:**
- Create: `tests/unit/weread/helpers.test.ts`
- Reference: `src/weread/utils/helpers.ts`

- [ ] **Step 1: 查看源码**

```bash
cat src/weread/utils/helpers.ts
```

- [ ] **Step 2: 编写测试**

```typescript
import { describe, it, expect } from 'vitest';
// import { formatHighlight, getChapterName } from '@/weread/utils/helpers';

describe('weread helpers', () => {
  it('should format highlight text', () => {
    // expect(formatHighlight('test')).toBeDefined();
  });

  it('should get chapter name from id', () => {
    // expect(getChapterName('ch1')).toBeDefined();
  });
});
```

- [ ] **Step 3-5:** 同 Task 1.1

---

## 验证

完成所有任务后运行完整测试套件：

```bash
npm run test:run
```

预期结果：
- 所有测试通过
- 文件级覆盖率从 43% 提升至 65%+
- 新增测试文件约 15-20 个
