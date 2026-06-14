/**
 * .excalidraw.md 格式生成器
 *
 * 把 Excalidraw JSON 包成 Excalidraw 插件原生的 .excalidraw.md 格式，
 * 这样 Obsidian Excalidraw 插件能用全部功能打开（OCR、block 链接、全文搜索）。
 *
 * 设计要点（方案 B）：
 * - 不调用插件的 convert-excalidraw 命令——那会触发 fontSize 重算、文字重排
 * - 直接压缩原始 JSON，所有元素属性（fontSize/坐标/尺寸）原样保留
 * - Text Elements 段只服务 Obsidian 搜索/链接，不影响 UI（UI 完全由 compressed-json 决定）
 *
 * 文件结构（参考插件原生格式）：
 * ```
 * ---
 * excalidraw-plugin: parsed
 * tags: [excalidraw]
 * ---
 * # Excalidraw Data
 * ## Text Elements
 * <text 内容> ^blockId
 * %%
 * ## Drawing
 * ```compressed-json
 * <lz-string + base64 压缩的 JSON>
 * ```
 * %%
 * ```
 */

import { compressToBase64 } from 'lz-string';

/** Excalidraw 文件 JSON 结构（与 excalidraw.ts 的 ExcalidrawFile 一致） */
interface ExcalidrawFile {
  type: string;
  version: number;
  source: string;
  elements: Array<{ type: string; text?: string }>;
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
}

const HEADER = `---
excalidraw-plugin: parsed
tags: [excalidraw]
---

==⚠  Switch to EXCALIDRAW VIEW in the MORE OPTIONS menu of this document. ⚠== You can decompress Drawing data with the command palette: 'Decompress current Excalidraw file'. For more info check in plugin settings under 'Saving'

# Excalidraw Data`;

/**
 * 把 Excalidraw JSON 包成 .excalidraw.md 文件内容
 *
 * @param data 完整的 Excalidraw JSON（elements 属性原样保留）
 * @returns .excalidraw.md 文件的完整字符串内容
 */
export function buildExcalidrawMd(data: ExcalidrawFile): string {
  const textSection = buildTextElementsSection(data.elements);
  const compressed = compressExcalidrawJson(data);

  // 80 字符折行（模仿插件原生格式，便于 diff）
  const wrapped = compressed.match(/.{1,80}/g)?.join('\n') ?? compressed;

  return `${HEADER}

${textSection}
%%
## Drawing
\`\`\`compressed-json
${wrapped}
\`\`\`
%%
`;
}

/**
 * 构建 ## Text Elements 段
 * 每个非空 text 元素一行（去重），末尾附 ^blockId 供 Obsidian 链接
 */
function buildTextElementsSection(
  elements: Array<{ type: string; text?: string }>,
): string {
  const seen = new Set<string>();
  const lines: string[] = ['## Text Elements'];

  for (const el of elements) {
    if (el.type !== 'text') continue;
    const text = el.text?.replace(/\s+$/, ''); // 去尾部空白
    if (!text || seen.has(text)) continue;
    seen.add(text);
    const blockId = genBlockId();
    // 多行文本：blockId 贴在最后一行末尾
    const lastNl = text.lastIndexOf('\n');
    const annotated =
      lastNl >= 0
        ? text.slice(0, lastNl + 1) + text.slice(lastNl + 1) + ` ^${blockId}`
        : text + ` ^${blockId}`;
    lines.push('', annotated);
  }

  return lines.join('\n');
}

/** 生成 8 位 blockId（字母数字） */
function genBlockId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 8; i++) {
    id += chars[Math.floor(seededRandom() * chars.length)];
  }
  return id;
}

/**
 * 简单确定性 PRNG（不用 Math.random，保证单元测试可复现）。
 * 用静态计数器做种子——同一进程内每次调用递增，分布足够分散。
 */
let _seed = 0;
function seededRandom(): number {
  _seed = (_seed * 9301 + 49297) % 233280;
  if (_seed === 0) _seed = 1;
  return _seed / 233280;
}

/** 压缩 Excalidraw JSON 为 base64 字符串 */
function compressExcalidrawJson(data: ExcalidrawFile): string {
  const jsonStr = JSON.stringify(data);
  return compressToBase64(jsonStr);
}
