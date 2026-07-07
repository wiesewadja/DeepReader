import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DeepPDFError,
  ErrorHandler,
  ErrorSeverity,
  ErrorCategory,
} from '@/utils/error-handler';

// Mock logger to suppress console output in tests
vi.mock('@/utils/logger.js', () => ({
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));

describe('DeepPDFError', () => {
  it('应使用默认值创建错误', () => {
    const error = new DeepPDFError('test message');
    expect(error.message).toBe('test message');
    expect(error.category).toBe(ErrorCategory.UNKNOWN);
    expect(error.severity).toBe(ErrorSeverity.ERROR);
    expect(error.name).toBe('DeepPDFError');
  });

  it('应使用自定义 category 和 severity 创建错误', () => {
    const error = new DeepPDFError(
      'network error',
      ErrorCategory.NETWORK,
      ErrorSeverity.WARNING,
    );
    expect(error.category).toBe(ErrorCategory.NETWORK);
    expect(error.severity).toBe(ErrorSeverity.WARNING);
  });

  it('应包含原始错误', () => {
    const original = new Error('original');
    const error = new DeepPDFError('wrapped', ErrorCategory.UNKNOWN, ErrorSeverity.ERROR, undefined, original);
    expect(error.originalError).toBe(original);
  });

  it('应包含 context', () => {
    const error = new DeepPDFError('test', ErrorCategory.UNKNOWN, ErrorSeverity.ERROR, undefined, undefined, { key: 'value' });
    expect(error.context).toEqual({ key: 'value' });
  });

  it('应根据 category 提供默认 userMessage', () => {
    const networkError = new DeepPDFError('fail', ErrorCategory.NETWORK);
    expect(networkError.userMessage).toBe('网络连接失败，请检查服务器是否运行');

    const apiError = new DeepPDFError('fail', ErrorCategory.API);
    expect(apiError.userMessage).toBe('服务器请求失败，请稍后重试');

    const validationError = new DeepPDFError('fail', ErrorCategory.VALIDATION);
    expect(validationError.userMessage).toBe('输入数据有误，请检查后重试');

    const fileError = new DeepPDFError('fail', ErrorCategory.FILE);
    expect(fileError.userMessage).toBe('文件处理失败，请检查文件格式');

    const unknownError = new DeepPDFError('fail', ErrorCategory.UNKNOWN);
    expect(unknownError.userMessage).toBe('操作失败，请稍后重试');
  });

  it('应返回完整错误信息字符串', () => {
    const error = new DeepPDFError('test msg', ErrorCategory.API, ErrorSeverity.ERROR);
    const info = error.getFullErrorInfo();
    expect(info).toContain('[ERROR]');
    expect(info).toContain('[api]');
    expect(info).toContain('test msg');
  });

  it('getFullErrorInfo 应包含原始错误信息', () => {
    const original = new Error('original err');
    const error = new DeepPDFError('wrapped', ErrorCategory.UNKNOWN, ErrorSeverity.ERROR, undefined, original);
    const info = error.getFullErrorInfo();
    expect(info).toContain('原始错误: original err');
  });

  it('getFullErrorInfo 应包含 context 信息', () => {
    const error = new DeepPDFError('test', ErrorCategory.UNKNOWN, ErrorSeverity.ERROR, undefined, undefined, { foo: 'bar' });
    const info = error.getFullErrorInfo();
    expect(info).toContain('"foo": "bar"');
  });
});

describe('ErrorHandler', () => {
  let handler: ErrorHandler;

  beforeEach(() => {
    handler = ErrorHandler.getInstance();
    handler.clearErrorStats();
    handler.updateOptions({ showNotice: false, logToConsole: false });
  });

  it('应是单例', () => {
    const h1 = ErrorHandler.getInstance();
    const h2 = ErrorHandler.getInstance();
    expect(h1).toBe(h2);
  });

  it('应直接处理 DeepPDFError 并记录统计', () => {
    const error = new DeepPDFError('test', ErrorCategory.VALIDATION, ErrorSeverity.WARNING);
    handler.handle(error);
    const stats = handler.getErrorStats();
    expect(stats.size).toBe(1);
    const entry = stats.get('validation:test');
    expect(entry?.count).toBe(1);
  });

  it('应将普通 Error 标准化为 DeepPDFError（根据消息分类）', () => {
    const networkError = new Error('network connection failed');
    handler.handle(networkError);
    const stats = handler.getErrorStats();
    // 应被识别为 NETWORK 类别
    expect(stats.has('network:network connection failed')).toBe(true);
  });

  it('应将未知类型标准化为 DeepPDFError', () => {
    handler.handle('string error');
    const stats = handler.getErrorStats();
    // 应被归类为 UNKNOWN
    expect(stats.has('unknown:string error')).toBe(true);
  });

  it('应跟踪错误统计', () => {
    handler.handle(new DeepPDFError('test1', ErrorCategory.API, ErrorSeverity.ERROR));
    handler.handle(new DeepPDFError('test1', ErrorCategory.API, ErrorSeverity.ERROR));
    const stats = handler.getErrorStats();
    expect(stats.size).toBe(1);
    const entry = stats.get('api:test1');
    expect(entry?.count).toBe(2);
  });

  it('应清除错误统计', () => {
    handler.handle(new DeepPDFError('test', ErrorCategory.API, ErrorSeverity.ERROR));
    handler.clearErrorStats();
    expect(handler.getErrorStats().size).toBe(0);
  });

  it('handleNetworkError 应创建网络错误', () => {
    expect(() => handler.handleNetworkError(new Error('timeout'))).not.toThrow();
    const stats = handler.getErrorStats();
    expect(stats.size).toBe(1);
  });

  it('handleAPIError 应根据状态码提供不同消息', () => {
    const h = ErrorHandler.getInstance();
    expect(() => h.handleAPIError(400, 'bad request')).not.toThrow();
    expect(() => h.handleAPIError(401, 'unauthorized')).not.toThrow();
    expect(() => h.handleAPIError(404, 'not found')).not.toThrow();
    expect(() => h.handleAPIError(500, 'server error')).not.toThrow();
    expect(() => h.handleAPIError(503, 'unavailable')).not.toThrow();
    const stats = handler.getErrorStats();
    expect(stats.size).toBe(5);
  });

  it('handleValidationError 应创建验证错误', () => {
    expect(() => handler.handleValidationError('invalid input')).not.toThrow();
  });

  it('handleFileError 应创建文件错误', () => {
    expect(() => handler.handleFileError(new Error('read fail'), 'test.pdf')).not.toThrow();
    const stats = handler.getErrorStats();
    expect(stats.size).toBe(1);
  });
});
