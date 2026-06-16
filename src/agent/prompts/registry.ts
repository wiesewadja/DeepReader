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
    // 优先使用指定语言，fallback 到中文
    const content = module.locales[lang] || module.locales.zh;
    if (!content) {
      throw new Error(`[PromptRegistry] Locale not found: ${lang} for module: ${id}`);
    }
    return content;
  }

  setLocale(locale: 'zh' | 'en'): void {
    this.currentLocale = locale;
  }

  getLocale(): 'zh' | 'en' {
    return this.currentLocale;
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
