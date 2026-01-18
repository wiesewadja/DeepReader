/**
 * DeepPDF - 任务队列管理器
 * 管理多个并发的长时间运行任务
 */

import { Notice } from "obsidian";
import { DeepPDFClient, TaskProgress } from "../api/http-client.js";
import { TaskState, TaskStatus, TaskProgressCard, createTaskCard } from "./task-progress-card.js";

// ==================== 任务队列配置 ====================
interface TaskQueueConfig {
    maxConcurrent?: number; // 最大并发任务数
    pollInterval?: number; // 轮询间隔（毫秒）
    autoRemoveCompleted?: boolean; // 是否自动移除已完成的任务
    autoRemoveDelay?: number; // 自动移除延迟（毫秒）
}

// ==================== 任务队列管理器 ====================
export class TaskQueueManager {
    private client: DeepPDFClient;
    private tasks: Map<string, TaskState> = new Map();
    private cards: Map<string, TaskProgressCard> = new Map();
    private container: HTMLElement;
    private config: Required<TaskQueueConfig>;
    private pollTimers: Map<string, number> = new Map();
    private autoRemoveTimers: Map<string, number> = new Map();

    constructor(
        client: DeepPDFClient,
        container: HTMLElement,
        config: TaskQueueConfig = {}
    ) {
        this.client = client;
        this.container = container;
        this.config = {
            maxConcurrent: config.maxConcurrent ?? 3,
            pollInterval: config.pollInterval ?? 2000,
            autoRemoveCompleted: config.autoRemoveCompleted ?? true,
            autoRemoveDelay: config.autoRemoveDelay ?? 5000
        };

        // 清空容器
        this.container.empty();
    }

    /**
     * 添加新任务
     */
    addTask(task: Omit<TaskState, "id" | "startTime">): string {
        const taskId = this.generateTaskId();
        const fullTask: TaskState = {
            ...task,
            id: taskId,
            startTime: Date.now(),
            progress: 0
        };

        this.tasks.set(taskId, fullTask);

        // 创建进度卡片
        const card = createTaskCard(fullTask, this.container, {
            onCancel: (id) => this.cancelTask(id),
            onRetry: (id) => this.retryTask(id)
        });
        this.cards.set(taskId, card);

        // 如果是索引任务，开始轮询
        if (task.type === 'index' && fullTask.result?.index_id) {
            this.startPolling(taskId, fullTask.result.index_id as string);
        }

        return taskId;
    }

    /**
     * 更新任务状态
     */
    updateTask(taskId: string, updates: Partial<TaskState>): void {
        const task = this.tasks.get(taskId);
        if (!task) return;

        const updatedTask = { ...task, ...updates };
        this.tasks.set(taskId, updatedTask);

        // 更新卡片
        const card = this.cards.get(taskId);
        if (card) {
            card.update(updatedTask);
        }

        // 处理任务完成
        if (updates.status === 'completed' || updates.status === 'failed' || updates.status === 'cancelled') {
            this.stopPolling(taskId);
            this.handleTaskCompletion(updatedTask);
        }
    }

    /**
     * 从 API 进度更新任务
     */
    updateFromAPIProgress(taskId: string, progress: TaskProgress): void {
        const task = this.tasks.get(taskId);
        if (!task) return;

        // 映射 API 状态到任务状态
        const statusMap: Record<string, TaskStatus> = {
            'pending': 'pending',
            'processing': 'processing',
            'completed': 'completed',
            'failed': 'failed',
            'cancelled': 'cancelled'
        };

        const updates: Partial<TaskState> = {
            status: statusMap[progress.status] || 'processing',
            message: progress.message,
            progress: progress.progress_percent || 0,
            currentStep: progress.current_step,
            totalSteps: progress.total_steps,
            completedSteps: progress.completed_steps,
            error: progress.error
        };

        // 如果完成，记录结束时间
        if (updates.status === 'completed' || updates.status === 'failed' || updates.status === 'cancelled') {
            updates.endTime = Date.now();
        }

        this.updateTask(taskId, updates);
    }

    /**
     * 取消任务
     */
    async cancelTask(taskId: string): Promise<void> {
        const task = this.tasks.get(taskId);
        if (!task) return;

        // 如果是索引任务，调用 API 取消
        if (task.type === 'index' && task.result?.index_id) {
            try {
                await this.client.cancelTask(task.result.index_id as string);
            } catch (error) {
                console.error('[DeepPDF] 取消任务失败:', error);
            }
        }

        // 更新状态
        this.updateTask(taskId, {
            status: 'cancelled',
            endTime: Date.now()
        });
    }

    /**
     * 重试失败的任务
     */
    retryTask(taskId: string): void {
        const task = this.tasks.get(taskId);
        if (!task || task.status !== 'failed') return;

        // 移除旧任务
        this.removeTask(taskId);

        // 触发重试回调（需要在外部实现）
        new Notice("任务重试功能需要在外部实现具体逻辑");
    }

    /**
     * 移除任务
     */
    removeTask(taskId: string): void {
        this.stopPolling(taskId);
        this.clearAutoRemoveTimer(taskId);

        const card = this.cards.get(taskId);
        if (card) {
            card.destroy();
            this.cards.delete(taskId);
        }

        const taskElement = this.container.querySelector(`[data-task-id="${taskId}"]`);
        if (taskElement) {
            taskElement.remove();
        }

        this.tasks.delete(taskId);
    }

    /**
     * 获取所有任务
     */
    getAllTasks(): TaskState[] {
        return Array.from(this.tasks.values());
    }

    /**
     * 获取指定状态的任务
     */
    getTasksByStatus(status: TaskStatus): TaskState[] {
        return Array.from(this.tasks.values()).filter(t => t.status === status);
    }

    /**
     * 获取活动中的任务数量
     */
    getActiveCount(): number {
        return Array.from(this.tasks.values()).filter(
            t => t.status === 'pending' || t.status === 'processing'
        ).length;
    }

    /**
     * 清空所有任务
     */
    clearAll(): void {
        this.tasks.forEach((_, taskId) => {
            this.removeTask(taskId);
        });
    }

    /**
     * 开始轮询任务进度
     */
    private startPolling(taskId: string, indexId: string): void {
        // 清除现有定时器
        this.stopPolling(taskId);

        const timer = window.setInterval(async () => {
            try {
                const progress = await this.client.getTaskProgress(indexId);
                this.updateFromAPIProgress(taskId, progress);
            } catch (error) {
                console.error(`[DeepPDF] 轮询任务 ${taskId} 失败:`, error);
                // 不要停止轮询，可能是暂时网络错误
            }
        }, this.config.pollInterval);

        this.pollTimers.set(taskId, timer);
    }

    /**
     * 停止轮询
     */
    private stopPolling(taskId: string): void {
        const timer = this.pollTimers.get(taskId);
        if (timer) {
            clearInterval(timer);
            this.pollTimers.delete(taskId);
        }
    }

    /**
     * 处理任务完成
     */
    private handleTaskCompletion(task: TaskState): void {
        // 显示通知
        let message = "";
        let timeout = 3000;

        switch (task.status) {
            case 'completed':
                message = `${task.title} 已完成`;
                if (task.type === 'index' && task.result?.node_count) {
                    message += ` (${task.result.node_count} 个节点)`;
                }
                break;
            case 'failed':
                message = `${task.title} 失败: ${task.error || '未知错误'}`;
                timeout = 5000;
                break;
            case 'cancelled':
                message = `${task.title} 已取消`;
                timeout = 2000;
                break;
        }

        new Notice(message, timeout);

        // 自动移除已完成的任务
        if (this.config.autoRemoveCompleted) {
            this.scheduleAutoRemove(task.id);
        }
    }

    /**
     * 安排自动移除任务
     */
    private scheduleAutoRemove(taskId: string): void {
        this.clearAutoRemoveTimer(taskId);

        const timer = window.setTimeout(() => {
            this.removeTask(taskId);
        }, this.config.autoRemoveDelay);

        this.autoRemoveTimers.set(taskId, timer);
    }

    /**
     * 清除自动移除定时器
     */
    private clearAutoRemoveTimer(taskId: string): void {
        const timer = this.autoRemoveTimers.get(taskId);
        if (timer) {
            clearTimeout(timer);
            this.autoRemoveTimers.delete(taskId);
        }
    }

    /**
     * 生成任务 ID
     */
    private generateTaskId(): string {
        return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * 销毁管理器
     */
    destroy(): void {
        // 清除所有定时器
        this.pollTimers.forEach((timer) => clearInterval(timer));
        this.autoRemoveTimers.forEach((timer) => clearTimeout(timer));

        // 销毁所有卡片
        this.cards.forEach((card) => card.destroy());

        // 清空数据
        this.tasks.clear();
        this.cards.clear();
        this.pollTimers.clear();
        this.autoRemoveTimers.clear();
        this.container.empty();
    }
}

// ==================== 便捷工厂函数 ====================

/**
 * 创建索引任务并添加到队列
 */
export function createIndexTask(
    queue: TaskQueueManager,
    pdfName: string,
    indexId: string
): string {
    return queue.addTask({
        type: 'index',
        status: 'pending',
        title: `索引: ${pdfName}`,
        message: '任务已创建，等待处理...',
        progress: 0,
        result: { index_id: indexId }
    });
}

/**
 * 创建查询任务并添加到队列
 */
export function createQueryTask(
    queue: TaskQueueManager,
    query: string,
    indexName: string
): string {
    return queue.addTask({
        type: 'query',
        status: 'processing',
        title: `查询: ${query}`,
        message: `正在搜索 "${indexName}"...`,
        progress: 50
    });
}
