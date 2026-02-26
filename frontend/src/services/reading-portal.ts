/**
 * 阅读入口管理服务
 *
 * 管理 DeepPDF 阅读入口文档和书籍笔记
 */

import { App, Notice, TFile, normalizePath } from "obsidian";
import { DeepPDFClient, ReadingProgress, TableOfContents, BookSummary } from "../api/http-client";

// 阅读入口目录名
const DEEPPDF_DIR = "DeepPDF";
const ENTRY_FILE = "📚 阅读入口.md";

// 书籍笔记 frontmatter 结构
interface BookFrontmatter {
  index_id: string;
  book_name: string; // 书籍名称
  status: "unread" | "reading" | "completed";
  progress: number;
  total_pages: number;
  read_pages: string; // 逗号分隔的页码
  last_read: string | null;
  chat_rounds: number;
  tags: string[];
  created: string;
}

export class ReadingPortalService {
  private app: App;
  private client: DeepPDFClient;

  constructor(app: App, client: DeepPDFClient) {
    this.app = app;
    this.client = client;
  }

  /**
   * 获取阅读入口文件路径
   */
  private getEntryPath(): string {
    return normalizePath(`${DEEPPDF_DIR}/${ENTRY_FILE}`);
  }

  /**
   * 获取书籍笔记路径
   * 笔记存放在书籍文件夹内，文件名固定为 "📖 书籍笔记.md"
   */
  private getBookNotePath(bookName: string): string {
    // 清理文件名中的非法字符，作为文件夹名
    const safeFolderName = bookName.replace(/[\\/:"*?<>|]/g, "_");
    return normalizePath(`${DEEPPDF_DIR}/${safeFolderName}/${safeFolderName}.md`);
  }

  /**
   * 确保目录存在
   */
  private async ensureDir(): Promise<void> {
    const dirPath = normalizePath(DEEPPDF_DIR);
    const exists = await this.app.vault.adapter.exists(dirPath);
    if (!exists) {
      await this.app.vault.createFolder(dirPath);
    }
  }

  /**
   * 同步所有索引到书籍笔记
   * 从后端获取所有索引，为每个索引创建书籍笔记文件
   */
  async syncAllIndexes(): Promise<number> {
    await this.ensureDir();

    // 从后端获取所有索引
    const result = await this.client.listIndexes();
    const indexes = result?.indexes || [];
    if (indexes.length === 0) {
      new Notice("没有找到已索引的书籍");
      return 0;
    }

    let created = 0;
    for (const index of indexes) {
      const bookName = index.pdf_name.replace(/\.pdf$/i, "").replace(/\.epub$/i, "");
      const indexId = index.id;

      try {
        // 并行获取阅读进度、摘要和目录
        const [progress, summary, toc] = await Promise.all([
          this.client.getReadingProgress(indexId),
          this.client.getBookSummary(indexId).catch(() => null),
          this.client.getTableOfContents(indexId).catch(() => null),
        ]);

        const totalPages = progress?.total_pages || 0;
        const chapters = toc?.chapters;

        // 从章节文件中读取内容生成更详细的摘要
        const enhancedSummary = await this.generateEnhancedSummary(bookName, summary?.summary, chapters);

        await this.ensureBookNote(indexId, bookName, totalPages, enhancedSummary, chapters);
        created++;
      } catch (error) {
        console.error(`[DeepPDF] Failed to create book note for ${bookName}:`, error);
      }
    }

    new Notice(`已同步 ${created} 本书籍笔记`);
    return created;
  }

  /**
   * 从章节文件中读取内容生成增强的摘要
   */
  private async generateEnhancedSummary(
    bookName: string,
    backendSummary: string | undefined,
    chapters?: { title: string; start_page: number; end_page: number; level: number }[]
  ): Promise<string> {
    const safeFolderName = bookName.replace(/[\\/:"*?<>|]/g, "_");
    const bookFolderPath = normalizePath(`${DEEPPDF_DIR}/${safeFolderName}`);

    // 检查书籍文件夹是否存在
    const folderExists = await this.app.vault.adapter.exists(bookFolderPath);
    if (!folderExists) {
      return backendSummary || `《${bookName}》是一本已索引的书籍。`;
    }

    // 读取前 3 个章节的内容
    const summaryParts: string[] = [];
    let chapterCount = 0;

    if (chapters && chapters.length > 0) {
      for (const chapter of chapters) {
        if (chapterCount >= 3) break;

        // 跳过目录、前言等辅助章节
        const titleLower = chapter.title.toLowerCase();
        if (titleLower.includes("目录") || titleLower.includes("toc") ||
            titleLower.includes("preface") || titleLower.includes("前言") ||
            titleLower.includes("序") || chapter.level > 0) {
          continue;
        }

        // 查找对应的章节文件
        const files = this.app.vault.getFiles();
        const chapterFile = files.find(f =>
          f.path.startsWith(bookFolderPath) &&
          f.path.endsWith(".md") &&
          !f.name.startsWith("📖") &&
          (f.name.includes(chapter.title.substring(0, 10)) ||
           f.path.includes(`-${chapter.title.substring(0, 10)}`))
        );

        if (chapterFile) {
          try {
            const content = await this.app.vault.read(chapterFile);
            // 提取前 300 字符作为内容预览
            const preview = this.extractContentPreview(content, 300);
            if (preview) {
              summaryParts.push(`**${chapter.title}**: ${preview}`);
              chapterCount++;
            }
          } catch (e) {
            console.warn(`[DeepPDF] 读取章节失败: ${chapterFile.path}`, e);
          }
        }
      }
    }

    // 如果成功提取了章节内容，返回增强摘要
    if (summaryParts.length > 0) {
      return `《${bookName}》主要内容包括：${summaryParts.join("；")}。`;
    }

    return backendSummary || `《${bookName}》是一本已索引的书籍。`;
  }

  /**
   * 从 Markdown 内容中提取纯文本预览
   */
  private extractContentPreview(content: string, maxLength: number): string {
    // 移除 frontmatter
    let text = content.replace(/^---[\s\S]*?---/, "");
    // 移除页面标记
    text = text.replace(/### 第 \d+ 页.*?\n/g, "");
    text = text.replace(/\^page-\d+/g, "");
    // 移除标题标记
    text = text.replace(/#+ /g, "");
    // 移除多余空白
    text = text.replace(/\n+/g, " ").trim();
    // 截取指定长度
    return text.length > maxLength ? text.substring(0, maxLength) + "..." : text;
  }

  /**
   * 生成入口文档内容
   */
  private generateEntryContent(): string {
    return `---
deeppdf_entry: true
---

# 📚 阅读入口

管理所有已索引的 PDF 文档，追踪阅读进度。

> 💡 点击「开始对话」链接即可与 AI 讨论该书

\`\`\`base
filters:
  and:
    - file.inFolder("DeepPDF")
    - 'file.ext == "md"'
    - file.hasProperty("index_id")
    - file.hasProperty("book_name")

formulas:
  status_label: 'if(status == "reading", "阅读中", if(status == "completed", "已完成", "未开始"))'
  chat_link: 'link("obsidian://deeppdf-chat?index_id=" + index_id, "开始对话")'

properties:
  book_name:
    displayName: "书名"
  formula.chat_link:
    displayName: "操作"
  formula.status_label:
    displayName: "状态"
  progress:
    displayName: "进度%"
  total_pages:
    displayName: "总页数"
  last_read:
    displayName: "最后阅读"
  chat_rounds:
    displayName: "对话"

views:
  - type: table
    name: "书籍列表"
    order:
      - book_name
      - formula.chat_link
      - formula.status_label
      - progress
      - total_pages
      - last_read
      - chat_rounds
\`\`\`

---

## 使用说明

1. 点击任意书籍的「开始对话」链接，将打开 DeepPDF 侧边栏
2. 在对话过程中，系统会自动记录您阅读过的页面
3. 阅读进度 = 已覆盖页数 / 总页数

## 快速操作

- [打开 DeepPDF 侧边栏](obsidian://open?vault=${encodeURIComponent(this.app.vault.getName())}&command=deeppdf:open-deeppdf-sidebar)
`;
  }

  /**
   * 生成书籍笔记内容
   */
  private generateBookNoteContent(
    bookName: string,
    indexId: string,
    totalPages: number,
    summary?: string,
    chapters?: { title: string; start_page: number; end_page: number; level: number }[]
  ): string {
    const now = new Date().toISOString().split("T")[0];
    const safeFolderName = bookName.replace(/[\\/:"*?<>|]/g, "_");

    // 生成摘要部分
    const summaryContent = summary
      ? `> [!note] AI 生成摘要\n> ${summary}`
      : `> [!note] AI 生成摘要\n> 摘要生成中...`;

    // 生成章节目录部分
    let tocContent = "（待生成）";
    if (chapters && chapters.length > 0) {
      tocContent = chapters.map(ch => {
        const indent = "  ".repeat(ch.level);
        return `${indent}- ${ch.title} (p.${ch.start_page}-${ch.end_page})`;
      }).join("\n");
    }

    return `---
index_id: ${indexId}
book_name: "${bookName.replace(/"/g, '\\"')}"
status: unread
progress: 0
total_pages: ${totalPages}
read_pages: ""
last_read: null
chat_rounds: 0
tags: []
created: ${now}
---

# 📖 ${bookName}

## 📖 摘要

${summaryContent}

## 📑 章节目录

${tocContent}

## 📂 章节文档

\`\`\`base
filters:
  and:
    - file.inFolder("DeepPDF/${safeFolderName}")
    - file.ext == "md"
    - '!file.name.startsWith("📖")'

formulas:
  page_link: '"p." + physical_index'

properties:
  file.name:
    displayName: "章节"
  section:
    displayName: "标题"
  page_range:
    displayName: "页码"

views:
  - type: table
    name: "章节列表"
    order:
      - file.name
      - section
      - page_range
\`\`\`

## 💭 阅读笔记

（在这里记录您的阅读心得）

## 🔗 相关链接

- [[📚 阅读入口]] - 返回书籍列表
- [开始对话](obsidian://deeppdf-chat?index_id=${indexId}) - 与 AI 讨论
`;
  }

  /**
   * 打开或创建阅读入口
   */
  async openReadingPortal(): Promise<void> {
    await this.ensureDir();
    const entryPath = this.getEntryPath();

    let file = this.app.vault.getAbstractFileByPath(entryPath);

    if (!file) {
      // 创建入口文件
      const content = this.generateEntryContent();
      file = await this.app.vault.create(entryPath, content);
      new Notice("已创建阅读入口文档");
    }

    // 在新标签页打开
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(file as TFile);
  }

  /**
   * 确保书籍笔记存在（首次阅读时调用）
   */
  async ensureBookNote(
    indexId: string,
    bookName: string,
    totalPages: number,
    summary?: string,
    chapters?: { title: string; start_page: number; end_page: number; level: number }[]
  ): Promise<string> {
    await this.ensureDir();

    // 清理文件名中的非法字符，作为文件夹名
    const safeFolderName = bookName.replace(/[\\/:"*?<>|]/g, "_");
    const bookFolderPath = normalizePath(`${DEEPPDF_DIR}/${safeFolderName}`);

    // 确保书籍文件夹存在
    const folderExists = await this.app.vault.adapter.exists(bookFolderPath);
    if (!folderExists) {
      await this.app.vault.createFolder(bookFolderPath);
    }

    const notePath = this.getBookNotePath(bookName);
    let file = this.app.vault.getAbstractFileByPath(notePath);

    if (!file) {
      // 创建书籍笔记
      const content = this.generateBookNoteContent(bookName, indexId, totalPages, summary, chapters);
      file = await this.app.vault.create(notePath, content);
      console.log(`[DeepPDF] Created book note: ${notePath}`);
    } else {
      // 更新现有笔记的摘要和目录
      await this.updateBookNoteContent(file as TFile, summary, chapters);
    }

    return notePath;
  }

  /**
   * 更新书籍笔记内容（摘要和目录）
   */
  private async updateBookNoteContent(
    file: TFile,
    summary?: string,
    chapters?: { title: string; start_page: number; end_page: number; level: number }[]
  ): Promise<void> {
    if (!summary && !chapters) return;

    const content = await this.app.vault.read(file);

    // 更新摘要
    if (summary) {
      const summaryRegex = /## 📖 摘要\s*\n\n[\s\S]*?(?=\n## )/;
      const newSummary = `## 📖 摘要\n\n> [!note] AI 生成摘要\n> ${summary}`;
      if (summaryRegex.test(content)) {
        content.replace(summaryRegex, newSummary);
      }
    }

    // 更新目录
    if (chapters && chapters.length > 0) {
      const tocRegex = /## 📑 章节目录\s*\n\n[\s\S]*?(?=\n## )/;
      const tocContent = chapters.map(ch => {
        const indent = "  ".repeat(ch.level);
        return `${indent}- ${ch.title} (p.${ch.start_page}-${ch.end_page})`;
      }).join("\n");
      const newToc = `## 📑 章节目录\n\n${tocContent}`;
      if (tocRegex.test(content)) {
        content.replace(tocRegex, newToc);
      }
    }
  }

  /**
   * 更新书籍笔记的阅读进度
   */
  async updateBookProgress(
    bookName: string,
    progress: ReadingProgress
  ): Promise<void> {
    const notePath = this.getBookNotePath(bookName);
    const file = this.app.vault.getAbstractFileByPath(notePath);

    if (!file || !(file instanceof TFile)) {
      return; // 笔记不存在，跳过
    }

    // 使用 processFrontmatter 更新，保留 book_name
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm.index_id = progress.index_id;
      // 保留已有的 book_name，如果没有则添加
      if (!fm.book_name) {
        fm.book_name = bookName;
      }
      fm.status = progress.progress === 0 ? "unread" :
                 progress.progress >= 100 ? "completed" : "reading";
      fm.progress = Math.round(progress.progress);
      fm.total_pages = progress.total_pages;
      fm.read_pages = progress.read_pages.join(",");
      fm.last_read = progress.last_read_at;
      fm.chat_rounds = progress.chat_rounds;
      // 保留已有的 tags，如果没有则初始化为空数组
      if (!fm.tags) {
        fm.tags = [];
      }
    });
  }
}
