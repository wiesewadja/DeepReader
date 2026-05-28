/**
 * Role card component — collapsible card for configuring an AI role.
 * Uses CSS display toggle for smooth expand/collapse without DOM rebuild.
 */

import { Setting, Notice, TextComponent } from 'obsidian';
import type DeepReaderPlugin from '../../main';
import type { RoleType, ProviderType } from '../../config/types';
import { ROLE_CAPABILITY } from '../../config/ai-roles';
import type { AIRoleConfig } from '../../config/ai-roles';
import { PROVIDER_CONFIGS, getAvailableProvidersForRole, getProviderName } from '../../config/providers';
import { getRoleConfig, setRoleConfig } from '../helpers';

interface RoleCardContext {
  plugin: DeepReaderPlugin;
  expandedSections: Set<string>;
  onToggle: (sectionId: string) => void;
  onRerender?: () => void;
}

function buildSummaryLine(roleConfig: { provider: string; model: string } | null, settings: any): string {
  if (!roleConfig) return '未配置';
  const providerLabel = getProviderName(roleConfig.provider, settings);
  return roleConfig.model ? `${providerLabel} · ${roleConfig.model}` : providerLabel;
}

function updateSummary(summaryEl: HTMLElement | null, role: RoleType, plugin: DeepReaderPlugin): void {
  if (!summaryEl) return;
  const rc = getRoleConfig(plugin.settings.roles, role);
  summaryEl.setText(buildSummaryLine(rc, plugin.settings));
}

/**
 * Render a collapsible role card — always renders content, toggles via CSS display.
 */
export function createRoleCard(
  container: HTMLElement,
  role: RoleType,
  label: string,
  desc: string,
  optional: boolean,
  ctx: RoleCardContext,
): void {
  const settings = ctx.plugin.settings;
  const roleConfig = getRoleConfig(settings.roles, role);

  const sectionId = `role-${role}`;
  const isCollapsed = !ctx.expandedSections.has(sectionId);

  const sectionWrapper = container.createDiv({ cls: 'deeppdf-settings-collapsible-section' });
  const header = sectionWrapper.createDiv({ cls: 'deeppdf-settings-collapsible-header' });

  const titleRow = header.createDiv({ cls: 'deeppdf-settings-provider-title' });
  titleRow.createEl('h5', { text: label });

  const summarySpan = header.createEl('span', {
    text: buildSummaryLine(roleConfig, settings),
    cls: 'deeppdf-settings-collapsible-desc',
  });

  const indicator = header.createSpan({ cls: 'deeppdf-settings-collapsible-indicator' });
  indicator.setText(isCollapsed ? '▶' : '▼');

  const content = sectionWrapper.createDiv({ cls: 'deeppdf-settings-collapsible-content' });
  if (isCollapsed) {
    content.style.display = 'none';
  }
  createRoleContent(content, role, label, desc, optional, roleConfig, ctx, summarySpan);

  header.addEventListener('click', () => {
    const nowCollapsed = content.style.display === 'none';
    content.style.display = nowCollapsed ? '' : 'none';
    indicator.setText(nowCollapsed ? '▼' : '▶');
    if (nowCollapsed) {
      ctx.expandedSections.add(sectionId);
    } else {
      ctx.expandedSections.delete(sectionId);
    }
  });
}

export function createRoleContent(
  container: HTMLElement,
  role: RoleType,
  label: string,
  desc: string,
  optional: boolean,
  roleConfig: AIRoleConfig | null,
  ctx: RoleCardContext,
  summaryEl: HTMLElement | null = null,
): void {
  const settings = ctx.plugin.settings;
  const roles = settings.roles;
  const row = container.createDiv({ cls: 'deeppdf-settings-role-row' });

  if (optional) {
    const isEnabled = roleConfig !== null;
    new Setting(row)
      .setName(label)
      .setDesc(desc)
      .addToggle(toggle => toggle
        .setValue(isEnabled)
        .onChange(async (value) => {
          if (value) {
            const available = getAvailableProvidersForRole(role, settings);
            const defaultProvider = available[0] || 'deepseek';
            setRoleConfig(roles, role, {
              provider: defaultProvider,
              model: PROVIDER_CONFIGS[defaultProvider as ProviderType]?.defaultModel || '',
            });
          } else {
            setRoleConfig(roles, role, null);
          }
          ctx.plugin.resetFrontendAgent();
          await ctx.plugin.saveSettings();
          ctx.onToggle(`role-${role}`);
        }));

    if (!isEnabled) {
      if (role === 'embedding') {
        row.createEl('p', {
          text: '语义搜索让 AI 不仅匹配关键词，还能理解含义。开启后首次索引稍慢，但搜索质量显著提升。',
          cls: 'setting-item-description',
        });
      } else {
        row.createEl('p', {
          text: '启用后将为此角色分配服务商和模型。',
          cls: 'setting-item-description',
        });
      }
      return;
    }
  }

  const availableProviders = getAvailableProvidersForRole(role, settings);
  const currentProvider = roleConfig?.provider || 'deepseek';

  new Setting(row)
    .setName('服务商')
    .setDesc(availableProviders.length === 0 ? '没有已配置的服务商，请先在上方填写 API Key' : '')
    .addDropdown(dropdown => {
      const requiredCap = ROLE_CAPABILITY[role];
      const allProviders = new Set<string>([...availableProviders, currentProvider]);
      // 加入所有具备该能力的内置服务商（即使未填 Key，方便用户发现和配置）
      for (const [id, config] of Object.entries(PROVIDER_CONFIGS)) {
        if (config.capabilities[requiredCap as keyof typeof config.capabilities]) {
          allProviders.add(id);
        }
      }
      for (const p of allProviders) {
        const hasKey = !!(settings.providers as Record<string, unknown>)[p] &&
          !!((settings.providers as Record<string, unknown>)[p] as { apiKey?: string })?.apiKey;
        const provLabel = getProviderName(p, settings);
        dropdown.addOption(p, `${provLabel}${hasKey ? '' : ' (未配置)'}`);
      }
      dropdown.setValue(currentProvider);
      dropdown.onChange(async (value) => {
        const dm = PROVIDER_CONFIGS[value as ProviderType]?.defaultModel || '';
        setRoleConfig(roles, role, { provider: value, model: dm });
        ctx.plugin.resetFrontendAgent();
        await ctx.plugin.saveSettings();
        updateSummary(summaryEl, role, ctx.plugin);
        ctx.onRerender?.();
      });
    });

  const providerConfig = PROVIDER_CONFIGS[currentProvider as ProviderType];
  const isBuiltIn = !!providerConfig;
  const supportsModelList = isBuiltIn ? providerConfig.supportsModelList : true;
  const defaultModel = isBuiltIn ? providerConfig.defaultModel : '';
  const oldModel = roleConfig?.model || '';

  let modelTextComp: TextComponent | null = null;

  const modelSetting = new Setting(row)
    .setName('模型')
    .addText(text => {
      modelTextComp = text;
      text
        .setPlaceholder(defaultModel || 'model-name')
        .setValue(oldModel)
        .onChange(async (value) => {
          setRoleConfig(roles, role, { model: value });
          ctx.plugin.resetFrontendAgent();
          await ctx.plugin.saveSettings();
          updateSummary(summaryEl, role, ctx.plugin);

          if (role === 'embedding' && oldModel && value && oldModel !== value) {
            new Notice('已切换向量化模型，已有索引可能需要重建以保持搜索一致性');
          }
        });
    });

  const currentAccount = (settings.providers as Record<string, unknown>)[currentProvider] as { apiKey?: string; baseUrl?: string } | undefined;

  if (supportsModelList) {
    const account = (settings.providers as Record<string, unknown>)[currentProvider] as { apiKey?: string; baseUrl?: string } | undefined;
    if (account?.apiKey) {
      const switchToText = () => {
        modelSetting.controlEl.empty();
        const cur = getRoleConfig(ctx.plugin.settings.roles, role)?.model || '';
        modelTextComp?.setValue(cur);
        if (modelTextComp) modelSetting.controlEl.appendChild(modelTextComp.inputEl);
      };

      const onModelChange = (model: string) => {
        setRoleConfig(roles, role, { model });
        ctx.plugin.resetFrontendAgent();
        ctx.plugin.saveSettings();
        updateSummary(summaryEl, role, ctx.plugin);
      };

      // If cached, render select directly instead of text input
      const cached = modelListCache.get(currentProvider);
      if (cached && cached.length > 0) {
        renderModelSelect(modelSetting.controlEl, cached, oldModel, onModelChange, switchToText);
      }

      // Refresh button always available
      modelSetting.addExtraButton(btn => btn
        .setIcon('refresh-cw')
        .setTooltip('刷新模型列表')
        .onClick(async () => {
          btn.setDisabled(true);
          const { fetchModels } = await import('../../config/model-fetcher');
          const result = await fetchModels(currentProvider, account as any, ROLE_CAPABILITY[role]);
          btn.setDisabled(false);
          if (result.success && result.models.length > 0) {
            modelListCache.set(currentProvider, result.models);
            modelListCacheExpiry.set(currentProvider, Date.now());

            const curModel = getRoleConfig(ctx.plugin.settings.roles, role)?.model || '';
            renderModelSelect(modelSetting.controlEl, result.models, curModel, async (model) => {
              setRoleConfig(roles, role, { model });
              ctx.plugin.resetFrontendAgent();
              await ctx.plugin.saveSettings();
              updateSummary(summaryEl, role, ctx.plugin);
            }, switchToText);

            const selectedValue = curModel && result.models.includes(curModel)
              ? curModel
              : result.models[0];

            if (selectedValue !== curModel) {
              setRoleConfig(roles, role, { model: selectedValue });
              ctx.plugin.resetFrontendAgent();
              await ctx.plugin.saveSettings();
              updateSummary(summaryEl, role, ctx.plugin);
            }

            new Notice(`已刷新，共 ${result.models.length} 个模型`);
          } else {
            new Notice(`获取失败: ${result.error || '无可用模型'}`);
          }
        }));
    }
  }

  if (currentAccount?.apiKey) {
    new Setting(row)
      .setName('连接测试')
      .setDesc('验证当前服务商、API Key 和模型名称是否可用')
      .addButton(btn => btn
        .setButtonText('测试连接')
        .setCta()
        .onClick(async () => {
          const freshSettings = ctx.plugin.settings;
          const freshAccount = (freshSettings.providers as Record<string, unknown>)[currentProvider] as { apiKey?: string; baseUrl?: string } | undefined;
          const freshRole = getRoleConfig(freshSettings.roles, role);
          const currentModel = freshRole?.model;
          if (!currentModel) {
            new Notice('请先填写模型名称');
            return;
          }
          btn.setDisabled(true);
          btn.setButtonText('测试中...');
          const { testConnection } = await import('../../config/model-fetcher');
          const builtInConfig = PROVIDER_CONFIGS[currentProvider as ProviderType];
          const effectiveBaseUrl = freshAccount?.baseUrl || builtInConfig?.baseUrl || '';
          const capability = ROLE_CAPABILITY[role];
          const endpoint = capability === 'tts' ? 'tts' : capability === 'embedding' ? 'embedding' : capability === 'imagegen' ? 'imagegen' : 'chat';
          const result = await testConnection(
            effectiveBaseUrl,
            freshAccount?.apiKey || '',
            currentModel,
            endpoint,
          );
          btn.setDisabled(false);
          btn.setButtonText('测试连接');
          if (result.success) {
            new Notice(`✓ 连接成功 (${result.latencyMs}ms) — ${result.model || currentModel}`);
          } else {
            new Notice(`✗ 连接失败: ${result.error}`);
          }
        }));
  }

  if (ROLE_CAPABILITY[role] === 'chat') {
    const currentDisableThinking = roleConfig?.disableThinking;
    new Setting(row)
      .setName('禁用深度思考')
      .setDesc('禁用模型的思考过程，减少首次响应延迟和 Token 消耗。默认自动检测。')
      .addDropdown(dropdown => dropdown
        .addOption('', '自动检测')
        .addOption('true', '强制禁用')
        .addOption('false', '不禁用')
        .setValue(currentDisableThinking === true ? 'true' : currentDisableThinking === false ? 'false' : '')
        .onChange(async (value) => {
          const disableThinking = value === 'true' ? true : value === 'false' ? false : undefined;
          setRoleConfig(roles, role, { disableThinking });
          ctx.plugin.resetFrontendAgent();
          await ctx.plugin.saveSettings();
        }));
  }

  if (role === 'embedding') {
    const currentBatchSize = roleConfig?.embeddingBatchSize;
    new Setting(row)
      .setName('Batch Size')
      .setDesc('每次 API 请求最多发送的文本数（默认 32，范围 1-2048）')
      .addText(text => text
        .setPlaceholder('32')
        .setValue(currentBatchSize != null ? String(currentBatchSize) : '')
        .onChange(async (value) => {
          const parsed = parseInt(value, 10);
          setRoleConfig(roles, role, {
            embeddingBatchSize: (!value || isNaN(parsed)) ? undefined : Math.max(1, Math.min(parsed, 2048)),
          });
          await ctx.plugin.saveSettings();
        }));
  }
}

/**
 * Render a <select> dropdown for model selection. Extracted to avoid duplicate code.
 */
function renderModelSelect(
  controlEl: HTMLElement,
  models: string[],
  currentModel: string,
  onChange: (model: string) => void,
  onManual?: () => void,
): void {
  controlEl.empty();
  const select = controlEl.createEl('select', { cls: 'dropdown' });
  for (const m of models) {
    const opt = select.createEl('option', { text: m });
    opt.value = m;
  }
  if (currentModel && !models.includes(currentModel)) {
    const opt = select.createEl('option', { text: `${currentModel} (自定义)` });
    opt.value = currentModel;
  }
  select.createEl('option', { text: '── 手动输入其他模型 ──' }).value = '__manual__';
  select.value = currentModel || models[0] || '__manual__';
  select.addEventListener('change', () => {
    if (select.value === '__manual__') {
      onManual?.();
    } else {
      onChange(select.value);
    }
  });
}

// Cache fetched model lists per provider with 30-minute TTL
const modelListCache = new Map<string, string[]>();
const modelListCacheExpiry = new Map<string, number>();
const CACHE_TTL_MS = 30 * 60 * 1000;

export function getCachedModels(provider: string): string[] | undefined {
  const expiry = modelListCacheExpiry.get(provider);
  if (expiry && Date.now() - expiry > CACHE_TTL_MS) {
    modelListCache.delete(provider);
    modelListCacheExpiry.delete(provider);
    return undefined;
  }
  return modelListCache.get(provider);
}

export function clearModelCache(provider?: string): void {
  if (provider) {
    modelListCache.delete(provider);
    modelListCacheExpiry.delete(provider);
  } else {
    modelListCache.clear();
    modelListCacheExpiry.clear();
  }
}
