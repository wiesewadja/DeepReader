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
import { toolsLog as log, error as logError } from '../../utils/logger.js';
import { parseFrontmatter } from '../utils/book-note.js';

const WRITE_NOTE_DEFINITION: ToolDefinition = {
  type: 'function',
  function: {
    name: 'write_note',
    description: '写入笔记到 Obsidian vault。AI 创建的笔记带 aicreate 标记，只能由 AI 修改。',
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
 * 检测内容是否包含 frontmatter
 */
function parseContentFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } | null {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!match) return null;

  const frontmatterText = match[1];
  const body = content.slice(match[0].length);
  const frontmatter: Record<string, unknown> = {};

  // 简单解析 YAML frontmatter
  for (const line of frontmatterText.split('\n')) {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim();
      const value = line.slice(colonIndex + 1).trim();
      // 处理数组格式 [a, b, c]
      if (value.startsWith('[') && value.endsWith(']')) {
        frontmatter[key] = value
          .slice(1, -1)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      } else {
        frontmatter[key] = value;
      }
    }
  }

  return { frontmatter, body };
}

/**
 * 将 frontmatter 对象转换为 YAML 字符串
 */
function frontmatterToString(frontmatter: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(frontmatter)) {
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.join(', ')}]`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  return lines.join('\n');
}

/**
 * 生成带有 aicreate frontmatter 的内容
 * 如果传入的内容已包含 frontmatter，会智能合并
 */
function generateContentWithFrontmatter(
  content: string,
  mode: 'create' | 'overwrite' | 'append',
  existingContent?: string
): string {
  const now = new Date().toISOString();

  // append: 直接追加，不修改 frontmatter
  if (mode === 'append' && existingContent) {
    return existingContent + '\n\n' + content;
  }

  // 检测内容是否已包含 frontmatter
  const parsed = parseContentFrontmatter(content);
  const bodyContent = parsed ? parsed.body : content;
  const existingFrontmatter = parsed?.frontmatter || {};

  // 合并 frontmatter：AI 必需字段 + 用户自定义字段
  const mergedFrontmatter: Record<string, unknown> = {
    ...existingFrontmatter,
    aicreate: true,
    created_at: now,
  };

  if (mode === 'overwrite') {
    mergedFrontmatter.updated_at = now;
  }

  // 如果用户提供了 created/created_at，保留用户的时间（但 created_at 会被覆盖为 now）
  // 优先使用用户定义的 created 字段
  if (existingFrontmatter.created && !existingFrontmatter.created_at) {
    // 用户有自己的 created 字段，保持它
  }

  const frontmatterStr = frontmatterToString(mergedFrontmatter);

  return `---
${frontmatterStr}
---

${bodyContent}`;
}

/**
 * 检查文件是否有 aicreate frontmatter
 */
async function hasAicreateFrontmatter(app: any, file: TFile): Promise<boolean> {
  try {
    const content = await app.vault.read(file);
    const parsed = parseFrontmatter(content);
    if (!parsed) return false;

    return parsed.frontmatter.includes('aicreate: true');
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

    const app = context.vault?.app;
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

        // 提取文件名作为显示文本
        const displayName = normalizedPath.split('/').pop()?.replace(/\.md$/, '') || normalizedPath;
        return `✅ 笔记已更新: [[${normalizedPath}|${displayName}]]`;
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

      // 提取文件名作为显示文本，返回 wiki 链接格式
      const displayName = normalizedPath.split('/').pop()?.replace(/\.md$/, '') || normalizedPath;
      return `✅ 笔记已创建: [[${normalizedPath}|${displayName}]]`;
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      logError('[write_note] 写入失败:', errorMsg);
      return `Error writing note: ${errorMsg}`;
    }
  },
};
