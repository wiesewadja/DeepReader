/**
 * 阅读模式 Tab — 阅读样式设置
 */

import { Setting } from 'obsidian';
import type { SectionContext } from '../types';

export function renderReadingSection(
  container: HTMLElement,
  ctx: SectionContext,
): void {
  container.createEl('h3', { text: '阅读模式设置' });

  new Setting(container)
    .setName('自动进入阅读模式')
    .setDesc('打开 DeepReader 章节文件时自动进入沉浸式阅读模式')
    .addToggle(toggle => toggle
      .setValue(ctx.plugin.settings.autoEnableReadingMode)
      .onChange(async (value) => {
        ctx.plugin.settings.autoEnableReadingMode = value;
        await ctx.plugin.saveSettings();
        ctx.plugin.readingModeService?.setAutoEnable(value);
      }));

  new Setting(container)
    .setName('阅读模式样式')
    .setDesc('分页模式：横向翻页阅读（不支持 blockId 跳转）；滚动模式：纵向滚动阅读（支持跳转到引用段落）')
    .addDropdown(dropdown => dropdown
      .addOption('paginated', '分页模式')
      .addOption('scrolling', '滚动模式')
      .setValue(ctx.plugin.settings.readingModeStyle)
      .onChange(async (value: string) => {
        ctx.plugin.settings.readingModeStyle = value as 'paginated' | 'scrolling';
        await ctx.plugin.saveSettings();
        ctx.plugin.readingModeService?.setStyle(value as 'paginated' | 'scrolling');
      }));

  container.createEl('p', {
    text: '提示：关闭后，打开章节文件将使用普通编辑模式，启用后则进入沉浸式阅读模式。',
    cls: 'setting-item-description',
  });
}
