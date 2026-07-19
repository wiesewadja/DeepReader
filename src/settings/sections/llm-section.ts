/**
 * AI 服务 Tab — 三层统一布局（plan 快选 / 角色分配 / 其他服务商）
 */

import { Notice, Setting, setIcon } from 'obsidian';
import { PRESETS, getPresetById, detectCurrentPreset, computePreviewRoles } from '../../config/presets';
import { PROVIDER_LABELS, PROVIDER_CONFIGS, applyPreset } from '../../config/providers';
import type { ProviderType, RoleType } from '../../config/types';
import type { AIRoleConfig } from '../../config/ai-roles';
import type DeepReaderPlugin from '../../main';
import { renderProviderDetail } from '../components/provider-card';
import { createRoleCard } from '../components/role-card';
import { debounceAsync } from '../helpers';
import type { SectionContext } from '../types';

const PROPOSITION_ENABLED = false;

const DEFAULT_PRESET_ID = 'agent-plan';

export interface LLMState {
	expandedSections: Set<string>;
	volcarkTestStatus: { success: boolean; message: string } | null;
	mimoTestStatus: { success: boolean; message: string } | null;
	siliconflowTestStatus: { success: boolean; message: string } | null;
	selectedPresetId: string;
	forceShowQuickSetup: boolean;
}

export function createLLMState(): LLMState {
	return {
		expandedSections: new Set(),
		volcarkTestStatus: null,
		mimoTestStatus: null,
		siliconflowTestStatus: null,
		selectedPresetId: DEFAULT_PRESET_ID,
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
		// 首次配置 / 重新配置：① plan 卡片 + 角色预览 + 确认
		renderQuickSetup(container, ctx, state, onRerender);
	} else {
		// 已配置：摘要头 + ② 角色分配（常态，可微调）
		renderConfigSummary(container, ctx, state, onRerender);
		renderRoleAssignment(container, ctx, state, onRerender);
	}

	// ③ 其他服务商 + MinerU（常态折叠，放底部）
	renderOtherProvidersSection(container, ctx, state, onRerender);
}

// ── Key 输入组件 / 角色预览（三层布局）──

/* ── 通用 Key 输入（内嵌于 plan 卡片或独立行）── */

function createProviderKeyInput(
	parent: HTMLElement,
	ctx: SectionContext,
	providerId: string,
	placeholder: string,
	testStatus: { success: boolean; message: string } | null,
	onKeyChange?: () => void,
): HTMLInputElement {
	const wrap = parent.createDiv({ cls: 'deeppdf-key-input-wrap' });
	const input = wrap.createEl('input', {
		cls: 'deeppdf-key-input',
		attr: { type: 'password', placeholder },
	});
	input.value = ctx.plugin.settings.providers[providerId]?.apiKey || '';

	const debouncedSave = debounceAsync(async () => {
		const providers = ctx.plugin.settings.providers as Record<string, { apiKey?: string }>;
		if (!providers[providerId]) providers[providerId] = {};
		providers[providerId].apiKey = input.value.trim();
		await ctx.plugin.saveSettings();
	}, 300);
	input.addEventListener('input', () => {
		debouncedSave();
		onKeyChange?.();
	});

	const eye = wrap.createEl('button', { cls: 'deeppdf-btn-eye' });
	setIcon(eye, 'eye');
	let visible = false;
	eye.addEventListener('click', () => {
		visible = !visible;
		input.type = visible ? 'text' : 'password';
	});

	if (testStatus) {
		wrap.createEl('span', {
			text: testStatus.message,
			cls: `deeppdf-key-status ${testStatus.success ? 'is-success' : 'is-error'}`,
		});
	}
	return input;
}

/* ── 角色预览行（computePreviewRoles 的 UI 投影）── */

const ROLE_LABELS: Record<RoleType, string> = {
	chat: '对话',
	router: '路由',
	pageindex: '索引',
	proposition: '原子事实',
	embedding: '向量',
	reranker: '重排序',
	tts: '语音',
	imagegen: '图片',
};

const ROLE_DOT_CLASS: Record<string, string> = {
	volcark: 'is-volcark',
	xiaomi: 'is-xiaomi',
	siliconflow: 'is-siliconflow',
};

function renderRolePreviewRow(
	parent: HTMLElement,
	role: RoleType,
	assignment: AIRoleConfig | null,
): void {
	const row = parent.createDiv({ cls: 'deeppdf-role-row' });
	row.createEl('span', { text: ROLE_LABELS[role], cls: 'deeppdf-role-label' });
	row.createEl('span', { text: role, cls: 'deeppdf-role-key' });
	row.createEl('span', { text: '→', cls: 'deeppdf-role-arrow' });
	const empty = !assignment;
	row.createEl('span', {
		text: empty ? '未配置' : assignment.model,
		cls: `deeppdf-role-model ${empty ? 'is-empty' : ''}`,
	});
	row.createEl('span', {
		cls: `deeppdf-role-dot ${empty ? 'is-empty' : (ROLE_DOT_CLASS[assignment!.provider] || 'is-other')}`,
	});
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
	card.createEl('div', { text: '快速配置', cls: 'deeppdf-quick-setup-title' });
	card.createEl('div', {
		text: '选择服务商并填写 API Key，系统会自动分配角色模型。',
		cls: 'deeppdf-quick-setup-desc',
	});

	// ── ① Plan 卡片（内嵌 Key，二选一）──
	const inputs: Record<string, HTMLInputElement> = {};
	let refreshPreview: () => void = () => {};  // 在预览区创建后赋值，Key 输入时即时刷新
	const presetRow = card.createDiv({ cls: 'deeppdf-preset-row' });
	for (const preset of PRESETS) {
		const pc = presetRow.createDiv({ cls: 'deeppdf-preset-card' });
		if (preset.id === state.selectedPresetId) pc.addClass('is-selected');

		const header = pc.createDiv({ cls: 'deeppdf-preset-card-header' });
		header.createEl('div', { text: preset.label, cls: 'deeppdf-preset-card-name' });
		if (preset.recommended) {
			header.createEl('span', { text: '推荐', cls: 'deeppdf-preset-card-badge' });
		}
		pc.createEl('div', { text: preset.description, cls: 'deeppdf-preset-card-desc' });

		// 内嵌 Key 输入（主 provider）
		const testStatus = preset.provider === 'volcark' ? state.volcarkTestStatus : state.mimoTestStatus;
		const placeholder = preset.provider === 'volcark' ? 'ark-（火山方舟套餐 Key）' : 'tp-（小米 Token Plan Key）';
		const input = createProviderKeyInput(pc, ctx, preset.provider, placeholder, testStatus, () => refreshPreview());
		inputs[preset.provider] = input;

		// 点击卡片切换预设（点 input/eye 不触发）
		pc.addEventListener('click', (e) => {
			if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).closest('.deeppdf-btn-eye')) return;
			if (state.selectedPresetId !== preset.id) {
				state.selectedPresetId = preset.id;
				state.volcarkTestStatus = null;
				state.mimoTestStatus = null;
				state.siliconflowTestStatus = null;
				onRerender();
			}
		});
	}

	// ── SiliconFlow 可选增强 ──
	const sfGroup = card.createDiv({ cls: 'deeppdf-key-group' });
	sfGroup.createEl('div', { text: 'SiliconFlow（可选增强）', cls: 'deeppdf-key-group-label' });
	inputs['siliconflow'] = createProviderKeyInput(sfGroup, ctx, 'siliconflow', 'sk-（向量搜索 + 重排序）', state.siliconflowTestStatus, () => refreshPreview());
	sfGroup.createEl('div', { text: '不填则向量搜索降级、重排序关闭', cls: 'deeppdf-key-group-hint' });

	card.createEl('hr', { cls: 'deeppdf-divider' });

	// ── ② 角色预览（点卡片/填 Key 即时更新）──
	const previewWrap = card.createDiv({ cls: 'deeppdf-role-preview is-pending' });
	const previewTitle = previewWrap.createDiv({ cls: 'deeppdf-role-preview-title' });
	previewTitle.createEl('span', { text: '当前角色分配' });
	previewTitle.createEl('span', { text: '预览', cls: 'deeppdf-preview-tag is-pending' });
	const previewBody = previewWrap.createDiv({ cls: 'deeppdf-role-preview-body' });

	const roleOrder: RoleType[] = ['chat', 'router', 'pageindex', 'proposition', 'embedding', 'reranker', 'tts', 'imagegen'];
	const refreshPreviewImpl = () => {
		const providersWithKeys = new Set<string>();
		if (inputs['volcark']?.value.trim()) providersWithKeys.add('volcark');
		if (inputs['xiaomi']?.value.trim()) providersWithKeys.add('xiaomi');
		if (inputs['siliconflow']?.value.trim()) providersWithKeys.add('siliconflow');
		const roles = computePreviewRoles(state.selectedPresetId, providersWithKeys);
		previewBody.empty();
		for (const role of roleOrder) {
			renderRolePreviewRow(previewBody, role, roles[role]);
		}
	};
	refreshPreview = refreshPreviewImpl;
	refreshPreviewImpl();

	// ── 操作按钮 ──
	const actionsRow = card.createDiv({ cls: 'deeppdf-actions-row' });
	const testBtn = actionsRow.createEl('button', { text: '测试连接', cls: 'deeppdf-btn-secondary' });
	const confirmBtn = actionsRow.createEl('button', { text: '确认配置 →', cls: 'deeppdf-btn-primary' });

	const hintLink = card.createDiv({ cls: 'deeppdf-hint-link' });
	hintLink.createSpan({ text: '还没有 Key？' });
	hintLink.createEl('a', {
		text: '开通火山方舟',
		attr: { href: 'https://console.volcengine.com/ark', target: '_blank', rel: 'noopener noreferrer' },
	});
	hintLink.createSpan({ text: ' · ' });
	hintLink.createEl('a', {
		text: '注册 SiliconFlow（免费额度）',
		attr: { href: 'https://cloud.siliconflow.cn', target: '_blank', rel: 'noopener noreferrer' },
	});

	// ── 测试连接 ──
	testBtn.addEventListener('click', async () => {
		const volcarkVal = inputs['volcark']?.value.trim() || '';
		const mimoVal = inputs['xiaomi']?.value.trim() || '';
		const sfVal = inputs['siliconflow']?.value.trim() || '';

		if (!volcarkVal && !mimoVal && !sfVal) {
			new Notice('请至少填写一个 Key');
			return;
		}

		testBtn.textContent = '测试中...';
		testBtn.setAttribute('disabled', 'true');
		state.volcarkTestStatus = null;
		state.mimoTestStatus = null;
		state.siliconflowTestStatus = null;

		const { testConnection } = await import('../../config/model-fetcher');
		const tests: Promise<{ key: string; success: boolean; message: string }>[] = [];

		if (volcarkVal) {
			tests.push(testConnection(PROVIDER_CONFIGS['volcark'].baseUrl, volcarkVal, 'doubao-seed-2.0-lite', 'chat')
				.then(r => ({ key: 'volcark', success: r.success, message: r.success ? `${r.latencyMs}ms` : (r.error || 'failed') }))
				.catch(e => ({ key: 'volcark', success: false, message: `✗ ${(e instanceof Error ? e.message : String(e))}` })));
		}
		if (mimoVal) {
			tests.push(testConnection('https://token-plan-cn.xiaomimimo.com/v1', mimoVal, 'mimo-v2.5', 'chat')
				.then(r => ({ key: 'mimo', success: r.success, message: r.success ? `${r.latencyMs}ms` : (r.error || 'failed') }))
				.catch(e => ({ key: 'mimo', success: false, message: `✗ ${(e instanceof Error ? e.message : String(e))}` })));
		}
		if (sfVal) {
			tests.push(testConnection('https://api.siliconflow.cn/v1', sfVal, 'Qwen/Qwen3-8B', 'chat')
				.then(r => ({ key: 'sf', success: r.success, message: r.success ? `${r.latencyMs}ms` : (r.error || 'failed') }))
				.catch(e => ({ key: 'sf', success: false, message: `✗ ${(e instanceof Error ? e.message : String(e))}` })));
		}

		const results = await Promise.all(tests);
		for (const r of results) {
			if (r.key === 'volcark') state.volcarkTestStatus = { success: r.success, message: r.message };
			else if (r.key === 'mimo') state.mimoTestStatus = { success: r.success, message: r.message };
			else if (r.key === 'sf') state.siliconflowTestStatus = { success: r.success, message: r.message };
		}

		testBtn.textContent = '测试连接';
		testBtn.removeAttribute('disabled');
		onRerender();
	});

	// ── 确认配置（才 applyPreset 写入）──
	confirmBtn.addEventListener('click', async () => {
		const volcarkVal = inputs['volcark']?.value.trim() || '';
		const mimoVal = inputs['xiaomi']?.value.trim() || '';
		const sfVal = inputs['siliconflow']?.value.trim() || '';

		if (state.selectedPresetId === 'agent-plan' && !volcarkVal) {
			new Notice('请填写火山方舟 API Key');
			return;
		}
		if (state.selectedPresetId === 'xitong' && !mimoVal) {
			new Notice('请填写小米 MIMO Token Plan Key');
			return;
		}

		if (state.selectedPresetId === 'agent-plan') {
			applyPreset('agent-plan', volcarkVal, ctx.plugin.settings, undefined, {
				xiaomi: mimoVal,
				siliconflow: sfVal,
			});
		} else if (state.selectedPresetId === 'xitong') {
			applyPreset('xitong', mimoVal, ctx.plugin.settings, sfVal || undefined);
		}

		ctx.plugin.settings.setupComplete = true;
		ctx.plugin.resetFrontendAgent();
		await ctx.plugin.saveSettings();
		state.volcarkTestStatus = null;
		state.mimoTestStatus = null;
		state.siliconflowTestStatus = null;
		state.forceShowQuickSetup = false;

		const hasMimo = !!mimoVal;
		const hasSf = !!sfVal;
		if (hasMimo && hasSf) {
			new Notice('配置完成！所有功能可用');
		} else if (hasMimo) {
			new Notice('配置完成！重排序未启用，可稍后在角色分配中补填 SiliconFlow');
		} else if (hasSf) {
			new Notice('配置完成！语音未启用，可稍后在角色分配中补填 MIMO');
		} else if (state.selectedPresetId === 'agent-plan') {
			new Notice('配置完成！语音和重排序未启用，可稍后补填');
		} else {
			new Notice('配置完成！向量搜索和重排序未启用，可稍后补填');
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
	const hasMimoKey = !!ctx.plugin.settings.providers['xiaomi']?.apiKey;
	const hasSiliconflowKey = !!ctx.plugin.settings.providers['siliconflow']?.apiKey;
	const hasTTS = !!ctx.plugin.settings.roles?.tts;
	const hasReranker = !!ctx.plugin.settings.roles?.reranker;
	const allFeaturesAvailable = !!currentPreset && hasMimoKey && hasSiliconflowKey && hasTTS && hasReranker;

	if (currentPreset) {
		const presetName = currentPreset.label;
		if (allFeaturesAvailable) {
			summary.createEl('div', { text: `${presetName} · 已就绪 ✓`, cls: 'deeppdf-config-summary-title deeppdf-status-ok' });
			summary.createEl('div', { text: '所有功能可用', cls: 'deeppdf-config-summary-detail' });
		} else {
			const missing = [];
			if (!hasMimoKey || !hasTTS) missing.push('语音功能');
			if (!hasSiliconflowKey || !hasReranker) missing.push('重排序');
			summary.createEl('div', { text: `${presetName} · 部分功能不可用`, cls: 'deeppdf-config-summary-title deeppdf-status-partial' });
			summary.createEl('div', {
				text: `⚠ ${missing.join('、')}未配置 · 补填对应 Key 可启用全部功能`,
				cls: 'deeppdf-config-summary-detail',
			});
		}

		const actions = summary.createDiv({ cls: 'deeppdf-config-summary-actions' });
		actions.createEl('button', { text: '重新配置', cls: 'deeppdf-btn-secondary' })
			.addEventListener('click', () => {
				state.forceShowQuickSetup = true;
				state.volcarkTestStatus = null;
				state.mimoTestStatus = null;
				state.siliconflowTestStatus = null;
				onRerender();
			});
	} else {
		// 自定义配置
		summary.createEl('div', { text: '自定义配置', cls: 'deeppdf-config-summary-title' });
		const missing = [];
		if (!hasMimoKey || !hasTTS) missing.push('语音功能');
		if (!hasSiliconflowKey || !hasReranker) missing.push('重排序');
		if (missing.length > 0) {
			summary.createEl('div', {
				text: `⚠ ${missing.join('、')}未配置 · 补填对应 Key 可启用全部功能`,
				cls: 'deeppdf-config-summary-detail',
			});
		}

		const actions = summary.createDiv({ cls: 'deeppdf-config-summary-actions' });
		actions.createEl('button', { text: `重置为 ${PRESETS[0].label} 默认`, cls: 'deeppdf-btn-danger' })
			.addEventListener('click', () => {
				showResetConfirm(async () => {
					const volcarkKey = ctx.plugin.settings.providers['volcark']?.apiKey || '';
					const mimoKey = ctx.plugin.settings.providers['xiaomi']?.apiKey || '';
					const sfKey = ctx.plugin.settings.providers['siliconflow']?.apiKey || '';
					const additionalKeys: Record<string, string> = {};
					if (mimoKey) additionalKeys.xiaomi = mimoKey;
					if (sfKey) additionalKeys.siliconflow = sfKey;
					applyPreset(DEFAULT_PRESET_ID, volcarkKey, ctx.plugin.settings, undefined, additionalKeys);
					ctx.plugin.resetFrontendAgent();
					await ctx.plugin.saveSettings();
					state.forceShowQuickSetup = true;
					state.volcarkTestStatus = null;
					state.mimoTestStatus = null;
					state.siliconflowTestStatus = null;
					onRerender();
				});
			});
	}
}

function showResetConfirm(onConfirm: () => void): void {
	const modal = document.body.createDiv({ cls: 'deeppdf-modal-overlay' });
	const dialog = modal.createDiv({ cls: 'deeppdf-modal' });
	dialog.createEl('div', { text: '重置为默认配置', cls: 'deeppdf-modal-title' });
	dialog.createEl('div', {
		text: '将重置所有角色分配为默认值。你之前的手动调整将丢失。',
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
// ② 角色分配（常态显示，已配置后可逐角色微调）
// ─────────────────────────────────────────────────────

function renderRoleAssignment(
	container: HTMLElement,
	ctx: SectionContext,
	state: LLMState,
	onRerender: () => void,
): void {
	const card = container.createDiv({ cls: 'deeppdf-settings-card' });
	card.createEl('div', { text: '角色分配', cls: 'deeppdf-quick-setup-title' });
	card.createEl('div', {
		text: '每个角色可选择已配置 Key 的服务商。改动即时保存。',
		cls: 'deeppdf-quick-setup-desc',
	});

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

	const coreCard = card.createDiv({ cls: 'deeppdf-settings-card' });
	coreCard.createEl('h4', { text: '核心服务' });
	const requiredRoles: { role: RoleType; label: string; desc: string }[] = [
		{ role: 'chat', label: '主对话', desc: '用于主要对话和分析' },
		{ role: 'router', label: '路由', desc: '用于查询路由和快速检索' },
		{ role: 'pageindex', label: '页面索引', desc: '用于书籍索引时的 LLM 调用' },
	];
	for (const { role, label, desc } of requiredRoles) {
		createRoleCard(coreCard, role, label, desc, false, roleCtx);
	}

	const enhanceCard = card.createDiv({ cls: 'deeppdf-settings-card' });
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
}

// ─────────────────────────────────────────────────────
// ③ 其他服务商 Key + MinerU（常态折叠，放底部）
// ─────────────────────────────────────────────────────

function renderOtherProvidersSection(
	container: HTMLElement,
	ctx: SectionContext,
	state: LLMState,
	onRerender: () => void,
): void {
	const sectionId = 'other-providers';
	const isOpen = state.expandedSections.has(sectionId);

	const card = container.createDiv({ cls: 'deeppdf-settings-card' });
	const toggle = card.createDiv({ cls: `deeppdf-collapse-toggle ${isOpen ? 'is-open' : ''}` });
	const arrow = toggle.createSpan({ cls: 'deeppdf-collapse-arrow' });
	setIcon(arrow, 'chevron-right');
	toggle.appendText(' 其他服务商 Key');

	// 供应商列表作为 toggle 下方的副标题（独立行，避免与标题行基线错位）
	const subtitle = card.createDiv({ cls: 'deeppdf-collapse-subtitle' });
	subtitle.createEl('span', { text: 'DeepSeek / Kimi / Minimax / OpenAI / SenseNova' });

	const body = card.createDiv({ cls: `deeppdf-collapse-body ${isOpen ? 'is-open' : ''}` });
	if (isOpen) {
		renderProviderGrid(body, ctx, state, onRerender);
		renderMineruSection(body, ctx, state, onRerender);
	}

	toggle.addEventListener('click', () => {
		if (state.expandedSections.has(sectionId)) {
			state.expandedSections.delete(sectionId);
		} else {
			state.expandedSections.add(sectionId);
		}
		onRerender();
	});
}

// ─────────────────────────────────────────────────────
// 服务商卡片网格
// ─────────────────────────────────────────────────────

const EXCLUDED_PROVIDERS = ['volcark', 'xiaomi', 'siliconflow', 'mineru'];

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
