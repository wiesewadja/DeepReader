/**
 * TopNav 组件测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TopNav, ConnectionStatus, IndexListItem } from '../../src/components/top-nav/top-nav';

describe('TopNav', () => {
	let topNav: TopNav;
	let container: HTMLElement;
	const mockOnIndexChange = vi.fn();
	const mockOnManageIndexes = vi.fn();
	const mockOnSettings = vi.fn();

	beforeEach(() => {
		container = document.createElement('div');
		document.body.appendChild(container);

		topNav = new TopNav({
			onIndexChange: mockOnIndexChange,
			onManageIndexes: mockOnManageIndexes
		});

		container.appendChild(topNav.getElement()!);
	});

	afterEach(() => {
		topNav.destroy();
		container.remove();
		mockOnIndexChange.mockClear();
		mockOnManageIndexes.mockClear();
		mockOnSettings.mockClear();
	});

	describe('初始化', () => {
		it('应该正确渲染顶部导航组件', () => {
			const el = topNav.getElement();
			expect(el).toBeTruthy();
			expect(el?.classList.contains('deeppdf-top-nav')).toBe(true);
		});

		it('应该渲染 Logo 和标题', () => {
			const el = topNav.getElement();
			const logo = el?.querySelector('.deeppdf-logo');
			const title = el?.querySelector('.deeppdf-nav-left h2');

			expect(logo).toBeTruthy();
			expect(title).toBeTruthy();
			expect(title?.textContent).toBe('DeepPDF');
		});

		it('应该渲染索引选择器', () => {
			const el = topNav.getElement();
			const indexSelect = el?.querySelector('.deeppdf-index-select');

			expect(indexSelect).toBeTruthy();
			expect(indexSelect?.tagName).toBe('SELECT');
		});

		it('应该渲染状态指示器', () => {
			const el = topNav.getElement();
			const status = el?.querySelector('.deeppdf-status');

			expect(status).toBeTruthy();
			expect(status?.classList.contains('deeppdf-status-loading')).toBe(true);
		});

		it('应该渲染管理索引按钮', () => {
			const el = topNav.getElement();
			const manageBtn = el?.querySelector('.deeppdf-manage-btn');

			expect(manageBtn).toBeTruthy();
			expect(manageBtn?.tagName).toBe('BUTTON');
			expect(manageBtn?.textContent).toContain('管理索引');
		});

		it('初始状态应该显示"检查中..."', () => {
			const el = topNav.getElement();
			const status = el?.querySelector('.deeppdf-status');

			expect(status?.textContent).toContain('检查中...');
		});

		it('索引选择器初始应该有默认选项', () => {
			const el = topNav.getElement();
			const indexSelect = el?.querySelector('.deeppdf-index-select') as HTMLSelectElement;

			expect(indexSelect?.options.length).toBeGreaterThan(0);
			expect(indexSelect?.options[0]?.value).toBe('');
		});
	});

	describe('连接状态', () => {
		it('setStatus("loading") 应该显示"检查中..."状态', () => {
			topNav.setStatus('loading');

			const el = topNav.getElement();
			const status = el?.querySelector('.deeppdf-status');

			expect(status?.classList.contains('deeppdf-status-loading')).toBe(true);
			expect(status?.textContent).toContain('检查中...');
		});

		it('setStatus("connected") 应该显示"已连接"状态', () => {
			topNav.setStatus('connected');

			const el = topNav.getElement();
			const status = el?.querySelector('.deeppdf-status');

			expect(status?.classList.contains('deeppdf-status-ok')).toBe(true);
			expect(status?.textContent).toContain('已连接');
		});

		it('setStatus("disconnected") 应该显示"未连接"状态', () => {
			topNav.setStatus('disconnected');

			const el = topNav.getElement();
			const status = el?.querySelector('.deeppdf-status');

			expect(status?.classList.contains('deeppdf-status-warning')).toBe(true);
			expect(status?.textContent).toContain('未连接');
		});

		it('setStatus("error") 应该显示"连接失败"状态', () => {
			topNav.setStatus('error');

			const el = topNav.getElement();
			const status = el?.querySelector('.deeppdf-status');

			expect(status?.classList.contains('deeppdf-status-error')).toBe(true);
			expect(status?.textContent).toContain('连接失败');
		});

		it('状态切换应该正确更新样式类', () => {
			topNav.setStatus('loading');
			let status = topNav.getElement()?.querySelector('.deeppdf-status');
			expect(status?.classList.contains('deeppdf-status-loading')).toBe(true);

			topNav.setStatus('connected');
			status = topNav.getElement()?.querySelector('.deeppdf-status');
			expect(status?.classList.contains('deeppdf-status-loading')).toBe(false);
			expect(status?.classList.contains('deeppdf-status-ok')).toBe(true);
		});
	});

	describe('索引列表管理', () => {
		const mockIndexes: IndexListItem[] = [
			{ id: 'idx1', pdf_name: 'Document 1', node_count: 100, created_at: '2024-01-01' },
			{ id: 'idx2', pdf_name: 'Document 2', node_count: 200, created_at: '2024-01-02' },
			{ id: 'idx3', pdf_name: 'Document 3', node_count: 150, created_at: '2024-01-03' }
		];

		it('setIndexes 应该填充索引列表', () => {
			topNav.setIndexes(mockIndexes);

			const el = topNav.getElement();
			const indexSelect = el?.querySelector('.deeppdf-index-select') as HTMLSelectElement;

			// 包含默认选项 + 3个索引
			expect(indexSelect?.options.length).toBe(1 + mockIndexes.length);
		});

		it('索引选项应该显示正确的文本', () => {
			topNav.setIndexes(mockIndexes);

			const el = topNav.getElement();
			const indexSelect = el?.querySelector('.deeppdf-index-select') as HTMLSelectElement;

			expect(indexSelect?.options[1]?.text).toBe('Document 1 (100 节点)');
			expect(indexSelect?.options[2]?.text).toBe('Document 2 (200 节点)');
			expect(indexSelect?.options[3]?.text).toBe('Document 3 (150 节点)');
		});

		it('索引选项应该有正确的值', () => {
			topNav.setIndexes(mockIndexes);

			const el = topNav.getElement();
			const indexSelect = el?.querySelector('.deeppdf-index-select') as HTMLSelectElement;

			expect(indexSelect?.options[1]?.value).toBe('idx1');
			expect(indexSelect?.options[2]?.value).toBe('idx2');
			expect(indexSelect?.options[3]?.value).toBe('idx3');
		});

		it('空索引列表应该显示"暂无索引"', () => {
			topNav.setIndexes([]);

			const el = topNav.getElement();
			const indexSelect = el?.querySelector('.deeppdf-index-select') as HTMLSelectElement;

			expect(indexSelect?.options.length).toBe(1);
			expect(indexSelect?.options[0]?.value).toBe('');
		});

		it('undefined 索引列表应该显示"暂无索引"', () => {
			topNav.setIndexes(undefined as any);

			const el = topNav.getElement();
			const indexSelect = el?.querySelector('.deeppdf-index-select') as HTMLSelectElement;

			expect(indexSelect?.options.length).toBe(1);
			expect(indexSelect?.options[0]?.value).toBe('');
		});
	});

	describe('索引选择', () => {
		const mockIndexes: IndexListItem[] = [
			{ id: 'idx1', pdf_name: 'Document 1', node_count: 100 },
			{ id: 'idx2', pdf_name: 'Document 2', node_count: 200 }
		];

		it('setSelectedIndex 应该设置选中的索引', () => {
			topNav.setIndexes(mockIndexes);
			topNav.setSelectedIndex('idx2');

			const el = topNav.getElement();
			const indexSelect = el?.querySelector('.deeppdf-index-select') as HTMLSelectElement;

			expect(indexSelect?.value).toBe('idx2');
		});

		it('setSelectedIndex 使用空字符串应该重置选择', () => {
			topNav.setIndexes(mockIndexes);
			topNav.setSelectedIndex('idx1');
			topNav.setSelectedIndex('');

			const el = topNav.getElement();
			const indexSelect = el?.querySelector('.deeppdf-index-select') as HTMLSelectElement;

			expect(indexSelect?.value).toBe('');
		});

		it('setSelectedIndex 使用不存在的 ID 不应该改变选择', () => {
			topNav.setIndexes(mockIndexes);
			topNav.setSelectedIndex('idx1');
			topNav.setSelectedIndex('nonexistent');

			const el = topNav.getElement();
			const indexSelect = el?.querySelector('.deeppdf-index-select') as HTMLSelectElement;

			expect(indexSelect?.value).toBe('idx1');
		});

		it('getSelectedIndex 应该返回当前选中的索引 ID', () => {
			topNav.setIndexes(mockIndexes);
			topNav.setSelectedIndex('idx2');

			expect(topNav.getSelectedIndex()).toBe('idx2');
		});

		it('未选择时 getSelectedIndex 应该返回空字符串', () => {
			expect(topNav.getSelectedIndex()).toBe('');
		});

		it('getSelectedIndexText 应该返回当前选中的索引文本', () => {
			topNav.setIndexes(mockIndexes);
			topNav.setSelectedIndex('idx1');

			expect(topNav.getSelectedIndexText()).toBe('Document 1 (100 节点)');
		});

		it('选择索引应该触发 onIndexChange 回调', () => {
			topNav.setIndexes(mockIndexes);

			const el = topNav.getElement();
			const indexSelect = el?.querySelector('.deeppdf-index-select') as HTMLSelectElement;

			indexSelect.value = 'idx2';
			indexSelect.dispatchEvent(new Event('change'));

			expect(mockOnIndexChange).toHaveBeenCalledWith('idx2');
		});

		it('选择空选项不应该触发 onIndexChange 回调', () => {
			topNav.setIndexes(mockIndexes);

			const el = topNav.getElement();
			const indexSelect = el?.querySelector('.deeppdf-index-select') as HTMLSelectElement;

			indexSelect.value = '';
			indexSelect.dispatchEvent(new Event('change'));

			expect(mockOnIndexChange).not.toHaveBeenCalled();
		});

		it('setIndexes 应该保持之前选中的索引（如果仍存在）', () => {
			topNav.setIndexes(mockIndexes);
			topNav.setSelectedIndex('idx2');

			// 更新索引列表（但保留 idx2）
			const updatedIndexes = [
				{ id: 'idx2', pdf_name: 'Document 2 Updated', node_count: 250 },
				{ id: 'idx3', pdf_name: 'Document 3', node_count: 150 }
			];
			topNav.setIndexes(updatedIndexes);

			expect(topNav.getSelectedIndex()).toBe('idx2');
		});

		it('setIndexes 如果之前选中的索引不存在应该重置选择', () => {
			topNav.setIndexes(mockIndexes);
			topNav.setSelectedIndex('idx1');

			// 更新索引列表（移除 idx1）
			const updatedIndexes = [
				{ id: 'idx3', pdf_name: 'Document 3', node_count: 150 }
			];
			topNav.setIndexes(updatedIndexes);

			expect(topNav.getSelectedIndex()).toBe('');
		});
	});

	describe('按钮交互', () => {
		it('点击管理索引按钮应该触发 onManageIndexes 回调', () => {
			const el = topNav.getElement();
			const manageBtn = el?.querySelector('.deeppdf-manage-btn') as HTMLButtonElement;

			manageBtn.click();

			expect(mockOnManageIndexes).toHaveBeenCalled();
		});

		it('setIndexSelectDisabled(true) 应该禁用索引选择器', () => {
			topNav.setIndexSelectDisabled(true);

			const el = topNav.getElement();
			const indexSelect = el?.querySelector('.deeppdf-index-select') as HTMLSelectElement;

			expect(indexSelect?.disabled).toBe(true);
		});

		it('setIndexSelectDisabled(false) 应该启用索引选择器', () => {
			topNav.setIndexSelectDisabled(true);
			topNav.setIndexSelectDisabled(false);

			const el = topNav.getElement();
			const indexSelect = el?.querySelector('.deeppdf-index-select') as HTMLSelectElement;

			expect(indexSelect?.disabled).toBe(false);
		});

		it('setManageButtonDisabled(true) 应该禁用管理按钮', () => {
			topNav.setManageButtonDisabled(true);

			const el = topNav.getElement();
			const manageBtn = el?.querySelector('.deeppdf-manage-btn') as HTMLButtonElement;

			expect(manageBtn?.disabled).toBe(true);
		});

		it('setManageButtonDisabled(false) 应该启用管理按钮', () => {
			topNav.setManageButtonDisabled(true);
			topNav.setManageButtonDisabled(false);

			const el = topNav.getElement();
			const manageBtn = el?.querySelector('.deeppdf-manage-btn') as HTMLButtonElement;

			expect(manageBtn?.disabled).toBe(false);
		});
	});

	describe('设置按钮（可选）', () => {
		it('showSettings=true 且提供 onSettings 时应该渲染设置按钮', () => {
			topNav.destroy();

			const topNavWithSettings = new TopNav({
				onIndexChange: mockOnIndexChange,
				onManageIndexes: mockOnManageIndexes,
				showSettings: true,
				onSettings: mockOnSettings
			});

			container.appendChild(topNavWithSettings.getElement()!);

			const el = topNavWithSettings.getElement();
			const settingsBtn = el?.querySelector('.deeppdf-btn-icon[aria-label="设置"]');

			expect(settingsBtn).toBeTruthy();

			topNavWithSettings.destroy();
		});

		it('点击设置按钮应该触发 onSettings 回调', () => {
			topNav.destroy();

			const topNavWithSettings = new TopNav({
				onIndexChange: mockOnIndexChange,
				onManageIndexes: mockOnManageIndexes,
				showSettings: true,
				onSettings: mockOnSettings
			});

			container.appendChild(topNavWithSettings.getElement()!);

			const el = topNavWithSettings.getElement();
			const settingsBtn = el?.querySelector('.deeppdf-btn-icon[aria-label="设置"]') as HTMLButtonElement;

			settingsBtn.click();

			expect(mockOnSettings).toHaveBeenCalled();

			topNavWithSettings.destroy();
		});

		it('showSettings=false 时不应该渲染设置按钮', () => {
			const el = topNav.getElement();
			const settingsBtn = el?.querySelector('.deeppdf-btn-icon[aria-label="设置"]');

			expect(settingsBtn).toBeFalsy();
		});

		it('showSettings=true 但没有提供 onSettings 时不应该渲染设置按钮', () => {
			topNav.destroy();

			const topNavWithSettings = new TopNav({
				onIndexChange: mockOnIndexChange,
				onManageIndexes: mockOnManageIndexes,
				showSettings: true
			});

			container.appendChild(topNavWithSettings.getElement()!);

			const el = topNavWithSettings.getElement();
			const settingsBtn = el?.querySelector('.deeppdf-btn-icon[aria-label="设置"]');

			expect(settingsBtn).toBeFalsy();

			topNavWithSettings.destroy();
		});
	});

	describe('销毁', () => {
		it('destroy 应该移除 DOM 元素', () => {
			const el = topNav.getElement();
			expect(el?.parentNode).toBeTruthy();

			topNav.destroy();

			expect(el?.parentNode).toBeNull();
		});

		it('销毁后应该清理事件监听器', () => {
			topNav.destroy();

			// 尝试触发事件不应该调用回调
			const el = topNav.getElement();
			const indexSelect = el?.querySelector('.deeppdf-index-select') as HTMLSelectElement;

			if (indexSelect) {
				indexSelect.value = 'idx1';
				indexSelect.dispatchEvent(new Event('change'));
			}

			expect(mockOnIndexChange).not.toHaveBeenCalled();
		});
	});

	describe('边界情况', () => {
		it('多次调用 setStatus 应该正确更新状态', () => {
			topNav.setStatus('loading');
			topNav.setStatus('connected');
			topNav.setStatus('error');
			topNav.setStatus('disconnected');

			const el = topNav.getElement();
			const status = el?.querySelector('.deeppdf-status');

			expect(status?.classList.contains('deeppdf-status-warning')).toBe(true);
			expect(status?.classList.contains('deeppdf-status-ok')).toBe(false);
		});

		it('多次调用 setIndexes 应该正确更新列表', () => {
			const indexes1: IndexListItem[] = [
				{ id: 'idx1', pdf_name: 'Doc 1', node_count: 100 }
			];
			const indexes2: IndexListItem[] = [
				{ id: 'idx2', pdf_name: 'Doc 2', node_count: 200 },
				{ id: 'idx3', pdf_name: 'Doc 3', node_count: 300 }
			];

			topNav.setIndexes(indexes1);
			topNav.setIndexes(indexes2);

			const el = topNav.getElement();
			const indexSelect = el?.querySelector('.deeppdf-index-select') as HTMLSelectElement;

			expect(indexSelect?.options.length).toBe(1 + indexes2.length);
		});

		it('在没有设置索引的情况下 setSelectedIndex 不应该抛出错误', () => {
			expect(() => {
				topNav.setSelectedIndex('idx1');
			}).not.toThrow();
		});

		it('在销毁后调用方法不应该抛出错误', () => {
			topNav.destroy();

			expect(() => {
				topNav.setStatus('connected');
				topNav.setIndexes([]);
				topNav.setSelectedIndex('');
				topNav.getSelectedIndex();
				topNav.getSelectedIndexText();
			}).not.toThrow();
		});
	});

	describe('可访问性', () => {
		it('管理按钮应该有正确的文本标签', () => {
			const el = topNav.getElement();
			const manageBtn = el?.querySelector('.deeppdf-manage-btn') as HTMLButtonElement;

			expect(manageBtn?.textContent).toContain('管理索引');
		});

		it('设置按钮应该有 aria-label（如果渲染）', () => {
			topNav.destroy();

			const topNavWithSettings = new TopNav({
				showSettings: true,
				onSettings: mockOnSettings
			});

			container.appendChild(topNavWithSettings.getElement()!);

			const el = topNavWithSettings.getElement();
			const settingsBtn = el?.querySelector('.deeppdf-btn-icon');

			expect(settingsBtn?.getAttribute('aria-label')).toBe('设置');

			topNavWithSettings.destroy();
		});

		it('索引选择器应该可以通过键盘操作', () => {
			const el = topNav.getElement();
			const indexSelect = el?.querySelector('.deeppdf-index-select') as HTMLSelectElement;

			indexSelect.focus();
			expect(document.activeElement).toBe(indexSelect);
		});

		it('所有按钮应该可以通过 Tab 键访问', () => {
			const el = topNav.getElement();
			const buttons = el?.querySelectorAll('button');

			buttons?.forEach(button => {
				expect(button.tabIndex).not.toBe(-1);
			});
		});
	});
});
