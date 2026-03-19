import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DebugLogger, getCallStack } from '../logger';
import type { AgentSessionLog, StateExecutionLog } from '../types';

// Mock Obsidian App
const mockAdapter = {
  mkdir: vi.fn().mockResolvedValue(undefined),
  write: vi.fn().mockResolvedValue(undefined),
};

const mockApp = {
  vault: {
    adapter: mockAdapter,
  },
} as any;

describe('DebugLogger', () => {
  let logger: DebugLogger;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = new DebugLogger(mockApp, { enabled: true, logDir: 'debug-logs' });
  });

  afterEach(async () => {
    if (logger.isEnabled()) {
      await logger.endSession();
    }
  });

  describe('session management', () => {
    it('should start a session with correct metadata', async () => {
      await logger.startSession('什么是MECE？', '麦肯锡方法', 'idx_123');

      // Should create log directory
      expect(mockAdapter.mkdir).toHaveBeenCalled();
    });

    it('should end session and write files', async () => {
      await logger.startSession('测试问题', '测试书籍', 'idx_456');
      await logger.endSession();

      // Should write summary and session.json
      expect(mockAdapter.write).toHaveBeenCalled();
    });
  });

  describe('intent routing', () => {
    it('should log intent routing', async () => {
      await logger.startSession('测试', '书', 'idx');

      logger.logIntentRouting({
        detectedIntents: ['search', 'analyze'],
        allowedTools: ['search_markdown_text', 'read_markdown_section'],
        systemNote: 'Test note',
        maxIterations: 5,
        duration: 10,
      });

      await logger.endSession();

      // Should have written files
      expect(mockAdapter.write).toHaveBeenCalled();
    });
  });

  describe('state execution', () => {
    it('should track state execution lifecycle', async () => {
      await logger.startSession('测试', '书', 'idx');

      logger.startStateExecution('Router', {
        query: '什么是MECE？',
        historyCount: 0,
        availableTools: ['get_document_outline'],
      });

      logger.endStateExecution({
        depth: 2,
        standaloneQuery: 'MECE的定义是什么？',
        finishReason: 'stop',
      });

      await logger.endSession();

      expect(mockAdapter.write).toHaveBeenCalled();
    });

    it('should track multiple states', async () => {
      await logger.startSession('测试', '书', 'idx');

      // Router state
      logger.startStateExecution('Router', {
        query: '测试',
        historyCount: 0,
        availableTools: [],
      });
      logger.endStateExecution({ depth: 2, finishReason: 'stop' });

      // Analytical state
      logger.startStateExecution('Analytical', {
        query: '测试',
        historyCount: 0,
        availableTools: ['search_markdown_text'],
        scopeNodeIds: ['node_c1', 'node_c2'],
      });
      logger.endStateExecution({
        scopeNodeIds: ['node_c1', 'node_c2'],
        finishReason: 'stop',
      });

      await logger.endSession();

      expect(mockAdapter.write).toHaveBeenCalled();
    });
  });

  describe('LLM interaction', () => {
    it('should track LLM interactions', async () => {
      await logger.startSession('测试', '书', 'idx');

      logger.startStateExecution('Router', {
        query: '测试',
        historyCount: 0,
        availableTools: [],
      });

      logger.startLLMInteraction({
        model: 'deepseek-chat',
        modelType: 'fast',
        systemPrompt: 'You are a helpful assistant.',
        userMessage: 'Hello',
        toolCount: 0,
        messageCount: 2,
      });

      logger.endLLMInteraction({
        finishReason: 'stop',
        content: 'Hello! How can I help you?',
        inputTokens: 10,
        outputTokens: 8,
      });

      logger.endStateExecution({ finishReason: 'stop' });

      await logger.endSession();

      expect(mockAdapter.write).toHaveBeenCalled();
    });
  });

  describe('tool calls', () => {
    it('should track tool calls with interceptor info', async () => {
      await logger.startSession('测试', '书', 'idx');

      logger.startStateExecution('Analytical', {
        query: '测试',
        historyCount: 0,
        availableTools: ['search_markdown_text'],
      });

      logger.logToolCall({
        callId: 'call_123',
        toolName: 'search_markdown_text',
        originalArgs: { query: 'MECE' },
        interceptedArgs: { query: 'MECE', scopeNodeIds: ['node_c1'] },
        interceptorNote: 'scopeNodeIds 注入',
        status: 'success',
        result: JSON.stringify({ status: 'success', hits: [{ block_id: 'b1', text: '...' }] }),
        duration: 150,
      });

      logger.endStateExecution({ finishReason: 'stop' });

      await logger.endSession();

      expect(mockAdapter.write).toHaveBeenCalled();
    });
  });

  describe('getCallStack', () => {
    it('should return a string', () => {
      const stack = getCallStack();
      expect(typeof stack).toBe('string');
    });
  });
});