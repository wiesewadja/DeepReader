/**
 * mergeQuotedNodeIds 单元测试
 *
 * 验证 PR 1 工具利用逻辑：
 * - 用户引用卡片中的 nodeId 应合并到 scope_node_ids
 * - LLM 推断的 scope_node_ids 应保留
 * - 重复应去重
 * - 两者都为空时返回 undefined
 */

import { describe, it, expect } from 'vitest';
import { mergeQuotedNodeIds } from '@/agent/tools/local/search-text';

describe('mergeQuotedNodeIds', () => {
  it('两者都为空时应返回 undefined', () => {
    expect(mergeQuotedNodeIds(undefined, undefined)).toBeUndefined();
    expect(mergeQuotedNodeIds([], undefined)).toBeUndefined();
    expect(mergeQuotedNodeIds(undefined, [])).toBeUndefined();
  });

  it('仅 user scope 不为空时应原样返回', () => {
    expect(mergeQuotedNodeIds(['0001', '0002'], undefined)).toEqual(['0001', '0002']);
  });

  it('仅 quoted 不为空时应返回 quoted', () => {
    expect(mergeQuotedNodeIds(undefined, [{ nodeId: '0024' }])).toEqual(['0024']);
  });

  it('应合并并去重 user scope + quoted', () => {
    const result = mergeQuotedNodeIds(['0001', '0002'], [{ nodeId: '0024' }, { nodeId: '0002' }]);
    expect(result).toEqual(['0001', '0002', '0024']);
  });

  it('应过滤掉 nodeId 为 undefined 的引用', () => {
    const result = mergeQuotedNodeIds(
      ['0001'],
      [{ nodeId: '0024' }, { nodeId: undefined }, { nodeId: '' }, {} as any]
    );
    expect(result).toEqual(['0001', '0024']);
  });

  it('应保留 user scope 的顺序，quoted 追加在末尾', () => {
    const result = mergeQuotedNodeIds(['0003', '0001'], [{ nodeId: '0024' }]);
    expect(result).toEqual(['0003', '0001', '0024']);
  });

  it('quotes 数组中有多个有效 nodeId 时应全部合并', () => {
    const result = mergeQuotedNodeIds(['0001'], [
      { nodeId: '0002' },
      { nodeId: '0003' },
      { nodeId: '0004' },
    ]);
    expect(result).toEqual(['0001', '0002', '0003', '0004']);
  });
});
