/**
 * TTS 文本预处理器
 *
 * 将 Markdown 文本转换为纯文本，供 TTS 朗读使用。
 * 去除：Markdown 标记、wiki-link、block id、多余空白。
 */

/**
 * 去除 Markdown 标记，返回纯文本
 */
export function stripMarkdown(text: string): string {
    let result = text;
    // 去除图片 ![alt](url)
    result = result.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
    // 去除链接 [text](url) → text
    result = result.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
    // 去除加粗/斜体标记（先处理三字符再两字符再单字符）
    result = result.replace(/\*\*\*(.+?)\*\*\*/g, '$1');
    result = result.replace(/\*\*(.+?)\*\*/g, '$1');
    // 单星号斜体：要求两边各有一个 *，且不与 ** 或 *** 边界冲突
    result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '$1');
    result = result.replace(/___(.+?)___/g, '$1');
    result = result.replace(/__(.+?)__/g, '$1');
    result = result.replace(/_(.+?)_/g, '$1');
    // 去除标题标记 #
    result = result.replace(/^#{1,6}\s+/gm, '');
    // 去除无序列表标记 - or * or + at the start of a line
    result = result.replace(/^\s*[-*+]\s+/gm, '');
    // 去除有序列表标记 1. 2. at the start of a line
    result = result.replace(/^\s*\d+\.\s+/gm, '');
    // 去除水平线
    result = result.replace(/^[-*_]{3,}\s*$/gm, '');
    // 去除代码块
    result = result.replace(/```[\s\S]*?```/g, '');
    // 去除行内代码
    result = result.replace(/`([^`]+)`/g, '$1');
    // 去除引用标记 >
    result = result.replace(/^>\s?/gm, '');
    // 去除删除线
    result = result.replace(/~~(.+?)~~/g, '$1');
    return result;
}

/**
 * 去除 wiki-link 标记，保留别名或标题
 * [[note]] → note
 * [[note|alias]] → alias
 * [[path/to/note|alias]] → alias
 */
export function stripWikiLinks(text: string): string {
    return text.replace(/\[\[([^\]]+)\]\]/g, (_match, content: string) => {
        const parts = content.split('|');
        if (parts.length > 1) {
            return parts[1].trim();
        }
        const pathParts = parts[0].trim().split('/');
        return pathParts[pathParts.length - 1];
    });
}

/**
 * 去除 block id 后缀 (^block-id)
 */
export function stripBlockIds(text: string): string {
    return text.replace(/\s*\^[a-zA-Z0-9_-]+\s*$/gm, '');
}

/**
 * 压缩多余空白：多个空行合并为一个，行首尾空白去除
 */
export function compressWhitespace(text: string): string {
    return text
        .split('\n')
        .map(line => line.trimEnd())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/**
 * 完整预处理链：Markdown → wiki-link → block-id → 空白压缩
 */
export function preprocessForTTS(text: string): string {
    let result = text;
    result = stripMarkdown(result);
    result = stripWikiLinks(result);
    result = stripBlockIds(result);
    result = compressWhitespace(result);
    return result;
}
