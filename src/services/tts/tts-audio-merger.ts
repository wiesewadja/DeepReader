import { serviceLog } from '../../utils/logger.js';

const WAV_HEADER_SIZE = 44;

/**
 * 合并多个 WAV 音频片段为完整音频
 * 所有片段必须是相同格式：16bit mono 24000Hz
 */
export function mergeAudioChunks(chunks: ArrayBuffer[]): ArrayBuffer {
    if (chunks.length === 0) {
        throw new Error('No audio chunks to merge');
    }
    if (chunks.length === 1) {
        return chunks[0];
    }

    // 验证所有片段格式一致
    const firstView = new DataView(chunks[0]);
    const sampleRate = firstView.getUint32(24, true);
    const bitsPerSample = firstView.getUint16(34, true);
    const numChannels = firstView.getUint16(22, true);

    // 收集所有 PCM 数据
    const pcmChunks: ArrayBuffer[] = [];
    for (const chunk of chunks) {
        const view = new DataView(chunk);
        const chunkSampleRate = view.getUint32(24, true);
        const chunkBits = view.getUint16(34, true);
        const chunkChannels = view.getUint16(22, true);

        if (chunkSampleRate !== sampleRate || chunkBits !== bitsPerSample || chunkChannels !== numChannels) {
            serviceLog.warn('[TTS] Audio format mismatch, skipping chunk');
            continue;
        }

        const pcmData = chunk.slice(WAV_HEADER_SIZE);
        pcmChunks.push(pcmData);
    }

    if (pcmChunks.length === 0) {
        return chunks[0];
    }

    const totalPcmSize = pcmChunks.reduce((sum, c) => sum + c.byteLength, 0);

    const bytesPerSample = bitsPerSample / 8;
    const blockAlign = numChannels * bytesPerSample;
    const dataSize = totalPcmSize;
    const fileSize = WAV_HEADER_SIZE + dataSize;

    const buffer = new ArrayBuffer(fileSize);
    const view = new DataView(buffer);

    writeString(view, 0, 'RIFF');
    view.setUint32(4, fileSize - 8, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    let offset = WAV_HEADER_SIZE;
    for (const pcm of pcmChunks) {
        const uint8 = new Uint8Array(buffer, offset, pcm.byteLength);
        uint8.set(new Uint8Array(pcm));
        offset += pcm.byteLength;
    }

    return buffer;
}

function writeString(view: DataView, offset: number, str: string): void {
    for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
    }
}
