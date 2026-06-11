/**
 * 测试环境设置
 * 模拟 Obsidian API 的 DOM 扩展方法
 */

// Guard: only set up DOM mocks when HTMLElement is available (jsdom env)
if (typeof HTMLElement !== "undefined") {
	// 模拟 Obsidian 的 addClass 方法
	HTMLElement.prototype.addClass = function (
		this: HTMLElement,
		...classes: string[]
	) {
		// 处理包含空格的类名字符串
		const allClasses = classes.flatMap((cls) =>
			cls.split(" ").filter((c) => c),
		);
		this.classList.add(...allClasses);
		return this;
	};

	// 模拟 Obsidian 的 removeClass 方法
	HTMLElement.prototype.removeClass = function (
		this: HTMLElement,
		...classes: string[]
	) {
		// 处理包含空格的类名字符串
		const allClasses = classes.flatMap((cls) =>
			cls.split(" ").filter((c) => c),
		);
		this.classList.remove(...allClasses);
		return this;
	};

	// 模拟 Obsidian 的 toggleClass 方法
	HTMLElement.prototype.toggleClass = function (
		this: HTMLElement,
		className: string,
		value?: boolean,
	) {
		if (value !== undefined) {
			if (value) {
				this.classList.add(className);
			} else {
				this.classList.remove(className);
			}
		} else {
			this.classList.toggle(className);
		}
		return this;
	};

	// 模拟 Obsidian 的 createEl 方法
	HTMLElement.prototype.createEl = function (
		this: HTMLElement,
		tagName: string,
		options?: {
			cls?: string | string[];
			text?: string;
			attr?: Record<string, string>;
		},
	) {
		const el = document.createElement(tagName);

		if (options?.cls) {
			if (Array.isArray(options.cls)) {
				// 处理数组类型，并分割任何包含空格的字符串
				const allClasses = options.cls.flatMap((cls: string) =>
					cls.split(" ").filter((c) => c),
				);
				el.classList.add(...allClasses);
			} else {
				// 处理字符串类型，分割空格
				const allClasses = options.cls.split(" ").filter((c) => c);
				el.classList.add(...allClasses);
			}
		}

		if (options?.text) {
			el.textContent = options.text;
		}

		if (options?.attr) {
			Object.entries(options.attr).forEach(([key, value]) => {
				el.setAttribute(key, value);
			});
		}

		this.appendChild(el);
		return el;
	};

	// 模拟 Obsidian 的 empty 方法
	HTMLElement.prototype.empty = function (this: HTMLElement) {
		while (this.firstChild) {
			this.removeChild(this.firstChild);
		}
		return this;
	};

	// Polyfill: jsdom 不提供 Element#scrollIntoView，但生产环境（Electron）有
	// 用 no-op 默认实现兜底；测试可通过 spy 覆盖
	if (!HTMLElement.prototype.scrollIntoView) {
		HTMLElement.prototype.scrollIntoView = function (
			this: HTMLElement,
			_options?: ScrollIntoViewOptions | boolean,
		): void {
			// 默认 no-op；测试如需断言可通过 spyOn(HTMLElement.prototype, 'scrollIntoView') 替换
		};
	}

	// Polyfill: jsdom 不提供 Obsidian 的 HTMLElement#createDiv / createSpan 扩展
	HTMLElement.prototype.createDiv = function (
		this: HTMLElement,
		options?: {
			cls?: string | string[];
			text?: string;
			attr?: Record<string, string>;
		},
	): HTMLDivElement {
		const el = document.createElement("div");
		if (options?.cls) {
			const allClasses = (
				Array.isArray(options.cls) ? options.cls : options.cls.split(" ")
			).filter((c) => c);
			el.classList.add(...allClasses);
		}
		if (options?.text) el.textContent = options.text;
		if (options?.attr) {
			Object.entries(options.attr).forEach(([k, v]) => el.setAttribute(k, v));
		}
		this.appendChild(el);
		return el;
	};

	HTMLElement.prototype.createSpan = function (
		this: HTMLElement,
		options?: {
			cls?: string | string[];
			text?: string;
			attr?: Record<string, string>;
		},
	): HTMLSpanElement {
		const el = document.createElement("span");
		if (options?.cls) {
			const allClasses = (
				Array.isArray(options.cls) ? options.cls : options.cls.split(" ")
			).filter((c) => c);
			el.classList.add(...allClasses);
		}
		if (options?.text) el.textContent = options.text;
		if (options?.attr) {
			Object.entries(options.attr).forEach(([k, v]) => el.setAttribute(k, v));
		}
		this.appendChild(el);
		return el;
	};

	// Stub CJS `require()` for asset paths (生产环境 esbuild dataurl loader 处理，jsdom 无)
	// 只拦截 .jpg/.png/.gif/.svg/.webp，其他 require 仍走原始行为
	{
		const origRequire = (globalThis as any).require;
		const _require = ((id: string) => {
			if (/\.(jpg|jpeg|png|gif|svg|webp)$/.test(id)) {
				return "data:image/png;base64,";
			}
			return origRequire ? origRequire(id) : undefined;
		}) as any;
		(globalThis as any).require = _require;
	}

	// Mock Obsidian module globally
	(global as any).obsidian = {
		App: class MockApp {},
		MarkdownRenderer: {
			renderMarkdown: async () => {},
			renderEl: async () => {},
		},
		Component: class MockComponent {
			onLoad() {}
			onUnload() {}
			load() {}
			unload() {}
			children: any[] = [];
		},
		ItemView: class MockItemView {},
		WorkspaceLeaf: class MockWorkspaceLeaf {},
		Notice: class MockNotice {
			constructor(message: string, duration?: number) {}
		},
		HoverParent: class MockHoverParent {},
		HoverPopover: class MockHoverPopover {},
		markdownToHTML: (text: string) => text,
	};
} // end if (HTMLElement)
