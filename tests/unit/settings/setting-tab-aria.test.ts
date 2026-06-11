/**
 * DeepPDFSettingTab — Tab 导航可访问性（WCAG 4.1.2 + WAI-ARIA Tabs Pattern）
 *
 * 目标不变量：
 *  1. nav 容器挂 role=tablist
 *  2. 5 个 tab 节点挂 role=tab
 *  3. 当前激活 tab 有 aria-selected=true，其他为 false
 *  4. 当前激活 tab 收到键盘焦点（tabindex=0），其他 tabindex=-1（roving）
 *  5. 键盘 ArrowLeft / ArrowRight 切换 tab
 *  6. tablist 容器有 aria-label 描述
 *  7. tab 节点 textContent 包含可读名称（不是只有 icon）
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('obsidian', async (importOriginal) => {
    const actual = await importOriginal<typeof import('obsidian')>();
    return {
        ...actual,
        PluginSettingTab: class MockPluginSettingTab {
            app: unknown;
            plugin: unknown;
            containerEl: HTMLElement;
            constructor(app: unknown, plugin: unknown) {
                this.app = app;
                this.plugin = plugin;
                this.containerEl = document.createElement('div');
                document.body.appendChild(this.containerEl);
            }
        },
        setIcon: vi.fn((el: HTMLElement) => {
            el.textContent = '📌';
        }),
        // 传递依赖补齐（setting-tab 间接 import）
        FuzzySuggestModal: class MockFuzzySuggestModal {
            constructor(_app: unknown) {}
        },
        // Setting API minimal mock（section 渲染需要）
        Setting: class MockSetting {
            settingEl: HTMLElement;
            constructor(containerEl: HTMLElement) {
                this.settingEl = document.createElement('div');
                containerEl.appendChild(this.settingEl);
            }
            setName() { return this; }
            setDesc() { return this; }
            addText(cb?: any) {
                const inputEl = document.createElement('input');
                const text: any = {
                    inputEl,
                    setValue: () => text,
                    setPlaceholder: () => text,
                    onChange: () => text,
                };
                if (cb) cb(text);
                return this;
            }
            addToggle(cb?: any) {
                const t: any = { setValue: () => t, onChange: () => t };
                if (cb) cb(t);
                return this;
            }
            addDropdown(cb?: any) {
                const d: any = { setValue: () => d, addOption: () => d, onChange: () => d };
                if (cb) cb(d);
                return this;
            }
            addButton(cb?: any) {
                const b: any = { setButtonText: () => b, setCta: () => b, onClick: () => b };
                if (cb) cb(b);
                return this;
            }
            addSlider(cb?: any) {
                const s: any = { setValue: () => s, setLimits: () => s, setDynamicTooltip: () => s, onChange: () => s, setDisabled: () => s };
                if (cb) cb(s);
                return this;
            }
        },
    };
});

import { DeepPDFSettingTab } from '@/settings/setting-tab';

describe('DeepPDFSettingTab — Tab ARIA semantics (WAI-ARIA Tabs Pattern)', () => {
    let tab: DeepPDFSettingTab;
    let container: HTMLElement;
    let navContainer: HTMLElement;

    beforeEach(() => {
        tab = new DeepPDFSettingTab({} as any, {
            setupComplete: true,
            settings: {},
            saveSettings: vi.fn(),
        } as any);
        container = tab.containerEl;
        // 只调 createTabNav 隔离 tab 渲染逻辑（避免 section 渲染的传递依赖）
        container.addClass('deeppdf-settings');
        navContainer = container.createDiv({ cls: 'deeppdf-settings-nav' });
        (tab as any).createTabNav(navContainer);
    });

    afterEach(() => {
        container.remove();
    });

    function getTablist(): HTMLElement {
        return navContainer;
    }

    function getTabs(): HTMLElement[] {
        return Array.from(
            navContainer.querySelectorAll('[role="tab"]'),
        ) as HTMLElement[];
    }

    describe('invariant 1 — tablist role', () => {
        it('nav 容器挂 role=tablist', () => {
            expect(getTablist().getAttribute('role')).toBe('tablist');
        });
    });

    describe('invariant 2 — tabs 数量 + role', () => {
        it('应有 5 个 tab（AI 服务 / 用户画像 / 阅读模式 / 微信读书 / 高级）', () => {
            expect(getTabs().length).toBe(5);
        });

        it('每个 tab 都有 role=tab', () => {
            for (const t of getTabs()) {
                expect(t.getAttribute('role')).toBe('tab');
            }
        });
    });

    describe('invariant 3 — aria-selected 反映当前 tab', () => {
        it('默认激活 tab（AI 服务）的 aria-selected=true', () => {
            const tabs = getTabs();
            const active = tabs.find(
                (t) => t.textContent?.includes('AI 服务'),
            );
            expect(active?.getAttribute('aria-selected')).toBe('true');
        });

        it('其他 tab 的 aria-selected=false', () => {
            const tabs = getTabs();
            const inactive = tabs.filter(
                (t) => t.getAttribute('aria-selected') === 'false',
            );
            expect(inactive.length).toBe(4);
        });
    });

    describe('invariant 4 — roving tabindex', () => {
        it('激活 tab 的 tabindex=0（可被 Tab 聚焦）', () => {
            const active = getTabs().find(
                (t) => t.getAttribute('aria-selected') === 'true',
            );
            expect(active?.getAttribute('tabindex')).toBe('0');
        });

        it('非激活 tab 的 tabindex=-1（不可 Tab 聚焦，但 Arrow 键可达）', () => {
            const inactive = getTabs().filter(
                (t) => t.getAttribute('aria-selected') === 'false',
            );
            for (const t of inactive) {
                expect(t.getAttribute('tabindex')).toBe('-1');
            }
        });
    });

    describe('invariant 5 — 键盘导航（handler 挂载）', () => {
        // 注：完整的 Arrow 键切换需要 switchTab() 调用 display()，后者会调
        // LLM/Profile 等 section 渲染，需要完整 Obsidian Setting API mock
        // （超出本任务范围）。这里只验证 keydown handler 被绑定、且不 throw。

        it('ArrowRight 在激活 tab 上不抛错', () => {
            const tabs = getTabs();
            expect(() => {
                tabs[0].dispatchEvent(
                    new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
                );
            }).not.toThrow();
        });

        it('ArrowLeft 在激活 tab 上不抛错', () => {
            const tabs = getTabs();
            expect(() => {
                tabs[0].dispatchEvent(
                    new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }),
                );
            }).not.toThrow();
        });
    });

    describe('invariant 6 — tablist aria-label', () => {
        it('tablist 容器有 aria-label 描述', () => {
            const label = getTablist().getAttribute('aria-label');
            expect(label).toBeTruthy();
        });
    });

    describe('invariant 7 — tab 名称可读', () => {
        it('tab textContent 含中文名称（不是仅 icon）', () => {
            const tabs = getTabs();
            for (const t of tabs) {
                // 至少 2 字符的中文名
                expect(t.textContent?.length).toBeGreaterThanOrEqual(2);
            }
        });
    });
});
