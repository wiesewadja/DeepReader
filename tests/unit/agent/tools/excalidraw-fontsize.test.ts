/**
 * computeOptimalFontSize 单元测试
 *
 * 验证容器文字字号主动计算逻辑：
 * - 字号从四档 S16/M20/L28/XL36 里智能选（向下取档保证不溢出）
 * - 长文本通过自动换行获得更大字号（修复"字小框空"）
 * - 短文本不超过容器（不溢出）
 */
import { describe, it, expect } from 'vitest';
import { computeOptimalFontSize, buildExcalidrawJSON } from '@/agent/tools/excalidraw/excalidraw';
import type { ElementDef } from '@/agent/tools/excalidraw/excalidraw';

/** 字号四档（与 excalidraw.ts FONT_SIZE_TIERS 一致） */
const TIERS = [16, 20, 28, 36];
const isTier = (fs: number) => TIERS.includes(fs);

describe('computeOptimalFontSize', () => {
  it('字号必为四档之一（S16/M20/L28/XL36）', () => {
    const cases = [
      { text: '短', w: 160, h: 80 },
      { text: '梦境', w: 160, h: 80 },
      { text: '对社会合作中实现自我与贡献人类', w: 220, h: 110 },
      { text: '非常非常非常非常长的标题文本测试', w: 100, h: 50 },
      { text: '核心主题', w: 320, h: 160 }, // 大容器应能用上 XL
    ];
    for (const { text, w, h } of cases) {
      const { fontSize } = computeOptimalFontSize(text, w, h);
      expect(isTier(fontSize)).toBe(true);
    }
  });

  it('大容器短文本能用上最大档 XL(36)', () => {
    const { fontSize } = computeOptimalFontSize('核心', 320, 160);
    expect(fontSize).toBe(36);
  });

  it('长文本自动换行后字号大于最小档 S(16)', () => {
    // 旧逻辑：12字 / 220宽 → Math.min(16, 20) = 16
    const { fontSize } = computeOptimalFontSize('对他人与社会的关注与合作', 220, 110);
    expect(fontSize).toBeGreaterThan(16);
    expect(isTier(fontSize)).toBe(true);
  });

  it('15字超长文本换行后字号提升（核心修复场景）', () => {
    // 旧逻辑：15字 / 220宽 → 16（被压扁）
    const { fontSize, wrappedText } = computeOptimalFontSize('对社会合作中实现自我与贡献人类', 220, 110);
    expect(fontSize).toBeGreaterThan(16);
    expect(isTier(fontSize)).toBe(true);
    expect(wrappedText).toContain('\n'); // 应触发换行
  });

  it('短文本不换行，字号受容器限制不溢出', () => {
    const { fontSize, wrappedText } = computeOptimalFontSize('梦境', 160, 80);
    expect(wrappedText).toBe('梦境'); // 短文本不换行
    expect(isTier(fontSize)).toBe(true);
  });

  it('更大容器允许更大（或相等）字号', () => {
    const small = computeOptimalFontSize('核心概念', 160, 80).fontSize;
    const large = computeOptimalFontSize('核心概念', 300, 150).fontSize;
    expect(large).toBeGreaterThanOrEqual(small);
  });

  it('尊重用户手动换行（含 \\n 的文本按最长行算）', () => {
    const { wrappedText } = computeOptimalFontSize('第一行\n第二行', 220, 110);
    expect(wrappedText).toBe('第一行\n第二行'); // 不重新断行
  });

  it('返回的 wrappedText 字符数与原文一致（只加 \\n 不丢字）', () => {
    const text = '对社会合作中实现自我与贡献人类';
    const { wrappedText } = computeOptimalFontSize(text, 220, 110);
    const originalChars = text.length;
    const wrappedChars = wrappedText.replace(/\n/g, '').length;
    expect(wrappedChars).toBe(originalChars);
  });
});

describe('buildExcalidrawJSON — 去重', () => {
  it('LLM 同时给 shape.text 和独立 text（绑定同一容器）时，丢弃冗余 text', () => {
    // 模拟 LLM 的重复输出：rectangle 带 text，又给一个独立 text 指向它
    const elements: ElementDef[] = [
      { id: 'node-1', type: 'rectangle', x: 0, y: 0, width: 220, height: 110, text: '心灵与身体' },
      { id: 'extra-text', type: 'text', x: 10, y: 10, width: 200, height: 90, text: '心灵与身体', containerId: 'node-1' },
    ];
    const result = buildExcalidrawJSON(elements);
    const texts = result.elements.filter(e => e.type === 'text');
    // 应只剩 1 个 text（自动创建的 node-1_text），冗余 extra-text 被丢弃
    expect(texts).toHaveLength(1);
    expect(texts[0].id).toBe('node-1_text');
  });

  it('独立 text 绑定到无 text 属性的容器时，保留', () => {
    // 容器没 text 属性，只靠独立 text 标注 → 不算冗余，保留
    const elements: ElementDef[] = [
      { id: 'node-1', type: 'rectangle', x: 0, y: 0, width: 220, height: 110 },
      { id: 'label', type: 'text', x: 10, y: 10, width: 200, height: 90, text: '纯标签', containerId: 'node-1' },
    ];
    const result = buildExcalidrawJSON(elements);
    const texts = result.elements.filter(e => e.type === 'text');
    expect(texts).toHaveLength(1);
  });

  it('自由文本（无 containerId）永远保留', () => {
    const elements: ElementDef[] = [
      { id: 'title', type: 'text', x: 0, y: 0, width: 300, height: 40, text: '标题', strokeColor: '#000' },
    ];
    const result = buildExcalidrawJSON(elements);
    const texts = result.elements.filter(e => e.type === 'text');
    expect(texts).toHaveLength(1);
    expect(texts[0].text).toBe('标题');
  });
});
