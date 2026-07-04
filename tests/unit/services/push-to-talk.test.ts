import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PushToTalkController } from '../../../src/services/push-to-talk.js';

// 共享 mock：暴露各依赖方法，便于在用例里控制返回值与时序（如让 transcribe pending）
const mocks = vi.hoisted(() => {
	const recorderStart = vi.fn();
	const recorderStop = vi.fn();
	const getAccumulatedAudio = vi.fn();
	const recorderCancel = vi.fn();
	const recorderDestroy = vi.fn();
	const transcribe = vi.fn();
	const transcribeStream = vi.fn();
	const rewrite = vi.fn();
	return {
		recorderStart,
		recorderStop,
		getAccumulatedAudio,
		recorderCancel,
		recorderDestroy,
		transcribe,
		transcribeStream,
		rewrite,
	};
});

vi.mock('../../../src/services/asr/audio-recorder.js', () => ({
	AudioRecorder: vi.fn().mockImplementation(() => ({
		start: mocks.recorderStart,
		stop: mocks.recorderStop,
		getAccumulatedAudio: mocks.getAccumulatedAudio,
		cancel: mocks.recorderCancel,
		destroy: mocks.recorderDestroy,
	})),
}));

vi.mock('../../../src/services/asr/asr-client.js', () => ({
	ASRClient: vi.fn().mockImplementation(() => ({
		transcribe: mocks.transcribe,
		transcribeStream: mocks.transcribeStream,
	})),
}));

vi.mock('../../../src/services/voice-rewriter.js', () => ({
	VoiceRewriter: vi.fn().mockImplementation(() => ({
		rewrite: mocks.rewrite,
	})),
}));

describe('PushToTalkController', () => {
	let controller: PushToTalkController;
	let mockChatInput: any;
	let callbacks: any;

	beforeEach(() => {
		vi.useFakeTimers();

		// 重置默认行为
		mocks.recorderStart.mockResolvedValue(undefined);
		mocks.recorderStop.mockResolvedValue({ audioBase64: 'audio', mimeType: 'audio/wav', duration: 5 });
		mocks.getAccumulatedAudio.mockResolvedValue({ audioBase64: 'audio', mimeType: 'audio/wav' });
		mocks.recorderCancel.mockReset();
		mocks.recorderDestroy.mockReset();
		mocks.transcribe.mockResolvedValue('识别的文字');
		mocks.transcribeStream.mockImplementation(async function* () {
			yield '识别';
			yield '的文字';
		});
		mocks.rewrite.mockImplementation(async function* () {
			yield '优化';
			yield '后的书面语';
		});

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

	it('stop 进入 recognizing → done → idle', async () => {
		await controller.start();
		await controller.stop({ title: '测试书籍' });

		expect(controller.getState()).toBe('idle');
		expect(mockChatInput.setValue).toHaveBeenCalledWith('识别的文字');
		expect(callbacks.onTextReady).toHaveBeenCalledWith('识别的文字');
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

	it('cancel 后重新 start 能正常完成（cancelled 标志不残留）', async () => {
		await controller.start();
		controller.cancel(); // 模拟录音中上滑取消
		await controller.stop(); // 松手触发 stop，但 state 已 idle → 直接返回（与 sidebar 行为一致）

		// 再次录音 + 识别，不应被上一次的 cancel 误杀
		await controller.start();
		await controller.stop({ title: '测试书籍' });

		expect(controller.getState()).toBe('idle');
		expect(mockChatInput.setValue).toHaveBeenLastCalledWith('识别的文字');
	});

	it('stop 进行中 cancel 提前返回，不写入识别结果', async () => {
		// 让 transcribe 返回 pending，模拟 recognizing 阶段阻塞
		let resolveTranscribe!: (v: string) => void;
		mocks.transcribe.mockReturnValueOnce(
			new Promise<string>((r) => {
				resolveTranscribe = r;
			}),
		);

		await controller.start();
		const stopPromise = controller.stop({ title: '测试书籍' });
		// 推进微任务，让 stop 执行到 await transcribe 并挂起
		await Promise.resolve();
		await Promise.resolve();

		// 在 recognizing 阶段取消
		controller.cancel();

		// 放行 transcribe，验证识别结果被丢弃而非写入
		resolveTranscribe('识别的文字');
		await stopPromise;

		expect(controller.getState()).toBe('idle');
		expect(mockChatInput.setValue).not.toHaveBeenCalledWith('识别的文字');
		expect(callbacks.onTextReady).not.toHaveBeenCalled();
	});
});
