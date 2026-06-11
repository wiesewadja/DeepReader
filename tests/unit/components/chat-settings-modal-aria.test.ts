/**
 * ChatSettingsModal — 屏幕阅读器可访问性
 *
 * 目标不变量：
 *  1. ARIA dialog 语义：role=dialog + aria-modal=true
 *  2. 标题关联：aria-labelledby 指向 modal 标题
 *  3. 描述关联：aria-describedby 指向 modal 描述
 *  4. 焦点管理：打开时焦点落到关闭按钮（可观察：按钮被 focus）
 *  5. onClose 清理：destroy 时清空 agentModeToggle 引用（避免内存泄漏）
 *
 * 注：本 modal 没有异步操作，所以不需要 aria-busy / 防重
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("obsidian", async (importOriginal) => {
	const actual = await importOriginal<typeof import("obsidian")>();
	return {
		...actual,
		Modal: class MockModal {
			contentEl: HTMLElement;
			modalEl: HTMLElement;
			titleEl: HTMLElement;
			app: unknown;
			constructor(app: unknown) {
				this.app = app;
				this.contentEl = document.createElement("div");
				this.modalEl = document.createElement("div");
				this.titleEl = document.createElement("div");
				document.body.appendChild(this.contentEl);
				document.body.appendChild(this.modalEl);
			}
			open() {}
			close() {}
			onOpen() {}
			onClose() {}
		},
	};
});

import { ChatSettingsModal } from "@/components/chat-settings-modal/chat-settings-modal";
import type { App } from "obsidian";

describe("ChatSettingsModal — ARIA dialog semantics", () => {
	let modal: ChatSettingsModal;
	let mockOnModeChange: ReturnType<typeof vi.fn>;
	let mockApp: App;

	beforeEach(() => {
		mockOnModeChange = vi.fn();
		mockApp = {} as App;
		modal = new ChatSettingsModal(mockApp, {
			initialMode: "fast",
			onModeChange: mockOnModeChange,
		});
		modal.onOpen();
	});

	afterEach(() => {
		modal.onClose();
		modal.contentEl.remove();
		modal.modalEl.remove();
	});

	describe("invariant 1 — ARIA dialog 语义", () => {
		it("modalEl 挂 role=dialog + aria-modal=true", () => {
			expect(modal.modalEl.getAttribute("role")).toBe("dialog");
			expect(modal.modalEl.getAttribute("aria-modal")).toBe("true");
		});
	});

	describe("invariant 2 — 标题关联", () => {
		it("aria-labelledby 指向 modal 标题 id", () => {
			const labelledBy = modal.modalEl.getAttribute("aria-labelledby");
			expect(labelledBy).toBeTruthy();
			const titleEl = document.getElementById(labelledBy!);
			expect(titleEl?.textContent).toBe("聊天设置");
		});
	});

	describe("invariant 3 — 描述关联", () => {
		it("aria-describedby 指向 modal 描述 id", () => {
			const describedBy = modal.modalEl.getAttribute("aria-describedby");
			expect(describedBy).toBeTruthy();
			const descEl = document.getElementById(describedBy!);
			expect(descEl?.textContent).toBe("配置聊天模式和回答偏好");
		});
	});

	describe("invariant 4 — 焦点管理", () => {
		it("打开时焦点落到关闭按钮", async () => {
			// modal 内部用 setTimeout(50) 转移焦点，需要等
			await new Promise((r) => setTimeout(r, 80));
			const closeBtn = modal.contentEl.querySelector(
				"button.mod-cta",
			) as HTMLButtonElement;
			expect(document.activeElement).toBe(closeBtn);
		});
	});

	describe("invariant 5 — onClose 清理", () => {
		it("关闭时清空 agentModeToggle 引用（防内存泄漏）", () => {
			// 关闭前 toggle 存在
			expect((modal as any).agentModeToggle).not.toBeNull();
			modal.onClose();
			expect((modal as any).agentModeToggle).toBeNull();
		});
	});

	describe("regression — 关闭按钮工作", () => {
		it("点击关闭按钮调用 close()", () => {
			const closeSpy = vi.spyOn(modal, "close");
			const closeBtn = modal.contentEl.querySelector(
				"button.mod-cta",
			) as HTMLButtonElement;
			closeBtn.click();
			expect(closeSpy).toHaveBeenCalled();
		});
	});
});
