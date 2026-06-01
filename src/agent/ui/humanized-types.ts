/**
 * 拟人化 Agent 状态类型
 *
 * 所有状态都用用户友好的语言描述
 */

/**
 * 阅读层次（基于《如何阅读一本书》四层次阅读法）
 * 注意：'skill' 是特殊类型，不属于阅读层次，但需要追踪
 */
export type ReadingLevel = 'elementary' | 'inspectional' | 'analytical' | 'syntopical' | 'skill';

/**
 * 工具到阅读层次的映射
 */
export const TOOL_TO_READING_LEVEL: Record<string, ReadingLevel> = {
	get_document_outline: 'inspectional',
	search_markdown_text: 'inspectional',
	read_markdown_section: 'analytical',
	search_read_books: 'syntopical',
	// 分析阅读工具（合并：术语+论点分析）
	analyze_chapter: 'analytical',
	// 可视化工具
	excalidraw: 'analytical',
	// 辅助工具
	Skill: 'skill',
	skill: 'skill',
};

/**
 * 阅读层次描述
 */
export const READING_LEVEL_DESCRIPTIONS: Record<ReadingLevel, { name: string; action: string; icon: string }> = {
	elementary: { name: '基础阅读', action: '理解基本概念', icon: '📖' },
	inspectional: { name: '检视阅读', action: '浏览结构，抓取要点', icon: '🔍' },
	analytical: { name: '分析阅读', action: '深入阅读，咀嚼消化', icon: '🧐' },
	syntopical: { name: '主题阅读', action: '跨书比较，建立关联', icon: '📚' },
	skill: { name: '加载技能', action: '获取专业指导', icon: '🎓' },
};

/**
 * Agent 动作类型（拟人化）
 */
export type AgentAction =
	| { type: 'reading'; detail: string } // 阅读书籍
	| { type: 'searching'; detail: string } // 搜索内容
	| { type: 'thinking'; detail: string } // 思考中
	| { type: 'writing'; detail: string } // 整理回答
	| { type: 'waiting'; detail: string }; // 等待中

/**
 * 拟人化进度信息
 */
export interface HumanizedProgress {
	/** 当前主状态 */
	mainAction: AgentAction;
	/** 思考气泡内容（可选） */
	thoughtBubble?: string;
	/** 已生成的内容（流式） */
	generatedContent: string;
	/** 整体进度 0-100 */
	overallProgress: number;
	/** 当前阅读层次 */
	currentReadingLevel?: ReadingLevel;
}

/**
 * 从 markdown 文件路径中提取章节名称
 * 例如: "如何阅读一本书/05-第二章 阅读的层次.md" -> "第二章 阅读的层次"
 */
function extractChapterNameFromPath(path: string): string | null {
	const filename = path.split('/').pop() || '';
	// 移除扩展名
	const nameWithoutExt = filename.replace(/\.md$/, '');
	// 尝试提取章节名（格式: "数字-章节名" 或 "数字_章节名"）
	const match = nameWithoutExt.match(/^\d+[-_](.+)$/);
	if (match) {
		return match[1];
	}
	// 如果没有数字前缀，直接返回名称
	return nameWithoutExt || null;
}

/**
 * 工具名称到拟人化动作的映射
 * @param args 工具参数
 * @param context 可选的上下文信息（包含 markdownFiles 映射）
 */
export const TOOL_TO_ACTION: Record<string, (args: Record<string, unknown>, context?: { markdownFiles?: Record<string, string> }) => string> = {
	search_markdown_text: (args) => {
		const query = String(args.query || '相关内容').slice(0, 20);
		return `🔍 在书中搜索「${query}」`;
	},
	read_markdown_section: (args, context) => {
		const heading = String(args.heading || '');
		if (heading) {
			return `📖 深入阅读「${heading.slice(0, 20)}」`;
		}
		return `📖 深入阅读章节`;
	},
	get_document_outline: (args) => {
		const detail = String(args.detail || 'simple');
		if (detail === 'simple') return '📋 浏览全书目录';
		return `📋 分析书籍架构`;
	},
	analyze_chapter: (args) => {
		const type = String(args.type || 'both');
		if (type === 'terms') return '🧠 识别作者的关键术语';
		if (type === 'propositions') return '💡 提取作者的核心论点';
		return '🧐 分析章节内容';
	},
	search_read_books: (args) => {
		const query = String(args.query || '相关内容').slice(0, 15);
		return `📚 跨书查找「${query}」`;
	},
	add_memory: () => '📝 记下这个要点',
	search_memory: () => '💭 回忆之前的内容',
	write_note: (args) => `✍️ 整理笔记「${String(args.path || '')}」`,
	excalidraw: (args) => {
		const dtype = String(args.diagramType || 'mindmap');
		if (dtype === 'knowledge_graph') return '🔗 生成知识图谱';
		return '🗺️ 生成思维导图';
	},
	Skill: (args) => `🎓 加载技能「${String(args.skill || '专业知识')}」`,
	skill: (args) => `🎓 加载技能「${String(args.skill || '专业知识')}」`, // 兼容小写
};

/**
 * 生成思考气泡内容
 */
export function generateThoughtBubble(
	context: 'starting' | 'found' | 'confused' | 'summarizing' | 'reflecting'
): string {
	const thoughts: Record<string, string[]> = {
		starting: [
			'让我想想从哪里开始...',
			'这个问题很有意思...',
			'让我先了解一下背景...',
		],
		found: [
			'找到了一些相关内容...',
			'这里有个关键点...',
			'嗯，这段话说得很清楚...',
		],
		confused: [
			'让我换个角度看看...',
			'这个概念需要再确认一下...',
			'我需要更多信息来回答这个问题...',
		],
		summarizing: [
			'让我整理一下思路...',
			'核心观点应该是...',
			'可以从这几个层面来概括...',
		],
		reflecting: [
			'这个角度也值得考虑...',
			'用户可能还想知道...',
			'让我再补充一点...',
		],
	};

	const options = thoughts[context] || thoughts.starting;
	return options[Math.floor(Math.random() * options.length)];
}
