/**
 * .excalidraw.md 格式生成器单元测试
 *
 * 核心验证：buildExcalidrawMd 产出的文件，解压后元素属性（fontSize/坐标/尺寸）
 * 必须 100% 保留——这是方案 B 不依赖 convert 命令、保证 UI 不变坏的根本。
 */
import { describe, it, expect } from 'vitest';
import { decompressFromBase64 } from 'lz-string';
import { buildExcalidrawMd } from '@/agent/tools/excalidraw-md';
import { buildExcalidrawJSON } from '@/agent/tools/excalidraw';
import type { ElementDef } from '@/agent/tools/excalidraw';

/** 从 .excalidraw.md 内容里解压出原始 JSON */
function decompressMd(md: string): any {
  const m = md.match(/```compressed-json\n([\s\S]*?)\n```/);
  if (!m) throw new Error('compressed-json 块未找到');
  const raw = m[1].replace(/\n/g, '');
  return JSON.parse(decompressFromBase64(raw)!);
}

const sampleElements: ElementDef[] = [
  { id: 'center', type: 'ellipse', x: 340, y: 220, width: 320, height: 160,
    strokeColor: '#1e3a5f', backgroundColor: '#e8f0fe' },
  { id: 'center_text', type: 'text', x: 350, y: 230, width: 300, height: 140,
    text: '阿德勒个体心理学\n核心概念体系', fontSize: 20, containerId: 'center' },
  { id: 'title', type: 'text', x: 300, y: 30, width: 400, height: 40,
    text: '核心概念体系', fontSize: 22, strokeColor: '#1e293b' },
];

describe('buildExcalidrawMd — 格式完整性', () => {
  const file = buildExcalidrawJSON(sampleElements);
  const md = buildExcalidrawMd(file);

  it('包含 Excalidraw 插件要求的 frontmatter', () => {
    expect(md).toContain('excalidraw-plugin: parsed');
    expect(md).toContain('tags: [excalidraw]');
    expect(md.startsWith('---\n')).toBe(true);
  });

  it('包含 # Excalidraw Data 和 ## Text Elements 段', () => {
    expect(md).toContain('# Excalidraw Data');
    expect(md).toContain('## Text Elements');
  });

  it('包含 %% ... %% 包裹的 Drawing compressed-json 块', () => {
    expect(md).toContain('%%');
    expect(md).toContain('## Drawing');
    expect(md).toContain('```compressed-json');
    expect(md).toMatch(/```compressed-json\n[\s\S]*?\n```/);
  });

  it('Text Elements 段含所有非空 text（去重）', () => {
    // 3 个元素里 2 个 text，但文本不重复 → 2 条
    expect(md).toContain('阿德勒个体心理学\n核心概念体系 ^');
    expect(md).toContain('核心概念体系 ^');
  });
});

describe('buildExcalidrawMd — 属性 100% 保留（UI 不变坏的保证）', () => {
  const file = buildExcalidrawJSON(sampleElements);
  const md = buildExcalidrawMd(file);
  const roundtripped = decompressMd(md);

  it('元素数不变', () => {
    expect(roundtripped.elements).toHaveLength(file.elements.length);
  });

  it('text 元素 fontSize/坐标/尺寸完全保留', () => {
    const origTexts = file.elements.filter(e => e.type === 'text');
    const newTexts = roundtripped.elements.filter((e: any) => e.type === 'text');
    for (let i = 0; i < origTexts.length; i++) {
      const o = origTexts[i];
      const n = newTexts[i];
      expect(n.fontSize).toBe(o.fontSize);
      expect(n.x).toBe(o.x);
      expect(n.y).toBe(o.y);
      expect(n.width).toBe(o.width);
      expect(n.height).toBe(o.height);
      expect(n.text).toBe(o.text);
    }
  });

  it('形状元素 strokeColor/backgroundColor/坐标/尺寸完全保留', () => {
    const origShapes = file.elements.filter(e => e.type === 'ellipse');
    const newShapes = roundtripped.elements.filter((e: any) => e.type === 'ellipse');
    const o = origShapes[0];
    const n = newShapes[0];
    expect(n.strokeColor).toBe(o.strokeColor);
    expect(n.backgroundColor).toBe(o.backgroundColor);
    expect(n.x).toBe(o.x);
    expect(n.y).toBe(o.y);
    expect(n.width).toBe(o.width);
    expect(n.height).toBe(o.height);
  });

  it('appState（视口/缩放/背景色）保留', () => {
    expect(roundtripped.appState.viewBackgroundColor).toBe('#ffffff');
    expect(roundtripped.appState.zoom).toEqual(file.appState.zoom);
  });

  it('文件类型标记保留', () => {
    expect(roundtripped.type).toBe('excalidraw');
    expect(roundtripped.version).toBe(2);
    expect(roundtripped.source).toBe('https://excalidraw.com');
  });
});

describe('buildExcalidrawMd — 健壮性', () => {
  it('空文本 text 元素不出现在 Text Elements 段', () => {
    const els: ElementDef[] = [
      { id: 'empty', type: 'text', x: 0, y: 0, width: 10, height: 10, text: '   ' },
      { id: 'real', type: 'text', x: 0, y: 0, width: 100, height: 30, text: '真实文本', fontSize: 16 },
    ];
    const md = buildExcalidrawMd(buildExcalidrawJSON(els));
    // 只出现 'real' 的文本（去重 + 非空校验）
    const textLines = md.split('## Text Elements')[1].split('%%')[0];
    expect(textLines).toContain('真实文本');
    // 空文本不生成 ^blockId 行
    const blockIdCount = (textLines.match(/\^\w{8}/g) || []).length;
    expect(blockIdCount).toBe(1);
  });

  it('压缩输出是合法 base64（可被 decompressFromBase64 还原）', () => {
    const md = buildExcalidrawMd(buildExcalidrawJSON(sampleElements));
    // 不抛错即证明压缩-解压链路通畅
    expect(() => decompressMd(md)).not.toThrow();
  });
});
