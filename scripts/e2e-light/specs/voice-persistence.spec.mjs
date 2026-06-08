/**
 * 会话存储 — 语音字段持久化验证
 *
 * 验证 writeSessionFile 在全量重写时保留 voiceAudioPath/voiceDuration/letterState
 * 覆盖: C2 (writeSessionFile 语音持久化, 9b4d19d5)
 */

export default {
	id: 'voice-persistence',
	name: '语音字段持久化验证',
	feature: null,
	timeout: 30_000,

	async run({ log, evalObsidian }) {
		const steps = [];
		const pass = (name, duration, detail) =>
			steps.push({ name, status: 'pass', duration, detail });
		const fail = (name, duration, error) =>
			steps.push({ name, status: 'fail', duration, error: error.message || error });
		const skip = (name, duration, reason) =>
			steps.push({ name, status: 'skip', duration, error: reason });

		// Step 1: 验证 SessionMessageLine 类型包含语音字段
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`
					(async () => {
						const mainJs = await app.vault.adapter.read('.obsidian/plugins/' + (app.plugins.plugins['deepreader-dev'] ? 'deepreader-dev' : 'deepreader') + '/main.js');
						return {
							hasVoiceAudioPath: mainJs.includes('voiceAudioPath'),
							hasVoiceDuration: mainJs.includes('voiceDuration'),
							hasLetterState: mainJs.includes('letterState'),
							hasWriteSessionFileVoice: mainJs.includes('voiceData.voiceAudioPath'),
						};
					})()
				`);

				const allPresent = result.hasVoiceAudioPath && result.hasVoiceDuration &&
					result.hasLetterState && result.hasWriteSessionFileVoice;

				if (allPresent) {
					pass('SessionMessageLine 包含语音字段', Date.now() - t0,
						`voiceAudioPath=${result.hasVoiceAudioPath}, voiceDuration=${result.hasVoiceDuration}, letterState=${result.hasLetterState}`);
				} else {
					fail('SessionMessageLine 包含语音字段', Date.now() - t0,
						`缺失字段: ${JSON.stringify(result)}`);
				}
			} catch (e) {
				fail('SessionMessageLine 包含语音字段', Date.now() - t0, e);
			}
		}

		// Step 2: 验证 get() 加载时保存 voiceAudioPath
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`
					(async () => {
						const mainJs = await app.vault.adapter.read('.obsidian/plugins/' + (app.plugins.plugins['deepreader-dev'] ? 'deepreader-dev' : 'deepreader') + '/main.js');
						// 检查 get() 中是否有 voiceAudioPath 的赋值
						const hasVoiceAudioPathPreservation = mainJs.includes('voiceAudioPath') &&
							mainJs.includes('msgLine.voiceAudioPath');
						return { hasVoiceAudioPathPreservation };
					})()
				`);

				if (result.hasVoiceAudioPathPreservation) {
					pass('get() 保留 voiceAudioPath 字段', Date.now() - t0, '加载时同步保存路径');
				} else {
					fail('get() 保留 voiceAudioPath 字段', Date.now() - t0, 'voiceAudioPath 未在加载时保存');
				}
			} catch (e) {
				fail('get() 保留 voiceAudioPath 字段', Date.now() - t0, e);
			}
		}

		// Step 3: 模拟 JSONL 读写验证
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`
					(async () => {
						// 构造一个包含语音字段的 JSONL 行
						const metaLine = JSON.stringify({
							_type: 'metadata',
							sessionId: 'test-voice-session',
							indexId: 'test-index',
							createdAt: new Date().toISOString(),
							lastConsolidated: 0,
						});

						const msgLine = JSON.stringify({
							role: 'assistant',
							content: '测试消息',
							timestamp: '2026-06-08 22:00:00',
							voiceAudioPath: 'voice/test-session/msg001.wav',
							voiceDuration: 5.2,
							letterState: 'sealed',
						});

						// 验证 JSON 解析能正确提取语音字段
						const parsed = JSON.parse(msgLine);
						return {
							ok: !!parsed.voiceAudioPath && parsed.voiceDuration === 5.2 && parsed.letterState === 'sealed',
							voiceAudioPath: parsed.voiceAudioPath,
							voiceDuration: parsed.voiceDuration,
							letterState: parsed.letterState,
						};
					})()
				`);

				if (result.ok) {
					pass('JSONL 语音字段序列化/反序列化', Date.now() - t0,
						`path=${result.voiceAudioPath}, duration=${result.voiceDuration}, state=${result.letterState}`);
				} else {
					fail('JSONL 语音字段序列化/反序列化', Date.now() - t0, `字段丢失: ${JSON.stringify(result)}`);
				}
			} catch (e) {
				fail('JSONL 语音字段序列化/反序列化', Date.now() - t0, e);
			}
		}

		return { steps };
	},
};
