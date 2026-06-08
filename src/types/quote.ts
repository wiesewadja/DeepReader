/**
 * 引用元数据 — 阅读模式与聊天输入之间传递的引用信息
 */

export interface QuoteMetadata {
	/** 选中的文本内容 */
	text: string;
	/** 来源文件路径 */
	sourcePath?: string;
	/** 来源文件名（不含路径） */
	source?: string;
	/** block_id（如 ^ch1-p3） */
	blockId?: string;
	/** 章节 node_id */
	nodeId?: string;
	/** 所属标题 */
	heading?: string;
	/** 完整标题路径（如 ["第一章", "1.1 什么是投资"]） */
	headingPath?: string[];
}
