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
