/**
 * 阅读入口管理服务
 *
 * 管理 DeepPDF 阅读入口文档和书籍笔记
 */

import { App, Notice, TFile, normalizePath } from "obsidian";
import { DeepPDFClient, ReadingProgress } from "../api/http-client";

// 阅读入口目录名
const DEEPPDF_DIR = "DeepPDF";
const ENTRY_FILE = "📚 阅读入口.md";

// 书籍笔记 frontmatter 结构
interface BookFrontmatter {
  index_id: string;
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
   */
  private getBookNotePath(bookName: string): string {
    // 清理文件名中的非法字符
    const safeName = bookName.replace(/[\\/:"*?<>|]/g, "_");
    return normalizePath(`${DEEPPDF_DIR}/${safeName}.md`);
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
file: DeepPDF
fields:
  - name: 书名
    type: text
  - name: 状态
    type: select
    options: [未开始, 阅读中, 已完成]
  - name: 进度
    type: number
  - name: 总页数
    type: number
  - name: 最后阅读
    type: date
  - name: 对话轮数
    type: number
  - name: 标签
    type: multiselect
  - name: 操作
    type: text
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
    totalPages: number
  ): string {
    const now = new Date().toISOString().split("T")[0];

    return `---
index_id: ${indexId}
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

> [!note] AI 生成摘要
> 摘要生成中...（首次对话后将自动生成）

## 📑 章节目录

（待生成）

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
    totalPages: number
  ): Promise<string> {
    await this.ensureDir();
    const notePath = this.getBookNotePath(bookName);

    let file = this.app.vault.getAbstractFileByPath(notePath);

    if (!file) {
      // 创建书籍笔记
      const content = this.generateBookNoteContent(bookName, indexId, totalPages);
      file = await this.app.vault.create(notePath, content);
      console.log(`[DeepPDF] Created book note: ${notePath}`);
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

    // 更新 frontmatter
    const frontmatter: BookFrontmatter = {
      index_id: progress.index_id,
      status: progress.progress === 0 ? "unread" :
              progress.progress >= 100 ? "completed" : "reading",
      progress: Math.round(progress.progress),
      total_pages: progress.total_pages,
      read_pages: progress.read_pages.join(","),
      last_read: progress.last_read_at,
      chat_rounds: progress.chat_rounds,
      tags: [],
      created: new Date().toISOString().split("T")[0],
    };

    // 使用 processFrontmatter 更新
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      Object.assign(fm, frontmatter);
    });
  }
}
