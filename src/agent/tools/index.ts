/**
 * Tool 注册表和执行管理
 */

import type { StructuredToolInterface } from '@langchain/core/tools';

// LangChain tool() 格式的工具定义
import { createSaveMemoryTool, createSearchMemoryTool } from './definitions/memory.js';
import { createUpdateProfileTool } from './definitions/profile.js';
import { createReadBookSectionTool } from './definitions/read-section.js';
import { createSearchBookTool } from './definitions/search-book.js';
import { createSearchJournalTool } from './definitions/search-journal.js';
import { createSearchReadBooksTool } from './definitions/search-read-books.js';
import {
	createWereadSearchTool,
	createWereadRecommendTool,
	createWereadReadDataTool,
	createWereadNotebooksTool,
	createWereadBookInfoTool,
} from './definitions/weread-tools.js';
import { createWriteNoteTool } from './definitions/write-note.js';
import type { ToolExecutor, ToolContext } from './types.js';

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
export { addMemoryTool, searchMemoryTool, saveMemoryTool, createSaveMemoryTool } from './memory.js';
export { updateProfileTool } from './profile.js';
export { searchReadBooksTool } from './search-read-books.js';

/**
 * 创建 LangChain StructuredToolInterface[] 数组。
 * 每个工具通过闭包捕获 ToolContext。
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
  ];

  // search_journal 依赖 journalDir 配置
  if (ctx.visual?.journalDir) {
    tools.push(createSearchJournalTool(ctx));
  }

  // WeRead 工具：仅当 API Key 已配置时注册
  if (ctx.vault?.plugin?.settings?.wereadApiKey) {
    tools.push(
      createWereadSearchTool(ctx),
      createWereadRecommendTool(ctx),
      createWereadReadDataTool(ctx),
      createWereadBookInfoTool(ctx),
      createWereadNotebooksTool(ctx),
    );
  }

  return tools;
}
