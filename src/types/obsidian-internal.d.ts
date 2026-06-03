/**
 * Obsidian 桌面端内部 API 类型声明
 *
 * 这些类型不在 Obsidian 官方类型定义中，但在桌面端 Electron 环境下可用。
 * 集中管理以便 Obsidian 版本升级时统一维护。
 */

import 'obsidian';

declare module 'obsidian' {
    interface FileSystemAdapter {
        /** 获取 Vault 根目录的绝对路径（桌面端专用） */
        getBasePath(): string;
        /** getBasePath() 的替代属性（部分版本） */
        basePath: string;
    }
}
