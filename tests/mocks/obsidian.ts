/**
 * Obsidian API Mock for Vitest Tests
 * 提供基本的 Obsidian API 类型定义，避免导入错误
 */

export interface App {
    vault: Vault;
    metadataCache: MetadataCache;
}

export interface Vault {
    getAbstractFileByPath(path: string): any;
    getMarkdownFiles(): any[];
}

export interface MetadataCache {
    getCache(path: string): any;
}

export interface MenuItem {
    id: string;
    icon?: string;
    title?: string;
    callback: () => void;
}

export interface Menu {
    addItem(item: MenuItem | ((item: MenuItem) => void)): void;
}

export const moment = {
    format: (format: string) => format,
};

export class Notice {
    constructor(message: string, duration?: number) {
        // Mock Notice implementation
    }
}

export const Platform = {
    isMobile: false,
    isDesktop: true,
    isMacOS: process.platform === 'darwin',
    isWindows: process.platform === 'win32',
    isLinux: process.platform === 'linux',
};

export const requestUrl = async (url: string) => {
    const response = await fetch(url);
    const text = await response.text();
    return {
        status: response.status,
        text: async () => text,
        json: async () => JSON.parse(text),
    };
};

export default {
    App,
    Vault,
    MetadataCache,
    MenuItem,
    Menu,
    moment,
    Notice,
    Platform,
    requestUrl,
};
