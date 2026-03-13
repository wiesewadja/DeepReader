/**
 * Obsidian 模块 Mock
 * 用于测试环境
 */

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
  vault: any;
  workspace: any;
  fileManager: any;

  constructor() {
    this.vault = {
      getAbstractFileByPath: vi.fn(),
      getFiles: vi.fn(() => []),
      read: vi.fn(),
      create: vi.fn(),
      modify: vi.fn(),
      delete: vi.fn(),
      createFolder: vi.fn()
    };
    this.workspace = {
      getActiveFile: vi.fn(),
      getLeavesOfType: vi.fn(() => [])
    };
    this.fileManager = {
      getNewFileParent: vi.fn()
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

// 添加 vi fn 用于 mock
function vi() {}
vi.fn = () => {
  const fn: any = (...args: any[]) => fn._returnValue;
  fn._returnValue = undefined;
  fn.mockReturnValue = (v: any) => {
    fn._returnValue = v;
    return fn;
  };
  fn.mockResolvedValue = (v: any) => {
    fn._returnValue = Promise.resolve(v);
    return fn;
  };
  fn.mockImplementation = (impl: any) => {
    return impl;
  };
  return fn;
};
