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
import { createSubAgentTool, checkSubAgentTool } from './create-sub-agent.js';
import { addMemoryTool, searchMemoryTool } from './memory.js';
import { updateProfileTool } from './profile.js';
import { searchReadBooksTool } from './search-read-books.js';
import { createCanvasTool } from './canvas.js';
import { createExcalidrawTool } from './excalidraw.js';
import { outlineStructureTool } from './outline-structure.js';
import { findKeyTermsTool } from './find-key-terms.js';
import { extractPropositionsTool } from './extract-propositions.js';
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
export { addMemoryTool, searchMemoryTool, saveMemoryTool, createSaveMemoryTool } from './memory.js';
export { updateProfileTool } from './profile.js';
export { searchReadBooksTool } from './search-read-books.js';
export { createCanvasTool } from './canvas.js';
export { createExcalidrawTool } from './excalidraw.js';
export { outlineStructureTool } from './outline-structure.js';
export { findKeyTermsTool } from './find-key-terms.js';
export { extractPropositionsTool } from './extract-propositions.js';

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
  registry.set('check_sub_agent', checkSubAgentTool);

  // 注册记忆工具
  registry.set('add_memory', addMemoryTool);
  registry.set('search_memory', searchMemoryTool);
  // 注意: summarize_memory 已被移除，整合现在是自动的

  // 注册用户画像工具
  registry.set('update_profile', updateProfileTool);


  // 注册关联阅读工具
  registry.set('search_read_books', searchReadBooksTool);

  // 注册分析阅读工具（对应《如何阅读一本书》规则2-6）
  registry.set('outline_structure', outlineStructureTool);
  registry.set('find_key_terms', findKeyTermsTool);
  registry.set('extract_propositions', extractPropositionsTool);

  // 注册 Canvas 工具（需要 Obsidian App 实例）
  if (context.app) {
    registry.set('canvas', createCanvasTool(context.app));
  }

  // 注册 Excalidraw 工具（独立于 Canvas，直接生成 Excalidraw 图形）
  registry.set('excalidraw', createExcalidrawTool());

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
 * 执行指定工具（带超时保护和详细日志）
 * @param registry 工具注册表
 * @param name 工具名称
 * @param args 工具参数
 * @param context 工具上下文
 * @param timeout 超时时间（毫秒），默认 60 秒（search_doc 需要更长时间）
 */
export async function executeTool(
  registry: ToolRegistry,
  name: string,
  args: Record<string, unknown>,
  context: ToolContext,
  timeout: number = 60000  // 从 30s 增加到 60s
): Promise<string> {
  const executor = registry.get(name);

  if (!executor) {
    const availableTools = Array.from(registry.keys()).join(', ');
    toolsLog.error(`[Tool] ❌ 未知工具: ${name}，可用: ${availableTools}`);
    return `Error: Unknown tool "${name}". Available tools: ${availableTools}`;
  }

  // 简化参数日志（只显示关键信息）
  const argsPreview = Object.entries(args)
    .slice(0, 3)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? `"${v.slice(0, 30)}${v.length > 30 ? '...' : ''}"` : JSON.stringify(v)}`)
    .join(', ');
  toolsLog(`[Tool] ▶ 开始执行: ${name}(${argsPreview}${Object.keys(args).length > 3 ? ', ...' : ''})`);

  const startTime = performance.now();

  try {
    // 使用 Promise.race 实现超时保护
    const result = await Promise.race([
      executor.execute(args, context),
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error(`Tool execution timeout after ${timeout}ms`)), timeout)
      ),
    ]);

    const duration = performance.now() - startTime;
    const durationStr = duration < 1000 ? `${duration.toFixed(0)}ms` : `${(duration / 1000).toFixed(1)}s`;

    // 结果摘要（显示前100字符和长度）
    const resultPreview = result.length > 100 ? `${result.slice(0, 100)}...` : result;
    toolsLog(`[Tool] ✓ 完成: ${name} [${durationStr}, ${result.length}字符]`);

    return result;
  } catch (e) {
    const duration = performance.now() - startTime;
    const durationStr = duration < 1000 ? `${duration.toFixed(0)}ms` : `${(duration / 1000).toFixed(1)}s`;
    const errorMsg = e instanceof Error ? e.message : String(e);
    toolsLog.error(`[Tool] ✗ 失败: ${name} [${durationStr}] - ${errorMsg}`);
    return `Error executing tool ${name}: ${errorMsg}`;
  }
}
