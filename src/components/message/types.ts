/**
 * Message 组件类型定义
 */

/** 消息角色类型 */
export type MessageRole = 'user' | 'assistant';

/** Agent 工具调用数据结构 */
export interface AgentToolCall {
	/** 工具名称 */
	name: string;
	/** 工具参数 */
	args: string;
	/** 执行状态 */
	status: 'pending' | 'success' | 'error';
	/** 执行结果 */
	result?: string;
}

/** Agent 思考过程数据结构 */
export interface AgentThought {
	/** 思考内容 */
	content: string;
	/** 步骤编号 */
	step?: number;
}

/** 消息数据结构 */
export interface MessageData {
	/** 消息唯一标识 */
	id: string;
	/** 消息角色（用户或 AI） */
	role: MessageRole;
	/** 消息内容（纯文本或 Markdown） */
	content: string;
	/** 时间戳 */
	timestamp: string;
	/** 可选：是否正在生成 */
	isStreaming?: boolean;
	/** 可选：是否为 Agent 消息 */
	isAgentMessage?: boolean;
	/** 可选：Agent 思考过程 */
	agentThoughts?: AgentThought[];
	/** 可选：Agent 工具调用列表 */
	agentToolCalls?: AgentToolCall[];
	/** 可选：当前状态文本（如"正在搜索..."） */
	currentStatus?: string;
	/** 可选：当前阅读层次 */
	readingLevel?: 'elementary' | 'inspectional' | 'analytical' | 'syntopical' | 'skill';
	/** 可选：已完成步骤列表 */
	completedSteps?: string[];
	/** 可选：关联的 PDF 文件名 */
	pdfName?: string;
	/**
	 * 可选：用户引用内容（完整 QuoteItem[]，含 blockId/nodeId/sourcePath）
	 * 持久化到 JSONL 时会过滤掉运行时字段（range/messageId）
	 */
	quotes?: Array<{
		id?: string;
		text: string;
		source?: string;
		sourcePath?: string;
		blockId?: string;
		nodeId?: string;
		heading?: string;
		headingPath?: string[];
		page?: number;
	}>;
	/** 可选：关联的页码 */
	page?: number;
	/** 可选：关联的用户问题 */
	question?: string;
	/** 可选：对话 ID */
	conversationId?: string;
	/** 可选：是否隐藏（用于画像更新消息，不显示但发送给 LLM） */
	hidden?: boolean;
	/** 可选：书籍封面 URL（用于最大化展示） */
	bookCoverUrl?: string;
	/** 可选：书籍作者（用于最大化展示） */
	bookAuthor?: string;
	// 语音对话气泡
	voiceAudio?: ArrayBuffer;
	voiceDuration?: number;  // 秒
	voiceState?: 'loading' | 'ready' | 'playing' | 'paused' | 'ended';
	// 信封状态
	letterState?: 'sealing' | 'sealed' | 'opened';
	// 语音对话模式开关（由 sidebar-view 根据设置传入）
	enableVoiceReply?: boolean;
	/** 可选：是否为主动阅读引导消息 */
	isProactiveGuidance?: boolean;
}
