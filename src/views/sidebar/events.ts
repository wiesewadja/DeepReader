import type { LoadedDocument } from "./services/chat-document-service.js";

/**
 * Per-SidebarView event vocabulary.
 *
 * Domains publish these events; ChatPresenter and cross-domain subscribers consume them.
 */

export type TTSPlayState = "idle" | "summarizing" | "tts_loading" | "playing" | "paused";

export interface BookChangedEvent {
	indexId: string | null;
	pdfName: string | null;
	bookAuthor: string | null;
	bookCoverUrl: string | null;
	docDescription: string | null;
}

export interface TTSStateChangedEvent {
	source: "message" | "reading";
	state: TTSPlayState;
	messageId?: string;
}

export interface TTSProgressChangedEvent {
	source: "message";
	messageId: string;
	progress: number;
}

export interface TTSParagraphChangedEvent {
	source: "message" | "reading";
	messageId?: string;
	paragraphIndex: number;
}

export interface UserMessageAddedEvent {
	messageId: string;
	content: string;
	role: "user";
}

export interface AssistantMessageStartedEvent {
	messageId: string;
	status?: string;
	isDiagramPlaceholder?: boolean;
}

export interface AssistantTextChunkEvent {
	messageId: string;
	content: string;
	isIncremental: boolean;
}

export interface AssistantStatusChangedEvent {
	messageId: string;
	status: string;
}

export interface AssistantMessageCompletedEvent {
	messageId: string;
	content: string;
}

export interface DiagramReadyEvent {
	messageId: string;
	embed: string;
}

export interface DiagramFailedEvent {
	messageId: string;
	reason: string;
}

export interface ChatErrorEvent {
	messageId: string;
	message: string;
}

export interface StreamStoppedEvent {
	messageId: string;
	reason: "cancelled" | "completed" | "error";
}

export interface DocumentsLoadedEvent {
	names: string[];
}

export interface RestoredMessage {
	id: string;
	role: "user" | "assistant";
	content: string;
	timestamp?: string;
	isAgentMessage: boolean;
}

export interface HistoryRestoredEvent {
	messages: RestoredMessage[];
}

export interface SidebarEventMap {
	"chat:documents-changed": { documents: LoadedDocument[] };
	"book:changed": BookChangedEvent;
	"tts:state-changed": TTSStateChangedEvent;
	"tts:progress-changed": TTSProgressChangedEvent;
	"tts:paragraph-changed": TTSParagraphChangedEvent;
	"chat:user-message-added": UserMessageAddedEvent;
	"chat:assistant-message-started": AssistantMessageStartedEvent;
	"chat:assistant-text-chunk": AssistantTextChunkEvent;
	"chat:assistant-status-changed": AssistantStatusChangedEvent;
	"chat:assistant-message-completed": AssistantMessageCompletedEvent;
	"chat:diagram-ready": DiagramReadyEvent;
	"chat:diagram-failed": DiagramFailedEvent;
	"chat:error": ChatErrorEvent;
	"chat:stream-stopped": StreamStoppedEvent;
	"chat:history-restored": HistoryRestoredEvent;
	"chat:documents-loaded": DocumentsLoadedEvent;
}
