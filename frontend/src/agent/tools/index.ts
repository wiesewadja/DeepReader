/**
 * Tool 注册表和执行管理
 */

import type { ToolDefinition } from '../types.js';
import type { ToolExecutor, ToolRegistry, ToolContext } from './types.js';
import { searchDocTool } from './search-doc.js';
import { getTocTool } from './get-toc.js';
import { getChapterTool } from './get-chapter.js';
import { createSkillTool } from './skill.js';
import { writeNoteTool } from './write-note.js';
import { createSubAgentTool } from './create-sub-agent.js';
import { addMemoryTool, searchMemoryTool, summarizeMemoryTool } from './memory.js';
import { updateProfileTool } from './profile.js';
import { updateFamiliarityTool } from './familiarity.js';
import { searchReadBooksTool } from './search-read-books.js';
import { SkillLoader } from '../skills/loader.js';
import { toolsLog } from '../../utils/logger.js';

// 导出日志函数供控制台使用
export { setModuleEnabled, setModulesEnabled, getModuleConfig } from '../../utils/logger.js';

// 导出类型
export type { ToolExecutor, ToolRegistry, ToolContext } from './types.js';

// 导出各个工具
export { searchDocTool } from './search-doc.js';
export { getTocTool } from './get-toc.js';
export { getChapterTool } from './get-chapter.js';
export { createSkillTool } from './skill.js';
export { writeNoteTool } from './write-note.js';
export { createSubAgentTool } from './create-sub-agent.js';
export { addMemoryTool, searchMemoryTool, summarizeMemoryTool } from './memory.js';
export { updateProfileTool } from './profile.js';
export { updateFamiliarityTool } from './familiarity.js';
export { searchReadBooksTool } from './search-read-books.js';

/**
 * 创建并填充 Tool 注册表
 */
export function createToolRegistry(
  skillLoader: SkillLoader,
  context: ToolContext
): ToolRegistry {
  const registry: ToolRegistry = new Map();

  // 注册基础工具
  registry.set('search_doc', searchDocTool);
  registry.set('get_toc', getTocTool);
  registry.set('get_chapter', getChapterTool);

  // 注册 Skill 工具（需要依赖注入）
  const skillTool = createSkillTool(skillLoader);
  registry.set('Skill', skillTool);

  // 注册写入工具
  registry.set('write_note', writeNoteTool);

  // 注册子 Agent 工具
  registry.set('create_sub_agent', createSubAgentTool);

  // 注册记忆工具
  registry.set('add_memory', addMemoryTool);
  registry.set('search_memory', searchMemoryTool);
  registry.set('summarize_memory', summarizeMemoryTool);

  // 注册用户画像工具
  registry.set('update_profile', updateProfileTool);

  // 注册熟悉度工具
  registry.set('update_familiarity', updateFamiliarityTool);

  // 注册关联阅读工具
  registry.set('search_read_books', searchReadBooksTool);

  toolsLog('[ToolRegistry] 已注册', registry.size, '个工具:', Array.from(registry.keys()));

  return registry;
}

/**
 * 获取所有工具定义（用于 LLM 工具列表）
 */
export function getToolDefinitions(registry: ToolRegistry): ToolDefinition[] {
  return Array.from(registry.values()).map((executor) => executor.definition);
}

/**
 * 执行指定工具（带超时保护）
 * @param registry 工具注册表
 * @param name 工具名称
 * @param args 工具参数
 * @param context 工具上下文
 * @param timeout 超时时间（毫秒），默认 30 秒
 */
export async function executeTool(
  registry: ToolRegistry,
  name: string,
  args: Record<string, unknown>,
  context: ToolContext,
  timeout: number = 30000
): Promise<string> {
  const executor = registry.get(name);

  if (!executor) {
    const availableTools = Array.from(registry.keys()).join(', ');
    return `Error: Unknown tool "${name}". Available tools: ${availableTools}`;
  }

  toolsLog('[executeTool] 执行工具:', name, '参数:', args);

  try {
    // 使用 Promise.race 实现超时保护
    const result = await Promise.race([
      executor.execute(args, context),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error(`Tool execution timeout after ${timeout}ms`)), timeout)
      ),
    ]);
    toolsLog('[executeTool] 成功:', name, '结果长度:', result.length);
    return result;
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    toolsLog.error('[executeTool] 失败:', name, errorMsg);
    return `Error executing tool ${name}: ${errorMsg}`;
  }
}
