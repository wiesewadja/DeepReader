export function buildScopedChaptersBlock(
  scopeNodeIds: string[],
  markdownFiles: Record<string, string>,
  nodeFileMap?: Record<string, string>
): string {
  if (scopeNodeIds.length === 0) return '';

  const lines: string[] = [];

  for (const nodeId of scopeNodeIds) {
    const indexFileName = nodeFileMap?.[nodeId]?.replace(/\.md$/, '');
    if (indexFileName) {
      lines.push(`- node_id: ${nodeId}, file_name: "${indexFileName}"`);
      continue;
    }

    const numericPart = nodeId.replace(/^0+/, '');
    const matchedKey = Object.keys(markdownFiles).find(key => {
      const fileName = key.split('/').pop() ?? '';
      const fileNumMatch = fileName.match(/^(\d+)\s*-\s*/);
      if (fileNumMatch) {
        const fileNum = fileNumMatch[1].replace(/^0+/, '');
        return fileNum === numericPart;
      }
      return false;
    });

    if (matchedKey) {
      const fileName = matchedKey.split('/').pop() ?? '';
      const fileNameForLink = fileName.replace(/\.md$/, '');
      lines.push(`- node_id: ${nodeId}, file_name: "${fileNameForLink}"`);
    } else {
      lines.push(`- node_id: ${nodeId}`);
    }
  }

  const inner = lines.join('\n');
  const full = `<scoped_chapters>\n${inner}\n</scoped_chapters>`;

  if (full.length > 1500) {
    const truncated = full.slice(0, 1500 - '...[已截断]'.length);
    return `${truncated}...[已截断]`;
  }

  return full;
}
