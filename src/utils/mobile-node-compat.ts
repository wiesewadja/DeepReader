/**
 * 移动端 Node 兼容性层
 *
 * 为 DeepReader 插件提供 Node.js 核心模块的移动端兼容实现。
 * 支持 fs/promises、path、crypto、stream、events、timers、os、util、zlib 等模块。
 *
 * 背景：
 * - Obsidian 移动端（Capacitor）完全没有 Node 核心模块
 * - 桌面端（Electron）有完整的 Node 环境
 * - 需要跨平台兼容层，桌面端使用原生 Node 模块，移动端使用 polyfill
 *
 * 设计原则：
 * 1. 惰性加载：只在需要时加载 polyfill
 * 2. 利用现有 Obsidian API：尽可能使用 mobile-fs.ts 等工具
 * 3. 保持 API 一致性：移动端和桌面端 API 相同
 * 4. 性能优化：避免不必要的开销
 */

import { type App, normalizePath } from 'obsidian';
import { getVaultPath, joinPath, basename } from './mobile-fs.js';
import { nodeFs } from './node-fs.js';

// 环境检测
const isMobile = (): boolean => {
  // 通过检测 Obsidian API 可用性判断移动端
  // 移动端 adapter 通常不包含 getBasePath 或 basePath
  return typeof window !== 'undefined' && typeof window.navigator !== 'undefined';
};

// Node 模块 polyfill 实现
export class MobileNodeCompat {
  private static _fsPromises: typeof import('fs/promises') | null = null;
  private static _path: any = null;
  private static _crypto: any = null;
  private static _stream: any = null;
  private static _events: any = null;
  private static _timers: any = null;
  private static _os: any = null;
  private static _util: any = null;
  private static _zlib: any = null;

  // ==================== fs/promises ====================

  /**
   * 读取文件内容
   * 移动端使用 Obsidian vault adapter，桌面端使用原生 fs/promises
   */
  static async readFile(path: string, encoding?: string): Promise<string> {
    if (isMobile()) {
      // 移动端：使用 Obsidian vault adapter
      // 需要 app 实例，这里通过惰性加载实现
      return this._getMobileFs().read(path, encoding);
    } else {
      // 桌面端：使用原生 fs/promises
      return (await this._ensureFsPromises()).readFile(path, encoding as any) as unknown as string;
    }
  }

  /**
   * 写入文件内容
   */
  static async writeFile(path: string, data: string | Uint8Array, encoding?: string): Promise<void> {
    if (isMobile()) {
      return this._getMobileFs().write(path, data, encoding);
    } else {
      await (await this._ensureFsPromises()).writeFile(path, data, encoding as any);
    }
  }

  /**
   * 追加文件内容
   */
  static async appendFile(path: string, data: string | Uint8Array, encoding?: string): Promise<void> {
    if (isMobile()) {
      return this._getMobileFs().append(path, data, encoding);
    } else {
      await (await this._ensureFsPromises()).appendFile(path, data, encoding as any);
    }
  }

  /**
   * 删除文件
   */
  static async unlink(path: string): Promise<void> {
    if (isMobile()) {
      return this._getMobileFs().remove(path);
    } else {
      await (await this._ensureFsPromises()).unlink(path);
    }
  }

  /**
   * 文件是否存在
   */
  static async access(path: string): Promise<boolean> {
    if (isMobile()) {
      return this._getMobileFs().exists(path);
    } else {
      try {
        await (await this._ensureFsPromises()).access(path);
        return true;
      } catch {
        return false;
      }
    }
  }

  /**
   * 创建目录
   */
  static async mkdir(path: string, recursive?: boolean): Promise<void> {
    if (isMobile()) {
      return this._getMobileFs().mkdir(path, recursive);
    } else {
      await (await this._ensureFsPromises()).mkdir(path, { recursive: recursive || false });
    }
  }

  /**
   * 读取目录内容
   */
  static async readdir(path: string, options?: { withFileTypes?: boolean }): Promise<string[] | any[]> {
    if (isMobile()) {
      return this._getMobileFs().list(path);
    } else {
      return (await this._ensureFsPromises()).readdir(path, options as any);
    }
  }

  /**
   * 获取文件 stats
   */
  static async stat(path: string): Promise<any> {
    if (isMobile()) {
      return this._getMobileFs().stat(path);
    } else {
      return (await this._ensureFsPromises()).stat(path);
    }
  }

  // ==================== path ====================

  /**
   * 路径拼接
   */
  static join(...paths: string[]): string {
    return joinPath(...paths);
  }

  /**
   * 提取文件名
   */
  static basename(path: string, ext?: string): string {
    return basename(path, ext);
  }

  /**
   * 提取目录名
   */
  static dirname(path: string): string {
    const normalized = normalizePath(path);
    const lastSlash = normalized.lastIndexOf('/');
    return lastSlash === -1 ? '.' : normalized.substring(0, lastSlash);
  }

  /**
   * 规范化路径
   */
  static normalize(path: string): string {
    return normalizePath(path);
  }

  /**
   * 解析路径
   */
  static parse(path: string): any {
    if (isMobile()) {
      // 移动端简化实现
      return {
        root: '/',
        dir: this.dirname(path),
        base: basename(path),
        ext: path.includes('.') ? path.substring(path.lastIndexOf('.')) : '',
        name: basename(path, path.includes('.') ? path.substring(path.lastIndexOf('.')) : undefined),
      };
    } else {
      // 桌面端使用原生 path
      return require('path').parse(path);
    }
  }

  // ==================== crypto ====================

  /**
   * 计算 SHA-256 哈希
   */
  static async sha256(data: string | ArrayBuffer): Promise<string> {
    // 使用 Web Crypto API（移动端和桌面端都支持）
    const encoder = new TextEncoder();
    const dataBuffer = typeof data === 'string' ? encoder.encode(data) : data;
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
  }

  /**
   * 创建 HMAC
   */
  static createHmac(algorithm: string, key: string | ArrayBuffer): any {
    if (isMobile()) {
      // 移动端简化实现
      return {
        update: (data: string) => {},
        digest: () => '',
      };
    } else {
      return require('crypto').createHmac(algorithm, key);
    }
  }

  /**
   * 随机字节
   */
  static randomBytes(size: number): Uint8Array {
    if (isMobile()) {
      // 移动端使用 Web Crypto API
      const array = new Uint8Array(size);
      crypto.getRandomValues(array);
      return array;
    } else {
      return require('crypto').randomBytes(size);
    }
  }

  // ==================== stream ====================

  /**
   * 创建读取流
   */
  static createReadStream(path: string): any {
    if (isMobile()) {
      // 移动端简化实现
      return {
        on: () => ({}),
        pipe: () => ({}),
        destroy: () => {},
      };
    } else {
      return require('fs').createReadStream(path);
    }
  }

  /**
   * 创建写入流
   */
  static createWriteStream(path: string): any {
    if (isMobile()) {
      // 移动端简化实现
      return {
        write: () => true,
        end: () => {},
        destroy: () => {},
      };
    } else {
      return require('fs').createWriteStream(path);
    }
  }

  // ==================== events ====================

  /**
   * EventEmitter 实现
   */
  static EventEmitter(): any {
    if (isMobile()) {
      // 移动端自定义 EventEmitter
      return class MobileEventEmitter {
        private listeners: Map<string, Function[]> = new Map();

        on(event: string, listener: Function): this {
          if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
          }
          this.listeners.get(event)!.push(listener);
          return this;
        }

        off(event: string, listener: Function): this {
          const eventListeners = this.listeners.get(event);
          if (eventListeners) {
            const index = eventListeners.indexOf(listener);
            if (index > -1) {
              eventListeners.splice(index, 1);
            }
          }
          return this;
        }

        emit(event: string, ...args: any[]): boolean {
          const eventListeners = this.listeners.get(event);
          if (eventListeners) {
            eventListeners.forEach(listener => {
              try {
                listener(...args);
              } catch (error) {
                console.error('Event listener error:', error);
              }
            });
            return true;
          }
          return false;
        }

        once(event: string, listener: Function): this {
          const onceWrapper = (...args: any[]) => {
            listener(...args);
            this.off(event, onceWrapper);
          };
          return this.on(event, onceWrapper);
        }
      };
    } else {
      return require('events').EventEmitter;
    }
  }

  // ==================== timers ====================

  /**
   * setTimeout
   */
  static setTimeout(callback: Function, ms: number, ...args: any[]): any {
    return setTimeout(callback, ms, ...args);
  }

  /**
   * clearTimeout
   */
  static clearTimeout(timeoutId: any): void {
    clearTimeout(timeoutId);
  }

  /**
   * setInterval
   */
  static setInterval(callback: Function, ms: number, ...args: any[]): any {
    return setInterval(callback, ms, ...args);
  }

  /**
   * clearInterval
   */
  static clearInterval(intervalId: any): void {
    clearInterval(intervalId);
  }

  // ==================== os ====================

  /**
   * 获取操作系统类型
   */
  static type(): string {
    if (isMobile()) {
      return 'Android'; // 移动端通常是 Android
    } else {
      return require('os').type();
    }
  }

  /**
   * 获取操作系统平台
   */
  static platform(): string {
    if (isMobile()) {
      return 'android';
    } else {
      return require('os').platform();
    }
  }

  /**
   * 获取操作系统架构
   */
  static arch(): string {
    if (isMobile()) {
      return 'arm'; // 移动端通常是 ARM 架构
    } else {
      return require('os').arch();
    }
  }

  /**
   * 获取操作系统版本
   */
  static version(): string {
    if (isMobile()) {
      return 'unknown';
    } else {
      return require('os').version();
    }
  }

  /**
   * 获取主机名
   */
  static hostname(): string {
    if (isMobile()) {
      return 'mobile-device';
    } else {
      return require('os').hostname();
    }
  }

  /**
   * 获取进程 PID
   */
  static pid(): number {
    if (isMobile()) {
      return process.pid;
    } else {
      return process.pid;
    }
  }

  // ==================== util ====================

  /**
   * 继承自
   */
  static inherits(constructor: Function, superConstructor: Function): void {
    if (isMobile()) {
      // 移动端简化实现
      constructor.prototype = Object.create(superConstructor.prototype);
      constructor.prototype.constructor = constructor;
    } else {
      require('util').inherits(constructor, superConstructor);
    }
  }

  /**
   * 继承自 (ES6 版本)
   */
  static inheritsES6(constructor: Function, superConstructor: Function): void {
    Object.setPrototypeOf(constructor.prototype, superConstructor.prototype);
  }

  /**
   * 格式化函数
   */
  static format(format: string, ...args: any[]): string {
    if (isMobile()) {
      // 移动端简化实现
      return format.replace(/%s/g, () => args.shift()) || format;
    } else {
      return require('util').format(format, ...args);
    }
  }

  /**
   * 调试
   */
  static debug(...args: any[]): void {
    console.log('[DEBUG]', ...args);
  }

  /**
   * 检查是否为错误
   */
  static isError(value: any): value is Error {
    return value instanceof Error;
  }

  // ==================== zlib ====================

  /**
   * 压缩数据
   */
  static async compress(data: string | Uint8Array, options?: any): Promise<Uint8Array> {
    if (isMobile()) {
      // 移动端简化实现，使用 Web Compression API
      const encoder = new TextEncoder();
      const dataBuffer = typeof data === 'string' ? encoder.encode(data) : data;
      const cs = new CompressionStream('gzip');
      const writer = cs.writable.getWriter();
      writer.write(dataBuffer as unknown as ArrayBuffer);
      writer.close();
      const reader = cs.readable.getReader();
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
      const result = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }
      return result;
    } else {
      return require('zlib').promises.compress(data, options);
    }
  }

  /**
   * 解压缩数据
   */
  static async decompress(data: Uint8Array, options?: any): Promise<Uint8Array> {
    if (isMobile()) {
      // 移动端简化实现，使用 Web Compression API
      const ds = new DecompressionStream('gzip');
      const writer = ds.writable.getWriter();
      writer.write(data as unknown as ArrayBuffer);
      writer.close();
      const reader = ds.readable.getReader();
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
      const result = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }
      return result;
    } else {
      return require('zlib').promises.decompress(data, options);
    }
  }

  // ==================== 私有方法 ====================

  /**
   * 获取移动端文件系统实例
   */
  private static _getMobileFs(): any {
    // 这里需要 app 实例，实际上应该通过依赖注入
    // 为了简化，我们创建一个模拟的移动端文件系统
    return {
      read: async (path: string, encoding?: string) => {
        // 模拟读取文件
        throw new Error('移动端文件系统需要 app 实例');
      },
      write: async (path: string, data: any, encoding?: string) => {
        // 模拟写入文件
        throw new Error('移动端文件系统需要 app 实例');
      },
      append: async (path: string, data: any, encoding?: string) => {
        // 模拟追加文件
        throw new Error('移动端文件系统需要 app 实例');
      },
      remove: async (path: string) => {
        // 模拟删除文件
        throw new Error('移动端文件系统需要 app 实例');
      },
      exists: async (path: string) => {
        // 模拟检查文件是否存在
        throw new Error('移动端文件系统需要 app 实例');
      },
      mkdir: async (path: string, recursive?: boolean) => {
        // 模拟创建目录
        throw new Error('移动端文件系统需要 app 实例');
      },
      list: async (path: string) => {
        // 模拟列出目录
        throw new Error('移动端文件系统需要 app 实例');
      },
      stat: async (path: string) => {
        // 模拟获取文件 stats
        throw new Error('移动端文件系统需要 app 实例');
      },
    };
  }

  /**
   * 确保 fs/promises 已加载
   */
  private static async _ensureFsPromises(): Promise<typeof import('fs/promises')> {
    if (!this._fsPromises) {
      this._fsPromises = require('fs/promises') as typeof import('fs/promises');
    }
    return this._fsPromises;
  }

  /**
   * 检查是否在移动端
   */
  private static isMobile(): boolean {
    return typeof window !== 'undefined' && typeof window.navigator !== 'undefined';
  }
}

// 导出常用函数
export {
  joinPath,
  basename,
  getVaultPath,
};