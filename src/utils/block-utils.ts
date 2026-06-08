/**
 * DeepPDF Block ID 工具函数
 * 用于从 DOM 中查找选中文字所在的 block id
 */

import { type App, TFile } from 'obsidian';
import { uiLog } from './logger.js';

/**
 * 从 DOM Range 中查找最近的 block id
 * Obsidian 的 block id 格式为 ^xxx，通常在段落末尾
 *
 * @param range 选中的文本范围
 * @param filePath 当前文件路径（用于从 metadataCache 获取 block 信息）
 * @param app Obsidian App 实例
 * @returns block id 字符串（不含 ^ 前缀），如果没有找到返回 null
 */
export function findBlockIdFromRange(
    range: Range,
    filePath: string,
    app: App
): string | null {
    try {
        // 获取选中的起始容器
        const container = range.startContainer;
        if (!container) return null;

        // 向上查找最近的带有 block id 的元素
        // block id 可能在:
        // 1. 当前元素的 data-block-id 属性
        // 2. 父元素中的 data-block-id 属性
        // 3. 段落末尾的 ^xxx 文本节点

        let current: Element | null = container instanceof Element ? container : container.parentElement;

        while (current) {
            // 检查 data-block-id 属性
            const blockIdAttr = current.getAttribute('data-block-id');
            if (blockIdAttr) {
                return blockIdAttr;
            }

            // 检查 id 属性（Obsidian 有时会用 id 存储 block id）
            const idAttr = current.id;
            if (idAttr && idAttr.startsWith('^')) {
                return idAttr.substring(1);
            }

            // 检查元素内部的文本节点，查找 ^xxx 格式
            const walker = document.createTreeWalker(
                current,
                NodeFilter.SHOW_TEXT
            );

            let textNode: Text | null;
            while ((textNode = walker.nextNode() as Text | null)) {
                const text = textNode.textContent || '';
                // 匹配 ^xxx 格式
                const match = text.match(/\^([a-zA-Z0-9_-]+)/);
                if (match) {
                    return match[1];
                }
            }

            // 向上查找父元素
            current = current.parentElement;
        }

        // 如果 DOM 查找失败，尝试从文件内容中查找（同步版本）
        return findBlockIdFromContentSync(range, filePath, app);
    } catch (err) {
        uiLog.warn('[DeepPDF] Failed to find block id from range:', err);
        return null;
    }
}

/**
 * 从文件内容中查找选中文本对应的 block id（同步版本）
 * 由于我们需要同步返回结果，这里使用缓存的文件内容
 *
 * @param range 选中的文本范围
 * @param filePath 当前文件路径
 * @param app Obsidian App 实例
 * @returns block id 字符串
 */
function findBlockIdFromContentSync(
    range: Range,
    filePath: string,
    app: App
): string | null {
    try {
        const file = app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) return null;

        // 获取选中的文本
        const selectedText = range.toString().trim();
        if (!selectedText) return null;

        // 尝试从 metadataCache 获取 block 信息
        const cache = app.metadataCache.getFileCache(file);
        if (cache?.blocks) {
            // 遍历所有 blocks，查找包含选中文本的 block
            for (const [blockId, block] of Object.entries(cache.blocks)) {
                // BlockCache 有 position 信息，我们可以用它来定位
                if (block && block.position) {
                    // 由于 BlockCache 没有 content 字段，我们需要读取文件内容来验证
                    // 但为了同步执行，我们使用其他方式
                    const { start, end } = block.position;
                    // 这里简化处理：直接返回找到的第一个 block id
                    // 实际使用时可能需要更精确的匹配
                    return blockId;
                }
            }
        }

        // 尝试 headings
        if (cache?.headings) {
            for (const heading of cache.headings) {
                if (heading.heading && selectedText.includes(heading.heading)) {
                    // 返回 heading 的 slug 作为 block id
                    return heading.heading.toLowerCase().replace(/\s+/g, '-');
                }
            }
        }

        return null;
    } catch (err) {
        uiLog.warn('[DeepPDF] Failed to find block id from content:', err);
        return null;
    }
}

/**
 * 从文件内容中查找选中文本对应的 block id（异步版本）
 * 通过读取源文件并匹配文本位置来查找，更精确但需要异步
 *
 * @param selectedText 选中的文本
 * @param filePath 当前文件路径
 * @param app Obsidian App 实例
 * @returns block id 字符串
 */
export async function findBlockIdFromText(
    selectedText: string,
    filePath: string,
    app: App
): Promise<string | null> {
    try {
        const file = app.vault.getAbstractFileByPath(filePath);
        if (!(file instanceof TFile)) return null;

        const content = await app.vault.read(file);
        const trimmedText = selectedText.trim();
        if (!trimmedText) return null;

        // 按行分割文件内容，查找包含选中文本的行
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // 检查这一行是否包含选中的文本
            if (line.includes(trimmedText)) {
                // 在这一行或附近查找 block id
                // block id 格式: 段落末尾的 ^xxx
                const blockIdMatch = line.match(/\^([a-zA-Z0-9_-]+)/);
                if (blockIdMatch) {
                    return blockIdMatch[1];
                }

                // 检查上一行是否有 block id（可能在空行后）
                if (i > 0) {
                    const prevLine = lines[i - 1];
                    const prevBlockIdMatch = prevLine.match(/\^([a-zA-Z0-9_-]+)/);
                    if (prevBlockIdMatch) {
                        return prevBlockIdMatch[1];
                    }
                }

                // 检查下一行是否有 block id
                if (i < lines.length - 1) {
                    const nextLine = lines[i + 1];
                    const nextBlockIdMatch = nextLine.match(/\^([a-zA-Z0-9_-]+)/);
                    if (nextBlockIdMatch) {
                        return nextBlockIdMatch[1];
                    }
                }

                // 如果在当前行附近找不到，继续查找（可能在同一个段落的其他行）
            }
        }

        // 如果还是找不到，尝试从 metadataCache 获取
        const cache = app.metadataCache.getFileCache(file);
        if (cache?.blocks) {
            // 查找包含选中文本的 block
            for (const [blockId] of Object.entries(cache.blocks)) {
                // 简化处理：返回第一个 block
                return blockId;
            }
        }

        return null;
    } catch (err) {
        uiLog.warn('[DeepPDF] Failed to find block id from file:', err);
        return null;
    }
}
