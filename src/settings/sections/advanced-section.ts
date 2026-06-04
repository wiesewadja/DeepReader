/**
 * 高级 Tab — 调试日志、语音回复、主动阅读引导
 */

import { Setting } from 'obsidian';
import type { SectionContext } from '../types';
import { setLogEnabled } from '../../utils/logger';

export function renderAdvancedSection(
  container: HTMLElement,
  ctx: SectionContext,
): void {
  container.createEl('h3', { text: '高级设置' });

  // 调试日志
  container.createEl('h4', { text: '调试与日志' });

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

  container.createEl('hr', { cls: 'deeppdf-settings-divider' });

  // 语音回复
  container.createEl('h4', { text: '语音回复' });

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
}
