/**
 * 奚童像素表情组件
 * 10×10 像素 SVG 表情脸，6 态切换
 */

import { Component } from '../component.js';

export type MascotExpression = 'idle' | 'thinking' | 'happy' | 'curious' | 'reading' | 'sleeping';

// ── 色板：数字 → CSS 颜色 ──
const PALETTE: Record<number, string> = {
	0: 'transparent',
	1: '#1a1210',   // 墨黑 outline
	2: '#e8c89e',   // 暖肤 skin
	3: '#c9a87a',   // 深肤 skinDark
	4: '#1a1210',   // 眼 eye
	5: '#f5f0e8',   // 眼白 eyeWhite
	6: '#e8a0a0',   // 腮红 blush
	7: '#c4886a',   // 嘴 mouth
	8: '#8b5e3c',   // 深嘴 mouthDark
	9: '#f5dfc0',   // 高光 highlight
};

// ── 像素数据：6 个 10×10 数组 ──
const FACE_DATA: Record<MascotExpression, string[]> = {
	idle: [
		'0111111110',
		'1222222210',
		'1222222210',
		'1222222210',
		'1245224520',
		'1245224520',
		'1222222210',
		'1227222210',
		'1622222610',
		'0111111110',
	],
	thinking: [
		'0111111110',
		'1922222910',
		'1222222210',
		'1222222210',
		'1245224520',
		'1224222420',
		'1222222210',
		'0222082200',
		'0222222200',
		'0011111100',
	],
	happy: [
		'0111111110',
		'1222222210',
		'1222222210',
		'1222222210',
		'1241221420',
		'1224122420',
		'1222222210',
		'1288888210',
		'1622222610',
		'0111111110',
	],
	curious: [
		'0111111110',
		'1222222210',
		'1222222210',
		'1222222210',
		'1245224520',
		'1245224520',
		'1222222210',
		'1228222210',
		'1222222210',
		'0111111110',
	],
	reading: [
		'0111111110',
		'1222222210',
		'1223223210',
		'1245224520',
		'1245224520',
		'1333333310',
		'1222222210',
		'1222822210',
		'1222222210',
		'0111111110',
	],
	sleeping: [
		'0111111110',
		'1222222210',
		'1222222210',
		'1222222210',
		'1244224420',
		'1224224220',
		'1222222210',
		'1222222210',
		'1222222210',
		'0111111110',
	],
};

const EXPRESSION_META: Record<MascotExpression, { tooltip: string }> = {
	idle:     { tooltip: '等你提问~' },
	thinking: { tooltip: '让我想想…' },
	happy:    { tooltip: '读到了好东西！' },
	curious:  { tooltip: '嗯？' },
	reading:  { tooltip: '认真阅读中…' },
	sleeping: { tooltip: 'Zzz…' },
};

const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 分钟
const HAPPY_REVERT_MS = 2000;

/**
 * 像素数据 → SVG 字符串
 */
export function faceSVG(expression: MascotExpression): string {
	const data = FACE_DATA[expression];
	if (!data) return '';

	let rects = '';
	for (let y = 0; y < data.length; y++) {
		for (let x = 0; x < data[y].length; x++) {
			const c = parseInt(data[y][x]);
			if (c === 0) continue;
			rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${PALETTE[c]}"/>`;
		}
	}
	return `<svg viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg" style="image-rendering:pixelated">${rects}</svg>`;
}

export class MascotFace extends Component {
	private currentExpression: MascotExpression = 'idle';
	private idleTimer: ReturnType<typeof setTimeout> | null = null;
	private happyTimer: ReturnType<typeof setTimeout> | null = null;
	private svgEl: HTMLElement | null = null;
	private tooltipEl: HTMLElement | null = null;

	constructor() {
		super();
		this.el = this.render();
	}

	render(): HTMLElement {
		const container = document.createElement('div');
		container.className = 'deeppdf-mascot-face';

		this.svgEl = document.createElement('div');
		this.svgEl.className = 'deeppdf-mascot-face-svg';
		this.svgEl.innerHTML = faceSVG('idle');
		container.appendChild(this.svgEl);

		// Tooltip 挂载到 body，fixed 定位
		this.tooltipEl = document.createElement('span');
		this.tooltipEl.className = 'deeppdf-mascot-tooltip';
		this.tooltipEl.textContent = EXPRESSION_META.idle.tooltip;
		document.body.appendChild(this.tooltipEl);

		container.addEventListener('mouseenter', () => {
			this.showTooltip(container);
		});
		container.addEventListener('mouseleave', () => {
			this.hideTooltip();
		});

		this.resetIdleTimer();

		return container;
	}

	private showTooltip(anchor: HTMLElement): void {
		if (!this.tooltipEl) return;
		const rect = anchor.getBoundingClientRect();
		this.tooltipEl.style.left = `${rect.left + rect.width / 2}px`;
		this.tooltipEl.style.top = `${rect.bottom + 6}px`;
		this.tooltipEl.textContent = EXPRESSION_META[this.currentExpression].tooltip;
		this.tooltipEl.classList.add('visible');
	}

	private hideTooltip(): void {
		this.tooltipEl?.classList.remove('visible');
	}

	setExpression(expr: MascotExpression): void {
		if (this.currentExpression === expr) return;
		this.clearHappyTimer();
		this.currentExpression = expr;

		if (this.svgEl) {
			this.svgEl.innerHTML = faceSVG(expr);
		}

		if (this.tooltipEl?.classList.contains('visible')) {
			this.tooltipEl.textContent = EXPRESSION_META[expr].tooltip;
		}

		if (expr === 'happy') {
			this.happyTimer = setTimeout(() => {
				this.setExpression('idle');
			}, HAPPY_REVERT_MS);
		}

		if (expr !== 'sleeping') {
			this.resetIdleTimer();
		}
	}

	onUserActivity(): void {
		if (this.currentExpression === 'sleeping') {
			this.setExpression('idle');
		}
		this.resetIdleTimer();
	}

	getExpression(): MascotExpression {
		return this.currentExpression;
	}

	private resetIdleTimer(): void {
		this.clearIdleTimer();
		this.idleTimer = setTimeout(() => {
			this.setExpression('sleeping');
		}, IDLE_TIMEOUT_MS);
	}

	private clearIdleTimer(): void {
		if (this.idleTimer) {
			clearTimeout(this.idleTimer);
			this.idleTimer = null;
		}
	}

	private clearHappyTimer(): void {
		if (this.happyTimer) {
			clearTimeout(this.happyTimer);
			this.happyTimer = null;
		}
	}

	destroy(): void {
		this.clearIdleTimer();
		this.clearHappyTimer();
		if (this.tooltipEl && this.tooltipEl.parentNode) {
			this.tooltipEl.parentNode.removeChild(this.tooltipEl);
		}
		this.svgEl = null;
		this.tooltipEl = null;
		super.destroy();
	}
}
