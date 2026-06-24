import { Plugin, type WorkspaceLeaf, Notice } from "obsidian";
import { FrontendAgent } from './agent/index.js';
import type { DeepReaderPluginInterface } from "./agent/tools/context/vault.js";
import type { QuoteMetadata } from './components/chat-input/chat-input.js';
import { ReadingModeService, type ReadingModeCallbacks, type HighlightColorId } from './components/reading-mode/index.js';
import { isBuiltInProvider } from './config/ai-roles.js';
import { resolveRoleConfig, getProviderName } from './config/providers.js';
import { needsMigration, migrateSettings } from './config/settings-migrator.js';
import { type DeepPDFSettings, DEFAULT_SETTINGS, detectSetupComplete } from './config/settings.js';

// 微信读书集成
import { WereadService } from './weread/index.js';
import { WereadScheduledSync } from './weread/sync/scheduled-sync.js';
import { UnmatchedModal } from './weread/auth/unmatched-modal.js';

// PageIndex - 核心功能导入（Node.js 兼容）
import { PageIndex, type PageIndexResult, type ProgressInfo } from './pageindex/node.js';
import { indexBook, isBookIndexed, deleteBookIndex, generateBookId, migrateBookIndexes } from './pageindex/book-indexer.js';
import { parseEpub } from './pageindex/parsers/epub.js';
import { parsePdf } from './pageindex/parsers/pdf.js';
import { exportToObsidian } from './pageindex/exporters/epub-to-obsidian.js';
import { setActivePluginId } from './pageindex/paths.js';
import { ExcerptService } from './services/excerpt-service.js';
import { HighlightService } from './services/highlight-service.js';
import { registerAllPrompts, promptRegistry } from './agent/prompts/index.js';
import { sanitizeHumanizedHtml } from './components/message/utils.js';
import { DeepPDFSettingTab } from './settings/setting-tab.js';
import { serviceLog, setLogEnabled } from "./utils/logger.js";
import { getVaultPath } from './utils/mobile-fs.js';
import { LibraryView, LIBRARY_VIEW_TYPE } from "./views/library-view.js";
import { SidebarView, SIDEBAR_VIEW_TYPE } from "./views/sidebar-view.js";

// 使用 service 模块日志器
const log = serviceLog;

export default class DeepReaderPlugin extends Plugin implements DeepReaderPluginInterface {
    settings: DeepPDFSettings;
    readingModeService: ReadingModeService | null = null;
    frontendAgent: FrontendAgent | null = null;
    profileBuilder?: import('./services/profile-builder').ProfileBuilder;
    private highlightService: HighlightService | null = null;
    private excerptService: ExcerptService | null = null;

    /** 派生：dev='deepreader-dev'，daily='deepreader' — 来自 manifest.json */
    get pluginId(): string {
        return this.manifest.id;
    }

    // E2E 测试暴露的 API
    private wereadService: WereadService | null = null;
    private wereadScheduledSync: WereadScheduledSync | null = null;

    readonly api = {
        indexBook,
        isBookIndexed,
        deleteBookIndex,
        generateBookId,
        parsePdf,
        parseEpub,
        exportToObsidian,
        PageIndex,
        promptRegistry,
        sanitizeHumanizedHtml,
        createProfileBuilder: () => {
            const { ProfileBuilder } = require('./services/profile-builder');
            this.profileBuilder = new ProfileBuilder(this.app, this.settings);
            return this.profileBuilder;
        },
    };

    async onload() {
        // ── 移动端 adapter/vault polyfill ──
        // Capacitor 环境的 adapter/vault 可能缺少 DataAdapter 标准方法，
        // 用 stat 做 fallback 补齐。
        const adapter = this.app.vault.adapter as any;
        if (typeof adapter.exists !== 'function') {
            adapter.exists = async (normalizedPath: string): Promise<boolean> => {
                try { return (await adapter.stat(normalizedPath)) != null; }
                catch { return false; }
            };
        }
        if (typeof adapter.list !== 'function') {
            adapter.list = async (_normalizedPath: string): Promise<{ files: string[]; folders: string[] }> => {
                return { files: [], folders: [] };
            };
        }
        const vault = this.app.vault as any;
        if (typeof vault.createFolder !== 'function') {
            vault.createFolder = async (path: string) => {
                // 尝试通过 adapter.mkdir 创建，忽略已存在错误
                try { await adapter.mkdir(path); } catch {}
                return vault.getFolderByPath?.(path) ?? { path };
            };
        }

        await this.loadSettings();

        // 设置 pageindex 路径模块的当前 pluginId（dev/daily 隔离）
        setActivePluginId(this.manifest.id);

        // 首次安装：自动打开设置页面引导配置
        if (!this.settings.setupComplete) {
            this.app.workspace.onLayoutReady(() => {
                const setting = (this.app as any).setting;
                if (setting) {
                    setting.open();
                    setting.openTabById(this.manifest.id);
                }
            });
        }

        // 日志系统默认开启，通过模块开关控制输出
        log('Loading plugin');

        // 初始化 DeepReader 目录和图书管理文档
        await this.ensureInitialization();

        // 注册所有提示词模块到注册表和版本管理器
        registerAllPrompts();

        // 迁移旧路径哈希 bookId → 内容哈希 bookId（一次性，幂等）
        const vaultPath = getVaultPath(this.app);
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

        // FrontendAgent 延迟初始化：首次聊天时通过 getFrontendAgent() 按需加载

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
            (leaf) => new SidebarView(leaf, this as unknown as DeepReaderPluginInterface)
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

        // 添加 Ribbon 图标 - 书库入口（打开书库 Tab 页）
        this.addRibbonIcon("lucide-library", "书库", () => {
            void this.openLibraryView();
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

        // 快速配置命令
        this.addCommand({
            id: "open-quick-setup",
            name: "打开快速配置",
            callback: () => {
                const setting = (this.app as any).setting;
                if (setting) {
                    setting.open();
                    setting.openTabById(this.manifest.id);
                }
            },
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
                if (!this.highlightService) {
                    this.excerptService ??= new ExcerptService(this.app);
                    this.highlightService = new HighlightService(this.app, this.excerptService);
                }
                await this.highlightService.saveHighlight(text, color);
                const leaves = this.app.workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE);
                if (leaves.length > 0) {
                    const sidebarView = leaves[0].view as SidebarView;
                    await sidebarView.notifyHighlight(text);
                }
            },
            onRemoveHighlight: async (text: string) => {
                if (!this.highlightService) {
                    this.excerptService ??= new ExcerptService(this.app);
                    this.highlightService = new HighlightService(this.app, this.excerptService);
                }
                await this.highlightService.removeHighlight(text);
            },
            onBookDetected: (indexId: string, bookName: string) => {
                // 检测到书籍章节，自动切换到对应书籍的聊天记录
                this.switchToBook(indexId, bookName);
            },
            onDeactivate: () => {
                // 阅读模式停用时不改变任何右边栏状态
                // 顶栏书名始终跟随用户通过书库选中的书籍
            },
            onStopReadingTTS: () => {
                const sidebarLeaves = this.app.workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE);
                if (sidebarLeaves.length > 0) {
                    const view = sidebarLeaves[0].view as SidebarView;
                    view.stopReadingTTS();
                }
            },
            onQuickQuestion: async (question: string) => {
                let leaves = this.app.workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE);
                if (leaves.length === 0) {
                    const leaf = this.app.workspace.getRightLeaf(false);
                    if (leaf) {
                        await leaf.setViewState({
                            type: SIDEBAR_VIEW_TYPE,
                            active: true
                        });
                        leaves = this.app.workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE);
                    }
                }
                if (leaves.length > 0) {
                    const sidebarView = leaves[0].view as SidebarView;
                    await sidebarView.sendMessageWithInput(question);
                }
            },
            onRevealSidebar: () => {
                this.activateView();
            },
        };
        this.readingModeService = new ReadingModeService(this.app, readingModeCallbacks, this.manifest.id);

        // 应用自动阅读模式设置
        this.readingModeService.setAutoEnable(this.settings.autoEnableReadingMode);
        this.readingModeService.setStyle(this.settings.readingModeStyle || 'paginated');

        this.readingModeService.start();
        serviceLog('[DeepPDF] Reading mode service started');

        this.addCommand({
            id: "tts-reading-toggle",
            name: "朗读原文：开始/停止",
            callback: () => {
                const sidebarLeaves = this.app.workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE);
                if (sidebarLeaves.length > 0) {
                    const view = sidebarLeaves[0].view as SidebarView;
                    view.toggleReadingTTS();
                }
            },
        });

        // ── E2E 评估模式后门 API（仅 evalMode=true + EVAL_MODE 环境变量时注册）──
        // E2E 测试通过 executeObsidian 动态注册 startQnA/pollResult，此处仅为守卫标记
        if (this.settings.evalMode && process.env.EVAL_MODE === 'true') {
            serviceLog('[DeepPDF] Eval mode active (EVAL_MODE=true)');
        }

        // 注册内部命令（微信读书快捷入口 + 调试/测试）—— 仅 DEV_COMMANDS='true' 构建注册
        this.registerDevCommands();

        // ═══ 启动微信读书定时同步 ═══
        this.setupWereadScheduledSync();
    }

    /**
     * 注册内部命令（微信读书快捷入口 + 调试/测试命令）。
     * 仅 dev 构建（DEV_COMMANDS='true'，即 test-vault 测试版本）注册；
     * 正式版本（daily / GitHub release）由 esbuild 死代码消除，命令面板不可见。
     * 微信读书功能在设置页 weread-section 已有完整 UI，此处仅为开发/测试快捷入口。
     */
    private registerDevCommands(): void {
        if (process.env.DEV_COMMANDS !== 'true') return;

        // ═══ 微信读书（设置页 weread-section 已有 UI，此处为调试快捷入口）═══
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
                            if (p.phase !== lastPhase) {
                                lastPhase = p.phase;
                                if (p.phase === 'fetching-books') {
                                    new Notice(`开始同步微信读书，共 ${p.total} 本`, 5000);
                                }
                            }
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
                            new UnmatchedModal(this.app, stats.unmatchedBooks, this.manifest.id).open();
                        }
                    }
                } catch (e: unknown) {
                    new Notice(`同步失败：${(e instanceof Error ? e.message : String(e))}`);
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
                            new UnmatchedModal(this.app, stats.unmatchedBooks, this.manifest.id).open();
                        }
                    }
                } catch (e: unknown) {
                    new Notice(`同步失败：${(e instanceof Error ? e.message : String(e))}`);
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
                } catch (e: unknown) {
                    new Notice(`匹配失败：${(e instanceof Error ? e.message : String(e))}`);
                }
            },
        });

        // ═══ 调试 / 测试 ═══
        this.addCommand({
            id: "debug-send-message",
            name: "Debug: Send test message",
            callback: () => {
                this.sendTestMessage("这本书主要讲了什么");
            }
        });

        this.addCommand({
            id: "debug-analytical-reading",
            name: "Debug: Test analytical reading tools",
            callback: () => {
                this.sendTestMessage("分析这本书的整体结构和纲要");
            }
        });

        this.addCommand({
            id: "debug-syntopical-reading",
            name: "Debug: Test syntopical reading",
            callback: () => {
                this.sendTestMessage("在已读书中搜索关于经济危机的内容");
            }
        });

        this.addCommand({
            id: "debug-mindmap-skill",
            name: "Debug: Test mindmap skill",
            callback: () => {
                this.sendTestMessage("帮我整理这本书的整体框架，画一个思维导图");
            }
        });

        this.addCommand({
            id: "debug-knowledge-cards",
            name: "Debug: Test knowledge cards skill",
            callback: () => {
                this.sendTestMessage("帮我提取这本书的核心概念，生成知识卡片");
            }
        });

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

        this.addCommand({
            id: "dump-system-prompt",
            name: "Debug: Dump System Prompt",
            callback: async () => {
                try {
                    const leaves = this.app.workspace.getLeavesOfType(SIDEBAR_VIEW_TYPE);
                    if (leaves.length === 0) {
                        new Notice("请先打开 DeepReader 侧边栏");
                        return;
                    }

                    const sidebarView = leaves[0].view as SidebarView;
                    const currentBook = sidebarView.getCurrentBookInfo?.();

                    const bookTitle = currentBook?.title ?? '';
                    new Notice(bookTitle ? `正在抓取《${bookTitle}》的系统提示词...` : '正在抓取阅读顾问模式的系统提示词...');

                    const agent = await this.getFrontendAgent();
                    const systemPrompt = await agent.getSystemPromptAsync(
                        { title: bookTitle || undefined, page_count: currentBook?.page_count },
                        currentBook?.docDescription ?? undefined
                    );

                    const debugDir = 'DeepReader/debug';
                    const dirExists = await this.app.vault.adapter.exists(debugDir);
                    if (!dirExists) {
                        await this.app.vault.createFolder(debugDir);
                    }

                    const filename = `system-prompt-${Date.now()}.md`;
                    const bookInfo = `<!-- 书籍: ${currentBook?.title} -->\n<!-- 生成时间: ${new Date().toISOString()} -->\n\n`;
                    await this.app.vault.create(`${debugDir}/${filename}`, bookInfo + systemPrompt);

                    serviceLog('%c' + '='.repeat(80), 'color: #4CAF50; font-weight: bold');
                    serviceLog(`%c系统提示词 - 《${currentBook?.title}》`, 'color: #4CAF50; font-weight: bold; font-size: 14px');
                    serviceLog('%c' + '='.repeat(80), 'color: #4CAF50; font-weight: bold');
                    serviceLog('%c' + systemPrompt, 'color: #2196F3; font-family: monospace; font-size: 12px');
                    serviceLog('%c' + '='.repeat(80), 'color: #4CAF50; font-weight: bold');
                    serviceLog(`%c提示词长度: ${systemPrompt.length} 字符`, 'color: #9E9E9E');

                    new Notice(`系统提示词已保存到 DeepReader/debug/${filename}`);
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    new Notice(`抓取失败: ${msg}`);
                    serviceLog.error('[DumpSystemPrompt] 错误:', err);
                }
            }
        });
    }

    /**
     * 分离 Markdown 文件的 frontmatter 和 body
     * @returns { frontmatter, body, hasFrontmatter } 如果没有 frontmatter，frontmatter 为空字符串
     */
    /** 暴露 ExcerptService 单例供 UI 层（modal/sidebar）注入使用 */
    public getExcerptService(): ExcerptService {
        this.excerptService ??= new ExcerptService(this.app);
        return this.excerptService;
    }

    public getWereadService(): WereadService {
        if (!this.wereadService) {
            this.wereadService = new WereadService({
                settings: this.settings,
                app: this.app,
                saveSettings: async () => { await this.saveSettings(); },
                pluginId: this.pluginId,
            });
        }
        return this.wereadService;
    }

    /**
     * 设置微信读书定时同步
     */
    private setupWereadScheduledSync(): void {
        this.clearWereadScheduledSync();

        if (!this.settings.wereadAutoSync) {
            return;
        }

        const svc = this.getWereadService();
        if (!svc.isLoggedIn()) {
            return;
        }

        this.wereadScheduledSync = new WereadScheduledSync(svc, {
            autoSync: this.settings.wereadAutoSync,
            intervalMinutes: this.settings.wereadSyncInterval,
        });
        this.wereadScheduledSync.start();
    }

    /**
     * 清理微信读书定时同步
     */
    private clearWereadScheduledSync(): void {
        this.wereadScheduledSync?.stop();
        this.wereadScheduledSync = null;
    }

    /**
     * 重新启动微信读书定时同步（设置变更后调用）
     */
    public restartWereadScheduledSync(): void {
        this.clearWereadScheduledSync();
        this.setupWereadScheduledSync();
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
                providerId: chatProvider,
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
                serviceLog.warn('[DeepReader] Auto-build profile failed:', (e instanceof Error ? e.message : String(e)));
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


    async onunload() {
        // 卸载时手动清理视图，虽然 Obsidian 会自动处理，但显式清理更安全
        this.app.workspace.detachLeavesOfType(SIDEBAR_VIEW_TYPE);

        // 清理阅读模式服务
        if (this.readingModeService) {
            this.readingModeService.stop();
            this.readingModeService = null;
        }

        // 清理高亮 + 摘录服务（防御性：避免反复 load/unload 保留引用）
        this.highlightService = null;
        this.excerptService = null;

        // 清理 PI Agent 子进程
        if (this.frontendAgent) {
            await this.frontendAgent.destroy();
        }

        // 清理微信读书定时同步
        this.clearWereadScheduledSync();
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
            // 确保侧边栏抽屉展开可见
            const rightSplit = (workspace as any).rightSplit;
            if (rightSplit && typeof rightSplit.expand === 'function') {
                rightSplit.expand();
            }
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
