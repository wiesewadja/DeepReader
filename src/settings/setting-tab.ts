/**
 * DeepReader 插件设置界面 — 主入口
 *
 * 职责：Tab 导航 + display() + 分发到各 section 渲染函数。
 * 具体 UI 逻辑在 sections/ 和 components/ 目录。
 */

import { type App, PluginSettingTab, setIcon } from 'obsidian';
import type DeepReaderPlugin from '../main';
import { renderAdvancedSection } from './sections/advanced-section';
import { renderLLMSection, createLLMState } from './sections/llm-section';
import type { LLMState } from './sections/llm-section';
import { renderProfileSection } from './sections/profile-section';
import { renderReadingSection } from './sections/reading-section';
import { renderWereadSection } from './sections/weread-section';
import type { SectionContext } from './types';

type SettingsTabId = 'llm' | 'profile' | 'reading' | 'advanced' | 'weread';

interface SettingsTab {
  id: SettingsTabId;
  name: string;
  icon: string;
}

export class DeepPDFSettingTab extends PluginSettingTab {
  plugin: DeepReaderPlugin;
  private currentTab: SettingsTabId = 'llm';
  private contentContainer: HTMLElement | null = null;
  private expandedSections: Set<string> = new Set();
  private llmState: LLMState = createLLMState();

  private tabs: SettingsTab[] = [
    { id: 'llm', name: 'AI 服务', icon: 'bot' },
    { id: 'profile', name: '用户画像', icon: 'user' },
    { id: 'reading', name: '阅读模式', icon: 'book-open' },
    { id: 'weread', name: '微信读书', icon: 'book-marked' },
    { id: 'advanced', name: '高级', icon: 'cog' },
  ];

  constructor(app: App, plugin: DeepReaderPlugin) {
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
    // 屏幕阅读器可访问性：WAI-ARIA Tabs Pattern
    container.setAttribute('role', 'tablist');
    container.setAttribute('aria-label', '设置分类导航');

    this.tabs.forEach(tab => {
      const isActive = this.currentTab === tab.id;
      const navItem = container.createDiv({
        cls: `deeppdf-settings-nav-item ${isActive ? 'is-active' : ''}`,
      });
      navItem.setAttribute('role', 'tab');
      navItem.setAttribute('aria-selected', String(isActive));
      // roving tabindex：只有激活 tab 可 Tab 聚焦，其他用 Arrow 键
      navItem.setAttribute('tabindex', isActive ? '0' : '-1');

      const iconEl = navItem.createSpan({ cls: 'deeppdf-settings-nav-icon' });
      setIcon(iconEl, tab.icon);
      navItem.createSpan({ cls: 'deeppdf-settings-nav-name', text: tab.name });

      navItem.addEventListener('click', () => this.switchTab(tab.id));
      // 键盘导航：ArrowLeft / ArrowRight 循环切换（roving tabindex 模式）
      navItem.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
          e.preventDefault();
          const idx = this.tabs.findIndex((t) => t.id === tab.id);
          const nextIdx =
            e.key === 'ArrowRight'
              ? (idx + 1) % this.tabs.length
              : (idx - 1 + this.tabs.length) % this.tabs.length;
          this.switchTab(this.tabs[nextIdx].id);
          // 让新激活 tab 获得焦点
          requestAnimationFrame(() => {
            const items = container.querySelectorAll<HTMLElement>('[role="tab"]');
            items[nextIdx]?.focus();
          });
        }
      });
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
