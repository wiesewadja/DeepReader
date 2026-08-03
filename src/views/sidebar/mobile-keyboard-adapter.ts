/**
 * MobileKeyboardAdapter
 *
 * 移动端键盘适配：监听 visualViewport，键盘弹起时收缩聊天容器高度，
 * 使钉底的输入框自然位于键盘上方，避免被遮挡。仅移动端启用，桌面端为空操作。
 */
import { Platform } from "obsidian";

export class MobileKeyboardAdapter {
	private cleanup: (() => void) | null = null;

	/** 桌面端无操作；返回是否已启用 */
	setup(container: HTMLElement | null): boolean {
		if (!Platform.isMobile || !container) return false;
		const vv = window.visualViewport;
		if (!vv) return false;

		// 视口高度差超过此阈值视为键盘弹起（过滤地址栏伸缩等微小变化）
		const KEYBOARD_THRESHOLD = 100;
		let lastApplied = "__init__";

		const update = () => {
			const keyboardHeight = window.innerHeight - vv.height;
			const raised = keyboardHeight > KEYBOARD_THRESHOLD;

			let target = "";
			if (raised) {
				const containerTop =
					container.getBoundingClientRect().top + window.scrollY;
				const viewportTop = vv.offsetTop || 0;
				const usableTop = Math.max(0, containerTop - viewportTop);
				target = `${vv.height - usableTop}px`;
			}

			if (target === lastApplied) return;
			container.style.height = target;
			lastApplied = target;

			// 当键盘弹起时，确保当前聚焦的输入框滚动到视口中
			if (
				raised &&
				document.activeElement &&
				container.contains(document.activeElement)
			) {
				setTimeout(() => {
					const inputSection = container.querySelector(
						".deeppdf-chat-input-section",
					);
					inputSection?.scrollIntoView({
						block: "end",
						behavior: "smooth",
					});
				}, 300);
			}
		};

		vv.addEventListener("resize", update);
		vv.addEventListener("scroll", update);
		update();

		this.cleanup = () => {
			vv.removeEventListener("resize", update);
			vv.removeEventListener("scroll", update);
			container.style.height = "";
		};
		return true;
	}

	destroy(): void {
		this.cleanup?.();
		this.cleanup = null;
	}
}
