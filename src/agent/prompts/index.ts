// src/agent/prompts/index.ts

// 类型
export type {
  PromptLocale,
  PromptMetadata,
  PromptModule,
  PromptRegistry,
  RouterBuildContext,
} from './types.js';

// 注册表
export { PromptRegistryImpl, promptRegistry } from './registry.js';

// i18n（向后兼容，内部委托给 registry）
export { promptI18n } from './i18n.js';

// 版本管理
export { PromptVersionManager, promptVersionManager } from './version.js';
export type { ChangelogEntry } from './version.js';

// ===== 显式批量注册 =====

// 核心模块
import { routerPrompt } from './core/router.js';
import { inspectionalPrompt } from './core/inspectional.js';
import { preSearchPrompt } from './core/pre-search.js';
import { analyticalPrompt } from './core/analytical.js';
import { syntopicalPrompt } from './core/syntopical.js';
import { socraticPrompt } from './core/socratic.js';
import { formatterPrompt } from './core/formatter.js';
import { proactivePrompt } from './core/proactive.js';

// 辅助模块
import { advisorPrompt } from './auxiliary/advisor.js';
import { diagramPrompt } from './auxiliary/diagram.js';
import { consolidationPrompt, compressionPrompt } from './auxiliary/memory.js';
import { extractPrompt, wereadExtractPrompt, synthesizePrompt } from './auxiliary/profile-builder.js';
import { oralRewritePrompt, voiceReplyPrompt, ttsSystemPrompt } from './auxiliary/tts.js';

// 注册表 + 版本管理器
import { promptRegistry } from './registry.js';
import { promptVersionManager } from './version.js';

/** 所有需要注册的模块列表 */
const ALL_MODULES = [
  routerPrompt,
  inspectionalPrompt,
  preSearchPrompt,
  analyticalPrompt,
  syntopicalPrompt,
  socraticPrompt,
  formatterPrompt,
  proactivePrompt,
  advisorPrompt,
  diagramPrompt,
  consolidationPrompt,
  compressionPrompt,
  extractPrompt,
  wereadExtractPrompt,
  synthesizePrompt,
  oralRewritePrompt,
  voiceReplyPrompt,
  ttsSystemPrompt,
];

/**
 * 注册所有提示词模块到注册表和版本管理器。
 * 调用一次即可完成全部初始化。
 * 由 main.ts 在插件启动时调用。
 */
export function registerAllPrompts(): void {
  for (const mod of ALL_MODULES) {
    promptRegistry.register(mod);
    promptVersionManager.register(mod);
  }
}
