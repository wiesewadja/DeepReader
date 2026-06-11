/**
 * ConfirmModal — 屏幕阅读器可访问性 + 异步 onConfirm 防重
 *
 * 目标不变量：
 *  1. ARIA dialog 语义：modalEl role=dialog / aria-modal=true
 *  2. ARIA 关联：aria-labelledby 指向标题，aria-describedby 指向消息
 *  3. 异步防重：第一次 click 后，confirm 按钮禁用 + aria-busy=true；
 *     重复 click 不会触发第二次 onConfirm
 *  4. 错误恢复：onConfirm 抛错时，按钮恢复可用 + aria-busy 移除，modal 不关闭
 *  5. ESC 关闭：依赖 Obsidian Modal 行为（不在此文件重复测试）
 *  6. 复选框：状态正确传递给 onConfirm
 */

// 局部 mock 覆盖全局 obsidian mock 中的 Modal / Setting
// （全局 mock 中 Setting = vi.fn()，无法 new，Modal 是空 class）
import { vi } from "vitest";

vi.mock("obsidian", async (importOriginal) => {
	const actual = await importOriginal<typeof import("obsidian")>();
	return {
		...actual,
		Modal: class MockModal {
			contentEl: HTMLElement;
			modalEl: HTMLElement;
			app: unknown;
			constructor(app: unknown) {
				this.app = app;
				this.contentEl = document.createElement("div");
				this.modalEl = document.createElement("div");
				document.body.appendChild(this.contentEl);
				document.body.appendChild(this.modalEl);
			}
			open() {}
			close() {}
			// 子类会覆盖
			onOpen() {}
			onClose() {}
		},
		Setting: class MockSetting {
			settingEl: HTMLElement;
			constructor(containerEl: HTMLElement) {
				this.settingEl = document.createElement("div");
				containerEl.appendChild(this.settingEl);
			}
			addButton(cb: (btn: any) => any) {
				const buttonEl = document.createElement("button");
				const api = {
					buttonEl,
					setButtonText(text: string) {
						buttonEl.textContent = text;
						return api;
					},
					setCta() {
						buttonEl.classList.add("mod-cta");
						return api;
					},
					setDisabled(b: boolean) {
						buttonEl.disabled = b;
						return api;
					},
					onClick(handler: () => unknown) {
						buttonEl.addEventListener("click", handler);
						return api;
					},
				};
				cb(api);
				this.settingEl.appendChild(buttonEl);
				return this;
			}
		},
	};
});

import {
	describe,
	it,
	expect,
	beforeEach,
	afterEach,
	vi as vitest,
} from "vitest";
import { ConfirmModal } from "@/components/confirm-modal";
import type { App } from "obsidian";

describe("ConfirmModal — ARIA dialog + 异步 onConfirm 防重", () => {
	let modal: ConfirmModal;
	let mockOnConfirm: ReturnType<typeof vitest.fn>;
	let mockOnCancel: ReturnType<typeof vitest.fn>;
	let mockApp: App;

	beforeEach(() => {
		mockOnConfirm = vitest.fn();
		mockOnCancel = vitest.fn();
		mockApp = {} as App;
	});

	afterEach(() => {
		// 清理 modal 注入的 DOM
		const modals = document.querySelectorAll('.mock-modal, [role="dialog"]');
		modals.forEach((el) => el.parentElement?.removeChild(el));
	});

	function openModal(
		opts: {
			title?: string;
			message?: string;
			onConfirm?: (checked?: boolean) => void | Promise<void>;
			onCancel?: () => void | Promise<void>;
			checkbox?: { label: string; checked?: boolean };
		} = {},
	) {
		modal = new ConfirmModal(
			mockApp,
			opts.title ?? "删除这本书？",
			opts.message ?? "此操作不可撤销。",
			opts.onConfirm ?? mockOnConfirm,
			{
				onCancel: opts.onCancel ?? mockOnCancel,
				checkbox: opts.checkbox,
			},
		);
		modal.onOpen();
		return modal;
	}

	describe("invariant 1 — ARIA dialog 语义", () => {
		it("modalEl 挂 role=dialog + aria-modal=true", () => {
			openModal();
			expect(modal.modalEl.getAttribute("role")).toBe("dialog");
			expect(modal.modalEl.getAttribute("aria-modal")).toBe("true");
		});

		it("modalEl 通过 aria-labelledby 指向标题 id", () => {
			openModal();
			const labelledBy = modal.modalEl.getAttribute("aria-labelledby");
			expect(labelledBy).toBeTruthy();
			const titleEl = document.getElementById(labelledBy!);
			expect(titleEl?.textContent).toBe("删除这本书？");
			expect(titleEl?.tagName).toBe("H2");
		});

		it("modalEl 通过 aria-describedby 指向消息 id", () => {
			openModal();
			const describedBy = modal.modalEl.getAttribute("aria-describedby");
			expect(describedBy).toBeTruthy();
			const msgEl = document.getElementById(describedBy!);
			expect(msgEl?.textContent).toBe("此操作不可撤销。");
			expect(msgEl?.tagName).toBe("P");
		});

		it("title id 和 message id 是不同的（避免 aria 关联冲突）", () => {
			openModal();
			const labelledBy = modal.modalEl.getAttribute("aria-labelledby");
			const describedBy = modal.modalEl.getAttribute("aria-describedby");
			expect(labelledBy).not.toBe(describedBy);
		});
	});

	describe("invariant 2 — 异步 onConfirm 防重", () => {
		it("第一次 click 触发 onConfirm，第二次 click 不会（onConfirm 进行中）", async () => {
			let resolveConfirm: () => void;
			const slowConfirm = vitest.fn(
				() =>
					new Promise<void>((resolve) => {
						resolveConfirm = resolve;
					}),
			);
			const m = openModal({ onConfirm: slowConfirm });
			const confirmBtn = m.contentEl.querySelector(
				"button.mod-cta",
			) as HTMLButtonElement;

			confirmBtn.click();
			confirmBtn.click();
			confirmBtn.click();

			expect(slowConfirm).toHaveBeenCalledTimes(1);
			// 让 Promise resolve
			resolveConfirm!();
			await Promise.resolve();
		});

		it("onConfirm 进行中：confirm 按钮 disabled + aria-busy=true", async () => {
			let resolveConfirm: () => void;
			const slowConfirm = vitest.fn(
				() =>
					new Promise<void>((resolve) => {
						resolveConfirm = resolve;
					}),
			);
			const m = openModal({ onConfirm: slowConfirm });
			const confirmBtn = m.contentEl.querySelector(
				"button.mod-cta",
			) as HTMLButtonElement;

			confirmBtn.click();

			expect(confirmBtn.disabled).toBe(true);
			expect(confirmBtn.getAttribute("aria-busy")).toBe("true");

			resolveConfirm!();
			await Promise.resolve();
		});

		it("onConfirm 完成后 modal 关闭（normal flow）", async () => {
			const m = openModal({
				onConfirm: vitest.fn().mockResolvedValue(undefined),
			});
			const confirmBtn = m.contentEl.querySelector(
				"button.mod-cta",
			) as HTMLButtonElement;
			const closeSpy = vitest.spyOn(m, "close");

			confirmBtn.click();
			// 等 microtask 队列完全 drain
			await new Promise((r) => setTimeout(r, 10));
			await Promise.resolve();

			expect(closeSpy).toHaveBeenCalled();
		});
	});

	describe("invariant 3 — 错误恢复", () => {
		it("onConfirm 抛错时：按钮恢复可用 + aria-busy 移除，modal 不关闭", async () => {
			const m = openModal({
				onConfirm: vitest.fn().mockRejectedValue(new Error("网络超时")),
			});
			const confirmBtn = m.contentEl.querySelector(
				"button.mod-cta",
			) as HTMLButtonElement;
			const closeSpy = vitest.spyOn(m, "close");

			confirmBtn.click();
			// 等 promise rejection 走完
			await new Promise((r) => setTimeout(r, 10));
			await Promise.resolve();

			expect(closeSpy).not.toHaveBeenCalled();
			expect(confirmBtn.disabled).toBe(false);
			expect(confirmBtn.getAttribute("aria-busy")).toBeNull();
		});

		it("onConfirm 抛错后：再次 click 仍能触发 onConfirm（恢复后可用）", async () => {
			const confirmFn = vitest
				.fn()
				.mockRejectedValueOnce(new Error("first fail"))
				.mockResolvedValueOnce(undefined);
			const m = openModal({ onConfirm: confirmFn });
			const confirmBtn = m.contentEl.querySelector(
				"button.mod-cta",
			) as HTMLButtonElement;

			confirmBtn.click();
			await new Promise((r) => setTimeout(r, 10));
			await Promise.resolve();

			confirmBtn.click();
			await Promise.resolve();
			await Promise.resolve();

			expect(confirmFn).toHaveBeenCalledTimes(2);
		});
	});

	describe("invariant 4 — 复选框传递", () => {
		it("onConfirm 收到当前复选框状态", async () => {
			const confirmFn = vitest.fn().mockResolvedValue(undefined);
			const m = openModal({
				onConfirm: confirmFn,
				checkbox: { label: "同时清除缓存", checked: false },
			});
			const confirmBtn = m.contentEl.querySelector(
				"button.mod-cta",
			) as HTMLButtonElement;
			const checkbox = m.contentEl.querySelector(
				'input[type="checkbox"]',
			) as HTMLInputElement;

			// 切换复选框
			checkbox.checked = true;
			checkbox.dispatchEvent(new Event("change"));

			confirmBtn.click();
			await new Promise((r) => setTimeout(r, 10));
			await Promise.resolve();

			expect(confirmFn).toHaveBeenCalledWith(true);
		});
	});
});
