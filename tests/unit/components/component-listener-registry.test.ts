/**
 * Component 基类 — listener 注册表 + 自动清理
 *
 * 目标不变量：
 *  1. this.on(target, type, handler) 注册监听器，handler 被调用
 *  2. destroy() 后所有 on() 注册的监听器被自动 removeEventListener
 *  3. 多次注册同一 target+type+handler 是幂等的（不重复 addEventListener）
 *  4. 直接调用 target.addEventListener()（不通过 on()）— 不被注册表追踪
 *     （不破坏现有代码；只是该监听器不会自动清理）
 *  5. 同一 listener 可以注册到多个 target
 *  6. destroy() 幂等：可多次调用
 *  7. listener 在 target 被 detach 后仍能被 removeEventListener 不抛错
 *     （removeEventListener 对不存在的 listener 是 no-op）
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Component } from '@/components/component';

class TestComponent extends Component {
    constructor() {
        super();
        this.el = document.createElement('div');
        document.body.appendChild(this.el);
    }
    render(): HTMLElement {
        return this.el!;
    }
}

describe('Component — listener 注册表 + 自动清理', () => {
    let comp: TestComponent;
    let target: HTMLElement;

    beforeEach(() => {
        comp = new TestComponent();
        target = document.createElement('button');
        comp.el!.appendChild(target);
    });

    describe('invariant 1 — on() 注册监听器', () => {
        it('on() 注册后 handler 被触发', () => {
            const handler = vi.fn();
            comp.on(target, 'click', handler);
            target.click();
            expect(handler).toHaveBeenCalledTimes(1);
        });

        it('多次 on() 同一事件可注册多个 handler', () => {
            const h1 = vi.fn();
            const h2 = vi.fn();
            comp.on(target, 'click', h1);
            comp.on(target, 'click', h2);
            target.click();
            expect(h1).toHaveBeenCalledTimes(1);
            expect(h2).toHaveBeenCalledTimes(1);
        });
    });

    describe('invariant 2 — destroy() 自动清理', () => {
        it('destroy() 后 on() 注册的 handler 不再触发', () => {
            const handler = vi.fn();
            comp.on(target, 'click', handler);
            comp.destroy();
            target.click();
            expect(handler).not.toHaveBeenCalled();
        });

        it('destroy() 清理所有 on() 注册的监听器（多 target 多 event）', () => {
            const h1 = vi.fn();
            const h2 = vi.fn();
            const h3 = vi.fn();
            const t2 = document.createElement('div');
            comp.el!.appendChild(t2);

            comp.on(target, 'click', h1);
            comp.on(target, 'mouseenter', h2);
            comp.on(t2, 'click', h3);

            comp.destroy();
            target.click();
            target.dispatchEvent(new MouseEvent('mouseenter'));
            t2.click();

            expect(h1).not.toHaveBeenCalled();
            expect(h2).not.toHaveBeenCalled();
            expect(h3).not.toHaveBeenCalled();
        });

        it('destroy() 保留基类 el 清理行为（remove from parent）', () => {
            const parent = comp.el!.parentElement!;
            expect(parent.contains(comp.el)).toBe(true);
            comp.destroy();
            expect(parent.contains(comp.el)).toBe(false);
        });
    });

    describe('invariant 3 — 幂等注册（同名 listener 不重复添加）', () => {
        it('同一 target+type+handler 注册两次：handler 只触发一次（防止 listener 堆积）', () => {
            const handler = vi.fn();
            comp.on(target, 'click', handler);
            comp.on(target, 'click', handler); // 重复
            target.click();
            expect(handler).toHaveBeenCalledTimes(1);
        });
    });

    describe('invariant 4 — 直接 addEventListener 不被追踪', () => {
        it('target.addEventListener 注册的 handler 不会被 destroy() 清理（已知边界）', () => {
            const handler = vi.fn();
            target.addEventListener('click', handler); // 不通过 on()
            comp.destroy();
            // handler 仍能触发（未被清理）
            target.click();
            expect(handler).toHaveBeenCalled();
        });
    });

    describe('invariant 5 — 跨多 target 同一 handler', () => {
        it('同一 handler 注册到两个 target，destroy 清理两个', () => {
            const handler = vi.fn();
            const t2 = document.createElement('div');
            comp.el!.appendChild(t2);
            comp.on(target, 'click', handler);
            comp.on(t2, 'click', handler);

            comp.destroy();
            target.click();
            t2.click();
            expect(handler).not.toHaveBeenCalled();
        });
    });

    describe('invariant 6 — destroy 幂等', () => {
        it('多次调用 destroy() 不抛错', () => {
            comp.on(target, 'click', vi.fn());
            comp.destroy();
            expect(() => comp.destroy()).not.toThrow();
            expect(() => comp.destroy()).not.toThrow();
        });
    });

    describe('invariant 7 — target detached 后仍能清理', () => {
        it('target 从 DOM 移除后，destroy 仍能 removeEventListener 不抛错', () => {
            const handler = vi.fn();
            comp.on(target, 'click', handler);
            target.remove();
            expect(() => comp.destroy()).not.toThrow();
        });
    });
});
