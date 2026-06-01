/**
 * AI 服务 Tab — 奚童预设快速配置 / 摘要 / 专家模式
 */

import { Notice, Setting, setIcon } from 'obsidian';
import type DeepReaderPlugin from '../../main';
import type { ProviderType, RoleType } from '../../config/types';
import { PROVIDER_LABELS, PROVIDER_CONFIGS, applyPreset } from '../../config/providers';
import { getPresetById, detectCurrentPreset } from '../../config/presets';
import type { SectionContext } from '../types';
import { renderProviderDetail } from '../components/provider-card';
import { createRoleCard } from '../components/role-card';
import { debounceAsync } from '../helpers';

const PROPOSITION_ENABLED = false;

export interface LLMState {
	expandedSections: Set<string>;
	testStatus: { success: boolean; message: string } | null;
	fallbackTestStatus: { success: boolean; message: string } | null;
	siliconflowTestStatus: { success: boolean; message: string } | null;
	forceShowQuickSetup: boolean;
}

export function createLLMState(): LLMState {
	return {
		expandedSections: new Set(),
		testStatus: null,
		fallbackTestStatus: null,
		siliconflowTestStatus: null,
		forceShowQuickSetup: false,
	};
}

export function renderLLMSection(
	container: HTMLElement,
	ctx: SectionContext,
	state: LLMState,
	onRerender: () => void,
): void {
	if (!ctx.plugin.settings.setupComplete || state.forceShowQuickSetup) {
		renderQuickSetup(container, ctx, state, onRerender);
	} else {
		renderConfigSummary(container, ctx, state, onRerender);
	}

	const advancedKey = 'advanced-llm';
	const isAdvanced = state.expandedSections.has(advancedKey);

	const toggleAdvanced = container.createDiv({ cls: 'deeppdf-toggle-advanced' });
	toggleAdvanced.empty();
		const arrow = toggleAdvanced.createSpan();
		setIcon(arrow, isAdvanced ? 'chevron-down' : 'chevron-right');
		toggleAdvanced.appendText(isAdvanced ? ' 收起专家设置' : ' 展开专家设置');
	toggleAdvanced.addEventListener('click', () => {
		if (state.expandedSections.has(advancedKey)) {
			state.expandedSections.delete(advancedKey);
		} else {
			state.expandedSections.add(advancedKey);
		}
		onRerender();
	});

	if (isAdvanced) {
		renderExpertArea(container, ctx, state, onRerender);
	}
}

// ─────────────────────────────────────────────────────
// 新手配置表单
// ─────────────────────────────────────────────────────

function renderQuickSetup(
	container: HTMLElement,
	ctx: SectionContext,
	state: LLMState,
	onRerender: () => void,
): void {
	const card = container.createDiv({ cls: 'deeppdf-settings-card deeppdf-quick-setup' });
	card.createEl('div', { text: '开始使用 奚童', cls: 'deeppdf-quick-setup-title' });
	card.createEl('div', {
		text: '填写 API Key 即可开始，推荐同时填写两组 Key 以获得完整体验',
		cls: 'deeppdf-quick-setup-desc',
	});

	// ── 小米 MIMO Key 组 ──
	const mimoGroup = card.createDiv({ cls: 'deeppdf-key-group' });
	mimoGroup.createEl('div', { text: '小米 MIMO', cls: 'deeppdf-key-group-label' });
	mimoGroup.createEl('div', { text: '对话 · 索引 · 语音', cls: 'deeppdf-key-group-hint' });

	const currentMimoKey = ctx.plugin.settings.providers['xiaomi']?.apiKey || '';
	const mimoRow = mimoGroup.createDiv({ cls: 'deeppdf-key-row' });
	mimoRow.createEl('div', { text: 'Token Plan Key', cls: 'deeppdf-key-label' });
	const mimoInputWrap = mimoRow.createDiv({ cls: 'deeppdf-key-input-wrap' });
	const mimoInput = mimoInputWrap.createEl('input', {
		cls: 'deeppdf-key-input',
		attr: { type: 'password', placeholder: '输入 Token Plan Key（必填）' },
	});
	mimoInput.value = currentMimoKey;
	const debouncedMimoSave = debounceAsync(async () => {
		const providers = ctx.plugin.settings.providers as Record<string, { apiKey?: string }>;
		if (!providers['xiaomi']) providers['xiaomi'] = {};
		providers['xiaomi'].apiKey = mimoInput.value.trim();
		await ctx.plugin.saveSettings();
	}, 300);
	mimoInput.addEventListener('input', () => debouncedMimoSave());
	const mimoEye = mimoInputWrap.createEl('button', { cls: 'deeppdf-btn-eye' });
	setIcon(mimoEye, 'eye');
	let mimoVisible = false;
	mimoEye.addEventListener('click', () => {
		mimoVisible = !mimoVisible;
		mimoInput.type = mimoVisible ? 'text' : 'password';
	});

	if (state.testStatus) {
		mimoRow.createEl('span', {
			text: state.testStatus.message,
			cls: `deeppdf-key-status ${state.testStatus.success ? 'is-success' : 'is-error'}`,
		});
	}

	// API Key (可选，默认折叠)
		const currentFallbackKey = ctx.plugin.settings.providers['xiaomi']?.fallbackApiKey || '';
		const fallbackSectionId = 'fallback-api-key';
		const fallbackExpanded = state.expandedSections.has(fallbackSectionId);

		const fallbackToggle = mimoGroup.createDiv({ cls: 'deeppdf-fallback-toggle' });
		const fallbackArrow = fallbackToggle.createSpan();
		setIcon(fallbackArrow, fallbackExpanded ? 'chevron-down' : 'chevron-right');
		fallbackToggle.appendText(' API Key（按量付费）');
		if (currentFallbackKey) {
			fallbackToggle.createSpan({ text: ' · 已配置', cls: 'deeppdf-fallback-hint' });
		} else {
			fallbackToggle.createSpan({ text: ' · 可选', cls: 'deeppdf-fallback-hint' });
		}

		let fallbackInput: HTMLInputElement | null = null;
	if (fallbackExpanded) {
		const fallbackRow = mimoGroup.createDiv({ cls: 'deeppdf-key-row' });
		const fallbackInputWrap = fallbackRow.createDiv({ cls: 'deeppdf-key-input-wrap' });
		fallbackInput = fallbackInputWrap.createEl('input', {
			cls: 'deeppdf-key-input',
			attr: { type: 'password', placeholder: '按量付费 Key（可选，Token Plan 耗尽时自动切换）' },
		});
		fallbackInput.value = currentFallbackKey;
		const debouncedFallbackSave = debounceAsync(async () => {
			const providers = ctx.plugin.settings.providers as Record<string, { fallbackApiKey?: string }>;
			if (!providers['xiaomi']) providers['xiaomi'] = {};
			providers['xiaomi'].fallbackApiKey = fallbackInput!.value.trim();
			await ctx.plugin.saveSettings();
		}, 300);
		fallbackInput.addEventListener('input', () => debouncedFallbackSave());
		const fallbackEye = fallbackInputWrap.createEl('button', { cls: 'deeppdf-btn-eye' });
		setIcon(fallbackEye, 'eye');
		let fallbackVisible = false;
		fallbackEye.addEventListener('click', () => {
			fallbackVisible = !fallbackVisible;
			fallbackInput!.type = fallbackVisible ? 'text' : 'password';
		});

			if (state.fallbackTestStatus) {
				fallbackRow.createEl('span', {
					text: state.fallbackTestStatus.message,
					cls: `deeppdf-key-status ${state.fallbackTestStatus.success ? 'is-success' : 'is-error'}`,
				});
			}
		}

		fallbackToggle.addEventListener('click', () => {
			if (state.expandedSections.has(fallbackSectionId)) {
				state.expandedSections.delete(fallbackSectionId);
			} else {
				state.expandedSections.add(fallbackSectionId);
			}
			onRerender();
		});
// 分隔线
	card.createEl('hr', { cls: 'deeppdf-divider' });

	// ── SiliconFlow Key 组 ──
	const sfGroup = card.createDiv({ cls: 'deeppdf-key-group' });
	sfGroup.createEl('div', { text: 'SiliconFlow', cls: 'deeppdf-key-group-label' });
	sfGroup.createEl('div', { text: '路由 · 向量搜索 · 重排序', cls: 'deeppdf-key-group-hint' });

	const currentSfKey = ctx.plugin.settings.providers['siliconflow']?.apiKey || '';
	const sfRow = sfGroup.createDiv({ cls: 'deeppdf-key-row' });
	sfRow.createEl('div', { text: 'API Key', cls: 'deeppdf-key-label' });
	const sfInputWrap = sfRow.createDiv({ cls: 'deeppdf-key-input-wrap' });
	const sfInput = sfInputWrap.createEl('input', {
		cls: 'deeppdf-key-input',
		attr: { type: 'password', placeholder: '输入 SiliconFlow API Key（推荐填写）' },
	});
	sfInput.value = currentSfKey;
	const debouncedSfSave = debounceAsync(async () => {
		const providers = ctx.plugin.settings.providers as Record<string, { apiKey?: string }>;
		if (!providers['siliconflow']) providers['siliconflow'] = {};
		providers['siliconflow'].apiKey = sfInput.value.trim();
		await ctx.plugin.saveSettings();
	}, 300);
	sfInput.addEventListener('input', () => debouncedSfSave());
	const sfEye = sfInputWrap.createEl('button', { cls: 'deeppdf-btn-eye' });
	setIcon(sfEye, 'eye');
	let sfVisible = false;
	sfEye.addEventListener('click', () => {
		sfVisible = !sfVisible;
		sfInput.type = sfVisible ? 'text' : 'password';
	});

	if (state.siliconflowTestStatus) {
		sfRow.createEl('span', {
			text: state.siliconflowTestStatus.message,
			cls: `deeppdf-key-status ${state.siliconflowTestStatus.success ? 'is-success' : 'is-error'}`,
		});
	}

	// ── 操作按钮 ──
	const actionsRow = card.createDiv({ cls: 'deeppdf-actions-row' });
	const testBtn = actionsRow.createEl('button', { text: '测试连接', cls: 'deeppdf-btn-secondary' });
	const confirmBtn = actionsRow.createEl('button', { text: '确认配置 →', cls: 'deeppdf-btn-primary' });

	const hintLink = card.createEl('div', { cls: 'deeppdf-hint-link' });
	hintLink.createSpan({ text: '还没有 Key？' });
	hintLink.createEl('a', {
		text: '前往注册 SiliconFlow（免费额度）',
		attr: { href: 'https://cloud.siliconflow.cn', target: '_blank', rel: 'noopener noreferrer' },
	});

	// ── 测试连接 ──
	testBtn.addEventListener('click', async () => {
		const mimoVal = mimoInput.value.trim();
		const fallbackVal = fallbackInput?.value?.trim() || '';
		const sfVal = sfInput.value.trim();

		if (!mimoVal && !fallbackVal && !sfVal) {
			new Notice('请至少填写一个 Key');
			return;
		}

		testBtn.textContent = '测试中...';
		testBtn.setAttribute('disabled', 'true');
		state.testStatus = null;
		state.fallbackTestStatus = null;
		state.siliconflowTestStatus = null;

		const { testConnection } = await import('../../config/model-fetcher');
		const tests: Promise<{ key: string; success: boolean; message: string }>[] = [];

		if (mimoVal) {
			tests.push(testConnection('https://token-plan-cn.xiaomimimo.com/v1', mimoVal, 'mimo-v2.5', 'chat')
				.then(r => ({ key: 'mimo', success: r.success, message: r.success ? `${r.latencyMs}ms` : (r.error || 'failed') }))
				.catch(e => ({ key: 'mimo', success: false, message: `✗ ${e.message}` })));
		}
		if (fallbackVal) {
			tests.push(testConnection('https://api.xiaomimimo.com/v1', fallbackVal, 'mimo-v2.5', 'chat')
				.then(r => ({ key: 'fallback', success: r.success, message: r.success ? `${r.latencyMs}ms` : (r.error || 'failed') }))
				.catch(e => ({ key: 'fallback', success: false, message: `✗ ${e.message}` })));
		}
		if (sfVal) {
			tests.push(testConnection('https://api.siliconflow.cn/v1', sfVal, 'Qwen/Qwen3-8B', 'chat')
				.then(r => ({ key: 'sf', success: r.success, message: r.success ? `${r.latencyMs}ms` : (r.error || 'failed') }))
				.catch(e => ({ key: 'sf', success: false, message: `✗ ${e.message}` })));
		}

		const results = await Promise.all(tests);
		for (const r of results) {
			if (r.key === 'mimo') state.testStatus = { success: r.success, message: r.message };
			else if (r.key === 'fallback') state.fallbackTestStatus = { success: r.success, message: r.message };
			else if (r.key === 'sf') state.siliconflowTestStatus = { success: r.success, message: r.message };
		}

		testBtn.textContent = '测试连接';
		testBtn.removeAttribute('disabled');
		onRerender();
	});

	// ── 确认配置 ──
	confirmBtn.addEventListener('click', async () => {
		const mimoVal = mimoInput.value.trim();
		const fallbackVal = fallbackInput?.value?.trim() || '';
		const sfVal = sfInput.value.trim();

		if (!mimoVal && !fallbackVal) {
			new Notice('请至少填写一个小米 Key');
			return;
		}

		// 应用奚童预设
		const primaryApiKey = mimoVal || fallbackVal;
		applyPreset('xitong', primaryApiKey, ctx.plugin.settings, sfVal || undefined);

		// 保存 fallback Key
		const accounts = ctx.plugin.settings.providers as Record<string, { apiKey?: string; fallbackApiKey?: string }>;
		if (accounts['xiaomi']) {
			if (fallbackVal) {
					accounts['xiaomi'].fallbackApiKey = fallbackVal;
				}
			// 如果主 Key 是 fallback（没有 Token Plan），需要把 fallback 放到 apiKey
			if (!mimoVal && fallbackVal) {
				accounts['xiaomi'].apiKey = fallbackVal;
				accounts['xiaomi'].fallbackApiKey = undefined;
			}
		}

		ctx.plugin.settings.setupComplete = true;
		ctx.plugin.resetFrontendAgent();
		await ctx.plugin.saveSettings();
		state.testStatus = null;
		state.fallbackTestStatus = null;
		state.siliconflowTestStatus = null;
		state.forceShowQuickSetup = false;

		if (sfVal) {
			new Notice('配置完成！所有功能可用');
		} else {
			new Notice('配置完成！向量搜索和重排序未启用，可在专家模式补填 SiliconFlow Key');
		}
		onRerender();
	});
}

// ─────────────────────────────────────────────────────
// 配置摘要
// ─────────────────────────────────────────────────────

function renderConfigSummary(
	container: HTMLElement,
	ctx: SectionContext,
	state: LLMState,
	onRerender: () => void,
): void {
	const card = container.createDiv({ cls: 'deeppdf-settings-card' });
	const summary = card.createDiv({ cls: 'deeppdf-config-summary' });

	const roles = ctx.plugin.settings.roles as unknown as Record<string, { provider: string; model: string } | null>;
	const currentPreset = detectCurrentPreset(roles);
	const hasSiliconFlowKey = !!ctx.plugin.settings.providers['siliconflow']?.apiKey;
		const hasEmbedding = !!ctx.plugin.settings.roles?.embedding;
		const hasReranker = !!ctx.plugin.settings.roles?.reranker;
		const allFeaturesAvailable = hasSiliconFlowKey && hasEmbedding && hasReranker;
	const isCustom = !currentPreset;

	if (isCustom) {
		// 自定义配置
		summary.createEl('div', { text: '自定义配置', cls: 'deeppdf-config-summary-title' });
		if (!hasSiliconFlowKey) {
			summary.createEl('div', {
				text: '⚠ 向量搜索、重排序未配置 · 补填 SiliconFlow Key 可启用全部功能',
				cls: 'deeppdf-config-summary-detail',
			});
		}

		const actions = summary.createDiv({ cls: 'deeppdf-config-summary-actions' });
		actions.createEl('button', { text: '重置为奚童默认', cls: 'deeppdf-btn-danger' })
			.addEventListener('click', () => {
				showResetConfirm(async () => {
					// 重置角色为奚童默认（保留已有 Key）
					const mimoKey = ctx.plugin.settings.providers['xiaomi']?.apiKey || '';
					const sfKey = ctx.plugin.settings.providers['siliconflow']?.apiKey || undefined;
					applyPreset('xitong', mimoKey, ctx.plugin.settings, sfKey);
					ctx.plugin.resetFrontendAgent();
					await ctx.plugin.saveSettings();
					state.forceShowQuickSetup = true;
					state.testStatus = null;
					state.fallbackTestStatus = null;
					state.siliconflowTestStatus = null;
					onRerender();
				});
			});
	} else if (allFeaturesAvailable) {
		// 奚童已就绪
		summary.createEl('div', { text: '奚童配置 · 已就绪 ✓', cls: 'deeppdf-config-summary-title deeppdf-status-ok' });
		summary.createEl('div', { text: '所有功能可用', cls: 'deeppdf-config-summary-detail' });

		const actions = summary.createDiv({ cls: 'deeppdf-config-summary-actions' });
		actions.createEl('button', { text: '重新配置', cls: 'deeppdf-btn-secondary' })
			.addEventListener('click', () => {
				state.forceShowQuickSetup = true;
				state.testStatus = null;
				state.fallbackTestStatus = null;
				state.siliconflowTestStatus = null;
				onRerender();
			});
	} else {
		// 部分可用
		summary.createEl('div', { text: '奚童配置 · 部分功能不可用', cls: 'deeppdf-config-summary-title deeppdf-status-partial' });
		summary.createEl('div', {
			text: '⚠ 向量搜索、重排序未配置 · 补填 SiliconFlow Key 可启用全部功能',
			cls: 'deeppdf-config-summary-detail',
		});

		const actions = summary.createDiv({ cls: 'deeppdf-config-summary-actions' });
		actions.createEl('button', { text: '重新配置', cls: 'deeppdf-btn-secondary' })
			.addEventListener('click', () => {
				state.forceShowQuickSetup = true;
				state.testStatus = null;
				state.fallbackTestStatus = null;
				state.siliconflowTestStatus = null;
				onRerender();
			});
	}
}

function showResetConfirm(onConfirm: () => void): void {
	const modal = document.body.createDiv({ cls: 'deeppdf-modal-overlay' });
	const dialog = modal.createDiv({ cls: 'deeppdf-modal' });
	dialog.createEl('div', { text: '重置为奚童默认配置', cls: 'deeppdf-modal-title' });
	dialog.createEl('div', {
		text: '将重置所有角色分配为奚童默认值（MIMO 对话 + SiliconFlow 搜索）。你之前的手动调整将丢失。',
		cls: 'deeppdf-modal-body',
	});
	const actions = dialog.createDiv({ cls: 'deeppdf-modal-actions' });
	actions.createEl('button', { text: '取消', cls: 'deeppdf-btn-secondary' })
		.addEventListener('click', () => modal.remove());
	actions.createEl('button', { text: '确认重置', cls: 'deeppdf-btn-danger' })
		.addEventListener('click', () => {
			modal.remove();
			onConfirm();
		});
}

// ─────────────────────────────────────────────────────
// 专家模式
// ─────────────────────────────────────────────────────

function renderExpertArea(
	container: HTMLElement,
	ctx: SectionContext,
	state: LLMState,
	onRerender: () => void,
): void {
	const area = container.createDiv({ cls: 'deeppdf-expert-area' });

			// 1. 服务商卡片网格（排除小米和硅基流动，已在新手区配置）
		area.createEl('h3', { text: '其他服务商' });
		area.createEl('p', {
			text: '点击卡片配置 API Key。小米 MIMO 和 SiliconFlow 请在上方“重新配置”中管理。',
			cls: 'setting-item-description',
		});
		renderProviderGrid(area, ctx, state, onRerender);

		// 2. 角色分配
	area.createEl('h3', { text: '角色分配', cls: 'deeppdf-expert-subtitle' });

	const roleCtx = {
		plugin: ctx.plugin,
		expandedSections: state.expandedSections,
		onToggle: (sectionId: string) => {
			if (state.expandedSections.has(sectionId)) {
				state.expandedSections.delete(sectionId);
			} else {
				state.expandedSections.add(sectionId);
			}
			onRerender();
		},
		onRerender,
	};


	const coreCard = area.createDiv({ cls: 'deeppdf-settings-card' });
	coreCard.createEl('h4', { text: '核心服务' });
	const requiredRoles: { role: RoleType; label: string; desc: string }[] = [
		{ role: 'chat', label: '主对话', desc: '用于主要对话和分析' },
		{ role: 'router', label: '路由', desc: '用于查询路由和快速检索' },
		{ role: 'pageindex', label: '页面索引', desc: '用于书籍索引时的 LLM 调用' },
	];
	for (const { role, label, desc } of requiredRoles) {
		createRoleCard(coreCard, role, label, desc, false, roleCtx);
	}

	const enhanceCard = area.createDiv({ cls: 'deeppdf-settings-card' });
	enhanceCard.createEl('h4', { text: '增强服务（可选）' });
	const optionalRoles: { role: RoleType; label: string; desc: string }[] = [
		...(PROPOSITION_ENABLED ? [{ role: 'proposition' as RoleType, label: '原子事实', desc: '提取原子事实卡片' }] : []),
		{ role: 'embedding', label: '向量化', desc: '语义搜索向量嵌入（禁用则降级 BM25）' },
		{ role: 'reranker', label: '重排序', desc: '搜索结果精细重排（禁用则不重排）' },
		{ role: 'tts', label: '语音播报', desc: 'AI 语音合成（禁用则无语音功能）' },
		{ role: 'imagegen', label: '图片生成', desc: '信息图/插画生成（禁用则使用默认服务）' },
	];
	for (const { role, label, desc } of optionalRoles) {
		createRoleCard(enhanceCard, role, label, desc, true, roleCtx);
	}

	// 3. MinerU
	renderMineruSection(area, ctx, state, onRerender);
}

// ─────────────────────────────────────────────────────
// 服务商卡片网格
// ─────────────────────────────────────────────────────

const EXCLUDED_PROVIDERS = ['xiaomi', 'siliconflow', 'mineru'];

const PROVIDER_ICONS: Record<string, string> = {
	minimax: 'M',
	deepseek: 'D',
	kimi: 'K',
	openai: 'O',
	sensenova: 'S',
};

const PROVIDER_COLORS: Record<string, string> = {
	minimax: '#8b5cf6',
	deepseek: '#2563eb',
	kimi: '#0ea5e9',
	openai: '#10a37f',
	sensenova: '#f59e0b',
};

function renderProviderGrid(
	container: HTMLElement,
	ctx: SectionContext,
	state: LLMState,
	onRerender: () => void,
): void {
	const providers = ctx.plugin.settings.providers;
	if (!providers) return;

	const grid = container.createDiv({ cls: 'deeppdf-provider-grid' });

	for (const [providerId, account] of Object.entries(providers)) {
		if (EXCLUDED_PROVIDERS.includes(providerId)) continue;

		const acc = account as { apiKey?: string; name?: string };
		const isBuiltIn = !!PROVIDER_CONFIGS[providerId as ProviderType];
		if (!isBuiltIn) continue; // skip custom providers in grid

		const hasKey = !!acc?.apiKey;
		const displayName = PROVIDER_LABELS[providerId as ProviderType] || providerId;
		const icon = PROVIDER_ICONS[providerId] || providerId[0].toUpperCase();
		const color = PROVIDER_COLORS[providerId] || '#6b7280';

		const sectionId = `provider-${providerId}`;
		const isExpanded = state.expandedSections.has(sectionId);

		const card = grid.createDiv({ cls: `deeppdf-provider-card ${hasKey ? 'is-active' : ''}` });

		if (isExpanded) {
			card.addClass('is-expanded');
		}

		// Card header
		const header = card.createDiv({ cls: 'deeppdf-provider-card-header' });
		const iconEl = header.createDiv({ cls: 'deeppdf-provider-card-icon' });
		iconEl.style.background = color;
		iconEl.setText(icon);
		header.createDiv({ cls: 'deeppdf-provider-card-name', text: displayName });

		const statusEl = header.createDiv({ cls: 'deeppdf-provider-card-status' });
		const dot = statusEl.createDiv({ cls: `deeppdf-provider-dot ${hasKey ? 'is-on' : ''}` });
		statusEl.createSpan({ text: hasKey ? '已配置' : '未配置' });

		// Expanded detail (inline)
		if (isExpanded) {
			const detail = card.createDiv({ cls: 'deeppdf-provider-card-detail' });
			const providerCtx = {
				plugin: ctx.plugin,
				expandedSections: state.expandedSections,
				onToggle: (sid: string) => {
					if (state.expandedSections.has(sid)) {
						state.expandedSections.delete(sid);
					} else {
						state.expandedSections.add(sid);
					}
					onRerender();
				},
			};
			renderProviderDetail(detail, providerId, acc as any, isBuiltIn, displayName, providerCtx);
		}

		header.addEventListener('click', () => {
			if (state.expandedSections.has(sectionId)) {
				state.expandedSections.delete(sectionId);
			} else {
				state.expandedSections.add(sectionId);
			}
			onRerender();
		});
	}
}

// ─────────────────────────────────────────────────────
// MinerU PDF 解析
// ─────────────────────────────────────────────────────

function renderMineruSection(
	container: HTMLElement,
	ctx: SectionContext,
	_state: LLMState,
	_onRerender: () => void,
): void {
	container.createEl('h3', { text: 'MinerU PDF 解析', cls: 'deeppdf-expert-subtitle' });
	container.createEl('p', {
		text: 'MinerU 云 API 用于 PDF 解析。免费 Agent API 限 10MB/20页；配置 Token 后可使用精准 API（支持 200MB/200页）。',
		cls: 'setting-item-description',
	});

	const mineruAccount = ctx.plugin.settings.providers['mineru'];
	const currentKey = mineruAccount?.apiKey || '';

	const keySetting = new Setting(container)
		.setName('MinerU Token')
		.setDesc('精准 API 所需，免费用户留空')
		.addText(text => {
			text.setPlaceholder('sk-...')
				.setValue(currentKey)
				.inputEl.type = 'password';
			const debouncedSave = debounceAsync(async () => {
				await ctx.plugin.saveSettings();
			}, 300);
			text.onChange((value) => {
				const providers = ctx.plugin.settings.providers as Record<string, { apiKey?: string }>;
				if (!providers['mineru']) providers['mineru'] = {};
				providers['mineru'].apiKey = value;
				debouncedSave();
			});
		});

	const inputEl = keySetting.controlEl.querySelector('input');
	keySetting.addExtraButton(btn => {
		let visible = false;
		btn.setIcon('eye')
			.setTooltip('显示')
			.onClick(() => {
				visible = !visible;
				if (inputEl) inputEl.type = visible ? 'text' : 'password';
				btn.setIcon(visible ? 'eye-off' : 'eye');
				btn.setTooltip(visible ? '隐藏' : '显示');
			});
	});
}
