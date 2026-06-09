import { encodeWav } from './audio-utils.js';

export type RecorderState = 'idle' | 'recording' | 'error';

export interface AudioRecorderOptions {
	/** 最大录音时长（毫秒），默认 60000 */
	maxDuration?: number;
}

export class AudioRecorder {
	private mediaRecorder: MediaRecorder | null = null;
	private audioContext: AudioContext | null = null;
	private chunks: Blob[] = [];
	private state: RecorderState = 'idle';
	private startTime = 0;
	private maxDuration: number;
	private timeoutId: ReturnType<typeof setTimeout> | null = null;
	private stopping = false;

	constructor(options?: AudioRecorderOptions) {
		this.maxDuration = options?.maxDuration ?? 60000;
	}

	getState(): RecorderState {
		return this.state;
	}

	getDuration(): number {
		if (this.state !== 'recording') return 0;
		return Date.now() - this.startTime;
	}

	async start(): Promise<void> {
		if (this.state === 'recording') return;

		const stream = await navigator.mediaDevices.getUserMedia({
			audio: {
				channelCount: 1,
				sampleRate: 16000,
				echoCancellation: true,
				noiseSuppression: true,
			},
		});

		try {
			this.chunks = [];
			this.mediaRecorder = new MediaRecorder(stream, {
				mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
					? 'audio/webm;codecs=opus'
					: 'audio/webm',
			});

			this.mediaRecorder.ondataavailable = (e) => {
				if (e.data.size > 0) {
					this.chunks.push(e.data);
				}
			};

			this.mediaRecorder.start(1000);
			this.state = 'recording';
			this.startTime = Date.now();
			this.stopping = false;

			this.timeoutId = setTimeout(() => {
				if (this.state === 'recording' && !this.stopping) {
					this.stop().catch(() => {});
				}
			}, this.maxDuration);
		} catch (err) {
			stream.getTracks().forEach(t => t.stop());
			throw err;
		}
	}

	async stop(): Promise<{ audioBase64: string; mimeType: string; duration: number }> {
		if (this.stopping) {
			throw new Error('Already stopping');
		}
		if (this.state !== 'recording' || !this.mediaRecorder) {
			throw new Error('Not recording');
		}

		this.stopping = true;
		const duration = Date.now() - this.startTime;

		if (this.timeoutId) {
			clearTimeout(this.timeoutId);
			this.timeoutId = null;
		}

		return new Promise((resolve, reject) => {
			if (!this.mediaRecorder) {
				this.stopping = false;
				reject(new Error('MediaRecorder is null'));
				return;
			}

			this.mediaRecorder!.onstop = async () => {
				try {
					const blob = new Blob(this.chunks, { type: this.mediaRecorder!.mimeType });

					const arrayBuffer = await blob.arrayBuffer();
					const audioBuffer = await this.decodeAudio(arrayBuffer);
					const pcmData = this.audioBufferToPCM16(audioBuffer);
					const wavBytes = encodeWav(pcmData.buffer as ArrayBuffer, {
						sampleRate: audioBuffer.sampleRate,
						channels: audioBuffer.numberOfChannels,
					});

					const base64 = arrayBufferToBase64(wavBytes.buffer as ArrayBuffer);

					this.cleanup();
					this.state = 'idle';
					this.stopping = false;

					resolve({
						audioBase64: base64,
						mimeType: 'audio/wav',
						duration,
					});
				} catch (err) {
					this.state = 'error';
					this.stopping = false;
					reject(err);
				}
			};

			this.mediaRecorder!.stop();
		});
	}

	cancel(): void {
		if (this.mediaRecorder && this.state === 'recording') {
			this.mediaRecorder.onstop = null;
			this.mediaRecorder.stop();
		}
		this.stopping = false;
		this.cleanup();
		this.state = 'idle';
	}

	destroy(): void {
		this.cancel();
	}

	private cleanup(): void {
		if (this.timeoutId) {
			clearTimeout(this.timeoutId);
			this.timeoutId = null;
		}

		if (this.mediaRecorder?.stream) {
			this.mediaRecorder.stream.getTracks().forEach(t => t.stop());
		}
		this.mediaRecorder = null;
		this.chunks = [];

		if (this.audioContext) {
			this.audioContext.close().catch(() => {});
			this.audioContext = null;
		}
	}

	private async decodeAudio(arrayBuffer: ArrayBuffer): Promise<AudioBuffer> {
		if (!this.audioContext) {
			this.audioContext = new AudioContext({ sampleRate: 16000 });
		}
		return this.audioContext.decodeAudioData(arrayBuffer);
	}

	private audioBufferToPCM16(audioBuffer: AudioBuffer): Int16Array {
		const channelData = audioBuffer.getChannelData(0);
		const pcm = new Int16Array(channelData.length);
		for (let i = 0; i < channelData.length; i++) {
			const s = Math.max(-1, Math.min(1, channelData[i]));
			pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
		}
		return pcm;
	}
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
	const bytes = new Uint8Array(buffer);
	const chunks: string[] = [];
	const chunkSize = 8192;
	for (let i = 0; i < bytes.length; i += chunkSize) {
		const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
		let binary = '';
		for (let j = 0; j < slice.length; j++) {
			binary += String.fromCharCode(slice[j]);
		}
		chunks.push(binary);
	}
	return btoa(chunks.join(''));
}
