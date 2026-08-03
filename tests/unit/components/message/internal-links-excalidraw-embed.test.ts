/**
 * Excalidraw embed 重试渲染 — 锁住方案 2 的核心修复行为
 *
 * 背景：.excalidraw.md 文件刚生成时，Excalidraw 插件原生 embed 因 metadataCache
 * 未索引而渲染出空的 {"type":"excalidraw/clipboard"...} 占位。DeepReader 改为
 * 自己用 ExcalidrawAutomate 渲染 SVG，并在 scene 为空/解析失败时重试覆盖索引窗口。
 *
 * 这里锁住四条不变量：
 *  1. 原生插件拿不到 scene（getSceneFromFile 抛错）→ fallback 解压 .excalidraw.md 成功渲染 SVG
 *  2. 首次拿到空 scene（elements:[]）→ 重试后拿到正常 scene 渲染
 *  3. embed 已被原生渲染出 svg.excalidraw-svg → DeepReader 不抢戏
 *  4. data-dr-rendered 已标记 → 跳过
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { App } from 'obsidian';
import { setupInternalLinks } from '@/components/message/internal-links';
import { buildExcalidrawMd } from '@/agent/tools/excalidraw/excalidraw-md';

/** 一个最小可渲染的 scene */
function makeScene(elements: any[] = [{ type: 'rectangle', id: 'r1', x: 0, y: 0, width: 100, height: 50 }]) {
	return {
		type: 'excalidraw',
		version: 2,
		source: 'https://excalidraw.com',
		elements,
		appState: { viewBackgroundColor: '#ffffff' },
		files: {},
	};
}

/** 把 scene 包成 .excalidraw.md 文件内容（真实生成器，端到端） */
function sceneToMd(scene: any): string {
	return buildExcalidrawMd(scene);
}

/** 构造 Obsidian 渲染出的 excalidraw embed 占位 DOM */
function buildEmbed(src: string): HTMLElement {
	const embed = document.createElement('div');
	embed.className = 'internal-embed';
	embed.setAttribute('src', src);
	return embed;
}

/** 排空 microtask 队列（fake timer 下推进 tryRenderEmbed 的 await 链） */
function flushMicrotasks(): Promise<void> {
	let p: Promise<void> = Promise.resolve();
	for (let i = 0; i < 8; i++) {
		p = p.then(() => undefined);
	}
	return p;
}

/** 装一个最小 ExcalidrawAutomate mock 到 window */
function installExcalidrawAutomate(opts: { getSceneFromFile?: any; createSVG?: any } = {}) {
	const createSVG =
		opts.createSVG ??
		(vi.fn(async () => {
			const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
			return svg;
		}));
	const ea = {
		reset: vi.fn(),
		getSceneFromFile: opts.getSceneFromFile ?? vi.fn(async () => null),
		createSVG,
		elementsDict: {},
		canvas: {} as any,
	};
	(window as any).ExcalidrawAutomate = ea;
	return { ea, createSVG };
}

describe('excalidraw embed retry render', () => {
	let container: HTMLElement;
	let app: App;

	beforeEach(() => {
		container = document.createElement('div');
		document.body.appendChild(container);
		app = new App();
		// metadataCache 默认返回 null → 强制走 getAbstractFileByPath 路径 fallback
	});

	afterEach(() => {
		container.remove();
		delete (window as any).ExcalidrawAutomate;
		vi.useRealTimers();
	});

	it('1. 原生拿不到 scene（getSceneFromFile 抛错）→ fallback 解压渲染 SVG', async () => {
		const file = { path: 'Excalidraw/diagram.excalidraw.md', extension: 'md' };
		vi.mocked(app.vault.getAbstractFileByPath).mockReturnValue(file as any);
		vi.mocked(app.vault.read).mockResolvedValue(sceneToMd(makeScene()));

		// 模拟插件未索引新文件：getSceneFromFile 抛错
		installExcalidrawAutomate({
			getSceneFromFile: vi.fn(async () => {
				throw new Error('not indexed yet');
			}),
		});

		const embed = buildEmbed('Excalidraw/diagram.excalidraw.md');
		container.appendChild(embed);

		vi.useFakeTimers();
		setupInternalLinks(container, app, false, []);
		await flushMicrotasks();

		// fallback 解压成功 → SVG 注入 + 去重标记
		expect(embed.querySelector('svg.excalidraw-svg')).not.toBeNull();
		expect(embed.getAttribute('data-dr-rendered')).toBe('svg');
	});

	it('2. 首次空 scene（elements:[]）→ 重试后拿到正常 scene 渲染', async () => {
		const file = { path: 'Excalidraw/diagram.excalidraw.md', extension: 'md' };
		vi.mocked(app.vault.getAbstractFileByPath).mockReturnValue(file as any);
		// 第一次空 scene（占位），第二次正常
		vi.mocked(app.vault.read)
			.mockResolvedValueOnce(sceneToMd(makeScene([])))
			.mockResolvedValueOnce(sceneToMd(makeScene()));

		// getSceneFromFile 始终抛错 → 强制走 vault.read fallback（控制重试节奏）
		installExcalidrawAutomate({
			getSceneFromFile: vi.fn(async () => {
				throw new Error('not indexed yet');
			}),
		});

		const embed = buildEmbed('Excalidraw/diagram.excalidraw.md');
		container.appendChild(embed);

		vi.useFakeTimers();
		setupInternalLinks(container, app, false, []);
		await flushMicrotasks();

		// attempt 0 拿到空 scene → 尚未渲染
		expect(embed.querySelector('svg.excalidraw-svg')).toBeNull();
		expect(embed.getAttribute('data-dr-inflight')).toBe('1'); // 锁仍持有，等待重试

		// 推进重试延时（300ms）→ attempt 1 拿到正常 scene
		await vi.advanceTimersByTimeAsync(300);
		await flushMicrotasks();

		expect(embed.querySelector('svg.excalidraw-svg')).not.toBeNull();
		expect(embed.getAttribute('data-dr-rendered')).toBe('svg');
		expect(embed.getAttribute('data-dr-inflight')).toBeNull(); // 成功后释放锁
	});

	it('3. embed 已被原生渲染出 svg.excalidraw-svg → 不抢戏', async () => {
		const file = { path: 'Excalidraw/diagram.excalidraw.md', extension: 'md' };
		vi.mocked(app.vault.getAbstractFileByPath).mockReturnValue(file as any);
		vi.mocked(app.vault.read).mockResolvedValue(sceneToMd(makeScene()));

		const { createSVG } = installExcalidrawAutomate();

		const embed = buildEmbed('Excalidraw/diagram.excalidraw.md');
		// 模拟原生插件已经渲染好
		const nativeSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		nativeSvg.classList.add('excalidraw-svg');
		embed.appendChild(nativeSvg);
		container.appendChild(embed);

		vi.useFakeTimers();
		setupInternalLinks(container, app, false, []);
		await flushMicrotasks();

		// DeepReader 不应再调用 createSVG、不应覆盖原生 svg
		expect(createSVG).not.toHaveBeenCalled();
		expect(embed.querySelector('svg.excalidraw-svg')).toBe(nativeSvg);
	});

	it('4. data-dr-rendered 已标记 → 跳过', async () => {
		const file = { path: 'Excalidraw/diagram.excalidraw.md', extension: 'md' };
		vi.mocked(app.vault.getAbstractFileByPath).mockReturnValue(file as any);
		vi.mocked(app.vault.read).mockResolvedValue(sceneToMd(makeScene()));

		const { createSVG } = installExcalidrawAutomate();

		const embed = buildEmbed('Excalidraw/diagram.excalidraw.md');
		embed.setAttribute('data-dr-rendered', 'svg'); // 已渲染过
		container.appendChild(embed);

		vi.useFakeTimers();
		setupInternalLinks(container, app, false, []);
		await flushMicrotasks();

		expect(createSVG).not.toHaveBeenCalled();
		expect(embed.getAttribute('data-dr-inflight')).toBeNull(); // 没有获取锁
	});
});
