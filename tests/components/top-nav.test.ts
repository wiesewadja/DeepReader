/**
 * TopNav 组件测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TopNav, ConnectionStatus } from '../../src/components/top-nav/top-nav';

describe('TopNav', () => {
	let topNav: TopNav;
	let container: HTMLElement;
	const mockOnSettings = vi.fn();
	const mockOnTitleClick = vi.fn();

	beforeEach(() => {
		container = document.createElement('div');
		document.body.appendChild(container);

		topNav = new TopNav({
			onSettings: mockOnSettings,
			onTitleClick: mockOnTitleClick
		});

		container.appendChild(topNav.getElement()!);
	});

	afterEach(() => {
		topNav.destroy();
		container.remove();
		mockOnSettings.mockClear();
		mockOnTitleClick.mockClear();
	});

	describe('初始化', () => {
		it('应该正确渲染顶部导航组件', () => {
			const el = topNav.getElement();
			expect(el).toBeTruthy();
			expect(el?.classList.contains('deeppdf-header-minimal')).toBe(true);
		});

		it('应该渲染 Logo', () => {
			const el = topNav.getElement();
			const logo = el?.querySelector('.deeppdf-logo-icon');

			expect(logo).toBeTruthy();
			expect(logo?.innerHTML).toContain('svg');
		});

		it('应该渲染标题', () => {
			const el = topNav.getElement();
			const title = el?.querySelector('.deeppdf-header-title');

			expect(title).toBeTruthy();
			expect(title?.textContent).toBe('DeepReader');
		});

		it('应该渲染状态指示器', () => {
			const el = topNav.getElement();
			const statusIndicator = el?.querySelector('.deeppdf-status-indicator');
			const statusDot = el?.querySelector('.deeppdf-status-dot');
			const statusText = el?.querySelector('.deeppdf-status-text');

			expect(statusIndicator).toBeTruthy();
			expect(statusDot).toBeTruthy();
			expect(statusText).toBeTruthy();
		});

		it('应该渲染设置按钮', () => {
			const el = topNav.getElement();
			const settingsBtn = el?.querySelector('.deeppdf-icon-button');

			expect(settingsBtn).toBeTruthy();
			expect(settingsBtn?.tagName).toBe('BUTTON');
		});

		it('初始状态应该显示"Checking..."', () => {
			const el = topNav.getElement();
			const statusText = el?.querySelector('.deeppdf-status-text');

			expect(statusText?.textContent).toBe('Connecting...');
		});
	});

	describe('连接状态', () => {
		it('setStatus("loading") 应该显示"Checking..."状态', () => {
			topNav.setStatus('loading');

			const el = topNav.getElement();
			const statusDot = el?.querySelector('.deeppdf-status-dot');
			const statusText = el?.querySelector('.deeppdf-status-text');

			expect(statusDot?.classList.contains('status-loading')).toBe(true);
			expect(statusText?.textContent).toBe('Checking...');
		});

		it('setStatus("connected") 应该显示"Connected"状态', () => {
			topNav.setStatus('connected');

			const el = topNav.getElement();
			const statusDot = el?.querySelector('.deeppdf-status-dot');
			const statusText = el?.querySelector('.deeppdf-status-text');

			expect(statusDot?.classList.contains('status-ok')).toBe(true);
			expect(statusText?.textContent).toBe('Connected');
		});

		it('setStatus("disconnected") 应该显示"Offline"状态', () => {
			topNav.setStatus('disconnected');

			const el = topNav.getElement();
			const statusDot = el?.querySelector('.deeppdf-status-dot');
			const statusText = el?.querySelector('.deeppdf-status-text');

			expect(statusDot?.classList.contains('status-warning')).toBe(true);
			expect(statusText?.textContent).toBe('Offline');
		});

		it('setStatus("error") 应该显示"Error"状态', () => {
			topNav.setStatus('error');

			const el = topNav.getElement();
			const statusDot = el?.querySelector('.deeppdf-status-dot');
			const statusText = el?.querySelector('.deeppdf-status-text');

			expect(statusDot?.classList.contains('status-error')).toBe(true);
			expect(statusText?.textContent).toBe('Error');
		});

		it('状态切换应该正确更新样式类', () => {
			topNav.setStatus('loading');
			let statusDot = topNav.getElement()?.querySelector('.deeppdf-status-dot');
			expect(statusDot?.classList.contains('status-loading')).toBe(true);

			topNav.setStatus('connected');
			statusDot = topNav.getElement()?.querySelector('.deeppdf-status-dot');
			expect(statusDot?.classList.contains('status-loading')).toBe(false);
			expect(statusDot?.classList.contains('status-ok')).toBe(true);
		});
	});

	describe('按钮交互', () => {
		it('点击设置按钮应该触发 onSettings 回调', () => {
			const el = topNav.getElement();
			// 设置按钮是第二个按钮（第一个是新建对话按钮）
			const buttons = el?.querySelectorAll('.deeppdf-icon-button');
			const settingsBtn = buttons?.[1] as HTMLButtonElement;

			settingsBtn.click();

			expect(mockOnSettings).toHaveBeenCalled();
		});

		it('点击标题应该触发 onTitleClick 回调（如果提供）', () => {
			const el = topNav.getElement();
			const title = el?.querySelector('.deeppdf-header-title') as HTMLHeadingElement;

			title.click();

			expect(mockOnTitleClick).toHaveBeenCalled();
		});
	});

	describe('可访问性', () => {
		it('设置按钮应该有正确的 aria-label', () => {
			const el = topNav.getElement();
			// 设置按钮是第二个按钮
			const buttons = el?.querySelectorAll('.deeppdf-icon-button');
			const settingsBtn = buttons?.[1];

			expect(settingsBtn?.getAttribute('aria-label')).toBe('设置');
			expect(settingsBtn?.getAttribute('title')).toBe('设置');
		});

		it('设置按钮应该可以通过 Tab 键访问', () => {
			const el = topNav.getElement();
			const settingsBtn = el?.querySelector('.deeppdf-icon-button') as HTMLButtonElement;

			expect(settingsBtn?.tabIndex).not.toBe(-1);
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
			const settingsBtn = el?.querySelector('.deeppdf-icon-button') as HTMLButtonElement;

			if (settingsBtn) {
				settingsBtn.click();
			}

			expect(mockOnSettings).not.toHaveBeenCalled();
		});
	});

	describe('边界情况', () => {
		it('多次调用 setStatus 应该正确更新状态', () => {
			topNav.setStatus('loading');
			topNav.setStatus('connected');
			topNav.setStatus('error');
			topNav.setStatus('disconnected');

			const el = topNav.getElement();
			const statusDot = el?.querySelector('.deeppdf-status-dot');
			const statusText = el?.querySelector('.deeppdf-status-text');

			expect(statusDot?.classList.contains('status-warning')).toBe(true);
			expect(statusDot?.classList.contains('status-ok')).toBe(false);
			expect(statusText?.textContent).toBe('Offline');
		});

		it('在销毁后调用 setStatus 不应该抛出错误', () => {
			topNav.destroy();

			expect(() => {
				topNav.setStatus('connected');
			}).not.toThrow();
		});

		it('没有提供回调时点击按钮不应该抛出错误', () => {
			const navWithoutCallback = new TopNav({});
			container.appendChild(navWithoutCallback.getElement()!);

			const el = navWithoutCallback.getElement();
			const settingsBtn = el?.querySelector('.deeppdf-icon-button') as HTMLButtonElement;

			expect(() => {
				settingsBtn.click();
			}).not.toThrow();

			navWithoutCallback.destroy();
		});
	});
});
