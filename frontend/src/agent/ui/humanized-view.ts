/**
 * HumanizedAgentView - 简化版拟人化 Agent 状态视图
 *
 * 核心原则：
 * 1. Act 阶段：显示进度反馈和已完成的步骤
 * 2. Answer 阶段：显示流式内容
 * 3. 简洁明了，让用户知道正在做什么
 */

import type { HumanizedProgress, AgentAction, ReadingLevel } from './humanized-types';
import { READING_LEVEL_DESCRIPTIONS } from './humanized-types';

/**
 * 创建简洁的思考中状态元素
 * 显示当前动作 + 已完成的步骤列表
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

	// 已完成的步骤（简洁列表）
	const completedSteps = progress.readingSteps.filter(s => s.status === 'done');
	if (completedSteps.length > 0) {
		const stepsContainer = container.createDiv({ cls: 'thinking-steps' });
		const stepsTitle = stepsContainer.createDiv({ cls: 'thinking-steps-title' });
		stepsTitle.textContent = `已完成 ${completedSteps.length} 步`;

		const stepsList = stepsContainer.createDiv({ cls: 'thinking-steps-list' });
		for (const step of completedSteps.slice(-3)) { // 只显示最近3步
			const stepEl = stepsList.createDiv({ cls: 'thinking-step done' });
			stepEl.textContent = `✓ ${step.action}`;
		}
	}

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

	// 更新已完成步骤
	const completedSteps = progress.readingSteps.filter(s => s.status === 'done');
	let stepsContainer = element.querySelector('.thinking-steps') as HTMLElement;

	if (completedSteps.length > 0) {
		if (!stepsContainer) {
			stepsContainer = document.createElement('div');
			stepsContainer.className = 'thinking-steps';
			element.appendChild(stepsContainer);
		}

		// 更新标题
		let stepsTitle = stepsContainer.querySelector('.thinking-steps-title') as HTMLElement;
		if (!stepsTitle) {
			stepsTitle = document.createElement('div');
			stepsTitle.className = 'thinking-steps-title';
			stepsContainer.appendChild(stepsTitle);
		}
		stepsTitle.textContent = `已完成 ${completedSteps.length} 步`;

		// 更新步骤列表
		let stepsList = stepsContainer.querySelector('.thinking-steps-list') as HTMLElement;
		if (!stepsList) {
			stepsList = document.createElement('div');
			stepsList.className = 'thinking-steps-list';
			stepsContainer.appendChild(stepsList);
		}

		// 重新渲染步骤（只显示最近3步）
		stepsList.empty();
		for (const step of completedSteps.slice(-3)) {
			const stepEl = stepsList.createDiv({ cls: 'thinking-step done' });
			stepEl.textContent = `✓ ${step.action}`;
		}
	} else if (stepsContainer) {
		stepsContainer.remove();
	}
}