import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentDomain } from "@/views/sidebar/domains/agent-domain";
import type { DeepReaderPluginInterface } from "@/agent/tools/context/vault";

function createMockPlugin(mockAgent: any): DeepReaderPluginInterface {
	return {
		getFrontendAgent: vi.fn(async () => mockAgent),
	} as unknown as DeepReaderPluginInterface;
}

describe("AgentDomain", () => {
	it("streams events successfully from FrontendAgent.chat", async () => {
		const mockAgent = {
			chat: vi.fn(async (msg, ctx, callbacks) => {
				callbacks.onContent("Hello");
				callbacks.onProgress("Thinking...");
				callbacks.onComplete();
			}),
		};
		const plugin = createMockPlugin(mockAgent);
		const domain = new AgentDomain({ plugin });

		const results: any[] = [];
		for await (const event of domain.stream({
			userMessage: "test",
			context: {} as any,
		})) {
			results.push(event);
		}

		expect(results).toEqual([
			{ type: "text", content: "Hello" },
			{ type: "progress", status: "Thinking..." },
			{ type: "complete" },
		]);
		expect(mockAgent.chat).toHaveBeenCalled();
	});

	it("prevents execution leak on early consumer break", async () => {
		let wasFinallyReached = false;
		const mockAgent = {
			chat: vi.fn(async (msg, ctx, callbacks) => {
				try {
					callbacks.onContent("First");
					// Wait a little bit to simulate async generation
					await new Promise((r) => setTimeout(r, 50));
					callbacks.onContent("Second");
				} finally {
					wasFinallyReached = true;
				}
			}),
		};
		const plugin = createMockPlugin(mockAgent);
		const domain = new AgentDomain({ plugin });

		// Consumer only takes the first element and breaks
		for await (const event of domain.stream({
			userMessage: "test",
			context: {} as any,
		})) {
			expect(event).toEqual({ type: "text", content: "First" });
			break;
		}

		// Wait slightly to ensure finally block completes
		await new Promise((r) => setTimeout(r, 60));
		expect(wasFinallyReached).toBe(true);
	});
});
