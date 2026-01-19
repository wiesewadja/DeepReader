/**
 * 全局类型声明
 * 扩展 DOM 类型以支持 Obsidian API
 */

import { CitationData } from './components/message/message';

/**
 * Obsidian 对 HTMLElement 的扩展
 */
declare global {
    interface HTMLElement {
        /**
         * 添加一个或多个 CSS 类
         */
        addClass(...classes: string[]): void;

        /**
         * 添加多个 CSS 类
         */
        addClasses(classes: string[]): void;

        /**
         * 移除一个或多个 CSS 类
         */
        removeClass(...classes: string[]): void;

        /**
         * 移除多个 CSS 类
         */
        removeClasses(classes: string[]): void;

        /**
         * 切换 CSS 类
         */
        toggleClass(classes: string | string[], value: boolean): void;

        /**
         * 检查是否有指定的 CSS 类
         */
        hasClass(cls: string): boolean;

        /**
         * 设置属性
         */
        setAttr(qualifiedName: string, value: string | number | boolean | null): void;

        /**
         * 设置多个属性
         */
        setAttrs(obj: { [key: string]: string | number | boolean | null }): void;

        /**
         * 获取属性值
         */
        getAttr(qualifiedName: string): string | null;

        /**
         * 显示元素
         */
        show(): void;

        /**
         * 隐藏元素
         */
        hide(): void;

        /**
         * 切换显示状态
         */
        toggle(show: boolean): void;
    }

    interface HTMLDivElement {
        /**
         * 创建子元素
         */
        createEl<K extends keyof HTMLElementTagNameMap>(
            tag: K,
            options?: { cls?: string | string[], text?: string, attr?: { [key: string]: string | number | boolean | null } }
        ): HTMLElementTagNameMap[K];

        createEl(
            tag: string,
            options?: { cls?: string | string[], text?: string, attr?: { [key: string]: string | number | boolean | null } }
        ): HTMLElement;
    }

    interface HTMLElement {
        /**
         * 创建子元素
         */
        createEl<K extends keyof HTMLElementTagNameMap>(
            tag: K,
            options?: { cls?: string | string[], text?: string, attr?: { [key: string]: string | number | boolean | null } }
        ): HTMLElementTagNameMap[K];

        createEl(
            tag: string,
            options?: { cls?: string | string[], text?: string, attr?: { [key: string]: string | number | boolean | null } }
        ): HTMLElement;
    }

    interface HTMLSpanElement {
        /**
         * 创建子元素
         */
        createEl<K extends keyof HTMLElementTagNameMap>(
            tag: K,
            options?: { cls?: string | string[], text?: string, attr?: { [key: string]: string | number | boolean | null } }
        ): HTMLElementTagNameMap[K];

        createEl(
            tag: string,
            options?: { cls?: string | string[], text?: string, attr?: { [key: string]: string | number | boolean | null } }
        ): HTMLElement;
    }

    interface Node {
        /**
         * 清空节点的所有子元素
         */
        empty(): void;

        /**
         * 在指定子节点后插入新节点
         */
        insertAfter<T extends Node>(node: T, child: Node | null): T;

        /**
         * 获取节点的索引
         */
        indexOf(other: Node): number;

        /**
         * 设置子节点
         */
        setChildrenInPlace(children: Node[]): void;

        /**
         * 附加文本内容
         */
        appendText(val: string): void;

        /**
         * 分离节点（从父节点移除）
         */
        detach(): void;
    }

    interface Array<T> {
        /**
         * 获取第一个元素
         */
        first(): T | undefined;

        /**
         * 获取最后一个元素
         */
        last(): T | undefined;

        /**
         * 检查数组是否包含指定元素
         */
        contains(target: T): boolean;

        /**
         * 移除指定元素
         */
        remove(target: T): void;

        /**
         * 随机打乱数组
         */
        shuffle(): this;

        /**
         * 去重
         */
        unique(): T[];

        /**
         * 查找最后一个匹配的索引
         */
        findLastIndex(predicate: (value: T) => boolean): number;
    }

    interface String {
        /**
         * 检查字符串是否包含指定子串
         */
        contains(target: string): boolean;
    }

    interface ObjectConstructor {
        /**
         * 检查对象是否为空
         */
        isEmpty(object: Record<string, any>): boolean;

        /**
         * 遍历对象
         */
        each<T>(object: { [key: string]: T }, callback: (value: T, key?: string) => boolean | void, context?: any): boolean;
    }

    interface Math {
        /**
         * 限制数值在指定范围内
         */
        clamp(value: number, min: number, max: number): number;

        /**
         * 计算平方
         */
        square(value: number): number;
    }

    interface StringConstructor {
        /**
         * 检查值是否为字符串
         */
        isString(obj: any): obj is string;
    }

    interface NumberConstructor {
        /**
         * 检查值是否为数字
         */
        isNumber(obj: any): obj is number;
    }

    interface ArrayConstructor {
        /**
         * 合并多个数组
         */
        combine<T>(arrays: T[][]): T[];
    }
}

export {};
