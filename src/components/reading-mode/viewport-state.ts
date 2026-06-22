import { App } from 'obsidian';

/**
 * 判断当前 Obsidian 视口是否“完全展开”且无分屏。
 * 判定条件：
 * 1. rootSplit 只有 1 个子节点（即工作区未分屏）
 * 2. 左侧栏已收起
 * 3. 右侧栏已收起
 */
export function isViewportFullyExpanded(app: App): boolean {
	const workspace = app.workspace;
	if (!workspace) return false;

	const rootSplit = (workspace as any).rootSplit;
	const leftSplit = (workspace as any).leftSplit;
	const rightSplit = (workspace as any).rightSplit;

	if (!rootSplit || !leftSplit || !rightSplit) return false;

	// rootSplit.children 存在且长度为 1，且左右边栏的 collapsed 属性均为 true
	return (
		Array.isArray(rootSplit.children) &&
		rootSplit.children.length === 1 &&
		leftSplit.collapsed === true &&
		rightSplit.collapsed === true
	);
}
