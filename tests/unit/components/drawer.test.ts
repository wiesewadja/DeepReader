/**
 * Drawer 组件测试
 * 测试抽屉面板的基本功能
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Drawer } from '@/components/drawer/drawer';

describe('Drawer 组件', () => {
    let container: HTMLElement;
    let drawer: Drawer;

    beforeEach(() => {
        // 创建测试容器
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(() => {
        // 清理
        if (drawer) {
            const el = drawer.getElement();
            if (el) el.remove();
        }
        container.remove();
    });

    describe('基础渲染', () => {
        it('应该正确渲染抽屉组件', () => {
            drawer = new Drawer({
                position: 'right',
                width: '400px',
                overlay: true
            });

            const el = drawer.render();
            container.appendChild(el);

            // 验证容器元素
            expect(el).toBeTruthy();
            expect(el.classList.contains('deeppdf-drawer-container')).toBe(true);
        });

        it('应该包含遮罩层和内容区', () => {
            drawer = new Drawer({
                position: 'right',
                width: '400px',
                overlay: true
            });

            const el = drawer.render();
            container.appendChild(el);

            // 验证遮罩层
            const overlay = el.querySelector('.deeppdf-drawer-overlay');
            expect(overlay).toBeTruthy();

            // 验证抽屉内容区
            const content = el.querySelector('.deeppdf-drawer');
            expect(content).toBeTruthy();
        });

        it('应该应用正确的位置类名', () => {
            drawer = new Drawer({
                position: 'right',
                width: '400px',
                overlay: true
            });

            const el = drawer.render();
            container.appendChild(el);

            const drawerContent = el.querySelector('.deeppdf-drawer');
            expect(drawerContent?.classList.contains('deeppdf-drawer-right')).toBe(true);
        });

        it('应该应用自定义宽度', () => {
            drawer = new Drawer({
                position: 'left',
                width: '300px',
                overlay: true
            });

            const el = drawer.render();
            container.appendChild(el);

            const drawerContent = el.querySelector('.deeppdf-drawer');
            expect(drawerContent?.style.width).toBe('300px');
        });
    });

    describe('打开/关闭功能', () => {
        beforeEach(() => {
            drawer = new Drawer({
                position: 'right',
                width: '400px',
                overlay: true
            });

            const el = drawer.render();
            container.appendChild(el);
        });

        it('应该正确打开抽屉', () => {
            drawer.open();

            const overlay = container.querySelector('.deeppdf-drawer-overlay');
            const content = container.querySelector('.deeppdf-drawer');

            expect(overlay?.classList.contains('deeppdf-drawer-overlay-open')).toBe(true);
            expect(content?.classList.contains('deeppdf-drawer-open')).toBe(true);
        });

        it('应该正确关闭抽屉', () => {
            drawer.open();
            drawer.close();

            const overlay = container.querySelector('.deeppdf-drawer-overlay');
            const content = container.querySelector('.deeppdf-drawer');

            expect(overlay?.classList.contains('deeppdf-drawer-overlay-open')).toBe(false);
            expect(content?.classList.contains('deeppdf-drawer-open')).toBe(false);
        });

        it('应该正确切换抽屉状态', () => {
            drawer.toggle();

            const overlay = container.querySelector('.deeppdf-drawer-overlay');
            expect(overlay?.classList.contains('deeppdf-drawer-overlay-open')).toBe(true);

            drawer.toggle();

            expect(overlay?.classList.contains('deeppdf-drawer-overlay-open')).toBe(false);
        });
    });

    describe('内容设置', () => {
        beforeEach(() => {
            drawer = new Drawer({
                position: 'right',
                width: '400px',
                overlay: true
            });

            const el = drawer.render();
            container.appendChild(el);
        });

        it('应该支持设置 HTML 字符串内容', () => {
            drawer.setContent('<div class="test-content">测试内容</div>');

            const contentEl = container.querySelector('.deeppdf-drawer');
            const testContent = contentEl?.querySelector('.test-content');

            expect(testContent).toBeTruthy();
            expect(testContent?.textContent).toBe('测试内容');
        });

        it('应该支持设置 DOM 元素内容', () => {
            const div = document.createElement('div');
            div.className = 'test-dom';
            div.textContent = 'DOM 内容';

            drawer.setContent(div);

            const contentEl = container.querySelector('.deeppdf-drawer');
            const testContent = contentEl?.querySelector('.test-dom');

            expect(testContent).toBeTruthy();
            expect(testContent?.textContent).toBe('DOM 内容');
        });

        it('应该支持替换已有内容', () => {
            drawer.setContent('<div class="first">第一次</div>');

            drawer.setContent('<div class="second">第二次</div>');

            const contentEl = container.querySelector('.deeppdf-drawer');
            const first = contentEl?.querySelector('.first');
            const second = contentEl?.querySelector('.second');

            expect(first).toBeFalsy();
            expect(second).toBeTruthy();
        });
    });

    describe('遮罩层交互', () => {
        it('点击遮罩层应该关闭抽屉', () => {
            drawer = new Drawer({
                position: 'right',
                width: '400px',
                overlay: true
            });

            const el = drawer.render();
            container.appendChild(el);
            drawer.open();

            // 模拟点击遮罩层
            const overlay = container.querySelector('.deeppdf-drawer-overlay') as HTMLElement;
            overlay?.click();

            // 验证抽屉已关闭
            expect(overlay?.classList.contains('deeppdf-drawer-overlay-open')).toBe(false);
        });
    });

    describe('内容区访问', () => {
        it('应该返回内容区元素', () => {
            drawer = new Drawer({
                position: 'right',
                width: '400px',
                overlay: true
            });

            const el = drawer.render();
            container.appendChild(el);

            const contentEl = drawer.getContentEl();
            expect(contentEl).toBeTruthy();
            expect(contentEl?.classList.contains('deeppdf-drawer')).toBe(true);
        });

        it('内容区未渲染时应返回 null', () => {
            drawer = new Drawer({
                position: 'right',
                width: '400px',
                overlay: true
            });

            // 不调用 render，直接获取内容区
            const contentEl = drawer.getContentEl();
            expect(contentEl).toBeNull();
        });
    });

    describe('不同位置配置', () => {
        it('左侧抽屉应该有正确的类名', () => {
            drawer = new Drawer({
                position: 'left',
                width: '300px',
                overlay: true
            });

            const el = drawer.render();
            container.appendChild(el);

            const drawerContent = el.querySelector('.deeppdf-drawer');
            expect(drawerContent?.classList.contains('deeppdf-drawer-left')).toBe(true);
        });

        it('右侧抽屉应该有正确的类名', () => {
            drawer = new Drawer({
                position: 'right',
                width: '300px',
                overlay: true
            });

            const el = drawer.render();
            container.appendChild(el);

            const drawerContent = el.querySelector('.deeppdf-drawer');
            expect(drawerContent?.classList.contains('deeppdf-drawer-right')).toBe(true);
        });
    });
});
