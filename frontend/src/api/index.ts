/**
 * DeepPDF API 服务统一导出
 *
 * 提供所有 API 调用的统一入口
 */

export {
  DeepPDFClient,
  deeppdfClient
} from './http-client';

// 类型导出
export type {
  APIResponse,
  HealthResponse,
  FileInfo,
  FileUploadResponse,
  FileListResponse,
  FileDetailResponse,
  FileDeleteResponse,
  LLMConfig,
  IndexingConfig,
  UserConfig,
  UserConfigUpdate,
  UserConfigListResponse,
  UserConfigResponse,
  IndexPDFRequest,
  IndexPDFResult,
  IndexListItem,
  ListIndexesResult,
  TaskProgress,
  DeleteIndexResult,
  CancelTaskResult,
  QueryResultItem,
  QueryPDFResult,
  AgentRequest,
  AgentResponse,
  AgentStreamChunk
} from './http-client';

export { ServerManager } from './server-manager';

// ==================== API 分类导出 ====================

import { deeppdfClient } from './http-client';

/**
 * 文件管理 API
 */
export const fileAPI = {
  /**
   * 上传 PDF 文件
   */
  upload: (file: File, onProgress?: (progress: number) => void) =>
    deeppdfClient.uploadFile(file, onProgress),

  /**
   * 列出所有文件
   */
  list: () => deeppdfClient.listFiles(),

  /**
   * 获取文件详情
   */
  get: (fileId: string) => deeppdfClient.getFileInfo(fileId),

  /**
   * 删除文件
   */
  delete: (fileId: string) => deeppdfClient.deleteFile(fileId)
};

/**
 * 配置管理 API
 */
export const configAPI = {
  /**
   * 列出所有配置
   */
  list: () => deeppdfClient.listConfigs(),

  /**
   * 获取默认配置
   */
  getDefault: () => deeppdfClient.getDefaultConfig(),

  /**
   * 创建配置
   */
  create: (config: import('./http-client').UserConfig) =>
    deeppdfClient.createConfig(config),

  /**
   * 更新配置
   */
  update: (name: string, update: import('./http-client').UserConfigUpdate) =>
    deeppdfClient.updateConfig(name, update),

  /**
   * 删除配置
   */
  delete: (name: string) => deeppdfClient.deleteConfig(name),

  /**
   * 设置默认配置
   */
  setDefault: (name: string) => deeppdfClient.setDefaultConfig(name)
};

/**
 * 索引管理 API
 */
export const indexAPI = {
  /**
   * 创建索引（使用已上传文件）
   */
  createWithFile: (
    fileId: string,
    configName?: string,
    overrides?: Partial<import('./http-client').IndexPDFRequest>
  ) => deeppdfClient.indexPDFWithFile(fileId, configName, overrides),

  /**
   * 创建索引（使用本地路径）
   */
  createWithPath: (
    path: string,
    llmConfig?: {
      llmProvider?: string;
      llmModel?: string;
      deepseekApiKey?: string;
      openaiApiKey?: string;
      apiUrl?: string;
      maxPagesPerNode?: number;
      maxTokensPerNode?: number;
      ifAddNodeSummary?: boolean;
    }
  ) => deeppdfClient.indexPDFWithPath(path, llmConfig),

  /**
   * 列出所有索引
   */
  list: () => deeppdfClient.listIndexes(),

  /**
   * 获取索引/任务状态
   */
  getStatus: (indexId: string) => deeppdfClient.getIndexStatus(indexId),

  /**
   * 获取任务详细进度
   */
  getProgress: (taskId: string) => deeppdfClient.getTaskProgress(taskId),

  /**
   * 轮询任务直到完成
   */
  poll: (
    taskId: string,
    onProgress?: (progress: import('./http-client').TaskProgress) => void,
    interval?: number
  ) => deeppdfClient.pollTaskStatus(taskId, onProgress, interval),

  /**
   * 删除索引
   */
  delete: (indexId: string) => deeppdfClient.deleteIndex(indexId),

  /**
   * 取消任务
   */
  cancel: (taskId: string) => deeppdfClient.cancelTask(taskId)
};

/**
 * 查询 API
 */
export const queryAPI = {
  /**
   * 语义搜索
   */
  search: (query: string, indexId: string) =>
    deeppdfClient.queryPDF(query, indexId)
};

/**
 * Agent 智能体 API
 */
export const agentAPI = {
  /**
   * Agent 对话（同步）
   */
  chat: (query: string, indexId: string) =>
    deeppdfClient.agentChat(query, indexId),

  /**
   * Agent 对话（流式）
   */
  chatStream: (
    query: string,
    indexId: string,
    onChunk: (chunk: string) => void,
    onComplete?: () => void,
    onError?: (error: string) => void,
    forceMode?: string
  ) => deeppdfClient.agentChatStream(query, indexId, onChunk, onComplete, onError, forceMode)
};

/**
 * 基础 API
 */
export const baseAPI = {
  /**
   * 健康检查
   */
  healthCheck: () => deeppdfClient.healthCheck(),

  /**
   * 获取 API 信息
   */
  getInfo: () => deeppdfClient.getAPIInfo()
};

// ==================== 使用示例 ====================

/**
 * 示例 1: 上传文件并创建索引
 *
 * ```typescript
 * import { fileAPI, indexAPI } from './api';
 *
 * // 1. 上传文件
 * const { file_id } = await fileAPI.upload(pdfFile, (progress) => {
 *   console.log(`上传进度: ${progress}%`);
 * });
 *
 * // 2. 创建索引
 * const { index_id } = await indexAPI.createWithFile(file_id, 'my-config');
 *
 * // 3. 轮询任务状态
 * const result = await indexAPI.poll(index_id, (progress) => {
 *   console.log(`索引进度: ${progress.progress_percent}%`);
 * });
 * ```

/**
 * 示例 2: 管理配置
 *
 * ```typescript
 * import { configAPI } from './api';
 *
 * // 列出所有配置
 * const { configs } = await configAPI.list();
 *
 * // 创建新配置
 * await configAPI.create({
 *   name: 'my-config',
 *   llm: { provider: 'deepseek', model: 'deepseek-chat' },
 *   indexing: { max_pages_per_node: 10 }
 * });
 *
 * // 设置为默认
 * await configAPI.setDefault('my-config');
 * ```

/**
 * 示例 3: 搜索查询
 *
 * ```typescript
 * import { queryAPI } from './api';
 *
 * const { results } = await queryAPI.search('什么是人工智能', 'idx_abc123');
 * results.forEach(item => {
 *   console.log(item.text);
 *   console.log('页码:', item.metadata.page);
 * });
 * ```
 */
