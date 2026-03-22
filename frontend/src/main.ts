import { Plugin, WorkspaceLeaf, Notice, MarkdownView } from "obsidian";
import { SidebarView, SIDEBAR_VIEW_TYPE } from "./views/sidebar-view.js";
import { DeepPDFClient } from "./api/http-client.js";
import { serviceLog } from "./utils/logger.js";
import { ReadingModeService, type ReadingModeCallbacks, type HighlightColorId } from './components/reading-mode/index.js';
import { BUILT_IN_SKILLS } from './built-in-skills.js';
import { FrontendAgent } from './agent/index.js';
import { DeepPDFSettings, DEFAULT_SETTINGS } from './config/settings.js';
import { getProviderConfig, PROVIDER_LABELS } from './config/providers.js';
import { DeepPDFSettingTab } from './settings/setting-tab.js';

// 使用 service 模块日志器
const log = serviceLog;

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

        // 调试命令：测试知识图谱/思维导图 skill（用于性能分析）
        this.addCommand({
            id: "debug-mindmap-skill",
            name: "Debug: Test mindmap skill",
            callback: () => {
                this.sendTestMessage("帮我整理这本书的整体框架，画一个思维导图");
            }
        });

        // 调试命令：测试知识卡片 skill（用于性能分析 write_note）
        this.addCommand({
            id: "debug-knowledge-cards",
            name: "Debug: Test knowledge cards skill",
            callback: () => {
                this.sendTestMessage("帮我提取这本书的核心概念，生成知识卡片");
            }
        });

        // Excalidraw 命令 - 导出当前 Canvas 到 Excalidraw
        this.addCommand({
            id: "export-canvas-to-excalidraw",
            name: "Export Canvas to Excalidraw",
            checkCallback: (checking: boolean) => {
                const file = this.app.workspace.getActiveFile();
                if (file && file.extension === 'canvas') {
                    if (!checking) {
                        this.exportCanvasToExcalidraw(file.path);
                    }
                    return true;
                }
                return false;
            }
        });

        // Excalidraw 命令 - 检查 Excalidraw 插件状态
        this.addCommand({
            id: "check-excalidraw-status",
            name: "Check Excalidraw Plugin Status",
            callback: () => {
                const ea = (window as any).ExcalidrawAutomate;
                if (ea) {
                    new Notice(`Excalidraw 插件已安装 (版本: ${ea.version || '未知'})`);
                } else {
                    new Notice("Excalidraw 插件未安装。请在社区插件市场安装 Excalidraw 插件。");
                }
            }
        });

        // 调试命令：抓取系统提示词
        this.addCommand({
            id: "dump-system-prompt",
            name: "Debug: Dump System Prompt",
            callback: async () => {
                try {
                    // 获取当前选中的书籍信息
                    const leaves = this.app.workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE);
                    if (leaves.length === 0) {
                        new Notice("请先打开 DeepReader 侧边栏");
                        return;
                    }

                    const sidebarView = leaves[0].view as SidebarView;
                    const currentBook = sidebarView.getCurrentBookInfo?.();

                    if (!currentBook?.title) {
                        new Notice("请先选择一本书籍");
                        return;
                    }

                    new Notice(`正在抓取《${currentBook.title}》的系统提示词...`);

                    const agent = await this.getFrontendAgent();
                    const systemPrompt = await agent.getSystemPromptAsync(
                        { title: currentBook.title, page_count: currentBook.page_count },
                        currentBook.docDescription ?? undefined
                    );

                    // 确保调试目录存在
                    const debugDir = 'DeepReader/debug';
                    const dirExists = await this.app.vault.adapter.exists(debugDir);
                    if (!dirExists) {
                        await this.app.vault.createFolder(debugDir);
                    }

                    // 保存到调试目录
                    const filename = `system-prompt-${Date.now()}.md`;
                    const bookInfo = `<!-- 书籍: ${currentBook.title} -->\n<!-- 生成时间: ${new Date().toISOString()} -->\n\n`;
                    await this.app.vault.create(`${debugDir}/${filename}`, bookInfo + systemPrompt);

                    // 打印到控制台
                    console.log('%c' + '='.repeat(80), 'color: #4CAF50; font-weight: bold');
                    console.log(`%c系统提示词 - 《${currentBook.title}》`, 'color: #4CAF50; font-weight: bold; font-size: 14px');
                    console.log('%c' + '='.repeat(80), 'color: #4CAF50; font-weight: bold');
                    console.log('%c' + systemPrompt, 'color: #2196F3; font-family: monospace; font-size: 12px');
                    console.log('%c' + '='.repeat(80), 'color: #4CAF50; font-weight: bold');
                    console.log(`%c提示词长度: ${systemPrompt.length} 字符`, 'color: #9E9E9E');

                    new Notice(`系统提示词已保存到 DeepReader/debug/${filename}`);
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    new Notice(`抓取失败: ${msg}`);
                    console.error('[DumpSystemPrompt] 错误:', err);
                }
            }
        });

        // 调试命令：测试 Excalidraw 思维导图生成
        this.addCommand({
            id: "debug-excalidraw-mindmap",
            name: "Debug: Test Excalidraw mindmap",
            callback: async () => {
                const ea = (window as any).ExcalidrawAutomate;
                if (!ea) {
                    new Notice("Excalidraw 插件未安装");
                    return;
                }

                try {
                    new Notice("正在生成测试思维导图...");

                    // 创建新文件
                    await ea.create({
                        filename: "test-mindmap",
                        foldername: "DeepReader/Excalidraw",
                    });
                    ea.clear();

                    // 中心主题
                    const centerId = ea.addText(400, 300, "DeepReader", {
                        width: 200,
                        height: 60,
                        textAlign: "center",
                        box: "ellipse",
                    });

                    // 分支
                    const branches = ["PDF阅读", "AI对话", "知识管理", "可视化"];
                    const radius = 300;

                    branches.forEach((label, index) => {
                        const angle = (2 * Math.PI * index) / branches.length - Math.PI / 2;
                        const x = 400 + radius * Math.cos(angle) - 75;
                        const y = 300 + radius * Math.sin(angle) - 20;

                        const branchId = ea.addText(x, y, label, {
                            width: 150,
                            height: 40,
                            textAlign: "center",
                            box: "box",
                        });

                        // 连接到中心
                        const sides = ["right", "bottom", "left", "top"] as const;
                        ea.connectObjects(centerId, sides[index], branchId, sides[(index + 2) % 4], {
                            endArrowHead: "arrow",
                        });
                    });

                    // Excalidraw Automate 会自动保存
                    new Notice("测试思维导图已生成: DeepReader/Excalidraw/test-mindmap.excalidraw.md");
                } catch (error) {
                    const errorMsg = error instanceof Error ? error.message : String(error);
                    new Notice(`生成失败: ${errorMsg}`);
                    console.error("[DeepReader] Excalidraw 测试失败:", error);
                }
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

        } catch (err) {
            log.error('[DeepPDF] Failed to save highlight:', err);
            new Notice("保存高亮失败");
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
            const config = getProviderConfig(this.settings);
            const apiKey = this.settings[config.apiKeyField] as string || '';
            const providerName = PROVIDER_LABELS[config.provider] || config.provider;
            const model = this.settings.llmModel || config.defaultModel || 'deepseek-chat';

            // 获取 fast 模型提供商配置
            const fastProviderConfig = this.settings.fastModelEnabled
                ? getProviderConfig({
                      llmProvider: this.settings.fastModelProvider,
                      apiUrl: this.settings.apiUrl,
                  })
                : null;

            this.frontendAgent = new FrontendAgent({
                apiKey: apiKey,
                baseUrl: config.baseUrl || undefined,
                model: model,
                providerName: providerName,
                skillsDir: this.skillsDir,
                app: this.app,

                // Fast 模型配置
                fastModelEnabled: this.settings.fastModelEnabled,
                fastApiKey: this.settings.fastModelEnabled && fastProviderConfig
                    ? (this.settings[fastProviderConfig.apiKeyField] as string || undefined)
                    : undefined,
                fastBaseUrl: fastProviderConfig?.baseUrl,
                fastModel: this.settings.fastModelName || undefined,
                fastProviderName: this.settings.fastModelEnabled
                    ? (PROVIDER_LABELS[this.settings.fastModelProvider] || this.settings.fastModelProvider)
                    : undefined,
            });
            await this.frontendAgent.initialize();
            log('[DeepPDF] FrontendAgent 初始化完成');
            log('[DeepPDF]   服务商:', providerName);
            log('[DeepPDF]   模型:', model, this.settings.llmModel ? '(用户设置)' : '(默认)');
            log('[DeepPDF]   API:', config.baseUrl);
            if (this.settings.fastModelEnabled) {
                log('[DeepPDF]   Fast 模型:', this.settings.fastModelName || '(未设置)');
                log('[DeepPDF]   Fast 服务商:', PROVIDER_LABELS[this.settings.fastModelProvider] || this.settings.fastModelProvider);
            }
        }
        return this.frontendAgent;
    }

    /**
     * 重置 FrontendAgent（切换服务商/模型/API Key 时调用）
     */
    resetFrontendAgent(): void {
        if (this.frontendAgent) {
            this.frontendAgent = null;
            log('[DeepPDF] FrontendAgent 已重置，下次对话将使用新配置');
        }
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

    /**
     * 导出 Canvas 文件到 Excalidraw
     */
    async exportCanvasToExcalidraw(canvasPath: string) {
        // 检查 Excalidraw 插件是否可用
        const ea = (window as any).ExcalidrawAutomate;
        if (!ea) {
            new Notice("请先安装 Excalidraw 插件（社区插件市场）");
            return;
        }

        try {
            new Notice("正在导出到 Excalidraw...");

            // 动态导入 ExcalidrawService
            const { ExcalidrawService } = await import('./services/excalidraw-service.js');
            const service = new ExcalidrawService({
                app: this.app,
                defaultFolder: 'DeepReader/Excalidraw',
            });

            const result = await service.convertFromCanvasFile(canvasPath);

            if (result.success) {
                new Notice(`导出成功: ${result.filePath}`);
            } else {
                new Notice(`导出失败: ${result.error}`);
            }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            new Notice(`导出失败: ${errorMsg}`);
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
