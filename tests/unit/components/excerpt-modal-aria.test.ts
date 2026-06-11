/**
 * ExcerptModal — 屏幕阅读器可访问性 + 异步保存防重
 *
 * 目标不变量：
 *  1. ARIA dialog 语义：role=dialog + aria-modal=true
 *  2. 标题关联：aria-labelledby 指向 modal 标题
 *  3. 表单 label 关联：textarea/input 有 for/id 关联
 *  4. 异步保存防重：第一次 click 后 disable + aria-busy=true
 *  5. 错误恢复：保存失败时按钮恢复可用
 *  6. 成功路径：保存成功后 modal 关闭
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// 局部 obsidian mock 覆盖全局 broken Modal
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
				// Mock Obsidian titleEl.setText
				(this.titleEl as any).setText = (text: string) => {
					this.titleEl.textContent = text;
				};
				document.body.appendChild(this.contentEl);
				document.body.appendChild(this.modalEl);
				document.body.appendChild(this.titleEl);
			}
			open() {}
			close() {}
			onOpen() {}
			onClose() {}
		},
	};
});

import { ExcerptModal } from "@/components/excerpt/excerpt-modal";
import type { ExcerptContent, ExcerptMetadata } from "@/types/excerpt";
import type { App } from "obsidian";

vi.mock("@/services/excerpt-service", () => ({
	ExcerptService: class MockExcerptService {
		getExcerptPath = vi.fn(() => "Exports/摘录/test-2026-06-11.md");
		saveExcerpt = vi.fn().mockResolvedValue("Exports/摘录/test-2026-06-11.md");
	},
}));

const mockContent: ExcerptContent = {
	text: "这是一段需要保存的摘录内容",
};

const mockMetadata: ExcerptMetadata = {
	sourceType: "reading",
	sourcePdf: "深度工作.pdf",
	chapterName: "第一章 专注力",
	page: 42,
};

describe("ExcerptModal — ARIA dialog + 表单 label + 异步保存防重", () => {
	let modal: ExcerptModal;
	let mockApp: App;

	beforeEach(() => {
		mockApp = {} as App;
		modal = new ExcerptModal({
			content: mockContent,
			metadata: mockMetadata,
			app: mockApp,
		});
		modal.onOpen();
		// 显式把 modal 挂到 body（Obsidian Modal 在真实环境由宿主挂载）
		document.body.appendChild(modal.contentEl);
	});

	afterEach(() => {
		modal.contentEl.remove();
	});

	function getSaveBtn(): HTMLButtonElement {
		return modal.contentEl.querySelector(
			".deeppdf-excerpt-save-btn",
		) as HTMLButtonElement;
	}

	function getCancelBtn(): HTMLButtonElement {
		return modal.contentEl.querySelector(
			".deeppdf-excerpt-cancel-btn",
		) as HTMLButtonElement;
	}

	describe("invariant 1 — ARIA dialog 语义", () => {
		it("modalEl 挂 role=dialog + aria-modal=true", () => {
			const modalEl = modal.modalEl as HTMLElement;
			expect(modalEl.getAttribute("role")).toBe("dialog");
			expect(modalEl.getAttribute("aria-modal")).toBe("true");
		});

		it("modalEl 通过 aria-labelledby 指向 modal 标题 id", () => {
			const modalEl = modal.modalEl as HTMLElement;
			const labelledBy = modalEl.getAttribute("aria-labelledby");
			expect(labelledBy).toBeTruthy();
			const titleEl = document.getElementById(labelledBy!);
			expect(titleEl?.textContent).toBe("保存摘录");
		});
	});

	describe("invariant 2 — 表单 label 关联（4.1.2 Name/Role/Value）", () => {
		it("笔记 textarea 的 label 有 for 属性指向 textarea id", () => {
			const label = modal.contentEl.querySelector(
				"label.deeppdf-excerpt-form-label",
			) as HTMLLabelElement;
			const textarea = modal.contentEl.querySelector(
				"textarea.deeppdf-excerpt-note-input",
			) as HTMLTextAreaElement;

			// 第一个 label 应该对应笔记 textarea
			const htmlFor = label.getAttribute("for");
			expect(htmlFor).toBeTruthy();
			expect(htmlFor).toBe(textarea.id);
		});

		it("路径 input 的 label 有 for 属性指向 input id", () => {
			const labels = modal.contentEl.querySelectorAll(
				"label.deeppdf-excerpt-form-label",
			);
			const input = modal.contentEl.querySelector(
				"input.deeppdf-excerpt-path-input",
			) as HTMLInputElement;

			// 找到 for 指向 path input 的那个 label
			const labelsArr = Array.from(labels) as HTMLLabelElement[];
			const pathLabel = labelsArr.find(
				(l) => l.getAttribute("for") === input.id,
			);
			expect(pathLabel).toBeTruthy();
		});
	});

	describe("invariant 3 — 异步保存防重", () => {
		it("第一次 click 触发保存；进行中 disabled + aria-busy=true", async () => {
			let resolveSave: (path: string | null) => void;
			const service = (modal as any).excerptService;
			service.saveExcerpt = vi.fn(
				() =>
					new Promise<string | null>((resolve) => {
						resolveSave = resolve;
					}),
			);

			const saveBtn = getSaveBtn();
			saveBtn.click();

			expect(saveBtn.disabled).toBe(true);
			expect(saveBtn.getAttribute("aria-busy")).toBe("true");
			expect(service.saveExcerpt).toHaveBeenCalledTimes(1);

			// 清理
			resolveSave!(null);
			await new Promise((r) => setTimeout(r, 10));
		});

		it("保存完成后 modal 关闭（正常路径）", async () => {
			const closeSpy = vi.spyOn(modal, "close");
			const saveBtn = getSaveBtn();
			saveBtn.click();

			// 等 microtask 队列完全 drain
			await new Promise((r) => setTimeout(r, 10));
			await Promise.resolve();

			expect(closeSpy).toHaveBeenCalled();
		});

		it("连续多次 click 只触发一次 saveExcerpt", async () => {
			let resolveSave: (path: string | null) => void;
			const service = (modal as any).excerptService;
			service.saveExcerpt = vi.fn(
				() =>
					new Promise<string | null>((resolve) => {
						resolveSave = resolve;
					}),
			);

			const saveBtn = getSaveBtn();
			saveBtn.click();
			saveBtn.click();
			saveBtn.click();

			expect(service.saveExcerpt).toHaveBeenCalledTimes(1);
			resolveSave!(null);
			await new Promise((r) => setTimeout(r, 10));
		});
	});

	describe("invariant 4 — 错误恢复", () => {
		it("saveExcerpt 抛错时：按钮恢复可用 + aria-busy 移除，modal 不关闭", async () => {
			const service = (modal as any).excerptService;
			service.saveExcerpt = vi.fn().mockRejectedValue(new Error("写入失败"));

			const closeSpy = vi.spyOn(modal, "close");
			const saveBtn = getSaveBtn();
			saveBtn.click();

			await new Promise((r) => setTimeout(r, 10));
			await Promise.resolve();

			expect(closeSpy).not.toHaveBeenCalled();
			expect(saveBtn.disabled).toBe(false);
			expect(saveBtn.getAttribute("aria-busy")).toBeNull();
		});

		it("错误后再次 click 仍能触发保存（恢复后可用）", async () => {
			const service = (modal as any).excerptService;
			service.saveExcerpt = vi
				.fn()
				.mockRejectedValueOnce(new Error("first fail"))
				.mockResolvedValueOnce("Exports/摘录/test-2026-06-11.md");

			const saveBtn = getSaveBtn();
			saveBtn.click();
			await new Promise((r) => setTimeout(r, 10));
			await Promise.resolve();

			saveBtn.click();
			await new Promise((r) => setTimeout(r, 10));
			await Promise.resolve();

			expect(service.saveExcerpt).toHaveBeenCalledTimes(2);
		});
	});

	describe("invariant 5 — cancel 按钮", () => {
		it("cancel 按钮关闭 modal（无异步）", () => {
			const closeSpy = vi.spyOn(modal, "close");
			const cancelBtn = getCancelBtn();
			cancelBtn.click();
			expect(closeSpy).toHaveBeenCalled();
		});
	});
});
