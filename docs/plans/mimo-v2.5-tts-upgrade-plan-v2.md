# MiMo-V2.5-TTS 升级方案（修正版）

> **目标**: 升级至 MiMo-V2.5-TTS，通过 LLM 推测书籍类型，文本级动态语速/情感控制，让朗读更接近真人。  
> **修正要点**:  
> 1. 不依赖不可靠的 `booklists`/`tags`，改用 LLM 分析书籍描述推测类型  
> 2. 语速不是固定值，而是根据文本内容动态变化  
> **影响范围**: `src/services/tts/*`、`src/pageindex/*`、`src/config/*`、`src/views/sidebar-view.ts`  
> **预计工作量**: 4-6 天

---

## 1. 修正后的核心设计思想

### 1.1 书籍类型推测：从"用户标注"转向"AI 理解"

**原方案的问题**：
- `booklists` 和 `tags` 是用户手动填写的，大部分书籍为空
- 即使用户填写了，分类粒度粗糙（如只标了"文学"），无法区分小说/散文/诗歌的语气差异

**修正后方案**：
```
书籍元数据（title, author, description）
    ↓
BookGenreDetector（调用 LLM，轻量级 router 模型）
    ↓
结构化类型标签：{ genre, subGenre, mood, complexity }
    ↓
缓存到 .pageindex/{bookId}/genre.json（一次推测，终身复用）
```

### 1.2 动态语速：从"固定倍率"转向"文本级标记"

**原方案的问题**：
- 一本书固定一个语速（如小说 0.9x），无法表达段落间的情绪起伏
- 真实的朗读应该：紧张段落加快、抒情段落放缓、列举段落轻快

**修正后方案**：
```
原始文本
    ↓
ExpressivePreprocessor（调用 LLM，分析情感节奏）
    ↓
输出带朗读标记的文本：
    
    （语气放缓，温柔）林黛玉微微一笑，眼角却带着淡淡的忧愁。
    （恢复正常）宝玉看着她的背影，一时竟说不出话来。
    （语速加快，兴奋）忽然，门外传来一阵急促的脚步声！
    
    ↓
MiMo V2.5 理解文本中的情感标记，自动调节语气和节奏
```

**关键洞察**：MiMo V2.5 的 `scene` + `emotion` 参数控制**全局基调**，而文本中的自然语言标记控制**局部变化**。两者结合，实现"大方向稳定，小细节灵动"。

---

## 2. 新架构设计

```
┌─────────────────────────────────────────────────────────────────────┐
│                        TTSService (tts-service.ts)                   │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  BookGenreDetector (新增)                                     │  │
│  │  - 输入: { title, author, description }                       │  │
│  │  - 输出: BookGenre { genre, subGenre, mood, complexity }      │  │
│  │  - 缓存: .pageindex/{bookId}/genre.json                       │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                              │                                       │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  ExpressivePreprocessor (新增，复用 summarizer LLM)           │  │
│  │  - 输入: rawText + BookGenre                                  │  │
│  │  - 输出: expressiveText（带情感/节奏标记）                    │  │
│  │  - 规则: 不改动原文，只在段落前加标记                         │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                              │                                       │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  VoiceProfileResolver (新增)                                  │  │
│  │  - 输入: BookGenre                                            │  │
│  │  - 输出: VoiceProfile { voice, scene, emotion, baseSpeed }    │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                              │                                       │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  TTSClient (tts-client.ts) — 升级                             │  │
│  │  - model: MiMo-V2.5-TTS                                       │  │
│  │  - 全局参数: audio { voice, scene, emotion, speed }           │  │
│  │  - 文本已含局部标记，无需额外参数                             │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. 新增模块详细设计

### 3.1 BookGenreDetector — 书籍类型推测器

**定位**: 利用 LLM 分析整本书的目录结构（tree.json），推测最准确的类型标签。目录结构比单纯的书名/描述更可靠，因为章节标题和摘要直接反映了书籍的内容组织方式和主题分布。

```typescript
// src/services/tts/book-genre-detector.ts

import * as fs from 'fs/promises';
import * as path from 'path';

export interface BookGenre {
  /** 主类型 */
  genre: 'fiction' | 'non-fiction' | 'academic' | 'poetry' | 
         'business' | 'history' | 'philosophy' | 'science' | 'children' | 'self-help' | string;
  /** 子类型 */
  subGenre: string;
  /** 整体情绪基调 */
  mood: 'warm' | 'serious' | 'melancholy' | 'lively' | 'mysterious' | 'epic' | 'intimate' | string;
  /** 文本复杂度 */
  complexity: 'simple' | 'moderate' | 'complex' | 'dense';
  /** 建议全局语速 */
  suggestedSpeed: number;
  /** 推测依据 */
  reasoning: string;
}

/** tree.json 中的节点结构 */
interface TreeNode {
  title: string;
  nodeId?: string;
  summary?: string;
  nodes?: TreeNode[];
}

/** tree.json 根结构 */
interface BookTree {
  title: string;
  docDescription?: string;
  structure: TreeNode[];
}

export class BookGenreDetector {
  private cacheDir: string;
  private llmClient: { complete(prompt: string): Promise<string> };

  constructor(options: {
    vaultPath: string;
    llmClient: { complete(prompt: string): Promise<string> };
  }) {
    this.cacheDir = path.join(options.vaultPath, '.pageindex');
    this.llmClient = options.llmClient;
  }

  /**
   * 推测书籍类型（带缓存）
   * 直接从 .pageindex/{bookId}/tree.json 读取整本书的目录结构
   */
  async detect(bookId: string): Promise<BookGenre> {
    // 1. 检查缓存
    const cached = await this.loadCachedGenre(bookId);
    if (cached) return cached;

    // 2. 读取 tree.json
    const tree = await this.loadTree(bookId);
    if (!tree) {
      // 无 tree 数据时返回默认
      return this.getDefaultGenre();
    }

    // 3. 构造推测 Prompt（基于完整目录结构）
    const prompt = this.buildPrompt(tree);

    // 4. 调用 LLM（轻量级模型，成本低）
    const response = await this.llmClient.complete(prompt);

    // 5. 解析 JSON
    const genre = this.parseGenreResponse(response);

    // 6. 写入缓存
    await this.cacheGenre(bookId, genre);

    return genre;
  }

  /**
   * 从 .pageindex/{bookId}/tree.json 加载书籍目录树
   */
  private async loadTree(bookId: string): Promise<BookTree | null> {
    const treePath = path.join(this.cacheDir, bookId, 'tree.json');
    try {
      const data = await fs.readFile(treePath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  /**
   * 将目录树结构化为文本，供 LLM 分析
   */
  private formatTreeForPrompt(nodes: TreeNode[], depth: number = 0): string {
    const indent = '  '.repeat(depth);
    const lines: string[] = [];
    
    for (const node of nodes) {
      // 主标题
      lines.push(`${indent}- ${node.title}`);
      
      // 章节摘要（如果有，且不是顶层节点）
      if (node.summary && depth > 0) {
        const summaryPreview = node.summary.slice(0, 120);
        lines.push(`${indent}  摘要：${summaryPreview}${node.summary.length > 120 ? '...' : ''}`);
      }
      
      // 递归处理子节点
      if (node.nodes && node.nodes.length > 0) {
        lines.push(this.formatTreeForPrompt(node.nodes, depth + 1));
      }
    }
    
    return lines.join('\n');
  }

  /**
   * 构建 LLM 分析 Prompt
   */
  private buildPrompt(tree: BookTree): string {
    const treeText = this.formatTreeForPrompt(tree.structure);
    const description = tree.docDescription 
      ? `\n【书籍简介】\n${tree.docDescription}\n` 
      : '';

    return `你是一位精通文学分类和阅读心理学的专家。请根据以下书籍的完整目录结构，深入分析这本书的类型、风格和适合的朗读方式。

【书名】
${tree.title}
${description}
【完整目录结构】
${treeText}

【分析任务】
请基于以上目录结构（特别是章节标题的组织方式和内容摘要），输出 JSON 格式：

{
  "genre": "主类型（fiction/non-fiction/academic/poetry/business/history/philosophy/science/children/self-help/biography/psychology）",
  "subGenre": "子类型（如：科幻小说、人物传记、投资指南、存在主义哲学、认知心理学）",
  "mood": "整体情绪基调（warm/serious/melancholy/lively/mysterious/epic/intimate/reflective）",
  "complexity": "文本复杂度（simple/moderate/complex/dense）",
  "suggestedSpeed": "建议全局语速（0.7-1.3 之间）",
  "reasoning": "详细说明推测依据，引用具体的章节标题作为证据"
}

【分析指引】
1. 重点关注目录的组织逻辑：
   - 按时间线组织 → 历史/传记
   - 按概念/理论组织 → 学术/哲学
   - 按情节/故事线组织 → 小说/文学
   - 按步骤/方法组织 → 实用/商业/自助
   - 按人物/对话组织 → 戏剧/小说

2. 从章节标题判断内容性质：
   - 出现"第一章/第二章"+抽象概念 → 学术/理论
   - 出现具体人名/地名+事件 → 历史/传记/小说
   - 出现"如何/怎样/步骤" → 实用/自助
   - 出现"案例/分析/数据" → 商业/经济
   - 出现诗词/意象/情感词汇 → 文学/诗歌

3. 从摘要判断语言风格：
   - 客观、分析性语言 → 学术/严肃
   - 叙事、描写性语言 → 文学/小说
   - 指令、操作性语言 → 实用/手册
   - 抒情、感悟性语言 → 散文/哲学

4. suggestedSpeed 设定原则：
   - 哲学/学术/理论：0.8-0.95（慢速，给听众思考时间）
   - 历史/传记：0.95-1.0（中速，保持叙事节奏）
   - 小说/文学：0.9-1.05（中等，根据情节起伏）
   - 商业/实用/自助：1.05-1.15（稍快，高效传递信息）
   - 诗歌/散文：0.8-0.9（慢速，品味语言美感）
   - 儿童/科普：1.1-1.25（轻快，保持注意力）

注意：
- 不要仅凭书名判断，必须结合目录结构和摘要
- 中文书籍注意区分：严肃学术 vs 通俗科普 vs 网络爽文
- 对于跨学科书籍（如"行为经济学"），选择最贴近读者体验的类型`;
  }

  private parseGenreResponse(response: string): BookGenre {
    try {
      // 尝试从 Markdown 代码块中提取 JSON
      const jsonMatch = response.match(/```json\n?([\s\S]*?)\n?```/) || 
                        response.match(/{[\s\S]*}/);
      const jsonStr = jsonMatch ? jsonMatch[1] || jsonMatch[0] : response;
      return JSON.parse(jsonStr.trim());
    } catch {
      return this.getDefaultGenre();
    }
  }

  private getDefaultGenre(): BookGenre {
    return {
      genre: 'non-fiction',
      subGenre: '综合读物',
      mood: 'neutral',
      complexity: 'moderate',
      suggestedSpeed: 1.0,
      reasoning: '解析失败或无目录数据，使用默认值',
    };
  }

  private async loadCachedGenre(bookId: string): Promise<BookGenre | null> {
    const cachePath = path.join(this.cacheDir, bookId, 'genre.json');
    try {
      const data = await fs.readFile(cachePath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  private async cacheGenre(bookId: string, genre: BookGenre): Promise<void> {
    const cachePath = path.join(this.cacheDir, bookId, 'genre.json');
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.writeFile(cachePath, JSON.stringify(genre, null, 2));
  }
}
```

**数据来源**：
- **主要依据**: `.pageindex/{bookId}/tree.json` 中的完整目录结构
  - `title` — 书名
  - `docDescription` — 书籍描述（LLM 生成）
  - `structure[]` — 目录树，包含章节标题 + 章节摘要
- **不再依赖**: `booklists`/`tags`（用户手动填写，覆盖率低）

**为什么用 tree 比 description 更好**：
1. **目录结构反映思维方式**: 按时间线组织 vs 按概念组织 vs 按步骤组织，直接体现书籍类型
2. **章节标题即主题**: "第三章 认知偏差"→ 心理学/学术；"第三章 雨夜追杀"→ 小说/悬疑
3. **摘要是内容样本**: LLM 可以从中判断语言风格（客观分析 vs 叙事描写 vs 抒情散文）
4. **难以伪装**: 书名可能被营销包装误导，但目录结构是内容的真实骨架

---

### 3.2 ExpressivePreprocessor — 情感化文本预处理

**定位**: 在送入 TTS 之前，由 LLM 分析文本情感节奏，在段落前添加朗读标记。这些标记作为自然语言提示，引导 TTS 模型在朗读时自动调节语气和语速。

```typescript
// src/services/tts/expressive-preprocessor.ts

export interface ExpressiveTextOptions {
  /** 书籍类型（用于确定全局基调） */
  genre?: BookGenre;
  /** 是否启用情感标记 */
  enableMarks?: boolean;
  /** 标记粒度：paragraph(段落) / sentence(句子) */
  granularity?: 'paragraph' | 'sentence';
}

export class ExpressivePreprocessor {
  private llmClient: { complete(prompt: string): Promise<string> };

  constructor(llmClient: { complete(prompt: string): Promise<string> }) {
    this.llmClient = llmClient;
  }

  /**
   * 为文本添加朗读情感标记
   * 
   * 输出示例：
   * （语气温柔，娓娓道来）林黛玉自幼体弱多病，却也天生聪慧。
   * （语气转为轻快）一日，她在园中偶遇宝玉，两人一见如故。
   * （语速放缓，略带忧伤）然而好景不长，家族衰败的阴云渐渐笼罩...
   */
  async preprocess(text: string, options?: ExpressiveTextOptions): Promise<string> {
    if (!options?.enableMarks) return text;

    const prompt = this.buildPrompt(text, options.genre);
    const response = await this.llmClient.complete(prompt);
    return this.extractMarkedText(response);
  }

  private buildPrompt(text: string, genre?: BookGenre): string {
    const genreContext = genre 
      ? `这是一本「${genre.subGenre}」类型的书籍，整体基调「${genre.mood}」，建议全局语速 ${genre.suggestedSpeed}x。`
      : '';

    return `你是一位专业的有声书导演。请为以下文本添加朗读指导标记。

${genreContext}

【原文】
${text}

【任务要求】
1. 将文本按自然段落切分
2. 在每个段落前添加朗读标记，格式：（语气描述，语速描述）
3. 标记要简洁自然，不超过 15 个字
4. 不要改动原文的任何文字，只添加标记
5. 标记类型参考：
   - 语速：（语速正常）（语速放缓）（语速加快）（轻快节奏）（娓娓道来）
   - 语气：（语气温柔）（语气严肃）（语气兴奋）（略带忧伤）（充满激情）（平静叙述）
   - 组合：（语气温柔，娓娓道来）（语速加快，充满紧张）

【输出格式】
（标记）段落1原文...
（标记）段落2原文...

注意：标记必须与段落紧密相关，不要过度解读。保持原文完整性。`;
  }

  private extractMarkedText(response: string): string {
    // 去除可能的 Markdown 代码块包裹
    const cleaned = response.replace(/```[\s\S]*?```/g, '').trim();
    return cleaned;
  }
}
```

**使用时机**:
- 在 `TTSService.playStream()` 中，文本发送给 TTSClient 之前
- 仅对原文朗读模式（`rawText: true`）启用，摘要朗读已由 Summarizer 处理
- 如果文本过长（>2000 字），分段预处理（避免 LLM 上下文溢出）

---

### 3.3 VoiceProfileResolver — 音色配置解析器（简化版）

**定位**: 根据 `BookGenre` 输出最适合的 V2.5 API 参数。不再需要复杂的映射表，因为类型已由 LLM 推测。

```typescript
// src/services/tts/voice-profile.ts

export interface VoiceProfile {
  voice: string;
  scene: string;
  emotion: string;
  /** 全局基准语速（由 BookGenre.suggestedSpeed 提供） */
  baseSpeed: number;
}

/**
 * 根据书籍类型生成最佳音色配置
 * 规则简单直接：LLM 已做了主要判断，这里只做 API 参数映射
 */
export function resolveVoiceProfile(genre: BookGenre): VoiceProfile {
  // 根据 mood 映射 emotion
  const moodToEmotion: Record<string, string> = {
    'warm': 'warm',
    'serious': 'serious',
    'melancholy': 'melancholy',
    'lively': 'lively',
    'mysterious': 'neutral',
    'epic': 'passionate',
    'intimate': 'warm',
  };

  // 根据 genre 映射 scene
  const genreToScene: Record<string, string> = {
    'fiction': 'narration',
    'non-fiction': 'narration',
    'academic': 'academic',
    'poetry': 'poetry',
    'business': 'business',
    'history': 'history',
    'philosophy': 'philosophy',
    'science': 'academic',
    'children': 'children',
    'self-help': 'narration',
  };

  // 根据 genre + mood 选择音色（实际 ID 以 MiMo 官方为准）
  const voiceMap: Record<string, Record<string, string>> = {
    'fiction': {
      'warm': 'mimo_warm_female',
      'melancholy': 'mimo_melancholy_female',
      'lively': 'mimo_lively_female',
      'default': 'mimo_default_female',
    },
    'academic': {
      'serious': 'mimo_serious_male',
      'default': 'mimo_clear_female',
    },
    'poetry': {
      'melancholy': 'mimo_melancholy_female',
      'warm': 'mimo_warm_female',
      'default': 'mimo_melancholy_female',
    },
    'business': {
      'serious': 'mimo_serious_male',
      'default': 'mimo_professional_male',
    },
    'history': {
      'serious': 'mimo_serious_male',
      'default': 'mimo_serious_male',
    },
    'philosophy': {
      'serious': 'mimo_serious_male',
      'default': 'mimo_serious_male',
    },
    'science': {
      'default': 'mimo_clear_female',
    },
    'children': {
      'lively': 'mimo_lively_female',
      'warm': 'mimo_warm_female',
      'default': 'mimo_lively_female',
    },
  };

  const scene = genreToScene[genre.genre] || 'narration';
  const emotion = moodToEmotion[genre.mood] || 'neutral';
  const genreVoices = voiceMap[genre.genre] || voiceMap['non-fiction'];
  const voice = genreVoices[genre.mood] || genreVoices['default'] || 'mimo_default';

  return {
    voice,
    scene,
    emotion,
    baseSpeed: genre.suggestedSpeed,
  };
}
```

---

## 4. TTSClient 升级（修正版）

### 4.1 请求体改造

```typescript
// tts-client.ts

export interface TTSVoiceOptions {
  voice: string;
  scene: string;
  emotion: string;
  speed: number;
  pitch?: number;
  volume?: number;
}

async synthesize(text: string, options: TTSVoiceOptions): Promise<ArrayBuffer> {
  // V2.5 不再发送风格 Prompt，改用参数控制
  // 文本中已含 ExpressivePreprocessor 添加的朗读标记
  
  const body = {
    model: 'MiMo-V2.5-TTS',
    messages: [
      { role: 'assistant', content: text },  // 仅发送标记后的文本
    ],
    audio: {
      format: 'wav',
      voice: options.voice,
      emotion: options.emotion,
      scene: options.scene,
      speed: options.speed,
      pitch: options.pitch ?? 0,
      volume: options.volume ?? 1.0,
    },
  };

  // ... 原有 fetch 逻辑
}
```

**关键变化**:
- `messages` 仅剩 `assistant` 角色，不再发送 400 字 `XITONG_STYLE_PROMPT`
- 文本中已包含 `(语气描述，语速描述)` 标记，TTS 模型通过理解这些自然语言标记来调节局部节奏
- 全局参数（`scene` + `emotion` + `speed`）控制整体基调

### 4.2 为什么文本标记能控制局部语速？

MiMo V2.5 是端到端的 LLM-based TTS（类似 GPT-SoVITS），模型会理解文本的语义和上下文。当我们在文本中加入：

```
（语气温柔，娓娓道来）林黛玉微微一笑...
（语速加快，紧张）忽然，门外传来一阵急促的脚步声！
```

模型会将括号内的描述视为**导演提示（stage direction）**，在实际合成时：
1. 识别出这些标记是元指令而非正文
2. 将其转化为内部的 prosody 控制
3. 在后续文本中应用对应的语速/语气

这比 SSML 更自然，因为：
- 不需要严格的 XML 语法
- 标记本身就是自然语言，可读性强
- 可以表达复杂的复合情感（如"语气温柔但带着一丝忧伤"）

---

## 5. TTSService 改造（修正版）

### 5.1 新的播放流程

```typescript
class TTSService {
  private genreDetector: BookGenreDetector;
  private expressivePreprocessor: ExpressivePreprocessor;
  // ... 原有依赖

  async play(
    messageId: string,
    content: string,
    userQuestion?: string,
    context?: TTSContext & { bookId?: string },
    options?: { rawText?: boolean }
  ): Promise<void> {
    
    // Step 1: 推测书籍类型（带缓存）
    // BookGenreDetector 自动从 .pageindex/{bookId}/tree.json 读取完整目录结构
    let genre: BookGenre | undefined;
    if (context?.bookId) {
      genre = await this.genreDetector.detect(context.bookId);
    }

    // Step 2: 解析音色配置
    const voiceProfile = genre ? resolveVoiceProfile(genre) : getDefaultVoiceProfile();

    // Step 3: 预处理文本（添加情感标记）
    let textToRead = content;
    if (options?.rawText && genre) {
      // 原文朗读模式：添加情感标记
      textToRead = await this.expressivePreprocessor.preprocess(content, {
        genre,
        enableMarks: true,
        granularity: 'paragraph',
      });
    } else if (!options?.rawText) {
      // 摘要模式：由 Summarizer 生成摘要，摘要文本自带语气
      textToRead = await this.summarizer.summarize(content, userQuestion, context);
    }

    // Step 4: 流式播放
    await this.playStream(messageId, textToRead, voiceProfile);
  }
}
```

### 5.2 新增/移除上下文字段

```typescript
// TTSContext 扩展
export interface TTSContext {
  bookTitle?: string;
  bookAuthor?: string;
  bookId?: string;           // 新增：BookGenreDetector 用它读取 tree.json
  memoryContent?: string;
  // 移除 bookDescription — BookGenreDetector 直接从 tree.json 读取
  // 移除 booklists/tags — 不再依赖用户手动标签
}
```

---

## 6. 数据来源：从 tree.json 读取完整目录

### 6.1 数据流（简化）

```
书籍索引时（book-indexer.ts）
    → 调用 PageIndex 解析书籍
        → 生成 tree.json（包含完整目录结构 + 章节摘要）
        → 保存在 .pageindex/{bookId}/tree.json

朗读时（sidebar-view.ts）
    → 只需传递 currentBookId
    → TTSService → BookGenreDetector
        → 读取 .pageindex/{bookId}/tree.json
        → 提取 { title, docDescription, structure[] }
        → 输入 LLM 分析类型
```

### 6.2 SidebarView 修改（大幅简化）

```typescript
// views/sidebar-view.ts

private async handleTTS(
  messageId: string, 
  content: string, 
  options?: { rawText?: boolean }
): Promise<void> {
  // ... 原有逻辑

  // 只需传递 bookId，BookGenreDetector 会自动读取 tree.json
  await this.ttsService.play(messageId, content, userQuestion, {
    bookId: this.currentBookId,           // 唯一必需的新字段
    bookTitle: this.currentPdfName,       // 用于显示（可选）
    bookAuthor: this.currentBookAuthor,   // 用于显示（可选）
    memoryContent: await new MemoryStore(this.app).readLongTermMemory() || undefined,
  }, options);
}

// 不再需要 loadCurrentBookMeta()！
// BookGenreDetector 内部直接读取 tree.json
```

### 6.3 tree.json 结构示例

```json
{
  "title": "思辨与立场：生活中无处不在的批判性思维工具",
  "docDescription": "本书系统阐述批判性思维，通过剖析思维的层次、要素、标准及认知美德...",
  "structure": [
    {
      "title": "Chapter 1",
      "nodeId": "0001",
      "summary": "本节提供了版权信息和多位学者的赞誉...",
      "text": "=== 版权信息 ===..."
    },
    {
      "title": "01 变革、危险以及复杂性：相互交织",
      "nodeId": "0008",
      "summary": "本章探讨了当今世界的复杂性和变革速度...",
      "nodes": [
        { "title": "1.1 思维的重要性", "summary": "..." },
        { "title": "1.2 批判性思维的定义", "summary": "..." }
      ]
    }
  ]
}
```

**为什么 tree.json 比 book-meta.json 更适合**：
- `tree.json` 包含完整目录结构和章节摘要，信息量更大
- `book-meta.json` 只有 `description`，且可能为空或简略
- 目录结构（`structure[]`）是内容的真实骨架，难以伪装
- `BookGenreDetector` 直接读取 `tree.json`，无需经过 SidebarView 中转

---

## 7. 动态语速的实现细节

### 7.1 两级语速控制

| 层级 | 控制方式 | 粒度 | 实现 |
|------|----------|------|------|
| **全局语速** | `audio.speed` 参数 | 整段文本 | `BookGenre.suggestedSpeed` |
| **局部语速** | 文本中的朗读标记 | 段落/句子 | `ExpressivePreprocessor` 添加的标记 |

**协同效果**:
- 全局语速设定了"基准线"（如小说 0.95x）
- 局部标记在此基础上微调（如"（语速放缓）"→ 相对基准线再降 10%）
- 最终效果：整体舒缓，但紧张段落仍能明显加快

### 7.2 标记示例与预期效果

**原文**:
```
林黛玉自幼体弱多病，却也天生聪慧。一日，她在园中偶遇宝玉，两人一见如故，相谈甚欢。
然而好景不长，家族衰败的阴云渐渐笼罩。黛玉的身体也每况愈下，终日以泪洗面。
宝玉心如刀绞，却无力改变这一切。他只能在夜深人静时，独自对着明月长叹。
```

**预处理后**（文学/小说/忧伤基调）:
```
（语气温柔，娓娓道来）林黛玉自幼体弱多病，却也天生聪慧。一日，她在园中偶遇宝玉，两人一见如故，相谈甚欢。
（语气转沉，语速放缓）然而好景不长，家族衰败的阴云渐渐笼罩。黛玉的身体也每况愈下，终日以泪洗面。
（语气忧伤，轻声叹息）宝玉心如刀绞，却无力改变这一切。他只能在夜深人静时，独自对着明月长叹。
```

**实际朗读效果**:
- 第一段：温暖女声，语速适中（0.95x），像讲故事
- 第二段：语气下沉，语速放缓（约 0.85x），营造压抑感
- 第三段：轻柔忧伤，几乎耳语（约 0.8x），传递无奈

### 7.3 处理边界情况

| 情况 | 策略 |
|------|------|
| 文本已有引号/括号 | 标记使用中文全角括号 `（）`，与文本区分 |
| 技术文档/代码 | 跳过 ExpressivePreprocessor，直接朗读（标记会干扰代码） |
| 文本极短（<50 字） | 只添加一个全局标记，不分段 |
| LLM 预处理失败 | 回退到原文，不影响播放 |
| 标记导致 TTS 读出"括号" | MiMo V2.5 应能识别导演提示，若不行则在客户端过滤 |

---

## 8. 实施步骤（修正版）

### Step 1: 基础模块（Day 1-2）

**Day 1**:
1. **新建 `book-genre-detector.ts`**
   - `BookGenre` 类型定义
   - `BookGenreDetector` 类（LLM 推测 + 文件缓存）
   - 单元测试

2. **新建 `expressive-preprocessor.ts`**
   - `ExpressivePreprocessor` 类
   - 构建 Prompt 模板
   - 单元测试

**Day 2**:
3. **新建 `voice-profile.ts`**
   - `VoiceProfile` 类型
   - `resolveVoiceProfile()` 函数
   - 简化映射（基于 mood + genre）

4. **升级 `tts-client.ts`**
   - 模型改为 `MiMo-V2.5-TTS`
   - 新增 `TTSVoiceOptions` 参数
   - 去掉 `XITONG_STYLE_PROMPT`
   - 支持向后兼容（V2 降级）

### Step 2: TTSService 集成（Day 3）

5. **改造 `tts-service.ts`**
   - 注入 `BookGenreDetector`、`ExpressivePreprocessor`
   - 修改 `play()` 流程（先推测类型 → 再预处理 → 再播放）
   - 扩展 `TTSContext`（新增 `bookId`，移除 `bookDescription`）
   - 清理 `streaming-voice-player.ts`（死代码）

6. **缓存策略更新**
   - 缓存 key 增加 `voice` + `scene` 指纹
   - 不同书籍类型分别缓存

### Step 3: SidebarView 联动（Day 4）

7. **改造 `handleTTS()`**
   - 传递 `bookId` 给 `TTSService`（BookGenreDetector 内部自动读取 tree.json）
   - 不再需要读取 `book-meta.json` 获取 `description`

8. **UI 反馈**
   - 消息气泡显示当前书籍类型和音色信息
   - 设置面板显示推测结果（供用户确认/修正）

### Step 4: 配置层（Day 5）

9. **扩展 `settings.ts`**
   - 新增 `ttsVoiceConfig` 字段
   - 默认启用「自动推测书籍类型」
   - 可选：用户手动覆盖音色

10. **升级 `setting-tab.ts`**
    - 显示当前推测的书籍类型
    - 允许用户手动修正（覆盖 LLM 推测）
    - 试听按钮（用当前配置朗读示例文本）

### Step 5: 测试与优化（Day 6）

11. **E2E 测试**
    - 不同书籍类型的推测准确性
    - 情感标记是否正确添加
    - 朗读体验是否自然

12. **Prompt 优化**
    - 根据实际效果调整 `BookGenreDetector` 的 Prompt
    - 调整 `ExpressivePreprocessor` 的标记策略

---

## 9. 向后兼容性

| 维度 | 策略 |
|------|------|
| **TTS 版本** | `TTSClient` 自动检测模型名：含 `v2.5` → V2.5 参数，否则 V2 Prompt 方式 |
| **书籍描述缺失** | 降级为 `title + author` 推测，再降级为默认类型（non-fiction/moderate/1.0x） |
| **LLM 推测失败** | 捕获异常，使用默认类型，不阻断朗读流程 |
| **预处理失败** | 直接朗读原文（无标记），不影响可用性 |
| **缓存** | 旧缓存（无音色指纹）自然淘汰，新缓存按 `messageId_voice_scene` 存储 |
| **用户配置** | 旧版设置无 `ttsVoiceConfig` 时，默认启用自动推测 |

---

## 10. 预期收益

| 指标 | V2 现状 | V2.5 目标 | 提升 |
|------|---------|-----------|------|
| **书籍类型准确率** | 依赖用户标签（<30% 有标签） | LLM 推测（>90% 准确） | **质的飞跃** |
| **语速灵活性** | 固定 1.0x | 全局基准 + 局部动态标记 | **接近真人** |
| **单次请求 Token** | ~500（含 400 字 Prompt） | ~100（仅文本） | **↓ 80%** |
| **情感表达** | 单一 Prompt 引导 | 全局基调 + 段落级标记 | **细腻丰富** |
| **用户体验** | "机器在读" | "有人在讲故事" | **质变** |

---

## 11. 风险与应对

| 风险 | 概率 | 影响 | 应对 |
|------|:----:|:----:|------|
| LLM 推测书籍类型不准确 | 中 | 中 | 允许用户在设置面板手动修正；Prompt 持续优化 |
| ExpressivePreprocessor 增加延迟 | 中 | 中 | 摘要模式下复用 Summarizer 的 LLM 调用；原文模式下可异步预处理 |
| 文本标记被 TTS 读出 | 低 | 高 | 先在测试环境验证；若 MiMo 不支持导演提示，客户端过滤标记后分段调用 API |
| 段落标记过多导致文本过长 | 低 | 低 | 限制标记长度（<15 字）；长文本分段预处理 |
| tree.json 不存在或损坏 | 低 | 中 | 降级为默认类型（non-fiction/moderate/1.0x）；提示用户重新索引书籍 |

---

## 12. 关键代码变更清单

| 文件 | 变更 | 说明 |
|------|:----:|------|
| `src/services/tts/book-genre-detector.ts` | **新增** | LLM 书籍类型推测 + 缓存 |
| `src/services/tts/expressive-preprocessor.ts` | **新增** | 文本情感标记预处理 |
| `src/services/tts/voice-profile.ts` | **新增** | 简化版音色配置解析 |
| `src/services/tts/tts-client.ts` | **修改** | V2.5 API 参数 + 去掉 Prompt |
| `src/services/tts/tts-service.ts` | **修改** | 集成新模块 + 新播放流程 |
| `src/services/tts/streaming-voice-player.ts` | **删除** | 死代码 |
| `src/services/tts/tts-summarizer.ts` | **可选修改** | 摘要文本自带情感基调 |
| `src/config/settings.ts` | **修改** | 新增 `ttsVoiceConfig` |
| `src/settings/setting-tab.ts` | **修改** | 显示推测结果 + 手动修正 |
| `src/views/sidebar-view.ts` | **修改** | 传递 `bookId`（BookGenreDetector 内部读取 tree.json） |
| `src/services/tts/__tests__/*` | **新增/修改** | 新模块测试 + 旧测试更新 |

---

*修正版方案完成。核心变化：从"依赖用户标签"转向"AI 主动理解"，从"固定语速"转向"文本级动态标记"。请审阅后确认。*
