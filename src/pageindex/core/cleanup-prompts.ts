export const TOC_CLEANUP_BATCH_PROMPT = `You are regenerating chapter/section titles for a book's Table of Contents (TOC) layer.

## Book
Title: {bookTitle}

## Target layer
Layer depth: {depth} (1 = top-level/part, 2 = chapter, 3+ = section)
Parent title (if any): {parentTitle}

## Nodes in this layer (current titles may be wrong — duplicates, truncated, or book-name placeholders)
{nodeList}

## Body excerpt for each node (first 300 chars — extract real title from this)
{bodyExcerpts}

## Task
Infer a real title for each node based on its body excerpt and the context of other siblings. Requirements:
- Concise (5-25 chars), unique within this layer (no duplicates among siblings).
- MUST be inferred from the body excerpt — do NOT rely on your general memory of the book.
- Language: match the dominant language of the body excerpt.
  - If Chinese: use standard Chinese formats like "第 X 章 标题" / "第 X 部分 主题" / "标题" (or let it naturally align with typical Chinese TOC styles).
  - If English: use standard English formats like "Chapter X: Title" / "Part X: Theme" / "Title".
  - If mixed: follow the language used in chapter headings within the body.
- If the body excerpt is empty or completely uninformative, assign a confidence <= 0.5.

## Output format (strict JSON array, no other text)
[
  { "nodeId": "...", "inferred_title": "...", "confidence": 0.9, "reason": "inferred from..." },
  ...
]`;

export const TOC_SUBTITLE_BATCH_PROMPT = `You are extracting concise subtitles for a series of book chapters. The current titles are placeholders (e.g. the book name) and need a descriptive subtitle based on their content.

## Book
Title: {bookTitle}

## Chapters
{nodeList}

## Body excerpt for each chapter (first 300 chars)
{bodyExcerpts}

## Task
For each chapter, extract a concise subtitle (2-5 words, e.g. "童年成长" or "The Early Years") that represents the main topic of that section based on its body excerpt.
- If the excerpt is empty or uninformative, leave the subtitle as "".
- Match the language of the body excerpt.
- Keep it very short and thematic.

## Output format (strict JSON array, no other text)
[
  { "nodeId": "...", "subtitle": "..." },
  ...
]`;
