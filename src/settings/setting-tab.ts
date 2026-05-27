/**
 * DeepReader 插件设置界面 — 主入口
 *
 * 职责：Tab 导航 + display() + 分发到各 section 渲染函数。
 * 具体 UI 逻辑在 sections/ 和 components/ 目录。
 */

import { App, PluginSettingTab, setIcon } from 'obsidian';
import type DeepPDFPlugin from '../main';
import type { SectionContext } from './types';
import { renderLLMSection, createLLMState } from './sections/llm-section';
import type { LLMState } from './sections/llm-section';
import { renderProfileSection } from './sections/profile-section';
import { renderAdvancedSection } from './sections/advanced-section';
import { renderWereadSection } from './sections/weread-section';
import { renderReadingSection } from './sections/reading-section';

type SettingsTabId = 'llm' | 'profile' | 'reading' | 'advanced' | 'weread';

interface SettingsTab {
  id: SettingsTabId;
  name: string;
  icon: string;
}

export class DeepPDFSettingTab extends PluginSettingTab {
  plugin: DeepPDFPlugin;
  private currentTab: SettingsTabId = 'llm';
  private contentContainer: HTMLElement | null = null;
  private expandedSections: Set<string> = new Set();
  private llmState: LLMState = createLLMState();

  private tabs: SettingsTab[] = [
    { id: 'llm', name: 'AI 服务', icon: 'bot' },
    { id: 'profile', name: '用户画像', icon: 'user' },
    { id: 'reading', name: '阅读模式', icon: 'book-open' },
    { id: 'advanced', name: '高级', icon: 'cog' },
    { id: 'weread', name: '微信读书', icon: 'book-marked' },
  ];

  constructor(app: App, plugin: DeepPDFPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('deeppdf-settings');

    const navContainer = containerEl.createDiv({ cls: 'deeppdf-settings-nav' });
    this.createTabNav(navContainer);

    this.contentContainer = containerEl.createDiv({ cls: 'deeppdf-settings-content' });
    this.renderTabContent(this.currentTab);
  }

  private createTabNav(container: HTMLElement): void {
    this.tabs.forEach(tab => {
      const navItem = container.createDiv({
        cls: `deeppdf-settings-nav-item ${this.currentTab === tab.id ? 'is-active' : ''}`,
      });
      const iconEl = navItem.createSpan({ cls: 'deeppdf-settings-nav-icon' });
      setIcon(iconEl, tab.icon);
      navItem.createSpan({ cls: 'deeppdf-settings-nav-name', text: tab.name });
      navItem.addEventListener('click', () => this.switchTab(tab.id));
    });
  }

  private switchTab(tabId: SettingsTabId): void {
    this.currentTab = tabId;
    this.display();
  }

  private renderTabContent(tabId: SettingsTabId): void {
    if (!this.contentContainer) return;
    const container = this.contentContainer;
    container.empty();

    const ctx: SectionContext = {
      plugin: this.plugin,
      app: this.app,
      containerEl: container,
      expandedSections: this.expandedSections,
      toggleSection: (sectionId: string) => {
        if (this.expandedSections.has(sectionId)) {
          this.expandedSections.delete(sectionId);
        } else {
          this.expandedSections.add(sectionId);
        }
        this.renderTabContent(tabId);
      },
    };

    switch (tabId) {
      case 'llm':
        renderLLMSection(container, ctx, this.llmState, () => this.renderTabContent('llm'));
        break;
      case 'profile':
        renderProfileSection(container, ctx, () => this.renderTabContent('profile'));
        break;
      case 'reading':
        renderReadingSection(container, ctx);
        break;
      case 'advanced':
        renderAdvancedSection(container, ctx);
        break;
      case 'weread':
        renderWereadSection(container, ctx, () => this.renderTabContent('weread'));
        break;
    }
  }
}
