/**
 * DeepPDF HTTP 客户端
 * 完整的 API 调用封装
 */

// ==================== 类型定义 ====================

// 文档类型
export type DocumentType = "pdf" | "epub";

// 基础响应
export interface APIResponse {
  status: string;
  message?: string;
}

// 健康检查
export interface HealthResponse {
  status: string;
  version: string;
}

// 文件管理相关类型
export interface FileInfo {
  file_id: string;
  file_name: string;
  file_size: number;
  file_path: string;
  uploaded_at: string;
  status: string;
  indexed: boolean;
  indexes?: string[];
}

export interface FileUploadResponse {
  file_id: string;
  file_name: string;
  file_size: number;
  file_path: string;
  uploaded_at: string;
  status: string;
  indexed: boolean;
}

export interface FileListResponse {
  status: string;
  files: FileInfo[];
  total?: number;
}

export interface FileDetailResponse {
  status: string;
  file: FileInfo;
}

export interface FileDeleteResponse {
  status: string;
  message: string;
  file_id: string;
  deleted_indexes?: number;
}

// 配置管理相关类型
export interface LLMConfig {
  provider: string;
  model: string;
  api_key?: string;
  base_url?: string;
}

export interface IndexingConfig {
  toc_check_pages: number;
  max_pages_per_node: number;
  max_tokens_per_node: number;
  if_add_node_summary: boolean;
  if_add_node_text: boolean;
}

export interface UserConfig {
  name: string;
  description?: string;
  is_default: boolean;
  llm: LLMConfig;
  indexing: IndexingConfig;
}

export interface UserConfigUpdate {
  description?: string;
  is_default?: boolean;
  llm?: Partial<LLMConfig>;
  indexing?: Partial<IndexingConfig>;
}

export interface UserConfigListResponse {
  status: string;
  configs: UserConfig[];
}

export interface UserConfigResponse {
  status: string;
  config: UserConfig | null;
  message?: string;
}

// 索引管理相关类型
export interface IndexPDFRequest {
  file_id?: string;
  path?: string;
  config_name?: string;
  llm_provider?: string;
  llm_model?: string;
  deepseek_api_key?: string;
  openai_api_key?: string;
  api_url?: string;
  max_pages_per_node?: number;
  max_tokens_per_node?: number;
  if_add_node_summary?: boolean;
}

export interface IndexPDFResult {
  status: string;
  index_id?: string;
  message?: string;
  node_count?: number;
  pdf_name?: string;
  doc_type?: DocumentType;
  indexing_method?: string;
  error?: string;
}

export interface IndexListItem {
  id: string;
  pdf_name: string;
  node_count: number;
  created_at: string;
  status?: string;
  message?: string;
  progress_percent?: number;  // 索引进度 0-100
}

export interface ListIndexesResult {
  status: string;
  indexes: IndexListItem[];
}

export interface TaskProgress {
  id: string;
  status: string;  // pending, processing, completed, failed, cancelled
  message: string;
  pdf_path?: string;
  created_at?: string;
  current_step?: string;
  progress_percent?: number;
  total_steps?: number;
  completed_steps?: number;
  index_id?: string;
  node_count?: number;
  pdf_name?: string;
  error?: string;
}

export interface DeleteIndexResult {
  status: string;
  message?: string;
}

export interface CancelTaskResult {
  status: string;
  message?: string;
  task_id: string;
  current_status?: string;
}

// 聊天会话相关类型
export interface SessionInfo {
  sessionId: string;
  indexId: string;
  pdfName: string;
  messageCount: number;
  lastMessageTime: string;
  createdTime: string;
}

export interface ListSessionsResult {
  status: string;
  sessions: SessionInfo[];
}

// 查询相关类型
export interface QueryResultItem {
  text: string;
  metadata: {
    section?: string;
    page?: number;
    distance?: number;
    start_index?: number;
    end_index?: number;
    node_name?: string;
    node_id?: string;
  };
}

export interface QueryIndexInfo {
  pdf_name: string;
  pdf_path: string;
  node_count: number;
  created_at: string;
}

export interface QueryPDFResult {
  status: string;
  query?: string;
  results: QueryResultItem[];
  index_info?: QueryIndexInfo;
  error?: string;
}

// ==================== 阅读进度相关类型 ====================

export interface ReadingProgress {
  index_id: string;
  read_pages: number[];
  total_pages: number;
  progress: number;
  status: string;
  last_read_at: string | null;
  chat_rounds: number;
}

export interface UpdateProgressRequest {
  pages: number[];
}

// ==================== Agent 相关类型 ====================

/**
 * Agent 请求参数
 */
export interface AgentRequest {
  query: string;
  index_id: string;
  session_id?: string;
  keep_history?: boolean;
}

/**
 * Agent 引用信息
 */
export interface CitationInfo {
  node_id: string;
  obsidian_link: string;
  page?: number;
  anchor: string;
}

/**
 * Agent 响应（同步）
 */
export interface AgentResponse {
  status: string;
  answer?: string;
  error?: string;
  iterations?: number;
  citations?: CitationInfo[];
}

/**
 * Agent 流式响应数据块
 */
export interface AgentStreamChunk {
  content?: string;
  status?: 'streaming' | 'done' | 'error' | 'citations_done';
  error?: string;
  citations?: CitationInfo[];
}

// ==================== HTTP 客户端类 ====================

export interface SaveMarkdownMappingResponse {
  status: string;
  index_id: string;
}

export interface ExportNodeData {
  node_id: string;
  node_name: string;
  section: string;
  page_range: string;
  start_index: number | string;
  end_index: number | string;
  level: number;
  text: string;
}

export interface ExportIndexResponse {
  status: string;
  index_id: string;
  pdf_name: string;
  nodes: ExportNodeData[];
}

export class DeepPDFClient {
  private baseUrl: string;
  private readonly DEFAULT_PORT = 6088;

  constructor(port?: number) {
    this.baseUrl = `http://localhost:${port || this.DEFAULT_PORT}`;
  }

  // ==================== 辅助方法 ====================

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, options);

    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Request failed' }));
      throw new Error(error.detail || error.message || 'Request failed');
    }

    return response.json();
  }

  // ==================== 基础 API ====================

  /**
   * 健康检查
   */
  async healthCheck(): Promise<HealthResponse> {
    return this.request<HealthResponse>('/health');
  }

  /**
   * 获取 API 信息
   */
  async getAPIInfo(): Promise<{ message: string; version: string; docs: string; health: string }> {
    return this.request('/');
  }

  // ==================== 文件管理 API ====================

  /**
   * 上传 PDF 文件
   * @param file PDF 文件对象
   * @param onProgress 上传进度回调（可选）
   */
  async uploadFile(
    file: File,
    onProgress?: (progress: number) => void
  ): Promise<FileUploadResponse> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      // 上传进度
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable && onProgress) {
          const progress = Math.round((e.loaded / e.total) * 100);
          onProgress(progress);
        }
      });

      // 完成
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const response = JSON.parse(xhr.responseText);
          resolve(response);
        } else {
          const error = JSON.parse(xhr.responseText);
          reject(new Error(error.detail || 'Upload failed'));
        }
      });

      // 错误
      xhr.addEventListener('error', () => {
        reject(new Error('Network error during upload'));
      });

      // 上传
      const formData = new FormData();
      formData.append('file', file);

      xhr.open('POST', `${this.baseUrl}/api/files`);
      xhr.send(formData);
    });
  }

  /**
   * 列出所有文件
   */
  async listFiles(): Promise<FileListResponse> {
    return this.request<FileListResponse>('/api/files');
  }

  /**
   * 获取文件详情
   */
  async getFileInfo(fileId: string): Promise<FileDetailResponse> {
    return this.request<FileDetailResponse>(`/api/files/${fileId}`);
  }

  /**
   * 删除文件
   */
  async deleteFile(fileId: string): Promise<FileDeleteResponse> {
    return this.request<FileDeleteResponse>(`/api/files/${fileId}`, {
      method: 'DELETE'
    });
  }

  // ==================== 配置管理 API ====================

  /**
   * 列出所有配置
   */
  async listConfigs(): Promise<UserConfigListResponse> {
    return this.request<UserConfigListResponse>('/api/config');
  }

  /**
   * 获取默认配置
   */
  async getDefaultConfig(): Promise<UserConfigResponse> {
    return this.request<UserConfigResponse>('/api/config/default');
  }

  /**
   * 创建配置
   */
  async createConfig(config: UserConfig): Promise<UserConfigResponse> {
    return this.request<UserConfigResponse>('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    });
  }

  /**
   * 更新配置
   */
  async updateConfig(
    name: string,
    update: UserConfigUpdate
  ): Promise<UserConfigResponse> {
    return this.request<UserConfigResponse>(`/api/config/${name}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(update)
    });
  }

  /**
   * 删除配置
   */
  async deleteConfig(name: string): Promise<UserConfigResponse> {
    return this.request<UserConfigResponse>(`/api/config/${name}`, {
      method: 'DELETE'
    });
  }

  /**
   * 设置默认配置
   */
  async setDefaultConfig(name: string): Promise<UserConfigResponse> {
    return this.request<UserConfigResponse>(`/api/config/${name}/set-default`, {
      method: 'PATCH'
    });
  }

  // ==================== 索引管理 API ====================

  /**
   * 创建 PDF 索引（使用本地路径）
   * @deprecated 使用 indexPDFWithFile 或 indexPDFWithPath 代替
   */
  async indexPDF(
    pdfPath: string,
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
  ): Promise<IndexPDFResult> {
    return this.indexPDFWithPath(pdfPath, llmConfig);
  }

  /**
   * 创建 PDF 索引（使用已上传文件）
   */
  async indexPDFWithFile(
    fileId: string,
    configName?: string,
    overrides?: Partial<IndexPDFRequest>
  ): Promise<IndexPDFResult> {
    const requestBody: IndexPDFRequest = {
      file_id: fileId,
      ...overrides
    };

    if (configName) {
      requestBody.config_name = configName;
    }

    return this.request<IndexPDFResult>('/api/index', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });
  }

  /**
   * 创建 PDF 索引（使用本地路径）
   */
  async indexPDFWithPath(
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
  ): Promise<IndexPDFResult> {
    const requestBody: IndexPDFRequest = { path };

    // 添加 LLM 配置
    if (llmConfig) {
      if (llmConfig.llmProvider) requestBody.llm_provider = llmConfig.llmProvider;
      if (llmConfig.llmModel) requestBody.llm_model = llmConfig.llmModel;
      if (llmConfig.deepseekApiKey) requestBody.deepseek_api_key = llmConfig.deepseekApiKey;
      if (llmConfig.openaiApiKey) requestBody.openai_api_key = llmConfig.openaiApiKey;
      if (llmConfig.apiUrl) requestBody.api_url = llmConfig.apiUrl;
      if (llmConfig.maxPagesPerNode !== undefined) {
        requestBody.max_pages_per_node = llmConfig.maxPagesPerNode;
      }
      if (llmConfig.maxTokensPerNode !== undefined) {
        requestBody.max_tokens_per_node = llmConfig.maxTokensPerNode;
      }
      if (llmConfig.ifAddNodeSummary !== undefined) {
        requestBody.if_add_node_summary = llmConfig.ifAddNodeSummary;
      }
    }

    return this.request<IndexPDFResult>('/api/index', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });
  }

  /**
   * 列出所有索引
   */
  async listIndexes(): Promise<ListIndexesResult> {
    return this.request<ListIndexesResult>('/api/indexes');
  }

  /**
   * 获取所有进行中的任务
   */
  async getActiveTasks(): Promise<TaskProgress[]> {
    const result = await this.listIndexes();
    return result.indexes
      .filter((index: IndexListItem) => index.id.startsWith('task_'))
      .map((index: IndexListItem) => ({
        id: index.id,
        status: index.status === 'pending' || index.status === 'processing' ? index.status : 'pending',
        message: index.message || '任务进行中',
        pdf_name: index.pdf_name
      } as TaskProgress));
  }

  /**
   * 获取索引/任务状态
   */
  async getIndexStatus(indexId: string): Promise<TaskProgress> {
    return this.request<TaskProgress>(`/api/indexes/${indexId}`);
  }

  /**
   * 获取任务详细进度
   */
  async getTaskProgress(taskId: string): Promise<TaskProgress> {
    return this.request<TaskProgress>(`/api/tasks/${taskId}/progress`);
  }

  /**
   * 删除索引
   */
  async deleteIndex(indexId: string): Promise<DeleteIndexResult> {
    return this.request<DeleteIndexResult>(`/api/indexes/${indexId}`, {
      method: 'DELETE'
    });
  }

  /**
   * 取消任务
   */
  async cancelTask(taskId: string): Promise<CancelTaskResult> {
    return this.request<CancelTaskResult>(`/api/tasks/${taskId}`, {
      method: 'DELETE'
    });
  }

  // ==================== 查询 API ====================

  /**
   * 查询 PDF
   */
  async queryPDF(
    query: string,
    indexId: string,
    maxResults: number = 10
  ): Promise<QueryPDFResult> {
    return this.request<QueryPDFResult>('/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, index_id: indexId, max_results: maxResults })
    });
  }

  // ==================== 实用方法 ====================

  /**
   * 轮询任务状态直到完成
   * @param taskId 任务 ID
   * @param onProgress 进度回调
   * @param interval 轮询间隔（毫秒）
   */
  async pollTaskStatus(
    taskId: string,
    onProgress?: (progress: TaskProgress) => void,
    interval: number = 2000
  ): Promise<TaskProgress> {
    while (true) {
      const progress = await this.getTaskProgress(taskId);

      if (onProgress) {
        onProgress(progress);
      }

      if (progress.status === 'completed') {
        return progress;
      }

      if (progress.status === 'failed' || progress.status === 'cancelled') {
        throw new Error(progress.error || progress.message || `Task ${progress.status}`);
      }

      await new Promise(resolve => setTimeout(resolve, interval));
    }
  }

  /**
   * 完整工作流：上传文件并创建索引
   */
  async uploadAndIndex(
    file: File,
    configName?: string,
    onUploadProgress?: (progress: number) => void,
    onIndexProgress?: (progress: TaskProgress) => void
  ): Promise<TaskProgress> {
    // 1. 上传文件
    const uploadResult = await this.uploadFile(file, onUploadProgress);

    // 2. 创建索引
    const indexResult = await this.indexPDFWithFile(uploadResult.file_id, configName);

    if (indexResult.status !== 'pending' || !indexResult.index_id) {
      throw new Error(indexResult.error || 'Failed to create index');
    }

    // 3. 轮询任务状态
    return this.pollTaskStatus(indexResult.index_id, onIndexProgress);
  }

  // ==================== 导出 API ====================

  /**
   * 导出索引数据
   */
  async exportIndex(indexId: string): Promise<ExportIndexResponse> {
    return this.request<ExportIndexResponse>(`/api/export/${indexId}`);
  }

  /**
   * 保存 Markdown 文件映射
   */
  async saveMarkdownMapping(indexId: string, fileMapping: Record<string, string>): Promise<SaveMarkdownMappingResponse> {
    return this.request<SaveMarkdownMappingResponse>(`/api/markdown-mapping/${indexId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_mapping: fileMapping })
    });
  }

  // ==================== Agent API ====================

  /**
   * Agent 智能对话（同步）
   */
  async agentChat(query: string, indexId: string, sessionId?: string, keepHistory?: boolean): Promise<AgentResponse> {
    return this.request<AgentResponse>('/api/chat/agent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        index_id: indexId,
        session_id: sessionId,
        keep_history: keepHistory
      })
    });
  }

  /**
   * 获取会话历史
   */
  async getChatHistory(indexId: string, sessionId: string): Promise<any[]> {
    return this.request<any[]>(`/api/chat/history/${indexId}/${sessionId}`);
  }

  /**
   * Agent 智能对话（流式）
   * @param query 用户查询
   * @param indexId 索引 ID
   * @param onChunk 接收流式数据块的回调（包含可选的元数据）
   * @param onComplete 完成回调
   * @param onError 错误回调
   * @param forceMode 强制路由模式（可选）
   * @param includeCitations 是否包含引用数据（可选）
   * @returns AbortController 用于取消请求
   */
  agentChatStream(
    query: string,
    indexId: string,
    onChunk: (chunk: string, metadata?: { status?: string; citations?: CitationInfo[] }) => void,
    onComplete?: () => void,
    onError?: (error: string) => void,
    forceMode?: string,
    includeCitations?: boolean,
    sessionId?: string,
    keepHistory?: boolean
  ): AbortController {
    const controller = new AbortController();

    console.log('[Agent] 开始流式请求:', { query, indexId, forceMode, includeCitations, sessionId, baseUrl: this.baseUrl });

    // 构建请求体
    const body: any = {
      query,
      index_id: indexId,
      session_id: sessionId,
      keep_history: keepHistory
    };
    if (forceMode && forceMode !== 'auto') {
      body.force_mode = forceMode;
    }
    if (includeCitations) {
      body.include_citations = true;
    }

    fetch(`${this.baseUrl}/api/chat/agent/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    })
      .then(response => {
        console.log('[Agent] 收到响应:', { status: response.status, ok: response.ok, headers: Object.fromEntries(response.headers.entries()) });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('Response body is not readable');
        }

        console.log('[Agent] 开始读取流式数据');
        const decoder = new TextDecoder();
        let buffer = '';
        let chunkCount = 0;

        const read = (): Promise<void> => {
          return reader.read().then(({ done, value }) => {
            if (done) {
              console.log('[Agent] 流式读取完成');
              onComplete?.();
              return;
            }

            // 解码并追加到缓冲区
            buffer += decoder.decode(value, { stream: true });

            // 处理 SSE 格式: data: {...}\n\n
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // 保留最后一个不完整的行

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const jsonStr = line.slice(6);
                try {
                  const data: AgentStreamChunk = JSON.parse(jsonStr);
                  chunkCount++;

                  if (chunkCount <= 5) {
                    console.log('[Agent] 收到数据块:', { chunkCount, data });
                  }

                  if (data.status === 'error') {
                    console.error('[Agent] 错误状态:', data.error);
                    onError?.(data.error || 'Unknown error');
                    return;
                  }

                  if (data.status === 'done') {
                    console.log('[Agent] 收到完成信号, 总数据块:', chunkCount);
                    onComplete?.();
                    return;
                  }

                  // 构建元数据对象
                  const metadata: { status?: string; citations?: CitationInfo[] } = {};

                  if (data.status === 'citations_done') {
                    console.log('[Agent] 收到引用完成信号');
                    metadata.status = 'citations_done';
                  }

                  if (data.citations) {
                    console.log('[Agent] 收到引用数据:', data.citations);
                    metadata.citations = data.citations;
                  }

                  if (data.content) {
                    onChunk(data.content, metadata);
                  } else if (metadata.status || metadata.citations) {
                    // 只有元数据更新，没有新内容
                    onChunk('', metadata);
                  }
                } catch (e) {
                  console.error('[Agent] Failed to parse SSE data:', jsonStr, e);
                }
              }
            }

            return read(); // 继续读取
          });
        };

        return read();
      })
      .catch(err => {
        if (err.name === 'AbortError') {
          console.log('[Agent] Stream aborted by user');
        } else {
          onError?.(err.message || 'Stream request failed');
        }
      });

    return controller;
  }

  /**
   * 列出指定索引的所有会话
   */
  async listSessions(indexId: string): Promise<ListSessionsResult> {
    return this.request<ListSessionsResult>(`/api/chat/sessions/${indexId}`);
  }

  /**
   * 删除指定会话
   */
  async deleteSession(indexId: string, sessionId: string): Promise<{ status: string; message: string }> {
    return this.request<{ status: string; message: string }>(`/api/chat/sessions/${indexId}/${sessionId}`, {
      method: 'DELETE'
    });
  }

  // ==================== 阅读进度 API ====================

  /**
   * 更新阅读进度
   */
  async updateReadingProgress(indexId: string, pages: number[]): Promise<ReadingProgress> {
    return this.request<ReadingProgress>(`/api/reading/${indexId}/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pages })
    });
  }

  /**
   * 获取阅读进度
   */
  async getReadingProgress(indexId: string): Promise<ReadingProgress> {
    return this.request<ReadingProgress>(`/api/reading/${indexId}/progress`, {
      method: 'GET'
    });
  }
}

// ==================== 默认实例 ====================

export const deeppdfClient = new DeepPDFClient();
