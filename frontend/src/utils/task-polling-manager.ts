/**
 * DeepPDF - 任务轮询管理器
 * 用于管理多个并发任务的进度轮询
 */

import { DeepPDFClient, TaskProgress } from "../api/http-client.js";

export class TaskPollingManager {
    private pollingIntervals: Map<string, number> = new Map();
    private progressCache: Map<string, TaskProgress> = new Map();
    private apiClient: DeepPDFClient;
    private pollInterval: number = 2000; // 2秒

    constructor(apiClient: DeepPDFClient) {
        this.apiClient = apiClient;
    }

    // 开始轮询任务进度
    startPolling(taskId: string, onUpdate: (progress: TaskProgress) => void): void {
        // 参数验证
        if (!taskId || typeof taskId !== "string") {
            throw new Error("taskId 必须是非空字符串");
        }
        if (typeof onUpdate !== "function") {
            throw new Error("onUpdate 必须是函数");
        }

        // 清除已有的轮询
        this.stopPolling(taskId);

        const timer = setInterval(async () => {
            try {
                const progress = await this.apiClient.getTaskProgress(taskId);
                this.progressCache.set(taskId, progress);
                onUpdate(progress);

                // 如果任务完成或失败，停止轮询
                if (progress.status === "completed" || progress.status === "failed" || progress.status === "cancelled") {
                    this.stopPolling(taskId);
                }
            } catch (error) {
                console.error(`[任务轮询] 获取任务 ${taskId} 进度失败:`, error);
                // API 调用失败时停止轮询并通知回调
                this.stopPolling(taskId);
                onUpdate({
                    id: taskId,
                    status: "failed",
                    message: "获取任务进度失败",
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }, this.pollInterval);

        this.pollingIntervals.set(taskId, timer);
    }

    // 停止轮询
    stopPolling(taskId: string): void {
        const timer = this.pollingIntervals.get(taskId);
        if (timer) {
            clearInterval(timer);
            this.pollingIntervals.delete(taskId);
            this.progressCache.delete(taskId);
        }
    }

    // 获取缓存的进度
    getCachedProgress(taskId: string): TaskProgress | undefined {
        return this.progressCache.get(taskId);
    }

    // 清理所有轮询
    destroy(): void {
        this.pollingIntervals.forEach((timer, taskId) => {
            clearInterval(timer);
        });
        this.pollingIntervals.clear();
        this.progressCache.clear();
    }

    // 获取所有进行中的任务
    getActiveTaskIds(): string[] {
        return Array.from(this.pollingIntervals.keys());
    }
}
