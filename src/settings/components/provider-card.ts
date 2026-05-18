/**
 * Provider card component — renders provider account configuration cards.
 */

import { Notice, Setting } from 'obsidian';
import type DeepPDFPlugin from '../../main';
import type { ProviderType } from '../../config/types';
import { PROVIDER_LABELS, PROVIDER_CONFIGS } from '../../config/providers';
import { debounceAsync, getProviderAccount, setProviderAccount, validateBaseUrl } from '../helpers';

interface ProviderCardContext {
  plugin: DeepPDFPlugin;
  expandedSections: Set<string>;
  onToggle: (sectionId: string) => void;
}

/**
 * Render the list of all provider accounts (built-in + custom).
 */
export function renderProviderList(
  container: HTMLElement,
  ctx: ProviderCardContext,
): void {
  const providers = ctx.plugin.settings.providers;
  if (!providers) return;

  for (const providerId of Object.keys(providers)) {
    const account = getProviderAccount(providers as Record<string, unknown>, providerId);
    if (!account) continue;

    const isBuiltIn = !!PROVIDER_CONFIGS[providerId as ProviderType];
    const displayName = isBuiltIn
      ? PROVIDER_LABELS[providerId as ProviderType]
      : account.name || providerId;

    const sectionId = `provider-${providerId}`;
    const isCollapsed = !ctx.expandedSections.has(sectionId);
    const card = container.createDiv({ cls: 'deeppdf-settings-collapsible-section' });
    const header = card.createDiv({ cls: 'deeppdf-settings-collapsible-header' });

    const titleRow = header.createDiv({ cls: 'deeppdf-settings-provider-title' });
    titleRow.createEl('h5', { text: displayName });

    if (isBuiltIn) {
      const caps = PROVIDER_CONFIGS[providerId as ProviderType].capabilities;
      const capTags: string[] = [];
      if (caps.chat) capTags.push('对话');
      if (caps.embedding) capTags.push('向量化');
      if (caps.reranker) capTags.push('重排序');
      titleRow.createSpan({ text: capTags.join(' · '), cls: 'deeppdf-settings-capability-tags' });
    } else {
      titleRow.createSpan({ text: '自定义', cls: 'deeppdf-settings-capability-tags' });
    }

    const hasKey = !!account.apiKey;
    titleRow.createSpan({
      text: hasKey ? '✓ 已配置' : '未配置',
      cls: `deeppdf-settings-status ${hasKey ? 'is-configured' : 'is-not-configured'}`,
    });

    const indicator = header.createSpan({ cls: 'deeppdf-settings-collapsible-indicator' });
    indicator.setText(isCollapsed ? '▶' : '▼');

    const content = card.createDiv({ cls: 'deeppdf-settings-collapsible-content' });
    if (isCollapsed) {
      content.style.display = 'none';
    }
    renderProviderDetail(content, providerId, account, isBuiltIn, displayName, ctx);

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

  container.createDiv({ cls: 'deeppdf-settings-add-provider' }, (wrapper) => {
    new Setting(wrapper)
      .setName('添加自定义服务商')
      .setDesc('支持 OpenAI 兼容 API 的第三方服务商（如 OpenRouter、Together AI、中转站等）')
      .addButton(btn => btn
        .setButtonText('+ 添加')
        .setCta()
        .onClick(() => {
          const id = `custom-${crypto.randomUUID()}`;
          (ctx.plugin.settings.providers as Record<string, unknown>)[id] = {
            apiKey: '',
            baseUrl: '',
            name: '',
          };
          ctx.onToggle(`provider-${id}`);
        }));
  });
}

/**
 * Render the detailed configuration for a single provider.
 */
export function renderProviderDetail(
  container: HTMLElement,
  providerId: string,
  account: { apiKey?: string; baseUrl?: string; name?: string; fallbackApiKey?: string; fallbackBaseUrl?: string },
  isBuiltIn: boolean,
  displayName: string,
  ctx: ProviderCardContext,
): void {
  const providers = ctx.plugin.settings.providers as Record<string, unknown>;

  if (!isBuiltIn) {
    new Setting(container)
      .setName('服务商名称')
      .setDesc('自定义显示名称')
      .addText(text => text
        .setPlaceholder('我的 API 服务')
        .setValue(account.name || '')
        .onChange(async (value) => {
          setProviderAccount(providers, providerId, { name: value });
          await ctx.plugin.saveSettings();
        }));

    new Setting(container)
      .setName('Base URL')
      .setDesc('服务商的 API 地址（必填）')
      .addText(text => text
        .setPlaceholder('https://api.example.com/v1')
        .setValue(account.baseUrl || '')
        .onChange(async (value) => {
          const validation = validateBaseUrl(value);
          if (!validation.valid) {
            new Notice(validation.error || 'URL 无效');
            return;
          }
          setProviderAccount(providers, providerId, { baseUrl: value });
          ctx.plugin.resetFrontendAgent();
          await ctx.plugin.saveSettings();
        }));

    new Setting(container)
      .setName('删除此服务商')
      .setDesc('删除后，使用该服务商的角色将失效')
      .addButton(btn => btn
        .setButtonText('删除')
        .setWarning()
        .onClick(async () => {
          delete providers[providerId];
          ctx.plugin.resetFrontendAgent();
          await ctx.plugin.saveSettings();
          ctx.onToggle(`provider-${providerId}`);
        }));
  }

  const isXiaomi = providerId === 'xiaomi';
  const keyLabel = isXiaomi ? 'Token Plan API Key' : 'API Key';
  const keyDesc = isXiaomi ? '用于访问 MIMO Token Plan 服务的密钥（必填）' : `用于访问 ${displayName} 服务的密钥`;

  const keySetting = new Setting(container)
    .setName(keyLabel)
    .setDesc(keyDesc)
    .addText(text => {
      text.setPlaceholder('sk-...')
        .setValue(account.apiKey || '')
        .inputEl.type = 'password';
      const debouncedSave = debounceAsync(async () => {
        await ctx.plugin.saveSettings();
      }, 300);
      text.onChange((value) => {
        setProviderAccount(providers, providerId, { apiKey: value });
        ctx.plugin.resetFrontendAgent();
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

  // 测试连接（Token Plan / 主 key）
  keySetting.addExtraButton(btn => {
    btn.setIcon('plug')
      .setTooltip('测试连接')
      .onClick(async () => {
        if (!account.apiKey) {
          new Notice('请先填写 API Key');
          return;
        }
        const { testConnection } = await import('../../config/model-fetcher');
        const builtInConfig = PROVIDER_CONFIGS[providerId as ProviderType];
        const effectiveBaseUrl = account.baseUrl || builtInConfig?.baseUrl || '';
        const isTts = builtInConfig?.capabilities?.tts && !builtInConfig?.capabilities?.chat;
        const endpoint = isTts ? 'tts' : 'chat';
        btn.setDisabled(true);
        btn.setIcon('loader');
        const result = await testConnection(effectiveBaseUrl, account.apiKey, builtInConfig?.defaultModel || '', endpoint);
        btn.setDisabled(false);
        btn.setIcon('plug');
        if (result.success) {
          new Notice(`✓ Token Plan 连接成功 (${result.latencyMs}ms)`);
        } else {
          new Notice(`✗ Token Plan 连接失败: ${result.error}`);
        }
      });
  });

  // Xiaomi: 可选的 API Key（Token Plan 欠费时自动切换）
  if (isXiaomi) {
    const fallbackSetting = new Setting(container)
      .setName('API API Key（可选）')
      .setDesc('Token Plan 欠费时自动切换到此 Key 对应的 MIMO API')
      .addText(text => {
        text.setPlaceholder('sk-...（可选）')
          .setValue(account.fallbackApiKey || '')
          .inputEl.type = 'password';
        text.onChange(async (value) => {
          setProviderAccount(providers, providerId, { fallbackApiKey: value });
          ctx.plugin.resetFrontendAgent();
          await ctx.plugin.saveSettings();
        });
      });

    const fallbackInputEl = fallbackSetting.controlEl.querySelector('input');
    fallbackSetting.addExtraButton(btn => {
      btn.setIcon('eye')
        .setTooltip('显示')
        .onClick(() => {
          // placeholder for now
        });
    });

    // 测试连接（API key）
    fallbackSetting.addExtraButton(btn => {
      btn.setIcon('plug')
        .setTooltip('测试连接')
        .onClick(async () => {
          if (!account.fallbackApiKey) {
            new Notice('请先填写 API API Key');
            return;
          }
          const { testConnection } = await import('../../config/model-fetcher');
          const fallbackBaseUrl = account.fallbackBaseUrl || 'https://api.xiaomimimo.com/v1';
          btn.setDisabled(true);
          btn.setIcon('loader');
          const result = await testConnection(fallbackBaseUrl, account.fallbackApiKey, 'mimo-v2.5', 'chat');
          btn.setDisabled(false);
          btn.setIcon('plug');
          if (result.success) {
            new Notice(`✓ API 连接成功 (${result.latencyMs}ms)`);
          } else {
            new Notice(`✗ API 连接失败: ${result.error}`);
          }
        });
    });
  }
}
