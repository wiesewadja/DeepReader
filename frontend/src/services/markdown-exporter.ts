/**
 * Markdown 导出服务
 * 前端生成 Markdown 文件并保存到 Obsidian vault
 */

import { App, TFile, Notice } from 'obsidian';
import { error as logError } from '../utils/logger.js';

/**
 * 节点数据接口
 */
export interface NodeData {
    node_id: string;
    node_name: string;
    section: string;
    page_range: string;
    start_index: number | string;
    end_index: number | string;
    level: number;
    text: string;
    summary?: string;  // 章节摘要（可选）
}

/**
 * 导出结果接口
 */
export interface ExportResult {
    success: boolean;
    filesCreated: number;
    fileMapping: Record<string, string>;
    error?: string;
}

/**
 * 清理文件名,移除特殊字符
 */
function sanitizeFilename(name: string, maxLength: number = 100): string {
    let sanitized = name
        .replace(/[/:\\*?"<>|]/g, '-')
        .replace(/\s+/g, ' ')
        .replace(/-+/g, '-')
        .trim();

    if (sanitized.length > maxLength) {
        sanitized = sanitized.substring(0, maxLength).trim();
    }

    return sanitized;
}

/**
 * 处理物理页码标记
 * 将 <physical_index_N> 转换为 ### 第 N 页 ^page-N
 */
function processPageMarkers(text: string): string {
    const seenPages = new Set<string>();

    return text.replace(/<(?:physical|start|end)_index_(\d+)>/g, (match, pageNum) => {
        if (!seenPages.has(pageNum)) {
            seenPages.add(pageNum);
            // Obsidian 标准格式：块ID紧跟标题，后面换行
            return `\n\n### 第 ${pageNum} 页^page-${pageNum}\n\n`;
        }
        return ''; // 重复标签直接删除
    });
}

/**
 * 生成 Markdown 内容
 */
function createMarkdownContent(node: NodeData, pdfName: string): string {
    const frontMatter = `---
pdf_name: ${pdfName}
node_id: ${node.node_id}
section: ${node.section}
page_range: ${node.page_range}
level: ${node.level}
---

`;

    const title = `# ${node.section}\n\n`;

    // 生成摘要块（如果有摘要）
    let summaryBlock = "";
    if (node.summary && node.summary.trim()) {
        // 将摘要格式化为 Obsidian callout 块
        const summaryLines = node.summary.trim().split("\n");
        summaryBlock = "> [!summary] 章节摘要\n";
        for (const line of summaryLines) {
            summaryBlock += `> ${line}\n`;
        }
        summaryBlock += "\n";
    }

    // 处理页码标记后再输出
    const processedText = processPageMarkers(node.text);
    const content = processedText.trim() + "\n\n";
    const footer = `---
**来源**: [[${pdfName}]] 第 ${node.page_range} 页
`;

    return frontMatter + title + summaryBlock + content + footer;
}

/**
 * 创建书籍主 note 文件
 */
async function createBookNote(
    app: App,
    bookName: string,
    folderPath: string,
    author?: string
): Promise<void> {
    const bookNotePath = `${folderPath}/${bookName}.md`;

    // 构建 frontmatter
    let frontMatterLines = [
        '---',
        `book_name: ${bookName}`,
    ];
    if (author) {
        frontMatterLines.push(`author: ${author}`);
    }
    frontMatterLines.push('---');
    frontMatterLines.push('');

    // 构建内容
    const content = frontMatterLines.join('\n') + `# ${bookName}\n\n`;

    // 检查文件是否存在
    const existingFile = app.vault.getAbstractFileByPath(bookNotePath);
    if (existingFile instanceof TFile) {
        // 读取现有内容并更新 frontmatter
        const existingContent = await app.vault.read(existingFile);
        // 检查是否有 frontmatter
        const frontmatterMatch = existingContent.match(/^---\n([\s\S]*?)\n---/);
        if (frontmatterMatch) {
            // 有 frontmatter，更新作者信息
            let frontmatter = frontmatterMatch[1];
            // 如果作者信息已存在且不同，更新它
            if (author && !frontmatter.includes('author:')) {
                frontmatter += `\nauthor: ${author}`;
            }
            // 重新构建文件内容
            const newContent = `---\n${frontmatter}\n---${existingContent.substring(frontmatterMatch[0].length)}`;
            await app.vault.modify(existingFile, newContent);
        } else {
            // 没有 frontmatter，添加到开头
            await app.vault.modify(existingFile, content + existingContent);
        }
    } else {
        // 创建新文件
        await app.vault.create(bookNotePath, content);
    }
}

/**
 * 导出索引为 Markdown 文件
 */
export async function exportIndexToMarkdown(
    app: App,
    pdfName: string,
    nodes: NodeData[],
    outputFolder: string = "DeepReader",
    author?: string
): Promise<ExportResult> {
    try {
        // 创建输出文件夹（同时移除 .pdf 和 .epub 后缀）
        const pdfFolderName = sanitizeFilename(pdfName.replace(/\.pdf$/i, '').replace(/\.epub$/i, ''));
        const folderPath = `${outputFolder}/${pdfFolderName}`;

        // 确保文件夹存在
        const folder = app.vault.getAbstractFileByPath(folderPath);
        if (!folder) {
            await app.vault.createFolder(folderPath);
        }

        // 创建或更新书籍主 note 文件
        await createBookNote(app, pdfFolderName, folderPath, author);

        // 导出每个节点
        const fileMapping: Record<string, string> = {};
        let filesCreated = 1; // 包含书籍主 note

        for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];
            const filename = `${String(i + 1).padStart(2, '0')}-${sanitizeFilename(node.node_name)}.md`;
            const filePath = `${folderPath}/${filename}`;

            // 生成 Markdown 内容
            const content = createMarkdownContent(node, pdfName);

            // 检查文件是否存在
            const existingFile = app.vault.getAbstractFileByPath(filePath);
            if (existingFile instanceof TFile) {
                // 覆盖现有文件
                await app.vault.modify(existingFile, content);
            } else {
                // 创建新文件
                await app.vault.create(filePath, content);
            }

            // 记录映射：使用相对于 vault 根目录的路径
            // Obsidian wiki 链接会自动搜索匹配的文件，所以不需要完整路径
            // 使用 pdfFolderName/filename 格式即可（如：极简资治通鉴/04-三家分晋.md）
            const relativePath = `${pdfFolderName}/${filename}`;
            fileMapping[node.node_id] = relativePath;
            filesCreated++;
        }

        return {
            success: true,
            filesCreated,
            fileMapping
        };

    } catch (error) {
        logError('[DeepPDF] Markdown export failed:', error);
        return {
            success: false,
            filesCreated: 0,
            fileMapping: {},
            error: error instanceof Error ? error.message : String(error)
        };
    }
}
