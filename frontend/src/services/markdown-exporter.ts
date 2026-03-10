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
    // 构建 frontmatter
    let frontMatterLines = [
        '---',
        `pdf_name: ${pdfName}`,
        `node_id: ${node.node_id}`,
        `section: ${node.section}`,
        `page_range: ${node.page_range}`,
        `level: ${node.level}`,
    ];

    // 如果有摘要，添加到 frontmatter（使用多行字符串格式）
    if (node.summary && node.summary.trim()) {
        const summaryText = node.summary.trim();
        // 如果摘要包含换行，使用 YAML 块标量
        if (summaryText.includes('\n')) {
            frontMatterLines.push('summary: |');
            for (const line of summaryText.split('\n')) {
                frontMatterLines.push(`  ${line}`);
            }
        } else {
            frontMatterLines.push(`summary: "${summaryText.replace(/"/g, '\\"')}"`);
        }
    }
    frontMatterLines.push('---');
    frontMatterLines.push('');

    const frontMatter = frontMatterLines.join('\n');
    const title = `# ${node.section}\n\n`;

    // 生成摘要块（如果有摘要）- 同时保留 callout 展示
    let summaryBlock = "";
    if (node.summary && node.summary.trim()) {
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
    indexId: string,
    author?: string
): Promise<void> {
    const bookNotePath = `${folderPath}/${bookName}.md`;
    const coverPath = `DeepReader/covers/${bookName}.png`;

    // 构建 frontmatter
    let frontMatterLines = [
        '---',
        `book_name: ${bookName}`,
        `cover: ${coverPath}`,
        `index_id: ${indexId}`,
    ];
    if (author) {
        // 用引号包裹作者名，避免 YAML 解析特殊字符（如方括号）出错
        frontMatterLines.push(`author: "${author}"`);
    }
    frontMatterLines.push('---');
    frontMatterLines.push('');

    // 构建章节列表 Base 代码块
    const chapterListBase = `## 📖 章节目录

\`\`\`base
filters:
  and:
    - file.inFolder("${folderPath}")
    - file.ext == "md"
    - file.name != "${bookName}"
formulas:
  chapter_link: link(file.path, section)
properties:
  formula.chapter_link:
    displayName: 章节
  summary:
    displayName: 摘要
views:
  - type: list
    name: 章节列表
    order:
      - formula.chapter_link
      - summary
    rowHeight: tall
    indentProperties: true
    markers: number
\`\`\`

`;

    // 构建内容
    const content = frontMatterLines.join('\n') + `# ${bookName}\n\n` + chapterListBase;

    // 检查文件是否存在
    const existingFile = app.vault.getAbstractFileByPath(bookNotePath);
    if (existingFile instanceof TFile) {
        // 读取现有内容并更新 frontmatter
        const existingContent = await app.vault.read(existingFile);
        // 检查是否有 frontmatter
        const frontmatterMatch = existingContent.match(/^---\n([\s\S]*?)\n---/);
        if (frontmatterMatch) {
            // 有 frontmatter，更新作者和封面信息
            let frontmatter = frontmatterMatch[1];
            // 如果作者信息不存在，添加它
            if (author && !frontmatter.includes('author:')) {
                frontmatter += `\nauthor: "${author}"`;
            }
            // 如果封面信息不存在，添加它
            if (!frontmatter.includes('cover:')) {
                frontmatter += `\ncover: ${coverPath}`;
            }
            // 如果 index_id 不存在，添加它
            if (!frontmatter.includes('index_id:')) {
                frontmatter += `\nindex_id: ${indexId}`;
            }
            // 重新构建文件内容（保留 frontmatter 之后的内容，但如果是新建的模板则更新）
            let bodyContent = existingContent.substring(frontmatterMatch[0].length);
            // 检查是否已有章节目录，如果没有则添加
            if (!bodyContent.includes('## 📖 章节目录')) {
                bodyContent = '\n\n' + chapterListBase + bodyContent.trim();
            }
            const newContent = `---\n${frontmatter}\n---${bodyContent}`;
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
    indexId: string,
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
        await createBookNote(app, pdfFolderName, folderPath, indexId, author);

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
