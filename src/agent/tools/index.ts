/**
 * Tool 注册表和执行管理
 */

import type { ToolDefinition } from '../types.js';
import { TOOL_EXECUTION_TIMEOUT_MS } from '../config/agent-constants.js';
import type { ToolExecutor, ToolRegistry, ToolContext } from './types.js';
import type { StructuredToolInterface } from '@langchain/core/tools';
// 本地 Markdown 工具（零外部依赖）- 主要工具
import {
  searchBookTool,
  readBookSectionTool
} from './local/index.js';
import { createSkillTool } from './skill.js';  // TODO: 暂时屏蔽 Skills 功能
import { writeNoteTool } from './write-note.js';
import { createSubAgentTool, checkSubAgentTool } from './create-sub-agent.js';
import { addMemoryTool, searchMemoryTool } from './memory.js';
import { updateProfileTool } from './profile.js';
import { searchReadBooksTool } from './search-read-books.js';
import { createCanvasTool } from './canvas.js';
import { createExcalidrawTool } from './excalidraw.js';
import { SkillLoader } from '../skills/loader.js';
import { toolsLog } from '../../utils/logger.js';

// LangChain tool() 格式的工具定义
import { createSearchBookTool } from './definitions/search-book.js';
import { createReadBookSectionTool } from './definitions/read-section.js';
import { createWriteNoteTool } from './definitions/write-note.js';
import { createSaveMemoryTool, createSearchMemoryTool } from './definitions/memory.js';
import { createUpdateProfileTool } from './definitions/profile.js';
import { createSearchReadBooksTool } from './definitions/search-read-books.js';
import { createCanvasToolDefinition } from './definitions/canvas.js';
import { createExcalidrawToolDefinition } from './definitions/excalidraw.js';
import { createCheckSubAgentTool } from './definitions/sub-agent.js';
import { createSearchJournalTool } from './definitions/search-journal.js';
import { createGenerateInfographicTool } from './definitions/generate-infographic.js';

// 导出日志函数供控制台使用
export { setModuleEnabled, setModulesEnabled, getModuleConfig } from '../../utils/logger.js';

// 导出类型
export type { ToolExecutor, ToolRegistry, ToolContext } from './types.js';

// 本地 Markdown 工具
export {
  searchBookTool,
  readBookSectionTool
} from './local/index.js';
export { createSkillTool } from './skill.js';
export { writeNoteTool } from './write-note.js';
export { createSubAgentTool } from './create-sub-agent.js';
export { addMemoryTool, searchMemoryTool, saveMemoryTool, createSaveMemoryTool } from './memory.js';
export { updateProfileTool } from './profile.js';
export { searchReadBooksTool } from './search-read-books.js';
export { createCanvasTool } from './canvas.js';
export { createExcalidrawTool } from './excalidraw.js';

/**
 * 创建并填充 Tool 注册表
 * @deprecated LangGraph 路径使用 createLangChainTools() 代替。仅 SubagentManager 使用，但当前传入 null。
 */
export function createToolRegistry(
  skillLoader: SkillLoader,
  context: ToolContext
): ToolRegistry {
  const registry: ToolRegistry = new Map();

  // 注册本地 Markdown 工具（零外部依赖）- 主要工具
  registry.set('search_book', searchBookTool);
  registry.set('read_book_section', readBookSectionTool);

  // 注册 Skill 工具（需要依赖注入）
  // TODO: 暂时屏蔽 Skills 功能
  // const skillTool = createSkillTool(skillLoader);
  // registry.set('Skill', skillTool);

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
 * @param timeout 超时时间（毫秒），默认 60 秒
 */
export async function executeTool(
  registry: ToolRegistry,
  name: string,
  args: Record<string, unknown>,
  context: ToolContext,
  timeout: number = TOOL_EXECUTION_TIMEOUT_MS
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

/**
 * 创建 LangChain StructuredToolInterface[] 数组。
 * 每个工具通过闭包捕获 ToolContext。
 *
 * 注意：canvas 依赖 ctx.app（Obsidian vault 操作），
 * excalidraw 使用 window.ExcalidrawAutomate 全局 API（不依赖 ctx.app）。
 */
export function createLangChainTools(ctx: ToolContext): StructuredToolInterface[] {
  const tools: StructuredToolInterface[] = [
    createSearchBookTool(ctx),
    createReadBookSectionTool(ctx),
    createWriteNoteTool(ctx),
    createSaveMemoryTool(ctx),
    createSearchMemoryTool(ctx),
    createUpdateProfileTool(ctx),
    createSearchReadBooksTool(ctx),
    createCheckSubAgentTool(ctx),
    createExcalidrawToolDefinition(ctx),
  ];

  // canvas 依赖 Obsidian app
  if (ctx.app) {
    tools.push(createCanvasToolDefinition(ctx));
  }

  // search_journal 依赖 journalDir 配置
  if (ctx.journalDir) {
    tools.push(createSearchJournalTool(ctx));
  }

  if (ctx.infographicConfig) {
    tools.push(createGenerateInfographicTool(ctx));
  }

  return tools;
}

/**
 * 只创建 visualizer 节点所需的工具（excalidraw + generate_infographic）。
 * 避免 createLangChainTools 中为所有 ~12 个工具构建 schema 的开销。
 */
export function createVizTools(ctx: ToolContext): StructuredToolInterface[] {
  const tools: StructuredToolInterface[] = [
    createExcalidrawToolDefinition(ctx),
  ];
  if (ctx.infographicConfig) {
    tools.push(createGenerateInfographicTool(ctx));
  }
  return tools;
}
