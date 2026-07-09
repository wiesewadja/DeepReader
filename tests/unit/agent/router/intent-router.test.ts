import { describe, it, expect } from 'vitest';
import { IntentRouter } from '@/agent/router/intent-router';

/**
 * P0-2 诚实化后：intent-rules.json 的 tools[]/tool_aliases 已移除，
 * allowedTools 恒为 []、systemNote 恒为 ''（门禁改由各节点硬编码白名单控制，见 P1-1）。
 * 以下测试保留「意图路由本身仍正确」（detectedIntents / maxIterations），并固化诚实化语义。
 */
describe('IntentRouter', () => {
  const router = new IntentRouter();

  describe('测试 A: "画一个全书的思维导图"', () => {
    it('应命中 macro_overview + action_output', () => {
      const result = router.analyze('画一个全书的思维导图');

      expect(result.detectedIntents).toContain('检视阅读');
      expect(result.detectedIntents).toContain('动作输出');
      // 动态迭代：取两个规则中较大的值（action_output 的 3）
      expect(result.maxIterations).toBe(3);
    });
  });

  describe('测试 B: "帮我总结一下第3章"', () => {
    it('应命中 locate_chapter', () => {
      const result = router.analyze('帮我总结一下第3章');

      expect(result.detectedIntents).toContain('分析阅读-定位');
      // 定位章节：maxIterations = 3
      expect(result.maxIterations).toBe(3);
    });
  });

  describe('测试 C: "什么是第一天的答案？"', () => {
    it('应命中 concept_inquiry（概念探究）', () => {
      const result = router.analyze("什么是'第一天的答案'？");

      expect(result.detectedIntents).toContain('分析阅读-概念探究');
      // 概念检索：maxIterations = 3
      expect(result.maxIterations).toBe(3);
    });
  });

  describe('测试 D: "对比金字塔原理和这本书关于结构化思维的异同"', () => {
    it('应命中 syntopical', () => {
      const result = router.analyze('对比《金字塔原理》和这本书关于结构化思维的异同');

      expect(result.detectedIntents).toContain('主题阅读');
      // 主题阅读：maxIterations = 6
      expect(result.maxIterations).toBe(6);
    });
  });

  describe('测试 E: "第三章里那个手机厂商的例子"', () => {
    it('应命中 locate_chapter（章节定位优先）', () => {
      const result = router.analyze('帮我总结一下第3章，里面提到的那个手机厂商的例子重点说一下');

      expect(result.detectedIntents).toContain('检视阅读');
      expect(result.detectedIntents).toContain('分析阅读-定位');
      // 取两个规则中较大的值（locate_chapter 的 3）
      expect(result.maxIterations).toBe(3);
    });
  });

  describe('测试 F: "这本书的作者是谁"', () => {
    it('应使用兜底策略（无匹配规则）', () => {
      const result = router.analyze('这本书的作者是谁');

      expect(result.detectedIntents).toContain('分析阅读-微观检索');
      // 兜底：maxIterations = 4
      expect(result.maxIterations).toBe(4);
    });
  });

  describe('测试 G: "如何理解金字塔原理的核心思想"', () => {
    it('应命中 concept_inquiry（概念探究）', () => {
      const result = router.analyze('如何理解金字塔原理的核心思想');

      expect(result.detectedIntents).toContain('分析阅读-概念探究');
      // 概念检索：maxIterations = 3
      expect(result.maxIterations).toBe(3);
    });
  });

  describe('测试 H: "给我一个全书大纲"', () => {
    it('应命中 macro_overview，迭代次数最小', () => {
      const result = router.analyze('给我一个全书大纲');

      expect(result.detectedIntents).toContain('检视阅读');
      // 检视阅读：maxIterations = 2（最小）
      expect(result.maxIterations).toBe(2);
    });
  });

  describe('测试 I: "绘制信息图"', () => {
    it('应命中 action_output（动作输出）', () => {
      const result = router.analyze('请你针对共轭控制这个主题绘制信息图');

      expect(result.detectedIntents).toContain('动作输出');
      // 动作输出：maxIterations = 3
      expect(result.maxIterations).toBe(3);
    });
  });

  describe('诚实化语义（P0-2 回归守护）', () => {
    it('allowedTools 始终为空数组（工具门禁已移至节点白名单，json 不再声明 tools）', () => {
      const cases = [
        '画一个全书的思维导图',
        '帮我总结一下第3章',
        '什么是第一天的答案？',
        '对比这两本书的异同',
        '这本书的作者是谁',
      ];
      for (const q of cases) {
        expect(router.analyze(q).allowedTools).toEqual([]);
      }
    });

    it('systemNote 始终为空串（工具集为空时不输出强约束文本，避免误导模型）', () => {
      const cases = ['画一个全书的思维导图', '随便聊聊', '这本书的作者是谁'];
      for (const q of cases) {
        expect(router.analyze(q).systemNote).toBe('');
      }
    });

    it('json 无 tools/tool_aliases 后 analyze 不抛 Cannot read property forEach of undefined', () => {
      expect(() => router.analyze('test')).not.toThrow();
    });
  });
});
