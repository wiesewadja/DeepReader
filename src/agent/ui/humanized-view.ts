/**
 * HumanizedAgentView - 拟人化 Agent 状态视图
 *
 * 核心原则：
 * 1. Act 阶段：显示当前动作和阅读层次
 * 2. Answer 阶段：显示流式内容
 * 3. 简洁明了，让用户知道正在做什么
 */

import type { HumanizedProgress, AgentAction, ReadingLevel } from './humanized-types';
import { READING_LEVEL_DESCRIPTIONS } from './humanized-types';

/**
 * 创建思考中状态元素
 * 显示当前动作 + 阅读层次徽章
 */
export function createThinkingStatusElement(progress: HumanizedProgress): HTMLElement {
	const container = document.createElement('div');
	container.className = 'deepreader-thinking';

	// 阅读层次徽章
	if (progress.currentReadingLevel) {
		const badge = container.createDiv({ cls: 'reading-level-badge' });
		const levelInfo = READING_LEVEL_DESCRIPTIONS[progress.currentReadingLevel];
		badge.textContent = `${levelInfo.icon} ${levelInfo.name}`;
		badge.addClass(`reading-level-${progress.currentReadingLevel}`);
	}

	// 当前动作（突出显示）
	const currentAction = container.createDiv({ cls: 'thinking-current-action' });
	const icon = currentAction.createSpan({ cls: 'thinking-icon' });
	icon.textContent = '🤔';
	const text = currentAction.createSpan({ cls: 'thinking-text' });
	text.textContent = progress.mainAction.detail || '思考中...';

	return container;
}

/**
 * 更新现有元素（用于流式更新）
 */
export function updateHumanizedStatusElement(
	element: HTMLElement,
	progress: HumanizedProgress
): void {
	// 更新阅读层次徽章
	let badge = element.querySelector('.reading-level-badge') as HTMLElement;
	if (progress.currentReadingLevel) {
		const levelInfo = READING_LEVEL_DESCRIPTIONS[progress.currentReadingLevel];
		if (!badge) {
			badge = document.createElement('div');
			badge.className = 'reading-level-badge';
			element.insertBefore(badge, element.firstChild);
		}
		badge.textContent = `${levelInfo.icon} ${levelInfo.name}`;
		// 更新样式类
		badge.className = 'reading-level-badge';
		badge.classList.add(`reading-level-${progress.currentReadingLevel}`);
	} else if (badge) {
		badge.remove();
	}

	// 更新当前动作
	const textEl = element.querySelector('.thinking-text');
	if (textEl) {
		textEl.textContent = progress.mainAction.detail || '思考中...';
	}
}
