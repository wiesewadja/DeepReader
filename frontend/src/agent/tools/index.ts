/**
 * Tool 注册表和执行管理
 */

import type { ToolDefinition } from '../types.js';
import type { ToolExecutor, ToolRegistry, ToolContext } from './types.js';
import { searchPdfTool } from './search-pdf.js';
import { getTocTool } from './get-toc.js';
import { getChapterTool } from './get-chapter.js';
import { createSkillTool } from './skill.js';
import { SkillLoader } from '../skills/loader.js';
import { log } from '../../utils/logger.js';

// 导出类型
export type { ToolExecutor, ToolRegistry, ToolContext } from './types.js';

// 导出各个工具
export { searchPdfTool } from './search-pdf.js';
export { getTocTool } from './get-toc.js';
export { getChapterTool } from './get-chapter.js';
export { createSkillTool } from './skill.js';

/**
 * 创建并填充 Tool 注册表
 */
export function createToolRegistry(
  skillLoader: SkillLoader,
  context: ToolContext
): ToolRegistry {
  const registry: ToolRegistry = new Map();

  // 注册基础工具
  registry.set('search_pdf', searchPdfTool);
  registry.set('get_toc', getTocTool);
  registry.set('get_chapter', getChapterTool);

  // 注册 Skill 工具（需要依赖注入）
  const skillTool = createSkillTool(skillLoader);
  registry.set('Skill', skillTool);

  log('[ToolRegistry] 已注册', registry.size, '个工具:', Array.from(registry.keys()));

  return registry;
}

/**
 * 获取所有工具定义（用于 LLM 工具列表）
 */
export function getToolDefinitions(registry: ToolRegistry): ToolDefinition[] {
  return Array.from(registry.values()).map((executor) => executor.definition);
}

/**
 * 执行指定工具
 */
export async function executeTool(
  registry: ToolRegistry,
  name: string,
  args: Record<string, unknown>,
  context: ToolContext
): Promise<string> {
  const executor = registry.get(name);

  if (!executor) {
    const availableTools = Array.from(registry.keys()).join(', ');
    return `Error: Unknown tool "${name}". Available tools: ${availableTools}`;
  }

  log('[executeTool] 执行工具:', name, '参数:', args);

  try {
    const result = await executor.execute(args, context);
    log('[executeTool] 工具执行成功:', name, '结果长度:', result.length);
    return result;
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    log('[executeTool] 工具执行失败:', name, errorMsg);
    return `Error executing tool ${name}: ${errorMsg}`;
  }
}
