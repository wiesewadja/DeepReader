/**
 * Tool 注册表和执行管理
 */

import type { ToolExecutor, ToolContext } from './types.js';
import type { StructuredToolInterface } from '@langchain/core/tools';

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
import {
	createWereadSearchTool,
	createWereadRecommendTool,
	createWereadReadDataTool,
	createWereadNotebooksTool,
	createWereadBookInfoTool,
} from './definitions/weread-tools.js';

// 导出日志函数供控制台使用
export { setModuleEnabled, setModulesEnabled, getModuleConfig } from '../../utils/logger.js';

// 导出类型
export type { ToolExecutor, ToolContext } from './types.js';

// 本地 Markdown 工具
export {
  searchBookTool,
  readBookSectionTool
} from './local/index.js';
export { writeNoteTool } from './write-note.js';
export { createSubAgentTool } from './create-sub-agent.js';
export { addMemoryTool, searchMemoryTool, saveMemoryTool, createSaveMemoryTool } from './memory.js';
export { updateProfileTool } from './profile.js';
export { searchReadBooksTool } from './search-read-books.js';
export { createCanvasTool } from './canvas.js';
export { createExcalidrawTool } from './excalidraw.js';

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

  // WeRead 工具：仅当 API Key 已配置时注册
  if (ctx.plugin?.settings?.wereadApiKey) {
    tools.push(
      createWereadSearchTool(ctx),
      createWereadRecommendTool(ctx),
      createWereadReadDataTool(ctx),
      createWereadNotebooksTool(ctx),
      createWereadBookInfoTool(ctx),
    );
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
