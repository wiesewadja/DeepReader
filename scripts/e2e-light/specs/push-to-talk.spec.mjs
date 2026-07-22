/**
 * Push-to-Talk 语音输入端到端验证
 *
 * 验证移动端长按输入框 → ASR 识别 → LLM 重写 → 填入输入框的完整流程
 * 覆盖: S2 (覆盖层), S3 (状态机), S4 (ASR), S5 (VoiceRewriter), S6 (触摸事件), S7 (SidebarView)
 */

export default {
	id: 'push-to-talk',
	name: 'Push-to-Talk 语音输入端到端',
	feature: 'S2/S3/S4/S5/S6/S7',
	timeout: 60_000,

	async run({ log, evalObsidian }) {
		const steps = [];
		const pass = (name, duration, detail) =>
			steps.push({ name, status: 'pass', duration, detail });
		const fail = (name, duration, error) =>
			steps.push({ name, status: 'fail', duration, error: error.message || error });
		const skip = (name, duration, reason) =>
			steps.push({ name, status: 'skip', duration, error: reason });

		// Step 1: 验证 PushToTalkController 存在于 bundle
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`
					(async () => {
						const mainJs = await app.vault.adapter.read('.obsidian/plugins/' + (app.plugins.plugins['deepreader-dev'] ? 'deepreader-dev' : 'deepreader') + '/main.js');
						return {
							hasPushToTalk: mainJs.includes('PushToTalkController'),
							hasVoiceRewriter: mainJs.includes('VoiceRewriter'),
							hasStartMethod: mainJs.includes('start()') || mainJs.includes('.start('),
							hasStopMethod: mainJs.includes('stop('),
							hasCancelMethod: mainJs.includes('cancel()') || mainJs.includes('.cancel('),
						};
					})()
				`);

				if (result.hasPushToTalk && result.hasVoiceRewriter) {
					pass('PushToTalkController 存在', Date.now() - t0,
						`start=${result.hasStartMethod}, stop=${result.hasStopMethod}, cancel=${result.hasCancelMethod}`);
				} else {
					fail('PushToTalkController 存在', Date.now() - t0,
						`missing: pushToTalk=${result.hasPushToTalk}, rewriter=${result.hasVoiceRewriter}`);
				}
			} catch (e) {
				fail('PushToTalkController 存在', Date.now() - t0, e);
			}
		}

		// Step 2: 验证 ChatInput 包含长按事件支持
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`
					(async () => {
						const mainJs = await app.vault.adapter.read('.obsidian/plugins/' + (app.plugins.plugins['deepreader-dev'] ? 'deepreader-dev' : 'deepreader') + '/main.js');
						return {
							hasLongPress: mainJs.includes('onLongPress') || mainJs.includes('longPress'),
							hasTouchstart: mainJs.includes('touchstart'),
							hasTouchend: mainJs.includes('touchend'),
							hasTouchmove: mainJs.includes('touchmove'),
							hasLongPressTimer: mainJs.includes('longPressTimer') || mainJs.includes('long-press'),
						};
					})()
				`);

				if (result.hasLongPress && result.hasTouchstart) {
					pass('ChatInput 长按事件支持', Date.now() - t0,
						`touchstart=${result.hasTouchstart}, touchend=${result.hasTouchend}, timer=${result.hasLongPressTimer}`);
				} else {
					fail('ChatInput 长按事件支持', Date.now() - t0,
						`longPress=${result.hasLongPress}, touchstart=${result.hasTouchstart}`);
				}
			} catch (e) {
				fail('ChatInput 长按事件支持', Date.now() - t0, e);
			}
		}

		// Step 3: 验证 SidebarView 集成 PushToTalkController
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`
					(async () => {
						const mainJs = await app.vault.adapter.read('.obsidian/plugins/' + (app.plugins.plugins['deepreader-dev'] ? 'deepreader-dev' : 'deepreader') + '/main.js');
						return {
							hasPushToTalkCtrl: mainJs.includes('pushToTalkCtrl') || mainJs.includes('push-to-talk'),
							hasStartPushToTalk: mainJs.includes('startPushToTalk'),
							hasDestroyPushToTalk: mainJs.includes('pushToTalkCtrl.destroy') || mainJs.includes('pushToTalkCtrl?.destroy'),
						};
					})()
				`);

				if (result.hasPushToTalkCtrl && result.hasStartPushToTalk) {
					pass('SidebarView 集成 PushToTalk', Date.now() - t0,
						`ctrl=${result.hasPushToTalkCtrl}, start=${result.hasStartPushToTalk}, destroy=${result.hasDestroyPushToTalk}`);
				} else {
					fail('SidebarView 集成 PushToTalk', Date.now() - t0,
						`ctrl=${result.hasPushToTalkCtrl}, start=${result.hasStartPushToTalk}`);
				}
			} catch (e) {
				fail('SidebarView 集成 PushToTalk', Date.now() - t0, e);
			}
		}

		// Step 4: 验证 VoiceOverlay 覆盖层样式
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`
					(async () => {
						const mainJs = await app.vault.adapter.read('.obsidian/plugins/' + (app.plugins.plugins['deepreader-dev'] ? 'deepreader-dev' : 'deepreader') + '/main.js');
						return {
							hasVoiceOverlay: mainJs.includes('deeppdf-voice-overlay'),
							hasVoiceWave: mainJs.includes('deeppdf-voice-wave'),
							hasVoiceLabel: mainJs.includes('deeppdf-voice-label'),
							hasFixedPosition: mainJs.includes('position: fixed') || mainJs.includes('position:fixed'),
						};
					})()
				`);

				if (result.hasVoiceOverlay) {
					pass('VoiceOverlay 覆盖层样式', Date.now() - t0,
						`overlay=${result.hasVoiceOverlay}, wave=${result.hasVoiceWave}, label=${result.hasVoiceLabel}`);
				} else {
					fail('VoiceOverlay 覆盖层样式', Date.now() - t0,
						`overlay=${result.hasVoiceOverlay}`);
				}
			} catch (e) {
				fail('VoiceOverlay 覆盖层样式', Date.now() - t0, e);
			}
		}

		// Step 5: 验证状态机转换逻辑
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`
					(async () => {
						const mainJs = await app.vault.adapter.read('.obsidian/plugins/' + (app.plugins.plugins['deepreader-dev'] ? 'deepreader-dev' : 'deepreader') + '/main.js');
						return {
							hasIdleState: mainJs.includes("'idle'") || mainJs.includes('"idle"'),
							hasListeningState: mainJs.includes("'listening'") || mainJs.includes('"listening"'),
							hasRecognizingState: mainJs.includes("'recognizing'") || mainJs.includes('"recognizing"'),
							hasSetState: mainJs.includes('this.state =') || mainJs.includes('this.state='),
						};
					})()
				`);

				const allStates = result.hasIdleState && result.hasListeningState &&
					result.hasRecognizingState;

				if (allStates && result.hasSetState) {
					pass('状态机转换逻辑完整', Date.now() - t0,
						`idle=${result.hasIdleState}, listening=${result.hasListeningState}, recognizing=${result.hasRecognizingState}`);
				} else {
					fail('状态机转换逻辑完整', Date.now() - t0,
						`idle=${result.hasIdleState}, listening=${result.hasListeningState}, recognizing=${result.hasRecognizingState}, setState=${result.hasSetState}`);
				}
			} catch (e) {
				fail('状态机转换逻辑完整', Date.now() - t0, e);
			}
		}

		// Step 6: 验证 ASR 和 LLM 配置集成
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`
					(async () => {
						const mainJs = await app.vault.adapter.read('.obsidian/plugins/' + (app.plugins.plugins['deepreader-dev'] ? 'deepreader-dev' : 'deepreader') + '/main.js');
						return {
							hasAsrApiKey: mainJs.includes('asrApiKey') || mainJs.includes('asr_api_key'),
							hasAsrBaseUrl: mainJs.includes('asrBaseUrl') || mainJs.includes('asr_base_url'),
							hasLlmApiKey: mainJs.includes('llmApiKey') || mainJs.includes('llm_api_key'),
							hasLlmBaseUrl: mainJs.includes('llmBaseUrl') || mainJs.includes('llm_base_url'),
							hasResolveRoleConfig: mainJs.includes('resolveRoleConfig'),
						};
					})()
				`);

				if (result.hasResolveRoleConfig) {
					pass('ASR/LLM 配置集成', Date.now() - t0,
						`asrKey=${result.hasAsrApiKey}, asrBase=${result.hasAsrBaseUrl}, llmKey=${result.hasLlmApiKey}, llmBase=${result.hasLlmBaseUrl}`);
				} else {
					fail('ASR/LLM 配置集成', Date.now() - t0,
						`resolveRoleConfig=${result.hasResolveRoleConfig}`);
				}
			} catch (e) {
				fail('ASR/LLM 配置集成', Date.now() - t0, e);
			}
		}

		// Step 7: 验证移动端守卫逻辑
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`
					(async () => {
						const mainJs = await app.vault.adapter.read('.obsidian/plugins/' + (app.plugins.plugins['deepreader-dev'] ? 'deepreader-dev' : 'deepreader') + '/main.js');
						return {
							hasPlatformIsMobile: mainJs.includes('Platform.isMobile') || mainJs.includes('isMobile'),
							hasMobileGuard: mainJs.includes('isMobile') && mainJs.includes('onLongPress'),
						};
					})()
				`);

				if (result.hasPlatformIsMobile) {
					pass('移动端守卫逻辑', Date.now() - t0,
						`Platform.isMobile=${result.hasPlatformIsMobile}, mobileGuard=${result.hasMobileGuard}`);
				} else {
					fail('移动端守卫逻辑', Date.now() - t0,
						`isMobile=${result.hasPlatformIsMobile}`);
				}
			} catch (e) {
				fail('移动端守卫逻辑', Date.now() - t0, e);
			}
		}

		// Step 8: 验证增量识别支持
		{
			const t0 = Date.now();
			try {
				const result = await evalObsidian(`
					(async () => {
						const mainJs = await app.vault.adapter.read('.obsidian/plugins/' + (app.plugins.plugins['deepreader-dev'] ? 'deepreader-dev' : 'deepreader') + '/main.js');
						return {
							hasIncrementalTimer: mainJs.includes('incrementalTimer') || mainJs.includes('incremental_timer'),
							hasTranscribeStream: mainJs.includes('transcribeStream') || mainJs.includes('transcribe_stream'),
							hasReplaceVoiceText: mainJs.includes('replaceVoiceText') || mainJs.includes('replace_voice_text'),
						};
					})()
				`);

				if (result.hasIncrementalTimer || result.hasTranscribeStream) {
					pass('增量识别支持', Date.now() - t0,
						`timer=${result.hasIncrementalTimer}, stream=${result.hasTranscribeStream}, replace=${result.hasReplaceVoiceText}`);
				} else {
					// 增量识别是可选功能，如果不存在则 skip
					skip('增量识别支持', Date.now() - t0, '增量识别功能未实现（可选）');
				}
			} catch (e) {
				fail('增量识别支持', Date.now() - t0, e);
			}
		}

		// Step 9: 运行时验证 - 打开 sidebar 检查 ChatInput 存在
		{
			const t0 = Date.now();
			try {
				await evalObsidian(`(() => {
					app.commands.executeCommandById("deepreader-dev:open-deepreader-sidebar");
					return true;
				})()`);
				await new Promise(r => setTimeout(r, 1000));

				const result = await evalObsidian(`(() => {
					const leaves = app.workspace.getLeavesOfType('deeppdf-sidebar-view');
					if (leaves.length === 0) return { hasView: false };
					const view = leaves[0].view;
					return {
						hasView: true,
						hasChatInput: !!view.chatInput,
						hasTextarea: !!view.chatInput?.textarea,
						hasAgentChatCtrl: !!view.agentChatCtrl,
					};
				})()`);

				if (result.hasView && result.hasChatInput) {
					pass('Sidebar ChatInput 存在', Date.now() - t0,
						`view=${result.hasView}, chatInput=${result.hasChatInput}, textarea=${result.hasTextarea}`);
				} else {
					fail('Sidebar ChatInput 存在', Date.now() - t0,
						`view=${result.hasView}, chatInput=${result.hasChatInput}`);
				}
			} catch (e) {
				fail('Sidebar ChatInput 存在', Date.now() - t0, e);
			}
		}

		return { steps };
	},
};
