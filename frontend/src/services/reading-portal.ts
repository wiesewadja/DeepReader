/**
 * 阅读入口管理服务
 *
 * 管理 DeepPDF 阅读入口文档和书籍笔记
 */

import { App, Notice, TFile, normalizePath } from "obsidian";
import { DeepPDFClient, ReadingProgress } from "../api/http-client";
import { log, error as logError } from "../utils/logger.js";

// 阅读入口目录名
const DEEPPDF_DIR = "DeepReader";
const ENTRY_FILE = "📚 阅读入口.md";

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
   * 下载书籍封面到本地
   * @param indexId 索引 ID
   * @param pdfName PDF/EPUB 文件名
   * @returns 封面的 Obsidian 内部链接路径
   */
  async downloadBookCover(indexId: string, pdfName: string): Promise<string | null> {
    try {
      // 获取封面数据
      const coverData = await this.client.exportCover(indexId);

      // 清理文件名
      const sanitizedName = pdfName
        .replace(/\.pdf$/i, '')
        .replace(/\.epub$/i, '')
        .replace(/[/:\\*?"<>|]/g, '-')
        .replace(/\s+/g, ' ')
        .trim();

      // 封面保存路径
      const coversFolder = normalizePath(`${DEEPPDF_DIR}/covers`);
      const coverPath = normalizePath(`${coversFolder}/${sanitizedName}.png`);

      // 确保封面目录存在
      const folder = this.app.vault.getAbstractFileByPath(coversFolder);
      if (!folder) {
        await this.app.vault.createFolder(coversFolder);
      }

      // 将 base64 转换为 ArrayBuffer
      const binaryString = atob(coverData.cover_data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      // 检查文件是否存在
      const existingFile = this.app.vault.getAbstractFileByPath(coverPath);
      if (existingFile instanceof TFile) {
        await this.app.vault.modifyBinary(existingFile, bytes.buffer);
      } else {
        await this.app.vault.createBinary(coverPath, bytes.buffer);
      }

      log('[DeepPDF] 封面下载成功:', coverPath);

      // 返回 Obsidian 内部链接格式
      return `[[${coverPath}]]`;
    } catch (error) {
      // 封面下载失败不影响主流程，只记录日志
      logError('[DeepPDF] 封面下载失败:', error);
      return null;
    }
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
        // 获取阅读进度
        const progress = await this.client.getReadingProgress(indexId);
        const totalPages = progress?.total_pages || 0;

        await this.ensureBookNote(indexId, bookName, totalPages);

        // 下载封面并更新笔记的 cover 字段
        const coverLink = await this.downloadBookCover(indexId, index.pdf_name);
        if (coverLink) {
          await this.updateBookCover(bookName, coverLink);
        }

        created++;
      } catch (error) {
        logError(`[DeepPDF-ERROR] Failed to create book note for ${bookName}:`, error);
      }
    }

    new Notice(`已同步 ${created} 本书籍笔记`);
    return created;
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

> 💡 点击书名可跳转到书籍笔记，点击「开始对话」可与 AI 讨论该书

\`\`\`base
filters:
  and:
    - file.inFolder("DeepReader")
    - 'file.ext == "md"'
    - file.hasProperty("index_id")
    - file.hasProperty("book_name")
    - '!file.name.startsWith("📖")'

formulas:
  status_label: 'if(status == "reading", "阅读中", if(status == "completed", "已完成", "未开始"))'
  chat_link: 'link("obsidian://deepreader-chat?index_id=" + index_id, "开始对话")'
  book_link: 'link(file.path, book_name)'

properties:
  formula.book_link:
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
      - formula.book_link
      - formula.chat_link
      - formula.status_label
      - progress
      - total_pages
      - last_read
      - chat_rounds
\`\`\`

---

## 使用说明

1. 点击书名可跳转到书籍笔记页面
2. 在对话过程中，系统会自动记录您阅读过的页面
3. 阅读进度 = 已覆盖页数 / 总页数

## 快速操作

- [打开 DeepPDF 侧边栏](obsidian://open?vault=${encodeURIComponent(this.app.vault.getName())}&command=deepreader:open-deepreader-sidebar)
`;
  }

  /**
   * 生成书籍笔记内容
   */
  private generateBookNoteContent(
    bookName: string,
    indexId: string,
    totalPages: number
  ): string {
    const now = new Date().toISOString().split("T")[0];

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
booklists: []
created: ${now}
---

# 📖 ${bookName}

## 💭 阅读笔记

（在这里记录您的阅读心得）
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
    totalPages: number
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
      const content = this.generateBookNoteContent(bookName, indexId, totalPages);
      file = await this.app.vault.create(notePath, content);
      log(`[DeepPDF] Created book note: ${notePath}`);
    }

    return notePath;
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
      // 保留已有的 booklists，如果没有则初始化为空数组
      if (!fm.booklists) {
        fm.booklists = [];
      }
    });
  }

  /**
   * 更新书籍笔记的封面字段
   */
  async updateBookCover(bookName: string, coverLink: string): Promise<void> {
    const notePath = this.getBookNotePath(bookName);
    const file = this.app.vault.getAbstractFileByPath(notePath);

    if (!file || !(file instanceof TFile)) {
      return; // 笔记不存在，跳过
    }

    // 使用 processFrontmatter 更新 cover 字段
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      fm.cover = coverLink;
    });

    log('[DeepPDF] 更新书籍封面字段:', bookName, coverLink);
  }

  // ==================== 图书管理入口文档 ====================

  /**
   * 获取所有书籍的元数据（从 frontmatter 读取）
   * 用于书单/标签过滤
   */
  async getAllBooksMetadata(): Promise<Map<string, { booklists: string[]; tags: string[] }>> {
    const metadataMap = new Map<string, { booklists: string[]; tags: string[] }>();

    // 获取 DeepPDF 目录下的所有书籍笔记
    const files = this.app.vault.getMarkdownFiles();
    for (const file of files) {
      if (!file.path.startsWith(DEEPPDF_DIR + "/")) continue;
      if (file.path.includes("📚") || file.path.includes("📖")) continue;

      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (frontmatter?.index_id) {
        metadataMap.set(frontmatter.index_id, {
          booklists: frontmatter.booklists || [],
          tags: frontmatter.tags || [],
        });
      }
    }

    return metadataMap;
  }

  /**
   * 获取单本书籍的元数据（从 frontmatter 读取）
   * @param bookName 书籍名称（不含扩展名）
   * @returns 书籍元数据，包括作者、书单、标签等
   */
  async getBookMetadata(bookName: string): Promise<{
    author?: string;
    booklists: string[];
    tags: string[];
  } | null> {
    // 查找书籍笔记文件
    const files = this.app.vault.getMarkdownFiles();
    for (const file of files) {
      if (!file.path.startsWith(DEEPPDF_DIR + "/")) continue;
      if (file.basename !== bookName) continue;

      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (frontmatter) {
        return {
          author: frontmatter.author || undefined,
          booklists: frontmatter.booklists || [],
          tags: frontmatter.tags || [],
        };
      }
    }

    return null;
  }

  /**
   * 根据书单/标签过滤索引 ID
   */
  async filterIndexIdsByMetadata(
    options: { booklists?: string[]; tags?: string[] }
  ): Promise<string[]> {
    if (!options.booklists?.length && !options.tags?.length) {
      return []; // 没有过滤条件，返回空表示搜索全部
    }

    const metadataMap = await this.getAllBooksMetadata();
    const matchedIds: string[] = [];

    for (const [indexId, meta] of metadataMap) {
      const booklistMatch = !options.booklists?.length ||
        options.booklists.some(bl => meta.booklists.includes(bl));
      const tagMatch = !options.tags?.length ||
        options.tags.some(tag => meta.tags.includes(tag));

      if (booklistMatch && tagMatch) {
        matchedIds.push(indexId);
      }
    }

    return matchedIds;
  }

  /**
   * 获取所有书单列表（去重）
   */
  async getAllBooklists(): Promise<string[]> {
    const metadataMap = await this.getAllBooksMetadata();
    const booklists = new Set<string>();

    for (const meta of metadataMap.values()) {
      for (const bl of meta.booklists) {
        booklists.add(bl);
      }
    }

    return Array.from(booklists).sort();
  }

  /**
   * 获取所有标签列表（去重）
   */
  async getAllTags(): Promise<string[]> {
    const metadataMap = await this.getAllBooksMetadata();
    const tags = new Set<string>();

    for (const meta of metadataMap.values()) {
      for (const tag of meta.tags) {
        tags.add(tag);
      }
    }

    return Array.from(tags).sort();
  }
}
