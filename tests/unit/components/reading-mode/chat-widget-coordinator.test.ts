import { describe, it, expect, vi, beforeEach } from "vitest";
import { Platform } from "obsidian";
import { ChatWidgetCoordinator } from "@/components/reading-mode/chat-widget-coordinator.js";

// 用 mock 替换具体 widget 类，便于断言方法调用与捕获实例
vi.mock("@/components/reading-mode/xitong-float-widget.js", () => {
	const instances: any[] = [];
	class XitongFloatWidget {
		onQuick: any;
		onReveal: any;
		setThinking = vi.fn();
		setUnread = vi.fn();
		setReading = vi.fn();
		show = vi.fn();
		hide = vi.fn();
		constructor(_app: any, _el: any, onQuick: any, onReveal: any) {
			this.onQuick = onQuick;
			this.onReveal = onReveal;
			instances.push(this);
		}
	}
	return { XitongFloatWidget, __getInstances: () => instances };
});

vi.mock("@/components/reading-mode/mobile-reading-fab.js", () => {
	const instances: any[] = [];
	class MobileReadingFab {
		onClick: any;
		setUnread = vi.fn();
		show = vi.fn();
		destroy = vi.fn();
		constructor(onClick: any) {
			this.onClick = onClick;
			instances.push(this);
		}
	}
	return { MobileReadingFab, __getInstances: () => instances };
});

import * as xitongMod from "@/components/reading-mode/xitong-float-widget.js";
import * as fabMod from "@/components/reading-mode/mobile-reading-fab.js";
const getXitongInstances = () => (xitongMod as any).__getInstances() as any[];
const getFabInstances = () => (fabMod as any).__getInstances() as any[];

function makeApp(overrides: Partial<any> = {}) {
	return {
		workspace: {
			getLeavesOfType: vi.fn(() => []),
			getRightLeaf: vi.fn(() => ({ setViewState: vi.fn(), revealLeaf: vi.fn() })),
			...overrides.workspace,
		},
		...overrides,
	} as any;
}

let app: any;
let getIsActive: ReturnType<typeof vi.fn>;
let getActiveContainerEl: ReturnType<typeof vi.fn>;
let onQuickQuestion: ReturnType<typeof vi.fn>;
let onRevealSidebar: ReturnType<typeof vi.fn>;
let coordinator: ChatWidgetCoordinator;

beforeEach(() => {
	app = makeApp();
	getIsActive = vi.fn(() => false);
	getActiveContainerEl = vi.fn(() => null);
	onQuickQuestion = vi.fn().mockResolvedValue(undefined);
	onRevealSidebar = vi.fn();
	getXitongInstances().length = 0;
	getFabInstances().length = 0;
	coordinator = new ChatWidgetCoordinator(app, {
		getIsActive,
		getActiveContainerEl,
		onQuickQuestion,
		onRevealSidebar,
		sidebarViewType: "deeppdf-sidebar-view",
	});
});

describe("ChatWidgetCoordinator 聊天态联动", () => {
	it("notifyChatStarted 置思考态并驱动悬浮球 setThinking(true)", () => {
		// 先激活态建一个 widget
		getIsActive.mockReturnValue(true);
		getActiveContainerEl.mockReturnValue(document.createElement("div"));
		coordinator.updateVisibility();
		const widget = getXitongInstances()[0];
		widget.setThinking.mockClear();

		coordinator.notifyChatStarted();

		expect(widget.setThinking).toHaveBeenCalledWith(true);
	});

	it("notifyChatReplyReceived 在思考态标记未读并随后清除思考态", () => {
		getIsActive.mockReturnValue(true);
		getActiveContainerEl.mockReturnValue(document.createElement("div"));
		coordinator.updateVisibility();
		const widget = getXitongInstances()[0];
		widget.setUnread.mockClear();
		widget.setThinking.mockClear();

		// 先进入思考态，再收到回复
		coordinator.notifyChatStarted();
		coordinator.notifyChatReplyReceived();

		expect(widget.setUnread).toHaveBeenCalledWith(true);
		expect(widget.setThinking).toHaveBeenCalledWith(false); // clearChatThinking
	});

	it("clearChatThinking 清除思考态并驱动 setThinking(false)", () => {
		getIsActive.mockReturnValue(true);
		getActiveContainerEl.mockReturnValue(document.createElement("div"));
		coordinator.updateVisibility();
		const widget = getXitongInstances()[0];
		widget.setThinking.mockClear();

		coordinator.clearChatThinking();

		expect(widget.setThinking).toHaveBeenCalledWith(false);
	});

	it("setXitongReading 透传到悬浮球 setReading", () => {
		getIsActive.mockReturnValue(true);
		getActiveContainerEl.mockReturnValue(document.createElement("div"));
		coordinator.updateVisibility();
		const widget = getXitongInstances()[0];
		widget.setReading.mockClear();

		coordinator.setXitongReading(true);
		coordinator.setXitongReading(false);

		expect(widget.setReading).toHaveBeenNthCalledWith(1, true);
		expect(widget.setReading).toHaveBeenNthCalledWith(2, false);
	});
});

describe("ChatWidgetCoordinator FAB 未读", () => {
	it("initMobileFab 在移动端创建 FAB 并 show；setFabUnread 透传", () => {
		(Platform as any).isMobile = true;
		coordinator.initMobileFab();
		const fab = getFabInstances()[0];
		expect(fab).toBeTruthy();
		expect(fab.show).toHaveBeenCalledTimes(1);

		fab.setUnread.mockClear();
		coordinator.setFabUnread(true);
		expect(fab.setUnread).toHaveBeenCalledWith(true);
	});

	it("initMobileFab 在桌面端不创建 FAB（早退）", () => {
		(Platform as any).isMobile = false;
		coordinator.initMobileFab();
		expect(getFabInstances().length).toBe(0);
	});
});

describe("ChatWidgetCoordinator updateVisibility", () => {
	it("非激活态：隐藏并丢弃已有 widget、复位 lastSidebarOpen", () => {
		// 先激活建 widget
		getIsActive.mockReturnValue(true);
		getActiveContainerEl.mockReturnValue(document.createElement("div"));
		coordinator.updateVisibility();
		const widget = getXitongInstances()[0];
		widget.hide.mockClear();

		// 切到非激活
		getIsActive.mockReturnValue(false);
		coordinator.updateVisibility();

		expect(widget.hide).toHaveBeenCalledTimes(1);
	});

	it("激活态且无侧栏叶子：创建并显示 widget", () => {
		getIsActive.mockReturnValue(true);
		getActiveContainerEl.mockReturnValue(document.createElement("div"));
		app.workspace.getLeavesOfType.mockReturnValue([]); // 无侧栏 → shouldShow=true

		coordinator.updateVisibility();

		const widget = getXitongInstances()[0];
		expect(widget).toBeTruthy();
		expect(widget.show).toHaveBeenCalledTimes(1);
	});
});

describe("ChatWidgetCoordinator destroy", () => {
	it("销毁 FAB 与 widget 并复位状态", () => {
		(Platform as any).isMobile = true;
		coordinator.initMobileFab();
		const fab = getFabInstances()[0];
		getIsActive.mockReturnValue(true);
		getActiveContainerEl.mockReturnValue(document.createElement("div"));
		coordinator.updateVisibility();
		const widget = getXitongInstances()[0];

		coordinator.destroy();

		expect(fab.destroy).toHaveBeenCalledTimes(1);
		expect(widget.hide).toHaveBeenCalledTimes(1);
	});
});

describe("ChatWidgetCoordinator toggleMobileNavbar", () => {
	it("桌面端早退：不触碰 DOM navbar", () => {
		(Platform as any).isMobile = false;
		const spy = vi.spyOn(document, "querySelector");
		coordinator.toggleMobileNavbar(false);
		expect(spy).not.toHaveBeenCalled();
		spy.mockRestore();
	});

	it("移动端：false 隐藏 navbar，true 恢复", () => {
		(Platform as any).isMobile = true;
		const navbar = document.createElement("div");
		navbar.className = "mobile-navbar";
		document.body.appendChild(navbar);

		coordinator.toggleMobileNavbar(false);
		expect(navbar.style.display).toBe("none");
		coordinator.toggleMobileNavbar(true);
		expect(navbar.style.display).toBe("");

		document.body.removeChild(navbar);
	});
});
