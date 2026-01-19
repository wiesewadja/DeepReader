/**
 * Markdown 导出服务
 * 前端生成 Markdown 文件并保存到 Obsidian vault
 */

import { App, TFile, Notice } from 'obsidian';

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
    const content = node.text.trim() + "\n\n";
    const footer = `---
**来源**: [[${pdfName}]] 第 ${node.page_range} 页
`;

    return frontMatter + title + content + footer;
}

/**
 * 导出索引为 Markdown 文件
 */
export async function exportIndexToMarkdown(
    app: App,
    pdfName: string,
    nodes: NodeData[],
    outputFolder: string = "DeepPDF"
): Promise<ExportResult> {
    try {
        // 创建输出文件夹
        const pdfFolderName = sanitizeFilename(pdfName.replace('.pdf', ''));
        const folderPath = `${outputFolder}/${pdfFolderName}`;

        // 确保文件夹存在
        const folder = app.vault.getAbstractFileByPath(folderPath);
        if (!folder) {
            await app.vault.createFolder(folderPath);
        }

        // 导出每个节点
        const fileMapping: Record<string, string> = {};
        let filesCreated = 0;

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

            // 记录映射
            fileMapping[node.node_id] = filePath;
            filesCreated++;
        }

        return {
            success: true,
            filesCreated,
            fileMapping
        };

    } catch (error) {
        console.error('[DeepPDF] Markdown export failed:', error);
        return {
            success: false,
            filesCreated: 0,
            fileMapping: {},
            error: error instanceof Error ? error.message : String(error)
        };
    }
}
