/**
 * DeepPDF 基础组件类
 * 所有 UI 组件的抽象基类
 *
 * 能力（增量式加入）：
 *  - 渲染 / 根元素访问
 *  - listener 注册表 + 自动清理（防止内存泄漏 / 多实例干扰）
 *  - 幂等的 destroy()
 *
 * 设计约束：
 *  - 保留对原生 addEventListener 的直接调用（不破坏现有代码）
 *  - 只有通过 this.on() 注册的监听器会被自动清理
 *  - 同 (target, type, handler) 重复 on() 是幂等的（去重）
 *  - destroy() 幂等：可多次调用
 *  - 父类状态（listener 注册表）在子类可以继承并复用
 */

type Listener = {
    target: EventTarget;
    type: string;
    handler: EventListener;
};

export abstract class Component {
    protected el: HTMLElement | null = null;
    /** 通过 this.on() 注册的监听器，destroy() 时统一清理 */
    private listeners: Listener[] = [];
    /** destroy() 幂等：防止重复清理导致状态错乱 */
    private destroyed: boolean = false;

    /**
     * 渲染组件并返回根元素
     */
    abstract render(): HTMLElement;

    /**
     * 获取组件的根元素
     */
    getElement(): HTMLElement | null {
        return this.el;
    }

    /**
     * 注册一个监听器，在 destroy() 时自动 removeEventListener。
     *
     * 优势 vs 直接 target.addEventListener()：
     *  - 防止内存泄漏：组件销毁时自动清理
     *  - 防止多实例 listener 堆积：同名 (target, type, handler) 幂等
     *
     * @example
     *   this.on(button, 'click', () => { ... });
     *   this.on(window, 'resize', this.handleResize);
     */
    on(target: EventTarget, type: string, handler: EventListener): void {
        // 幂等检查：同一 (target, type, handler) 不重复添加
        const exists = this.listeners.some(
            (l) => l.target === target && l.type === type && l.handler === handler,
        );
        if (exists) {
            return;
        }
        this.listeners.push({ target, type, handler });
        target.addEventListener(type, handler);
    }

    /**
     * 销毁组件
     *  - 清理所有 this.on() 注册的监听器
     *  - 移除根元素
     *  - 幂等：可多次调用
     */
    destroy(): void {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;

        // 清理监听器（removeEventListener 对不存在的 listener 是 no-op，
        // 所以 target detached 也不会抛错）
        for (const { target, type, handler } of this.listeners) {
            target.removeEventListener(type, handler);
        }
        this.listeners = [];

        if (this.el && this.el.parentNode) {
            this.el.parentNode.removeChild(this.el);
        }
        this.el = null;
    }
}
