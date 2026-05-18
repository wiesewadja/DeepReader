/**
 * Config 共享纯类型定义
 *
 * 将 providers.ts / ai-roles.ts / settings.ts 互相引用的类型集中到此处，
 * 消除三个文件之间的循环依赖
 */

/** LLM 服务商标识 */
export type ProviderType = 'minimax' | 'deepseek' | 'kimi' | 'zhipu' | 'siliconflow' | 'openai' | 'xiaomi' | 'custom';

/** AI 用途角色 */
export type RoleType = 'chat' | 'router' | 'pageindex' | 'proposition' | 'embedding' | 'reranker' | 'tts' | 'imagegen';

/** 角色所需的能力类型 */
export type RequiredCapability = 'chat' | 'embedding' | 'reranker' | 'tts' | 'imagegen';
