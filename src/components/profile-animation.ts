/**
 * ProfileAnimation — 文字粒子汇聚成人形的 Canvas 动画
 */

interface TextParticle {
	text: string;
	x: number;
	y: number;
	targetX: number;
	targetY: number;
}

export class ProfileAnimation {
	private canvas: HTMLCanvasElement;
	private ctx: CanvasRenderingContext2D;
	private particles: TextParticle[] = [];
	private animationFrame = 0;
	private progress = 0;
	private running = false;

	constructor(container: HTMLElement, texts: string[]) {
		this.canvas = document.createElement('canvas');
		this.canvas.className = 'deeppdf-profile-animation';
		this.canvas.width = 300;
		this.canvas.height = 300;
		container.appendChild(this.canvas);

		const ctx = this.canvas.getContext('2d');
		if (!ctx) throw new Error('Canvas not supported');
		this.ctx = ctx;
		this.initParticles(texts);
	}

	private initParticles(texts: string[]): void {
		const words = texts.flatMap(t => {
			const chunks: string[] = [];
			for (let i = 0; i < t.length; i += 3) {
				chunks.push(t.slice(i, Math.min(i + 4, t.length)));
			}
			return chunks;
		});

		const sampleSize = Math.min(words.length, 60);
		const sampled = [...words].sort(() => Math.random() - 0.5).slice(0, sampleSize);
		const targets = this.generateHumanOutline(sampled.length);

		this.particles = sampled.map((text, i) => ({
			text,
			x: Math.random() * this.canvas.width,
			y: Math.random() * this.canvas.height,
			targetX: targets[i].x,
			targetY: targets[i].y,
		}));
	}

	private generateHumanOutline(count: number): { x: number; y: number }[] {
		const cx = 150, cy = 150;
		const points: { x: number; y: number }[] = [];

		// 头部
		const headCount = Math.max(1, Math.floor(count * 0.15));
		for (let i = 0; i < headCount; i++) {
			const angle = (i / headCount) * Math.PI * 2;
			points.push({ x: cx + Math.cos(angle) * 20, y: cy - 80 + Math.sin(angle) * 20 });
		}

		// 身体
		const bodyCount = Math.max(1, Math.floor(count * 0.5));
		for (let i = 0; i < bodyCount; i++) {
			const angle = (i / bodyCount) * Math.PI * 2;
			points.push({
				x: cx + Math.cos(angle) * 35,
				y: cy + Math.sin(angle) * 60,
			});
		}

		// 填充
		while (points.length < count) {
			const angle = Math.random() * Math.PI * 2;
			const r = Math.random() * 30;
			points.push({ x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * 50 });
		}

		return points.slice(0, count);
	}

	setProgress(p: number): void {
		this.progress = Math.max(0, Math.min(1, p));
	}

	start(): void {
		this.running = true;
		const loop = () => {
			if (!this.running) return;
			this.render();
			this.animationFrame = requestAnimationFrame(loop);
		};
		loop();
	}

	private render(): void {
		this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
		const p = this.progress;

		for (const particle of this.particles) {
			const x = particle.x + (particle.targetX - particle.x) * p;
			const y = particle.y + (particle.targetY - particle.y) * p;
			const opacity = 0.3 + p * 0.7;
			const scale = 0.6 + p * 0.4;

			this.ctx.globalAlpha = opacity;
			this.ctx.font = `${Math.round(12 * scale)}px sans-serif`;
			this.ctx.fillStyle = '#8b7355';
			this.ctx.fillText(particle.text, x, y);
		}
		this.ctx.globalAlpha = 1;
	}

	destroy(): void {
		this.running = false;
		cancelAnimationFrame(this.animationFrame);
		this.canvas.remove();
	}
}
