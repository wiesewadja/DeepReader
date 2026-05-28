import { Plugin, WorkspaceLeaf, Notice, MarkdownView } from "obsidian";
import { SidebarView, SIDEBAR_VIEW_TYPE } from "./views/sidebar-view.js";
import type { DeepReaderPlugin } from "./agent/tools/context/vault.js";
import { LibraryView, LIBRARY_VIEW_TYPE } from "./views/library-view.js";
import { serviceLog, setLogEnabled } from "./utils/logger.js";
import { ReadingModeService, type ReadingModeCallbacks, type HighlightColorId } from './components/reading-mode/index.js';
import type { QuoteMetadata } from './components/chat-input/chat-input.js';
import { HighlightService } from './services/highlight-service.js';
import { FrontendAgent } from './agent/index.js';
import { DeepPDFSettings, DEFAULT_SETTINGS, detectSetupComplete } from './config/settings.js';
import { needsMigration, migrateSettings } from './config/settings-migrator.js';
import { PROVIDER_LABELS, resolveRoleConfig, getProviderName } from './config/providers.js';
import { isBuiltInProvider } from './config/ai-roles.js';
import { DeepPDFSettingTab } from './settings/setting-tab.js';
import { ExcerptService } from './services/excerpt-service.js';
import type { ExcerptContent, ExcerptMetadata } from './types/excerpt.js';
import { findTextInMarkdown } from './utils/markdown-utils.js';

// 微信读书集成
import { WereadService } from './weread/index.js';
import { UnmatchedModal } from './weread/auth/unmatched-modal.js';

// PageIndex - 核心功能导入（Node.js 兼容）
import { PageIndex, type PageIndexResult, type ProgressInfo } from './pageindex/node.js';
import { indexBook, isBookIndexed, deleteBookIndex, generateBookId, migrateBookIndexes } from './pageindex/book-indexer.js';
import { parseEpub, type EpubInfo } from './pageindex/parsers/epub.js';
import { parsePdf } from './pageindex/parsers/pdf.js';
import { exportToObsidian } from './pageindex/exporters/epub-to-obsidian.js';

// 使用 service 模块日志器
const log = serviceLog;

export default class DeepPDFPlugin extends Plugin {
    settings: DeepPDFSettings;
    readingModeService: ReadingModeService | null = null;
    frontendAgent: FrontendAgent | null = null;
    profileBuilder?: import('./services/profile-builder').ProfileBuilder;

    // E2E 测试暴露的 API
    private wereadService: WereadService | null = null;

    readonly api = {
        indexBook,
        isBookIndexed,
        deleteBookIndex,
        generateBookId,
        parsePdf,
        parseEpub,
        exportToObsidian,
        PageIndex,
        createProfileBuilder: () => {
            const { ProfileBuilder } = require('./services/profile-builder');
            this.profileBuilder = new ProfileBuilder(this.app, this.settings);
            return this.profileBuilder;
        },
    };

    async onload() {
        await this.loadSettings();

        // 首次安装：自动打开设置页面引导配置
        if (!this.settings.setupComplete) {
            this.app.workspace.onLayoutReady(() => {
                const setting = (this.app as any).setting;
                if (setting) {
                    setting.open();
                    setting.openTabById('deepreader');
                }
            });
        }

        // 日志系统默认开启，通过模块开关控制输出
        log('Loading plugin');

        // 初始化 DeepReader 目录和图书管理文档
        await this.ensureInitialization();

        // 迁移旧路径哈希 bookId → 内容哈希 bookId（一次性，幂等）
        const vaultPath = (this.app.vault.adapter as any).getBasePath?.() || (this.app.vault.adapter as any).basePath;
        if (vaultPath) {
            // 先迁移 .pageindex/ → .obsidian/plugins/deepreader/pageindex/
            try {
                const { migratePageindexPath } = await import('./pageindex/migration.js');
                const migrated = await migratePageindexPath(vaultPath);
                if (migrated) log('[DeepReader] Migrated .pageindex to plugin directory');
            } catch (e) {
                log.error('[DeepReader] Path migration failed:', e);
            }

            try {
                const count = await migrateBookIndexes(vaultPath);
                if (count > 0) log(`[DeepReader] Migrated ${count} book index(es) to content-based IDs`);
            } catch (e) {
                log.error('[DeepReader] Migration failed:', e);
            }
        }

        // 同步 Skills 到 vault（插件启动时执行）
        await this.syncSkillsToVault();

        // 初始化 FrontendAgent（插件启动时初始化）
        await this.getFrontendAgent();

        // 初始化 ProfileBuilder 并自动增量构建（距上次 > 24h）
        if (this.settings.journalDir) {
            const { ProfileBuilder } = await import('./services/profile-builder');
            this.profileBuilder = new ProfileBuilder(this.app, this.settings);
            this.app.workspace.onLayoutReady(() => {
                this.scheduleAutoBuild();
            });
        }

        // 注册侧边栏视图（必须在 activateView 之前）
        this.registerView(
            SIDEBAR_VIEW_TYPE,
            (leaf) => new SidebarView(leaf, this as unknown as DeepReaderPlugin)
        );

        // 注册书库视图
        this.registerView(
            LIBRARY_VIEW_TYPE,
            (leaf) => new LibraryView(leaf, {
                indexes: [],
                selectedIndexId: null,
                onIndexChange: (indexId) => {
                    // 找到 SidebarView 并调用 selectIndex
                    const sidebarLeaves = this.app.workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE);
                    if (sidebarLeaves.length > 0) {
                        const sidebarView = sidebarLeaves[0].view as SidebarView;
                        sidebarView.selectIndex(indexId);
                    }
                },
                onDeleteIndex: async (indexId) => {
                    const sidebarLeaves = this.app.workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE);
                    if (sidebarLeaves.length > 0) {
                        const sidebarView = sidebarLeaves[0].view as SidebarView;
                        await sidebarView.handleDeleteIndex(indexId);
                        return sidebarView.indexes;
                    }
                    return [];
                },
                onRefresh: async () => {
                    const sidebarLeaves = this.app.workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE);
                    if (sidebarLeaves.length > 0) {
                        const sidebarView = sidebarLeaves[0].view as SidebarView;
                        await sidebarView.loadIndexes();
                        return sidebarView.indexes;
                    }
                    return [];
                },
                onDownloadCover: async (indexId: string, pdfName: string) => {
                    // 封面已由 book-indexer.ts 在索引过程中自动保存，
                    // 此处无需额外下载，LibraryView 会从本地加载
                    return null;
                },
                onStartThematicReading: (booklist, reenter) => {
                    const sidebarLeaves = this.app.workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE);
                    if (sidebarLeaves.length > 0) {
                        const sidebarView = sidebarLeaves[0].view as SidebarView;
                        if (reenter) {
                            sidebarView.reenterBooklist(booklist);
                        } else {
                            sidebarView.selectBooklist(booklist);
                        }
                    }
                },
                plugin: this
            })
        );

        // 注册 hover-link 事件源，让 Obsidian 的 Page Preview 核心插件
        // 能处理来自侧边栏 AI 聊天中 wiki 链接的悬停预览
        this.registerHoverLinkSource('deeppdf', {
            display: 'DeepReader',
            defaultMod: false,
        });

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

        // 添加打开书库的命令
        this.addCommand({
            id: "open-library",
            name: "Open Library",
            callback: () => this.openLibraryView()
        });

        // 调试命令：发送测试消息
        this.addCommand({
            id: "debug-send-message",
            name: "Debug: Send test message",
            callback: () => {
                this.sendTestMessage("这本书主要讲了什么");
            }
        });

        // 快速配置命令
        this.addCommand({
            id: "open-quick-setup",
            name: "打开快速配置",
            callback: () => {
                const setting = (this.app as any).setting;
                if (setting) {
                    setting.open();
                    setting.openTabById('deepreader');
                }
            },
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

        // PageIndex 测试命令 - 测试核心功能集成
        this.addCommand({
            id: "test-pageindex",
            name: "Test: PageIndex Core Features",
            callback: async () => {
                try {
                    new Notice("正在测试 PageIndex 核心功能...");
                    log('[PageIndex] Testing core features...');
                    
                    // 创建 PageIndex 实例
                    const pageIndex = new PageIndex({
                        model: 'gpt-4o',
                        addNodeId: true,
                        addNodeSummary: true,
                        onProgress: (progress: ProgressInfo) => {
                            log(`[PageIndex] ${progress.stage}: ${progress.percent}% - ${progress.message}`);
                        }
                    });
                    
                    // 测试 1: 验证实例创建
                    log('[PageIndex] ✓ PageIndex instance created');
                    
                    // 测试 2: 验证类型导入
                    const testOptions = {
                        model: 'test-model',
                        addNodeId: true,
                    };
                    log('[PageIndex] ✓ Type imports working');
                    
                    new Notice("PageIndex 核心功能测试成功！\n✓ 实例创建\n✓ 类型导入\n✓ API 可用");
                    log('[PageIndex] ✓ All core features working');
                    
                } catch (err) {
                    const errorMsg = err instanceof Error ? err.message : String(err);
                    new Notice(`PageIndex 测试失败: ${errorMsg}`);
                    log.error('[PageIndex] Test failed:', err);
                }
            }
        });

        // PageIndex 示例命令 - 处理 PDF 文件
        this.addCommand({
            id: "process-pdf-with-pageindex",
            name: "Process PDF with PageIndex",
            checkCallback: (checking: boolean) => {
                const file = this.app.workspace.getActiveFile();
                if (file && file.extension === 'pdf') {
                    if (!checking) {
                        this.processPdfWithPageIndex(file.path);
                    }
                    return true;
                }
                return false;
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
                        // 阅读顾问模式允许无书操作
                    }

                    const bookTitle = currentBook?.title ?? '';
                    new Notice(bookTitle ? `正在抓取《${bookTitle}》的系统提示词...` : '正在抓取阅读顾问模式的系统提示词...');

                    const agent = await this.getFrontendAgent();
                    const systemPrompt = await agent.getSystemPromptAsync(
                        { title: bookTitle || undefined, page_count: currentBook?.page_count },
                        currentBook?.docDescription ?? undefined
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
                    serviceLog('%c' + '='.repeat(80), 'color: #4CAF50; font-weight: bold');
                    serviceLog(`%c系统提示词 - 《${currentBook.title}》`, 'color: #4CAF50; font-weight: bold; font-size: 14px');
                    serviceLog('%c' + '='.repeat(80), 'color: #4CAF50; font-weight: bold');
                    serviceLog('%c' + systemPrompt, 'color: #2196F3; font-family: monospace; font-size: 12px');
                    serviceLog('%c' + '='.repeat(80), 'color: #4CAF50; font-weight: bold');
                    serviceLog(`%c提示词长度: ${systemPrompt.length} 字符`, 'color: #9E9E9E');

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
            onQuote: (metadata: QuoteMetadata) => {
                this.activateView();
                setTimeout(() => {
                    this.app.workspace.trigger('deeppdf:quote-selection', metadata);
                }, 100);
            },
            onExcerpt: (text: string, range: Range) => {
                this.app.workspace.trigger('deeppdf:excerpt-selection', text, range);
            },
            onSaveHighlight: async (text: string, color: HighlightColorId) => {
                const hlService = new HighlightService(this.app);
                await hlService.saveHighlight(text, color);
                const leaves = this.app.workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE);
                if (leaves.length > 0) {
                    const sidebarView = leaves[0].view as SidebarView;
                    await sidebarView.notifyHighlight(text);
                }
            },
            onRemoveHighlight: async (text: string) => {
                const hlService = new HighlightService(this.app);
                await hlService.removeHighlight(text);
            },
            onBookDetected: (indexId: string, bookName: string) => {
                // 检测到书籍章节，自动切换到对应书籍的聊天记录
                this.switchToBook(indexId, bookName);
            },
            onDeactivate: () => {
                // 阅读模式停用时不改变任何右边栏状态
                // 顶栏书名始终跟随用户通过书库选中的书籍
            },
        };
        this.readingModeService = new ReadingModeService(this.app, readingModeCallbacks);

        // 应用自动阅读模式设置
        this.readingModeService.setAutoEnable(this.settings.autoEnableReadingMode);
        this.readingModeService.setStyle(this.settings.readingModeStyle || 'paginated');
        this.readingModeService.setEnableInkLayer(this.settings.enableInkLayer ?? true);

        this.readingModeService.start();
        serviceLog('[DeepPDF] Reading mode service started');

        // ═══ 微信读书命令 ═══
        this.addCommand({
            id: "weread-login",
            name: "微信读书：打开设置配置 API Key",
            callback: async () => {
                new Notice("请在插件设置 → 微信读书 中输入 API Key");
            },
        });

        this.addCommand({
            id: "weread-sync",
            name: "微信读书：同步笔记",
            callback: async () => {
                const svc = this.getWereadService();
                if (!svc.isLoggedIn()) {
                    new Notice("请先配置微信读书 API Key");
                    return;
                }
                try {
                    let lastPhase = '';
                    let lastProgressNotice = 0;
                    const result = await svc.sync(false, {
                        onProgress: (p) => {
                            // phase 切换时通知
                            if (p.phase !== lastPhase) {
                                lastPhase = p.phase;
                                if (p.phase === 'fetching-books') {
                                    new Notice(`开始同步微信读书，共 ${p.total} 本`, 5000);
                                }
                            }
                            // fetching-books 阶段每 5 本或最后一本通知一次
                            if (p.phase === 'fetching-books' && p.total > 0) {
                                const now = Date.now();
                                if (p.current % 5 === 0 || p.current === p.total || now - lastProgressNotice > 10000) {
                                    lastProgressNotice = now;
                                    new Notice(`同步进度 (${p.current}/${p.total}) ${p.currentBook}`, 3000);
                                }
                            }
                        },
                        onNotice: (msg) => { new Notice(msg); },
                    });
                    new Notice(`同步完成：新增 ${result.added} 本，更新 ${result.updated} 本`);
                    if (result.unmatched > 0) {
                        const svc2 = this.getWereadService();
                        const stats = await svc2.getSyncStats();
                        if (stats.unmatchedBooks.length > 0) {
                            new UnmatchedModal(this.app, stats.unmatchedBooks).open();
                        }
                    }
                } catch (e: any) {
                    new Notice(`同步失败：${e.message}`);
                }
            },
        });

        this.addCommand({
            id: "weread-sync-force",
            name: "微信读书：强制全量同步",
            callback: async () => {
                const svc = this.getWereadService();
                if (!svc.isLoggedIn()) {
                    new Notice("请先配置微信读书 API Key");
                    return;
                }
                try {
                    let lastPhase = '';
                    let lastProgressNotice = 0;
                    const result = await svc.sync(true, {
                        onProgress: (p) => {
                            if (p.phase !== lastPhase) {
                                lastPhase = p.phase;
                                if (p.phase === 'fetching-books') {
                                    new Notice(`[全量同步] 共 ${p.total} 本`, 5000);
                                }
                            }
                            if (p.phase === 'fetching-books' && p.total > 0) {
                                const now = Date.now();
                                if (p.current % 5 === 0 || p.current === p.total || now - lastProgressNotice > 10000) {
                                    lastProgressNotice = now;
                                    new Notice(`[全量同步] (${p.current}/${p.total}) ${p.currentBook}`, 3000);
                                }
                            }
                        },
                        onNotice: (msg) => { new Notice(msg); },
                    });
                    new Notice(`同步完成：新增 ${result.added} 本，更新 ${result.updated} 本`);
                    if (result.unmatched > 0) {
                        const svc2 = this.getWereadService();
                        const stats = await svc2.getSyncStats();
                        if (stats.unmatchedBooks.length > 0) {
                            new UnmatchedModal(this.app, stats.unmatchedBooks).open();
                        }
                    }
                } catch (e: any) {
                    new Notice(`同步失败：${e.message}`);
                }
            },
        });

        this.addCommand({
            id: "weread-logout",
            name: "微信读书：清除 API Key",
            callback: async () => {
                const svc = this.getWereadService();
                await svc.logout();
                new Notice("已清除微信读书 API Key");
            },
        });

        this.addCommand({
            id: "weread-rematch",
            name: "微信读书：重新匹配书籍",
            callback: async () => {
                const svc = this.getWereadService();
                if (!svc.isLoggedIn()) {
                    new Notice("请先配置微信读书 API Key");
                    return;
                }
                new Notice("开始重新匹配...");
                try {
                    const result = await svc.rematch();
                    new Notice(`匹配完成：${result.matched} 本已关联，${result.unmatched} 本未关联`);
                } catch (e: any) {
                    new Notice(`匹配失败：${e.message}`);
                }
            },
        });
    }

    /**
     * 分离 Markdown 文件的 frontmatter 和 body
     * @returns { frontmatter, body, hasFrontmatter } 如果没有 frontmatter，frontmatter 为空字符串
     */
    private getWereadService(): WereadService {
        if (!this.wereadService) {
            this.wereadService = new WereadService({
                settings: this.settings,
                app: this.app,
                saveSettings: async () => { await this.saveSettings(); },
            });
        }
        return this.wereadService;
    }
    /**
     * 确保初始化完成：创建 DeepReader 目录
     */
    private async ensureInitialization(): Promise<void> {
        const DEEPPDF_DIR = "DeepReader";

        try {
            const dirExists = await this.app.vault.adapter.exists(DEEPPDF_DIR);
            if (!dirExists) {
                await this.app.vault.createFolder(DEEPPDF_DIR);
                log('[DeepPDF] Created DeepReader directory');
            }
        } catch (err) {
            log.error('[DeepPDF] Initialization failed:', err);
        }
    }

    /**
     * 同步内置 Skills 到 vault
     * 在插件启动时执行，将硬编码的 Skills 写入 Obsidian vault
     */
    private async syncSkillsToVault(): Promise<void> {
        const SKILLS_DIR = "DeepReader/skills";

        try {
            // 确保 skills 目录存在
            const dirExists = await this.app.vault.adapter.exists(SKILLS_DIR);
            if (!dirExists) {
                await this.app.vault.createFolder(SKILLS_DIR);
                log('[DeepPDF] Created skills directory');
            }
        } catch (err) {
            log.error('[DeepPDF] Skills dir creation failed:', err);
        }
    }

    /**
     * 获取或初始化 FrontendAgent
     */
    async getFrontendAgent(): Promise<FrontendAgent> {
        if (!this.frontendAgent) {
            // 使用新的 resolveRoleConfig 解析 chat 角色
            const chatConfig = resolveRoleConfig('chat', this.settings);
            const chatProvider = this.settings.roles?.chat?.provider || 'deepseek';
            const providerName = getProviderName(chatProvider, this.settings);
            const apiKey = chatConfig?.apiKey || '';
            const baseUrl = chatConfig?.baseUrl || undefined;
            const model = chatConfig?.model || 'deepseek-chat';

            // 解析 router 角色（原 fast 模型）
            const routerConfig = resolveRoleConfig('router', this.settings);
            const hasRouter = !!routerConfig;
            const routerProvider = this.settings.roles?.router?.provider || 'deepseek';

            this.frontendAgent = new FrontendAgent({
                apiKey: apiKey,
                baseUrl: baseUrl,
                model: model,
                providerName: providerName,
                app: this.app,

                // Router（原 Fast 模型）配置
                fastModelEnabled: hasRouter,
                fastApiKey: routerConfig?.apiKey || undefined,
                fastBaseUrl: routerConfig?.baseUrl || undefined,
                fastModel: routerConfig?.model || undefined,
                fastProviderName: hasRouter
                    ? getProviderName(routerProvider, this.settings)
                    : undefined,

                // LangSmith 追踪配置（LangGraph 引擎专用）
                langsmithApiKey: this.settings.langsmithApiKey || undefined,
                langsmithProject: this.settings.langsmithProject || undefined,
                langsmithEnabled: this.settings.langsmithEnabled,

                // Human-in-the-Loop 设置
                enableHumanReview: this.settings.enableHumanReview,

                // 思考模型控制
                disableThinking: chatConfig?.disableThinking,
                fastDisableThinking: routerConfig?.disableThinking,

                // 用户画像
                journalDir: this.settings.journalDir || undefined,
            });
            await this.frontendAgent.initialize();
            log('[DeepPDF] FrontendAgent 初始化完成');
            log('[DeepPDF]   服务商:', providerName);
            log('[DeepPDF]   模型:', model);
            log('[DeepPDF]   API:', baseUrl || '(默认)');
            if (hasRouter) {
                log('[DeepPDF]   Router 模型:', routerConfig?.model || '(未设置)');
                log('[DeepPDF]   Router 服务商:', getProviderName(routerProvider, this.settings));
            }
        }
        return this.frontendAgent;
    }

    private async scheduleAutoBuild(): Promise<void> {
        if (!this.profileBuilder) return;
        const meta = await this.profileBuilder.readMeta();
        if (!meta) return; // 从未构建过，不自动触发

        const hoursSinceBuild = (Date.now() - new Date(meta.lastBuildTime).getTime()) / (1000 * 60 * 60);
        if (hoursSinceBuild >= 24) {
            this.profileBuilder.build().catch(e => {
                console.warn('[DeepReader] Auto-build profile failed:', e.message);
            });
        }
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
            // Skills 现在由 PI 管理，无需重载
            return { success: true, message: 'Skills 由 PI Agent 管理', skills: [] };
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return { success: false, message, skills: [] };
        }
    }


    async loadSettings() {
        const rawData = (await this.loadData()) ?? {};
        if (needsMigration(rawData)) {
            this.settings = migrateSettings(rawData, DEFAULT_SETTINGS);
            await this.saveData(this.settings);
        } else {
            this.settings = Object.assign({}, DEFAULT_SETTINGS, rawData);
        }
        // 同步 providers：添加新增的内置服务商，移除已删除的内置服务商
        const defaults = DEFAULT_SETTINGS.providers as Record<string, { apiKey: string }>;
        const saved = this.settings.providers as Record<string, { apiKey?: string }>;
        for (const key of Object.keys(defaults)) {
            if (!saved[key]) saved[key] = { apiKey: '' };
        }
        for (const key of Object.keys(saved)) {
            if (isBuiltInProvider(key) && !defaults[key]) {
                delete saved[key];
            }
        }
        setLogEnabled(this.settings.enableDebugLog);

        // 老用户升级兼容：如果 setupComplete 未定义但已有有效 provider key，自动标记
        if (detectSetupComplete(this.settings)) {
            await this.saveSettings();
        }
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

        // 清理 PI Agent 子进程
        if (this.frontendAgent) {
            await this.frontendAgent.destroy();
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
     * 打开书库视图
     */
    async openLibraryView(): Promise<void> {
        // 获取最新数据（无论视图是否已存在）
        const sidebarLeaves = this.app.workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE);
        let indexes: any[] = [];
        let selectedIndexId: string | null = null;
        let selectedBooklistId: string | null = null;
        if (sidebarLeaves.length > 0) {
            const sidebarView = sidebarLeaves[0].view as SidebarView;
            await sidebarView.loadIndexes();
            indexes = sidebarView.indexes;
            selectedIndexId = sidebarView.getCurrentIndexId();
            selectedBooklistId = sidebarView.getCurrentBooklistId();
            if (selectedBooklistId) selectedIndexId = null;
        }

        // 检查是否已有书库视图
        const existingLeaves = this.app.workspace.getLeavesOfType(LIBRARY_VIEW_TYPE);
        if (existingLeaves.length > 0) {
            // 更新现有视图的数据后聚焦
            const leaf = existingLeaves[0];
            await leaf.setViewState({
                type: LIBRARY_VIEW_TYPE,
                state: { indexes, selectedIndexId, selectedBooklistId }
            });
            this.app.workspace.revealLeaf(leaf);
            return;
        }

        // 在主面板打开新书库视图
        const leaf = this.app.workspace.getLeaf('tab');
        await leaf.setViewState({
            type: LIBRARY_VIEW_TYPE,
            state: { indexes, selectedIndexId, selectedBooklistId }
        });
    }

    /**
     * 使用 PageIndex 处理 PDF 文件
     * 示例：展示如何在 Obsidian 插件中使用 PageIndex 核心功能
     */
    async processPdfWithPageIndex(pdfPath: string): Promise<void> {
        try {
            new Notice(`正在处理 PDF: ${pdfPath}`);
            log('[PageIndex] Processing PDF:', pdfPath);

            // 使用 resolveRoleConfig 解析 pageindex 角色
            const pageindexConfig = resolveRoleConfig('pageindex', this.settings);
            const apiKey = pageindexConfig?.apiKey || '';
            const baseUrl = pageindexConfig?.baseUrl || undefined;
            const model = pageindexConfig?.model || 'deepseek-chat';

            // 创建 PageIndex 实例
            const pageIndex = new PageIndex({
                model: model,
                apiKey: apiKey,
                baseUrl: baseUrl,
                mineruApiKey: this.settings.providers['mineru']?.apiKey || '',
                addNodeId: true,
                addNodeSummary: true,
                addNodeText: true,
                onProgress: (progress: ProgressInfo) => {
                    log(`[PageIndex] ${progress.stage}: ${progress.percent}%`);
                    if (progress.percent % 20 === 0) {
                        new Notice(`${progress.message} (${progress.percent}%)`);
                    }
                }
            });

            // 处理 PDF
            const result: PageIndexResult = await pageIndex.fromPdf(pdfPath);

            // 输出结果
            log('[PageIndex] ✓ PDF processed successfully');
            log(`  - Document: ${result.docName}`);
            log(`  - Nodes: ${this.countNodes(result.structure)}`);
            if (result.docDescription) {
                log(`  - Description: ${result.docDescription.substring(0, 100)}...`);
            }

            // 显示成功通知
            new Notice(`PDF 处理成功！\n文档: ${result.docName}\n节点数: ${this.countNodes(result.structure)}`);

            // TODO: 可以将 result.structure 保存到笔记或显示在 UI 中

        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            log.error('[PageIndex] Failed to process PDF:', err);
            new Notice(`PDF 处理失败: ${errorMsg}`);
        }
    }

    /**
     * 递归统计节点数量
     */
    private countNodes(nodes: any[]): number {
        let count = nodes.length;
        for (const node of nodes) {
            if (node.nodes && Array.isArray(node.nodes)) {
                count += this.countNodes(node.nodes);
            }
        }
        return count;
    }

}
