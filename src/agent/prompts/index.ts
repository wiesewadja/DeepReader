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
