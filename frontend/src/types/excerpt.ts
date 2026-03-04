/**
 * DeepPDF 摘录相关类型定义
 */

/**
 * 摘录内容
 */
export interface ExcerptContent {
	/** 摘录文本内容 */
	text: string;
	/** 原始 Markdown 内容（可选，用于保留格式） */
	rawMarkdown?: string;
}

/**
 * 摘录元数据
 */
export interface ExcerptMetadata {
	/** 来源 PDF 文件名 */
	sourcePdf: string;
	/** 页码（可选) */
	page?: number;
	/** 用户的问题 */
	question?: string;
	/** 创建时间 */
	createdAt: string;
	/** 用户笔记（可选) */
	userNote?: string;
	/** 双向链接（可选，用于跳转回原对话） */
	backlink?: string;
	/** 对话 ID（用于双向链接） */
	conversationId?: string;
	/** 消息 ID（用于双向链接） */
	messageId?: string;
}

/**
 * 摘录选项
 */
export interface ExcerptOptions {
	/** 用户笔记 */
	note?: string;
	/** 目标文件路径（相对于 vault） */
	targetPath?: string;
	/** 是否包含双向链接 */
	includeBacklink?: boolean;
}
