/**
 * 高级 Tab — PI Agent、调试日志、语音回复、主动阅读引导
 */

import { Notice, Setting } from 'obsidian';
import type { SectionContext } from '../types';
import { setLogEnabled } from '../../utils/logger';
import { detectPiCli, invalidatePiCliCache, buildSpawnEnv } from '../../agent/pi/pi-config';
import { spawn } from 'child_process';

export function renderAdvancedSection(
  container: HTMLElement,
  ctx: SectionContext,
): void {
  container.createEl('h3', { text: '高级设置' });

  // PI Agent 集成（最上面，用户最常操作）
  container.createEl('h4', { text: 'PI Agent 集成' });
  container.createEl('p', {
    text: 'PI 是外部 Coding Agent，为奚童提供 Skill 执行能力（思维导图、知识卡片、阅读笔记等）。',
    cls: 'setting-item-description',
  });

  new Setting(container)
    .setName('启用 PI Skill 能力')
    .setDesc('开启后，奚童会将 Skill 类请求转交给 PI 执行。需要先安装 PI CLI。')
    .addToggle(toggle => toggle
      .setValue(ctx.plugin.settings.piEnabled)
      .onChange(async (value) => {
        ctx.plugin.settings.piEnabled = value;
        await ctx.plugin.saveSettings();
      }));

  const statusEl = container.createDiv({ cls: 'setting-item-description' });
  statusEl.setText('检测中...');

  const actionContainer = container.createDiv();

  new Setting(container)
    .setName('PI 可执行文件路径')
    .setDesc('如果自动检测失败，请填写 pi 的绝对路径（如 /opt/homebrew/bin/pi）。留空则自动检测。')
    .addText(text => text
      .setPlaceholder('/opt/homebrew/bin/pi')
      .setValue(ctx.plugin.settings.customPiPath)
      .onChange(async (value) => {
        ctx.plugin.settings.customPiPath = value;
        await ctx.plugin.saveSettings();
        invalidatePiCliCache();
        await refreshPiStatus(statusEl, actionContainer, ctx);
      }));

  // 初始渲染：先显示安装按钮占位，检测完成后动态替换
  renderInstallButton(actionContainer, statusEl, ctx);
  detectPiCli(ctx.plugin.settings.customPiPath).then(() => {
    refreshPiStatus(statusEl, actionContainer, ctx);
  });

  container.createEl('hr', { cls: 'deeppdf-settings-divider' });

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

/** 根据检测结果刷新状态文案和操作按钮 */
async function refreshPiStatus(
  statusEl: HTMLElement,
  actionContainer: HTMLElement,
  ctx: SectionContext,
): Promise<void> {
  const result = await detectPiCli(ctx.plugin.settings.customPiPath);

  // 更新状态文案
  if (result.available) {
    statusEl.setText(`PI 已安装: v${result.version}（${result.path}）`);
    statusEl.style.color = 'var(--text-success)';
  } else {
    statusEl.setText('PI 未检测到。如果已安装，请在下方填写 pi 的绝对路径。');
    statusEl.style.color = 'var(--text-error)';
  }

  // 动态渲染操作按钮
  actionContainer.empty();
  if (result.available) {
    renderUpdateButton(actionContainer, statusEl, ctx);
  } else {
    renderInstallButton(actionContainer, statusEl, ctx);
  }
}

function renderInstallButton(
  container: HTMLElement,
  statusEl: HTMLElement,
  ctx: SectionContext,
): void {
  new Setting(container)
    .setName('安装 PI')
    .setDesc('全局安装 PI Coding Agent（需要 Node.js 和 npm）')
    .addButton(button => button
      .setButtonText('安装 PI')
      .setCta()
      .onClick(async () => {
        button.setDisabled(true);
        button.setButtonText('安装中...');
        try {
          await runSpawn('npm', ['install', '-g', '@mariozechner/pi-coding-agent'], 60000);
          new Notice('PI 安装成功');
          invalidatePiCliCache();
          await refreshPiStatus(statusEl, container, ctx);
        } catch (err) {
          new Notice(`安装失败: ${err instanceof Error ? err.message : String(err)}`);
          button.setDisabled(false);
          button.setButtonText('安装 PI');
        }
      }));
}

function renderUpdateButton(
  container: HTMLElement,
  statusEl: HTMLElement,
  ctx: SectionContext,
): void {
  new Setting(container)
    .setName('更新 PI')
    .setDesc('更新到最新版本')
    .addButton(button => button
      .setButtonText('更新 PI')
      .onClick(async () => {
        button.setDisabled(true);
        button.setButtonText('更新中...');
        const cliPath = ctx.plugin.settings.customPiPath || 'pi';
        try {
          await runSpawn(cliPath, ['update', '--self'], 30000);
          new Notice('PI 更新成功');
          invalidatePiCliCache();
          await refreshPiStatus(statusEl, container, ctx);
        } catch (err) {
          new Notice(`更新失败: ${err instanceof Error ? err.message : String(err)}`);
          button.setDisabled(false);
          button.setButtonText('更新 PI');
        }
      }));
}

/** 用 spawn 执行命令并等待完成（Obsidian renderer 不支持 exec） */
function runSpawn(cmd: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const env = buildSpawnEnv();
    const child = spawn(cmd, args, { timeout: timeoutMs, stdio: 'pipe', env });
    let stderr = '';
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    child.on('error', (e) => reject(e));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `Exit code ${code}`));
    });
  });
}
