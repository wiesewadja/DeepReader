/**
 * Obsidian 模块 Mock
 * 用于测试环境
 */

import { vi } from 'vitest';

// Mock TFile 类
export class TFile {
  path: string;
  extension: string;
  basename: string;
  name: string;
  parent: any;

  constructor(path: string) {
    this.path = path;
    this.extension = path.split('.').pop() || '';
    this.basename = path.split('/').pop()?.replace(/\.[^.]+$/, '') || '';
    this.name = path.split('/').pop() || '';
  }
}

// Mock TFolder 类
export class TFolder {
  path: string;
  name: string;
  children: any[] = [];

  constructor(path: string) {
    this.path = path;
    this.name = path.split('/').pop() || '';
  }
}

// Mock App 类
export class App {
  vault: {
    getAbstractFileByPath: ReturnType<typeof vi.fn>;
    getFiles: ReturnType<typeof vi.fn>;
    read: ReturnType<typeof vi.fn>;
    adapter: { read: ReturnType<typeof vi.fn> };
  };
  workspace: {
    getActiveFile: ReturnType<typeof vi.fn>;
    getLeavesOfType: ReturnType<typeof vi.fn>;
    trigger: ReturnType<typeof vi.fn>;
  };
  metadataCache: {
    getFirstLinkpathDest: ReturnType<typeof vi.fn>;
  };
  fileManager: {
    getNewFileParent: ReturnType<typeof vi.fn>;
  };

  constructor() {
    this.vault = {
      getAbstractFileByPath: vi.fn(),
      getFiles: vi.fn(() => []),
      read: vi.fn(),
      adapter: { read: vi.fn() },
    };
    this.workspace = {
      getActiveFile: vi.fn(),
      getLeavesOfType: vi.fn(() => []),
      trigger: vi.fn(),
    };
    this.metadataCache = {
      getFirstLinkpathDest: vi.fn(() => null),
    };
    this.fileManager = {
      getNewFileParent: vi.fn(),
    };
  }
}

// Mock other commonly used exports
export const Notice = vi.fn();
export const Plugin = class Plugin {};
export const PluginSettingTab = class PluginSettingTab {};
export const Setting = vi.fn();
export const Modal = class Modal {};
export const MarkdownView = class MarkdownView {};
export const WorkspaceLeaf = class WorkspaceLeaf {};
export const normalizePath = (path: string) => path.replace(/\\/g, '/');
export const Platform = {
  isMobile: false,
  isDesktop: true,
  isMacOS: process.platform === 'darwin',
  isWindows: process.platform === 'win32',
  isLinux: process.platform === 'linux',
};

// Mock Component and related classes for Markdown rendering
export class Component {
  load() {}
  unload() {}
  addChild() {}
  removeChild() {}
}

// Mock MarkdownRenderer
export const MarkdownRenderer = {
  render: vi.fn().mockResolvedValue(undefined),
  renderMarkdown: vi.fn().mockResolvedValue(undefined)
};

// Mock HoverParent
export class HoverParent {
  hoverPopover: HoverPopover | null = null;
}

// Mock HoverPopover — 暴露 hoverEl 让测试可观察 popover 状态
export class HoverPopover {
  hoverEl: HTMLElement;
  state: number = 0;
  constructor(parent: HoverParent, targetEl: HTMLElement | null, waitTime?: number, staticPos?: unknown) {
    this.hoverEl = document.createElement('div');
    this.hoverEl.className = 'hover-popover';
    // parent.hoverPopover 是由调用方显式设的
    parent.hoverPopover = this;
  }
  hide() {
    this.state = 0;
    this.hoverEl.remove();
  }
  unload() {
    this.hide();
  }
}

// Mock moment
export const moment = {
  format: (format: string) => format,
};

// Mock requestUrl
export const requestUrl = async (url: string) => {
  const response = await fetch(url);
  const text = await response.text();
  return {
    status: response.status,
    text: async () => text,
    json: async () => JSON.parse(text),
  };
};

// Mock Menu & MenuItem
export interface MenuItem {
  id: string;
  icon?: string;
  title?: string;
  callback: () => void;
}

export interface Menu {
  addItem(item: MenuItem | ((item: MenuItem) => void)): void;
}
