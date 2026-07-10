# TTS Service 拆分 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 tts-service.ts（1578 行）拆分为 3 个协作模块，TTSService 保留为编排层（~300 行）。

**Architecture:** TTSService 保留播放编排、状态管理、进度追踪、暂停/恢复职责。缓存逻辑提取到 TTSCacheManager，WAV 合并提取到 TTSAudioMerger，文本分段提取到 TTSTextSplitter。

**Tech Stack:** TypeScript, Vitest, Web Audio API

## Global Constraints

- 不使用前端框架，全部原生 DOM API
- 所有 Vault 文件操作通过 `app.vault.adapter` 或 `app.vault` API
- 统一日志使用 `src/utils/logger.ts`
- 业务代码禁止静态 `import` Node 核心模块
- 测试必须分模块执行，先评估影响范围

## 当前状态分析

| 文件 | 行数 | 职责 |
|------|------|------|
| tts-service.ts | **1578** | God Service（缓存+播放+文本+进度+音色） |
| tts-summarizer.ts | 391 | LLM 摘要（已独立） |
| pcm-stream-player.ts | 230 | 流式播放器（已独立） |
| book-genre-detector.ts | 246 | 体裁检测（已独立） |
| expressive-preprocessor.ts | 246 | 文本预处理（已独立） |
| voice-profile.ts | 124 | 音色配置（已独立） |
| tts-client.ts | 179 | API 客户端（已独立） |

## File Structure

| 文件 | 职责 | 操作 |
|------|------|------|
| `src/services/tts/tts-cache.ts` | 缓存管理（内存+磁盘） | 创建 |
| `src/services/tts/tts-audio-merger.ts` | WAV 合并工具 | 创建 |
| `src/services/tts/tts-text-splitter.ts` | 文本分段器 | 创建 |
| `src/services/tts/tts-service.ts` | 瘦身后的编排层 | 修改 |
| `tests/unit/services/tts/tts-cache.test.ts` | 缓存模块测试 | 创建 |
| `tests/unit/services/tts/tts-audio-merger.test.ts` | 合并模块测试 | 创建 |
| `tests/unit/services/tts/tts-text-splitter.test.ts` | 分段模块测试 | 创建 |

---

## Task 1: 创建 TTSCacheManager 模块

**Covers:** TTS 缓存逻辑提取

**Files:**
- Create: `src/services/tts/tts-cache.ts`
- Create: `tests/unit/services/tts/tts-cache.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: TTSCacheManager 类（buildCacheKey, get, set, loadFromDisk, saveToDisk, ensureDiskCacheDir, readManifest, writeManifest）

- [ ] **Step 1: 创建 tts-cache.ts**

从 tts-service.ts 提取以下内容：

```typescript
/**
 * TTSCacheManager
 *
 * TTS 音频缓存管理：内存 LRU 缓存 + 磁盘 WAV 缓存。
 * 从 TTSService 中抽取，可独立测试和复用。
 */

import { uiLog as log } from "../../../utils/logger.js";
import { vaultRead, vaultWrite, vaultExists, vaultMkdir } from "../../../utils/mobile-fs.js";
import { getVaultPath } from "../../../utils/mobile-fs.js";
import { joinPath } from "../../../utils/mobile-fs.js";

export interface CachedAudio {
  audioBlob: Blob;
  messageId: string;
  timestamp: number;
}

export interface ManifestEntry {
  textHash: string;
  voice: string;
  filename: string;
  timestamp: number;
}

export interface DiskManifest {
  entries: ManifestEntry[];
}

const MAX_CACHE_ENTRIES = 20;
const MAX_DISK_ENTRIES = 10;
const CACHE_DIR = "DeepReader/tts-cache";

export class TTSCacheManager {
  private memoryCache = new Map<string, CachedAudio>();
  private diskManifest: DiskManifest | null = null;
  private diskWriteLock = false;
  private diskWriteQueue: Array<() => Promise<void>> = [];

  /** 生成内存缓存 key */
  buildCacheKey(messageId: string, voiceProfile: { voice?: string; style?: string }): string {
    const voice = voiceProfile.voice || "default";
    const style = voiceProfile.style || "";
    return `${messageId}:${voice}:${style}`;
  }

  /** djb2 哈希（磁盘缓存 key） */
  getTextHash(text: string): string {
    let hash = 5381;
    for (let i = 0; i < text.length; i++) {
      hash = ((hash << 5) + hash + text.charCodeAt(i)) & 0xffffffff;
    }
    return Math.abs(hash).toString(36);
  }

  /** 读取内存缓存 */
  get(key: string): CachedAudio | undefined {
    return this.memoryCache.get(key);
  }

  /** 写入内存缓存（LRU 淘汰） */
  set(key: string, entry: CachedAudio): void {
    if (this.memoryCache.size >= MAX_CACHE_ENTRIES) {
      const oldest = this.memoryCache.keys().next().value;
      if (oldest) this.memoryCache.delete(oldest);
    }
    this.memoryCache.set(key, entry);
  }

  /** 确保磁盘缓存目录存在 */
  async ensureDiskCacheDir(): Promise<string> {
    const adapter = window.electronFs || (await import("fs")).promises;
    const basePath = getVaultPath(window.app || (window as any).require("obsidian").app);
    const cacheDir = joinPath(basePath, CACHE_DIR);
    try {
      await adapter.mkdir(cacheDir, { recursive: true });
    } catch { /* 目录已存在 */ }
    return cacheDir;
  }

  /** 读取磁盘 manifest */
  async readManifest(): Promise<DiskManifest> {
    if (this.diskManifest) return this.diskManifest;
    try {
      const adapter = window.electronFs || (await import("fs")).promises;
      const basePath = getVaultPath(window.app || (window as any).require("obsidian").app);
      const manifestPath = joinPath(basePath, CACHE_DIR, "manifest.json");
      const content = await adapter.readFile(manifestPath, "utf-8");
      this.diskManifest = JSON.parse(content);
    } catch {
      this.diskManifest = { entries: [] };
    }
    return this.diskManifest!;
  }

  /** 写入磁盘 manifest（串行写锁） */
  async writeManifest(entries: ManifestEntry[]): Promise<void> {
    this.diskManifest = { entries };
    const doWrite = async () => {
      try {
        const adapter = window.electronFs || (await import("fs")).promises;
        const basePath = getVaultPath(window.app || (window as any).require("obsidian").app);
        const manifestPath = joinPath(basePath, CACHE_DIR, "manifest.json");
        await adapter.writeFile(manifestPath, JSON.stringify(this.diskManifest, null, 2));
      } catch (err) {
        log.error("[TTSCache] writeManifest failed:", err);
      }
    };
    if (this.diskWriteLock) {
      this.diskWriteQueue.push(doWrite);
    } else {
      this.diskWriteLock = true;
      await doWrite();
      while (this.diskWriteQueue.length > 0) {
        await this.diskWriteQueue.shift()!();
      }
      this.diskWriteLock = false;
    }
  }

  /** 从磁盘加载 WAV */
  async loadFromDisk(textHash: string, voice: string): Promise<Blob | null> {
    const manifest = await this.readManifest();
    const entry = manifest.entries.find(e => e.textHash === textHash && e.voice === voice);
    if (!entry) return null;
    try {
      const adapter = window.electronFs || (await import("fs")).promises;
      const basePath = getVaultPath(window.app || (window as any).require("obsidian").app);
      const filePath = joinPath(basePath, CACHE_DIR, entry.filename);
      const buffer = await adapter.readFile(filePath);
      return new Blob([buffer], { type: "audio/wav" });
    } catch {
      return null;
    }
  }

  /** 保存到磁盘缓存 */
  async saveToDisk(textHash: string, voice: string, audioBuffer: ArrayBuffer): Promise<void> {
    const filename = `${textHash}_${voice}.wav`;
    const manifest = await this.readManifest();
    
    // LRU 淘汰
    if (manifest.entries.length >= MAX_DISK_ENTRIES) {
      const oldest = manifest.entries.shift();
      if (oldest) {
        try {
          const adapter = window.electronFs || (await import("fs")).promises;
          const basePath = getVaultPath(window.app || (window as any).require("obsidian").app);
          const oldPath = joinPath(basePath, CACHE_DIR, oldest.filename);
          await adapter.unlink(oldPath);
        } catch { /* 忽略 */ }
      }
    }

    // 写入 WAV
    try {
      const adapter = window.electronFs || (await import("fs")).promises;
      const basePath = getVaultPath(window.app || (window as any).require("obsidian").app);
      const filePath = joinPath(basePath, CACHE_DIR, filename);
      await adapter.writeFile(filePath, Buffer.from(audioBuffer));
    } catch (err) {
      log.error("[TTSCache] saveToDisk write failed:", err);
      return;
    }

    // 更新 manifest
    manifest.entries.push({ textHash, voice, filename, timestamp: Date.now() });
    await this.writeManifest(manifest.entries);
  }

  /** 清理过期缓存 */
  async cleanup(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): Promise<void> {
    const manifest = await this.readManifest();
    const now = Date.now();
    const validEntries: ManifestEntry[] = [];
    
    for (const entry of manifest.entries) {
      if (now - entry.timestamp > maxAgeMs) {
        try {
          const adapter = window.electronFs || (await import("fs")).promises;
          const basePath = getVaultPath(window.app || (window as any).require("obsidian").app);
          const filePath = joinPath(basePath, CACHE_DIR, entry.filename);
          await adapter.unlink(filePath);
        } catch { /* 忽略 */ }
      } else {
        validEntries.push(entry);
      }
    }
    
    if (validEntries.length !== manifest.entries.length) {
      await this.writeManifest(validEntries);
    }
  }

  /** 清空所有缓存 */
  clear(): void {
    this.memoryCache.clear();
    this.diskManifest = null;
  }
}
```

- [ ] **Step 2: 创建测试文件**

```typescript
// tests/unit/services/tts/tts-cache.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TTSCacheManager } from "../../../../src/services/tts/tts-cache.js";

describe("TTSCacheManager", () => {
  let cache: TTSCacheManager;

  beforeEach(() => {
    cache = new TTSCacheManager();
  });

  describe("buildCacheKey", () => {
    it("生成正确的缓存 key", () => {
      const key = cache.buildCacheKey("msg-123", { voice: "zh-CN", style: "happy" });
      expect(key).toBe("msg-123:zh-CN:happy");
    });

    it("使用默认值", () => {
      const key = cache.buildCacheKey("msg-123", {});
      expect(key).toBe("msg-123:default:");
    });
  });

  describe("getTextHash", () => {
    it("生成一致的哈希", () => {
      const hash1 = cache.getTextHash("hello world");
      const hash2 = cache.getTextHash("hello world");
      expect(hash1).toBe(hash2);
    });

    it("不同文本生成不同哈希", () => {
      const hash1 = cache.getTextHash("hello");
      const hash2 = cache.getTextHash("world");
      expect(hash1).not.toBe(hash2);
    });
  });

  describe("memory cache", () => {
    it("存取缓存", () => {
      const entry = { audioBlob: new Blob(), messageId: "msg-1", timestamp: Date.now() };
      cache.set("key1", entry);
      expect(cache.get("key1")).toBe(entry);
    });

    it("LRU 淘汰", () => {
      for (let i = 0; i < 25; i++) {
        cache.set(`key${i}`, { audioBlob: new Blob(), messageId: `msg-${i}`, timestamp: Date.now() });
      }
      expect(cache.get("key0")).toBeUndefined();
      expect(cache.get("key4")).toBeDefined();
    });
  });
});
```

- [ ] **Step 3: 运行测试**

```bash
npm run test:run -- tests/unit/services/tts/tts-cache.test.ts
```

预期：测试通过

- [ ] **Step 4: Commit**

```bash
git add src/services/tts/tts-cache.ts tests/unit/services/tts/tts-cache.test.ts
git commit -m "feat(tts): extract TTSCacheManager from TTSService"
```

---

## Task 2: 创建 TTSAudioMerger 模块

**Covers:** WAV 合并逻辑提取

**Files:**
- Create: `src/services/tts/tts-audio-merger.ts`
- Create: `tests/unit/services/tts/tts-audio-merger.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: mergeAudioChunks 函数

- [ ] **Step 1: 创建 tts-audio-merger.ts**

```typescript
/**
 * TTSAudioMerger
 *
 * WAV 音频片段合并工具。从 TTSService 中抽取的纯函数。
 */

/** 将字符串写入 DataView（WAV 头部用） */
function writeString(dataView: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    dataView.setUint8(offset + i, str.charCodeAt(i));
  }
}

/**
 * 合并多个 WAV 音频片段为单个 Blob。
 * 假设所有片段具有相同的采样率和声道数。
 */
export function mergeAudioChunks(chunks: ArrayBuffer[]): Blob {
  if (chunks.length === 0) return new Blob();
  if (chunks.length === 1) return new Blob([chunks[0]], { type: "audio/wav" });

  // 解析第一个 WAV 头获取参数
  const firstView = new DataView(chunks[0]);
  const sampleRate = firstView.getUint32(24, true);
  const numChannels = firstView.getUint16(22, true);
  const bitsPerSample = firstView.getUint16(34, true);
  const bytesPerSample = bitsPerSample / 8;

  // 收集所有音频数据（跳过 WAV 头）
  const audioDataParts: ArrayBuffer[] = [];
  let totalDataLength = 0;

  for (const chunk of chunks) {
    const view = new DataView(chunk);
    // 查找 "data" 标记
    let dataOffset = 12;
    while (dataOffset < chunk.byteLength - 8) {
      const subchunkId = String.fromCharCode(
        view.getUint8(dataOffset),
        view.getUint8(dataOffset + 1),
        view.getUint8(dataOffset + 2),
        view.getUint8(dataOffset + 3)
      );
      if (subchunkId === "data") {
        const dataLength = view.getUint32(dataOffset + 4, true);
        audioDataParts.push(chunk.slice(dataOffset + 8, dataOffset + 8 + dataLength));
        totalDataLength += dataLength;
        break;
      }
      const subchunkSize = view.getUint32(dataOffset + 4, true);
      dataOffset += 8 + subchunkSize;
    }
  }

  // 构建新 WAV 文件
  const headerSize = 44;
  const fileSize = headerSize + totalDataLength;
  const buffer = new ArrayBuffer(fileSize);
  const view = new DataView(buffer);

  // RIFF 头
  writeString(view, 0, "RIFF");
  view.setUint32(4, fileSize - 8, true);
  writeString(view, 8, "WAVE");

  // fmt 子块
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true);  // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, bitsPerSample, true);

  // data 子块
  writeString(view, 36, "data");
  view.setUint32(40, totalDataLength, true);

  // 复制音频数据
  let offset = headerSize;
  for (const part of audioDataParts) {
    new Uint8Array(buffer).set(new Uint8Array(part), offset);
    offset += part.byteLength;
  }

  return new Blob([buffer], { type: "audio/wav" });
}
```

- [ ] **Step 2: 创建测试文件**

```typescript
// tests/unit/services/tts/tts-audio-merger.test.ts
import { describe, it, expect } from "vitest";
import { mergeAudioChunks } from "../../../../src/services/tts/tts-audio-merger.js";

describe("mergeAudioChunks", () => {
  /** 创建最小 WAV ArrayBuffer */
  function createWav(sampleRate = 44100, channels = 1, data = new Uint8Array([1, 2, 3, 4])): ArrayBuffer {
    const buffer = new ArrayBuffer(44 + data.byteLength);
    const view = new DataView(buffer);
    
    // RIFF header
    const writeStr = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
    };
    
    writeStr(0, "RIFF");
    view.setUint32(4, buffer.byteLength - 8, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * channels, true);
    view.setUint16(32, channels, true);
    view.setUint16(34, 8, true);
    writeStr(36, "data");
    view.setUint32(40, data.byteLength, true);
    new Uint8Array(buffer).set(data, 44);
    
    return buffer;
  }

  it("合并空数组返回空 Blob", () => {
    const result = mergeAudioChunks([]);
    expect(result.size).toBe(0);
  });

  it("合并单个片段返回原始 Blob", () => {
    const wav = createWav();
    const result = mergeAudioChunks([wav]);
    expect(result.size).toBe(wav.byteLength);
  });

  it("合并多个片段", () => {
    const wav1 = createWav(44100, 1, new Uint8Array([1, 2]));
    const wav2 = createWav(44100, 1, new Uint8Array([3, 4]));
    const result = mergeAudioChunks([wav1, wav2]);
    // 44 header + 2 + 2 = 48
    expect(result.size).toBe(48);
  });
});
```

- [ ] **Step 3: 运行测试**

```bash
npm run test:run -- tests/unit/services/tts/tts-audio-merger.test.ts
```

预期：测试通过

- [ ] **Step 4: Commit**

```bash
git add src/services/tts/tts-audio-merger.ts tests/unit/services/tts/tts-audio-merger.test.ts
git commit -m "feat(tts): extract TTSAudioMerger from TTSService"
```

---

## Task 3: 创建 TTSTextSplitter 模块

**Covers:** 文本分段逻辑提取

**Files:**
- Create: `src/services/tts/tts-text-splitter.ts`
- Create: `tests/unit/services/tts/tts-text-splitter.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: splitTextIntoSegments, stripWikiLinksForTTS 函数

- [ ] **Step 1: 创建 tts-text-splitter.ts**

```typescript
/**
 * TTSTextSplitter
 *
 * TTS 文本分段器：将长文本切分为适合朗读的段落。
 * 从 TTSService 中抽取的纯函数。
 */

/** 清理 wiki link 为纯文本（TTS 朗读用） */
export function stripWikiLinksForTTS(text: string): string {
  return text
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")  // [[link|display]]
    .replace(/\[\[([^\]]+)\]\]/g, "$1")              // [[link]]
    .replace(/!\[\[([^\]]+)\]\]/g, "");              // ![[image]] → 删除
}

/** 分割第一个句子（用于预加载） */
export function splitFirstSentence(text: string): string {
  const sentenceEnd = text.search(/[。！？.!?\n]/);
  if (sentenceEnd === -1) return text.slice(0, 250);
  return text.slice(0, sentenceEnd + 1);
}

/**
 * 将文本切分为适合 TTS 朗读的段落。
 *
 * 策略：
 * 1. 按段落（双换行）分割
 * 2. 短段落合并，直到达到 targetChars
 * 3. 超长段落按句子分割
 */
export function splitTextIntoSegments(text: string, targetChars: number = 300): string[] {
  if (!text || text.trim().length === 0) return [];

  // 清理 wiki link
  const cleaned = stripWikiLinksForTTS(text);

  // 按段落分割
  const paragraphs = cleaned.split(/\n\n+/).filter(p => p.trim().length > 0);
  
  const segments: string[] = [];
  let currentSegment = "";

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    
    // 段落本身超长，按句子分割
    if (trimmed.length > targetChars * 1.5) {
      if (currentSegment) {
        segments.push(currentSegment);
        currentSegment = "";
      }
      const sentences = splitBySentences(trimmed, targetChars);
      segments.push(...sentences);
      continue;
    }

    // 合并短段落
    if ((currentSegment + "\n\n" + trimmed).length <= targetChars) {
      currentSegment = currentSegment ? currentSegment + "\n\n" + trimmed : trimmed;
    } else {
      if (currentSegment) {
        segments.push(currentSegment);
      }
      currentSegment = trimmed;
    }
  }

  if (currentSegment) {
    segments.push(currentSegment);
  }

  return segments.filter(s => s.trim().length > 0);
}

/** 按句子分割超长文本 */
function splitBySentences(text: string, maxChars: number): string[] {
  const sentences = text.split(/(?<=[。！？.!?\n])\s*/);
  const result: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    if ((current + sentence).length <= maxChars) {
      current += sentence;
    } else {
      if (current) result.push(current);
      current = sentence;
    }
  }

  if (current) result.push(current);
  return result;
}
```

- [ ] **Step 2: 创建测试文件**

```typescript
// tests/unit/services/tts/tts-text-splitter.test.ts
import { describe, it, expect } from "vitest";
import { splitTextIntoSegments, stripWikiLinksForTTS, splitFirstSentence } from "../../../../src/services/tts/tts-text-splitter.js";

describe("TTSTextSplitter", () => {
  describe("stripWikiLinksForTTS", () => {
    it("转换 [[link|display]] 为 display", () => {
      expect(stripWikiLinksForTTS("请看[[chapter1|第一章]]")).toBe("请看第一章");
    });

    it("转换 [[link]] 为 link", () => {
      expect(stripWikiLinksForTTS("参考[[概念]]")).toBe("参考概念");
    });

    it("删除 ![[image]]", () => {
      expect(stripWikiLinksForTTS("图片![[diagram.png]]结束")).toBe("图片结束");
    });
  });

  describe("splitFirstSentence", () => {
    it("分割第一个句子", () => {
      expect(splitFirstSentence("第一句。第二句。")).toBe("第一句。");
    });

    it("无句子结束符则截断", () => {
      const long = "a".repeat(300);
      expect(splitFirstSentence(long).length).toBe(250);
    });
  });

  describe("splitTextIntoSegments", () => {
    it("短文本返回单段", () => {
      const result = splitTextIntoSegments("短文本");
      expect(result).toHaveLength(1);
      expect(result[0]).toBe("短文本");
    });

    it("按段落分割", () => {
      const text = "段落一\n\n段落二\n\n段落三";
      const result = splitTextIntoSegments(text, 100);
      expect(result.length).toBeGreaterThanOrEqual(2);
    });

    it("空文本返回空数组", () => {
      expect(splitTextIntoSegments("")).toEqual([]);
      expect(splitTextIntoSegments("   ")).toEqual([]);
    });
  });
});
```

- [ ] **Step 3: 运行测试**

```bash
npm run test:run -- tests/unit/services/tts/tts-text-splitter.test.ts
```

预期：测试通过

- [ ] **Step 4: Commit**

```bash
git add src/services/tts/tts-text-splitter.ts tests/unit/services/tts/tts-text-splitter.test.ts
git commit -m "feat(tts): extract TTSTextSplitter from TTSService"
```

---

## Task 4: 更新 TTSService 使用新模块

**Covers:** TTSService 集成新模块

**Files:**
- Modify: `src/services/tts/tts-service.ts`

**Interfaces:**
- Consumes: TTSCacheManager, mergeAudioChunks, splitTextIntoSegments, stripWikiLinksForTTS
- Produces: 瘦身后的 TTSService

- [ ] **Step 1: 导入新模块**

在 tts-service.ts 顶部添加：

```typescript
import { TTSCacheManager } from "./tts-cache.js";
import { mergeAudioChunks } from "./tts-audio-merger.js";
import { splitTextIntoSegments, stripWikiLinksForTTS } from "./tts-text-splitter.js";
```

- [ ] **Step 2: 替换缓存逻辑**

将 TTSService 中的缓存相关字段和方法替换为使用 TTSCacheManager：

```typescript
// Before
private memoryCache = new Map<string, CachedAudio>();
private diskManifest: DiskManifest | null = null;
private diskWriteLock = false;
private diskWriteQueue: Array<() => Promise<void>> = [];

// After
private cacheManager = new TTSCacheManager();
```

将所有 `this.buildCacheKey()` 替换为 `this.cacheManager.buildCacheKey()`，其他缓存方法同理。

- [ ] **Step 3: 替换 WAV 合并**

将 `TTSService.mergeAudioChunks()` 静态方法替换为导入的 `mergeAudioChunks`：

```typescript
// Before
static mergeAudioChunks(chunks: ArrayBuffer[]): Blob { ... }

// After（删除静态方法，直接使用导入的函数）
```

- [ ] **Step 4: 替换文本分段**

将 `splitTextIntoSegments()` 和 `stripWikiLinksForTTS()` 替换为导入的函数：

```typescript
// Before
private splitTextIntoSegments(text: string, targetChars?: number): string[] { ... }

// After（删除私有方法，直接使用导入的函数）
```

- [ ] **Step 5: 运行类型检查**

```bash
npx tsc --noEmit --skipLibCheck
```

预期：无错误

- [ ] **Step 6: 运行 TTS 测试**

```bash
npm run test:run -- tests/unit/services/tts/
```

预期：测试通过

- [ ] **Step 7: Commit**

```bash
git add src/services/tts/tts-service.ts
git commit -m "refactor(tts): integrate new cache/merger/splitter modules into TTSService"
```

---

## Task 5: 端到端验证

**Covers:** 完整功能验证

**Files:**
- 无文件修改

**Interfaces:**
- Consumes: 完整的 TTS 模块
- Produces: 功能验证通过

- [ ] **Step 1: 构建项目**

```bash
npm run build
```

预期：构建成功

- [ ] **Step 2: 运行全量测试**

```bash
npm run test:run
```

预期：所有测试通过

- [ ] **Step 3: 运行 TTS 测试**

```bash
npm run test:run -- tests/unit/services/tts/
```

预期：所有 TTS 测试通过

- [ ] **Step 4: 检查文件行数**

```bash
wc -l src/services/tts/*.ts
```

预期：tts-service.ts 从 1578 行降至 ~300 行

- [ ] **Step 5: 检查 Git 状态**

```bash
git status
git log --oneline -6
```

确认所有修改已提交

---

## Self-Review

**1. Spec coverage:**
- ✅ 提取 TTSCacheManager（缓存逻辑）
- ✅ 提取 TTSAudioMerger（WAV 合并）
- ✅ 提取 TTSTextSplitter（文本分段）
- ✅ TTSService 使用新模块

**2. Placeholder scan:** 无 TBD/TODO

**3. Type consistency:**
- TTSCacheManager 的方法签名与 TTSService 原方法一致
- mergeAudioChunks 参数和返回类型一致
- splitTextIntoSegments 参数和返回类型一致
