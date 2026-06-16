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
