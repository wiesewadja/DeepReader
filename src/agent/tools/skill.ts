/**
 * Skill Tool - 加载专业技能
 */

import type { ToolDefinition } from '../types.js';
import type { ToolExecutor, ToolContext } from './types.js';
import { toolsLog as log, error as logError } from '../../utils/logger.js';

// SkillLoader 类型定义（从 skills/loader.ts 导入）
interface SkillLoader {
  getSkillContent(name: string): string | null;
  getDescriptions(): string;
  hasSkill(name: string): boolean;
  listSkills(): string[];
}

/**
 * 动态生成 Skill 工具定义
 * 技能列表在 System Prompt 的 <skills> 标签中，这里不再重复
 */
function createSkillDefinition(skillLoader: SkillLoader): ToolDefinition {
  const skillNames = skillLoader.listSkills();

  return {
    type: 'function',
    function: {
      name: 'Skill',
      description: `加载专业技能的完整指导内容。

查看 System Prompt 中的 <skills> 标签获取可用技能列表。
每个 Skill 包含特定场景的详细工作流程和指令。`,
      parameters: {
        type: 'object',
        properties: {
          skill: {
            type: 'string',
            description: '要加载的技能名称',
            enum: skillNames.length > 0 ? skillNames : undefined,
          },
        },
        required: ['skill'],
      },
    },
  };
}

/**
 * 创建 Skill Tool 执行器
 * 这是一个工厂函数，因为需要依赖注入 SkillLoader
 */
export function createSkillTool(skillLoader: SkillLoader): ToolExecutor {
  return {
    // 动态生成 definition，包含可用技能列表
    get definition() {
      return createSkillDefinition(skillLoader);
    },

    async execute(args: Record<string, unknown>, _context: ToolContext): Promise<string> {
      const skillName = args.skill as string;

      if (!skillName) {
        return 'Error: skill parameter is required';
      }

      try {
        log('[Skill] 加载技能:', skillName);

        // 检查技能是否存在
        if (!skillLoader.hasSkill(skillName)) {
          const availableSkills = skillLoader.listSkills();
          const skillList = availableSkills.length > 0
            ? availableSkills.map((s) => `- ${s}`).join('\n')
            : '(no skills available)';

          return `Skill "${skillName}" not found.\n\nAvailable skills:\n${skillList}`;
        }

        // 获取技能内容
        const content = skillLoader.getSkillContent(skillName);

        if (!content) {
          return `Error: Failed to load content for skill "${skillName}"`;
        }

        log('[Skill] 成功加载技能:', skillName);
        return content;
      } catch (e) {
        const errorMsg = e instanceof Error ? e.message : String(e);
        logError('[Skill] 加载技能失败:', errorMsg);
        return `Error loading skill: ${errorMsg}`;
      }
    },
  };
}
