# 命题卡片系统设计

> **目标**: 为 DeepReader 增加原子事实级索引层，提升阅读对话的检索精度

---

## 一、背景与动机

### 现有问题

当前 PageIndex 的检索粒度是「章节级」：
- BM25/Vector 搜索返回整个章节（可能 5000 字）
- 大模型需要在章节中自行定位答案
- 对于「细节类」问题（如「林黛玉的判词是什么？」），存在检索噪声

### 解决方案

引入「命题卡片」作为精细化索引层：
- 每张卡片代表一个可独立检索的原子事实（~50 字）
- 与 BM25 并行检索，融合后返回给大模型
- 大模型直接看到答案，而非在章节中搜索

---

## 二、决策记录

| 决策项 | 选择 | 理由 |
|--------|------|------|
| **小模型** | 用户可配置（硅基流动接口） | 灵活，用户可选择 Qwen-7B、DeepSeek 等 |
| **卡片数量** | 动态计算（每 500 字 1 张，范围 3-15） | 适应不同章节长度，避免过多或过少 |
| **类型覆盖** | 自动覆盖（Prompt 列 8 种，小模型选择） | 根据内容类型自动适配 |
| **检索路由** | 并行融合（同时检索两层） | 兼顾细节和概览场景 |
| **向量内容** | answer + context + tags | 语义匹配不依赖问题表述 |

---

## 三、卡片类型定义

基于《如何阅读一本书》的分析阅读方法：

| 类型 | 提取什么 | 适用场景 | 示例 |
|------|---------|---------|------|
| **问题** | 作者要解决的问题 | 学术/哲学书籍 | "贾宝玉的命运将如何？" |
| **概念** | 核心概念定义 | 学术/实用书籍 | "判词：预言人物命运的诗句" |
| **主旨** | 作者的核心观点 | 所有类型 | "判词预示主要人物命运" |
| **论述** | 论证逻辑结构 | 学术/哲学书籍 | "用谐音双关暗示人物结局" |
| **结论** | 作者得出的解答 | 所有类型 | "玉带林中挂指林黛玉" |
| **人物** | 人物特征/命运/关系 | 文学作品 | "薛宝钗：金簪雪里埋" |
| **情节** | 关键事件/转折点 | 文学作品 | "宝玉梦游太虚幻境" |
| **象征** | 隐喻/意象/象征义 | 文学作品 | "玉带=玉黛，谐音双关" |

---

## 四、Few-Shot Prompt

```typescript
const PROPOSITION_EXTRACTION_PROMPT = `
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

### 示例1：学术类书籍（哲学/社科）

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

### 示例2：文学类书籍（小说）

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
    },
    {
      "type": "象征",
      "answer": "停机德=薛宝钗（贤德），咏絮才=林黛玉（才女）",
      "context": "可叹停机德，堪怜咏絮才",
      "tags": ["停机德", "咏絮才", "典故", "薛宝钗", "林黛玉"]
    },
    {
      "type": "情节",
      "answer": "宝玉梦游太虚幻境，看到金陵十二钗判词",
      "context": "宝玉看了不解...去开那个",
      "tags": ["梦游", "太虚幻境", "判词", "情节转折"]
    }
  ]
}

### 示例3：实用类书籍（方法论）

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

要求：
- 卡片数量：${targetCards} 张（允许 ±2 偏差）
- 根据内容自动选择合适的类型组合
- 文学作品侧重：人物/情节/象征
- 学术作品侧重：问题/概念/主旨/论述/结论
- 实用作品侧重：概念/主旨/结论

格式要求：
- answer：简洁（≤50字），独立可理解
- context：精准摘录原文（≤200字）
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
```

---

## 五、数据结构

### 5.1 PropositionCard 类型定义

```typescript
// src/pageindex/book-types.ts

export type CardType = 
  | '问题' 
  | '概念' 
  | '主旨' 
  | '论述' 
  | '结论' 
  | '人物' 
  | '情节' 
  | '象征';

export interface PropositionCard {
  id: string;               // card_001, card_002...
  type: CardType;           // 卡片类型
  answer: string;           // 简洁答案（≤50字）
  context: string;          // 原文支撑（≤200字）
  tags: string[];           // 多角度关键词
  sourceNodeId: string;     // 关联章节 nodeId
}

export interface PropositionsData {
  version: number;          // 1
  bookId: string;
  totalCards: number;
  cards: PropositionCard[];
  generatedAt: string;      // ISO timestamp
  model: string;            // 使用的模型
}
```

### 5.2 向量存储

复用现有 `vault/vectors.ts` 的 Float32 格式：

```typescript
// prop_vectors.f32
// 每张卡片一个向量，维度与 embedding 配置一致
// 向量内容：answer + context + tags.join(' ')
```

---

## 六、存储结构

```
.pageindex/{bookId}/
├── tree.json           # 现有骨架（不变）
├── bm25.json           # 现有 BM25（不变）
├── vectors.f32         # 现有向量（不变）
├── book-meta.json      # 现有元数据（增加 propositions 字段）
├── propositions.json   # 新增：命题卡片库
└── prop_vectors.f32    # 新增：卡片向量
```

### 6.1 book-meta.json 扩展

```json
{
  "version": 2,
  "bookId": "abc123",
  "title": "红楼梦",
  "propositions": {
    "enabled": true,
    "totalCards": 285,
    "model": "Qwen/Qwen2.5-7B-Instruct",
    "generatedAt": "2026-04-15T10:00:00Z"
  }
}
```

---

## 七、索引流程

### 7.1 预处理流程图

```
章节文本 → 切分 → 小模型抽取 → 校验 → 向量化 → 存储

具体步骤：
1. 从 tree.json 获取章节列表
2. 每章节计算目标卡片数：targetCards = clamp(chapterLength/500, 3, 15)
3. 调用小模型 API（用户配置的模型）
4. 解析 JSON 输出，校验卡片数量（允许 ±2）
5. 调用 Embedding API 向量化（answer + context + tags）
6. 存储到 propositions.json + prop_vectors.f32
```

### 7.2 索引代码结构

```typescript
// src/pageindex/proposition-indexer.ts

export async function indexPropositions(
  options: PropositionIndexOptions
): Promise<PropositionIndexResult> {
  const { bookId, treeData, embedding, llmConfig, vaultPath } = options;
  
  // 1. 遍历章节
  const allCards: PropositionCard[] = [];
  
  for (const node of treeData.structure) {
    const chapterText = await readChapterContent(node, vaultPath);
    const targetCards = calculateTargetCards(chapterText.length);
    
    // 2. 调用小模型
    const prompt = buildExtractionPrompt(chapterText, targetCards);
    const response = await callLLM(prompt, llmConfig);
    const cards = parseCards(response, node.nodeId);
    
    // 3. 校验数量
    if (cards.length < targetCards - 2) {
      console.warn(`[Propositions] 卡片不足：${cards.length} < ${targetCards}`);
    }
    
    allCards.push(...cards);
  }
  
  // 4. 向量化
  const vectors = await vectorizeCards(allCards, embedding);
  await saveVectorStore(vectors, bookId, embedding.dimensions);
  
  // 5. 存储
  await savePropositions(allCards, bookId);
  
  return { bookId, totalCards: allCards.length };
}

function calculateTargetCards(length: number): number {
  return Math.max(3, Math.min(15, Math.floor(length / 500)));
}
```

---

## 八、检索流程

### 8.1 并行融合算法

```typescript
// src/pageindex/proposition-search.ts

export async function searchWithPropositions(
  options: BookSearchOptionsV2
): Promise<BookSearchResultV2[]> {
  const { query, bookId, embedding, topK = 5 } = options;
  
  // 并行检索
  const [bm25Results, propResults] = await Promise.all([
    searchBM25(query, bookId, topK * 2),
    searchPropositions(query, bookId, embedding, topK * 2)
  ]);
  
  // 融合策略
  const fused = fuseResults(propResults, bm25Results, {
    propWeight: 0.6,    // 命题卡片权重更高（更精准）
    bm25Weight: 0.4
  });
  
  return fused.slice(0, topK);
}

async function searchPropositions(
  query: string,
  bookId: string,
  embedding: EmbeddingOptions,
  topK: number
): Promise<PropositionMatch[]> {
  // 1. Query 向量化
  const queryVector = await generateEmbedding(query, embedding);
  
  // 2. 加载卡片向量库
  const store = await loadPropVectorStore(bookId);
  
  // 3. 向量搜索
  const matches = await cosineSearch(queryVector, store, topK);
  
  // 4. 加载卡片详情
  const propositions = await loadPropositions(bookId);
  
  return matches.map(m => ({
    card: propositions.cards.find(c => c.id === m.nodeId),
    score: m.score
  }));
}
```

### 8.2 返回给大模型的上下文格式

```typescript
// 检索结果格式化
function formatPropositionResults(results: PropositionMatch[]): string {
  return results.map(r => `
【${r.card.type}】${r.card.answer}
原文：${r.card.context}
关键词：${r.card.tags.join('、')}
`).join('\n---\n');
}

// 示例输出：
/*
【象征】玉带林中挂=林黛玉（玉带谐音玉黛）
原文：玉带林中挂
关键词：林黛玉、玉带、谐音、象征、双关
---
【人物】薛宝钗：金簪雪里埋，暗示婚姻冰冷结局
原文：金簪雪里埋
关键词：薛宝钗、金簪、命运、结局
---
【主旨】判词预示黛玉和宝钗的命运
原文：可叹停机德，堪怜咏絮才。玉带林中挂，金簪雪里埋
关键词：判词、命运预示、林黛玉、薛宝钗
*/
```

---

## 九、配置项

### 9.1 插件设置扩展

```typescript
// src/types.ts

export interface DeepReaderSettings {
  // 现有配置...
  
  // 新增：命题卡片配置
  propositions: {
    enabled: boolean;              // 是否启用（默认 true）
    
    // 小模型配置（硅基流动）
    llm: {
      provider: 'siliconflow' | 'openai' | 'deepseek';
      model: string;               // 如 'Qwen/Qwen2.5-7B-Instruct'
      apiKey: string;
      baseUrl: string;             // 如 'https://api.siliconflow.cn/v1'
    };
    
    // 卡片密度
    cardsPer500Words: number;      // 默认 1
    minCardsPerChapter: number;    // 默认 3
    maxCardsPerChapter: number;    // 默认 15
    
    // 是否在索引时自动生成
    autoIndex: boolean;            // 默认 true
  };
}
```

### 9.2 默认配置

```typescript
const DEFAULT_PROPOSITION_SETTINGS = {
  enabled: true,
  llm: {
    provider: 'siliconflow',
    model: 'Qwen/Qwen2.5-7B-Instruct',
    apiKey: '',  // 用户填写
    baseUrl: 'https://api.siliconflow.cn/v1'
  },
  cardsPer500Words: 1,
  minCardsPerChapter: 3,
  maxCardsPerChapter: 15,
  autoIndex: true
};
```

---

## 十、成本估算

### 10.1 20万字小说示例

| 阶段 | Token 数量 | 成本估算（硅基流动） |
|------|-----------|---------------------|
| 卡片抽取 | 输入 200k + 输出 30k | ~$0.06 |
| 卡片向量化 | ~15k（280张卡片） | ~$0.003 |
| **总计** | | **~$0.063** |

对比现有 PageIndex 索引成本（~$0.15），增加约 $0.06。

### 10.2 不同书籍类型

| 书籍类型 | 字数 | 预估卡片数 | 成本 |
|---------|------|-----------|------|
| 小说（红楼梦） | 20万字 | 280张 | ~$0.06 |
| 学术（哲学书） | 10万字 | 150张 | ~$0.03 |
| 实用（方法论） | 5万字 | 80张 | ~$0.02 |

---

## 十一、实现任务清单

### Phase 1: 数据结构与存储

- [ ] 定义 `PropositionCard` 类型（book-types.ts）
- [ ] 扩展 `book-meta.json` 结构
- [ ] 实现 `proposition-indexer.ts` 核心逻辑

### Phase 2: 索引流程

- [ ] 实现 `calculateTargetCards()` 函数
- [ ] 实现 `buildExtractionPrompt()`（Few-Shot 版）
- [ ] 实现小模型调用（支持硅基流动）
- [ ] 实现卡片数量校验
- [ ] 实现卡片向量化（复用 vectors.ts）
- [ ] 集成到 `indexBook()` 流程

### Phase 3: 检索流程

- [ ] 实现 `searchPropositions()` 函数
- [ ] 实现 `searchWithPropositions()`（并行融合）
- [ ] 实现检索结果格式化
- [ ] 更新 `book-search.ts` 支持双层检索

### Phase 4: 配置与 UI

- [ ] 扩展插件设置（propositions 配置）
- [ ] 添加「重新生成命题卡片」命令
- [ ] 在索引进度中显示「命题卡片提取」步骤

---

## 十二、后续优化方向

### 12.1 类型权重

不同类型卡片可以有不同检索权重：
- 文学作品：象征、人物权重高
- 学术作品：概念、论述权重高
- 可在配置中调整

### 12.2 卡片去重

相邻章节可能产生重复卡片，需要去重逻辑：
- 比较 answer 的向量相似度
- 合理重叠度阈值（如 0.85）

### 12.3 用户反馈

用户可以标注「这张卡片有用/无用」，反馈用于：
- 调整小模型的提取倾向
- 筛选低质量卡片

---

## 附录：参考文献

- Mortimer Adler, *How to Read a Book*（分析阅读方法）
- LLMLingua（Token 压缩算法）
- GraphRAG（命题化索引概念）