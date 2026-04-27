import { describe, it, expect } from 'vitest';
import { layoutMindmap } from '../layout-mindmap.js';
import type { MindmapSemantic, RenderNode } from '../types.js';

/** 检查所有节点无重叠 */
function checkNoOverlap(nodes: RenderNode[]): void {
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      const overlapX = (a.width + b.width) / 2 - Math.abs(a.x - b.x);
      const overlapY = (a.height + b.height) / 2 - Math.abs(a.y - b.y);
      if (overlapX > 0 && overlapY > 0) {
        throw new Error(`重叠: ${a.text} (${a.x},${a.y}) 与 ${b.text} (${b.x},${b.y}), overlap=(${overlapX.toFixed(1)},${overlapY.toFixed(1)})`);
      }
    }
  }
}

describe('layoutMindmap', () => {
  it('单分支：生成 topic + 1 个 branch 节点 + 1 条边', () => {
    const data: MindmapSemantic = {
      topic: '中心主题',
      branches: [{ label: '分支A', children: [] }],
    };
    const result = layoutMindmap(data);
    expect(result.nodes).toHaveLength(2);
    expect(result.edges).toHaveLength(1);
    expect(result.nodes[0].id).toBe('topic');
    expect(result.nodes[0].text).toBe('中心主题');
    expect(result.nodes[1].text).toBe('分支A');
  });

  it('多分支：节点数 = 1(topic) + N(branches)', () => {
    const data: MindmapSemantic = {
      topic: 'T',
      branches: [
        { label: 'A', children: [] },
        { label: 'B', children: [] },
        { label: 'C', children: [] },
      ],
    };
    const result = layoutMindmap(data);
    expect(result.nodes).toHaveLength(4);
    expect(result.edges).toHaveLength(3);
  });

  it('子节点：branch 有 children 时递归布局', () => {
    const data: MindmapSemantic = {
      topic: 'T',
      branches: [{
        label: 'B',
        children: [
          { label: 'C1' },
          { label: 'C2' },
        ],
      }],
    };
    const result = layoutMindmap(data);
    expect(result.nodes).toHaveLength(4);
    expect(result.edges).toHaveLength(3);
  });

  it('叶节点：三级嵌套', () => {
    const data: MindmapSemantic = {
      topic: 'T',
      branches: [{
        label: 'B',
        children: [{
          label: 'C',
          children: [
            { label: 'L1' },
            { label: 'L2' },
          ],
        }],
      }],
    };
    const result = layoutMindmap(data);
    expect(result.nodes).toHaveLength(5);
  });

  it('topic 在画布中心 (500, 400)', () => {
    const data: MindmapSemantic = {
      topic: '中心',
      branches: [{ label: 'B', children: [] }],
    };
    const result = layoutMindmap(data);
    const topic = result.nodes[0];
    expect(topic.x).toBe(500);
    expect(topic.y).toBe(400);
  });

  it('分支节点到中心距离约 350px', () => {
    const data: MindmapSemantic = {
      topic: '中心',
      branches: [{ label: 'B', children: [] }],
    };
    const result = layoutMindmap(data);
    const topic = result.nodes[0];
    const branch = result.nodes[1];
    const dist = Math.hypot(branch.x - topic.x, branch.y - topic.y);
    expect(dist).toBeCloseTo(350, 0);
  });

  it('所有节点都有 style 属性和 fontFamily', () => {
    const data: MindmapSemantic = {
      topic: 'T',
      branches: [{ label: 'B', children: [{ label: 'C' }] }],
    };
    const result = layoutMindmap(data);
    for (const node of result.nodes) {
      expect(node.strokeColor).toBeDefined();
      expect(node.fillColor).toBeDefined();
      expect(node.width).toBeGreaterThan(0);
      expect(node.height).toBeGreaterThan(0);
      expect(node.fontFamily).toBeDefined();
    }
  });

  it('style 参数传递到节点 (roughness=0)', () => {
    const data: MindmapSemantic = {
      topic: 'T',
      branches: [{ label: 'B', children: [] }],
      style: 'precise',
    };
    const result = layoutMindmap(data);
    expect(result.nodes[0].roughness).toBe(0);
  });

  it('空 branches 不崩溃', () => {
    const data: MindmapSemantic = {
      topic: 'T',
      branches: [],
    };
    const result = layoutMindmap(data);
    expect(result.nodes).toHaveLength(1);
    expect(result.edges).toHaveLength(0);
  });

  it('节点宽度随文本长度自适应', () => {
    const shortData: MindmapSemantic = {
      topic: '短',
      branches: [{ label: 'A', children: [] }],
    };
    const longData: MindmapSemantic = {
      topic: '这是一个非常非常长的中心主题标题用来测试文字自适应宽度功能',
      branches: [{ label: 'A', children: [] }],
    };
    const shortResult = layoutMindmap(shortData);
    const longResult = layoutMindmap(longData);
    expect(longResult.nodes[0].width).toBeGreaterThan(shortResult.nodes[0].width);
  });

  it('多分支多子节点无重叠', () => {
    const data: MindmapSemantic = {
      topic: '读书方法',
      branches: [
        { label: '检视阅读', children: [{ label: '系统化略读' }, { label: '粗浅阅读' }] },
        { label: '分析阅读', children: [{ label: '规则一分类' }, { label: '规则二主旨' }, { label: '规则三论述' }] },
        { label: '主题阅读', children: [{ label: '找到相关章节' }, { label: '建立词汇' }] },
      ],
    };
    const result = layoutMindmap(data);
    expect(() => checkNoOverlap(result.nodes)).not.toThrow();
  });

  it('fillOpacity 始终为 1（不使用透明度）', () => {
    const data: MindmapSemantic = {
      topic: 'T',
      branches: [
        { label: 'B', children: [{ label: 'C' }, { label: 'D', children: [{ label: 'L' }] }] },
      ],
    };
    const result = layoutMindmap(data);
    for (const node of result.nodes) {
      expect(node.fillOpacity).toBe(1);
    }
  });
});
