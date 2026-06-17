import { describe, it, expect, vi, beforeEach } from 'vitest';
import { inspectionalNode } from '@/agent/graph/nodes/inspectional';
import { ReadingDepth } from '@/agent/graph/state';
import { HumanMessage } from '@langchain/core/messages';
import { verifyExistence, needsExistenceCheck } from '@/agent/router/existence-verifier.js';
import { IntentRouter } from '@/agent/router/intent-router.js';
import { inheritDepthOnContinuity } from '@/agent/router/continuity-guard.js';
import { detectCorrection } from '@/agent/graph/utils/correction-detector.js';

// Mock existence-verifier
vi.mock('@/agent/router/existence-verifier.js', () => ({
  verifyExistence: vi.fn().mockResolvedValue({ depth: 0, antiHallucinationQuery: '' }),
  needsExistenceCheck: vi.fn().mockReturnValue(false),
}));

// Mock IntentRouter
vi.mock('@/agent/router/intent-router.js', () => {
  const mockAnalyze = vi.fn().mockReturnValue({ detectedIntents: [], allowedTools: [] });
  return {
    IntentRouter: vi.fn().mockImplementation(() => ({
      analyze: mockAnalyze,
    })),
  };
});

// Mock continuity-guard
vi.mock('@/agent/router/continuity-guard.js', () => ({
  inheritDepthOnContinuity: vi.fn().mockReturnValue({ didUpgrade: false }),
}));

// Mock correction-detector
vi.mock('@/agent/graph/utils/correction-detector.js', () => ({
  detectCorrection: vi.fn().mockReturnValue(false),
}));

// Mock tree-loader
vi.mock('@/agent/graph/utils/tree-loader.js', () => ({
  loadTreeJson: vi.fn().mockResolvedValue(Object.assign([], { quality: 'good', qualityReason: '' })),
}));

describe('inspectionalNode S1-Unified', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeState(query: string, overrides: any = {}) {
    return {
      messages: [new HumanMessage(query)],
      allowedTools: [],
      pdfName: 'test.pdf',
      bookId: 'test-book-id',
      crossBookMode: false,
      ...overrides,
    } as any;
  }

  function makeConfig(mockModelReturnText?: string, currentNodeId: string | null = 'node-2') {
    const mockModel = mockModelReturnText ? {
      invoke: vi.fn().mockResolvedValue({ content: mockModelReturnText }),
    } : undefined;

    return {
      configurable: {
        fastModel: mockModel,
        toolContext: {
          book: {
            indexId: 'test-book-id',
            pdfName: 'test.pdf',
            docDescription: '测试文档描述',
            currentNodeId: currentNodeId,
          },
          vault: {
            app: {},
          },
        },
      },
    } as any;
  }

  describe('TS-level Short Circuits (前置纯 TS 规则短路)', () => {
    it('triggers short circuit for casual greeting "你好"', async () => {
      const state = makeState('你好');
      const config = makeConfig(); // No fastModel, demonstrating no LLM call is made
      
      const result = await inspectionalNode(state, config);
      
      expect(result.depth).toBe(ReadingDepth.CASUAL);
      expect(result.rewrittenQuery).toBe('你好');
      expect(result.tocSummary).toBe('闲聊/常规问答');
      expect(result.betterQuestion).toBe('你好');
    });

    it('triggers short circuit for short casual chat "hi" when router detects casual intent', async () => {
      const state = makeState('hi');
      const config = makeConfig();

      // Mock IntentRouter to detect "闲聊"
      const routerInstance = new IntentRouter();
      vi.mocked(routerInstance.analyze).mockReturnValue({
        detectedIntents: ['闲聊'],
        allowedTools: [],
      });

      const result = await inspectionalNode(state, config);

      expect(result.depth).toBe(ReadingDepth.CASUAL);
      expect(result.rewrittenQuery).toBe('hi');
      expect(result.tocSummary).toBe('闲聊/常规问答');
    });

    it('does not trigger short circuit for longer chat messages', async () => {
      const state = makeState('你好，我想问一下作者对运气的看法是什么？');
      const config = makeConfig('invalid json output'); // Trigger JSON parsing failure fallback

      const routerInstance = new IntentRouter();
      vi.mocked(routerInstance.analyze).mockReturnValue({
        detectedIntents: ['general_qa'],
        allowedTools: [],
      });

      const result = await inspectionalNode(state, config);

      // Should not short circuit (should continue to LLM logic and hit fallback global scope since model return was empty JSON)
      expect(result.tocSummary).toContain('无法解析大模型规划');
    });
  });

  describe('Post-LLM Existence check (后置存在性反查)', () => {
    it('downgrades to CASUAL and formats "not mentioned" response when verifyExistence fails to match', async () => {
      const state = makeState('书中提到逆向投资了吗？');
      
      // Mock LLM response
      const llmOutput = JSON.stringify({
        depth: 2,
        better_question: '书中提到逆向投资了吗？',
        scopeNodeIds: ['node-1'],
        tocSummary: '关于逆向投资的论述',
        visualize: false,
        suggested_keywords: ['逆向投资'],
        reason: '用户询问书中是否存在特定内容',
      });
      const config = makeConfig(llmOutput);

      // Mock needsExistenceCheck to return true
      vi.mocked(needsExistenceCheck).mockReturnValue(true);
      // Mock verifyExistence to return antiHallucinationQuery (meaning not found in book)
      vi.mocked(verifyExistence).mockResolvedValue({
        depth: ReadingDepth.CASUAL,
        antiHallucinationQuery: '逆向投资',
      });

      const result = await inspectionalNode(state, config);

      expect(result.depth).toBe(ReadingDepth.CASUAL);
      expect(result.scopeNodeIds).toEqual([]);
      expect(result.tocSummary).toBe('书内未提及该内容');
      expect(result.rewrittenQuery).toContain('这本书中并未提及"逆向投资"');
    });

    it('upgrades or retains ANALYTICAL depth when verifyExistence matches successfully', async () => {
      const state = makeState('书中提到运气了吗？');
      
      const llmOutput = JSON.stringify({
        depth: 2,
        better_question: '纳瓦尔关于运气的四种类型分别是什么？',
        scopeNodeIds: ['node-3'],
        tocSummary: '运气的定义和分类',
        visualize: false,
        suggested_keywords: ['运气'],
        reason: '分析运气相关内容',
      });
      const config = makeConfig(llmOutput, null);

      vi.mocked(needsExistenceCheck).mockReturnValue(true);
      vi.mocked(verifyExistence).mockResolvedValue({
        depth: ReadingDepth.ANALYTICAL,
        antiHallucinationQuery: '',
      });

      const result = await inspectionalNode(state, config);

      expect(result.depth).toBe(ReadingDepth.ANALYTICAL);
      expect(result.scopeNodeIds).toEqual(['node-3']); // Hard-guard keeps it as is since it is valid
      expect(result.tocSummary).toBe('运气的定义和分类');
      expect(result.rewrittenQuery).toBe('纳瓦尔关于运气的四种类型分别是什么？');
    });
  });
});
