/**
 * InkLayer - 阅读模式墨迹层（装饰性，渐隐消失）
 *
 * Canvas fixed 覆盖整个视口，鼠标轨迹留下毛笔墨痕，1.2s 后自动消失。
 * 坐标直接用 clientX/clientY，无偏移计算，像素级精准。
 */

import { serviceLog } from '../../utils/logger.js';

export interface InkLayerOptions {
	container: HTMLElement;
}

export class InkLayer {
	private canvas: HTMLCanvasElement | null = null;
	private ctx: CanvasRenderingContext2D | null = null;
	private raf = 0;
	private points: { x: number; y: number; t: number; speed: number }[] = [];
	private active = false;

	private lastX = 0;
	private lastY = 0;
	private lastTime = 0;

	constructor(_options: InkLayerOptions) {
		// container 不再使用，保留接口兼容
	}

	activate(): void {
		if (this.active) return;

		this.canvas = document.createElement('canvas');
		this.canvas.className = 'deeppdf-ink-layer-canvas';
		document.body.appendChild(this.canvas);
		this.ctx = this.canvas.getContext('2d');
		this.resizeCanvas();

		this.lastX = 0;
		this.lastY = 0;
		this.lastTime = 0;

		window.addEventListener('mousemove', this.onMove);
		window.addEventListener('resize', this.onResize);
		this.raf = requestAnimationFrame(this.draw);
		this.active = true;
		serviceLog('[InkLayer] Activated');
	}

	deactivate(): void {
		if (!this.active) return;
		this.cleanup();
		serviceLog('[InkLayer] Deactivated');
	}

	cleanup(): void {
		cancelAnimationFrame(this.raf);
		window.removeEventListener('mousemove', this.onMove);
		window.removeEventListener('resize', this.onResize);
		this.canvas?.remove();
		this.canvas = null;
		this.ctx = null;
		this.points = [];
		this.active = false;
	}

	// ── mousemove 采集 ─────────────────────────────────────

	private onMove = (e: MouseEvent): void => {
		const now = performance.now();
		const dt = now - this.lastTime;
		if (dt < 8) return;
		const dx = e.clientX - this.lastX;
		const dy = e.clientY - this.lastY;
		const dist = Math.sqrt(dx * dx + dy * dy);
		const speed = dt > 0 ? dist / dt : 0;

		if (dist > 2) {
			this.points.push({
				x: e.clientX,
				y: e.clientY,
				t: now,
				speed,
			});
		}
		this.lastX = e.clientX;
		this.lastY = e.clientY;
		this.lastTime = now;
	};

	// ── 绘制循环（和 AI 回复最大化一致） ────────────────────

	private draw = (): void => {
		const ctx = this.ctx;
		if (!ctx || !this.canvas) {
			this.raf = requestAnimationFrame(this.draw);
			return;
		}
		const now = performance.now();
		const FADE_MS = 1200;

		ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

		// 过滤已消失的点
		this.points = this.points.filter(p => now - p.t < FADE_MS);

		if (this.points.length < 2) {
			this.raf = requestAnimationFrame(this.draw);
			return;
		}

		// 绘制墨迹
		for (let i = 1; i < this.points.length; i++) {
			const prev = this.points[i - 1];
			const curr = this.points[i];
			const age = now - curr.t;
			const alpha = Math.max(0, 1 - age / FADE_MS);

			// 速度越快越细，越慢越粗（模拟毛笔按压）
			const baseWidth = 4.5;
			const speedFactor = Math.max(0.15, 1 - curr.speed * 0.8);
			const width = baseWidth * speedFactor * (0.3 + alpha * 0.7);

			ctx.beginPath();
			ctx.moveTo(prev.x, prev.y);
			ctx.lineTo(curr.x, curr.y);
			ctx.strokeStyle = `rgba(178, 34, 34, ${alpha * 0.6})`;
			ctx.lineWidth = width;
			ctx.lineCap = 'round';
			ctx.lineJoin = 'round';
			ctx.stroke();

			// 墨迹晕染
			if (alpha > 0.3) {
				ctx.beginPath();
				ctx.arc(curr.x, curr.y, width * 0.8, 0, Math.PI * 2);
				ctx.fillStyle = `rgba(178, 34, 34, ${alpha * 0.12})`;
				ctx.fill();
			}
		}

		this.raf = requestAnimationFrame(this.draw);
	};

	// ── Canvas 尺寸 ─────────────────────────────────────────

	private resizeCanvas(): void {
		if (!this.canvas) return;
		this.canvas.width = window.innerWidth;
		this.canvas.height = window.innerHeight;
	}

	private onResize = (): void => {
		if (!this.active) return;
		this.resizeCanvas();
	};
}
