# Prompt Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立统一的提示词管理系统，将所有提示词（核心 8 个 + 辅助 20+）注册到中央注册表，支持 i18n、版本控制和单元测试。

**Architecture:** 采用模块化注册表方案，每个提示词模块导出 `PromptModule` 对象，包含版本号、静态内容、动态 build 函数、元数据。中央注册表管理所有模块，提供统一的访问接口。

**Tech Stack:** TypeScript, Vitest

---

## Task 1: 创建基础设施 - 类型定义

**Covers:** [S3]

**Files:**
- Create: `src/agent/prompts/types.ts`
- Test: `tests/unit/agent/prompts/types.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/agent/prompts/types.test.ts
import { describe, it, expect } from 'vitest';

describe('PromptModule Types', () => {
  it('should define PromptLocale interface', () => {
    // This is a type-only test - just verify the types compile
    const locale: import('../../../../src/agent/prompts/types.js').PromptLocale = {
      systemPrompt: 'test',
    };
    expect(locale.systemPrompt).toBe('test');
  });

  it('should define PromptMetadata interface', () => {
    const metadata: import('../../../../src/agent/prompts/types.js').PromptMetadata = {
      category: 'core',
    };
    expect(metadata.category).toBe('core');
  });

  it('should define PromptModule interface', () => {
    const module: import('../../../../src/agent/prompts/types.js').PromptModule = {
      id: 'test',
      version: '1.0.0',
      name: 'Test',
      metadata: { category: 'core' },
      locales: {
        zh: { systemPrompt: 'test' },
      },
    };
    expect(module.id).toBe('test');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- tests/unit/agent/prompts/types.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/agent/prompts/types.ts

/** 提示词模块的语言版本 */
export interface PromptLocale {
  systemPrompt: string;
  userMessage?: string | ((ctx: any) => string);
}

/** 提示词模块的元数据 */
export interface PromptMetadata {
  node?: string;           // 对应 LangGraph 节点名
  category: 'core' | 'auxiliary' | 'evaluation';
  tokenEstimate?: number;  // 估算 token 数
  tags?: string[];         // 用于搜索/分类
}

/** 提示词模块定义 */
export interface PromptModule {
  id: string;              // 唯一标识符，如 'router.s0'
  version: string;         // 语义化版本，如 '1.2.0'
  name: string;            // 显示名称
  description?: string;    // 简短描述
  metadata: PromptMetadata;
  
  // 多语言内容
  locales: {
    zh: PromptLocale;
    en?: PromptLocale;
  };
  
  // 动态 build 函数（可选，用于需要参数拼装的模块）
  buildSystemPrompt?: (ctx: any) => string;
  buildUserMessage?: (ctx: any) => string;
}

/** 提示词注册表 */
export interface PromptRegistry {
  register(module: PromptModule): void;
  get(id: string, locale?: 'zh' | 'en'): PromptLocale;
  getVersion(id: string): string;
  list(filter?: { category?: string; tags?: string[] }): PromptModule[];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- tests/unit/agent/prompts/types.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agent/prompts/types.ts tests/unit/agent/prompts/types.test.ts
git commit -m "feat(prompts): add type definitions for prompt management system"
```

---

## Task 2: 创建基础设施 - 注册表实现

**Covers:** [S4]

**Files:**
- Create: `src/agent/prompts/registry.ts`
- Test: `tests/unit/agent/prompts/registry.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/agent/prompts/registry.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { PromptRegistryImpl } from '../../../../src/agent/prompts/registry.js';
import type { PromptModule } from '../../../../src/agent/prompts/types.js';

describe('PromptRegistryImpl', () => {
  let registry: PromptRegistryImpl;

  beforeEach(() => {
    registry = new PromptRegistryImpl();
  });

  const mockModule: PromptModule = {
    id: 'test.module',
    version: '1.0.0',
    name: 'Test Module',
    metadata: { category: 'core' },
    locales: {
      zh: { systemPrompt: '中文系统提示' },
      en: { systemPrompt: 'English system prompt' },
    },
  };

  it('should register a module', () => {
    registry.register(mockModule);
    expect(registry.getVersion('test.module')).toBe('1.0.0');
  });

  it('should get prompt by id', () => {
    registry.register(mockModule);
    const result = registry.get('test.module');
    expect(result.systemPrompt).toBe('中文系统提示');
  });

  it('should get prompt with locale override', () => {
    registry.register(mockModule);
    const result = registry.get('test.module', 'en');
    expect(result.systemPrompt).toBe('English system prompt');
  });

  it('should throw when module not found', () => {
    expect(() => registry.get('nonexistent')).toThrow('Module not found');
  });

  it('should list modules by category', () => {
    registry.register(mockModule);
    const result = registry.list({ category: 'core' });
    expect(result).toHaveLength(1);
  });

  it('should list modules by tags', () => {
    const moduleWithTags: PromptModule = {
      ...mockModule,
      metadata: { ...mockModule.metadata, tags: ['routing'] },
    };
    registry.register(moduleWithTags);
    const result = registry.list({ tags: ['routing'] });
    expect(result).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- tests/unit/agent/prompts/registry.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/agent/prompts/registry.ts

import type { PromptModule, PromptLocale, PromptRegistry } from './types.js';

export class PromptRegistryImpl implements PromptRegistry {
  private modules = new Map<string, PromptModule>();
  private currentLocale: 'zh' | 'en' = 'zh';

  register(module: PromptModule): void {
    if (this.modules.has(module.id)) {
      console.warn(`[PromptRegistry] Overwriting module: ${module.id}`);
    }
    this.modules.set(module.id, module);
  }

  get(id: string, locale?: 'zh' | 'en'): PromptLocale {
    const module = this.modules.get(id);
    if (!module) {
      throw new Error(`[PromptRegistry] Module not found: ${id}`);
    }
    const lang = locale || this.currentLocale;
    const content = module.locales[lang] || module.locales.zh;
    if (!content) {
      throw new Error(`[PromptRegistry] Locale not found: ${lang} for module: ${id}`);
    }
    return content;
  }

  setLocale(locale: 'zh' | 'en'): void {
    this.currentLocale = locale;
  }

  getVersion(id: string): string {
    const module = this.modules.get(id);
    return module?.version || 'unknown';
  }

  list(filter?: { category?: string; tags?: string[] }): PromptModule[] {
    let result = Array.from(this.modules.values());
    if (filter?.category) {
      result = result.filter(m => m.metadata.category === filter.category);
    }
    if (filter?.tags) {
      result = result.filter(m => 
        filter.tags!.some(tag => m.metadata.tags?.includes(tag))
      );
    }
    return result;
  }
}

// 全局单例
export const promptRegistry = new PromptRegistryImpl();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- tests/unit/agent/prompts/registry.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agent/prompts/registry.ts tests/unit/agent/prompts/registry.test.ts
git commit -m "feat(prompts): implement prompt registry with locale support"
```

---

## Task 3: 创建基础设施 - i18n 管理器

**Covers:** [S7]

**Files:**
- Create: `src/agent/prompts/i18n.ts`
- Test: `tests/unit/agent/prompts/i18n.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/agent/prompts/i18n.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { PromptI18n } from '../../../../src/agent/prompts/i18n.js';
import type { PromptModule } from '../../../../src/agent/prompts/types.js';

describe('PromptI18n', () => {
  let i18n: PromptI18n;

  beforeEach(() => {
    i18n = new PromptI18n({
      defaultLocale: 'zh',
      fallbackLocale: 'zh',
      supportedLocales: ['zh', 'en'],
    });
  });

  const mockModule: PromptModule = {
    id: 'test',
    version: '1.0.0',
    name: 'Test',
    metadata: { category: 'core' },
    locales: {
      zh: { systemPrompt: '中文' },
      en: { systemPrompt: 'English' },
    },
  };

  it('should get default locale', () => {
    expect(i18n.getLocale()).toBe('zh');
  });

  it('should set locale', () => {
    i18n.setLocale('en');
    expect(i18n.getLocale()).toBe('en');
  });

  it('should get prompt content with current locale', () => {
    const result = i18n.getPromptContent(mockModule);
    expect(result.systemPrompt).toBe('中文');
  });

  it('should get prompt content with locale override', () => {
    const result = i18n.getPromptContent(mockModule, 'en');
    expect(result.systemPrompt).toBe('English');
  });

  it('should fallback to zh when locale not found', () => {
    const moduleWithoutEn: PromptModule = {
      ...mockModule,
      locales: { zh: { systemPrompt: '中文' } },
    };
    const result = i18n.getPromptContent(moduleWithoutEn, 'en');
    expect(result.systemPrompt).toBe('中文');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- tests/unit/agent/prompts/i18n.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/agent/prompts/i18n.ts

import type { PromptModule, PromptLocale } from './types.js';

/** 语言配置 */
interface I18nConfig {
  defaultLocale: 'zh' | 'en';
  fallbackLocale: 'zh';
  supportedLocales: ('zh' | 'en')[];
}

/** 提示词翻译管理器 */
export class PromptI18n {
  private config: I18nConfig;
  private currentLocale: 'zh' | 'en';

  constructor(config: I18nConfig) {
    this.config = config;
    this.currentLocale = config.defaultLocale;
  }

  setLocale(locale: 'zh' | 'en'): void {
    if (this.config.supportedLocales.includes(locale)) {
      this.currentLocale = locale;
    }
  }

  getLocale(): 'zh' | 'en' {
    return this.currentLocale;
  }

  /** 获取提示词内容，支持 fallback */
  getPromptContent(
    module: PromptModule,
    overrideLocale?: 'zh' | 'en'
  ): PromptLocale {
    const locale = overrideLocale || this.currentLocale;
    
    // 优先使用指定语言
    if (module.locales[locale]) {
      return module.locales[locale];
    }
    
    // fallback 到中文
    if (module.locales.zh) {
      console.warn(
        `[PromptI18n] Locale ${locale} not found for ${module.id}, falling back to zh`
      );
      return module.locales.zh;
    }
    
    throw new Error(`[PromptI18n] No locale found for module: ${module.id}`);
  }
}

// 全局实例
export const promptI18n = new PromptI18n({
  defaultLocale: 'zh',
  fallbackLocale: 'zh',
  supportedLocales: ['zh', 'en'],
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- tests/unit/agent/prompts/i18n.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agent/prompts/i18n.ts tests/unit/agent/prompts/i18n.test.ts
git commit -m "feat(prompts): implement i18n manager for prompt locales"
```

---

## Task 4: 创建基础设施 - 版本管理器

**Covers:** [S8]

**Files:**
- Create: `src/agent/prompts/version.ts`
- Test: `tests/unit/agent/prompts/version.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/agent/prompts/version.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { PromptVersionManager } from '../../../../src/agent/prompts/version.js';
import type { PromptModule } from '../../../../src/agent/prompts/types.js';

describe('PromptVersionManager', () => {
  let manager: PromptVersionManager;

  beforeEach(() => {
    manager = new PromptVersionManager();
  });

  const mockModule: PromptModule = {
    id: 'test',
    version: '1.0.0',
    name: 'Test',
    metadata: { category: 'core' },
    locales: { zh: { systemPrompt: 'test' } },
  };

  it('should register module version', () => {
    manager.register(mockModule);
    expect(manager.getVersion('test')).toBe('1.0.0');
  });

  it('should get changelog', () => {
    manager.register(mockModule);
    const changelog = manager.getChangelog('test');
    expect(changelog).toHaveLength(1);
    expect(changelog[0].version).toBe('1.0.0');
  });

  it('should compare versions', () => {
    expect(manager.compareVersions('test', '1.0.0', '1.0.1')).toBeLessThan(0);
    expect(manager.compareVersions('test', '1.0.1', '1.0.0')).toBeGreaterThan(0);
    expect(manager.compareVersions('test', '1.0.0', '1.0.0')).toBe(0);
  });

  it('should return unknown for non-existent module', () => {
    expect(manager.getVersion('nonexistent')).toBe('unknown');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- tests/unit/agent/prompts/version.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/agent/prompts/version.ts

import type { PromptModule } from './types.js';

/** 版本信息 */
interface VersionInfo {
  module: string;
  version: string;
  changelog: ChangelogEntry[];
  lastUpdated: string;
}

/** 变更日志条目 */
export interface ChangelogEntry {
  version: string;
  date: string;
  changes: string[];
  author?: string;
}

/** 版本管理器 */
export class PromptVersionManager {
  private versions = new Map<string, VersionInfo>();

  /** 注册模块版本 */
  register(module: PromptModule): void {
    const existing = this.versions.get(module.id);
    if (existing && existing.version === module.version) {
      return; // 版本未变，跳过
    }

    const entry: ChangelogEntry = {
      version: module.version,
      date: new Date().toISOString().split('T')[0],
      changes: ['初始版本'],
    };

    if (existing) {
      existing.changelog.push(entry);
      existing.version = module.version;
      existing.lastUpdated = entry.date;
    } else {
      this.versions.set(module.id, {
        module: module.id,
        version: module.version,
        changelog: [entry],
        lastUpdated: entry.date,
      });
    }
  }

  /** 获取模块版本 */
  getVersion(moduleId: string): string {
    return this.versions.get(moduleId)?.version || 'unknown';
  }

  /** 获取变更日志 */
  getChangelog(moduleId: string): ChangelogEntry[] {
    return this.versions.get(moduleId)?.changelog || [];
  }

  /** 比较版本 */
  compareVersions(moduleId: string, v1: string, v2: string): number {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);
    
    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;
      if (p1 !== p2) return p1 - p2;
    }
    return 0;
  }
}

// 全局实例
export const promptVersionManager = new PromptVersionManager();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- tests/unit/agent/prompts/version.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agent/prompts/version.ts tests/unit/agent/prompts/version.test.ts
git commit -m "feat(prompts): implement version manager for prompt modules"
```

---

## Task 5: 创建基础设施 - 统一导出

**Covers:** [S5]

**Files:**
- Create: `src/agent/prompts/index.ts`

- [ ] **Step 1: Write the implementation**

```typescript
// src/agent/prompts/index.ts

// 类型
export type { PromptLocale, PromptMetadata, PromptModule, PromptRegistry } from './types.js';

// 注册表
export { PromptRegistryImpl, promptRegistry } from './registry.js';

// i18n
export { PromptI18n, promptI18n } from './i18n.js';

// 版本管理
export { PromptVersionManager, promptVersionManager } from './version.js';
export type { ChangelogEntry } from './version.js';
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/agent/prompts/index.ts
git commit -m "feat(prompts): add unified exports for prompt management"
```

---

## Task 6: 迁移核心模块 - Router (S0)

**Covers:** [S5, S6]

**Files:**
- Create: `src/agent/prompts/core/router.ts`
- Test: `tests/unit/agent/prompts/core/router.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/agent/prompts/core/router.test.ts
import { describe, it, expect } from 'vitest';
import { routerPrompt } from '../../../../../src/agent/prompts/core/router.js';

describe('Router Prompt Module', () => {
  describe('基本属性', () => {
    it('应该有正确的 id', () => {
      expect(routerPrompt.id).toBe('router.s0');
    });

    it('应该有版本号', () => {
      expect(routerPrompt.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('应该有中文 locale', () => {
      expect(routerPrompt.locales.zh).toBeDefined();
      expect(routerPrompt.locales.zh.systemPrompt).toContain('<role>');
    });
  });

  describe('内容完整性', () => {
    it('系统提示词应该包含角色定义', () => {
      const { systemPrompt } = routerPrompt.locales.zh;
      expect(systemPrompt).toContain('<role>');
      expect(systemPrompt).toContain('</role>');
    });

    it('系统提示词应该包含意图类型', () => {
      const { systemPrompt } = routerPrompt.locales.zh;
      expect(systemPrompt).toContain('intent_types');
      expect(systemPrompt).toContain('depth');
    });

    it('系统提示词应该包含输出格式', () => {
      const { systemPrompt } = routerPrompt.locales.zh;
      expect(systemPrompt).toContain('output_format');
      expect(systemPrompt).toContain('JSON');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- tests/unit/agent/prompts/core/router.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/agent/prompts/core/router.ts

import type { PromptModule } from '../types.js';

export const routerPrompt: PromptModule = {
  id: 'router.s0',
  version: '1.0.0',
  name: 'S0 Router 意图路由',
  description: '快速意图分类 + depth 判断 + query 重写',
  metadata: {
    node: 'router',
    category: 'core',
    tokenEstimate: 800,
    tags: ['routing', 'intent', 'depth'],
  },
  locales: {
    zh: {
      systemPrompt: `<role>
你是一个极速的阅读意图路由器与上下文重写器。你的唯一职责是结构化分析，绝不要尝试回答用户的业务问题。
</role>

<task>
1. 结合【近期对话记录】和【书籍简介】，阅读【用户的当前提问】。
2. 判断用户消息的意图类型（见下方 <intent_types>），据此决定阅读深度 (depth)。
3. 将用户的提问重写为一个完整的、不带代词的独立句子 (standalone_query)。
</task>

<intent_types>
用户消息不一定是提问，可能属于以下类型之一。你必须先判断类型，再决定 depth：

A. 闲聊/指令 — 打招呼、系统指令、完全与书籍无关的内容 → depth=0
B. 存在性验证 — "书中有没有提到X""是否讨论了X" → depth=0
C. 宏观概览 — 仅限以下情况 → depth=1
D. 书籍内容分析 — 需要检索书中具体段落 → depth=2
E. 长文本评论/验证 — 用户粘贴了一段分析文本让AI评价 → depth=2
F. 跨书主题阅读 — 明确涉及多本书的对比或综合 → depth=3
</intent_types>

<depth_rules_summary>
depth=0: 闲聊(A)、存在性验证(B)
depth=1: 纯宏观概览(C)，极其罕见
depth=2: 书籍内容分析(D)、长文本评论验证(E) — 绝大多数情况
depth=3: 多书跨书对比(F)
⚠️ 默认偏好：如果无法确定，判 depth=2（宁可多搜不要漏搜）。
</depth_rules_summary>

<output_format>
你必须且只能输出合法的 JSON，不要包含任何 Markdown 代码块修饰符：
{
  "depth": 数字 (0, 1, 2, 3),
  "standalone_query": "重写后的独立提问",
  "visualize": true 或 false,
  "reason": "简短说明判定理由（意图类型+关键信号）"
}
</output_format>`,
    },
    en: {
      systemPrompt: `<role>
You are a fast reading intent router and context rewriter. Your sole responsibility is structured analysis — never attempt to answer the user's business questions.
</role>

<task>
1. Read the user's current query along with recent conversation history and book description.
2. Determine the intent type (see <intent_types> below) and set the reading depth.
3. Rewrite the user's query into a complete, pronoun-free standalone sentence.
</task>

<intent_types>
User messages may belong to one of the following types:

A. Small talk / instructions — greetings, system commands, unrelated to the book → depth=0
B. Existence verification — "does the book mention X" → depth=0
C. High-level overview — only for these cases → depth=1
D. Book content analysis — needs to search specific passages → depth=2
E. Long text review — user pastes analysis for evaluation → depth=2
F. Cross-book reading — explicitly compares multiple books → depth=3
</intent_types>

<output_format>
Output only valid JSON, no Markdown code blocks:
{
  "depth": number (0, 1, 2, 3),
  "standalone_query": "rewritten standalone question",
  "visualize": true or false,
  "reason": "brief reasoning"
}
</output_format>`,
    },
  },
};

// 注册
import { promptRegistry } from '../registry.js';
promptRegistry.register(routerPrompt);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- tests/unit/agent/prompts/core/router.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agent/prompts/core/router.ts tests/unit/agent/prompts/core/router.test.ts
git commit -m "feat(prompts): migrate S0 Router to prompt registry"
```

---

## Task 7: 迁移核心模块 - Formatter (S4)

**Covers:** [S5, S6]

**Files:**
- Create: `src/agent/prompts/core/formatter.ts`
- Test: `tests/unit/agent/prompts/core/formatter.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/agent/prompts/core/formatter.test.ts
import { describe, it, expect } from 'vitest';
import { formatterPrompt } from '../../../../../src/agent/prompts/core/formatter.js';

describe('Formatter Prompt Module', () => {
  describe('基本属性', () => {
    it('应该有正确的 id', () => {
      expect(formatterPrompt.id).toBe('formatter.s4');
    });

    it('应该有版本号', () => {
      expect(formatterPrompt.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('应该有中文 locale', () => {
      expect(formatterPrompt.locales.zh).toBeDefined();
      expect(formatterPrompt.locales.zh.systemPrompt).toContain('<role>');
    });
  });

  describe('内容完整性', () => {
    it('系统提示词应该包含角色定义', () => {
      const { systemPrompt } = formatterPrompt.locales.zh;
      expect(systemPrompt).toContain('<role>');
      expect(systemPrompt).toContain('奚童');
    });

    it('系统提示词应该包含规则', () => {
      const { systemPrompt } = formatterPrompt.locales.zh;
      expect(systemPrompt).toContain('<rules>');
      expect(systemPrompt).toContain('wiki 链接');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- tests/unit/agent/prompts/core/formatter.test.ts`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/agent/prompts/core/formatter.ts

import type { PromptModule } from '../types.js';

export const formatterPrompt: PromptModule = {
  id: 'formatter.s4',
  version: '1.0.0',
  name: 'S4 Formatter 格式化输出',
  description: '答案格式化 + wiki 链接输出',
  metadata: {
    node: 'formatter',
    category: 'core',
    tokenEstimate: 1000,
    tags: ['formatting', 'output', 'wiki-links'],
  },
  locales: {
    zh: {
      systemPrompt: `<role>
你是奚童，用户的专属 AI 伴读。专业、温和、充满书卷气。
你和用户正在一起读这本书，直接聊你的理解和发现就好。
</role>

<rules>
1. 【回答优先】：analysis 是你读到的核心内容，必须完整、忠实地传达给用户
2. 【无迎合】: 不要为了符合用户问题而改变回答内容
3. 【读书笔记风格】：像给朋友分享读书笔记一样，自然称呼用户名称
4. 【保留 wiki 链接】：analysis 中的 [[...]] 是 Obsidian 双链引用，必须原样保留
5. 【禁止编造链接】：只允许保留输入中已有的 [[...]] 链接
6. 【直接回应】：禁止用客套话开场，第一句话就必须切入实质内容
7. 【无幻觉】：只基于读到的内容分享，不编造书中没有的内容
8. 【隐藏机器属性】：不说"搜索""工具""token"等技术词汇
9. 【阅读引导】：回答完用户问题后，用一两句话自然引出书中其他相关内容
10. 【诚实拒答】（优先级最高）：当 query 明确说"经检索确认，这本书中并未提及"某内容时，明确告知用户
</rules>`,
    },
    en: {
      systemPrompt: `<role>
You are Xi Tong, the user's dedicated AI reading companion. Professional, warm, and scholarly.
You and the user are reading this book together — just share your understanding and discoveries naturally.
</role>

<rules>
1. 【Answer Priority】: The analysis is your core content — convey it fully and faithfully
2. 【No Flattery】: Don't change your answer to match the user's question
3. 【Reading Notes Style】: Like sharing reading notes with a friend, naturally address the user
4. 【Preserve Wiki Links】: [[...]] in analysis are Obsidian bidirectional links — keep them intact
5. 【No Fabricated Links】: Only keep existing [[...]] links from input
6. 【Direct Response】: No pleasantries — jump straight to substantive content
7. 【No Hallucination】: Only share based on what you've read
8. 【Hide Machine Nature】: Don't mention "search", "tools", "token" etc.
9. 【Reading Guide】: After answering, naturally introduce related content
10. 【Honest Refusal】: When query says "the book doesn't mention X", clearly inform the user
</rules>`,
    },
  },
};

// 注册
import { promptRegistry } from '../registry.js';
promptRegistry.register(formatterPrompt);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- tests/unit/agent/prompts/core/formatter.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agent/prompts/core/formatter.ts tests/unit/agent/prompts/core/formatter.test.ts
git commit -m "feat(prompts): migrate S4 Formatter to prompt registry"
```

---

## Task 8: 迁移核心模块 - 其他 6 个核心模块

**Covers:** [S5, S6]

**Files:**
- Create: `src/agent/prompts/core/inspectional.ts`
- Create: `src/agent/prompts/core/analytical.ts`
- Create: `src/agent/prompts/core/pre-search.ts`
- Create: `src/agent/prompts/core/syntopical.ts`
- Create: `src/agent/prompts/core/socratic.ts`
- Create: `src/agent/prompts/core/proactive.ts`
- Test: `tests/unit/agent/prompts/core/inspectional.test.ts`
- Test: `tests/unit/agent/prompts/core/analytical.test.ts`
- Test: `tests/unit/agent/prompts/core/pre-search.test.ts`
- Test: `tests/unit/agent/prompts/core/syntopical.test.ts`
- Test: `tests/unit/agent/prompts/core/socratic.test.ts`
- Test: `tests/unit/agent/prompts/core/proactive.test.ts`

- [ ] **Step 1: Write the failing tests**

为每个模块编写类似的测试，验证 id、version、locale、内容完整性。

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- tests/unit/agent/prompts/core/`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write minimal implementations**

从现有 `src/agent/graph/prompts/` 目录迁移每个模块，转换为 PromptModule 格式。

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- tests/unit/agent/prompts/core/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agent/prompts/core/*.ts tests/unit/agent/prompts/core/*.test.ts
git commit -m "feat(prompts): migrate remaining 6 core prompt modules"
```

---

## Task 9: 迁移辅助模块

**Covers:** [S5]

**Files:**
- Create: `src/agent/prompts/auxiliary/advisor.ts`
- Create: `src/agent/prompts/auxiliary/tts.ts`
- Create: `src/agent/prompts/auxiliary/profile-builder.ts`
- Create: `src/agent/prompts/auxiliary/diagram.ts`
- Create: `src/agent/prompts/auxiliary/memory.ts`
- Test: `tests/unit/agent/prompts/auxiliary/*.test.ts`

- [ ] **Step 1: Write the failing tests**

为每个辅助模块编写测试。

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- tests/unit/agent/prompts/auxiliary/`
Expected: FAIL with "Cannot find module"

- [ ] **Step 3: Write minimal implementations**

从现有模块迁移辅助提示词。

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- tests/unit/agent/prompts/auxiliary/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agent/prompts/auxiliary/*.ts tests/unit/agent/prompts/auxiliary/*.test.ts
git commit -m "feat(prompts): migrate auxiliary prompt modules"
```

---

## Task 10: 更新文档和清理

**Covers:** [S12]

**Files:**
- Update: `docs/architecture/prompt-modules.md`
- Update: `docs/agent-xitong-prompts-summary.md`

- [ ] **Step 1: Update prompt-modules.md**

更新文档，反映新的架构和用法。

- [ ] **Step 2: Update agent-xitong-prompts-summary.md**

添加新架构的说明。

- [ ] **Step 3: Run full test suite**

Run: `npm run test:run`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add docs/architecture/prompt-modules.md docs/agent-xitong-prompts-summary.md
git commit -m "docs(prompts): update documentation for new prompt management system"
```
