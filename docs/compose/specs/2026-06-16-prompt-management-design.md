# [S1] 问题

DeepReader 项目中，提示词管理存在以下问题：

1. **碎片化**：核心 8 个 Agent 提示词在 `src/agent/graph/prompts/` 目录，但系统中至少还有 20+ 个辅助提示词散落在各自业务模块中（advisor、tts、profile-builder、diagram-helper 等），没有统一入口
2. **无模板引擎**：全部采用 TypeScript 字符串拼接 + 模板字面量，没有 handlebars/mustache
3. **无版本控制**：提示词修改只能靠 git diff 回滚，没有语义化版本标记
4. **无 i18n**：核心提示词全部写死中文，PageIndex 部分是英文，无切换机制
5. **无 A/B 测试框架**：同一节点想对比不同 prompt 效果没有基础设施
6. **测试覆盖极低**：仅有 1 个测试文件（formatter-prompt.test.ts），其余 7 个核心 prompt 无单元测试
7. **token 预算管理缺失**：4 块全量注入，超长上下文时 token 可能超限

# [S2] 方案概览

采用**模块化注册表**方案：

- 每个提示词模块导出一个 `PromptModule` 对象，包含版本号、静态内容、动态 build 函数、元数据
- 中央注册表管理所有模块，提供统一的访问接口
- 支持中/英文双语 i18n
- 模块级版本控制，变更时自动生成 changelog
- 每个提示词模块有单元测试，验证结构完整性和关键规则
- 渐进式迁移：先建注册表，再逐个迁移提示词，保持向后兼容

**推荐理由**：
1. 与现有 TypeScript 代码风格一致
2. 类型安全，IDE 支持好
3. 渐进式迁移友好（可以一个模块一个模块迁移）
4. 版本号内嵌在模块定义中

# [S3] 类型系统

核心类型定义，所有提示词模块必须遵循：

```typescript
// src/agent/prompts/types.ts

/** 提示词模块的语言版本 */
interface PromptLocale {
  systemPrompt: string;
  userMessage?: string | ((ctx: any) => string);
}

/** 提示词模块的元数据 */
interface PromptMetadata {
  node?: string;           // 对应 LangGraph 节点名
  category: 'core' | 'auxiliary' | 'evaluation';
  tokenEstimate?: number;  // 估算 token 数
  tags?: string[];         // 用于搜索/分类
}

/** 提示词模块定义 */
interface PromptModule {
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
interface PromptRegistry {
  register(module: PromptModule): void;
  get(id: string, locale?: 'zh' | 'en'): PromptLocale;
  getVersion(id: string): string;
  list(filter?: { category?: string; tags?: string[] }): PromptModule[];
}
```

# [S4] 注册表实现

中央注册表管理所有提示词模块：

```typescript
// src/agent/prompts/registry.ts

class PromptRegistryImpl implements PromptRegistry {
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

# [S5] 模块组织

目录结构和模块定义方式：

```
src/agent/prompts/
├── types.ts                    # 类型定义
├── registry.ts                 # 注册表实现
├── i18n.ts                     # i18n 管理器
├── version.ts                  # 版本管理器
├── index.ts                    # 统一导出
│
├── core/                       # 核心 8 个 Agent 提示词
│   ├── router.ts               # S0 Router
│   ├── inspectional.ts         # S1 Inspectional
│   ├── pre-search.ts           # S2-Pre
│   ├── analytical.ts           # S2 Analytical
│   ├── syntopical.ts           # S3 Syntopical
│   ├── socratic.ts             # Socratic 拆分
│   ├── formatter.ts            # S4 Formatter
│   └── proactive.ts            # Proactive Formatter
│
├── auxiliary/                  # 辅助提示词
│   ├── advisor.ts              # 阅读顾问
│   ├── tts.ts                  # TTS 语音相关
│   ├── profile-builder.ts      # 用户画像
│   ├── diagram.ts              # Excalidraw 图表
│   └── memory.ts               # 记忆整合/压缩
│
├── locales/                    # 多语言翻译（可选，用于 i18n）
│   ├── zh/                     # 中文翻译
│   └── en/                     # 英文翻译
│
└── examples/                   # 使用示例
    └── usage.md
```

**模块定义示例**（router.ts）：

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
...`,
    },
    en: {
      systemPrompt: `<role>
You are a fast reading intent router and context rewriter. Your sole responsibility is structured analysis — never attempt to answer the user's business questions.
</role>
...`,
    },
  },
};

// 注册
import { promptRegistry } from '../registry.js';
promptRegistry.register(routerPrompt);
```

# [S6] 动态 Build 函数

对于需要动态参数的提示词模块，保留 build 函数但统一接口：

```typescript
// src/agent/prompts/core/analytical.ts
import type { PromptModule, PromptLocale } from '../types.js';

/** 分析阅读的上下文参数 */
export interface AnalyticalContext {
  scopeNodeIds: string[];
  tocSummary?: string;
  betterQuestion?: string;
  currentNodeId?: string;
  userProfileSummary?: string;
  // ... 其他 11 个字段
}

export const analyticalPrompt: PromptModule = {
  id: 'analytical.s2',
  version: '1.0.0',
  name: 'S2 Analytical 分析阅读',
  metadata: {
    node: 'analytical',
    category: 'core',
    tokenEstimate: 1200,
  },
  locales: {
    zh: {
      systemPrompt: `<role>
你是艾德勒学派的阅读分析师。忠于原著，执行分析阅读方式，深度解构作者思想。
</role>
...`,
    },
  },
  // 动态 build 函数
  buildSystemPrompt: (ctx: AnalyticalContext): string => {
    const base = analyticalPrompt.locales.zh.systemPrompt;
    const scopeList = ctx.scopeNodeIds.map(id => `- ${id}`).join('\n');
    return `${base}
<locked_scope>
搜索范围限定：
${scopeList}
</locked_scope>`;
  },
  buildUserMessage: (ctx: AnalyticalContext): string => {
    // 构建用户消息
    return `<query>${ctx.betterQuestion || ''}</query>`;
  },
};

// 注册
import { promptRegistry } from '../registry.js';
promptRegistry.register(analyticalPrompt);
```

**使用方式**：

```typescript
// 在节点中使用
import { promptRegistry } from '../prompts/index.js';

function analyticalNode(state: CognitiveEngineState) {
  const module = promptRegistry.get('analytical.s2');
  const systemPrompt = analyticalPrompt.buildSystemPrompt?.(ctx) || module.systemPrompt;
  const userMessage = analyticalPrompt.buildUserMessage?.(ctx) || module.userMessage;
  // ...
}
```

# [S7] i18n 策略

多语言支持的实现方式：

```typescript
// src/agent/prompts/i18n.ts

/** 语言配置 */
interface I18nConfig {
  defaultLocale: 'zh' | 'en';
  fallbackLocale: 'zh';
  supportedLocales: ('zh' | 'en')[];
}

/** 提示词翻译管理器 */
class PromptI18n {
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

**翻译文件组织**（可选，用于批量管理翻译）：

```
src/agent/prompts/locales/
├── zh/
│   ├── router.ts          # Router 中文翻译
│   ├── analytical.ts      # Analytical 中文翻译
│   └── index.ts           # 导出所有中文翻译
└── en/
    ├── router.ts          # Router 英文翻译
    ├── analytical.ts      # Analytical 英文翻译
    └── index.ts           # 导出所有英文翻译
```

# [S8] 版本控制

模块级版本管理：

```typescript
// src/agent/prompts/version.ts

/** 版本信息 */
interface VersionInfo {
  module: string;
  version: string;
  changelog: ChangelogEntry[];
  lastUpdated: string;
}

/** 变更日志条目 */
interface ChangelogEntry {
  version: string;
  date: string;
  changes: string[];
  author?: string;
}

/** 版本管理器 */
class PromptVersionManager {
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

**版本号规则**：
- **主版本号（Major）**：提示词结构重大变化（如改变 XML 标签、修改输出格式）
- **次版本号（Minor）**：内容调整（如修改规则、添加新功能）
- **修订号（Patch）**：小修（如修正错别字、调整措辞）

**示例**：
- `1.0.0` → `1.0.1`：修正错别字
- `1.0.1` → `1.1.0`：添加新规则
- `1.1.0` → `2.0.0`：改变输出格式

# [S9] 测试策略

单元测试的组织方式：

```typescript
// tests/unit/agent/prompts/router.test.ts
import { describe, it, expect } from 'vitest';
import { routerPrompt } from '../../../../src/agent/prompts/core/router.js';

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

  describe('版本控制', () => {
    it('版本号应该是有效的语义化版本', () => {
      const [major, minor, patch] = routerPrompt.version.split('.').map(Number);
      expect(major).toBeGreaterThanOrEqual(0);
      expect(minor).toBeGreaterThanOrEqual(0);
      expect(patch).toBeGreaterThanOrEqual(0);
    });
  });
});
```

**测试分类**：

1. **结构测试**：验证模块有正确的 id、version、metadata
2. **内容测试**：验证系统提示词包含必要的 XML 标签和规则
3. **构建测试**：验证 build 函数能正确生成提示词
4. **集成测试**：验证模块能正确注册到注册表

**测试覆盖率目标**：
- 核心模块：100% 结构测试 + 80% 内容测试
- 辅助模块：100% 结构测试 + 50% 内容测试

# [S10] 迁移策略

渐进式迁移的步骤：

### 阶段 1：基础设施（1-2 天）
1. 创建 `src/agent/prompts/` 目录结构
2. 实现类型定义（`types.ts`）
3. 实现注册表（`registry.ts`）
4. 实现 i18n 管理器（`i18n.ts`）
5. 实现版本管理器（`version.ts`）
6. 创建统一导出（`index.ts`）

### 阶段 2：核心模块迁移（3-5 天）
按优先级逐个迁移核心 8 个提示词：

1. **router.ts**（S0）- 最简单，作为模板
2. **formatter.ts**（S4）- 用户直接看到，最重要
3. **inspectional.ts**（S1）- 依赖 tree 结构
4. **analytical.ts**（S2）- 最复杂，11 字段 context
5. **pre-search.ts**（S2-Pre）- 早停路径
6. **syntopical.ts**（S3）- 跨书对比
7. **socratic.ts** - 极简
8. **proactive.ts** - 3 种触发模式

**迁移原则**：
- 保持向后兼容：旧的导出保留，内部调用新注册表
- 每个模块迁移后立即运行测试
- 使用 `git commit` 每完成一个模块

### 阶段 3：辅助模块迁移（2-3 天）
迁移散落在各模块的辅助提示词：

1. **advisor.ts** - 阅读顾问
2. **tts.ts** - TTS 语音相关
3. **profile-builder.ts** - 用户画像
4. **diagram.ts** - Excalidraw 图表
5. **memory.ts** - 记忆整合/压缩

### 阶段 4：i18n 和测试（2-3 天）
1. 为所有模块添加英文 locale
2. 编写完整的单元测试
3. 验证所有模块能正确注册和使用

### 阶段 5：清理和文档（1 天）
1. 移除旧的导出（保留 1 个版本作为 fallback）
2. 更新 `prompt-modules.md` 文档
3. 编写使用指南

**总预估时间**：9-14 天

# [S11] 文件清单

| 文件 | 职责 | 状态 |
|------|------|------|
| `src/agent/prompts/types.ts` | 类型定义 | 新建 |
| `src/agent/prompts/registry.ts` | 注册表实现 | 新建 |
| `src/agent/prompts/i18n.ts` | i18n 管理器 | 新建 |
| `src/agent/prompts/version.ts` | 版本管理器 | 新建 |
| `src/agent/prompts/index.ts` | 统一导出 | 新建 |
| `src/agent/prompts/core/router.ts` | S0 Router | 新建 |
| `src/agent/prompts/core/inspectional.ts` | S1 Inspectional | 新建 |
| `src/agent/prompts/core/pre-search.ts` | S2-Pre | 新建 |
| `src/agent/prompts/core/analytical.ts` | S2 Analytical | 新建 |
| `src/agent/prompts/core/syntopical.ts` | S3 Syntopical | 新建 |
| `src/agent/prompts/core/socratic.ts` | Socratic 拆分 | 新建 |
| `src/agent/prompts/core/formatter.ts` | S4 Formatter | 新建 |
| `src/agent/prompts/core/proactive.ts` | Proactive Formatter | 新建 |
| `src/agent/prompts/auxiliary/advisor.ts` | 阅读顾问 | 新建 |
| `src/agent/prompts/auxiliary/tts.ts` | TTS 语音相关 | 新建 |
| `src/agent/prompts/auxiliary/profile-builder.ts` | 用户画像 | 新建 |
| `src/agent/prompts/auxiliary/diagram.ts` | Excalidraw 图表 | 新建 |
| `src/agent/prompts/auxiliary/memory.ts` | 记忆整合/压缩 | 新建 |
| `tests/unit/agent/prompts/*.test.ts` | 单元测试 | 新建 |
| `docs/architecture/prompt-modules.md` | 架构文档 | 更新 |

# [S12] 与其他文档的关系

- **提示词模块组合（Prompt Modules）**：`docs/architecture/prompt-modules.md` — 本文档是其升级版，解决了其中列出的 19 条已知限制
- **Agent 奚童提示词梳理**：`docs/agent-xitong-prompts-summary.md` — 本文档的实现将基于该梳理文档的内容
- **DeepReader 四层测试框架**：`docs/test-strategies/` — 本文档的测试策略遵循该框架
