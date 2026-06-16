// src/agent/prompts/i18n.ts
//
// ⚠️ 此文件已废弃 —— i18n 能力已合并到 PromptRegistry。
// 保留此文件仅为向后兼容，新代码请直接使用 promptRegistry.setLocale() / getLocale()。

import { promptRegistry } from './registry.js';

/** @deprecated 使用 promptRegistry.setLocale() 代替 */
export const promptI18n = {
  setLocale: (locale: 'zh' | 'en') => promptRegistry.setLocale(locale),
  getLocale: () => promptRegistry.getLocale(),
};
