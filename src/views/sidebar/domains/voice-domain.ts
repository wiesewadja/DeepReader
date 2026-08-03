/**
 * VoiceDomain
 *
 * 语音输入（Push-to-Talk）控制器。封装 PushToTalkController 的创建与生命周期，
 * 把 ASR/LLM 配置解析、书籍上下文注入等业务逻辑从 SidebarView 中剥离。
 */

import { Notice } from "obsidian";
import { resolveRoleConfig } from "../../../config/providers.js";
import { PushToTalkController } from "../../../services/push-to-talk.js";
import type { BookContext } from "../../../services/voice-rewriter.js";
import type { ChatInput } from "../../../components/chat-input/chat-input.js";
import type { DeepReaderPluginInterface } from "../../../agent/tools/context/vault.js";
import type { BookDomain } from "./book-domain.js";

export interface VoiceDomainOptions {
	plugin: DeepReaderPluginInterface;
	getChatInput: () => ChatInput | null;
	bookDomain: BookDomain;
}

export class VoiceDomain {
	private plugin: DeepReaderPluginInterface;
	private getChatInput: () => ChatInput | null;
	private bookDomain: BookDomain;
	private pushToTalkCtrl: PushToTalkController | null = null;

	constructor(options: VoiceDomainOptions) {
		this.plugin = options.plugin;
		this.getChatInput = options.getChatInput;
		this.bookDomain = options.bookDomain;
	}

	/** 配置就绪则返回（需要 tts + chat 双角色 API Key），否则 null */
	private configsReady() {
		const ttsConfig = resolveRoleConfig("tts", this.plugin.settings);
		const chatConfig = resolveRoleConfig("chat", this.plugin.settings);
		return ttsConfig && chatConfig ? { ttsConfig, chatConfig } : null;
	}

	/**
	 * 懒创建 PushToTalkController。配置/ChatInput 未就绪返回 null。
	 * 状态与文本由 PushToTalkController 内部直接驱动 ChatInput（setVoiceState/setValue），
	 * 这里只外发 onError。
	 */
	private ensureController(): PushToTalkController | null {
		const chatInput = this.getChatInput();
		const configs = this.configsReady();
		if (!chatInput || !configs) return null;
		if (!this.pushToTalkCtrl) {
			this.pushToTalkCtrl = new PushToTalkController(
				chatInput,
				{
					asrApiKey: configs.ttsConfig.apiKey,
					asrBaseUrl: configs.ttsConfig.baseUrl,
					llmApiKey: configs.chatConfig.apiKey,
					llmBaseUrl: configs.chatConfig.baseUrl,
				},
				{
					onError: (error) => {
						new Notice(`语音输入失败: ${error.message}`);
					},
				},
			);
		}
		return this.pushToTalkCtrl;
	}

	/** 构建语音重写所需的书籍上下文（无当前书返回 undefined） */
	private buildBookContext(): BookContext | undefined {
		const info = this.bookDomain.getCurrentBookInfo();
		return info
			? {
					title: info.title || "未知书籍",
					description: info.docDescription || undefined,
				}
			: undefined;
	}

	/** 移动端长按触发 Push-to-Talk，开始语音录音 */
	startVoiceRecording(): void {
		this.ensureController()?.start();
	}

	/** 停止语音录音并识别发送 */
	stopVoiceRecording(): void {
		this.pushToTalkCtrl?.stop(this.buildBookContext());
	}

	/** 取消语音录音（直接丢弃，不做识别） */
	cancelVoiceRecording(): void {
		this.pushToTalkCtrl?.cancel();
	}

	/**
	 * 长按时 start 录音，touchend 时 stop 识别+重写
	 * （长按说话入口，绑定在 textarea 的 touchstart/touchend 上）
	 */
	startPushToTalk(): void {
		const ctrl = this.ensureController();
		if (!ctrl) return;
		ctrl.start();

		// 监听 touchend 触发 stop
		const textarea = this.getChatInput()?.getElement()?.querySelector("textarea");
		if (textarea) {
			const handleTouchEnd = () => {
				textarea.removeEventListener("touchend", handleTouchEnd);
				this.pushToTalkCtrl?.stop(this.buildBookContext());
			};
			textarea.addEventListener("touchend", handleTouchEnd, { once: true });
		}
	}

	destroy(): void {
		if (this.pushToTalkCtrl) {
			try {
				this.pushToTalkCtrl.destroy();
			} catch {
				// 忽略清理异常
			}
			this.pushToTalkCtrl = null;
		}
	}
}
