/**
 * Streaming parser for `<think>...</think>` blocks in LLM output.
 *
 * Processes text incrementally so that extracting reasoning + cleaned content
 * stays O(total characters) rather than O(n²).
 */

export interface StreamingThinkResult {
	/** Text outside think blocks seen so far. */
	cleanedContent: string;
	/** Text inside the currently open think block. */
	reasoning: string;
}

export class StreamingThinkParser {
	private output = "";
	private reasoning = "";
	private inThink = false;
	private tagBuffer = "";

	append(chunk: string): StreamingThinkResult {
		const openTag = "<think>";
		const closeTag = "</think>";

		for (const char of chunk) {
			this.tagBuffer += char;
			const target = this.inThink ? closeTag : openTag;

			if (target.startsWith(this.tagBuffer)) {
				if (this.tagBuffer === target) {
					// Complete tag matched: toggle state and discard tag.
					this.inThink = !this.inThink;
					this.tagBuffer = "";
				}
				// Otherwise keep buffering until tag completes or mismatches.
			} else {
				// Mismatch: flush buffer to the active stream.
				if (this.inThink) {
					this.reasoning += this.tagBuffer;
				} else {
					this.output += this.tagBuffer;
				}
				this.tagBuffer = "";
			}
		}

		return { cleanedContent: this.output, reasoning: this.reasoning };
	}

	finalize(): StreamingThinkResult {
		// Flush any remaining partial tag. If we are still inside a think block,
		// the partial tag belongs to reasoning; otherwise it belongs to output.
		if (this.tagBuffer.length > 0) {
			if (this.inThink) {
				this.reasoning += this.tagBuffer;
			} else {
				this.output += this.tagBuffer;
			}
			this.tagBuffer = "";
		}
		return { cleanedContent: this.output, reasoning: this.reasoning };
	}
}
