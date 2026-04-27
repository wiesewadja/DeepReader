import { describe, it, expect } from 'vitest';
import { layoutGraph } from '../layout-graph.js';
import type { GraphSemantic } from '../types.js';

describe('layoutGraph', () => {
  it('基本图谱：3 节点 2 边', () => {
    const data: GraphSemantic = {
      title: 'Test',
      nodes: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
        { id: 'c', label: 'C' },
      ],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
      ],
    };
    const result = layoutGraph(data);
    expect(result.nodes).toHaveLength(3);
    expect(result.edges).toHaveLength(2);
    expect(result.groups).toHaveLength(0);
  });

  it('带分组：生成 group 容器', () => {
    const data: GraphSemantic = {
      title: 'Test',
      groups: [
        { id: 'g1', label: '组1' },
        { id: 'g2', label: '组2' },
      ],
      nodes: [
        { id: 'a', label: 'A', group: 'g1' },
        { id: 'b', label: 'B', group: 'g1' },
        { id: 'c', label: 'C', group: 'g2' },
      ],
      edges: [
        { from: 'a', to: 'c' },
      ],
    };
    const result = layoutGraph(data);
    expect(result.nodes).toHaveLength(3);
    expect(result.groups).toHaveLength(2);
    expect(result.groups[0].label).toBe('组1');
  });

  it('多个 core 节点不重叠', () => {
    const data: GraphSemantic = {
      title: 'Test',
      nodes: [
        { id: 'c1', label: 'Core1', importance: 'core' },
        { id: 'c2', label: 'Core2', importance: 'core' },
        { id: 'm', label: 'Major', importance: 'major' },
      ],
      edges: [
        { from: 'c1', to: 'm' },
        { from: 'c2', to: 'm' },
      ],
    };
    const result = layoutGraph(data);
    const core1 = result.nodes.find(n => n.id === 'c1')!;
    const core2 = result.nodes.find(n => n.id === 'c2')!;
    const dist = Math.hypot(core2.x - core1.x, core2.y - core1.y);
    expect(dist).toBeGreaterThan(0);
  });

  it('importance 影响节点尺寸', () => {
    const data: GraphSemantic = {
      title: 'Test',
      nodes: [
        { id: 'core', label: 'C', importance: 'core' },
        { id: 'major', label: 'M', importance: 'major' },
        { id: 'minor', label: 'm', importance: 'minor' },
      ],
      edges: [],
    };
    const result = layoutGraph(data);
    const core = result.nodes.find(n => n.id === 'core')!;
    const minor = result.nodes.find(n => n.id === 'minor')!;
    expect(core.width).toBeGreaterThan(minor.width);
  });

  it('node type 影响形状', () => {
    const data: GraphSemantic = {
      title: 'Test',
      nodes: [
        { id: 'a', label: 'A', type: 'concept' },
        { id: 'b', label: 'B', type: 'person' },
        { id: 'c', label: 'C', type: 'event' },
      ],
      edges: [],
    };
    const result = layoutGraph(data);
    expect(result.nodes.find(n => n.id === 'a')!.shape).toBe('box');
    expect(result.nodes.find(n => n.id === 'b')!.shape).toBe('ellipse');
    expect(result.nodes.find(n => n.id === 'c')!.shape).toBe('diamond');
  });

  it('edge label 生成 labelPos', () => {
    const data: GraphSemantic = {
      title: 'Test',
      nodes: [
        { id: 'a', label: 'A', importance: 'core' },
        { id: 'b', label: 'B', importance: 'major' },
      ],
      edges: [
        { from: 'a', to: 'b', label: '关系' },
      ],
    };
    const result = layoutGraph(data);
    expect(result.edges[0].label).toBe('关系');
    expect(result.edges[0].labelPos).toBeDefined();
  });

  it('无效 from/to 的边被跳过', () => {
    const data: GraphSemantic = {
      title: 'Test',
      nodes: [
        { id: 'a', label: 'A' },
      ],
      edges: [
        { from: 'a', to: 'nonexistent' },
      ],
    };
    const result = layoutGraph(data);
    expect(result.edges).toHaveLength(0);
  });

  it('未分组节点放在分组区域右侧', () => {
    const data: GraphSemantic = {
      title: 'Test',
      groups: [{ id: 'g1', label: 'G1' }],
      nodes: [
        { id: 'a', label: 'A', group: 'g1' },
        { id: 'b', label: 'B' },
      ],
      edges: [],
    };
    const result = layoutGraph(data);
    const a = result.nodes.find(n => n.id === 'a')!;
    const b = result.nodes.find(n => n.id === 'b')!;
    expect(b.x).toBeGreaterThan(a.x);
  });
});
