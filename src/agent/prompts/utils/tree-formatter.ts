import type { OutlineNode } from '../../tools/local/types.js';

export function formatTreeStructure(
  nodes: OutlineNode[],
  indent: number = 0,
  maxTextLength: number = 100,
  maxDepth: number = 4,
  bookName: string = ''
): string {
  const lines: string[] = [];

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const isLast = i === nodes.length - 1;

    const prefix = '    '.repeat(indent) + (isLast ? '└── ' : '├── ');

    const fullLink = bookName && node.file_name
      ? `[[${bookName}/${node.file_name}]]`
      : node.file_name ? `[[${node.file_name}]]` : '';
    const linkPart = fullLink ? `, link: ${fullLink}` : '';
    const titleLine = `${prefix}${node.heading} (node_id: ${node.node_id}${linkPart})`;
    lines.push(titleLine);

    if (node.summary && indent < maxDepth) {
      const truncatedSummary = node.summary.length > maxTextLength
        ? node.summary.slice(0, maxTextLength) + '...'
        : node.summary;
      const summaryPrefix = '    '.repeat(indent + 1) + '摘要: ';
      lines.push(`${summaryPrefix}${truncatedSummary}`);
    }

    if (node.children && node.children.length > 0 && indent < maxDepth) {
      const childText = formatTreeStructure(node.children, indent + 1, maxTextLength, maxDepth, bookName);
      lines.push(childText);
    }
  }

  return lines.join('\n');
}
