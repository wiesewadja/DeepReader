// src/agent/prompts/version.ts

import type { PromptModule } from './types.js';

/** 版本信息 */
interface VersionInfo {
  module: string;
  version: string;
  changelog: ChangelogEntry[];
  lastUpdated: string;
}

/** 变更日志条目 */
export interface ChangelogEntry {
  version: string;
  date: string;
  changes: string[];
  author?: string;
}

/** 版本管理器 */
export class PromptVersionManager {
  private versions = new Map<string, VersionInfo>();

  /** 注册模块版本 */
  register(module: PromptModule): void {
    const existing = this.versions.get(module.id);
    if (existing && existing.version === module.version) {
      return; // 版本未变，跳过
    }

    const entry: ChangelogEntry = {
      version: module.version,
      date: new Date().toISOString().split('T')[0],
      changes: ['初始版本'],
    };

    if (existing) {
      existing.changelog.push(entry);
      existing.version = module.version;
      existing.lastUpdated = entry.date;
    } else {
      this.versions.set(module.id, {
        module: module.id,
        version: module.version,
        changelog: [entry],
        lastUpdated: entry.date,
      });
    }
  }

  /** 获取模块版本 */
  getVersion(moduleId: string): string {
    return this.versions.get(moduleId)?.version || 'unknown';
  }

  /** 获取变更日志 */
  getChangelog(moduleId: string): ChangelogEntry[] {
    return this.versions.get(moduleId)?.changelog || [];
  }

  /** 比较版本 */
  compareVersions(moduleId: string, v1: string, v2: string): number {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);
    
    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;
      if (p1 !== p2) return p1 - p2;
    }
    return 0;
  }
}

// 全局实例
export const promptVersionManager = new PromptVersionManager();
