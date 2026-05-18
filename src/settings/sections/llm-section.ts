/**
 * AI 服务 Tab — 快速配置 / 摘要 / 高级模式
 */

import { Notice, Setting } from 'obsidian';
import type DeepPDFPlugin from '../../main';
import type { ProviderType } from '../../config/types';
import { PROVIDER_LABELS, PROVIDER_CONFIGS, applyPreset } from '../../config/providers';
import { PRESETS, getPresetById, detectCurrentPreset } from '../../config/presets';
import type { ProviderPreset } from '../../config/presets';
import type { SectionContext } from '../types';
import { renderProviderList } from '../components/provider-card';
import { debounceAsync } from '../helpers';

export interface LLMState {
  expandedSections: Set<string>;
  selectedPresetId: string | null;
  testStatus: { success: boolean; message: string } | null;
  fallbackTestStatus: { success: boolean; message: string } | null;
  forceShowQuickSetup: boolean;
}

export function createLLMState(): LLMState {
  return {
    expandedSections: new Set(),
    selectedPresetId: null,
    testStatus: null,
    fallbackTestStatus: null,
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
  toggleAdvanced.setText(isAdvanced ? '收起高级设置 ▲' : '展开高级设置 ▼');
  toggleAdvanced.addEventListener('click', () => {
    if (state.expandedSections.has(advancedKey)) {
      state.expandedSections.delete(advancedKey);
    } else {
      state.expandedSections.add(advancedKey);
    }
    onRerender();
  });

  if (isAdvanced) {
    container.createEl('h3', { text: '服务商账号' });
    container.createEl('p', {
      text: '配置各服务商的 API Key。填写 Key 后，在「服务配置」Tab 中为各用途分配服务商和模型。',
      cls: 'setting-item-description',
    });
    renderProviderList(container, {
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
    });

    renderMineruSection(container, ctx, state, onRerender);
  }
}

function renderQuickSetup(
  container: HTMLElement,
  ctx: SectionContext,
  state: LLMState,
  onRerender: () => void,
): void {
  const card = container.createDiv({ cls: 'deeppdf-settings-card deeppdf-quick-setup' });
  card.createEl('div', { text: '开始使用 DeepReader', cls: 'deeppdf-quick-setup-title' });
  card.createEl('div', {
    text: '选择一个 AI 服务方案，填入 API Key 即可开始',
    cls: 'deeppdf-quick-setup-desc',
  });

  const grid = card.createDiv({ cls: 'deeppdf-preset-grid' });
  for (const preset of PRESETS) {
    const presetCard = grid.createDiv({ cls: 'deeppdf-preset-card' });
    if (state.selectedPresetId === preset.id) {
      presetCard.addClass('is-selected');
    }

    presetCard.createEl('div', { text: preset.label, cls: 'deeppdf-preset-card-name' });
    presetCard.createEl('div', { text: preset.description, cls: 'deeppdf-preset-card-desc' });

    if (preset.recommended || preset.free) {
      const badgeRow = presetCard.createDiv();
      if (preset.recommended) {
        badgeRow.createEl('span', { text: '推荐', cls: 'deeppdf-preset-card-badge is-recommended' });
      }
      if (preset.free) {
        badgeRow.createEl('span', { text: '免费额度', cls: 'deeppdf-preset-card-badge is-free' });
      }
    }

    presetCard.addEventListener('click', () => {
      state.selectedPresetId = preset.id;
      state.testStatus = null;
      state.fallbackTestStatus = null;
      onRerender();
    });
  }

  if (!state.selectedPresetId) {
    state.selectedPresetId = PRESETS.find(p => p.recommended)?.id || PRESETS[0]?.id || null;
  }

  const selectedPreset = state.selectedPresetId ? getPresetById(state.selectedPresetId) : null;
  const providerId = selectedPreset?.provider || 'siliconflow';
  const currentKey = ctx.plugin.settings.providers[providerId]?.apiKey || '';

  const isXiaomi = selectedPreset?.provider === 'xiaomi';
  const keyRow = card.createDiv({ cls: 'deeppdf-key-row' });
  const keyInput = keyRow.createEl('input', {
    cls: 'deeppdf-key-input',
    attr: {
      type: 'password',
      placeholder: isXiaomi ? '输入 Token Plan API Key（必填）' : `输入 ${PROVIDER_LABELS[providerId as ProviderType] || providerId} API Key`,
    },
  });
  keyInput.value = currentKey;

  const debouncedSaveKey = debounceAsync(async () => {
    await ctx.plugin.saveSettings();
  }, 300);
  keyInput.addEventListener('input', () => {
    const accounts = ctx.plugin.settings.providers as Record<string, { apiKey?: string; baseUrl?: string; fallbackApiKey?: string }>;
    if (!accounts[providerId]) accounts[providerId] = { apiKey: keyInput.value };
    else accounts[providerId].apiKey = keyInput.value;
    ctx.plugin.resetFrontendAgent();
    debouncedSaveKey();
  });

  const eyeBtn = keyRow.createEl('button', { text: '👁', cls: 'deeppdf-btn-eye' });
  let keyVisible = false;
  eyeBtn.addEventListener('click', () => {
    keyVisible = !keyVisible;
    keyInput.type = keyVisible ? 'text' : 'password';
  });

  if (state.testStatus) {
    keyRow.createEl('span', {
      text: state.testStatus.message,
      cls: `deeppdf-key-status ${state.testStatus.success ? 'is-success' : 'is-error'}`,
    });
  }

  // Xiaomi MIMO: 第二个 Key 输入框（API API Key，可选）
  let fallbackInput: HTMLInputElement | undefined;
  if (isXiaomi) {
    const fallbackRow = card.createDiv({ cls: 'deeppdf-key-row' });
    const currentFallbackKey = ctx.plugin.settings.providers['xiaomi']?.fallbackApiKey || '';
    fallbackInput = fallbackRow.createEl('input', {
      cls: 'deeppdf-key-input',
      attr: {
        type: 'password',
        placeholder: '输入 API API Key（可选，Token Plan 欠费时自动切换）',
      },
    });
    fallbackInput.value = currentFallbackKey;

    const debouncedSaveFallback = debounceAsync(async () => {
      await ctx.plugin.saveSettings();
    }, 300);
    fallbackInput.addEventListener('input', () => {
      const accounts = ctx.plugin.settings.providers as Record<string, { apiKey?: string; baseUrl?: string; fallbackApiKey?: string }>;
      if (!accounts['xiaomi']) accounts['xiaomi'] = { apiKey: keyInput.value, fallbackApiKey: fallbackInput!.value };
      else accounts['xiaomi'].fallbackApiKey = fallbackInput!.value;
      ctx.plugin.resetFrontendAgent();
      debouncedSaveFallback();
    });

    const fallbackEyeBtn = fallbackRow.createEl('button', { text: '👁', cls: 'deeppdf-btn-eye' });
    let fallbackKeyVisible = false;
    fallbackEyeBtn.addEventListener('click', () => {
      fallbackKeyVisible = !fallbackKeyVisible;
      fallbackInput!.type = fallbackKeyVisible ? 'text' : 'password';
    });

    if (state.fallbackTestStatus) {
      fallbackRow.createEl('span', {
        text: state.fallbackTestStatus.message,
        cls: `deeppdf-key-status ${state.fallbackTestStatus.success ? 'is-success' : 'is-error'}`,
      });
    }
  }

  const actionsRow = card.createDiv({ cls: 'deeppdf-actions-row' });
  const testBtn = actionsRow.createEl('button', { text: '测试连接', cls: 'deeppdf-btn-secondary' });
  const confirmBtn = actionsRow.createEl('button', { text: '确认配置 →', cls: 'deeppdf-btn-primary' });

  if (selectedPreset?.website) {
    const hint = card.createEl('div', { cls: 'setting-item-description deeppdf-hint-register' });
    hint.createSpan({ text: '还没有 Key？' });
    hint.createEl('a', {
      text: `前往注册${selectedPreset.free ? '（免费）' : ''}`,
      attr: { href: selectedPreset.website, target: '_blank', rel: 'noopener noreferrer' },
    });
  }

  testBtn.addEventListener('click', async () => {
    const apiKey = keyInput.value.trim();
    if (!apiKey || !selectedPreset) return;

    testBtn.textContent = '测试中...';
    testBtn.setAttribute('disabled', 'true');

    state.testStatus = null;
    state.fallbackTestStatus = null;

    const { testConnection } = await import('../../config/model-fetcher');
    const config = PROVIDER_CONFIGS[providerId as ProviderType];
    const model = selectedPreset.roleAssignments.chat || config?.defaultModel || '';

    // 主 Key 测试（Token Plan）
    const primaryTest = testConnection(
      config?.baseUrl || '',
      apiKey,
      model,
      'chat',
    ).then(r => ({
      success: r.success,
      message: r.success ? `✓ ${r.latencyMs}ms` : `✗ ${r.error}`,
    })).catch(e => ({
      success: false,
      message: `✗ ${e.message}`,
    }));

    // 小米 MIMO：如果配了 fallback Key，并行测
    let fallbackTest: Promise<{ success: boolean; message: string }> | null = null;
    if (isXiaomi && fallbackInput) {
      const fallbackVal = fallbackInput.value.trim();
      if (fallbackVal) {
        fallbackTest = testConnection(
          'https://api.xiaomimimo.com/v1',
          fallbackVal,
          model,
          'chat',
        ).then(r => ({
          success: r.success,
          message: r.success ? `✓ ${r.latencyMs}ms` : `✗ ${r.error}`,
        })).catch(e => ({
          success: false,
          message: `✗ ${e.message}`,
        }));
      }
    }

    const [primaryResult, fallbackResult] = await Promise.all(
      fallbackTest ? [primaryTest, fallbackTest] : [primaryTest],
    );

    state.testStatus = primaryResult;
    if (fallbackResult) state.fallbackTestStatus = fallbackResult;

    testBtn.textContent = '测试连接';
    testBtn.removeAttribute('disabled');
    onRerender();
  });

  confirmBtn.addEventListener('click', async () => {
    const apiKey = keyInput.value.trim();
    if (!apiKey || !state.selectedPresetId) {
      new Notice('请输入 API Key');
      return;
    }

    applyPreset(state.selectedPresetId, apiKey, ctx.plugin.settings);

    // Xiaomi MIMO: 同时保存 fallbackApiKey
    if (isXiaomi && fallbackInput) {
      const fallbackVal = fallbackInput.value.trim();
      const accounts = ctx.plugin.settings.providers as Record<string, { apiKey?: string; baseUrl?: string; fallbackApiKey?: string }>;
      if (!accounts['xiaomi']) accounts['xiaomi'] = { apiKey, fallbackApiKey: fallbackVal || undefined };
      else accounts['xiaomi'].fallbackApiKey = fallbackVal || undefined;
    }

    ctx.plugin.settings.setupComplete = true;
    ctx.plugin.resetFrontendAgent();
    await ctx.plugin.saveSettings();
    state.testStatus = null;
    state.fallbackTestStatus = null;
    new Notice('配置完成！可以开始使用了');
    state.forceShowQuickSetup = false;
    onRerender();
  });
}

function renderConfigSummary(
  container: HTMLElement,
  ctx: SectionContext,
  state: LLMState,
  onRerender: () => void,
): void {
  const card = container.createDiv({ cls: 'deeppdf-settings-card' });
  const summary = card.createDiv({ cls: 'deeppdf-config-summary' });

  const currentPreset = detectCurrentPreset(
    ctx.plugin.settings.roles as unknown as Record<string, { provider: string; model: string } | null>,
  );
  const titleText = currentPreset
    ? `当前方案：${currentPreset.label}`
    : '当前配置';
  summary.createEl('div', { text: titleText, cls: 'deeppdf-config-summary-title' });

  const roles = ctx.plugin.settings.roles;
  const parts: string[] = [];
  if (roles.chat) parts.push(`对话: ${roles.chat.model}`);
  if (roles.embedding) parts.push(`语义搜索: ${roles.embedding.model}`);
  if (roles.reranker) parts.push(`排序: ${roles.reranker.model}`);
  if (parts.length === 0) parts.push('仅基础对话');
  summary.createEl('div', { text: parts.join(' · '), cls: 'deeppdf-config-summary-details' });

  const actions = summary.createDiv({ cls: 'deeppdf-config-summary-actions' });
  const switchBtn = actions.createEl('button', { text: '切换方案', cls: 'deeppdf-btn-secondary' });

  switchBtn.addEventListener('click', () => {
    state.forceShowQuickSetup = true;
    state.testStatus = null;
    onRerender();
  });
}

function renderMineruSection(
  container: HTMLElement,
  ctx: SectionContext,
  state: LLMState,
  onRerender: () => void,
): void {
  container.createEl('h3', { text: 'MinerU PDF 解析' });
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
