/**
 * StreamingRenderer 屏幕阅读器可访问性 — ARIA live region 不变量
 *
 * 目标（设计不变量）：
 *  1. 流式开始：contentEl 上挂 aria-live=polite + aria-atomic=false + aria-busy=true
 *  2. 流式持续：ARIA 属性不被后续 streamingUpdate 覆盖/删除
 *  3. 流式结束：fullUpdate 将 aria-busy 置为 false；aria-live/aria-atomic 保留
 *     （以备后续重启用 / 用户重新展开消息时屏幕阅读器仍能感知）
 *  4. destroy 后：内部状态清空，新一轮 streamingUpdate 可重新挂 ARIA
 *
 * WCAG 参考：
 *  - 4.1.3 Status Messages (Level AA): 状态消息必须能被辅助技术感知
 *  - aria-busy 阻止 screen reader 在内容频繁变更时持续打断
 *  - aria-live=polite 等当前朗读完后才播报新内容（适合长文本流）
 *  - aria-atomic=false 让 screen reader 朗读增量而非整段
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { StreamingRenderer } from "@/components/message/streaming-renderer";
import type { MessageData } from "@/components/message/types";

const mockData: MessageData = {
	id: "test-msg",
	role: "assistant",
	content: "",
	timestamp: "2026-06-11T00:00:00Z",
	isStreaming: true,
	pdfName: "test.pdf",
};

function makeHost(contentEl: HTMLElement) {
	return {
		get el() {
			return contentEl;
		},
		get app() {
			return undefined; // 不触发 MarkdownRenderer
		},
		get data() {
			return mockData;
		},
		get observers() {
			return [] as MutationObserver[];
		},
		escapeHtml: (text: string) =>
			text.replace(
				/[&<>"']/g,
				(c) =>
					({
						"&": "&amp;",
						"<": "&lt;",
						">": "&gt;",
						'"': "&quot;",
						"'": "&#39;",
					})[c] || c,
			),
	};
}

describe("StreamingRenderer — ARIA live region for screen readers", () => {
	let contentEl: HTMLElement;
	let renderer: StreamingRenderer;

	beforeEach(() => {
		contentEl = document.createElement("div");
		contentEl.className = "deeppdf-message-content";
		document.body.appendChild(contentEl);
		renderer = new StreamingRenderer(makeHost(contentEl), "");
	});

	describe("invariant 1 — first streamingUpdate sets ARIA", () => {
		it("aria-live=polite, aria-atomic=false, aria-busy=true", () => {
			renderer.streamingUpdate(contentEl, "你好");

			expect(contentEl.getAttribute("aria-live")).toBe("polite");
			expect(contentEl.getAttribute("aria-atomic")).toBe("false");
			expect(contentEl.getAttribute("aria-busy")).toBe("true");
		});

		it("does not set ARIA on a different element by mistake", () => {
			// sanity: 不会在 parent 或 sibling 上挂 ARIA
			const parent = contentEl.parentElement!;
			renderer.streamingUpdate(contentEl, "hello");
			expect(parent.getAttribute("aria-live")).toBeNull();
			expect(parent.getAttribute("aria-busy")).toBeNull();
		});
	});

	describe("invariant 2 — subsequent streamingUpdate does not strip ARIA", () => {
		it("multiple streamingUpdate calls keep aria-live/aria-atomic/aria-busy intact", async () => {
			renderer.streamingUpdate(contentEl, "第一段");
			await new Promise((r) => setTimeout(r, 10));
			renderer.streamingUpdate(contentEl, "第一段文本");
			await new Promise((r) => setTimeout(r, 10));
			renderer.streamingUpdate(contentEl, "第一段文本内容");

			expect(contentEl.getAttribute("aria-live")).toBe("polite");
			expect(contentEl.getAttribute("aria-atomic")).toBe("false");
			expect(contentEl.getAttribute("aria-busy")).toBe("true");
		});
	});

	describe("invariant 3 — fullUpdate marks end of streaming", () => {
		it("clears aria-busy but preserves aria-live / aria-atomic", async () => {
			renderer.streamingUpdate(contentEl, "流式内容");
			await new Promise((r) => setTimeout(r, 10));
			await renderer.fullUpdate(contentEl, "最终内容");

			expect(contentEl.getAttribute("aria-busy")).toBe("false");
			// aria-live 与 aria-atomic 保留：用户重新聚焦/重渲染时屏幕阅读器仍能感知
			expect(contentEl.getAttribute("aria-live")).toBe("polite");
			expect(contentEl.getAttribute("aria-atomic")).toBe("false");
		});

		it("fullUpdate without prior streamingUpdate also sets aria-busy=false (defensive)", async () => {
			// 边界：直接 fullUpdate（不流式），不应留下 aria-busy=true 的污染
			await renderer.fullUpdate(contentEl, "静态内容");
			expect(contentEl.getAttribute("aria-busy")).toBe("false");
		});
	});

	describe("invariant 4 — destroy allows re-initialization", () => {
		it("after destroy, next streamingUpdate re-initializes ARIA (re-streaming case)", async () => {
			renderer.streamingUpdate(contentEl, "第一次流式");
			await new Promise((r) => setTimeout(r, 10));
			await renderer.fullUpdate(contentEl, "第一次结束");
			renderer.destroy();

			// 模拟同一 renderer 被 reuse（实际是 new，但 destroy 应清空内部状态以防误用）
			// 这里用同一对象测试 destroy 后的状态重置
			renderer.streamingUpdate(contentEl, "第二次流式");

			// 第一次流式结束已设置 aria-busy=false，
			// 第二次流式开始应再设置 aria-busy=true（说明内部状态已重置）
			expect(contentEl.getAttribute("aria-busy")).toBe("true");
			expect(contentEl.getAttribute("aria-live")).toBe("polite");
		});
	});
});
