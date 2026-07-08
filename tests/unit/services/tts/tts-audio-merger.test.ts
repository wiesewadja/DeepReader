import { describe, it, expect } from 'vitest';

// Helper: create a minimal valid WAV ArrayBuffer (16-bit mono PCM)
function createWavChunk(sampleRate: number, pcmBytes: number): ArrayBuffer {
    const headerSize = 44;
    const buffer = new ArrayBuffer(headerSize + pcmBytes);
    const view = new DataView(buffer);

    // RIFF header
    writeString(view, 0, 'RIFF');
    view.setUint32(4, buffer.byteLength - 8, true);
    writeString(view, 8, 'WAVE');

    // fmt sub-chunk
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);      // PCM format
    view.setUint16(22, 1, true);      // mono
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true); // byte rate
    view.setUint16(32, 2, true);      // block align
    view.setUint16(34, 16, true);     // bits per sample

    // data sub-chunk
    writeString(view, 36, 'data');
    view.setUint32(40, pcmBytes, true);

    return buffer;
}

function writeString(view: DataView, offset: number, str: string): void {
    for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
    }
}

describe('mergeAudioChunks', () => {
    it('应该抛出错误当没有音频片段时', async () => {
        const { mergeAudioChunks } = await import('@/services/tts/tts-audio-merger');
        expect(() => mergeAudioChunks([])).toThrow('No audio chunks to merge');
    });

    it('应该直接返回单个片段', async () => {
        const { mergeAudioChunks } = await import('@/services/tts/tts-audio-merger');
        const chunk = createWavChunk(24000, 100);
        const result = mergeAudioChunks([chunk]);
        expect(result).toBe(chunk);
    });

    it('应该合并两个格式一致的片段', async () => {
        const { mergeAudioChunks } = await import('@/services/tts/tts-audio-merger');
        const chunk1 = createWavChunk(24000, 100);
        const chunk2 = createWavChunk(24000, 200);
        const result = mergeAudioChunks([chunk1, chunk2]);

        // 44 header + 100 + 200 = 344 bytes
        expect(result.byteLength).toBe(44 + 300);

        const view = new DataView(result);
        // 验证 RIFF 头
        expect(view.getUint32(4, true)).toBe(result.byteLength - 8);
        // 验证 PCM 数据大小
        expect(view.getUint32(40, true)).toBe(300);
    });

    it('应该跳过格式不匹配的片段', async () => {
        const { mergeAudioChunks } = await import('@/services/tts/tts-audio-merger');
        const chunk1 = createWavChunk(24000, 100);
        const chunk2 = createWavChunk(16000, 100); // 不同采样率
        const result = mergeAudioChunks([chunk1, chunk2]);

        // 只有 chunk1 的数据
        expect(result.byteLength).toBe(44 + 100);
    });
});
