/**
 * 通用 Tab — 调试日志、Skills、PDF 索引参数、主动引导、语音回复、重排序参数
 */

import { Notice, Setting } from 'obsidian';
import type { SectionContext } from '../types';
import { setLogEnabled } from '../../utils/logger';

export function renderGeneralSection(
  container: HTMLElement,
  ctx: SectionContext,
  expandedSections: Set<string>,
  onRerender: () => void,
): void {
  container.createEl('h3', { text: '通用设置' });

  new Setting(container)
    .setName('启用调试日志')
    .setDesc('开启后会在控制台输出详细运行日志，用于问题排查。默认关闭以减少日志噪音。')
    .addToggle(toggle => toggle
      .setValue(ctx.plugin.settings.enableDebugLog)
      .onChange(async (value) => {
        ctx.plugin.settings.enableDebugLog = value;
        setLogEnabled(value);
        await ctx.plugin.saveSettings();
      }));

  new Setting(container)
    .setName('语音书信回复')
    .setDesc('AI 回复变为语音对话气泡+书信模式。语音从分析结果并行生成，文字以信封形式呈现。需要配置 TTS 角色。')
    .addToggle(toggle => toggle
      .setValue(ctx.plugin.settings.enableVoiceReply)
      .onChange(async (value) => {
        ctx.plugin.settings.enableVoiceReply = value;
        await ctx.plugin.saveSettings();
      }));

  container.createEl('hr', { cls: 'deeppdf-settings-divider' });

  // Skills 管理（由 PI Agent 接管）
  container.createEl('h4', { text: 'Skills 管理' });
  container.createEl('p', { text: 'Skills 现由 PI Agent 管理。请将 Skill 文件放入 DeepReader/skills/ 目录，PI 会自动加载。', cls: 'setting-item-description' });

  container.createEl('p', {
    text: '提示：你也可以通过命令面板（Cmd/Ctrl+P）搜索"Reload DeepReader Skills"来重载。',
    cls: 'setting-item-description',
  });

  container.createEl('hr', { cls: 'deeppdf-settings-divider' });

  // 主动阅读引导
  container.createEl('h4', { text: '主动阅读引导' });

  new Setting(container)
    .setName('启用主动引导')
    .setDesc('打开新书时，奚童会主动提出结构化问题，帮助你快速建立对书籍的整体理解')
    .addToggle(toggle => toggle
      .setValue(ctx.plugin.settings.proactiveGuidanceEnabled)
      .onChange(async (value) => {
        ctx.plugin.settings.proactiveGuidanceEnabled = value;
        await ctx.plugin.saveSettings();
      }));

  new Setting(container)
    .setName('引导冷却时间')
    .setDesc('两次主动引导之间的最小间隔（分钟）')
    .addSlider(slider => slider
      .setLimits(1, 30, 1)
      .setValue(ctx.plugin.settings.proactiveCooldownMinutes)
      .setDynamicTooltip()
      .onChange(async (value) => {
        ctx.plugin.settings.proactiveCooldownMinutes = value;
        await ctx.plugin.saveSettings();
      }));

  container.createEl('hr', { cls: 'deeppdf-settings-divider' });

  // PDF 索引参数
  container.createEl('h4', { text: 'PDF 索引参数' });

  new Setting(container)
    .setName('每节点最大页数')
    .setDesc('PDF 解析时每个章节的最大页数')
    .addSlider(slider => slider
      .setLimits(1, 50, 1)
      .setValue(ctx.plugin.settings.maxPagesPerNode)
      .setDynamicTooltip()
      .onChange(async (value) => {
        ctx.plugin.settings.maxPagesPerNode = value;
        await ctx.plugin.saveSettings();
      }));

  new Setting(container)
    .setName('每节点最大 Token')
    .setDesc('每个章节的最大 Token 数')
    .addSlider(slider => slider
      .setLimits(1000, 50000, 1000)
      .setValue(ctx.plugin.settings.maxTokensPerNode)
      .setDynamicTooltip()
      .onChange(async (value) => {
        ctx.plugin.settings.maxTokensPerNode = value;
        await ctx.plugin.saveSettings();
      }));

  new Setting(container)
    .setName('生成章节摘要')
    .setDesc('使用 LLM 为每个章节生成摘要')
    .addToggle(toggle => toggle
      .setValue(ctx.plugin.settings.ifAddNodeSummary)
      .onChange(async (value) => {
        ctx.plugin.settings.ifAddNodeSummary = value;
        await ctx.plugin.saveSettings();
      }));

  // 重排序参数
  const roles = ctx.plugin.settings.roles;
  if (roles?.reranker !== null) {
    container.createEl('hr', { cls: 'deeppdf-settings-divider' });
    container.createEl('h4', { text: '重排序参数' });

    new Setting(container)
      .setName('重排序权重')
      .setDesc('Reranker 分数在最终得分中的权重 (0.0-1.0)')
      .addSlider(slider => slider
        .setLimits(0, 100, 5)
        .setValue((ctx.plugin.settings.rerankerWeight ?? 0.7) * 100)
        .setDynamicTooltip()
        .onChange(async (value) => {
          ctx.plugin.settings.rerankerWeight = value / 100;
          await ctx.plugin.saveSettings();
        }));
  }
}
