/**
 * Profile 工具 - 用户画像更新
 *
 * 提供：
 * - update_profile: 更新用户画像字段
 */

import type { ToolDefinition } from '../types.js';
import type { ToolExecutor, ToolContext } from './types.js';
import { toolsLog as log, error } from '../../utils/logger.js';

/**
 * update_profile 工具定义
 */
const updateProfileDefinition: ToolDefinition = {
  type: 'function',
  function: {
    name: 'update_profile',
    description: `更新用户画像字段。用于用户表达新偏好、纠正行为、提供个人信息时。每次只更新一个字段。`,
    parameters: {
      type: 'object',
      properties: {
        section: {
          type: 'string',
          description: '画像部分：基础信息|阅读偏好|认知特点|阅读轨迹',
          enum: ['基础信息', '阅读偏好', '认知特点', '阅读轨迹'],
        },
        field: {
          type: 'string',
          description: '具体字段名，如 "称呼"、"风格"、"擅长"',
        },
        value: {
          type: 'string',
          description: '新的值',
        },
        mode: {
          type: 'string',
          description: '更新模式：append（追加）或 replace（替换，默认）',
          enum: ['append', 'replace'],
        },
      },
      required: ['section', 'field', 'value'],
    },
  },
};

/**
 * 更新 DeepReader.md 的某个字段
 */
function updateProfileSection(
  content: string,
  section: string,
  field: string,
  value: string,
  mode: string
): string {
  const lines = content.split('\n');
  let inTargetSection = false;
  let sectionStartIndex = -1;
  let fieldIndex = -1;

  // 找到目标 section
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith(`## ${section}`)) {
      inTargetSection = true;
      sectionStartIndex = i;
    } else if (lines[i].startsWith('## ') && inTargetSection) {
      // 到达下一个 section，停止搜索
      break;
    } else if (inTargetSection && (lines[i].startsWith(`${field}：`) || lines[i].startsWith(`${field}:`))) {
      fieldIndex = i;
      break;
    }
  }

  // 如果找到字段，更新它
  if (fieldIndex !== -1) {
    if (mode === 'append') {
      lines[fieldIndex] = lines[fieldIndex] + '，' + value;
    } else {
      const colonIndex = lines[fieldIndex].includes('：')
        ? lines[fieldIndex].indexOf('：')
        : lines[fieldIndex].indexOf(':');
      lines[fieldIndex] = lines[fieldIndex].substring(0, colonIndex + 1) + value;
    }
  } else if (sectionStartIndex !== -1) {
    // section 存在但字段不存在，添加字段
    lines.splice(sectionStartIndex + 1, 0, `${field}：${value}`);
  } else {
    // section 不存在，添加 section 和字段
    lines.push(`\n## ${section}\n${field}：${value}`);
  }

  return lines.join('\n');
}

/**
 * 创建 update_profile 工具执行器
 */
export function createUpdateProfileTool(): ToolExecutor {
  return {
    definition: updateProfileDefinition,
    async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
      const section = args.section as string;
      const field = args.field as string;
      const value = args.value as string;
      const mode = (args.mode as string) || 'replace';

      if (!section || !field || !value) {
        return 'Error: section, field, value 参数都是必需的';
      }

      if (!context.vault?.app) {
        return 'Error: Obsidian App 实例不可用';
      }

      try {
        // 读取现有 DeepReader.md
        const profilePath = 'DeepReader/DeepReader.md';
        const exists = await context.vault.app.vault.adapter.exists(profilePath);

        let content = '';
        if (exists) {
          content = await context.vault.app.vault.adapter.read(profilePath);
        }

        // 更新内容
        const updatedContent = updateProfileSection(content, section, field, value, mode);

        // 写回文件
        await context.vault.app.vault.adapter.write(profilePath, updatedContent);

        log('[update_profile] 已更新:', section, field, value);

        // 返回隐藏消息格式，供调用方注入
        return JSON.stringify({
          success: true,
          hiddenMessage: {
            role: 'user',
            content: `[用户画像更新]\n${section} - ${field}: ${value}`,
            hidden: true,
          },
        });
      } catch (err) {
        error('[update_profile] 执行失败:', err);
        return `更新画像时出错: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}

// 导出工具定义（用于注册）
export const updateProfileTool: ToolExecutor = {
  definition: updateProfileDefinition,
  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    if (!context.vault?.app) {
      return 'Error: Obsidian App 实例不可用';
    }
    return createUpdateProfileTool().execute(args, context);
  },
};
