/**
 * 语音书信模式控制器
 *
 * 管理 Voice（语音气泡）和 Letter（信封）两个子系统的状态和渲染。
 * AIMessage 通过组合持有此 controller，委托相关调用。
 */

import { Icons } from '../../utils/icons.js';
import type { MessageData } from './types.js';

/** AIMessage 暴露给 controller 的回调接口 */
export interface VoiceLetterHost {
	getEl(): HTMLElement | null;
	getData(): MessageData;
	update(data: Partial<MessageData>): void;
	renderTimestamp(): HTMLElement;
	renderActions(bubble: HTMLElement): void;
	requestRerender(): void;
}

export class VoiceLetterController {
	private host: VoiceLetterHost;

	// TTS
	ttsWaveEl: HTMLElement | null = null;
	ttsBtn: HTMLButtonElement | null = null;

	// Voice/Letter 状态
	letterState: 'sealing' | 'sealed' | 'opened' = 'sealing';
	voiceState: 'loading' | 'ready' | 'playing' | 'paused' | 'ended' = 'loading';
	voiceAudio: ArrayBuffer | null = null;
	voiceDuration: number = 0;
	voiceAudioEl: HTMLAudioElement | null = null;
	voiceBlobUrl: string | null = null;

	// TTS 自动滚动：用户手动滚动后停止自动跟随
	private userScrolled = false;
	private scrollListener: ((e: Event) => void) | null = null;

	enableVoiceReply: boolean = false;
	onVoicePlay?: (messageId: string) => void;
	onVoicePause?: (messageId: string) => void;

	constructor(host: VoiceLetterHost, data: MessageData) {
		this.host = host;
		this.enableVoiceReply = data.enableVoiceReply ?? false;
		if (data.voiceAudio) this.voiceAudio = data.voiceAudio;
		if (data.voiceDuration) this.voiceDuration = data.voiceDuration;
		if (data.letterState) this.letterState = data.letterState;
		if (data.voiceState) {
			this.voiceState = data.voiceState;
		} else if (data.voiceAudio) {
			this.voiceState = 'ready';
		}
	}

	/** 更新语音数据（VoicePipeline 完成后调用） */
	updateVoiceData(data: { audioBuffer: ArrayBuffer; duration: number }): void {
		this.voiceAudio = data.audioBuffer;
		this.voiceDuration = data.duration;
		this.voiceState = 'ready';
		this.host.update({
			voiceAudio: data.audioBuffer,
			voiceDuration: data.duration,
			voiceState: 'ready',
		});
	}

	/** 更新信封状态 */
	updateLetterState(state: 'sealing' | 'sealed' | 'opened'): void {
		this.letterState = state;
		this.host.requestRerender();
	}

	/** 更新语音播放状态 */
	updateVoiceState(state: 'loading' | 'ready' | 'playing' | 'paused' | 'ended'): void {
		this.voiceState = state;
		this.host.update({ voiceState: state });
	}

	/** 渲染语音气泡 */
	renderVoiceBubble(container: HTMLElement): void {
		if (!this.enableVoiceReply) return;

		if (this.voiceState === 'loading') {
			const loadingBubble = container.createDiv({ cls: 'deeppdf-voice-loading' });
			loadingBubble.innerHTML = `
				<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path>
					<path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
					<line x1="12" x2="12" y1="19" y2="22"></line>
				</svg>
				<span>正在组织语言...</span>
			`;
			return;
		}

		const bubble = container.createDiv({ cls: 'deeppdf-voice-bubble' });
		if (this.voiceState === 'playing') bubble.addClass('playing');

		const playBtn = bubble.createDiv({ cls: 'deeppdf-voice-play-btn' });
		playBtn.textContent = (this.voiceState === 'playing') ? '⏸' : '▶';

		const bars = bubble.createDiv({ cls: 'deeppdf-voice-bars' });
		for (let i = 0; i < 8; i++) {
			const bar = bars.createDiv({ cls: 'deeppdf-voice-bar' });
			bar.style.height = `${6 + Math.random() * 10}px`;
		}

		const duration = bubble.createDiv({ cls: 'deeppdf-voice-duration' });
		const min = Math.floor(this.voiceDuration / 60);
		const sec = Math.floor(this.voiceDuration % 60);
		duration.textContent = `${min}:${sec.toString().padStart(2, '0')}`;

		bubble.addEventListener('click', () => {
			this.toggleVoicePlayback();
		});
	}

	/** 渲染信封（仅在 sealing/sealed 状态调用） */
	renderLetterEnvelope(container: HTMLElement, content: string): void {
		const envelope = container.createDiv({ cls: 'deeppdf-letter-envelope' });
		envelope.createDiv({ cls: 'deeppdf-letter-label' }).textContent = '奚童 来信';

		const ink = envelope.createDiv({ cls: 'deeppdf-letter-ink' });

		if (this.host.getData().isStreaming) {
			const writing = ink.createDiv({ cls: 'deeppdf-letter-writing' });
			writing.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>`;
			const dots = ink.createDiv({ cls: 'deeppdf-letter-writing-dots' });
			for (let j = 0; j < 3; j++) {
				dots.createSpan({ cls: 'deeppdf-letter-writing-dot' });
			}
		} else {
			const plainText = content.replace(/[#*_\[\]()>`~|]/g, '').trim();
			const textLines = plainText.split('\n').filter((l: string) => l.trim());
			const maxLines = 5;
			for (let i = 0; i < Math.min(textLines.length, maxLines); i++) {
				const lineEl = ink.createDiv({ cls: 'deeppdf-letter-ink-line' });
				lineEl.style.animationDelay = `${i * 0.1}s`;
				lineEl.textContent = textLines[i].slice(0, 40) + (textLines[i].length > 40 ? '...' : '');
			}
		}

		const openBtn = envelope.createDiv({ cls: 'deeppdf-letter-open-btn' });
		openBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>`;
		openBtn.addEventListener('click', (e: Event) => {
			e.stopPropagation();
			this.letterState = 'opened';
			this.host.requestRerender();
		});
	}

	/** 增量更新语音气泡 UI（避免全量重绘） */
	updateVoiceBubbleUI(): void {
		if (!this.host.getEl() || !this.enableVoiceReply) return;
		const bubbleEl = this.host.getEl()!.querySelector('.deeppdf-voice-loading, .deeppdf-voice-bubble');
		if (!bubbleEl) return;
		const parent = bubbleEl.parentElement;
		if (!parent) return;
		const wrapper = document.createElement('div');
		this.renderVoiceBubble(wrapper);
		bubbleEl.replaceWith(wrapper.firstChild!);
	}

	/** 切换语音播放 */
	toggleVoicePlayback(): void {
		if (this.onVoicePlay) {
			this.onVoicePlay(this.host.getData().id);
			return;
		}

		if (!this.voiceAudio) return;

		if (this.voiceState === 'playing') {
			this.voiceAudioEl?.pause();
			this.voiceState = 'paused';
		} else {
			if (!this.voiceAudioEl) {
				if (this.voiceBlobUrl) URL.revokeObjectURL(this.voiceBlobUrl);
				const blob = new Blob([this.voiceAudio], { type: 'audio/wav' });
				this.voiceBlobUrl = URL.createObjectURL(blob);
				this.voiceAudioEl = new Audio(this.voiceBlobUrl);
				this.voiceAudioEl.onended = () => {
					this.voiceState = 'ended';
					this.updateVoiceBubbleUI();
				};
			}
			this.voiceAudioEl.play();
			this.voiceState = 'playing';
		}
		this.updateVoiceBubbleUI();
	}

	/** 增量更新信封 UI */
	updateLetterEnvelopeUI(): void {
		if (!this.host.getEl()) return;
		const envelope = this.host.getEl()!.querySelector('.deeppdf-letter-envelope');
		if (!envelope) return;

		const ink = envelope.querySelector('.deeppdf-letter-ink') as HTMLElement;
		if (ink) {
			ink.empty();
			const plainText = this.host.getData().content.replace(/[#*_\[\]()>`~|]/g, '').trim();
			const textLines = plainText.split('\n').filter((l: string) => l.trim());
			const maxLines = 5;
			for (let i = 0; i < Math.min(textLines.length, maxLines); i++) {
				const lineEl = ink.createDiv({ cls: 'deeppdf-letter-ink-line' });
				lineEl.style.animationDelay = `${i * 0.1}s`;
				lineEl.textContent = textLines[i].slice(0, 40) + (textLines[i].length > 40 ? '...' : '');
			}
		}

		const openBtn = envelope.querySelector('.deeppdf-letter-open-btn');
		if (openBtn) openBtn.textContent = '✉ 拆开信封';
	}

	/** 更新信封内容（语音书信模式流式更新） */
	updateLetterContent(inkEl: HTMLElement, content: string): void {
		const plainText = content.replace(/[#*_\[\]()>`~|]/g, '').trim();
		const lines = plainText.split('\n').filter(l => l.trim());
		const maxLines = 5;
		const displayLines = lines.slice(0, maxLines);

		inkEl.empty();
		for (let i = 0; i < Math.min(displayLines.length, maxLines); i++) {
			const lineEl = inkEl.createDiv({ cls: 'deeppdf-letter-ink-line' });
			lineEl.style.animationDelay = `${i * 0.1}s`;
			lineEl.textContent = displayLines[i].slice(0, 40) + (displayLines[i].length > 40 ? '...' : '');
		}

		if (this.host.getData().isStreaming) {
			inkEl.scrollTop = inkEl.scrollHeight;
		}
	}

	/** 追加时间戳和操作按钮（流式结束时） */
	appendTimestampAndActions(): void {
		if (!this.host.getEl()) return;
		const bubble = this.host.getEl()!.querySelector('.deeppdf-message-bubble');
		if (!bubble) return;
		if (!bubble.querySelector('.deeppdf-message-time')) {
			bubble.appendChild(this.host.renderTimestamp());
		}
		this.host.renderActions(bubble as HTMLElement);
	}

	setTTSState(state: 'idle' | 'summarizing' | 'tts_loading' | 'playing' | 'paused'): void {
		if (this.ttsWaveEl) {
			this.ttsWaveEl.classList.toggle('active', state === 'playing');
		}

		if (this.ttsBtn) {
			switch (state) {
				case 'idle':
					this.ttsBtn.innerHTML = Icons.volume2;
					this.ttsBtn.title = '朗读';
					this.ttsBtn.classList.remove('tts-loading');
					break;
				case 'summarizing':
				case 'tts_loading':
					this.ttsBtn.innerHTML = Icons.spinner;
					this.ttsBtn.title = state === 'summarizing' ? '生成摘要...' : '加载语音...';
					this.ttsBtn.classList.add('tts-loading');
					break;
				case 'playing':
					this.ttsBtn.innerHTML = Icons.audioWave;
					this.ttsBtn.title = '暂停';
					this.ttsBtn.classList.remove('tts-loading');
					break;
				case 'paused':
					this.ttsBtn.innerHTML = Icons.volume2;
					this.ttsBtn.title = '继续';
					this.ttsBtn.classList.remove('tts-loading');
					break;
			}
		}
	}

	/** 高亮 TTS 播放进度（段落级） */
	highlightTTSProgress(progress: number): void {
		const contentEl = this.host.getEl()?.querySelector('.deeppdf-message-content') as HTMLElement;
		if (!contentEl) return;

		if (progress < 0) {
			contentEl.querySelectorAll('.deeppdf-tts-reading-paragraph').forEach(el => {
				el.removeClass('deeppdf-tts-reading-paragraph');
			});
			delete (contentEl.dataset as any).ttsLastParagraphIndex;
			this.detachScrollListener();
			this.userScrolled = false;
			return;
		}

		// 首次播放时注册滚动监听，用户手动滚动后停止自动跟随
		if (!this.scrollListener) {
			const container = this.findScrollContainer(contentEl);
			if (container) {
				this.scrollListener = () => { this.userScrolled = true; };
				container.addEventListener('scroll', this.scrollListener, { passive: true });
			}
		}

		const paragraphs = contentEl.querySelectorAll('p');
		if (paragraphs.length === 0) return;

		const paragraphInfo: { el: Element; start: number; end: number }[] = [];
		let totalChars = 0;

		for (const p of paragraphs) {
			const text = p.textContent || '';
			const charCount = text.length;
			paragraphInfo.push({
				el: p,
				start: totalChars,
				end: totalChars + charCount
			});
			totalChars += charCount;
		}

		if (totalChars === 0) return;

		const currentChar = Math.floor((progress / 100) * totalChars);
		let currentParagraph: Element | null = null;
		let currentIndex = -1;

		for (let i = 0; i < paragraphInfo.length; i++) {
			if (currentChar >= paragraphInfo[i].start && currentChar < paragraphInfo[i].end) {
				currentParagraph = paragraphInfo[i].el;
				currentIndex = i;
				break;
			}
		}

		if (!currentParagraph && progress >= 100) {
			currentParagraph = paragraphInfo[paragraphInfo.length - 1].el;
			currentIndex = paragraphInfo.length - 1;
		}

		if (!currentParagraph) return;

		if (currentIndex !== (contentEl.dataset as any).ttsLastParagraphIndex) {
			contentEl.querySelectorAll('.deeppdf-tts-reading-paragraph').forEach(el => {
				el.removeClass('deeppdf-tts-reading-paragraph');
			});
			currentParagraph.addClass('deeppdf-tts-reading-paragraph');
			if (!this.userScrolled) {
				(currentParagraph as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'center' });
			}
			(contentEl.dataset as any).ttsLastParagraphIndex = currentIndex;
		}
	}

	/** 查找最近的滚动容器 */
	private findScrollContainer(el: HTMLElement): HTMLElement | null {
		let node: HTMLElement | null = el;
		while (node) {
			const { overflowY } = getComputedStyle(node);
			if (overflowY === 'auto' || overflowY === 'scroll') return node;
			node = node.parentElement;
		}
		return null;
	}

	private detachScrollListener(): void {
		if (this.scrollListener) {
			const contentEl = this.host.getEl()?.querySelector('.deeppdf-message-content') as HTMLElement;
			if (contentEl) {
				const container = this.findScrollContainer(contentEl);
				container?.removeEventListener('scroll', this.scrollListener);
			}
			this.scrollListener = null;
		}
	}

	/** 清理资源 */
	destroy(): void {
		this.detachScrollListener();
		if (this.voiceAudioEl) {
			this.voiceAudioEl.pause();
			this.voiceAudioEl.src = '';
			this.voiceAudioEl = null;
		}
		if (this.voiceBlobUrl) {
			URL.revokeObjectURL(this.voiceBlobUrl);
			this.voiceBlobUrl = null;
		}
		this.voiceAudio = null;
	}
}
