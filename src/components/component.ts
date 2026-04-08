/**
 * DeepPDF 基础组件类
 * 所有 UI 组件的抽象基类
 */

export abstract class Component {
    protected el: HTMLElement | null = null;

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
     * 销毁组件
     */
    destroy(): void {
        if (this.el && this.el.parentNode) {
            this.el.parentNode.removeChild(this.el);
        }
        this.el = null;
    }
}
