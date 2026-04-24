/**
 * 流式语音播放器
 * 支持边生成边播放，无缝衔接音频块
 */

export type StreamingVoiceState = 'idle' | 'buffering' | 'playing' | 'paused' | 'ended';

export interface StreamingVoicePlayerOptions {
    sampleRate?: number;  // 默认 24000
    onStateChange?: (state: StreamingVoiceState) => void;
    onTimeUpdate?: (currentTime: number, duration: number) => void;
}

export class StreamingVoicePlayer {
    private state: StreamingVoiceState = 'idle';
    private audioContext: AudioContext | null = null;
    private gainNode: GainNode | null = null;
    
    // 音频块队列
    private audioQueue: AudioBuffer[] = [];
    private isPlaying = false;
    private isPaused = false;
    
    // 播放控制
    private currentSource: AudioBufferSourceNode | null = null;
    private startTime = 0;
    private pauseTime = 0;
    private totalDuration = 0;
    
    // 配置
    private sampleRate: number;
    private onStateChange?: (state: StreamingVoiceState) => void;
    private onTimeUpdate?: (currentTime: number, duration: number) => void;
    
    // PCM 数据累积
    private pendingPCM: Int16Array[] = [];
    private pendingBytes = 0;
    
    constructor(options?: StreamingVoicePlayerOptions) {
        this.sampleRate = options?.sampleRate || 24000;
        this.onStateChange = options?.onStateChange;
        this.onTimeUpdate = options?.onTimeUpdate;
    }
    
    /**
     * 接收音频块（PCM16 数据）
     */
    enqueueChunk(audioChunk: ArrayBuffer): void {
        // 将 ArrayBuffer 转换为 Int16Array
        const pcmData = new Int16Array(audioChunk);
        this.pendingPCM.push(pcmData);
        this.pendingBytes += pcmData.byteLength;
        
        // 当累积足够数据时，创建 AudioBuffer 并加入队列
        // 每 100ms 的数据（24000 * 0.1 * 2 = 4800 字节）
        if (this.pendingBytes >= 4800) {
            this.flushPendingPCM();
        }
        
        // 如果正在播放，检查是否需要开始播放新块
        if (this.isPlaying && !this.isPaused) {
            this.checkAndPlayNext();
        }
    }
    
    /**
     * 标记不会再有新的音频块
     */
    seal(): void {
        // 刷新剩余的 PCM 数据
        this.flushPendingPCM();
        
        // 如果正在播放，等待所有块播放完
        if (this.isPlaying) {
            // 不做任何操作，让播放自然结束
        } else {
            this.setState('ended');
        }
    }
    
    /**
     * 开始播放
     */
    async play(): Promise<void> {
        if (this.state === 'playing') return;
        
        // 初始化 AudioContext（需要用户交互）
        if (!this.audioContext) {
            this.audioContext = new AudioContext({ sampleRate: this.sampleRate });
            this.gainNode = this.audioContext.createGain();
            this.gainNode.connect(this.audioContext.destination);
        }
        
        // 如果是暂停状态，恢复播放
        if (this.state === 'paused') {
            this.resume();
            return;
        }
        
        this.isPlaying = true;
        this.isPaused = false;
        this.setState('playing');
        
        // 开始播放队列中的音频
        this.playNext();
    }
    
    /**
     * 暂停播放
     */
    pause(): void {
        if (this.state !== 'playing') return;
        
        this.isPaused = true;
        this.pauseTime = this.audioContext?.currentTime || 0;
        
        // 停止当前播放
        if (this.currentSource) {
            this.currentSource.stop();
            this.currentSource = null;
        }
        
        this.setState('paused');
    }
    
    /**
     * 恢复播放
     */
    private resume(): void {
        if (this.state !== 'paused') return;
        
        this.isPaused = false;
        this.setState('playing');
        
        // 继续播放
        this.playNext();
    }
    
    /**
     * 停止播放
     */
    stop(): void {
        this.isPlaying = false;
        this.isPaused = false;
        
        if (this.currentSource) {
            this.currentSource.stop();
            this.currentSource = null;
        }
        
        this.audioQueue = [];
        this.pendingPCM = [];
        this.pendingBytes = 0;
        this.totalDuration = 0;
        
        this.setState('idle');
    }
    
    /**
     * 获取当前状态
     */
    getState(): StreamingVoiceState {
        return this.state;
    }
    
    /**
     * 获取当前播放时间
     */
    getCurrentTime(): number {
        if (!this.audioContext || !this.isPlaying) return 0;
        return this.audioContext.currentTime - this.startTime;
    }
    
    /**
     * 获取总时长
     */
    getTotalDuration(): number {
        return this.totalDuration;
    }
    
    /**
     * 销毁播放器
     */
    destroy(): void {
        this.stop();
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }
    }
    
    // ========== 私有方法 ==========
    
    private flushPendingPCM(): void {
        if (this.pendingPCM.length === 0) return;
        
        // 合并所有 PCM 数据
        const totalSamples = this.pendingPCM.reduce((sum, arr) => sum + arr.length, 0);
        const merged = new Int16Array(totalSamples);
        let offset = 0;
        for (const pcm of this.pendingPCM) {
            merged.set(pcm, offset);
            offset += pcm.length;
        }
        
        // 创建 AudioBuffer
        const audioBuffer = this.audioContext?.createBuffer(1, totalSamples, this.sampleRate);
        if (audioBuffer) {
            const channelData = audioBuffer.getChannelData(0);
            for (let i = 0; i < totalSamples; i++) {
                channelData[i] = merged[i] / 32768.0;
            }
            this.audioQueue.push(audioBuffer);
            this.totalDuration += audioBuffer.duration;
        }
        
        // 清空累积数据
        this.pendingPCM = [];
        this.pendingBytes = 0;
    }
    
    private checkAndPlayNext(): void {
        if (this.audioQueue.length > 0 && this.isPlaying && !this.isPaused) {
            this.playNext();
        }
    }
    
    private playNext(): void {
        if (!this.audioContext || !this.gainNode) return;
        if (this.audioQueue.length === 0) {
            // 没有更多音频块，等待或结束
            return;
        }
        
        const audioBuffer = this.audioQueue.shift()!;
        const source = this.audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(this.gainNode);
        
        source.onended = () => {
            this.currentSource = null;
            // 播放下一个块
            if (this.isPlaying && !this.isPaused) {
                this.playNext();
            }
        };
        
        this.currentSource = source;
        this.startTime = this.audioContext.currentTime;
        source.start(0);
    }
    
    private setState(newState: StreamingVoiceState): void {
        this.state = newState;
        this.onStateChange?.(newState);
    }
}
