/**
 * SkillLoader - 扫描和解析 Obsidian Vault 中的 Skill .md 文件
 *
 * 设计理念：
 * - Layer 1: name + description（始终加载，约 50 tokens/skill）
 * - Layer 2: body（按需加载 via tool_result，约 500-2000 tokens）
 *
 * 这种分层设计保持 System Prompt 稳定，支持 Prompt Cache 复用
 */

import { toolsLog as log, error as logError } from '../../utils/logger.js';
import type { Skill } from './types.js';
import * as fs from 'fs';
import * as path from 'path';

export class SkillLoader {
  private skillsDir: string;
  private skills: Map<string, Skill> = new Map();
  private defaultSkillName: string | null = null;

  constructor(skillsDir: string) {
    this.skillsDir = skillsDir;
  }

  /**
   * 加载所有 Skills
   * 在插件加载时或 Skills 重新加载时调用
   */
  async loadSkills(): Promise<void> {
    this.skills.clear();
    this.defaultSkillName = null;

    try {
      // 检查目录是否存在
      if (!fs.existsSync(this.skillsDir)) {
        log('[SkillLoader] Skills 目录不存在:', this.skillsDir);
        return;
      }

      const files = fs
        .readdirSync(this.skillsDir)
        .filter((f: string) => f.endsWith('.md'));

      for (const file of files) {
        const filePath = path.join(this.skillsDir, file);
        const skill = this.parseSkillFile(filePath);

        if (skill) {
          this.skills.set(skill.name, skill);
          if (skill.isDefault) {
            this.defaultSkillName = skill.name;
            log('[SkillLoader] 设置默认 Skill:', skill.name);
          }
          log('[SkillLoader] 加载 Skill:', skill.name);
        }
      }

      log(`[SkillLoader] 共加载 ${this.skills.size} 个 Skills`);
    } catch (e) {
      logError('[SkillLoader] 加载 Skills 失败:', e);
    }
  }

  /**
   * 解析单个 Skill .md 文件
   * 包含路径遍历攻击防护
   */
  private parseSkillFile(filePath: string): Skill | null {
    try {
      // 安全检查：确保文件路径在 skillsDir 范围内，防止路径遍历攻击
      const resolvedPath = path.resolve(filePath);
      const resolvedDir = path.resolve(this.skillsDir);

      if (!resolvedPath.startsWith(resolvedDir)) {
        logError('[SkillLoader] 路径遍历攻击检测，拒绝访问:', filePath);
        return null;
      }

      // 额外检查：确保文件扩展名是 .md
      if (!resolvedPath.endsWith('.md')) {
        logError('[SkillLoader] 拒绝非 .md 文件:', filePath);
        return null;
      }

      const content = fs.readFileSync(filePath, 'utf-8');

      // 解析 YAML frontmatter（不使用 s 标志）
      if (!content.startsWith('---\n')) {
        logError('[SkillLoader] Skill 文件格式无效（缺少 frontmatter 起始）:', filePath);
        return null;
      }

      const endMarker = content.indexOf('\n---\n', 4);
      if (endMarker === -1) {
        logError('[SkillLoader] Skill 文件格式无效（缺少 frontmatter 结束）:', filePath);
        return null;
      }

      const frontmatter = content.slice(4, endMarker);
      const body = content.slice(endMarker + 5);

      // 解析 frontmatter（简单的 key: value 解析）
      const meta = this.parseFrontmatter(frontmatter);

      if (!meta.name || !meta.description) {
        logError('[SkillLoader] Skill 缺少 name 或 description:', filePath);
        return null;
      }

      return {
        name: meta.name as string,
        description: meta.description as string,
        body: body.trim(),
        path: filePath,
        isDefault: meta.default === true || meta.default === 'true',
        keywords: Array.isArray(meta.keywords) ? (meta.keywords as string[]) : undefined,
        meta: {
          version: meta.version as string | undefined,
          author: meta.author as string | undefined,
          tags: Array.isArray(meta.tags) ? (meta.tags as string[]) : undefined,
        },
      };
    } catch (e) {
      logError('[SkillLoader] 解析 Skill 文件失败:', filePath, e);
      return null;
    }
  }

  /**
   * 解析 YAML frontmatter
   */
  private parseFrontmatter(frontmatter: string): Record<string, unknown> {
    const meta: Record<string, unknown> = {};
    let currentKey = '';
    let currentValue: string[] = [];

    for (const line of frontmatter.split('\n')) {
      // 匹配 key: value
      const keyMatch = line.match(/^(\w+):\s*(.*)$/);
      if (keyMatch) {
        // 保存上一个 key
        if (currentKey) {
          meta[currentKey] =
            currentValue.length > 1 ? currentValue : currentValue[0] || '';
        }
        currentKey = keyMatch[1];
        currentValue = [keyMatch[2].trim()];
      } else if (line.startsWith('  - ') && currentKey) {
        // 数组项
        currentValue.push(line.slice(4).trim());
      }
    }

    // 保存最后一个 key
    if (currentKey) {
      meta[currentKey] =
        currentValue.length > 1 ? currentValue : currentValue[0] || '';
    }

    return meta;
  }

  /**
   * Layer 1: 获取 Skill 描述列表（用于 System Prompt）
   * 格式: "- skill_name: skill description"
   */
  getDescriptions(): string {
    if (this.skills.size === 0) {
      return '(no skills available)';
    }

    return Array.from(this.skills.values())
      .map((skill) => `- ${skill.name}: ${skill.description}`)
      .join('\n');
  }

  /**
   * Layer 2: 获取完整 Skill 内容（用于 tool_result 注入）
   */
  getSkillContent(name: string): string | null {
    const skill = this.skills.get(name);
    if (!skill) {
      return null;
    }

    return `<skill-loaded name="${skill.name}">
${skill.body}
</skill-loaded>

Follow the instructions in the skill above to complete the user's task.`;
  }

  /**
   * 列出所有 Skill 名称
   */
  listSkills(): string[] {
    return Array.from(this.skills.keys());
  }

  /**
   * 获取默认 Skill 名称
   */
  getDefaultSkill(): string | null {
    return this.defaultSkillName;
  }

  /**
   * 检查 Skill 是否存在
   */
  hasSkill(name: string): boolean {
    return this.skills.has(name);
  }

  /**
   * 获取 Skill 信息（不含 body）
   */
  getSkillInfo(name: string): { name: string; description: string } | null {
    const skill = this.skills.get(name);
    if (!skill) {
      return null;
    }
    return {
      name: skill.name,
      description: skill.description,
    };
  }

  /**
   * 获取所有 Skills 的信息列表
   */
  getAllSkillInfos(): { name: string; description: string; isDefault: boolean }[] {
    return Array.from(this.skills.values()).map((skill) => ({
      name: skill.name,
      description: skill.description,
      isDefault: skill.isDefault,
    }));
  }
}
