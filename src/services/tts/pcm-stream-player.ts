const DEFAULT_SAMPLE_RATE = 24000;

export class PCMStreamPlayer {
    private ctx: AudioContext;
    private sampleRate: number;
    private nextStartTime = 0;
    private chunks: Float32Array[] = [];
    private sealed = false;
    private paused = false;
    private lastSource: AudioBufferSourceNode | null = null;
    private completeResolve: (() => void) | null = null;
    private completePromise: Promise<void> | null = null;
    private stopped = false;
    private firstStartTime: number | null = null;
    private leftover: Uint8Array | null = null;

    constructor(sampleRate = DEFAULT_SAMPLE_RATE) {
        this.sampleRate = sampleRate;
        this.ctx = new AudioContext({ sampleRate });
        // 预先恢复 AudioContext，避免第一个 chunk 播放时的延迟
        if (this.ctx.state === 'suspended') {
            this.ctx.resume().catch(() => {});
        }
    }

    get currentTime(): number {
        return this.ctx.currentTime;
    }

    get endTime(): number {
        return this.nextStartTime;
    }

    /** 第一个 chunk 开始播放的时间（进度追踪起点） */
    get startTime(): number {
        return this.firstStartTime ?? this.currentTime;
    }

    enqueue(pcm16: ArrayBuffer): void {
        if (this.stopped) return;
        if (this.sealed) return;

        // 确保不在 suspended 状态（自动播放策略），但暂停期间不恢复
        if (this.ctx.state === 'suspended' && !this.paused) {
            this.ctx.resume();
        }

        // 拼接前一次未处理的残留字节
        let dataToProcess = new Uint8Array(pcm16);
        if (this.leftover && this.leftover.length > 0) {
            const combined = new Uint8Array(this.leftover.length + dataToProcess.length);
            combined.set(this.leftover, 0);
            combined.set(dataToProcess, this.leftover.length);
            dataToProcess = combined;
            this.leftover = null;
        }

        // pcm16 是 16位 (2字节) 采样的音频，需要 2 字节对齐
        const sampleCount = Math.floor(dataToProcess.length / 2);
        const alignedByteLength = sampleCount * 2;

        if (alignedByteLength < dataToProcess.length) {
            this.leftover = dataToProcess.slice(alignedByteLength);
        }

        if (sampleCount === 0) return;

        // 提取对齐后的 PCM16 数据
        const alignedBuffer = dataToProcess.buffer.slice(
            dataToProcess.byteOffset,
            dataToProcess.byteOffset + alignedByteLength
        );
        const int16 = new Int16Array(alignedBuffer);
        const float32 = new Float32Array(int16.length);
        for (let i = 0; i < int16.length; i++) {
            float32[i] = int16[i] / 32768;
        }
        this.chunks.push(float32);

        const buffer = this.ctx.createBuffer(1, float32.length, this.ctx.sampleRate);
        buffer.copyToChannel(float32, 0);

        const source = this.ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(this.ctx.destination);

        const now = this.ctx.currentTime;
        if (this.nextStartTime < now) {
            // 首个 chunk 或间隔过大时，增加缓冲时间 (0.25s 抖动缓冲区) 确保 AudioContext 完全就绪且网络抖动不引起断续
            this.nextStartTime = now + 0.25;
        }
        // 记录第一个 chunk 的实际播放开始时间
        if (this.firstStartTime === null) {
            this.firstStartTime = this.nextStartTime;
        }
        source.start(this.nextStartTime);
        this.nextStartTime += buffer.duration;

        this.lastSource = source;
    }

    /** 标记不会再有新 chunk，等最后一个 source 播完后 resolve waitForEnd */
    seal(): void {
        if (this.stopped || this.sealed) return;
        this.sealed = true;

        if (!this.lastSource) {
            // 没有任何 chunk 入队过，直接 resolve
            this.completeResolve?.();
            return;
        }

        // 创建统一 Promise（只创建一次）
        if (!this.completePromise) {
            this.completePromise = new Promise<void>(resolve => {
                this.completeResolve = resolve;
            });
        }

        this.lastSource.onended = () => {
            if (!this.stopped) {
                this.completeResolve?.();
            }
        };
    }

    /** 等待所有已入队的音频播放完毕（需要先调用 seal()） */
    async waitForEnd(): Promise<void> {
        if (!this.sealed) {
            // 未 seal，用时间估算
            const remaining = (this.nextStartTime - this.ctx.currentTime) * 1000;
            if (remaining > 0) {
                await new Promise(resolve => setTimeout(resolve, remaining + 200));
            }
            return;
        }

        if (!this.completePromise) {
            // seal() 没有创建 Promise（无 chunk 情况），直接返回
            return;
        }

        await this.completePromise;
    }

    pause(): void {
        if (!this.stopped) {
            this.paused = true;
            this.ctx.suspend();
        }
    }

    resume(): void {
        if (!this.stopped) {
            this.paused = false;
            this.ctx.resume();
        }
    }

    stop(): void {
        if (this.stopped) return;
        this.stopped = true;
        // 主动 resolve，让 waitForEnd 不死锁
        this.completeResolve?.();
        this.completeResolve = null;
        try { this.ctx.close(); } catch {}
    }

    assembleWav(): Blob {
        let totalLen = 0;
        for (const c of this.chunks) totalLen += c.length;
        const all = new Float32Array(totalLen);
        let off = 0;
        for (const c of this.chunks) {
            all.set(c, off);
            off += c.length;
        }
        return encodeWav(all, this.sampleRate);
    }
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
    const n = samples.length;
    const buf = new ArrayBuffer(44 + n * 2);
    const v = new DataView(buf);

    writeStr(v, 0, 'RIFF');
    v.setUint32(4, 36 + n * 2, true);
    writeStr(v, 8, 'WAVE');
    writeStr(v, 12, 'fmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, sampleRate, true);
    v.setUint32(28, sampleRate * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    writeStr(v, 36, 'data');
    v.setUint32(40, n * 2, true);

    for (let i = 0; i < n; i++) {
        const s = Math.max(-1, Math.min(1, samples[i]));
        v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }

    return new Blob([buf], { type: 'audio/wav' });
}

function writeStr(v: DataView, off: number, s: string): void {
    for (let i = 0; i < s.length; i++) {
        v.setUint8(off + i, s.charCodeAt(i));
    }
}
