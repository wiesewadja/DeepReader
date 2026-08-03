/**
 * Text splitting utilities for TTS
 */

const SENTENCE_END_RE = /[。！？!?]/;

/**
 * Split the first sentence from a buffer.
 * Returns [sentence, remaining] or [null, original] if no sentence end found.
 */
export function splitFirstSentence(buffer: string): [string | null, string] {
    const match = buffer.search(SENTENCE_END_RE);
    if (match === -1) return [null, buffer];
    const end = match + 1;
    return [buffer.slice(0, end), buffer.slice(end)];
}

/**
 * Clean wiki links from text for TTS reading.
 * [[note]] → note
 * [[note|alias]] → alias
 * [[path/to/note|alias]] → alias
 */
export function stripWikiLinksForTTS(text: string): string {
    return text.replace(/\[\[([^\]]+)\]\]/g, (_match, content: string) => {
        const parts = content.split('|');
        if (parts.length > 1) {
            // Has alias, use alias
            return parts[1].trim();
        }
        // No alias, use last part of path (filename)
        const pathParts = parts[0].trim().split('/');
        return pathParts[pathParts.length - 1];
    });
}

/**
 * Split text into segments for TTS streaming.
 * First splits by paragraphs, then by sentences if a paragraph exceeds target.
 */
export function splitTextIntoSegments(text: string, targetChars: number = 300): string[] {
    // First split by paragraphs
    const paragraphs = text.split(/\n\n+/).filter(p => p.trim().length > 0);
    const segments: string[] = [];
    let currentSegment = '';

    for (const para of paragraphs) {
        // If current paragraph + existing content doesn't exceed target, merge
        if (currentSegment.length + para.length <= targetChars) {
            currentSegment = currentSegment ? `${currentSegment}\n\n${para}` : para;
            continue;
        }

        // If there's existing content, save it first
        if (currentSegment) {
            segments.push(currentSegment);
            currentSegment = '';
        }

        // Single paragraph exceeds target, split by sentences
        if (para.length > targetChars) {
            const sentences = para.split(/([。！？.!?])/);
            let sentenceSegment = '';

            for (let i = 0; i < sentences.length; i++) {
                const piece = sentences[i];
                if (sentenceSegment.length + piece.length <= targetChars) {
                    sentenceSegment += piece;
                } else {
                    if (sentenceSegment) segments.push(sentenceSegment);
                    sentenceSegment = piece;
                }
            }
            if (sentenceSegment) currentSegment = sentenceSegment;
        } else {
            currentSegment = para;
        }
    }

    // Final segment
    if (currentSegment) {
        segments.push(currentSegment);
    }

    return segments;
}
