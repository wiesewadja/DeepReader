/**
 * scroll-patch — 阅读模式 multi-column 布局下 scrollIntoView 的安全拦截器
 *
 * 设计动机：
 *   CSS multi-column 布局下，浏览器默认的 vertical `scrollIntoView` 无法横向翻页。
 *   Obsidian 内部、链接点击、search 跳转等场景均会调用 `element.scrollIntoView()`。
 *   若不拦截，目标元素所在的"列"无法被正确定位。
 *
 * 设计约束（与单元测试不变量一一对应）：
 *   1. 引用计数：未 install 时 prototype 保持 native；最后一个 service 卸载时还原
 *   2. 多 service 隔离：单 service 卸载不影响其他 service 的拦截
 *   3. 精确路由：仅当 target 在某 active service 的 activeContainerEl 子树内时路由
 *   4. 安全降级：service 失活 / 容器丢失 / target 在容器外 → 落到 native
 *   5. 异常隔离：uninstall 抛错也必须还原 prototype（try/finally 不变量）
 *
 * 已知遗留风险（不在本次修复范围）：
 *   - 仍会修改 HTMLElement.prototype（无法在不动调用方的前提下消除）
 *   - 一旦 activate，便会拦截所有进程内 scrollIntoView 调用（受 .closest 过滤限制范围）
 *   - 性能开销：每次 scrollIntoView 调用都会执行 .closest 查找
 *
 * 后续可考虑的方向（独立 task）：
 *   - 包装 MarkdownView 层的链接点击处理（替代本 patch 的部分职责）
 *   - 用 IntersectionObserver + scrollTo 替代 scrollIntoView 拦截
 */

import { serviceLog } from "../../utils/logger.js";

/** 参与拦截的最小 service 契约 */
export interface ScrollPatchService {
	/** 是否处于激活态（多列布局已生效） */
	isActive: boolean;
	/** 阅读模式所在 leaf 的 containerEl（用于判断 target 是否归属本 service） */
	activeContainerEl: HTMLElement | null;
	/** 路由后的实际滚动逻辑（由 caller 实现，避免本模块与 orchestrator 强耦合） */
	scrollToElementInColumn(element: HTMLElement, scrollView: HTMLElement): void;
}

// ── Module-level state ────────────────────────────────────────────────────────
// 注意：module 状态跨 service 实例共享，但通过引用计数保证正确的安装/卸载语义。

/** 已注册 service 集合（去重 + 强引用） */
const activeServices = new Set<ScrollPatchService>();

/** 真正的原生 scrollIntoView（首次 install 时一次性保存） */
let gOriginalScrollIntoView:
	| typeof HTMLElement.prototype.scrollIntoView
	| null = null;

/** patch 当前是否已安装（不等于 activeServices.size > 0） */
let installed = false;

/** 已安装次数统计（用于日志与单元测试可见性） */
let installCount = 0;

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * 注册一个 service 加入 scrollIntoView 拦截。
 * 第一次调用时真正修改 prototype，后续调用仅增加引用计数。
 */
export function installScrollPatch(service: ScrollPatchService): void {
	activeServices.add(service);
	installCount++;

	if (installed) {
		return;
	}

	// 第一次 install：保存真·native 并覆盖
	gOriginalScrollIntoView = HTMLElement.prototype.scrollIntoView;

	HTMLElement.prototype.scrollIntoView = function (
		this: HTMLElement,
		options?: ScrollIntoViewOptions | boolean,
	): void {
		const target = this;

		// 路由：target 在某个 active service 的容器内时调用该 service 的实现
		// closest 与 svc 无关，提至循环外避免 O(n*depth) 重算
		const scrollView = target.closest?.(
			".deeppdf-reading-mode .markdown-preview-view",
		) as HTMLElement | null;

		for (const svc of activeServices) {
			if (!scrollView || !svc.isActive || !svc.activeContainerEl) {
				continue;
			}
			if (svc.activeContainerEl.contains(scrollView)) {
				// 关键：service 抛错不能污染调用方（CM6/Obsidian/第三方插件的 scrollIntoView）。
				// 降级到 native — 与"未命中 service"走同一路径
				try {
					svc.scrollToElementInColumn(target, scrollView);
					return;
				} catch (err) {
					serviceLog(
						"[ReadingMode] scrollToElementInColumn threw, falling back to native:",
						err,
					);
					break;
				}
			}
		}

		// 降级：未命中任何 service / service 抛错，调真·native
		return gOriginalScrollIntoView!.call(this, options);
	};

	installed = true;
	serviceLog(
		"[ReadingMode] scrollIntoView patched for multi-column fix (installCount=" +
			installCount +
			")",
	);
}

/**
 * 注销一个 service。
 * 引用计数归零时还原 prototype；抛错时 try/finally 兜底。
 */
export function uninstallScrollPatch(service: ScrollPatchService): void {
	// Set.delete 是幂等的，即使 service 未注册也安全
	activeServices.delete(service);

	if (activeServices.size > 0) {
		return;
	}

	// 最后一个 service 注销：还原 prototype
	if (!installed || !gOriginalScrollIntoView) {
		return;
	}

	try {
		HTMLElement.prototype.scrollIntoView = gOriginalScrollIntoView;
	} finally {
		// 无论是否抛错，都要清空 module 状态，避免下次 install 拿到旧的"原生"
		gOriginalScrollIntoView = null;
		installed = false;
		serviceLog(
			"[ReadingMode] scrollIntoView unpatched (after " +
				installCount +
				" installs); restored native implementation",
		);
	}
}

/** 当前是否已安装（测试用 + 调试用） */
export function isScrollPatchInstalled(): boolean {
	return installed;
}

/** 当前已注册 service 数量（测试用） */
export function getActiveServiceCount(): number {
	return activeServices.size;
}

/**
 * 紧急还原：清空所有 service 状态并强制还原 prototype。
 * 用于 plugin unload / 测试清理的兜底入口。
 */
export function forceUninstallScrollPatch(): void {
	activeServices.clear();
	if (installed && gOriginalScrollIntoView) {
		try {
			HTMLElement.prototype.scrollIntoView = gOriginalScrollIntoView;
		} finally {
			gOriginalScrollIntoView = null;
			installed = false;
		}
	}
	serviceLog("[ReadingMode] scrollIntoView force-uninstalled");
}
