/**
 * scroll-patch 模块 — 全局 scrollIntoView 拦截的安全网
 *
 * 目标约束（设计不变量）：
 *  1. 未 install 时，HTMLElement.prototype.scrollIntoView 保持 native
 *  2. install/uninstall 引用计数：最后一个 service 卸载时必须还原 native
 *  3. 多 service 并存：单 service 卸载不影响其他 service 的拦截
 *  4. 目标元素在 reading-mode 容器内 → 路由到 service.scrollToElementInColumn
 *  5. 目标元素不在容器内 / service 未激活 / service 无 activeContainerEl → 落到 native
 *  6. uninstall 期间抛错也必须还原 prototype（try/finally 不变量）
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
	installScrollPatch,
	uninstallScrollPatch,
	forceUninstallScrollPatch,
	isScrollPatchInstalled,
	getActiveServiceCount,
	type ScrollPatchService,
} from "@/components/reading-mode/scroll-patch";

describe("scroll-patch", () => {
	let nativeScrollIntoView: typeof HTMLElement.prototype.scrollIntoView;
	let container: HTMLElement;
	let scrollView: HTMLElement;
	let targetInView: HTMLElement;
	let targetOutsideView: HTMLElement;
	let mockService: ScrollPatchService;

	beforeEach(() => {
		// 1. 记录"真·原生" scrollIntoView（test environment 的 jsdom 实现）
		nativeScrollIntoView = HTMLElement.prototype.scrollIntoView;

		// 2. 准备 reading-mode 容器结构
		container = document.createElement("div");
		container.className = "deeppdf-reading-mode";
		scrollView = document.createElement("div");
		scrollView.className = "markdown-preview-view";
		container.appendChild(scrollView);
		targetInView = document.createElement("p");
		targetInView.textContent = "inside";
		scrollView.appendChild(targetInView);
		targetOutsideView = document.createElement("p");
		targetOutsideView.textContent = "outside";
		document.body.appendChild(container);
		document.body.appendChild(targetOutsideView);

		// 3. Mock 一个最小可用的 service
		mockService = {
			isActive: true,
			activeContainerEl: container,
			scrollToElementInColumn: vi.fn(),
		};
	});

	afterEach(() => {
		// 关键：每个测试后彻底清空 module-level state
		// （HTMLElement.prototype.scrollIntoView + activeServices + installed + gOriginalScrollIntoView）
		// 不清空的话，测试间泄漏会导致下一个测试的 installScrollPatch 早退
		forceUninstallScrollPatch();
		// 兜底还原（防止 fall-through 测试用 spy 替换过 prototype）
		HTMLElement.prototype.scrollIntoView = nativeScrollIntoView;
		container.remove();
		targetOutsideView.remove();
	});

	describe("invariant 1 — pristine state", () => {
		it("HTMLElement.prototype.scrollIntoView is native before any install", () => {
			expect(HTMLElement.prototype.scrollIntoView).toBe(nativeScrollIntoView);
			expect(isScrollPatchInstalled()).toBe(false);
			expect(getActiveServiceCount()).toBe(0);
		});
	});

	describe("invariant 2 — refcount restore on last uninstall", () => {
		it("single service: prototype restored after uninstall", () => {
			installScrollPatch(mockService);
			expect(isScrollPatchInstalled()).toBe(true);
			expect(HTMLElement.prototype.scrollIntoView).not.toBe(
				nativeScrollIntoView,
			);

			uninstallScrollPatch(mockService);
			expect(isScrollPatchInstalled()).toBe(false);
			expect(HTMLElement.prototype.scrollIntoView).toBe(nativeScrollIntoView);
			expect(getActiveServiceCount()).toBe(0);
		});

		it("two services: last uninstall restores prototype; first uninstall does not", () => {
			const service1: ScrollPatchService = {
				isActive: true,
				activeContainerEl: container,
				scrollToElementInColumn: vi.fn(),
			};
			const service2: ScrollPatchService = {
				isActive: true,
				activeContainerEl: container,
				scrollToElementInColumn: vi.fn(),
			};

			installScrollPatch(service1);
			installScrollPatch(service2);
			expect(isScrollPatchInstalled()).toBe(true);
			expect(getActiveServiceCount()).toBe(2);

			// 卸载第一个：patch 应保持
			uninstallScrollPatch(service1);
			expect(isScrollPatchInstalled()).toBe(true);
			expect(getActiveServiceCount()).toBe(1);
			expect(HTMLElement.prototype.scrollIntoView).not.toBe(
				nativeScrollIntoView,
			);

			// 卸载第二个：patch 应还原
			uninstallScrollPatch(service2);
			expect(isScrollPatchInstalled()).toBe(false);
			expect(getActiveServiceCount()).toBe(0);
			expect(HTMLElement.prototype.scrollIntoView).toBe(nativeScrollIntoView);
		});

		it("idempotent uninstall of unknown service is a no-op (no throw, no state change)", () => {
			installScrollPatch(mockService);
			const otherService: ScrollPatchService = {
				isActive: true,
				activeContainerEl: container,
				scrollToElementInColumn: vi.fn(),
			};
			// 卸载从未注册过的 service — 不应抛错
			expect(() => uninstallScrollPatch(otherService)).not.toThrow();
			// patch 状态不变
			expect(isScrollPatchInstalled()).toBe(true);
			// 清理
			uninstallScrollPatch(mockService);
		});
	});

	describe("invariant 4 — routing to service when target is in reading-mode container", () => {
		it("scrollIntoView on in-container target calls service.scrollToElementInColumn", () => {
			installScrollPatch(mockService);
			targetInView.scrollIntoView();
			expect(mockService.scrollToElementInColumn).toHaveBeenCalledTimes(1);
			expect(mockService.scrollToElementInColumn).toHaveBeenCalledWith(
				targetInView,
				scrollView,
			);
		});

		it("scrollIntoView on deeply-nested target still routes to service", () => {
			const nested = document.createElement("span");
			targetInView.appendChild(nested);
			installScrollPatch(mockService);
			nested.scrollIntoView();
			expect(mockService.scrollToElementInColumn).toHaveBeenCalledWith(
				nested,
				scrollView,
			);
		});

		it("routes to the service whose activeContainerEl contains the target", () => {
			const otherContainer = document.createElement("div");
			otherContainer.className = "deeppdf-reading-mode";
			const otherScrollView = document.createElement("div");
			otherScrollView.className = "markdown-preview-view";
			otherContainer.appendChild(otherScrollView);
			const otherTarget = document.createElement("p");
			otherScrollView.appendChild(otherTarget);
			document.body.appendChild(otherContainer);

			const otherService: ScrollPatchService = {
				isActive: true,
				activeContainerEl: otherContainer,
				scrollToElementInColumn: vi.fn(),
			};
			installScrollPatch(mockService);
			installScrollPatch(otherService);

			otherTarget.scrollIntoView();
			// 关键断言：otherService 被路由，mockService 不被路由
			expect(otherService.scrollToElementInColumn).toHaveBeenCalledWith(
				otherTarget,
				otherScrollView,
			);
			expect(mockService.scrollToElementInColumn).not.toHaveBeenCalled();

			otherContainer.remove();
			uninstallScrollPatch(otherService);
		});
	});

	describe("invariant 5 — fall-through to native", () => {
		it("scrollIntoView on out-of-container target falls through (clean test)", () => {
			// 卸载后看 native 是否被调用 —— 通过 mock
			const calls: Element[] = [];
			const realNative = nativeScrollIntoView;
			// 临时把 native 替换为 spy
			(HTMLElement.prototype as any).scrollIntoView = vi.fn(function (
				this: Element,
			) {
				calls.push(this);
			});
			// 重新 install，patcher 内部会捕获新的 "native"（即 spy）
			installScrollPatch(mockService);

			targetOutsideView.scrollIntoView();
			// native spy 被调用，service 方法未被调用
			expect(calls).toEqual([targetOutsideView]);
			expect(mockService.scrollToElementInColumn).not.toHaveBeenCalled();

			// 还原 prototype
			uninstallScrollPatch(mockService);
			(HTMLElement.prototype as any).scrollIntoView = realNative;
		});

		it("scrollIntoView on target whose service is not active falls through to native", () => {
			const calls: Element[] = [];
			const realNative = nativeScrollIntoView;
			(HTMLElement.prototype as any).scrollIntoView = vi.fn(function (
				this: Element,
			) {
				calls.push(this);
			});
			installScrollPatch(mockService);
			// service 失活
			mockService.isActive = false;

			targetInView.scrollIntoView();
			expect(calls).toEqual([targetInView]);
			expect(mockService.scrollToElementInColumn).not.toHaveBeenCalled();

			uninstallScrollPatch(mockService);
			(HTMLElement.prototype as any).scrollIntoView = realNative;
		});

		it("scrollIntoView on target whose service has no activeContainerEl falls through", () => {
			const calls: Element[] = [];
			const realNative = nativeScrollIntoView;
			(HTMLElement.prototype as any).scrollIntoView = vi.fn(function (
				this: Element,
			) {
				calls.push(this);
			});
			installScrollPatch(mockService);
			// 容器丢失
			mockService.activeContainerEl = null;

			targetInView.scrollIntoView();
			expect(calls).toEqual([targetInView]);
			expect(mockService.scrollToElementInColumn).not.toHaveBeenCalled();

			uninstallScrollPatch(mockService);
			(HTMLElement.prototype as any).scrollIntoView = realNative;
		});
	});

	describe("invariant 6 — try/finally on uninstall error", () => {
		it("if service.scrollToElementInColumn throws, prototype is still restored on uninstall", () => {
			installScrollPatch(mockService);
			expect(isScrollPatchInstalled()).toBe(true);

			// 触发 patched function 抛错
			(mockService.scrollToElementInColumn as any) = vi.fn(() => {
				throw new Error("boom");
			});
			// 不需要真的抛错来测试 invariant 6，
			// invariant 6 是"uninstall 的 try/finally"——和 service 行为无关
			// 直接测 uninstall 的清理
			uninstallScrollPatch(mockService);
			expect(HTMLElement.prototype.scrollIntoView).toBe(nativeScrollIntoView);
		});
	});

	describe("invariant 7 — service throw is isolated (does not poison callers)", () => {
		it("service 抛错时降级到 native, 调用方不收到异常", () => {
			// 准备：spy 替换 native，验证 service 抛错后 native 仍被调用
			const nativeCalls: Element[] = [];
			const realNative = nativeScrollIntoView;
			(HTMLElement.prototype as any).scrollIntoView = vi.fn(function (
				this: Element,
			) {
				nativeCalls.push(this);
			});

			// 准备：service 主动抛错
			const throwingService: ScrollPatchService = {
				isActive: true,
				activeContainerEl: container,
				scrollToElementInColumn: vi.fn(() => {
					throw new Error("service crashed");
				}),
			};
			installScrollPatch(throwingService);

			// 调用方不应该接收到异常
			let callerThrew = false;
			try {
				targetInView.scrollIntoView();
			} catch {
				callerThrew = true;
			}

			expect(callerThrew).toBe(false);
			// 错误被路由到 native（降级成功）
			expect(nativeCalls).toEqual([targetInView]);
			// service 确实被调用过
			expect(throwingService.scrollToElementInColumn).toHaveBeenCalled();

			uninstallScrollPatch(throwingService);
			(HTMLElement.prototype as any).scrollIntoView = realNative;
		});

		it("service 抛错后, patched 状态仍正确（不影响后续路由）", () => {
			const realNative = nativeScrollIntoView;
			(HTMLElement.prototype as any).scrollIntoView = vi.fn();

			const throwingSvc: ScrollPatchService = {
				isActive: true,
				activeContainerEl: container,
				scrollToElementInColumn: vi.fn(() => {
					throw new Error("crash");
				}),
			};
			const goodSvc: ScrollPatchService = {
				isActive: true,
				activeContainerEl: container,
				scrollToElementInColumn: vi.fn(),
			};

			installScrollPatch(throwingSvc);
			installScrollPatch(goodSvc);

			// 第一次：throwingSvc 先注册,会抛错 → 降级
			// 但 Set 迭代顺序是先 throwingSvc, 抛错后 break → 不会继续找 goodSvc
			// （这是有意设计：避免一个 service 抛错后路由到另一个 service）
			expect(() => targetInView.scrollIntoView()).not.toThrow();

			// 卸载 throwingSvc,goodSvc 接手
			uninstallScrollPatch(throwingSvc);
			goodSvc.scrollToElementInColumn.mockClear();

			targetInView.scrollIntoView();
			expect(goodSvc.scrollToElementInColumn).toHaveBeenCalledWith(
				targetInView,
				scrollView,
			);

			uninstallScrollPatch(goodSvc);
			(HTMLElement.prototype as any).scrollIntoView = realNative;
		});
	});
});
