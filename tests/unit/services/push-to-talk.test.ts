import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PushToTalkController } from '../../../src/services/push-to-talk.js';

vi.mock('../../../src/services/asr/audio-recorder.js', () => ({
	AudioRecorder: vi.fn().mockImplementation(() => ({
		start: vi.fn().mockResolvedValue(undefined),
		stop: vi.fn().mockResolvedValue({ audioBase64: 'audio', mimeType: 'audio/wav', duration: 5 }),
		getAccumulatedAudio: vi.fn().mockResolvedValue({ audioBase64: 'audio', mimeType: 'audio/wav' }),
		cancel: vi.fn(),
		destroy: vi.fn(),
	})),
}));

vi.mock('../../../src/services/asr/asr-client.js', () => ({
	ASRClient: vi.fn().mockImplementation(() => ({
		transcribe: vi.fn().mockResolvedValue('识别的文字'),
		transcribeStream: vi.fn().mockImplementation(async function* () {
			yield '识别';
			yield '的文字';
		}),
	})),
}));

vi.mock('../../../src/services/voice-rewriter.js', () => ({
	VoiceRewriter: vi.fn().mockImplementation(() => ({
		rewrite: vi.fn().mockImplementation(async function* () {
			yield '优化';
			yield '后的书面语';
		}),
	})),
}));

describe('PushToTalkController', () => {
	let controller: PushToTalkController;
	let mockChatInput: any;
	let callbacks: any;

	beforeEach(() => {
		vi.useFakeTimers();
		mockChatInput = {
			setVoiceState: vi.fn(),
			replaceVoiceText: vi.fn(),
			setValue: vi.fn(),
		};
		callbacks = {
			onStateChange: vi.fn(),
			onTextReady: vi.fn(),
			onError: vi.fn(),
		};
		controller = new PushToTalkController(
			mockChatInput,
			{
				asrApiKey: 'asr-key',
				asrBaseUrl: 'https://asr.test.com',
				llmApiKey: 'llm-key',
				llmBaseUrl: 'https://llm.test.com',
			},
			callbacks,
		);
	});

	afterEach(() => {
		vi.useRealTimers();
		controller.destroy();
	});

	it('start 进入 listening 状态并开始录音', async () => {
		await controller.start();
		expect(controller.getState()).toBe('listening');
		expect(mockChatInput.setVoiceState).toHaveBeenCalledWith('recording');
	});

	it('stop 进入 recognizing → rewriting → done → idle', async () => {
		await controller.start();
		await controller.stop({ title: '测试书籍' });

		expect(controller.getState()).toBe('idle');
		expect(mockChatInput.setValue).toHaveBeenCalledWith('优化后的书面语');
		expect(callbacks.onTextReady).toHaveBeenCalledWith('优化后的书面语');
	});

	it('cancel 取消录音并回到 idle', async () => {
		await controller.start();
		controller.cancel();
		expect(controller.getState()).toBe('idle');
	});

	it('非 idle 状态下 start 无效', async () => {
		await controller.start();
		await controller.start();
		expect(controller.getState()).toBe('listening');
	});

	it('stop 在非 listening 状态下无效', async () => {
		await controller.start();
		controller.cancel();
		vi.clearAllMocks();

		await controller.stop();
		expect(callbacks.onStateChange).not.toHaveBeenCalled();
	});

	it('cancel 停止递增识别计时器', async () => {
		await controller.start();
		vi.advanceTimersByTime(1000);
		controller.cancel();
		vi.advanceTimersByTime(3000);

		expect(mockChatInput.replaceVoiceText).not.toHaveBeenCalled();
	});

	it('destroy 清理所有资源', async () => {
		await controller.start();
		controller.destroy();
		expect(controller.getState()).toBe('idle');
	});
});
