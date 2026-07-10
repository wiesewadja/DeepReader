import type { App } from 'obsidian';
import { PAGEINDEX_DIR, getPageindexDir } from '../../pageindex/paths.js';
import { vaultRead, vaultWrite, vaultMkdir, vaultExists, joinPath } from '../../utils/mobile-fs.js';
import { nodeFs } from '../../utils/node-fs.js';
import { nodePath } from '../../utils/node-compat.js';


export interface BookGenre {
  /** 主类型 */
  genre: string;
  /** 子类型 */
  subGenre: string;
  /** 整体情绪基调 */
  mood: string;
  /** 文本复杂度 */
  complexity: string;
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

/** LLM 客户端接口 */
interface LLMClient {
  complete(prompt: string): Promise<string>;
}

export class BookGenreDetector {
  private cacheDir: string;
  private llmClient: LLMClient;
  private app?: App;

  constructor(options: {
    vaultPath?: string;
    llmClient: LLMClient;
    app?: App;
  }) {
    this.cacheDir = options.app ? PAGEINDEX_DIR : nodePath().join(options.vaultPath!, getPageindexDir());
    this.llmClient = options.llmClient;
    this.app = options.app;
  }

  /**
   * 推测书籍类型（带缓存）
   * 直接从 .pageindex/{bookId}/tree.json 读取完整目录结构
   */
  async detect(bookId: string): Promise<BookGenre> {
    // 1. 检查缓存
    const cached = await this.loadCachedGenre(bookId);
    if (cached) return cached;

    // 2. 读取 tree.json
    const tree = await this.loadTree(bookId);
    if (!tree) {
      return this.getDefaultGenre();
    }

    // 3. 构造推测 Prompt（基于完整目录结构）
    const prompt = this.buildPrompt(tree);

    // 4. 调用 LLM
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
    const treePath = this.app
      ? joinPath(this.cacheDir, bookId, 'tree.json')
      : nodePath().join(this.cacheDir, bookId, 'tree.json');
    try {
      const data = this.app
        ? await vaultRead(this.app, treePath)
        : await nodeFs().readFile(treePath, 'utf-8');
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
    const cachePath = this.app
      ? joinPath(this.cacheDir, bookId, 'genre.json')
      : nodePath().join(this.cacheDir, bookId, 'genre.json');
    try {
      const data = this.app
        ? await vaultRead(this.app, cachePath)
        : await nodeFs().readFile(cachePath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  private async cacheGenre(bookId: string, genre: BookGenre): Promise<void> {
    const cachePath = this.app
      ? joinPath(this.cacheDir, bookId, 'genre.json')
      : nodePath().join(this.cacheDir, bookId, 'genre.json');
    if (this.app) {
      const dirPath = joinPath(this.cacheDir, bookId);
      if (!(await vaultExists(this.app, dirPath))) {
        await vaultMkdir(this.app, dirPath);
      }
      await vaultWrite(this.app, cachePath, JSON.stringify(genre, null, 2));
    } else {
      await nodeFs().mkdir(nodePath().dirname(cachePath), { recursive: true });
      await nodeFs().writeFile(cachePath, JSON.stringify(genre, null, 2));
    }
  }
}
