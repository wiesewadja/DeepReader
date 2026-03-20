/**
 * Markdown 导出服务
 * 前端生成 Markdown 文件并保存到 Obsidian vault
 */

import { App, TFile, Notice } from 'obsidian';
import { error as logError, info as logInfo } from '../utils/logger.js';
import { deeppdfClient } from '../api/http-client.js';

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
    blockMapping: Record<string, Record<string, string>>;  // node_id -> {block_id -> file_path}
    error?: string;
}

/**
 * Markdown 切分配置
 */
const MARKDOWN_CHUNK_TARGET = 4000;  // 目标字符数
const MARKDOWN_CHUNK_MAX = 6000;     // 最大字符数

/**
 * 段落数据结构（从文本中解析）
 */
interface ParsedParagraph {
    text: string;
    blockId: string;
    isHeading: boolean;
}

/**
 * 从带 block_id 的文本中解析段落
 * 格式：普通段落 text ^blockId 或 ### 标题 ^blockId
 */
function parseParagraphsFromText(text: string): ParsedParagraph[] {
    const paragraphs: ParsedParagraph[] = [];
    // 按双换行分割段落
    const blocks = text.split(/\n\n+/);

    for (const block of blocks) {
        if (!block.trim()) continue;

        // 匹配 block_id：格式为空格后跟 ^xxx
        const blockIdMatch = block.match(/\s*\^([a-zA-Z0-9_-]+)\s*$/);
        const blockId = blockIdMatch ? blockIdMatch[1] : '';

        // 移除 block_id 标记得到纯文本
        let cleanText = blockIdMatch ? block.replace(blockIdMatch[0], '') : block;
        cleanText = cleanText.trim();

        if (!cleanText) continue;

        // 检测是否是标题（以 ### 开头）
        const isHeading = cleanText.startsWith('###');

        // 移除标题前缀（如果有）
        if (isHeading) {
            cleanText = cleanText.replace(/^###\s*/, '');
        }

        paragraphs.push({
            text: cleanText,
            blockId,
            isHeading
        });
    }

    return paragraphs;
}

/**
 * 按字符数切分段落
 * 保持段落完整性
 */
function splitParagraphsBySize(paragraphs: ParsedParagraph[]): ParsedParagraph[][] {
    if (!paragraphs.length) return [];

    // 计算段落的显示长度（包括 block_id 和换行）
    const getParaLength = (para: ParsedParagraph): number => {
        // 估算：文本 + block_id (^xxx) + 换行
        const blockIdLen = para.blockId ? para.blockId.length + 2 : 0;  // +2 for ^ and space
        const headingLen = para.isHeading ? 4 : 0;  // ### + space
        return para.text.length + blockIdLen + headingLen + 4;  // +4 for newlines
    };

    const groups: ParsedParagraph[][] = [];
    let currentGroup: ParsedParagraph[] = [];
    let currentLength = 0;

    for (const para of paragraphs) {
        const paraLen = getParaLength(para);

        // 检查是否需要开始新组
        if (currentGroup.length > 0) {
            // 如果加入这个段落会超过 max_chars，开始新组
            if (currentLength + paraLen > MARKDOWN_CHUNK_MAX) {
                groups.push(currentGroup);
                currentGroup = [];
                currentLength = 0;
            }
            // 如果当前组已达到目标，考虑开始新组
            else if (currentLength >= MARKDOWN_CHUNK_TARGET && paraLen > 0) {
                groups.push(currentGroup);
                currentGroup = [];
                currentLength = 0;
            }
        }

        currentGroup.push(para);
        currentLength += paraLen;
    }

    // 处理最后一组
    if (currentGroup.length > 0) {
        groups.push(currentGroup);
    }

    return groups;
}

/**
 * 从段落组重建文本
 */
function buildTextFromParagraphGroup(paragraphs: ParsedParagraph[]): string {
    return paragraphs.map(para => {
        if (para.isHeading) {
            return para.blockId
                ? `### ${para.text} ^${para.blockId}`
                : `### ${para.text}`;
        } else {
            return para.blockId
                ? `${para.text} ^${para.blockId}`
                : para.text;
        }
    }).join('\n\n');
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
 * 生成 Markdown 内容（支持分片）
 */
function createMarkdownContent(
    node: NodeData,
    pdfName: string,
    partNum: number = 1,
    totalParts: number = 1,
    partialText?: string
): string {
    // 使用传入的部分文本，或完整文本
    const textContent = partialText || node.text;

    // 构建 frontmatter
    let frontMatterLines = [
        '---',
        `pdf_name: ${pdfName}`,
        `node_id: ${node.node_id}`,
    ];

    // 如果是分片，添加 part_id
    if (totalParts > 1) {
        frontMatterLines.push(`part_id: ${node.node_id}_part${partNum}`);
    }

    frontMatterLines.push(
        `section: ${node.section}`,
        `page_range: ${node.page_range}`,
        `level: ${node.level}`,
        `part: ${partNum}/${totalParts}`
    );

    // 如果有摘要且是第一部分，添加到 frontmatter
    if (node.summary && node.summary.trim() && partNum === 1) {
        const summaryText = node.summary.trim();
        if (summaryText.includes('\n')) {
            frontMatterLines.push('summary: |');
            for (const line of summaryText.split('\n')) {
                frontMatterLines.push(`  ${line}`);
            }
        } else {
            frontMatterLines.push(`summary: "${summaryText.replace(/"/g, '\\"')}"`);
        }
    }

    frontMatterLines.push(`tags: [DeepPDF, ${pdfName.replace(/\.pdf$/i, '').replace(/\.epub$/i, '')}]`);
    frontMatterLines.push('---');
    frontMatterLines.push('');

    const frontMatter = frontMatterLines.join('\n');

    // 标题：只保留 section 的最后一部分（去除父级路径）
    // 例如："第一篇 > 第一章" → "第一章"
    const displayTitle = node.section.includes('>')
        ? node.section.split('>').pop()?.trim() || node.section
        : node.section;

    // 分片时在标题后添加序号
    const title = totalParts > 1
        ? `# ${displayTitle} (${partNum}/${totalParts})\n\n`
        : `# ${displayTitle}\n\n`;

    // 摘要块（仅第一部分显示）
    let summaryBlock = "";
    if (node.summary && node.summary.trim() && partNum === 1) {
        const summaryLines = node.summary.trim().split("\n");
        summaryBlock = "> [!summary] 章节摘要\n";
        for (const line of summaryLines) {
            summaryBlock += `> ${line}\n`;
        }
        summaryBlock += "\n";
    }

    // 处理页码标记
    const processedText = processPageMarkers(textContent);
    const content = processedText.trim() + "\n\n";

    // 页脚链接
    const startPage = typeof node.start_index === 'number' ? node.start_index : parseInt(String(node.start_index));
    const footerLink = !isNaN(startPage)
        ? `[[${pdfName}#page=${startPage}]]`
        : `[[${pdfName}]]`;
    const footer = `---
**来源**: ${footerLink} (第 ${node.page_range} 页)
`;

    return frontMatter + title + summaryBlock + content + footer;
}

/**
 * 从内容中提取图片引用
 * 匹配格式: ![alt](/api/epub-images/index_id/image_name)
 */
function extractImageReferences(content: string): Array<{ alt: string; indexId: string; imageName: string; full: string }> {
    const imageRegex = /!\[([^\]]*)\]\(\/api\/epub-images\/([^\/]+)\/([^)]+)\)/g;
    const images: Array<{ alt: string; indexId: string; imageName: string; full: string }> = [];

    let match;
    while ((match = imageRegex.exec(content)) !== null) {
        images.push({
            alt: match[1],
            indexId: match[2],
            imageName: match[3],
            full: match[0]
        });
    }

    return images;
}

/**
 * 下载 EPUB 图片到 Obsidian vault
 * @param app Obsidian App 实例
 * @param indexId 索引 ID
 * @param bookName 书名
 * @param imageNames 图片文件名列表
 * @param outputFolder 输出文件夹
 * @returns 下载的图片映射 {原始文件名: Obsidian 路径}
 */
async function downloadEpubImages(
    app: App,
    indexId: string,
    bookName: string,
    imageNames: string[],
    outputFolder: string = "DeepReader"
): Promise<Record<string, string>> {
    const imageMapping: Record<string, string> = {};
    const imagesFolderPath = `${outputFolder}/images/${bookName}`;

    // 确保图片文件夹存在
    const folder = app.vault.getAbstractFileByPath(imagesFolderPath);
    if (!folder) {
        await app.vault.createFolder(imagesFolderPath);
        // 可能需要创建父目录
        const parentFolder = imagesFolderPath.substring(0, imagesFolderPath.lastIndexOf('/'));
        const parent = app.vault.getAbstractFileByPath(parentFolder);
        if (!parent) {
            await app.vault.createFolder(parentFolder);
        }
    }

    for (const imageName of imageNames) {
        try {
            // 检查图片是否已存在
            const imagePath = `${imagesFolderPath}/${imageName}`;
            const existingFile = app.vault.getAbstractFileByPath(imagePath);

            if (existingFile instanceof TFile) {
                // 图片已存在，跳过下载
                logInfo(`[EPUB图片] 图片已存在，跳过: ${imagePath}`);
                imageMapping[imageName] = imagePath;
                continue;
            }

            // 下载图片
            const imageData = await deeppdfClient.getEpubImage(indexId, imageName);

            // 保存到 vault
            await app.vault.createBinary(imagePath, imageData);
            imageMapping[imageName] = imagePath;

            logInfo(`[EPUB图片] 下载成功: ${imageName}`);
        } catch (error) {
            logError(`[EPUB图片] 下载失败: ${imageName}`, error);
            // 继续处理其他图片
        }
    }

    return imageMapping;
}

/**
 * 替换内容中的图片链接为 Obsidian 格式
 * ![alt](/api/epub-images/idx/img.png) → ![[DeepReader/images/书名/img.png|alt]]
 */
function replaceImageLinks(
    content: string,
    bookName: string,
    imageMapping: Record<string, string>
): string {
    const imageRegex = /!\[([^\]]*)\]\(\/api\/epub-images\/([^\/]+)\/([^)]+)\)/g;

    return content.replace(imageRegex, (match, alt, indexId, imageName) => {
        // 使用映射中的路径，或者构建默认路径
        const obsidianPath = imageMapping[imageName] || `DeepReader/images/${bookName}/${imageName}`;

        // Obsidian 格式: ![[路径|alt]]
        if (alt) {
            return `![[${obsidianPath}|${alt}]]`;
        } else {
            return `![[${obsidianPath}]]`;
        }
    });
}

/**
 * 创建书籍主 note 文件
 */
async function createBookNote(
    app: App,
    bookName: string,
    folderPath: string,
    indexId: string,
    author?: string,
    docDescription?: string  // 全书摘要
): Promise<void> {
    const bookNotePath = `${folderPath}/${bookName}.md`;
    const coverPath = `DeepReader/covers/${bookName}.png`;

    // 构建 frontmatter
    let frontMatterLines = [
        '---',
        `book_name: ${bookName}`,
        `aicreate: true`,
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

    // 构建全书摘要部分
    const descriptionSection = docDescription
        ? `## 📝 全书摘要\n\n${docDescription}\n\n`
        : '';

    // 构建内容
    const content = frontMatterLines.join('\n') + `# ${bookName}\n\n` + descriptionSection + chapterListBase;

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
            // 如果 aicreate 不存在，添加它
            if (!frontmatter.includes('aicreate:')) {
                frontmatter += `\naicreate: true`;
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
 * 支持按字符数切分长章节，同时维护 block_id 到子文件的映射
 */
export async function exportIndexToMarkdown(
    app: App,
    pdfName: string,
    nodes: NodeData[],
    indexId: string,
    outputFolder: string = "DeepReader",
    author?: string,
    docDescription?: string  // 全书摘要
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

        // 步骤 1: 收集所有节点中的图片引用
        const allImageRefs = new Map<string, { alt: string; indexId: string; imageName: string }>();
        for (const node of nodes) {
            const images = extractImageReferences(node.text);
            for (const img of images) {
                if (!allImageRefs.has(img.imageName)) {
                    allImageRefs.set(img.imageName, img);
                }
            }
        }

        // 步骤 2: 下载图片到 Obsidian vault
        let imageMapping: Record<string, string> = {};
        if (allImageRefs.size > 0) {
            logInfo(`[EPUB图片] 开始下载 ${allImageRefs.size} 张图片...`);
            const imageNames = Array.from(allImageRefs.keys());
            const firstImage = allImageRefs.values().next().value;
            if (firstImage) {
                imageMapping = await downloadEpubImages(
                    app,
                    firstImage.indexId,
                    pdfFolderName,
                    imageNames,
                    outputFolder
                );
                logInfo(`[EPUB图片] 下载完成: ${Object.keys(imageMapping).length} 张`);
            }
        }

        // 创建或更新书籍主 note 文件
        await createBookNote(app, pdfFolderName, folderPath, indexId, author, docDescription);

        // 导出每个节点（支持切分）
        const fileMapping: Record<string, string> = {};  // node_id -> 主文件路径
        const blockMapping: Record<string, Record<string, string>> = {};  // node_id -> {block_id -> file_path}
        let filesCreated = 1; // 包含书籍主 note

        for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];

            // 替换图片链接为 Obsidian 格式
            const processedText = replaceImageLinks(node.text, pdfFolderName, imageMapping);

            // 解析段落并按字符数切分
            const paragraphs = parseParagraphsFromText(processedText);
            const paragraphGroups = splitParagraphsBySize(paragraphs);
            const totalParts = paragraphGroups.length;

            logInfo(`[导出] 节点 ${node.node_id}: ${paragraphs.length} 个段落, 切分为 ${totalParts} 个文件`);

            // 清理章节名称用于文件名
            const safeNodeName = sanitizeFilename(node.node_name, 50);
            const nodeBlockMapping: Record<string, string> = {};

            // 为每个段落组创建文件
            for (let partIdx = 0; partIdx < paragraphGroups.length; partIdx++) {
                const paraGroup = paragraphGroups[partIdx];
                const partNum = partIdx + 1;

                // 构建文件名：第一部分不带序号，后续部分从 2 开始
                let filename: string;
                if (totalParts === 1) {
                    filename = `${String(i + 1).padStart(2, '0')}-${safeNodeName}.md`;
                } else if (partNum === 1) {
                    filename = `${String(i + 1).padStart(2, '0')}-${safeNodeName}.md`;
                } else {
                    filename = `${String(i + 1).padStart(2, '0')}-${safeNodeName}-${partNum}.md`;
                }

                const filePath = `${folderPath}/${filename}`;
                const relativePath = `${pdfFolderName}/${filename}`;

                // 从段落组重建文本
                const partialText = buildTextFromParagraphGroup(paraGroup);

                // 生成 Markdown 内容
                const content = createMarkdownContent(node, pdfName, partNum, totalParts, partialText);

                // 检查文件是否存在
                const existingFile = app.vault.getAbstractFileByPath(filePath);
                if (existingFile instanceof TFile) {
                    await app.vault.modify(existingFile, content);
                } else {
                    await app.vault.create(filePath, content);
                }

                filesCreated++;

                // 记录这个文件中包含的所有 block_id
                for (const para of paraGroup) {
                    if (para.blockId) {
                        nodeBlockMapping[para.blockId] = relativePath;
                    }
                }

                // 第一部分作为主文件（向后兼容）
                if (partNum === 1) {
                    fileMapping[node.node_id] = relativePath;
                }
            }

            // 记录该节点的 block 映射
            if (Object.keys(nodeBlockMapping).length > 0) {
                blockMapping[node.node_id] = nodeBlockMapping;
            }
        }

        logInfo(`[导出] 完成: ${filesCreated} 个文件, ${Object.keys(blockMapping).length} 个节点有 block 映射`);

        return {
            success: true,
            filesCreated,
            fileMapping,
            blockMapping
        };

    } catch (error) {
        logError('[DeepPDF] Markdown export failed:', error);
        return {
            success: false,
            filesCreated: 0,
            fileMapping: {},
            blockMapping: {},
            error: error instanceof Error ? error.message : String(error)
        };
    }
}
