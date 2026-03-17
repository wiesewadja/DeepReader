import { describe, it, expect } from 'vitest';
import { IntentRouter } from '../intent-router.js';

describe('IntentRouter', () => {
  const router = new IntentRouter();

  describe('测试 A: "画一个全书的思维导图"', () => {
    it('应命中 macro_overview + action_output', () => {
      const result = router.analyze('画一个全书的思维导图');

      expect(result.detectedIntents).toContain('检视阅读');
      expect(result.detectedIntents).toContain('动作输出');
      expect(result.allowedTools).toContain('get_toc');
      expect(result.allowedTools).toContain('excalidraw');
      expect(result.allowedTools).not.toContain('search_doc');
      expect(result.systemNote).toContain('检视阅读');
    });
  });

  describe('测试 B: "帮我总结一下第3章"', () => {
    it('应命中 locate_chapter', () => {
      const result = router.analyze('帮我总结一下第3章');

      expect(result.detectedIntents).toContain('分析阅读-定位');
      expect(result.allowedTools).toContain('get_toc');
      expect(result.allowedTools).toContain('get_chapter');
      expect(result.allowedTools).toContain('analyze_chapter');
    });
  });

  describe('测试 C: "什么是第一天的答案？"', () => {
    it('应使用兜底策略', () => {
      const result = router.analyze("什么是'第一天的答案'？");

      expect(result.detectedIntents).toContain('分析阅读-微观检索');
      expect(result.allowedTools).toContain('search_doc');
      expect(result.allowedTools).not.toContain('get_toc');
    });
  });

  describe('测试 D: "对比金字塔原理和这本书关于结构化思维的异同"', () => {
    it('应命中 syntopical', () => {
      const result = router.analyze('对比《金字塔原理》和这本书关于结构化思维的异同');

      expect(result.detectedIntents).toContain('主题阅读');
      expect(result.allowedTools).toContain('search_read_books');
    });
  });

  describe('测试 E: "第三章里那个手机厂商的例子"', () => {
    it('应命中 locate_chapter（章节定位优先）', () => {
      const result = router.analyze('帮我总结一下第3章，里面提到的那个手机厂商的例子重点说一下');

      expect(result.detectedIntents).toContain('检视阅读');
      expect(result.detectedIntents).toContain('分析阅读-定位');
      expect(result.allowedTools).toContain('get_toc');
      expect(result.allowedTools).toContain('get_chapter');
    });
  });
});
