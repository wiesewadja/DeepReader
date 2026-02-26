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
    // 处理页码标记后再输出
    const processedText = processPageMarkers(node.text);
    const content = processedText.trim() + "\n\n";
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
        // 创建输出文件夹（同时移除 .pdf 和 .epub 后缀）
        const pdfFolderName = sanitizeFilename(pdfName.replace(/\.pdf$/i, '').replace(/\.epub$/i, ''));
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

            // 记录映射：使用文件名（不含文件夹路径）作为 wiki 链接
            // Obsidian wiki 链接格式：[[文件名]] 或 [[文件夹/文件名]]
            // 这里我们使用相对路径（从 PDF 文件夹开始），方便跨文件夹引用
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
        console.error('[DeepPDF] Markdown export failed:', error);
        return {
            success: false,
            filesCreated: 0,
            fileMapping: {},
            error: error instanceof Error ? error.message : String(error)
        };
    }
}
