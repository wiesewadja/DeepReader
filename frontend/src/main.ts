import { Plugin, PluginSettingTab, App, Setting, WorkspaceLeaf, Notice, MarkdownView, TFile } from "obsidian";
import { SidebarView, SIDEBAR_VIEW_TYPE } from "./views/sidebar-view.js";
import { DeepPDFClient } from "./api/http-client.js";
import { serviceLog, warn, error } from "./utils/logger.js";
import { ReadingModeService, type ReadingModeCallbacks, type HighlightColorId } from './components/reading-mode/index.js';
import { BUILT_IN_SKILLS } from './built-in-skills.js';
import { FrontendAgent } from './agent/index.js';
import {
    updateReadingProgress,
    extractChapterIndexFromNodeId,
    FAMILIARITY_DELTAS,
} from './agent/utils/book-note.js';

// 使用 service 模块日志器
const log = serviceLog;

interface DeepPDFSettings {
    apiPort: number;
    maxResults: number;
    deepseekApiKey: string;
    openaiApiKey: string;
    llmProvider: string;
    llmModel: string;
    apiUrl: string;
    maxPagesPerNode: number;
    maxTokensPerNode: number;
    ifAddNodeSummary: boolean;
    lastSelectedIndexId: string;
    forceMode: string;  // 强制路由模式：auto(默认) | fast | section | slow
    // 跨书籍模式状态
    lastCrossBookMode: boolean;  // 上次是否处于跨书籍模式
    lastCrossBookSessionId: string;  // 跨书籍模式的会话ID
    chatCache?: Record<string, any>;  // 对话缓存
    enableDebugLog: boolean;  // 是否启用调试日志
    // 深度思考模式（LLM 树搜索）
    lastDeepSearchMode: boolean;  // 上次是否启用深度思考模式
    // 阅读模式设置
    autoEnableReadingMode: boolean;  // 自动进入阅读模式（默认开启）
}

const DEFAULT_SETTINGS: DeepPDFSettings = {
    apiPort: 6088,
    maxResults: 5,
    deepseekApiKey: "",
    openaiApiKey: "",
    llmProvider: "deepseek",
    llmModel: "deepseek-chat",
    apiUrl: "",
    maxPagesPerNode: 10,
    maxTokensPerNode: 20000,
    ifAddNodeSummary: true,
    lastSelectedIndexId: "",
    forceMode: "auto",  // 默认使用自动路由
    lastCrossBookMode: false,  // 默认不启用跨书籍模式
    lastCrossBookSessionId: "",  // 跨书籍会话ID
    enableDebugLog: false,  // 默认关闭调试日志
    lastDeepSearchMode: false,  // 默认不启用深度思考模式
    // 阅读模式默认值
    autoEnableReadingMode: true,  // 默认自动进入阅读模式
};

export default class DeepPDFPlugin extends Plugin {
    settings: DeepPDFSettings;
    apiClient: DeepPDFClient | null = null;
    readingModeService: ReadingModeService | null = null;
    frontendAgent: FrontendAgent | null = null;
    private skillsDir: string = '';

    async onload() {
        await this.loadSettings();

        // 日志系统默认开启，通过模块开关控制输出
        log('Loading plugin');

        // 初始化 DeepReader 目录和图书管理文档
        await this.ensureInitialization();

        // 同步 Skills 到 vault（插件启动时执行）
        await this.syncSkillsToVault();

        // 初始化 FrontendAgent（插件启动时初始化）
        await this.getFrontendAgent();

        // 初始化 HTTP 客户端（连接到本地 localhost）
        this.apiClient = new DeepPDFClient(this.settings.apiPort);

        // 异步检查服务器连接状态（不阻塞插件加载）
        this.checkServerConnection();

        // 注册侧边栏视图（必须在 activateView 之前）
        this.registerView(
            SIDEBAR_VIEW_TYPE,
            (leaf) => new SidebarView(leaf, this.apiClient, this)
        );

        // 自动打开侧边栏（延迟执行，等待 workspace 完全初始化）
        // 使用 onLayoutReady 确保 workspace DOM 结构已就绪
        this.app.workspace.onLayoutReady(() => {
            this.activateView();
        });

        // 添加设置面板
        this.addSettingTab(new DeepPDFSettingTab(this.app, this));

        // 添加 Ribbon 图标 - 使用读书郎图标
        this.addRibbonIcon("lucide-book-open", "DeepPDF", () => {
            this.activateView();
        });

        // 添加命令
        this.addCommand({
            id: "open-deepreader-sidebar",
            name: "Open DeepReader sidebar",
            callback: () => this.activateView()
        });

        // Skills 重载命令
        this.addCommand({
            id: "reload-skills",
            name: "Reload DeepReader Skills",
            callback: async () => {
                try {
                    new Notice("正在重载 Skills...");
                    const result = await this.reloadSkills();
                    if (result.success) {
                        new Notice(`Skills 重载成功！共加载 ${result.skills.length} 个技能`);
                        log('[DeepReader] Skills reloaded:', result.skills);
                    } else {
                        new Notice(`Skills 重载失败: ${result.message}`);
                    }
                } catch (err) {
                    log.error('[DeepReader] Failed to reload skills:', err);
                    new Notice(`Skills 重载失败: ${err instanceof Error ? err.message : String(err)}`);
                }
            }
        });

        // 调试命令：发送测试消息
        this.addCommand({
            id: "debug-send-message",
            name: "Debug: Send test message",
            callback: () => {
                this.sendTestMessage("这本书主要讲了什么");
            }
        });

        // 调试命令：测试分析阅读工具
        this.addCommand({
            id: "debug-analytical-reading",
            name: "Debug: Test analytical reading tools",
            callback: () => {
                this.sendTestMessage("分析这本书的整体结构和纲要");
            }
        });

        // 调试命令：测试主题阅读
        this.addCommand({
            id: "debug-syntopical-reading",
            name: "Debug: Test syntopical reading",
            callback: () => {
                this.sendTestMessage("在已读书中搜索关于经济危机的内容");
            }
        });

        // Add command - AI format current document
        this.addCommand({
            id: "format-current-document",
            name: "AI format current document",
            callback: async () => {
                const file = this.app.workspace.getActiveFile();
                if (!file || file.extension.toLowerCase() !== 'md') {
                    new Notice("This command only works for Markdown files");
                    return;
                }
                // Get editor from active view
                const view = this.app.workspace.getActiveViewOfType(MarkdownView);
                if (!view) {
                    new Notice("No active Markdown view");
                    return;
                }
                const editor = view.editor;
                await this.formatCurrentDocument(file, editor);
            }
        });

        // 注册 URI 协议处理器 - 单书籍对话
        this.registerObsidianProtocolHandler("deepreader-chat", async (params) => {
            log("[DeepReader] URI handler called with params:", params);

            const indexId = params.index_id;
            if (!indexId) {
                new Notice("DeepReader: 缺少 index_id 参数");
                return;
            }

            // 先重置跨书籍模式状态，确保打开侧边栏时不会恢复跨书籍模式
            this.settings.lastCrossBookMode = false;
            this.settings.lastCrossBookSessionId = "";
            await this.saveSettings();

            // 打开侧边栏
            this.activateView();

            // 等待视图加载（增加延迟确保 renderMainUI 完成）
            setTimeout(() => {
                // 通过事件通知侧边栏切换到指定索引
                this.app.workspace.trigger("deeppdf:select-index", indexId);
            }, 300);
        });

        // 注册 URI 协议处理器 - 跨书籍搜索（支持书单/标签过滤）
        this.registerObsidianProtocolHandler("deepreader-search", async (params) => {
            log("[DeepReader] deepreader-search URI handler called with params:", params);

            // 解析书单和标签参数（逗号分隔）
            const booklists = params.booklists ? params.booklists.split(",").map(s => decodeURIComponent(s.trim())) : [];
            const tags = params.tags ? params.tags.split(",").map(s => decodeURIComponent(s.trim())) : [];

            // 打开侧边栏
            this.activateView();

            // 等待视图加载
            setTimeout(() => {
                // 通过事件通知侧边栏启动跨书籍搜索
                this.app.workspace.trigger("deeppdf:cross-book-search", { booklists, tags });
            }, 100);
        });

        // 注册 URI 协议处理器 - 主题报告
        this.registerObsidianProtocolHandler("deepreader-theme-report", async (params) => {
            log("[DeepReader] deepreader-theme-report URI handler called");

            // 打开侧边栏
            this.activateView();

            // 等待视图加载
            setTimeout(() => {
                // 通过事件通知侧边栏打开主题报告
                this.app.workspace.trigger("deeppdf:theme-report");
            }, 100);
        });

        // 初始化阅读模式服务
        const readingModeCallbacks: ReadingModeCallbacks = {
            onQuote: (text: string) => {
                this.activateView();
                setTimeout(() => {
                    this.app.workspace.trigger('deeppdf:quote-selection', text);
                }, 100);
            },
            onExcerpt: (text: string, range: Range) => {
                this.app.workspace.trigger('deeppdf:excerpt-selection', text, range);
            },
            onSaveHighlight: async (text: string, color: HighlightColorId) => {
                await this.saveHighlightToFile(text, color);
            },
            onRemoveHighlight: async (text: string) => {
                await this.removeHighlightFromFile(text);
            },
            onBookDetected: (indexId: string, bookName: string) => {
                // 检测到书籍章节，自动切换到对应书籍的聊天记录
                this.switchToBook(indexId, bookName);
            },
        };
        this.readingModeService = new ReadingModeService(this.app, readingModeCallbacks);

        // 应用自动阅读模式设置
        this.readingModeService.setAutoEnable(this.settings.autoEnableReadingMode);

        this.readingModeService.start();
        serviceLog('[DeepPDF] Reading mode service started');
    }

    /**
     * 分离 Markdown 文件的 frontmatter 和 body
     * @returns { frontmatter, body, hasFrontmatter } 如果没有 frontmatter，frontmatter 为空字符串
     */
    private splitFrontmatter(content: string): { frontmatter: string; body: string; hasFrontmatter: boolean } {
        const match = content.match(/^(---\n[\s\S]*?\n---)(\n*)/);
        if (match) {
            return {
                frontmatter: match[0],
                body: content.slice(match[0].length),
                hasFrontmatter: true,
            };
        }
        return {
            frontmatter: '',
            body: content,
            hasFrontmatter: false,
        };
    }

    /**
     * 保存高亮到文件
     * 多行文本分行处理，每行独立高亮但使用同一颜色
     */
    private async saveHighlightToFile(text: string, color: HighlightColorId): Promise<void> {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice("无法保存高亮：没有活动文件");
            return;
        }

        try {
            const content = await this.app.vault.read(activeFile);

            // 分离 frontmatter 和 body，只在 body 中替换
            const { frontmatter, body, hasFrontmatter } = this.splitFrontmatter(content);
            const bgColor = this.getHighlightBgColor(color);

            // 将文本按行分割
            const lines = text.split('\n').filter(line => line.trim().length > 0);

            let newBody = body;
            let highlightedCount = 0;

            // 逐行处理高亮
            for (const line of lines) {
                const trimmedLine = line.trim();
                if (!trimmedLine) continue;

                // 使用新的查找方法
                const matchResult = this.findTextInMarkdown(newBody, trimmedLine);
                if (matchResult) {
                    const highlightedText = `<mark style="background: ${bgColor}">${matchResult.matched}</mark>`;
                    newBody = newBody.substring(0, matchResult.index) + highlightedText + newBody.substring(matchResult.index + matchResult.matched.length);
                    highlightedCount++;
                }
            }

            if (highlightedCount === 0) {
                new Notice("无法保存高亮：未找到文本");
                return;
            }

            const newContent = hasFrontmatter ? frontmatter + newBody : newBody;
            await this.app.vault.modify(activeFile, newContent);
            log('[DeepPDF] Highlight saved:', highlightedCount, 'lines with color:', color);

            // 更新阅读进度（高亮触发 +2）
            await this.updateFamiliarityForHighlight(activeFile.path);

        } catch (err) {
            log.error('[DeepPDF] Failed to save highlight:', err);
            new Notice("保存高亮失败");
        }
    }

    /**
     * 高亮时更新章节熟悉度
     */
    private async updateFamiliarityForHighlight(filePath: string): Promise<void> {
        try {
            // 从文件路径提取书名和章节索引
            // 路径格式: DeepReader/书名/00-章节名.md
            const pathParts = filePath.split('/');
            if (pathParts.length < 3 || pathParts[0] !== 'DeepReader') {
                return; // 不是书籍笔记，跳过
            }

            const bookName = pathParts[1];
            const fileName = pathParts[pathParts.length - 1];

            // 从文件名提取章节索引
            const chapterIndex = extractChapterIndexFromNodeId(fileName.replace('.md', ''));
            if (chapterIndex === null) {
                return;
            }

            // 更新阅读进度
            const indexId = bookName; // 简化处理
            const totalChapters = 100; // 默认值
            const success = await updateReadingProgress(
                this.app,
                bookName,
                indexId,
                totalChapters,
                chapterIndex,
                FAMILIARITY_DELTAS.highlight // +2
            );

            if (success) {
                log('[DeepPDF] 熟悉度更新成功（高亮）:', bookName, '章节', chapterIndex);
            }
        } catch (err) {
            // 熟悉度更新失败不影响主流程
            log('[DeepPDF] 熟悉度更新失败（高亮）:', err);
        }
    }

    /**
     * 在 markdown 内容中查找纯文本
     * 支持处理 **、__、*、_、[[]] 等标记
     */
    private findTextInMarkdown(content: string, plainText: string): { matched: string, index: number } | null {
        // 1. 先尝试精确匹配
        const exactIndex = content.indexOf(plainText);
        if (exactIndex !== -1) {
            return { matched: plainText, index: exactIndex };
        }

        // 2. 尝试在整体前后加可选的 markdown 标记
        // 例如："国家和教会分离" -> "**国家和教会分离**"
        const escaped = this.escapeRegex(plainText);
        const wrappedPatterns = [
            '(\\*\\*)' + escaped + '(\\*\\*)',      // **text**
            '(__)' + escaped + '(__)',              // __text__
            '(\\*)' + escaped + '(\\*)',            // *text*
            '(_)' + escaped + '(_)',                // _text_
            '(\\[\\[)' + escaped + '(\\]\\])',      // [[text]]
            '(`)' + escaped + '(`)',                // `text`
        ];

        for (const pattern of wrappedPatterns) {
            const regex = new RegExp(pattern, 's');
            const match = content.match(regex);
            if (match) {
                return {
                    matched: match[0],
                    index: match.index!
                };
            }
        }

        // 3. 尝试部分匹配：文本的一部分可能被标记包裹
        // 例如："国家和教会分离：利用..." 可能是 "**国家和教会分离**：利用..."
        const punctIndex = plainText.search(/[：:，,。！？、；;\s]/);
        if (punctIndex > 0) {
            const beforePunct = plainText.substring(0, punctIndex);
            const afterPunct = plainText.substring(punctIndex);

            const beforeEscaped = this.escapeRegex(beforePunct);
            const afterEscaped = this.escapeRegex(afterPunct);

            const partialPatterns = [
                '(\\*\\*)' + beforeEscaped + '(\\*\\*)' + afterEscaped,
                '(__)' + beforeEscaped + '(__)' + afterEscaped,
                '(\\*)' + beforeEscaped + '(\\*)' + afterEscaped,
                '(_)' + beforeEscaped + '(_)' + afterEscaped,
            ];

            for (const pattern of partialPatterns) {
                const regex = new RegExp(pattern, 's');
                const match = content.match(regex);
                if (match) {
                    return {
                        matched: match[0],
                        index: match.index!
                    };
                }
            }
        }

        // 4. 尝试中间被标记包裹的情况
        // 例如："揭示了文化可以转化为硬实力和政治优势" -> "揭示了**文化可以转化为硬实力和政治优势**"
        // 在文本开头和结尾寻找可能的分割点
        const middleMatch = this.findMiddleMarkdownMatch(content, plainText);
        if (middleMatch) {
            return middleMatch;
        }

        return null;
    }

    /**
     * 查找中间被 markdown 标记包裹的文本
     * 例如："prefix + text + suffix" -> "prefix + **text** + suffix"
     */
    private findMiddleMarkdownMatch(content: string, plainText: string): { matched: string, index: number } | null {
        // 尝试从开头逐步增加前缀长度，寻找被标记包裹的部分
        for (let i = 1; i < plainText.length - 1; i++) {
            const prefix = plainText.substring(0, i);
            const rest = plainText.substring(i);

            // 如果 rest 以标点或空格开头，跳过（这种情况已经在前面处理过了）
            if (/^[：:，,。！？、；;\s]/.test(rest)) {
                continue;
            }

            const prefixEscaped = this.escapeRegex(prefix);
            const restEscaped = this.escapeRegex(rest);

            // 尝试 rest 部分被标记包裹
            const patterns = [
                prefixEscaped + '(\\*\\*)' + restEscaped + '(\\*\\*)',
                prefixEscaped + '(__)' + restEscaped + '(__)',
                prefixEscaped + '(\\*)' + restEscaped + '(\\*)',
                prefixEscaped + '(_)' + restEscaped + '(_)',
                prefixEscaped + '(\\[\\[)' + restEscaped + '(\\]\\])',
            ];

            for (const pattern of patterns) {
                const regex = new RegExp(pattern, 's');
                const match = content.match(regex);
                if (match) {
                    return {
                        matched: match[0],
                        index: match.index!
                    };
                }
            }
        }

        return null;
    }

    /**
     * 从文件中移除高亮
     * 检测相邻的段落/列表项是否也有相同颜色的高亮，一并移除
     */
    private async removeHighlightFromFile(text: string): Promise<void> {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            return;
        }

        try {
            const content = await this.app.vault.read(activeFile);

            // 分离 frontmatter 和 body，只在 body 中移除
            const { frontmatter, body, hasFrontmatter } = this.splitFrontmatter(content);

            // 首先找到当前文本所在的高亮标签，获取其颜色
            const colorInfo = this.findHighlightColor(body, text);
            if (!colorInfo) {
                log('[DeepPDF] No highlight found for text');
                return;
            }

            const { bgColor, matchedText } = colorInfo;

            // 移除当前高亮
            let newBody = body;
            const escapedMatched = this.escapeRegex(matchedText);
            const currentMarkRegex = new RegExp(`<mark style="background: ${this.escapeRegex(bgColor)}">${escapedMatched}</mark>`, 's');
            newBody = newBody.replace(currentMarkRegex, matchedText);

            // 检测并移除相邻的相同颜色高亮（列表项或段落）
            newBody = this.removeAdjacentHighlights(newBody, bgColor);

            const newContent = hasFrontmatter ? frontmatter + newBody : newBody;
            await this.app.vault.modify(activeFile, newContent);
            log('[DeepPDF] Highlight removed from file');
        } catch (err) {
            log.error('[DeepPDF] Failed to remove highlight:', err);
        }
    }

    /**
     * 查找文本所在高亮的颜色
     */
    private findHighlightColor(body: string, text: string): { bgColor: string, matchedText: string } | null {
        // 尝试精确匹配
        const exactRegex = new RegExp(`<mark style="background: ([^"]*)">${this.escapeRegex(text)}</mark>`, 's');
        const exactMatch = body.match(exactRegex);
        if (exactMatch) {
            return { bgColor: exactMatch[1], matchedText: text };
        }

        // 尝试模糊匹配
        const matchResult = this.findTextInMarkdown(body, text);
        if (matchResult) {
            const fuzzyRegex = new RegExp(`<mark style="background: ([^"]*)">${this.escapeRegex(matchResult.matched)}</mark>`, 's');
            const fuzzyMatch = body.match(fuzzyRegex);
            if (fuzzyMatch) {
                return { bgColor: fuzzyMatch[1], matchedText: matchResult.matched };
            }
        }

        return null;
    }

    /**
     * 移除相邻的相同颜色高亮
     * 检测连续的列表项（1. 2. 3. 或 - *）或段落是否有相同颜色的高亮
     */
    private removeAdjacentHighlights(body: string, bgColor: string): string {
        const escapedBgColor = this.escapeRegex(bgColor);

        // 对于每个匹配到的行，检查是否是目标颜色，如果是则移除
        // 使用简单的逐行处理
        const lines = body.split('\n');
        const processedLines: string[] = [];

        for (const line of lines) {
            // 检查这行是否有目标颜色的高亮
            const highlightRegex = new RegExp(`<mark style="background: ${escapedBgColor}">([^<]+)</mark>`, 'g');

            if (highlightRegex.test(line)) {
                // 移除该行的高亮标签
                const cleanLine = line.replace(highlightRegex, '$1');
                processedLines.push(cleanLine);
            } else {
                processedLines.push(line);
            }
        }

        return processedLines.join('\n');
    }

    /**
     * 获取高亮背景颜色
     */
    private getHighlightBgColor(color: HighlightColorId): string {
        const colors: Record<HighlightColorId, string> = {
            yellow: 'rgba(255, 235, 59, 0.5)',
            green: 'rgba(76, 175, 80, 0.4)',
            blue: 'rgba(33, 150, 243, 0.4)',
            pink: 'rgba(233, 30, 99, 0.4)',
            orange: 'rgba(255, 152, 0, 0.4)',
        };
        return colors[color] || colors.yellow;
    }

    /**
     * 转义正则表达式特殊字符
     */
    private escapeRegex(str: string): string {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    /**
     * 确保初始化完成：创建 DeepReader 目录和图书管理文档
     */
    private async ensureInitialization(): Promise<void> {
        const DEEPPDF_DIR = "DeepReader";
        const BOOK_MANAGEMENT_FILE = "📚 我的书架.md";

        try {
            // 1. 确保 DeepReader 目录存在
            const dirExists = await this.app.vault.adapter.exists(DEEPPDF_DIR);
            if (!dirExists) {
                await this.app.vault.createFolder(DEEPPDF_DIR);
                log('[DeepPDF] Created DeepReader directory');
            }

            // 2. 确保图书管理文档存在（放在 vault 根目录）
            const bookManagementPath = BOOK_MANAGEMENT_FILE;
            const fileExists = await this.app.vault.adapter.exists(bookManagementPath);
            if (!fileExists) {
                const content = this.generateBookManagementContent();
                await this.app.vault.create(bookManagementPath, content);
                log('[DeepPDF] Created book management document');
            }
        } catch (err) {
            // 初始化失败不应阻止插件加载，只记录错误
            log.error('[DeepPDF] Initialization failed:', err);
        }
    }

    /**
     * 同步内置 Skills 到 vault
     * 在插件启动时执行，将硬编码的 Skills 写入 Obsidian vault
     */
    private async syncSkillsToVault(): Promise<void> {
        const SKILLS_DIR = "DeepReader/skills";

        // 保存 skillsDir 供后续使用
        // @ts-ignore - ObsidianFileSystemAdapter.getBasePath() 返回 string
        const vaultPath = this.app.vault.adapter.getBasePath() as string;
        const path = require('path') as typeof import('path');
        this.skillsDir = path.join(vaultPath, SKILLS_DIR);

        try {
            // 1. 确保 skills 目录存在
            const dirExists = await this.app.vault.adapter.exists(SKILLS_DIR);
            if (!dirExists) {
                await this.app.vault.createFolder(SKILLS_DIR);
                log('[DeepPDF] Created skills directory');
            }

            // 2. 写入内置 Skills（只写入不存在的文件，不覆盖用户修改）
            let createdCount = 0;

            for (const skill of BUILT_IN_SKILLS) {
                const targetPath = `${SKILLS_DIR}/${skill.filename}`;
                const targetExists = await this.app.vault.adapter.exists(targetPath);

                if (!targetExists) {
                    await this.app.vault.adapter.write(targetPath, skill.content);
                    createdCount++;
                    log('[DeepPDF] Created built-in skill:', skill.filename);
                }
            }

            if (createdCount > 0) {
                log(`[DeepPDF] Synced ${createdCount} built-in skills`);
            }
        } catch (err) {
            // Skills 同步失败不应阻止插件加载
            log.error('[DeepPDF] Skills sync failed:', err);
        }
    }

    /**
     * 获取或初始化 FrontendAgent
     */
    async getFrontendAgent(): Promise<FrontendAgent> {
        if (!this.frontendAgent) {
            this.frontendAgent = new FrontendAgent({
                apiKey: this.settings.deepseekApiKey || '',
                baseUrl: this.settings.apiUrl || undefined,
                model: this.settings.llmModel || 'deepseek-chat',
                skillsDir: this.skillsDir,
                app: this.app,
            });
            await this.frontendAgent.initialize();
            log('[DeepPDF] FrontendAgent initialized, skills:', this.frontendAgent.listSkills());
        }
        return this.frontendAgent;
    }

    /**
     * 重载 Skills
     */
    async reloadSkills(): Promise<{ success: boolean; message: string; skills: string[] }> {
        try {
            // 如果 Agent 已初始化，重载 skills
            if (this.frontendAgent) {
                await this.frontendAgent.reloadSkills();
                const skills = this.frontendAgent.listSkills();
                return { success: true, message: 'Skills 重载成功', skills };
            }
            // Agent 未初始化，下次使用时会自动加载最新 skills
            return { success: true, message: 'Skills 将在首次使用时加载', skills: [] };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { success: false, message, skills: [] };
        }
    }

    /**
     * 生成图书管理文档内容
     */
    private generateBookManagementContent(): string {
        const vaultName = encodeURIComponent(this.app.vault.getName());

        return `---
deeppdf_book_management: true
---

# 📚 我的书架

> 管理所有已上传的书籍，支持书单分类和标签过滤。


## 📖 书籍列表

### 📋 全部书籍

\`\`\`base
filters:
  and:
    - file.inFolder("DeepReader")
    - file.ext == "md"
    - file.hasProperty("cover")
formulas:
  status_label: if(status == "reading", "阅读中", if(status == "completed", "已完成", "未开始"))
  chat_link: link("obsidian://deepreader-chat?index_id=" + index_id, "对话")
  book_link: link(file.path, book_name)
properties:
  formula.book_link:
    displayName: 书名
  formula.chat_link:
    displayName: 操作
  booklists:
    displayName: 书单
  tags:
    displayName: 标签
  progress:
    displayName: 进度%
  formula.status_label:
    displayName: 状态
views:
  - type: cards
    name: 封面视图
    order:
      - formula.book_link
      - formula.status_label
      - formula.chat_link
      - booklists
      - tags
      - author
    image: cover
    cardSize: 230
    imageAspectRatio: 1.25
  - type: table
    name: 全部书籍
    order:
      - cover
      - formula.book_link
      - formula.chat_link
      - booklists
      - tags
      - progress
      - formula.status_label
\`\`\`

> 💡 点击「对话」可开始与 AI 讨论，在表格中直接编辑「书单」和「标签」列即可分类书籍


---

## 📊 快速操作

- [打开 DeepPDF 侧边栏](obsidian://open?vault=${vaultName}&command=deepreader:open-deepreader-sidebar)
- [跨书籍搜索（全部）](obsidian://deepreader-search)
`;
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    async formatCurrentDocument(file: any, editor: any) {
        if (!this.apiClient) {
            new Notice("API client not initialized");
            return;
        }

        try {
            new Notice("Formatting document...");
            const content = await this.app.vault.read(file);

            // Determine document type from file extension
            const docType = file.extension.toLowerCase() === 'epub' ? 'epub' : 'pdf';

            const result = await this.apiClient.formatSingleText(
                content,
                docType,
                this.settings.llmProvider
            );

            if (result.status === 'success' && result.formatted_text) {
                // Update editor content and save to file
                editor.setValue(result.formatted_text);
                await this.app.vault.modify(file, result.formatted_text);
                new Notice("Document formatted successfully");
            } else {
                new Notice("Formatting failed");
            }
        } catch (err) {
            log.error('Failed to format document:', err);
            new Notice(`Formatting failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    async onunload() {
        // 卸载时手动清理视图，虽然 Obsidian 会自动处理，但显式清理更安全
        this.app.workspace.detachLeavesOfType(SIDEBAR_VIEW_TYPE);

        // 清理阅读模式服务
        if (this.readingModeService) {
            this.readingModeService.stop();
            this.readingModeService = null;
        }
    }

    /**
     * 切换到指定书籍（自动检测到书籍章节时调用）
     */
    private async switchToBook(indexId: string, bookName: string): Promise<void> {
        log('[DeepPDF] Auto-switching to book:', bookName, 'indexId:', indexId);

        // 获取 sidebar view 实例
        const leaves = this.app.workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE);
        if (leaves.length === 0) {
            log('[DeepPDF] No sidebar view found, activating...');
            this.activateView();
            // 等待视图加载后再切换
            setTimeout(() => {
                this.performBookSwitch(indexId, bookName);
            }, 200);
            return;
        }

        // 视图已存在，直接切换
        await this.performBookSwitch(indexId, bookName);
    }

    /**
     * 执行书籍切换
     */
    private async performBookSwitch(indexId: string, bookName: string): Promise<void> {
        const leaves = this.app.workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE);
        if (leaves.length === 0) return;

        const view = leaves[0].view;
        if (view instanceof SidebarView) {
            // 如果有 indexId，检查是否已经是当前选中的书籍
            if (indexId) {
                const currentIndexId = view.getCurrentIndexId();
                if (currentIndexId === indexId) {
                    log('[DeepPDF] Already on the same book, skipping switch');
                    return;
                }
                // 直接通过 indexId 切换
                log('[DeepPDF] Switching to book by indexId:', indexId);
                await view.selectIndex(indexId);
            } else {
                // 没有 indexId，通过书名查找
                log('[DeepPDF] Switching to book by name:', bookName);
                await view.selectBookByName(bookName);
            }
        }
    }

    /**
     * 发送测试消息（用于调试状态显示）
     */
    async sendTestMessage(query: string): Promise<void> {
        log('[DeepPDF] sendTestMessage called with:', query);

        // 确保 sidebar 已打开
        const leaves = this.app.workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE);
        if (leaves.length === 0) {
            log('[DeepPDF] No sidebar view, activating...');
            this.activateView();
            await new Promise(resolve => setTimeout(resolve, 500));
        }

        // 重新获取 leaves
        const activeLeaves = this.app.workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE);
        if (activeLeaves.length === 0) {
            new Notice("无法打开侧边栏");
            return;
        }

        const view = activeLeaves[0].view as SidebarView;

        // 使用 public 方法发送消息
        log('[DeepPDF] Calling view.sendMessageWithInput...');
        await view.sendMessageWithInput(query);
    }

    activateView() {
        const { workspace } = this.app;

        let leaf: WorkspaceLeaf | null = null;

        const leaves = workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE);

        if (leaves.length > 0) {
            leaf = leaves[0];
        } else {
            leaf = workspace.getRightLeaf(false);
            if (!leaf) return;
            leaf.setViewState({
                type: SIDEBAR_VIEW_TYPE,
                active: true
            });
        }

        if (leaf) {
            workspace.revealLeaf(leaf);
        }
    }

    /**
     * 异步检查服务器连接状态（不阻塞插件加载）
     */
    private checkServerConnection(): void {
        // 异步检查，不阻塞插件加载
        // 后端是可选的，连接状态通过 UI 指示器显示，不需要 Notice 弹窗
        if (!this.apiClient) {
            log('API client not initialized');
            return;
        }

        this.apiClient.healthCheck()
            .then(isHealthy => {
                if (!isHealthy) {
                    log('Server not running or unhealthy at localhost:' + this.settings.apiPort);
                } else {
                    log('Server connected successfully');
                }
            })
            .catch(err => {
                // 静默处理，后端是可选的
                log.warn('Failed to connect to server:', err);
            });
    }
}

class DeepPDFSettingTab extends PluginSettingTab {
    plugin: DeepPDFPlugin;

    constructor(app: App, plugin: DeepPDFPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'API Server 设置' });

        new Setting(containerEl)
            .setName("API Port")
            .setDesc("FastAPI 服务器端口（默认 localhost:6088）")
            .addText(text => text
                .setPlaceholder("6088")
                .setValue(String(this.plugin.settings.apiPort))
                .onChange(async (value) => {
                    this.plugin.settings.apiPort = parseInt(value) || 6088;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("Max Results")
            .setDesc("Maximum number of results to return")
            .addSlider(slider => slider
                .setLimits(1, 20, 1)
                .setValue(this.plugin.settings.maxResults)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.maxResults = value;
                    await this.plugin.saveSettings();
                }));

        containerEl.createEl('h2', { text: 'LLM API 设置' });

        new Setting(containerEl)
            .setName("LLM Provider")
            .setDesc("Select LLM provider for PDF indexing")
            .addDropdown(dropdown => dropdown
                .addOption("deepseek", "DeepSeek")
                .addOption("openai", "OpenAI")
                .addOption("google", "Google")
                .addOption("custom", "Custom")
                .setValue(this.plugin.settings.llmProvider)
                .onChange(async (value) => {
                    this.plugin.settings.llmProvider = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("LLM Model")
            .setDesc("Model name to use (e.g., deepseek-chat, gpt-4)")
            .addText(text => text
                .setPlaceholder("deepseek-chat")
                .setValue(this.plugin.settings.llmModel)
                .onChange(async (value) => {
                    this.plugin.settings.llmModel = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("DeepSeek API Key")
            .setDesc("DeepSeek API key for LLM indexing")
            .addText(text => text
                .setPlaceholder("sk-...")
                .setValue(this.plugin.settings.deepseekApiKey)
                .onChange(async (value) => {
                    this.plugin.settings.deepseekApiKey = value;
                    await this.plugin.saveSettings();
                }))
            .then(setting => {
                const inputEl = setting.controlEl.querySelector('input');
                if (inputEl) inputEl.type = 'password';
            });

        new Setting(containerEl)
            .setName("OpenAI API Key")
            .setDesc("OpenAI API key (for OpenAI provider)")
            .addText(text => text
                .setPlaceholder("sk-...")
                .setValue(this.plugin.settings.openaiApiKey)
                .onChange(async (value) => {
                    this.plugin.settings.openaiApiKey = value;
                    await this.plugin.saveSettings();
                }))
            .then(setting => {
                const inputEl = setting.controlEl.querySelector('input');
                if (inputEl) inputEl.type = 'password';
            });

        new Setting(containerEl)
            .setName("API Base URL")
            .setDesc("Custom API endpoint (optional, for custom provider)")
            .addText(text => text
                .setPlaceholder("https://api.example.com/v1")
                .setValue(this.plugin.settings.apiUrl)
                .onChange(async (value) => {
                    this.plugin.settings.apiUrl = value;
                    await this.plugin.saveSettings();
                }));

        containerEl.createEl('h2', { text: 'PDF 索引设置' });

        new Setting(containerEl)
            .setName("Max Pages Per Node")
            .setDesc("Maximum pages per section node")
            .addSlider(slider => slider
                .setLimits(1, 50, 1)
                .setValue(this.plugin.settings.maxPagesPerNode)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.maxPagesPerNode = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("Max Tokens Per Node")
            .setDesc("Maximum tokens per section node")
            .addSlider(slider => slider
                .setLimits(1000, 50000, 1000)
                .setValue(this.plugin.settings.maxTokensPerNode)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    this.plugin.settings.maxTokensPerNode = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("Add Node Summary")
            .setDesc("Use LLM to generate section summaries")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.ifAddNodeSummary)
                .onChange(async (value) => {
                    this.plugin.settings.ifAddNodeSummary = value;
                    await this.plugin.saveSettings();
                }));

        containerEl.createEl('h2', { text: '高级选项' });

        new Setting(containerEl)
            .setName("强制路由模式")
            .setDesc("强制指定 Agent 路由模式。auto=根据查询自动选择，fast=仅快速检索，section=优先页面读取，slow=完全分析")
            .addDropdown(dropdown => dropdown
                .addOption("auto", "自动路由（推荐）")
                .addOption("fast", "快速检索（仅搜索）")
                .addOption("section", "章节优先（搜索+页面读取）")
                .addOption("slow", "完全分析（所有工具）")
                .setValue(this.plugin.settings.forceMode)
                .onChange(async (value) => {
                    this.plugin.settings.forceMode = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName("启用调试日志")
            .setDesc("开启后会在控制台输出详细运行日志，用于问题排查。默认关闭以减少日志噪音。")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableDebugLog)
                .onChange(async (value) => {
                    this.plugin.settings.enableDebugLog = value;
                    await this.plugin.saveSettings();
                }));

               // 道阅读模式设置区域
        containerEl.createEl('h2', { text: '阅读模式' });

        new Setting(containerEl)
            .setName("自动进入阅读模式")
            .setDesc("打开 DeepReader 章节文件时自动进入沉浸式阅读模式")
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoEnableReadingMode)
                .onChange(async (value) => {
                    this.plugin.settings.autoEnableReadingMode = value;
                    await this.plugin.saveSettings();
                    this.plugin.readingModeService?.setAutoEnable(value);
                }));

        // 添加说明文字
        containerEl.createEl('p', {
            text: '提示：关闭后，打开章节文件将使用普通编辑模式，启用后则进入沉浸式阅读模式。',
            cls: 'setting-item-description'
        });

        // Skills 管理区域
        containerEl.createEl('h2', { text: 'Skills 管理' });

        new Setting(containerEl)
            .setName("重载 Skills")
            .setDesc("重新加载所有 Skills（包括内置和用户自定义）。当你添加了新的 Skill 文件后，点击此按钮使其生效。")
            .addButton(button => button
                .setButtonText("重载 Skills")
                .setCta()
                .onClick(async () => {
                    try {
                        button.setDisabled(true);
                        button.setButtonText("重载中...");
                        const result = await this.plugin.reloadSkills();
                        button.setDisabled(false);
                        button.setButtonText("重载 Skills");
                        if (result.success) {
                            new Notice(`Skills 重载成功！共加载 ${result.skills.length} 个技能`);
                        } else {
                            new Notice(`Skills 重载失败: ${result.message}`);
                        }
                    } catch (err) {
                        button.setDisabled(false);
                        button.setButtonText("重载 Skills");
                        const errMsg = err instanceof Error ? err.message : String(err);
                        new Notice(`Skills 重载失败: ${errMsg}`);
                    }
                }));

        containerEl.createEl('p', {
            text: '提示：你也可以通过命令面板（Cmd/Ctrl+P）搜索"Reload DeepReader Skills"来重载。',
            cls: 'setting-item-description'
        });
    }
}
