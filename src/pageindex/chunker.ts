/**
 * Chunker — splits markdown content into semantic chunks for vectorization.
 * Merges paragraphs to target window size (300-500 chars).
 */

export interface Paragraph {
  blockId: string;   // without ^ prefix
  text: string;
}

export interface Chunk {
  chunkId: string;     // {nodeId}_{firstBlockId}
  blockIds: string[];
  text: string;
  type: "heading" | "body" | "list" | "quote";
}

const TARGET_SIZE = 300;
const MAX_SIZE = 800;

/**
 * Split markdown content by ^blockId markers.
 * Strips ^ prefix from blockIds.
 */
export function splitByBlockIds(content: string): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  const regex = /\^([\w-]+)/g;
  let lastEnd = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const text = content.slice(lastEnd, match.index).trim();
    if (text) {
      paragraphs.push({ blockId: match[1], text });
    }
    lastEnd = match.index + match[0].length;
  }

  const remaining = content.slice(lastEnd).trim();
  if (remaining) {
    paragraphs.push({ blockId: "", text: remaining });
  }

  return paragraphs;
}

/**
 * Classify a text chunk by its leading characters.
 */
export function classifyType(text: string): "heading" | "body" | "list" | "quote" {
  const trimmed = text.trimStart();
  if (trimmed.startsWith("#")) return "heading";
  if (trimmed.startsWith(">")) return "quote";
  if (trimmed.startsWith("- ") || trimmed.startsWith("* ") || trimmed.startsWith("+ ")) return "list";
  return "body";
}

/**
 * Split a long text at the best boundary within maxSize.
 */
function splitLongText(text: string, maxSize: number): string[] {
  if (text.length <= maxSize) return [text];

  const parts: string[] = [];
  let remaining = text;

  while (remaining.length > maxSize) {
    // Try sentence boundary (。？！)
    let cutPos = -1;
    for (let i = maxSize; i > maxSize * 0.5; i--) {
      if ("。？！".includes(remaining[i])) {
        cutPos = i + 1;
        break;
      }
    }
    // Fallback: comma/semicolon
    if (cutPos === -1) {
      for (let i = maxSize; i > maxSize * 0.5; i--) {
        if ("，；、,;".includes(remaining[i])) {
          cutPos = i + 1;
          break;
        }
      }
    }
    // Final fallback: force cut
    if (cutPos === -1) cutPos = maxSize;

    parts.push(remaining.slice(0, cutPos).trim());
    remaining = remaining.slice(cutPos).trim();
  }

  if (remaining) parts.push(remaining);
  return parts;
}

/**
 * Merge paragraphs into chunks targeting 300-500 chars.
 * Long paragraphs (>800) are split at sentence boundaries.
 */
export function mergeToChunks(paragraphs: Paragraph[], nodeId: string): Chunk[] {
  const chunks: Chunk[] = [];
  let currentTexts: string[] = [];
  let currentBlockIds: string[] = [];
  let currentLength = 0;

  function flush(): void {
    if (currentTexts.length === 0) return;
    const text = currentTexts.join(" ");
    const firstBlockId = currentBlockIds[0] || `auto${chunks.length}`;
    chunks.push({
      chunkId: `${nodeId}_${firstBlockId}`,
      blockIds: [...currentBlockIds],
      text,
      type: classifyType(currentTexts[0]),
    });
    currentTexts = [];
    currentBlockIds = [];
    currentLength = 0;
  }

  for (const para of paragraphs) {
    // Handle long paragraphs by splitting
    if (para.text.length > MAX_SIZE) {
      flush();
      const parts = splitLongText(para.text, MAX_SIZE);
      for (let i = 0; i < parts.length; i++) {
        const suffix = i === 0 ? "" : `_${i}`;
        chunks.push({
          chunkId: `${nodeId}_${para.blockId}${suffix}`,
          blockIds: [para.blockId],
          text: parts[i],
          type: classifyType(parts[i]),
        });
      }
      continue;
    }

    currentTexts.push(para.text);
    if (para.blockId) currentBlockIds.push(para.blockId);
    currentLength += para.text.length;

    if (currentLength >= TARGET_SIZE) {
      flush();
    }
  }

  flush(); // remaining
  return chunks;
}
