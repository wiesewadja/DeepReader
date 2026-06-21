/**
 * StreamingRenderer 流式结束守卫 — 锁住"延迟 RAF 不覆盖已绑 hover 的内容"
 *
 * 背景：streamingUpdate 经 requestAnimationFrame + MarkdownRenderer.render().then()
 * 异步渲染，回调用 contentEl.innerHTML = tempContainer.innerHTML 整体替换内容。
 * 当"最后一帧内容"与"流式结束信号"几乎同时到达时，finalizeStreamingEnd 已接管渲染并
 * 绑定 hover preview，但该延迟回调仍会用流式版本覆盖 contentEl → 已绑 hover 的 link
 * 元素被替换 → hover preview 偶发丢失（用户感知：AI 引用 wiki，hover 有时不弹窗）。
 *
 * 守卫：render().then() 回调里若 host.data.isStreaming === false，直接 return 不覆盖。
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { StreamingRenderer } from "@/components/message/streaming-renderer";
import type { MessageData } from "@/components/message/types";
import type { App } from "obsidian";

vi.mock("obsidian", () => ({
	MarkdownRenderer: {
		render: vi.fn(async (_app: unknown, _src: string, el: HTMLElement) => {
			el.innerHTML = '<a class="internal-link" href="Book/Ch.md#^b1">流式 link</a>';
		}),
	},
	Component: class {
		unload() {}
	},
}));

function makeHost(contentEl: HTMLElement, getStreaming: () => boolean) {
	const data = {
		id: "m1",
		role: "assistant",
		content: "",
		timestamp: "2026-06-21T00:00:00Z",
		pdfName: "test.pdf",
	} as MessageData;
	Object.defineProperty(data, "isStreaming", { get: getStreaming });
	return {
		get el() {
			return contentEl;
		},
		get app() {
			return {} as App;
		},
		get data() {
			return data;
		},
		get observers() {
			return [] as MutationObserver[];
		},
		escapeHtml: (t: string) => t,
	};
}

// 足够长以越过 streamingUpdate 的 contentGrowth > 50 节流阈值
const LONG_CONTENT =
	"深度阅读插件通过向量索引和检索帮助用户理解书籍内容，流式渲染需要足够长的文本才能越过节流阈值，这里再加长确保 contentGrowth 大于五十。";

// 等待真实 RAF + render().then() 微任务链完成
const tick = () => new Promise((r) => setTimeout(r, 50));

describe("StreamingRenderer — 流式结束守卫（hover preview 覆盖竞态）", () => {
	let contentEl: HTMLElement;

	beforeEach(() => {
		contentEl = document.createElement("div");
		contentEl.className = "deeppdf-message-content";
		// Obsidian 给 HTMLElement 扩展了 hasClass/removeClass/addClass，jsdom 没有，补最小实现
		// （streamingUpdate 的 RAF 回调里会用 contentEl.hasClass 判断 loading 态）
		(contentEl as any).hasClass = (cls: string) => contentEl.classList.contains(cls);
		(contentEl as any).removeClass = (cls: string) => contentEl.classList.remove(cls);
		(contentEl as any).addClass = (cls: string) => contentEl.classList.add(cls);
		document.body.appendChild(contentEl);
	});

	it("流式中（isStreaming=true）：streamingUpdate 正常覆盖 contentEl 为渲染产物", async () => {
		let streaming = true;
		const renderer = new StreamingRenderer(makeHost(contentEl, () => streaming), "");
		contentEl.innerHTML = '<span id="sentinel">原始占位</span>';

		renderer.streamingUpdate(contentEl, LONG_CONTENT);
		await tick();

		expect(contentEl.querySelector("#sentinel")).toBeNull();
		expect(contentEl.querySelector("a.internal-link")).not.toBeNull();
	});

	it("守卫：RAF 排队后 isStreaming 翻 false，延迟回调不覆盖 finalizeStreamingEnd 已绑的内容", async () => {
		let streaming = true;
		const renderer = new StreamingRenderer(makeHost(contentEl, () => streaming), "");

		// 1. 流式中发起渲染（RAF + render().then 排队，尚未执行）
		renderer.streamingUpdate(contentEl, LONG_CONTENT);

		// 2. 延迟回调执行前，流式结束：finalizeStreamingEnd 已把 contentEl 换成最终内容
		//    （含已绑定 hover 的 link，用 data-hover-bound 标记）
		streaming = false;
		contentEl.innerHTML =
			'<a class="internal-link" href="Book/Ch.md#^b1" data-hover-bound>finalized link</a>';
		const finalizedLink = contentEl.querySelector("a")!;

		// 3. 推进，让延迟的 render().then() 回调执行
		await tick();

		// 守卫生效：finalized link 身份不变（未被流式回调替换的全新 <a> 覆盖）
		expect(contentEl.querySelector("a")).toBe(finalizedLink);
		// 且 finalize 时设的标记属性仍在
		expect(finalizedLink.hasAttribute("data-hover-bound")).toBe(true);
		expect(finalizedLink.textContent).toBe("finalized link");
	});
});
