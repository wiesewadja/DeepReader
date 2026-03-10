/**
 * write_note Tool - 写入笔记到 Obsidian vault
 *
 * 行为规则：
 * 1. 新建文件：添加 aicreate frontmatter
 * 2. 覆盖/追加：检查 aicreate，有则允许，否则拒绝
 * 3. 目录不存在：自动创建
 */

import type { ToolDefinition } from '../types.js';
import type { ToolExecutor, ToolContext } from './types.js';
import { TFile, normalizePath } from 'obsidian';
import { log, error as logError } from '../../utils/logger.js';

const WRITE_NOTE_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'write_note',
    description: 'Write a note to Obsidian vault. AI-created notes are marked with aicreate frontmatter and can only be modified by AI.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path for the note (e.g., "知识卡/概念/神经网络.md")',
        },
        content: {
          type: 'string',
          description: 'Note content in Markdown format',
        },
        mode: {
          type: 'string',
          enum: ['create', 'overwrite', 'append'],
          description: 'Write mode: create (new only), overwrite (replace), append (add to end). Default: create',
        },
      },
      required: ['path', 'content'],
    },
  },
};

/**
 * 生成带有 aicreate frontmatter 的内容
 */
function generateContentWithFrontmatter(
  content: string,
  mode: 'create' | 'overwrite' | 'append',
  existingContent?: string
): string {
  const now = new Date().toISOString();

  if (mode === 'create') {
    return `---
aicreate: true
created_at: ${now}
---

${content}`;
  }

  if (mode === 'overwrite') {
    return `---
aicreate: true
created_at: ${now}
updated_at: ${now}
---

${content}`;
  }

  // append: 直接追加，不修改 frontmatter
  return existingContent + '\n\n' + content;
}

/**
 * 检查文件是否有 aicreate frontmatter
 */
async function hasAicreateFrontmatter(app: any, file: TFile): Promise<boolean> {
  try {
    const content = await app.vault.read(file);
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) return false;

    const frontmatter = frontmatterMatch[1];
    return frontmatter.includes('aicreate: true');
  } catch {
    return false;
  }
}

/**
 * 确保目录存在
 */
async function ensureFolderExists(app: any, folderPath: string): Promise<void> {
  const normalizedPath = normalizePath(folderPath);
  const parts = normalizedPath.split('/');
  let currentPath = '';

  for (const part of parts) {
    currentPath = currentPath ? `${currentPath}/${part}` : part;
    const folder = app.vault.getAbstractFileByPath(currentPath);

    if (!folder) {
      await app.vault.createFolder(currentPath);
      log('[write_note] 创建目录:', currentPath);
    }
  }
}

export const writeNoteTool: ToolExecutor = {
  definition: WRITE_NOTE_DEFINITION,

  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    const path = args.path as string;
    const content = args.content as string;
    const mode = (args.mode as 'create' | 'overwrite' | 'append') || 'create';

    if (!path || !content) {
      return 'Error: path and content parameters are required';
    }

    const app = context.app;
    if (!app) {
      return 'Error: Obsidian app instance not available in context';
    }

    try {
      log('[write_note] 执行:', { path, mode, contentLength: content.length });

      const normalizedPath = normalizePath(path);
      const existingFile = app.vault.getAbstractFileByPath(normalizedPath);

      // 文件已存在
      if (existingFile instanceof TFile) {
        // 检查 aicreate 权限
        const hasPermission = await hasAicreateFrontmatter(app, existingFile);
        if (!hasPermission) {
          return `Error: Cannot modify "${path}" - file was not created by AI (no aicreate frontmatter)`;
        }

        if (mode === 'create') {
          return `Error: File "${path}" already exists. Use mode="overwrite" or mode="append" to modify.`;
        }

        const existingContent = await app.vault.read(existingFile);
        const newContent = generateContentWithFrontmatter(content, mode, existingContent);

        await app.vault.modify(existingFile, newContent);
        log('[write_note] 文件已更新:', normalizedPath);
        return `Note updated successfully: ${path}`;
      }

      // 文件不存在，创建新文件
      if (mode !== 'create' && mode !== 'overwrite') {
        return `Error: File "${path}" does not exist. Use mode="create" to create a new file.`;
      }

      // 确保目录存在
      const folderPath = normalizedPath.substring(0, normalizedPath.lastIndexOf('/'));
      if (folderPath) {
        await ensureFolderExists(app, folderPath);
      }

      const newContent = generateContentWithFrontmatter(content, 'create');
      await app.vault.create(normalizedPath, newContent);

      log('[write_note] 文件已创建:', normalizedPath);
      return `Note created successfully: ${path}`;
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      logError('[write_note] 写入失败:', errorMsg);
      return `Error writing note: ${errorMsg}`;
    }
  },
};
