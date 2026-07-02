/**
 * AgentDomain
 *
 * Stateless thinking engine. Accepts an {@link AgentRequest} and returns an
 * async iterable of {@link AgentEvent}s. It wraps the plugin's FrontendAgent
 * but exposes no UI or history concerns.
 */

import type { ChatMessage } from "../../../agent/types.js";
import type { ToolContext } from "../../../agent/tools/types.js";
import type { DeepReaderPluginInterface } from "../../../agent/tools/context/vault.js";

export interface ReferencedDocument {
	name: string;
	content: string;
}

export interface QuoteItem {
	text: string;
	source?: string;
	heading?: string;
	headingPath?: string[];
	id: string;
	type?: string;
}

export interface AgentRequest {
	userMessage: string;
	context: ToolContext;
	history?: ChatMessage[];
	quotes?: QuoteItem[];
	referencedDocs?: ReferencedDocument[];
	abortSignal?: AbortSignal;
}

export type AgentEvent =
	| { type: "text"; content: string }
	| { type: "reasoning"; content: string }
	| { type: "token"; token: string }
	| { type: "progress"; status: string }
	| { type: "diagram-start" }
	| { type: "diagram-ready"; embed: string }
	| { type: "diagram-failed"; reason: string }
	| { type: "error"; message: string }
	| { type: "complete" };

export interface AgentDomainOptions {
	plugin: DeepReaderPluginInterface;
}

export class AgentDomain {
	private plugin: DeepReaderPluginInterface;

	constructor(options: AgentDomainOptions) {
		this.plugin = options.plugin;
	}

	async *stream(request: AgentRequest): AsyncIterable<AgentEvent> {
		const frontendAgent = await this.plugin.getFrontendAgent();
		const userMessage = this.buildUserMessage(request);
		const events: AgentEvent[] = [];
		let resolveNext: ((value: IteratorResult<AgentEvent>) => void) | null = null;
		let done = false;

		const push = (event: AgentEvent) => {
			if (resolveNext) {
				resolveNext({ value: event, done: false });
				resolveNext = null;
			} else {
				events.push(event);
			}
		};

		const runAgent = async () => {
			try {
				const callbacks = {
					onContent: (text: string) => push({ type: "text", content: text }),
					onProgress: (status: string) => push({ type: "progress", status }),
					onReasoning: (text: string) => push({ type: "reasoning", content: text }),
					onToken: (token: string) => push({ type: "token", token }),
					onDiagramStart: () => push({ type: "diagram-start" }),
					onDiagramReady: (embed: string) => push({ type: "diagram-ready", embed }),
					onDiagramFailed: (reason: string) => push({ type: "diagram-failed", reason }),
					onError: (message: string) => push({ type: "error", message }),
					onComplete: () => push({ type: "complete" }),
					abortSignal: request.abortSignal,
				};
				if (request.history?.length) {
					await frontendAgent.continueChat(request.history, userMessage, request.context, callbacks);
				} else {
					await frontendAgent.chat(userMessage, request.context, callbacks);
				}
			} catch (err) {
				push({ type: "error", message: err instanceof Error ? err.message : String(err) });
				push({ type: "complete" });
			} finally {
				done = true;
				if (resolveNext) resolveNext({ value: undefined, done: true });
			}
		};

		const agentPromise = runAgent();

		try {
			while (!done || events.length > 0) {
				if (events.length > 0) {
					yield events.shift()!;
					continue;
				}
				const result = await new Promise<IteratorResult<AgentEvent>>((r) => (resolveNext = r));
				if (!result.done) yield result.value;
			}
		} finally {
			await agentPromise;
		}
	}

	private buildUserMessage(request: AgentRequest): string {
		let message = request.userMessage;

		if (request.quotes && request.quotes.length > 0) {
			const quotesText = request.quotes
				.map((q) => {
					const location = q.headingPath?.join(" > ") || q.heading || q.source || "引用";
					return `> ${q.text}\n> — ${location}`;
				})
				.join("\n\n");
			message = `${message}\n\n---\n**用户引用了以下内容，请重点关注并基于引用内容回答：**\n${quotesText}`;
		}

		if (request.referencedDocs && request.referencedDocs.length > 0) {
			const docsText = request.referencedDocs
				.map((d) => `### ${d.name}\n\`\`\`markdown\n${d.content}\n\`\`\``)
				.join("\n\n");
			message = `${message}\n\n---\n**用户通过 @ 引用了以下文档，请基于文档内容回答：**\n\n${docsText}`;
		}

		return message;
	}
}
