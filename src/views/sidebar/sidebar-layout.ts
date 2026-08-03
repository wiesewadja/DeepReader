/**
 * sidebar-layout
 *
 * 侧边栏 DOM 脚手架与回调装配，从 SidebarView 剥离的纯 UI 装配层。
 * SidebarView 只负责 lifecycle + domain wiring + 公有 API，DOM 段落构造集中在此。
 */

import { ConfirmModal } from "../../components/confirm-modal.js";
import {
	MessageList,
	type GuidanceType,
} from "../../components/message-list/message-list.js";
import { ReadingTopbar } from "../../components/reading-topbar/index.js";
import { ChatInput } from "../../components/chat-input/chat-input.js";
import type { QuoteMetadata } from "../../components/chat-input/chat-input.js";
import { Platform } from "obsidian";
import { resolveRoleConfig } from "../../config/providers.js";
import type { ExcerptContent, ExcerptMetadata } from "../../types/excerpt.js";
import { uiLog as log } from "../../utils/logger.js";
import type { BookDomain } from "./domains/book-domain.js";
import type { SessionDomain } from "./domains/session-domain.js";
import type { TTSDomain } from "./domains/tts-domain.js";
import type { VoiceDomain } from "./domains/voice-domain.js";
import type { ExcerptController } from "./excerpt-controller.js";
import type { QuoteManager } from "./quote-manager.js";
import type { ChatDocumentService } from "./services/chat-document-service.js";
import { copyToClipboard } from "./search-utils.js";

/** 装配层需要的 View 能力（SidebarView 实现此接口） */
export interface SidebarLayoutHost {
	app: import("obsidian").App;
	plugin: import("../../agent/tools/context/vault.js").DeepReaderPluginInterface;
	bookDomain: BookDomain;
	sessionDomain: SessionDomain;
	ttsDomain: TTSDomain;
	voiceDomain: VoiceDomain;
	excerptController: ExcerptController;
	quoteManager: QuoteManager;
	chatDocumentService: ChatDocumentService | null;
	/** Obsidian registerEvent（用于注册 workspace 事件，自动随 view 卸载清理） */
	registerEvent: (event: import("obsidian").EventRef) => void;
	/** 公有/视图行为回调 */
	exitBooklist: () => void;
	toggleReadingTTS: () => Promise<void>;
	selectIndex: (indexId: string) => Promise<void>;
	autoSyncCurrentChapter: () => Promise<void>;
	getMessageList: () => MessageList | null;
	getChatInput: () => ChatInput | null;
	getReadingTopbar: () => ReadingTopbar | null;
}

/** 创建阅读顶栏（书名/封面/设置/朗读入口） */
export function createReadingTopbar(host: SidebarLayoutHost): ReadingTopbar {
	return new ReadingTopbar({
		onOpenLibrary: () => host.bookDomain.openLibrary(),
		onOpenSettings: () => {
			// 打开设置并定位到 DeepPDF 插件
			const setting = (host.app as unknown as { setting?: { open: () => void; openTabById: (id: string) => void } }).setting;
			if (setting) {
				setting.open();
				setting.openTabById(host.plugin.manifest.id);
			}
		},
		onCoverClick: async () => {
			const service = host.plugin.readingModeService;
			if (!service) return;
			const opened = await service.openMostRecent();
			if (!opened) {
				// 无最近阅读历史：fallback 到书库
				host.bookDomain.openLibrary();
			}
		},
		onExitBooklist: () => host.exitBooklist(),
		onBooklistRename: (newName: string) => {
			host.bookDomain.renameBooklist(newName);
		},
		onToggleReadingTTS: () => host.toggleReadingTTS(),
	});
}

/**
 * 创建消息列表段。返回 MessageList 与回调装配对象；ChatPresenter 由调用方持有。
 * （ChatPresenter 需要 messageList/chatInput/readingTopbar 的 getter，由调用方构造）
 */
export function createMessageListSection(
	container: HTMLElement,
	host: SidebarLayoutHost,
): MessageList {
	const section = container.createDiv({ cls: "deeppdf-message-list-section" });

	const messageList = new MessageList(buildMessageListHandlers(host), host.app);
	const el = messageList.getElement();
	if (el) section.appendChild(el);
	return messageList;
}

function buildMessageListHandlers(host: SidebarLayoutHost) {
	return {
		onRegenerate: async (messageId: string) => {
			const removedIds = await host.sessionDomain.handleRegenerate(messageId);
			if (removedIds && removedIds.length > 0) {
				host.getMessageList()?.removeMessages(removedIds);
			}
		},
		onCopy: (messageId: string) => {
			const content = host.getMessageList()?.getMessage(messageId)?.getData().content;
			if (content) copyToClipboard(content);
		},
		onQuestionClick: (question: string) => {
			host.sessionDomain.handleQuestionClick(question);
		},
		onGenerateOutline: () => {
			host.sessionDomain.handleGenerateOutline();
		},
		onGuidanceClick: (type: GuidanceType) => {
			host.sessionDomain.handleGuidanceClick(type);
		},
		onExcerpt: (
			messageId: string,
			content: ExcerptContent,
			metadata: ExcerptMetadata,
		) => {
			host.excerptController.openChatExcerpt(messageId, content, metadata);
		},
		onQuote: (metadata: QuoteMetadata) => {
			host.quoteManager.handleQuoteSelection(metadata);
		},
		onDelete: (messageId: string) => {
			new ConfirmModal(
				host.app,
				"删除对话",
				"此操作不可撤销",
				async () => {
					const deletedIds =
						await host.sessionDomain.handleDeleteMessagePair(messageId);
					host.getMessageList()?.removeMessages(deletedIds);
				},
			).open();
		},
		onTTS: async (messageId: string, content: string) => {
			// 喇叭按钮始终直接朗读原文，不走摘要模式
			host.ttsDomain.speak(messageId, content);
		},
		onStreamingEnd: (messageId: string, content: string) => {
			host.ttsDomain.preloadPreview(messageId, content, {
				indexId: host.bookDomain.currentIndexId || undefined,
				pdfName:
					host.bookDomain.getDisplayName(host.bookDomain.currentPdfName || "") ||
					undefined,
				author: host.bookDomain.currentBookAuthor || undefined,
			});
		},
		getCurrentBookInfo: () => ({
			coverUrl: host.bookDomain.currentBookCoverUrl,
			author: host.bookDomain.currentBookAuthor,
			bookName: host.bookDomain.currentPdfName,
		}),
	};
}

/** 创建聊天输入段。返回 ChatInput 与引用卡片容器。 */
export function createChatInputSection(
	container: HTMLElement,
	host: SidebarLayoutHost,
	voiceEnabled: boolean,
): { chatInput: ChatInput; quotesContainer: HTMLElement } {
	const section = container.createDiv({ cls: "deeppdf-chat-input-section" });

	// quotesContainer 在 ChatInput 之后创建，onHeightChange 通过闭包在运行时读取
	let quotesContainer: HTMLElement;

	const chatInput = new ChatInput({
		placeholder: Platform.isMobile ? "长按说话，或输入文字" : "输入以开始对话...",
		onSend: (message: string) => {
			// 使用 sidebar 自己管理的引用列表（而非 ChatInput 内部的空数组）
			host.sessionDomain.sendUserMessage(message, host.quoteManager.getQuotes());
		},
		app: host.app,
		onStop: () => {
			host.sessionDomain.stopGeneration();
		},
		onHeightChange: (height: number) => {
			// 动态调整消息列表的底部间距（包含引用卡片高度）
			const quotesHeight = quotesContainer?.offsetHeight || 0;
			host.getMessageList()?.updateBottomPadding(height, quotesHeight);
		},
		onLoadCurrentDoc: async () => {
			await host.chatDocumentService?.loadCurrentDocument();
		},
		onUnloadCurrentDoc: async () => {
			const activeFile = host.app.workspace.getActiveFile();
			if (activeFile) host.chatDocumentService?.removeDocument(activeFile.path);
		},
		onVoiceStart: voiceEnabled
			? () => host.voiceDomain.startVoiceRecording()
			: undefined,
		onVoiceStop: voiceEnabled
			? () => host.voiceDomain.stopVoiceRecording()
			: undefined,
		onVoiceCancel: voiceEnabled
			? () => host.voiceDomain.cancelVoiceRecording()
			: undefined,
	});

	// 创建引用卡片容器（在输入框上方）
	quotesContainer = section.createDiv({ cls: "deeppdf-quotes-container" });
	// 接线 QuoteManager：告诉它往哪里渲染卡片
	// 311b3a61 refactor 误删过这个调用，导致引用卡片永远不出现
	host.quoteManager.setContainer(quotesContainer);

	const chatInputEl = chatInput.getElement();
	if (chatInputEl) section.appendChild(chatInputEl);

	return { chatInput, quotesContainer };
}

/** 语音输入是否可启用（需要 tts + chat 双角色 API Key） */
export function isVoiceEnabled(plugin: SidebarLayoutHost["plugin"]): boolean {
	const ttsConfig = resolveRoleConfig("tts", plugin.settings);
	const chatConfig = resolveRoleConfig("chat", plugin.settings);
	return !!(ttsConfig && chatConfig);
}

/**
 * 注册工作区事件（select-index / quote-selection / excerpt-selection / active-leaf-change）。
 * 通过 host.registerEvent 注册，自动随 View 卸载清理。
 */
export function registerWorkspaceEvents(host: SidebarLayoutHost): void {
	// 自定义事件，Obsidian 类型定义不支持，使用 any 绕过
	const workspace = host.app.workspace as unknown as import("obsidian").Workspace & {
		on(name: "deeppdf:select-index", cb: (indexId: string) => void): import("obsidian").EventRef;
		on(name: "deeppdf:quote-selection", cb: (m: QuoteMetadata) => void): import("obsidian").EventRef;
		on(name: "deeppdf:excerpt-selection", cb: (text: string, range: Range) => void): import("obsidian").EventRef;
	};

	host.registerEvent(
		workspace.on("deeppdf:select-index", async (indexId: string) => {
			log("[DeepPDF] Received select-index event:", indexId);

			// 如果当前处于跨书籍模式，先切换回单书籍模式
			if (host.sessionDomain.crossBookMode) {
				log("[DeepPDF] 从阅读入口点击，自动关闭跨书籍模式");
				host.sessionDomain.crossBookMode = false;
				host.getReadingTopbar()?.setCrossBookMode(false);
				host.plugin.settings.lastCrossBookMode = false;
				await host.plugin.saveSettings();

				// 取消任何正在进行的流式请求，避免旧回调更新新消息列表
				host.sessionDomain.cancelStream();

				// 清空跨书籍模式的消息，准备加载单书籍会话
				host.getMessageList()?.clear();
			}

			// 直接调用 selectIndex 方法，确保顶栏正确更新
			await host.selectIndex(indexId);
		}),
	);

	host.registerEvent(
		workspace.on("deeppdf:quote-selection", async (metadata: QuoteMetadata) => {
			log("[DeepPDF] Received quote-selection event");
			host.quoteManager.handleQuoteSelection(metadata);
		}),
	);

	host.registerEvent(
		workspace.on("deeppdf:excerpt-selection", async (text: string, range: Range) => {
			log("[DeepPDF] Received excerpt-selection event");
			host.excerptController.handleSelection(text, range);
		}),
	);

	host.registerEvent(
		host.app.workspace.on("active-leaf-change", () => {
			const ds = host.chatDocumentService;
			if (ds) {
				const activeFile = host.app.workspace.getActiveFile();
				const isLoaded = activeFile ? ds.hasDocument(activeFile.path) : false;
				host.getChatInput()?.setLoadBtnActive(isLoaded);
			}
			// 自动同步当前章节到上下文
			host.autoSyncCurrentChapter();
		}),
	);
}
