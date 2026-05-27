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
	workingDir: string;
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

export type PiCommand =
	| PiPromptCommand
	| PiNewSessionCommand
	| PiAbortCommand
	| PiGetCommandsCommand;

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

export type PiEvent =
	| PiResponseEvent
	| PiAgentStartEvent
	| PiAgentEndEvent
	| PiMessageUpdateEvent
	| PiToolExecutionStartEvent
	| PiToolExecutionEndEvent
	| PiQueueUpdateEvent
	| PiExtensionErrorEvent;

// ─── 执行结果 ───

export interface PiExecutionResult {
	outputPath: string;
	success: boolean;
	error?: string;
}
