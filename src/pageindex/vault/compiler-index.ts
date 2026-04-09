import type { ConceptExtraction } from "./compiler-types";

/** 生成 L0 _总目录.md */
export function generateL0(
  extractions: ConceptExtraction[],
  bookDirs: string[]
): string {
  // 汇总主题域
  const topics = new Map<string, string[]>();
  for (const e of extractions) {
    const topic = e.topic.replace("新建:", "");
    if (!topics.has(topic)) topics.set(topic, []);
    for (const t of e.tags) {
      if (!topics.get(topic)!.includes(t)) topics.get(topic)!.push(t);
    }
  }

  // 汇总概念
  const concepts = new Map<string, number>();
  for (const e of extractions) {
    for (const c of e.relatedConcepts) {
      concepts.set(c.concept, (concepts.get(c.concept) || 0) + 1);
    }
  }

  const now = new Date().toISOString();

  let content = `---
system-generated: true
compiled-at: ${now}
type: index-root
---

# 全库索引

`;

  if (topics.size > 0) {
    content += `## 主题域\n`;
    for (const [topic, tags] of topics) {
      content += `- [[${topic}]] — ${tags.slice(0, 5).join("、")}\n`;
    }
    content += "\n";
  }

  if (bookDirs.length > 0) {
    content += `## 书籍\n`;
    for (const dir of bookDirs) {
      content += `- [[${dir}/_目录]]\n`;
    }
    content += "\n";
  }

  if (concepts.size > 0) {
    content += `## 概念索引\n`;
    for (const [concept, count] of concepts) {
      content += `- [[概念/${concept}]] — ${count} 处提及\n`;
    }
  }

  return content;
}

/** 生成 L1 MOC 文件 */
export function generateMOC(
  mocName: string,
  coreConcepts: string[],
  notes: Array<{ file: string; tags: string[]; description: string }>
): string {
  let content = `# ${mocName}\n\n`;

  if (coreConcepts.length > 0) {
    content += `## 核心概念\n`;
    for (const c of coreConcepts) {
      content += `- [[概念/${c}]]\n`;
    }
    content += "\n";
  }

  if (notes.length > 0) {
    content += `## 相关笔记\n`;
    for (const n of notes) {
      content += `- [[${n.file.replace(/\.md$/, "")}]] — ${n.description}\n`;
    }
  }

  return content;
}

/** 生成目录内 _目录.md */
export function generateDirectoryIndex(
  dirName: string,
  files: Array<{ name: string; title: string; description: string }>
): string {
  let content = `# ${dirName}/_目录\n\n`;

  for (const f of files) {
    const baseName = f.name.replace(/\.md$/, "");
    content += `- [[${baseName}]] — ${f.description}\n`;
  }

  return content;
}

/** 从 ConceptExtraction 列表中按 topic 分组 */
export function groupExtractionsByTopic(
  extractions: ConceptExtraction[]
): Map<string, ConceptExtraction[]> {
  const groups = new Map<string, ConceptExtraction[]>();
  for (const e of extractions) {
    const topic = e.topic.replace("新建:", "");
    if (!groups.has(topic)) groups.set(topic, []);
    groups.get(topic)!.push(e);
  }
  return groups;
}
