const OBSIDIAN_FORMAT_RULES = `
## Obsidian 格式规范

### Wiki 链接
- 使用 [[文件名]] 创建内部链接
- 使用 [[文件名#标题]] 链接到具体章节
- 使用 [[文件名|显示文本]] 自定义显示文字
- 链接目标必须是库中已存在的笔记路径

### 标签
- 使用 #标签 格式，放在 YAML frontmatter 的 tags 数组中
- 标签应该是简短的词组，不是句子
- 优先使用已存在的标签，避免创建重复含义的新标签

### MOC（Map of Content）
- MOC 是主题索引笔记，按 MOC-{主题名}.md 命名
- MOC 内部按 ## 二级标题分组（核心概念 / 书籍章节 / 相关笔记）
- MOC 中的每个条目都是一个 [[wiki链接]]
`;

/** Phase 1 概念提取 prompt */
export function buildConceptExtractionPrompt(
  notes: Array<{ file: string; summary: string }>,
  existingTopics: string[],
  existingTags?: string[]
): string {
  const hasExisting = existingTopics.length > 0;

  const existingSection = hasExisting
    ? `## 已有主题域和标签
主题域: ${existingTopics.join(", ")}
标签: ${(existingTags || []).join(", ")}`
    : `## 已有主题域和标签
（首次编译，暂无已有标签和主题域。自由提取概念，不要求复用已有标签。）`;

  const constraintSection = hasExisting
    ? `1. **tags**: 提取 2-5 个核心概念标签
   - 优先从已有标签中选择
   - 只在确实无法归入已有标签时才创建新标签`
    : `1. **tags**: 提取 2-5 个核心概念标签`;

  const notesSection = notes
    .map((n, i) => `### 笔记 ${i + 1}: ${n.file}\n${n.summary}`)
    .join("\n\n");

  return `你是一个 Obsidian 知识库编译器，负责分析笔记并提取结构化元数据。

${OBSIDIAN_FORMAT_RULES}

${existingSection}

## 待分析笔记

${notesSection}

## 分析要求

对每篇笔记：
${constraintSection}
   - 标签应该是该笔记的核心主题，不是边缘提及

2. **topic**: 该笔记归属的主题域
   - 从已有 MOC 中选择最匹配的
   - 如果不匹配任何已有 MOC，建议新建，格式为 "新建:MOC-{主题名}"

3. **wikiLinks**: 笔记中可以添加双向链接的关键词
   - 只建议库中已有笔记对应的链接
   - 只对核心概念做链接，不要每个词都链

4. **relatedConcepts**: 与哪些已有概念笔记有关联

## 输出格式
严格输出 JSON：
{
  "results": [
    {
      "file": "filename",
      "tags": ["概念A", "概念B"],
      "topic": "MOC-xxx" 或 "新建:MOC-xxx",
      "wikiLinks": [{ "text": "投射", "target": "概念/投射" }],
      "relatedConcepts": [{ "concept": "投射", "isNewConcept": false }]
    }
  ]
}`;
}

/** Phase 2 深度分析 prompt */
export function buildDeepAnalysisPrompt(
  filePath: string,
  noteContent: string,
  relatedContext: string
): string {
  return `你是一个 Obsidian 知识库深度编译器，负责对单篇笔记进行语义精化。

## Obsidian 格式规范

### 双向链接的精确用法
- [[概念名]]: 链接到概念笔记
- [[目录/文件名]]: 链接到具体文件
- [[目录/文件名#标题]]: 链接到具体章节
- [[目录/文件名#标题^block-id]]: 链接到具体段落块
- 一次笔记中同一概念只在首次出现时创建链接
- 不要对虚词、介词、连词创建链接

### 概念笔记格式
- 一句话定义
- ## 来源 — 列出讨论该概念的书/笔记链接
- ## 关联概念 — 列出相关概念的链接

## 当前笔记: ${filePath}
${noteContent}

## 相关上下文
${relatedContext}

## 分析任务
1. 识别所有隐含概念（显式/隐含/论证）
2. 建议精确的 [[wiki链接]] 插入
3. 如果有新概念，给出概念笔记草稿

## 输出格式
{
  "concepts": { "explicit": [], "implicit": [], "argumentative": { "premises": [], "conclusion": "" } },
  "suggestedLinks": [{ "originalText": "", "replacement": "", "target": "", "confidence": 0.9 }],
  "conceptNoteUpdates": [{ "concept": "", "action": "append", "content": "" }],
  "newConceptNotes": [{ "name": "", "definition": "", "sources": [], "relatedConcepts": [] }]
}`;
}

/** 搜索定位 prompt */
export function buildSearchPrompt(query: string, indexContent: string): string {
  return `你是 Obsidian 知识库的检索导航员。

## 检索规则
- 从索引中定位最相关的 1-3 个目标
- 只返回明确相关的目标，宁缺毋滥
- 如果跨主题域，返回多个目标

## 索引内容
${indexContent}

## 用户查询
${query}

输出 JSON：
{
  "thinking": "定位推理",
  "targets": [
    { "path": "目标路径", "reason": "相关性说明", "priority": 1 }
  ]
}`;
}
