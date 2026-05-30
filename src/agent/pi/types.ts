/**
 * PI Agent RPC 集成类型定义
 */

// ─── 进程状态 ───

export enum PiProcessState {
	STOPPED = 'STOPPED',
	STARTING = 'STARTING',
	READY = 'READY',
	BUSY = 'BUSY',
	ERROR = 'ERROR',
}

// ─── PI 配置 ───

export interface PiConfig {
	apiKey: string;
	model: string;
	provider: string;
	skillsDir: string;
	sessionDir: string;
	exportsDir: string;
	workingDir: string;
	customPiPath?: string;
}

// ─── 上下文传递 ───

export interface PiSkillContext {
	book: {
		title: string;
		author: string;
	};
	context: {
		currentSection: string;
		analysisSummary: string;
		analysisData?: string;
		structuralAnalysis?: string;
		tocSummary?: string;
	};
	skillDescriptions: string[];
	outputPath: string;
	userRequest: string;
}

// ─── RPC 命令（stdin → PI）───

export interface PiPromptCommand {
	type: 'prompt';
	message: string;
	id?: string;
}

export interface PiNewSessionCommand {
	type: 'new_session';
	id?: string;
}

export interface PiAbortCommand {
	type: 'abort';
	id?: string;
}

export interface PiGetCommandsCommand {
	type: 'get_commands';
	id?: string;
}

export interface PiSetAutoRetryCommand {
	type: 'set_auto_retry';
	enabled: boolean;
	id?: string;
}

export interface PiAbortRetryCommand {
	type: 'abort_retry';
	id?: string;
}

export interface PiExtensionUiResponseCommand {
	type: 'extension_ui_response';
	id: string;
	value?: string;
	confirmed?: boolean;
	cancelled?: boolean;
}

export interface PiGetSessionStatsCommand {
	type: 'get_session_stats';
	id?: string;
}

export interface PiCompactCommand {
	type: 'compact';
	customInstructions?: string;
	id?: string;
}

export interface PiGetStateCommand {
	type: 'get_state';
	id?: string;
}

export interface PiSetAutoCompactionCommand {
	type: 'set_auto_compaction';
	enabled: boolean;
	id?: string;
}

export interface PiSteerCommand {
	type: 'steer';
	message: string;
	id?: string;
}

export interface PiFollowUpCommand {
	type: 'follow_up';
	message: string;
	id?: string;
}

export type PiCommand =
	| PiPromptCommand
	| PiNewSessionCommand
	| PiAbortCommand
	| PiGetCommandsCommand
	| PiSetAutoRetryCommand
	| PiAbortRetryCommand
	| PiExtensionUiResponseCommand
	| PiGetSessionStatsCommand
	| PiCompactCommand
	| PiGetStateCommand
	| PiSetAutoCompactionCommand
	| PiSteerCommand
	| PiFollowUpCommand;

// ─── RPC 事件（PI → stdout）───

export interface PiResponseEvent {
	type: 'response';
	command: string;
	success: boolean;
	error?: string;
	id?: string;
	data?: unknown;
}

export interface PiAgentStartEvent {
	type: 'agent_start';
}

export interface PiAgentEndEvent {
	type: 'agent_end';
	messages?: Array<{
		role: string;
		content?: Array<{
			type: string;
			text?: string;
			thinking?: string;
		}>;
	}>;
}

export interface PiMessageUpdateEvent {
	type: 'message_update';
	assistantMessageEvent?: {
		type: string;
		delta?: string;
		content?: string;
		contentIndex?: number;
	};
	message?: unknown;
}

export interface PiToolExecutionStartEvent {
	type: 'tool_execution_start';
	toolName: string;
	args?: Record<string, unknown>;
}

export interface PiToolExecutionEndEvent {
	type: 'tool_execution_end';
	toolName: string;
	isError: boolean;
	result?: {
		content?: Array<{ type: string; text?: string }>;
	};
}

export interface PiQueueUpdateEvent {
	type: 'queue_update';
}

export interface PiExtensionErrorEvent {
	type: 'extension_error';
	error?: string;
}

// ─── 流式事件（RPC v2）───

export interface PiTurnStartEvent {
	type: 'turn_start';
}

export interface PiTurnEndEvent {
	type: 'turn_end';
	message: unknown;
	toolResults: unknown[];
}

export interface PiMessageStartEvent {
	type: 'message_start';
	message: unknown;
}

export interface PiMessageEndEvent {
	type: 'message_end';
	message: unknown;
}

export interface PiToolExecutionUpdateEvent {
	type: 'tool_execution_update';
	toolCallId: string;
	toolName: string;
	args?: Record<string, unknown>;
	partialResult: { content: Array<{ type: string; text?: string }>; details: unknown };
}

export interface PiAutoRetryStartEvent {
	type: 'auto_retry_start';
	attempt: number;
	maxAttempts: number;
	delayMs: number;
	errorMessage: string;
}

export interface PiAutoRetryEndEvent {
	type: 'auto_retry_end';
	success: boolean;
	attempt: number;
	finalError?: string;
}

// ─── Extension UI 事件 ───

export type PiExtensionUiMethod =
	| 'select' | 'confirm' | 'input' | 'editor'
	| 'notify' | 'setStatus' | 'setWidget' | 'setTitle' | 'set_editor_text';

export interface PiExtensionUiRequestEvent {
	type: 'extension_ui_request';
	id: string;
	method: PiExtensionUiMethod;
	title?: string;
	message?: string;
	options?: string[];
	placeholder?: string;
	prefill?: string;
	timeout?: number;
	notifyType?: 'info' | 'warning' | 'error';
	statusKey?: string;
	statusText?: string;
	widgetKey?: string;
	widgetLines?: string[];
	widgetPlacement?: 'aboveEditor' | 'belowEditor';
	text?: string;
}

export interface PiExtensionUiResponse {
	type: 'extension_ui_response';
	id: string;
	value?: string;
	confirmed?: boolean;
	cancelled?: boolean;
}

// ─── Compaction 事件 ───

export interface PiCompactionStartEvent {
	type: 'compaction_start';
	reason: 'manual' | 'threshold' | 'overflow';
}

export interface PiCompactionEndEvent {
	type: 'compaction_end';
	reason: 'manual' | 'threshold' | 'overflow';
	result: { summary: string; firstKeptEntryId: string; tokensBefore: number } | null;
	aborted: boolean;
	willRetry: boolean;
	errorMessage?: string;
}

// ─── 统计类型 ───

export interface SessionStatsResult {
	sessionFile: string;
	sessionId: string;
	userMessages: number;
	assistantMessages: number;
	toolCalls: number;
	totalMessages: number;
	tokens: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		total: number;
	};
	cost: number;
	contextUsage?: {
		tokens: number;
		contextWindow: number;
		percent: number;
	};
}

export type PiEvent =
	| PiResponseEvent
	| PiAgentStartEvent
	| PiAgentEndEvent
	| PiMessageUpdateEvent
	| PiToolExecutionStartEvent
	| PiToolExecutionEndEvent
	| PiQueueUpdateEvent
	| PiExtensionErrorEvent
	| PiTurnStartEvent
	| PiTurnEndEvent
	| PiMessageStartEvent
	| PiMessageEndEvent
	| PiToolExecutionUpdateEvent
	| PiAutoRetryStartEvent
	| PiAutoRetryEndEvent
	| PiExtensionUiRequestEvent
	| PiCompactionStartEvent
	| PiCompactionEndEvent;

// ─── 执行结果 ───

export interface PiExecutionResult {
	outputPath: string;
	success: boolean;
	hadToolCall?: boolean;
	error?: string;
	stats?: SessionStatsResult;
}
