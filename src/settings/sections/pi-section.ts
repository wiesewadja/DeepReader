/**
 * PI Agent 设置 Section
 */

import { Setting, Notice } from 'obsidian';
import type { SectionContext } from '../types.js';

export function renderPiSection(ctx: SectionContext): void {
	const { containerEl: container } = ctx;

	container.createEl('h3', { text: 'PI Agent 集成' });
	container.createEl('p', {
		text: 'PI 是外部 Coding Agent，为奚童提供 Skill 执行能力（思维导图、知识卡片、阅读笔记等）。',
		cls: 'setting-item-description',
	});

	// PI 启用开关
	new Setting(container)
		.setName('启用 PI Skill 能力')
		.setDesc('开启后，奚童会将 Skill 类请求转交给 PI 执行。需要先安装 PI CLI。')
		.addToggle(toggle => toggle
			.setValue(ctx.plugin.settings.piEnabled)
			.onChange(async (value) => {
				ctx.plugin.settings.piEnabled = value;
				await ctx.plugin.saveSettings();
			}));

	// PI 状态
	const statusEl = container.createDiv({ cls: 'setting-item-description' });
	statusEl.setText('检测中...');

	detectPiStatus(statusEl);

	// 安装按钮
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
					const { execSync } = await import('child_process');
					execSync('npm install -g @mariozechner/pi-coding-agent', {
						timeout: 60000,
						stdio: 'pipe',
					});
					new Notice('PI 安装成功');
					await detectPiStatus(statusEl);
				} catch (err) {
					new Notice(`安装失败: ${err instanceof Error ? err.message : String(err)}`);
				}
				button.setDisabled(false);
				button.setButtonText('安装 PI');
			}));

	// 更新按钮
	new Setting(container)
		.setName('更新 PI')
		.setDesc('更新到最新版本')
		.addButton(button => button
			.setButtonText('更新 PI')
			.onClick(async () => {
				button.setDisabled(true);
				button.setButtonText('更新中...');
				try {
					const { execSync } = await import('child_process');
					execSync('pi update --self', { timeout: 30000, stdio: 'pipe' });
					new Notice('PI 更新成功');
					await detectPiStatus(statusEl);
				} catch (err) {
					new Notice(`更新失败: ${err instanceof Error ? err.message : String(err)}`);
				}
				button.setDisabled(false);
				button.setButtonText('更新 PI');
			}));
}

async function detectPiStatus(el: HTMLElement): Promise<void> {
	try {
		const { execSync } = await import('child_process');
		const version = execSync('pi --version', { timeout: 5000, encoding: 'utf8' }).trim();
		el.setText(`PI 已安装: v${version} ✓`);
		el.style.color = 'var(--text-success)';
	} catch {
		el.setText('PI 未安装。请点击下方按钮安装。');
		el.style.color = 'var(--text-error)';
	}
}
