/**
 * 聊天组件协调器（深模块）
 *
 * 把 ReadingModeService 中与"奚童悬浮球 + 移动端 Fab + 聊天态 + 移动端 navbar 显隐"
 * 相关的状态与动作抽到本模块，使 Shell（ReadingModeService）退化为生命周期编排器。
 *
 * 依赖边界（全部经构造函数注入，便于独立单测、解耦 Shell）：
 * - `app`：Obsidian API（getLeavesOfType / workspace 右栏操作）；
 * - `getIsActive` / `getActiveContainerEl`：读取 Shell 实时状态（这两个字段在激活期可变）；
 * - `onQuickQuestion` / `onRevealSidebar`：透传 callbacks（闭包读实时 callbacks，确保
 *   setCallbacks 替换后仍命中最新）。
 *
 * 共享态（isChatThinking / hasUnreadChatReply / lastSidebarOpen / xitongWidget / mobileFab）
 * 集中由本模块自管（对应 spec 风险 R3：Shell 的 layout-change / resize handler 仍回调
 * 本模块的 updateVisibility()，不可重排到别处）。
 */

import { App, Platform } from "obsidian";
import { serviceLog } from "../../utils/logger.js";
import { XitongFloatWidget } from "./xitong-float-widget.js";
import { MobileReadingFab } from "./mobile-reading-fab.js";

export interface ChatWidgetCoordinatorDeps {
	/** 读取 Shell 实时激活态 */
	getIsActive: () => boolean;
	/** 读取 Shell 实时阅读容器元素 */
	getActiveContainerEl: () => HTMLElement | null;
	/** 快捷提问回调（透传 callbacks.onQuickQuestion） */
	onQuickQuestion: (question: string) => Promise<void>;
	/** 展开侧栏回调（透传 callbacks.onRevealSidebar） */
	onRevealSidebar: () => void;
	/** 侧栏视图类型常量（由 Shell 注入，避免本模块反向依赖 sidebar-view 重量级模块） */
	sidebarViewType: string;
}

export class ChatWidgetCoordinator {
	private app: App;
	private getIsActive: () => boolean;
	private getActiveContainerEl: () => HTMLElement | null;
	private onQuickQuestion: (question: string) => Promise<void>;
	private onRevealSidebar: () => void;
	private sidebarViewType: string;

	private xitongWidget: XitongFloatWidget | null = null;
	private mobileFab: MobileReadingFab | null = null;
	private isChatThinking: boolean = false;
	private hasUnreadChatReply: boolean = false;
	/** 缓存上次悬浮球显隐状态，仅状态翻转时才动 DOM/打日志，避免 layout-change/resize 高频触发刷屏 */
	private lastSidebarOpen: boolean | null = null;

	constructor(app: App, deps: ChatWidgetCoordinatorDeps) {
		this.app = app;
		this.getIsActive = deps.getIsActive;
		this.getActiveContainerEl = deps.getActiveContainerEl;
		this.onQuickQuestion = deps.onQuickQuestion;
		this.onRevealSidebar = deps.onRevealSidebar;
		this.sidebarViewType = deps.sidebarViewType;
	}

	/**
	 * 初始化移动端浮动按钮（仅移动端；桌面端早退）
	 */
	initMobileFab(): void {
		if (!Platform.isMobile) return;
		this.mobileFab = new MobileReadingFab(() => {
			const leaf = this.app.workspace.getRightLeaf(false);
			if (leaf) {
				leaf.setViewState({ type: "deepreader-sidebar", active: true });
				this.app.workspace.revealLeaf(leaf);
				// 确保在手机端侧边栏滑动抽屉能正常拉出/展开
				const rightSplit = (this.app.workspace as any).rightSplit;
				if (rightSplit && typeof rightSplit.expand === "function") {
					rightSplit.expand();
				}
			}
		});
		this.mobileFab.show();
	}

	/**
	 * 显示/隐藏 Obsidian 移动端底部导航栏
	 * 阅读模式下隐藏以最大化阅读区域，退出时恢复
	 */
	toggleMobileNavbar(visible: boolean): void {
		if (!Platform.isMobile) return;
		const navbar = document.querySelector(".mobile-navbar") as HTMLElement | null;
		if (navbar) {
			navbar.style.display = visible ? "" : "none";
		}
	}

	/**
	 * 更新 FAB 未读状态
	 */
	setFabUnread(hasUnread: boolean): void {
		this.mobileFab?.setUnread(hasUnread);
	}

	/**
	 * 动态显示/隐藏桌面端提问悬浮球（R3：由 Shell 的 layout-change/resize handler 回调）
	 * 桌面端：右边栏在视口中时隐藏奚童，不在时显示；
	 * 移动端：只要阅读模式激活就显示。
	 * 仅在状态翻转时执行 DOM 操作与日志。
	 */
	updateVisibility(): void {
		if (!this.getIsActive() || !this.getActiveContainerEl()) {
			if (this.xitongWidget) {
				this.xitongWidget.hide();
				this.xitongWidget = null;
			}
			this.lastSidebarOpen = null;
			return;
		}

		let shouldShow = true;

		if (!Platform.isMobile) {
			const leaves = this.app.workspace.getLeavesOfType(this.sidebarViewType);
			if (leaves.length > 0) {
				const sidebarEl = (leaves[0].view as any)?.containerEl;
				if (sidebarEl) {
					const rect = sidebarEl.getBoundingClientRect();
					const isSidebarVisible = rect.width > 0 && rect.right > 0;
					shouldShow = !isSidebarVisible;
				}
			}
		}

		// 仅在状态翻转时执行 DOM 操作与日志
		if (shouldShow === this.lastSidebarOpen) return;
		this.lastSidebarOpen = shouldShow;

		serviceLog("[ReadingMode] updateXitongWidgetVisibility: shouldShow=" + shouldShow);

		if (!shouldShow) {
			this.hasUnreadChatReply = false;
			if (this.xitongWidget) {
				this.xitongWidget.hide();
				this.xitongWidget = null;
			}
		} else {
			if (!this.xitongWidget) {
				this.xitongWidget = new XitongFloatWidget(
					this.app,
					this.getActiveContainerEl()!,
					async (question) => {
						await this.onQuickQuestion(question);
					},
					() => {
						this.hasUnreadChatReply = false;
						this.onRevealSidebar();
					},
				);
				this.xitongWidget.show();
				if (this.isChatThinking) {
					this.xitongWidget.setThinking(true);
				} else if (this.hasUnreadChatReply) {
					this.xitongWidget.setUnread(true);
				}
			}
		}
	}

	/** AI 开始思考：置思考态、清未读、驱动悬浮球思考动效 */
	notifyChatStarted(): void {
		this.isChatThinking = true;
		this.hasUnreadChatReply = false;
		this.xitongWidget?.setThinking(true);
	}

	/** AI 回复到达（含出错）：若处于思考态则标记未读，并清除思考态 */
	notifyChatReplyReceived(): void {
		if (this.isChatThinking) {
			this.hasUnreadChatReply = true;
			this.xitongWidget?.setUnread(true);
		}
		this.clearChatThinking();
	}

	/** 仅清除思考态，不产生未读副作用。用于 reset / 取消等重置场景 */
	clearChatThinking(): void {
		this.isChatThinking = false;
		this.xitongWidget?.setThinking(false);
	}

	/** TTS 朗读状态变化时驱动悬浮球朗读动效（message + reading 两路朗读统一入口） */
	setXitongReading(reading: boolean): void {
		this.xitongWidget?.setReading(reading);
	}

	/**
	 * 清理聊天组件（由 Shell 在 deactivate 时调用）：销毁 FAB、隐藏悬浮球、复位状态
	 */
	destroy(): void {
		this.mobileFab?.destroy();
		this.mobileFab = null;

		if (this.xitongWidget) {
			this.xitongWidget.hide();
			this.xitongWidget = null;
		}
		this.lastSidebarOpen = null;
	}
}
