export interface WavParams {
	sampleRate: number;
	channels: number;
}

/**
 * 将 PCM16 原始音频数据编码为 WAV 格式
 */
export function encodeWav(pcmBuffer: ArrayBuffer, params: WavParams): Uint8Array {
	const { sampleRate, channels } = params;
	const bitsPerSample = 16;
	const byteRate = sampleRate * channels * bitsPerSample / 8;
	const blockAlign = channels * bitsPerSample / 8;
	const dataLength = pcmBuffer.byteLength;
	const headerLength = 44;

	const buffer = new ArrayBuffer(headerLength + dataLength);
	const view = new DataView(buffer);

	// RIFF header
	writeString(view, 0, 'RIFF');
	view.setUint32(4, buffer.byteLength - 8, true);
	writeString(view, 8, 'WAVE');

	// fmt subchunk
	writeString(view, 12, 'fmt ');
	view.setUint32(16, 16, true); // subchunk size
	view.setUint16(20, 1, true); // PCM format
	view.setUint16(22, channels, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, byteRate, true);
	view.setUint16(32, blockAlign, true);
	view.setUint16(34, bitsPerSample, true);

	// data subchunk
	writeString(view, 36, 'data');
	view.setUint32(40, dataLength, true);

	// PCM data
	if (dataLength > 0) {
		new Uint8Array(buffer, headerLength).set(new Uint8Array(pcmBuffer));
	}

	return new Uint8Array(buffer);
}

function writeString(view: DataView, offset: number, str: string): void {
	for (let i = 0; i < str.length; i++) {
		view.setUint8(offset + i, str.charCodeAt(i));
	}
}
