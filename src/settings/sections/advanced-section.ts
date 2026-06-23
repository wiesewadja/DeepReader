/**
 * 高级 Tab — 调试日志、主动阅读引导
 */

import { Setting } from 'obsidian';
import { setLogEnabled } from '../../utils/logger';
import type { SectionContext } from '../types';

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

  new Setting(container)
    .setName('使用有机书卷风生成图表')
    .setDesc('开启后，AI 生成的思维导图、流程图等 Excalidraw 图将采用手绘连线、轻手绘节点和纸色背景。关闭后恢复原有简洁风格。')
    .addToggle(toggle => toggle
      .setValue(ctx.plugin.settings.enableOrganicScrollStyle)
      .onChange(async (value) => {
        ctx.plugin.settings.enableOrganicScrollStyle = value;
        await ctx.plugin.saveSettings();
      }));

}
