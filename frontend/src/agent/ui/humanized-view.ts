/**
 * HumanizedAgentView - 简化版拟人化 Agent 状态视图
 *
 * 核心原则：
 * 1. Act 阶段：只显示"思考中"状态
 * 2. Answer 阶段：显示流式内容
 * 3. 简洁明了，不复杂
 */

import type { HumanizedProgress, AgentAction } from './humanized-types';

/**
 * 创建简洁的思考中状态元素
 * 只显示一个简单的动画状态，不显示详细步骤
 */
export function createThinkingStatusElement(progress: HumanizedProgress): HTMLElement {
	const container = document.createElement('div');
	container.className = 'deepreader-thinking';

	// 图标和文字
	const icon = container.createDiv({ cls: 'thinking-icon' });
	icon.textContent = '🤔';

	const text = container.createDiv({ cls: 'thinking-text' });
	text.textContent = progress.mainAction.detail || '思考中...';

	return container;
}

/**
 * 创建拟人化状态元素（保留完整版以备后用）
 */
export function createHumanizedStatusElement(progress: HumanizedProgress): HTMLElement {
	// 使用简化版本
	return createThinkingStatusElement(progress);
}

/**
 * 更新现有元素（用于流式更新）
 */
export function updateHumanizedStatusElement(
	element: HTMLElement,
	progress: HumanizedProgress
): void {
	// 简化版：只更新文字
	const textEl = element.querySelector('.thinking-text');
	if (textEl) {
		textEl.textContent = progress.mainAction.detail || '思考中...';
	}
}