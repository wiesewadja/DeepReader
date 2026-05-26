import { getBookDir } from "./paths.js";
/**
 * Proposition Indexer - Extract atomic fact cards per chapter
 */

import * as path from "path";
import * as fs from "fs/promises";
import { chatGPT } from "./llm/client.js";
import {
  generateEmbedding,
  generateEmbeddings,
} from "./vault/vectors.js";
import type { 
  PropositionCard, 
  PropositionsData, 
  PropositionIndexOptions,
  PropositionIndexResult,
  CardType,
  TreeData,
  TreeNode,
} from "./book-types.js";
import type { EmbeddingOptions } from "./vault/types.js";
import { log as piLog } from "./core/logger.js";

const DEFAULT_CARDS_PER_500 = 1;
const DEFAULT_MIN_CARDS = 3;
const DEFAULT_MAX_CARDS = 15;

export function buildExtractionPrompt(
  chapterText: string,
  targetCards: number
): string {
  const chapterLength = chapterText.length;
  
  return `
你正在用《如何阅读一本书》的分析阅读方法提取知识点卡片。

## 卡片类型定义：

| 类型 | 提取什么 | 示例 |
|------|---------|------|
| 问题 | 作者要解决的问题 | "贾宝玉的命运将如何？" |
| 概念 | 核心概念定义 | "判词：预言人物命运的诗句" |
| 主旨 | 作者的核心观点 | "判词预示主要人物命运" |
| 论述 | 论证逻辑结构 | "用谐音双关暗示人物结局" |
| 结论 | 作者得出的解答 | "玉带林中挂指林黛玉" |
| 人物 | 人物特征/命运/关系 | "薛宝钗：金簪雪里埋" |
| 情节 | 关键事件/转折点 | "宝玉梦游太虚幻境" |
| 象征 | 隐喻/意象/象征义 | "玉带=玉黛，谐音双关" |

## Few-Shot 示例：

### 示例1：学术类书籍

输入章节：
"亚里士多德在《尼各马可伦理学》中提出，美德是一种习惯。他认为，美德不是天生的，
而是通过反复实践获得的。一个人要成为勇敢的人，必须反复做勇敢的事。
美德处于两个极端之间：勇敢处于怯懦和鲁莽之间。这种中道原则是亚里士多德伦理学的核心。"

输出：
{
  "cards": [
    {
      "type": "概念",
      "answer": "美德是一种习惯，通过反复实践获得",
      "context": "美德不是天生的，而是通过反复实践获得的",
      "tags": ["美德", "习惯", "亚里士多德", "伦理学", "实践"]
    },
    {
      "type": "主旨",
      "answer": "美德处于两个极端之间的中道",
      "context": "美德处于两个极端之间：勇敢处于怯懦和鲁莽之间",
      "tags": ["中道原则", "美德", "极端", "勇敢"]
    },
    {
      "type": "论述",
      "answer": "勇敢=怯懦与鲁莽的中道，举例说明中道原则",
      "context": "勇敢处于怯懦和鲁莽之间",
      "tags": ["论述", "勇敢", "怯懦", "鲁莽", "中道"]
    },
    {
      "type": "结论",
      "answer": "中道原则是亚里士多德伦理学的核心",
      "context": "这种中道原则是亚里士多德伦理学的核心",
      "tags": ["中道原则", "亚里士多德", "伦理学", "核心结论"]
    }
  ]
}

### 示例2：文学类书籍

输入章节：
"宝玉看了不解，遂掷下这个，去开那个。后面又画着一堆雪，雪下一股金簪。
也有四句言词，道是：可叹停机德，堪怜咏絮才。玉带林中挂，金簪雪里埋。
宝玉看了仍不解，便又掷了，再去开那一副..."

输出：
{
  "cards": [
    {
      "type": "问题",
      "answer": "贾宝玉的命运将如何？判词预示了什么？",
      "context": "宝玉看了不解，遂掷下这个，去开那个",
      "tags": ["贾宝玉", "命运", "判词", "不解"]
    },
    {
      "type": "概念",
      "answer": "判词：预言人物命运的诗句",
      "context": "也有四句言词，道是",
      "tags": ["判词", "概念", "预言", "诗句"]
    },
    {
      "type": "主旨",
      "answer": "判词预示黛玉和宝钗的命运",
      "context": "可叹停机德，堪怜咏絮才。玉带林中挂，金簪雪里埋",
      "tags": ["判词", "命运预示", "林黛玉", "薛宝钗"]
    },
    {
      "type": "象征",
      "answer": "玉带林中挂=林黛玉（玉带谐音玉黛）",
      "context": "玉带林中挂",
      "tags": ["林黛玉", "玉带", "谐音", "象征", "双关"]
    },
    {
      "type": "人物",
      "answer": "薛宝钗：金簪雪里埋，暗示婚姻冰冷结局",
      "context": "金簪雪里埋",
      "tags": ["薛宝钗", "金簪", "命运", "结局"]
    }
  ]
}

### 示例3：实用类书籍

输入章节：
"MECE原则是咨询行业的基本方法论。MECE意为"相互独立，完全穷尽"。
在分析问题时，要确保各个分类之间没有重叠（相互独立），同时所有可能情况都被覆盖（完全穷尽）。
例如，分析客户时可以按"新客户/老客户"分类，这既不重叠又覆盖了所有客户类型。"

输出：
{
  "cards": [
    {
      "type": "概念",
      "answer": "MECE：相互独立，完全穷尽",
      "context": "MECE意为相互独立，完全穷尽",
      "tags": ["MECE", "概念", "相互独立", "完全穷尽", "方法论"]
    },
    {
      "type": "主旨",
      "answer": "MECE是咨询行业的基本方法论",
      "context": "MECE原则是咨询行业的基本方法论",
      "tags": ["MECE", "咨询", "方法论", "核心原则"]
    },
    {
      "type": "论述",
      "answer": "分类不重叠+覆盖所有情况=MECE",
      "context": "各个分类之间没有重叠，同时所有可能情况都被覆盖",
      "tags": ["论述", "分类", "重叠", "覆盖"]
    },
    {
      "type": "结论",
      "answer": "新客户/老客户是MECE分类示例",
      "context": "分析客户时可以按新客户/老客户分类",
      "tags": ["MECE", "示例", "客户分类", "应用"]
    }
  ]
}

---

## 当前任务：

从以下章节文本中提取 ${targetCards} 张原子事实卡片。

⚠️ 重要：以上示例仅为格式参考。你必须从实际文本中提取内容，绝不能照抄示例中的内容。

要求：
- 卡片数量：${targetCards} 张（允许 ±2 偏差）
- 只从实际文本中提取，不要照抄任何示例内容
- 根据内容自动选择合适的类型组合
- 文学作品侧重：人物/情节/象征
- 学术作品侧重：问题/概念/主旨/论述/结论
- 实用作品侧重：概念/主旨/结论

格式要求：
- answer：简洁（≤50字），独立可理解
- context：精准摘录原文（≤200字），必须是原文中的实际句子
- tags：多角度标注（实体名、别名、相关概念、隐喻关键词）

输出格式（纯JSON，无markdown包裹）：
{
  "cards": [
    {
      "type": "类型名",
      "answer": "...",
      "context": "...",
      "tags": ["..."]
    }
  ]
}

章节文本（${chapterLength}字）：
${chapterText}
`;
}

export function calculateTargetCards(
  chapterLength: number,
  cardsPer500: number = DEFAULT_CARDS_PER_500,
  minCards: number = DEFAULT_MIN_CARDS,
  maxCards: number = DEFAULT_MAX_CARDS
): number {
  const base = Math.floor(chapterLength / 500) * cardsPer500;
  return Math.max(minCards, Math.min(maxCards, base));
}

export function parseCards(
  response: string,
  sourceNodeId: string
): PropositionCard[] {
  let jsonStr = response.trim();
  
  const codeBlockMatch = jsonStr.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }
  
  const jsonMatch = jsonStr.match(/\{[\s\S]*"cards"[\s\S]*\}/);
  if (jsonMatch) {
    jsonStr = jsonMatch[0];
  }

  try {
    const parsed = JSON.parse(jsonStr);
    
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.cards)) {
      piLog(`[proposition-indexer] Invalid response structure`);
      return [];
    }
    
    const validCardTypes: CardType[] = ['问题', '概念', '主旨', '论述', '结论', '人物', '情节', '象征'];
    const cards: PropositionCard[] = [];
    
    for (let i = 0; i < parsed.cards.length; i++) {
      const card = parsed.cards[i];
      
      if (!card || typeof card !== 'object') {
        piLog(`[proposition-indexer] Skipping invalid card at index ${i}`);
        continue;
      }
      
      if (!card.answer || typeof card.answer !== 'string') {
        piLog(`[proposition-indexer] Skipping card at index ${i}: missing answer`);
        continue;
      }
      
      if (!card.context || typeof card.context !== 'string') {
        piLog(`[proposition-indexer] Skipping card at index ${i}: missing context`);
        continue;
      }
      
      if (!Array.isArray(card.tags)) {
        piLog(`[proposition-indexer] Skipping card at index ${i}: missing tags`);
        continue;
      }
      
      let cardType: CardType = card.type as CardType;
      if (!validCardTypes.includes(cardType)) {
        cardType = '概念';
      }
      
      cards.push({
        id: `card_${sourceNodeId}_${cards.length + 1}`,
        type: cardType,
        answer: card.answer.trim().slice(0, 100),
        context: card.context.trim().slice(0, 300),
        tags: card.tags.map((t: string) => t.trim()).filter((t: string) => t),
        sourceNodeId,
      });
    }
    
    return cards;
  } catch (error) {
    piLog(`[proposition-indexer] Failed to parse cards: ${error}`);
    piLog(`[proposition-indexer] Response preview: ${response.slice(0, 300)}`);
    return [];
  }
}

export async function extractCardsFromChapter(
  chapterText: string,
  sourceNodeId: string,
  llm: { model: string; apiKey: string; baseUrl: string },
  options?: {
    cardsPer500?: number;
    minCards?: number;
    maxCards?: number;
  }
): Promise<PropositionCard[]> {
  const targetCards = calculateTargetCards(
    chapterText.length,
    options?.cardsPer500,
    options?.minCards,
    options?.maxCards
  );

  const prompt = buildExtractionPrompt(chapterText, targetCards);

  try {
    const response = await chatGPT({
      model: llm.model,
      prompt,
      apiKey: llm.apiKey,
      baseUrl: llm.baseUrl,
      temperature: 0.3,
    });

    const cards = parseCards(response, sourceNodeId);

    if (cards.length < targetCards - 2) {
      piLog(`[proposition-indexer] Warning: cards insufficient (${cards.length} < ${targetCards})`);
    }

    return cards;
  } catch (error) {
    piLog(`[proposition-indexer] Extraction failed: ${error}`);
    return [];
  }
}

export async function indexPropositions(
  options: PropositionIndexOptions
): Promise<PropositionIndexResult> {
  const {
    bookId,
    vaultPath,
    treeData,
    embedding,
    llm,
    cardsPer500Words,
    minCards,
    maxCards,
    onProgress,
  } = options;

  const indexDir = getBookDir(vaultPath, bookId);
  const allCards: PropositionCard[] = [];

  const chapters = collectChapters(treeData);

  onProgress?.({ percent: 0, message: "开始提取命题卡片" });

  for (let i = 0; i < chapters.length; i++) {
    const chapter = chapters[i];
    
    const chapterPath = path.join(
      vaultPath, 
      "DeepReader", 
      treeData.exportName || treeData.title, 
      chapter.fileName.endsWith(".md") ? chapter.fileName : chapter.fileName + ".md"
    );
    let chapterText = "";
    
    try {
      chapterText = await readChapterContent(chapterPath);
    } catch (error) {
      piLog(`[proposition-indexer] Failed to read chapter: ${chapter.fileName}`);
      continue;
    }

    if (chapterText.length < 200) {
      piLog(`[proposition-indexer] Chapter too short, skipping: ${chapter.fileName}`);
      continue;
    }

    onProgress?.({
      percent: Math.round((i / chapters.length) * 80),
      message: `提取章节 ${i + 1}/${chapters.length}: ${chapter.title}`,
    });

    const cards = await extractCardsFromChapter(
      chapterText,
      chapter.nodeId,
      llm,
      { cardsPer500: cardsPer500Words, minCards, maxCards }
    );

    allCards.push(...cards);
  }

  onProgress?.({ percent: 80, message: "卡片提取完成，开始向量化" });

  if (embedding && allCards.length > 0) {
    await vectorizeCards(allCards, indexDir, embedding);
  }

  onProgress?.({ percent: 95, message: "存储卡片数据" });

  const propositionsData: PropositionsData = {
    version: 1,
    bookId,
    totalCards: allCards.length,
    cards: allCards,
    generatedAt: new Date().toISOString(),
    model: llm.model,
  };

  await fs.writeFile(
    path.join(indexDir, "propositions.json"),
    JSON.stringify(propositionsData, null, 2),
    "utf-8"
  );

  onProgress?.({ percent: 100, message: "命题卡片索引完成" });

  return {
    bookId,
    totalCards: allCards.length,
    indexDir,
  };
}

function collectChapters(
  treeData: TreeData
): Array<{ nodeId: string; title: string; fileName: string }> {
  const chapters: Array<{ nodeId: string; title: string; fileName: string }> = [];
  const nodeFileMap = treeData.nodeFileMap || {};

  function traverseNode(node: TreeNode): void {
    if (node.nodeId && nodeFileMap[node.nodeId]) {
      chapters.push({
        nodeId: node.nodeId,
        title: node.title,
        fileName: nodeFileMap[node.nodeId],
      });
    }
    if (node.nodes) {
      for (const child of node.nodes) {
        traverseNode(child);
      }
    }
  }

  for (const root of treeData.structure || []) {
    traverseNode(root);
  }

  return chapters;
}

async function readChapterContent(mdPath: string): Promise<string> {
  const content = await fs.readFile(mdPath, "utf-8");

  let cleaned = content.replace(/^---[\s\S]*?---\n/, "");
  cleaned = cleaned.replace(/\[\[.*?\]\]/g, "");
  cleaned = cleaned.replace(/> \[!.*?\][^\n]*\n(> .*\n)*/g, "");
  cleaned = cleaned.replace(/%%.*?%%/g, "");
  cleaned = cleaned.replace(/\^[a-zA-Z0-9_-]+/g, "");

  return cleaned.trim();
}

async function vectorizeCards(
  cards: PropositionCard[],
  indexDir: string,
  embedding: EmbeddingOptions
): Promise<void> {
  // 截断保护：BGE 系列有 512 token 限制，其他模型不需要
  const modelName = (embedding.model || "").toLowerCase();
  const isBGE = modelName.includes("bge");
  const MAX_EMBED_CHARS = isBGE ? 400 : 8000;
  const texts = cards.map(c => {
    const raw = `${c.answer}\n${c.context}\n${c.tags.join(" ")}`;
    return raw.length > MAX_EMBED_CHARS ? raw.slice(0, MAX_EMBED_CHARS) : raw;
  });

  // 分批向量化
  const batchSize = 32;
  const allVectors: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const vectors = await generateEmbeddings(batch, embedding);
    allVectors.push(...vectors);
  }

  // Build JSONL records: each line = { cardId, vector }
  const records: string[] = [];
  for (let i = 0; i < cards.length; i++) {
    const record = { cardId: cards[i].id, vector: allVectors[i] };
    records.push(JSON.stringify(record));
  }

  const jsonlPath = path.join(indexDir, "prop-vectors.jsonl");
  await fs.writeFile(jsonlPath, records.join("\n") + "\n", "utf-8");

  piLog(`[proposition-indexer] Vectorized ${cards.length} cards to ${jsonlPath}`);
}
