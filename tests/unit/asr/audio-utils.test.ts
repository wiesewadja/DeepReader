import { describe, it, expect } from 'vitest';
import { encodeWav, type WavParams } from '@/services/asr/audio-utils';

describe('encodeWav', () => {
	it('creates a valid WAV header for mono PCM16 data', () => {
		// Create 100 samples of silence (16-bit mono, 16000 Hz)
		const pcmData = new Int16Array(100);
		const wav = encodeWav(pcmData.buffer, { sampleRate: 16000, channels: 1 });

		// RIFF header
		expect(wav.slice(0, 4)).toEqual(new Uint8Array([0x52, 0x49, 0x46, 0x46])); // "RIFF"

		// File size - 8 (little-endian uint32)
		const fileSize = new DataView(wav.buffer).getUint32(4, true);
		expect(fileSize).toBe(wav.byteLength - 8);

		// WAVE marker
		expect(wav.slice(8, 12)).toEqual(new Uint8Array([0x57, 0x41, 0x56, 0x45])); // "WAVE"

		// fmt subchunk
		expect(wav.slice(12, 16)).toEqual(new Uint8Array([0x66, 0x6d, 0x74, 0x20])); // "fmt "

		// Bits per sample = 16
		const bitsPerSample = new DataView(wav.buffer).getUint16(34, true);
		expect(bitsPerSample).toBe(16);

		// Channels = 1
		const channels = new DataView(wav.buffer).getUint16(22, true);
		expect(channels).toBe(1);

		// Sample rate = 16000
		const sampleRate = new DataView(wav.buffer).getUint32(24, true);
		expect(sampleRate).toBe(16000);

		// Data subchunk
		expect(wav.slice(36, 40)).toEqual(new Uint8Array([0x64, 0x61, 0x74, 0x61])); // "data"

		// Data size
		const dataSize = new DataView(wav.buffer).getUint32(40, true);
		expect(dataSize).toBe(200); // 100 samples * 2 bytes
	});

	it('creates a valid WAV for stereo data', () => {
		const pcmData = new Int16Array(200); // 100 stereo frames
		const wav = encodeWav(pcmData.buffer, { sampleRate: 44100, channels: 2 });

		const channels = new DataView(wav.buffer).getUint16(22, true);
		expect(channels).toBe(2);

		const sampleRate = new DataView(wav.buffer).getUint32(24, true);
		expect(sampleRate).toBe(44100);

		const byteRate = new DataView(wav.buffer).getUint32(28, true);
		expect(byteRate).toBe(44100 * 2 * 16 / 8); // sampleRate * channels * bitsPerSample / 8

		const dataSize = new DataView(wav.buffer).getUint32(40, true);
		expect(dataSize).toBe(400); // 200 samples * 2 bytes
	});

	it('preserves PCM data in the output', () => {
		const pcmData = new Int16Array([1000, -2000, 30000, -32768, 32767]);
		const wav = encodeWav(pcmData.buffer, { sampleRate: 16000, channels: 1 });

		// Data starts at offset 44
		const resultView = new Int16Array(wav.buffer, 44);
		expect(resultView[0]).toBe(1000);
		expect(resultView[1]).toBe(-2000);
		expect(resultView[2]).toBe(30000);
		expect(resultView[3]).toBe(-32768);
		expect(resultView[4]).toBe(32767);
	});

	it('handles empty PCM data', () => {
		const pcmData = new Int16Array(0);
		const wav = encodeWav(pcmData.buffer, { sampleRate: 16000, channels: 1 });

		// Should still have valid header
		expect(wav.slice(0, 4)).toEqual(new Uint8Array([0x52, 0x49, 0x46, 0x46])); // "RIFF"
		const dataSize = new DataView(wav.buffer).getUint32(40, true);
		expect(dataSize).toBe(0);
		expect(wav.byteLength).toBe(44); // header only
	});
});
