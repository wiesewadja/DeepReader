import { describe, it, expect } from "vitest";
import { StreamingThinkParser } from "@/utils/streaming-think";

describe("StreamingThinkParser", () => {
	it("returns empty result for empty input", () => {
		const parser = new StreamingThinkParser();
		expect(parser.append("")).toEqual({ cleanedContent: "", reasoning: "" });
		expect(parser.finalize()).toEqual({ cleanedContent: "", reasoning: "" });
	});

	it("returns plain text unchanged", () => {
		const parser = new StreamingThinkParser();
		parser.append("Hello world");
		expect(parser.finalize()).toEqual({ cleanedContent: "Hello world", reasoning: "" });
	});

	it("extracts reasoning from a complete think block", () => {
		const parser = new StreamingThinkParser();
		parser.append("Before <think>hidden reasoning</think> after");
		expect(parser.finalize()).toEqual({
			cleanedContent: "Before  after",
			reasoning: "hidden reasoning",
		});
	});

	it("handles think tags split across chunks", () => {
		const parser = new StreamingThinkParser();
		parser.append("Before <thi");
		parser.append("nk>reason</thi");
		parser.append("nk> after");
		expect(parser.finalize()).toEqual({
			cleanedContent: "Before  after",
			reasoning: "reason",
		});
	});

	it("streams reasoning incrementally", () => {
		const parser = new StreamingThinkParser();
		parser.append("Start <think>step 1");
		const mid = parser.append(" step 2");
		expect(mid.cleanedContent).toBe("Start ");
		expect(mid.reasoning).toBe("step 1 step 2");

		parser.append("</think> end");
		expect(parser.finalize()).toEqual({
			cleanedContent: "Start  end",
			reasoning: "step 1 step 2",
		});
	});

	it("keeps unclosed think content in reasoning", () => {
		const parser = new StreamingThinkParser();
		parser.append("Before <think>unfinished");
		expect(parser.finalize()).toEqual({
			cleanedContent: "Before ",
			reasoning: "unfinished",
		});
	});
});
