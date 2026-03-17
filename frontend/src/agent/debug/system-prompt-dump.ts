/**
 * 系统提示词抓取脚本
 *
 * 使用方式：
 * 1. 在 Obsidian 开发者控制台 (Ctrl+Shift+I) 中运行
 * 2. 或者在 VSCode 调试模式下运行
 *
 * 输出：
 * - 控制台打印完整系统提示词
 * - 保存到 window.SYSTEM_PROMPT 供后续访问
 */

import type { App } from 'obsidian';
import { FrontendAgent, type DocumentMetadata } from '../index.js';

/**
 * 抓取并打印系统提示词
 *
 * @param app Obsidian App 实例
 * @param options 配置选项
 */
export async function dumpSystemPrompt(
  app: App,
  options: {
    /** API Key (必须) */
    apiKey: string;
    /** Base URL (可选，默认使用 DeepSeek) */
    baseUrl?: string;
    /** 模型名称 (可选) */
    model?: string;
    /** Skills 目录 (可选，默认 DeepReader/skills) */
    skillsDir?: string;
    /** 文档元数据 (可选) */
    documentMetadata?: DocumentMetadata;
    /** 全书摘要 (可选) */
    docDescription?: string;
    /** 是否保存到文件 */
    saveToFile?: boolean;
  }
): Promise<string> {
  const {
    apiKey,
    baseUrl,
    model = 'deepseek-chat',
    skillsDir = 'DeepReader/skills',
    documentMetadata,
    docDescription,
    saveToFile = false,
  } = options;

  console.log('[SystemPromptDump] 初始化 FrontendAgent...');

  // 创建 Agent 实例
  const agent = new FrontendAgent({
    apiKey,
    baseUrl,
    model,
    skillsDir,
    app,
  });

  // 初始化
  await agent.initialize();

  console.log('[SystemPromptDump] 加载 skills:', agent.listSkills());

  // 构建系统提示词
  console.log('[SystemPromptDump] 正在构建系统提示词...');
  const systemPrompt = await agent.getSystemPromptAsync(documentMetadata, docDescription);

  // 打印分隔线
  console.log('%c' + '='.repeat(80), 'color: #4CAF50; font-weight: bold');
  console.log('%c系统提示词抓取完成', 'color: #4CAF50; font-weight: bold; font-size: 14px');
  console.log('%c' + '='.repeat(80), 'color: #4CAF50; font-weight: bold');

  // 打印完整提示词
  console.log('%c' + systemPrompt, 'color: #2196F3; font-family: monospace; font-size: 12px');

  // 打印分隔线
  console.log('%c' + '='.repeat(80), 'color: #4CAF50; font-weight: bold');
  console.log(`%c提示词长度: ${systemPrompt.length} 字符`, 'color: #9E9E9E');

  // 保存到全局变量
  (window as any).SYSTEM_PROMPT = systemPrompt;
  console.log('[SystemPromptDump] 已保存到 window.SYSTEM_PROMPT');

  // 可选：保存到文件
  if (saveToFile) {
    try {
      const filename = `system-prompt-${Date.now()}.txt`;
      await app.vault.create(
        `DeepReader/debug/${filename}`,
        `<!-- 生成时间: ${new Date().toISOString()} -->\n\n${systemPrompt}`
      );
      console.log(`[SystemPromptDump] 已保存到 DeepReader/${filename}`);
    } catch (err) {
      console.error('[SystemPromptDump] 保存文件失败:', err);
    }
  }

  return systemPrompt;
}

/**
 * 快速抓取（使用默认配置）
 * 需要先设置 window.APP 全局变量
 */
export async function quickDump(): Promise<string> {
  const app = (window as any).APP;
  if (!app) {
    throw new Error('请先设置 window.APP = app');
  }

  const apiKey = (window as any).DEEPSEEK_API_KEY || '';
  if (!apiKey) {
    throw new Error('请先设置 window.DEEPSEEK_API_KEY');
  }

  return dumpSystemPrompt(app, {
    apiKey,
    documentMetadata: {
      title: '测试文档',
      page_count: 100,
    },
    saveToFile: true,
  });
}

// 导出到全局
if (typeof window !== 'undefined') {
  (window as any).dumpSystemPrompt = dumpSystemPrompt;
  (window as any).quickDump = quickDump;
}

console.log('%c[SystemPromptDump] 脚本已加载', 'color: #4CAF50');
console.log('%c使用方法:', 'color: #FF9800; font-weight: bold');
console.log('%c  dumpSystemPrompt(app, { apiKey: "your-key" })', 'color: #2196F3; font-family: monospace');
console.log('%c  quickDump() // 需要先设置 window.APP 和 window.DEEPSEEK_API_KEY', 'color: #2196F3; font-family: monospace');