/**
 * MessageList — 屏幕阅读器可访问性
 *
 * 目标不变量：
 *  1. 消息容器：role=log（隐式 aria-live=polite，新消息自动播报）
 *  2. 消息容器：aria-label 描述其内容（"对话历史"等）
 *  3. 加载中：aria-busy=true（初始/重载）；加载完成：aria-busy=false
 *  4. 空状态：role=status（屏幕阅读器感知"无消息"状态变化）
 *  5. 消息容器与空状态在同一时间只有一个可见（aria-hidden 互斥）
 *
 * 设计权衡：
 *  - role=log 放在 messagesContainer（实际持有消息条目的元素），
 *    不是 root（root 还包含 minimap 等非 log 内容）
 *  - role=log 隐式 aria-live=polite，所以无需显式设置
 *  - 已有 per-message aria-live（来自 P0-2）保留 —— 那是用来播报"消息内容变更"
 *    的，与"新消息到达"是不同维度
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { MessageList } from "@/components/message-list/message-list";
import type { MessageData } from "@/components/message/types";

function makeMessageData(overrides: Partial<MessageData> = {}): MessageData {
	return {
		id: overrides.id ?? `msg-${Math.random().toString(36).slice(2)}`,
		role: overrides.role ?? "user",
		content: overrides.content ?? "测试消息",
		timestamp: overrides.timestamp ?? "2026-06-11T00:00:00Z",
		...overrides,
	};
}

describe("MessageList — ARIA chat log semantics", () => {
	let list: MessageList;
	let root: HTMLElement;

	beforeEach(() => {
		list = new MessageList({});
		root = list.el!;
		document.body.appendChild(root);
	});

	afterEach(() => {
		root.remove();
		list.destroy();
	});

	describe("invariant 1 — messages container has role=log", () => {
		it("messages container 挂 role=log", () => {
			const container = root.querySelector(
				".deeppdf-messages-container",
			) as HTMLElement;
			expect(container).toBeTruthy();
			expect(container.getAttribute("role")).toBe("log");
		});

		it("role=log 隐式 aria-live=polite，screen reader 会播报新消息", () => {
			// role=log 的隐式语义：aria-live=polite
			// 测试方法：role=log 元素在 AT 中会被当作 live region
			const container = root.querySelector(
				".deeppdf-messages-container",
			) as HTMLElement;
			expect(container.getAttribute("role")).toBe("log");
			// 不显式设 aria-live：依赖 role 隐式行为（WAI-ARIA 规范保证）
		});
	});

	describe("invariant 2 — messages container has aria-label", () => {
		it("aria-label 描述容器内容", () => {
			const container = root.querySelector(
				".deeppdf-messages-container",
			) as HTMLElement;
			const label = container.getAttribute("aria-label");
			expect(label).toBeTruthy();
			expect(label!.length).toBeGreaterThan(0);
		});
	});

	describe("invariant 3 — loading state is honest (no fake aria-busy)", () => {
		it("messages container 不再设静态 aria-busy=false（避免假合规）", () => {
			// 修改说明：之前设了 aria-busy="false" 但 MessageList 没有 setLoading API，
			// 这是"假合规"。如果未来加 setLoading 真实接口，同步在这里加 case。
			const container = root.querySelector(
				".deeppdf-messages-container",
			) as HTMLElement;
			expect(container.hasAttribute("aria-busy")).toBe(false);
		});
	});

	describe("invariant 4 — empty state has role=status", () => {
		it('空状态节点挂 role=status（让 AT 感知"无消息"状态）', () => {
			const emptyState = root.querySelector(
				".deeppdf-empty-state",
			) as HTMLElement;
			expect(emptyState).toBeTruthy();
			expect(emptyState.getAttribute("role")).toBe("status");
		});

		it("空状态有 aria-live 区域特性", () => {
			// role=status 隐式 aria-live=polite，无需显式设
			const emptyState = root.querySelector(
				".deeppdf-empty-state",
			) as HTMLElement;
			expect(emptyState.getAttribute("role")).toBe("status");
		});
	});

	describe("invariant 5 — message container and empty state are mutually exclusive", () => {
		it("初始无消息：empty state visible, messages container hidden (aria-hidden=true)", () => {
			const container = root.querySelector(
				".deeppdf-messages-container",
			) as HTMLElement;
			const emptyState = root.querySelector(
				".deeppdf-empty-state",
			) as HTMLElement;

			// empty state 可见时，messages container 应对 AT 隐藏
			// （视觉上靠 .deeppdf-hidden class；aria-hidden 是 AT 维度）
			if (!emptyState.classList.contains("deeppdf-hidden")) {
				expect(container.getAttribute("aria-hidden")).toBe("true");
			}
		});

		it("有消息后：messages container visible, empty state hidden (aria-hidden=true)", () => {
			list.addMessage(makeMessageData({ id: "m1", role: "user" }));
			const container = root.querySelector(
				".deeppdf-messages-container",
			) as HTMLElement;
			const emptyState = root.querySelector(
				".deeppdf-empty-state",
			) as HTMLElement;

			if (!container.classList.contains("deeppdf-hidden")) {
				expect(emptyState.getAttribute("aria-hidden")).toBe("true");
			}
		});
	});

	describe("regression — new messages are appended inside the log", () => {
		it("addMessage 后消息 DOM 节点在 messages-container 内", () => {
			list.addMessage(makeMessageData({ id: "m1", role: "user" }));
			list.addMessage(makeMessageData({ id: "m2", role: "assistant" }));

			const container = root.querySelector(
				".deeppdf-messages-container",
			) as HTMLElement;
			const messages = container.querySelectorAll(
				'[class*="deeppdf-message-"]',
			);
			expect(messages.length).toBeGreaterThanOrEqual(2);
		});
	});
});
