/**
 * DeepPDF HTTP 客户端
 * 完整的 API 调用封装
 */

import { apiLog as log, error as logError } from '../utils/logger.js';
import { getDebugLogger } from '../agent/debug/index.js';

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
  reused?: boolean;
  has_result?: boolean;
  cover_url?: string;
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
  author?: string;  // 作者（EPUB 特有）
  node_count: number;
  created_at: string;
  status?: string;
  message?: string;
  progress_percent?: number;  // 索引进度 0-100
  current_step?: string;  // 当前进骤标识
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
  /** 章节文件映射，key 是 node_id，value 是文件路径 */
  markdown_files?: Record<string, string>;
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
    // 段落相关字段
    type?: 'section' | 'paragraph';
    block_id?: string;
    full_paragraph?: string;
    parent_section?: string;
    // 相邻段落（上下文）
    prev_paragraph?: string;
    next_paragraph?: string;
  };
}

export interface QueryIndexInfo {
  pdf_name: string;
  pdf_path: string;
  node_count: number;
  created_at: string;
  doc_description?: string;  // 全书摘要
}

export interface QueryPDFResult {
  status: string;
  query?: string;
  results: QueryResultItem[];
  index_info?: QueryIndexInfo;
  error?: string;
  // LLM 树搜索相关字段
  search_method?: string;        // "llm_tree_search" 或 "hybrid_..."
  thinking?: string;             // LLM 推理过程
  fallback?: boolean;            // 是否发生降级
  fallback_reason?: string;      // 降级原因
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

// 章节项
export interface ChapterItem {
  title: string;
  start_page: number;
  end_page: number;
  level: number;
  summary?: string;  // 章节摘要（LLM 生成）
  obsidian_link?: string;  // Obsidian Markdown 文件链接
}

// 章节目录响应
export interface TableOfContents {
  index_id: string;
  book_name: string;
  total_pages: number;
  chapters: ChapterItem[];
}

// 扁平化章节目录响应（2 级结构）
export interface SubChapter {
  title: string;
  node_id?: string;
  obsidian_link?: string;  // Obsidian Markdown 文件链接
}

export interface TocSection {
  level_1: string;
  node_id?: string;  // 一级章节节点 ID
  obsidian_link?: string;  // Obsidian Markdown 文件链接
  summary?: string;
  sub_chapters: SubChapter[];
}

export interface TableOfContentsFlat {
  status: string;
  book_title: string;
  toc: TocSection[];
}

// 摘要响应
export interface BookSummary {
  index_id: string;
  book_name: string;
  summary: string;
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
  context_docs?: ContextDoc[];
}

/**
 * 上下文文档（章节辅助阅读）
 */
export interface ContextDoc {
  path: string;
  name: string;
  content: string;
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

// ==================== Skills 相关类型 ====================

/**
 * Skill 信息
 */
export interface SkillInfo {
  name: string;
  description: string;
  tools?: string[];
  keywords?: string[];
  book_types?: string[];
  is_builtin: boolean;
  has_prompt: boolean;
}

/**
 * Skills 列表响应
 */
export interface SkillListResponse {
  skills: SkillInfo[];
  total: number;
  default_skill?: string;
}

/**
 * Skill 详情
 */
export interface SkillDetail {
  name: string;
  description: string;
  tools?: string[];
  default_params?: Record<string, Record<string, unknown>>;
  keywords?: string[];
  book_types?: string[];
  prompt_content?: string;
  meta?: {
    version?: string;
    author?: string;
    tags?: string[];
  };
  is_builtin: boolean;
  source_path?: string;
}

/**
 * Skill 路由请求
 */
export interface SkillRouteRequest {
  query?: string;
  book_type?: string;
  skill_name?: string;
}

/**
 * Skill 路由响应
 */
export interface SkillRouteResponse {
  skill: SkillInfo;
  match_type: 'manual' | 'book_type' | 'keyword' | 'default';
  confidence: number;
  matched_keywords?: string[];
}

// ==================== 跨书籍搜索相关类型 ====================

/**
 * 跨书籍搜索结果项
 */
export interface CrossBookSearchResult {
  text: string;
  book_name: string;
  index_id: string;
  section: string;
  page: number;
  obsidian_link: string;
}

/**
 * 跨书籍搜索响应
 */
export interface CrossBookSearchResponse {
  status: string;
  results: CrossBookSearchResult[];
  books_searched: number;
  total_results: number;
  error?: string;
}

// ==================== 主题报告类型 ====================

/**
 * 书籍视角（单本书对主题的观点）
 */
export interface BookPerspective {
  book_name: string;
  book_link: string;
  key_points: string[];
  related_chapter: string;
  related_chapter_link: string;
}

/**
 * 主题报告请求参数
 */
export interface ThemeReportRequest {
  theme: string;
  index_ids?: string[];
  top_k_per_book?: number;
}

/**
 * 主题报告响应
 */
export interface ThemeReportResponse {
  status: string;
  theme: string;
  unified_summary: string;
  book_perspectives: BookPerspective[];
  books_searched: number;
  markdown_content?: string;
  suggested_filename?: string;
  error?: string;
}

// ==================== 书籍摘要类型 ====================

/**
 * 章节摘要
 */
export interface ChapterSummary {
  node_id: string;
  title: string;
  summary: string;
  key_questions: string[];
}

/**
 * 书籍摘要
 */
export interface BookSummary {
  index_id: string;
  core_thesis: string;
  author_intents: string[];
  book_type: 'theoretical' | 'practical' | 'fiction' | 'mixed';
  chapter_summaries: ChapterSummary[];
  generated_at?: string;
  model_used?: string;
}

/**
 * 生成摘要请求参数
 */
export interface GenerateSummaryRequest {
  index_id: string;
  force_regenerate?: boolean;
}

/**
 * 生成摘要响应
 */
export interface GenerateSummaryResponse {
  status: string;
  summary?: BookSummary;
  error?: string;
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
  summary?: string;  // 章节摘要（LLM 生成）
  parent_id?: string;  // 父节点 ID
}

export interface ExportIndexResponse {
  status: string;
  index_id: string;
  pdf_name: string;
  author?: string;  // 作者（EPUB 特有）
  total_pages: number;
  created_at: string;
  nodes: ExportNodeData[];
}

// 封面响应
export interface CoverResponse {
  status: string;
  index_id: string;
  pdf_name: string;
  cover_data: string;  // base64 编码的图片数据
  mime_type: string;
  has_custom_cover: boolean;  // 是否有自定义封面（True=提取的，False=生成的默认封面）
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
    const method = options.method || 'GET';

    log(`[HTTP] ${method} ${endpoint}`);
    const startTime = performance.now();

    // 🐛 调试日志：记录请求
    const debugLogger = getDebugLogger();
    let requestBody: unknown = undefined;
    if (options.body) {
      try {
        requestBody = JSON.parse(options.body as string);
      } catch {
        requestBody = options.body;
      }
    }

    try {
      const response = await fetch(url, options);
      const duration = performance.now() - startTime;

      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Request failed' }));
        logError(`[HTTP] ${method} ${endpoint} 失败 (${response.status}):`, error.detail || error.message);

        // 🐛 调试日志：记录失败响应
        debugLogger?.logBackendCall({
          url,
          method,
          requestBody,
          responseStatus: response.status,
          responseBody: error,
          duration,
        });

        throw new Error(error.detail || error.message || 'Request failed');
      }

      const result = await response.json();
      log(`[HTTP] ${method} ${endpoint} 成功 (${duration.toFixed(0)}ms)`);

      // 🐛 调试日志：记录成功响应
      debugLogger?.logBackendCall({
        url,
        method,
        requestBody,
        responseStatus: response.status,
        responseBody: result,
        duration,
      });

      return result;
    } catch (e) {
      const duration = performance.now() - startTime;
      logError(`[HTTP] ${method} ${endpoint} 异常 (${duration.toFixed(0)}ms):`, e);
      throw e;
    }
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
   * @param query 查询文本
   * @param indexId 索引 ID
   * @param maxResults 最大结果数
   * @param useLLMTreeSearch 是否使用 LLM 树搜索（深度思考模式）
   * @param scopeNodeIds 范围锁定的节点 ID 列表（只在这些节点范围内搜索）
   */
  async queryPDF(
    query: string,
    indexId: string,
    maxResults: number = 10,
    useLLMTreeSearch: boolean = false,
    scopeNodeIds?: string[]
  ): Promise<QueryPDFResult> {
    return this.request<QueryPDFResult>('/api/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        index_id: indexId,
        max_results: maxResults,
        use_llm_tree_search: useLLMTreeSearch,
        scope_node_ids: scopeNodeIds
      })
    });
  }

  /**
   * 翻译文本
   */
  async translateText(
    text: string,
    targetLanguage: string = 'Chinese',
    provider: string = 'deepseek'
  ): Promise<{ status: string; original_text: string; translated_text: string }> {
    return this.request('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, target_language: targetLanguage, provider })
    });
  }

  // ==================== EPUB 图片 API ====================

  /**
   * 获取 EPUB 图片 URL
   * @param indexId 索引 ID
   * @param imageName 图片文件名
   * @returns 图片的完整 API URL
   */
  getEpubImageUrl(indexId: string, imageName: string): string {
    return `${this.baseUrl}/api/epub-images/${indexId}/${imageName}`;
  }

  /**
   * 列出 EPUB 中的所有图片
   * @param indexId 索引 ID
   */
  async listEpubImages(indexId: string): Promise<{
    status: string;
    index_id: string;
    image_count: number;
    images: Array<{
      name: string;
      url: string;
      size: number;
    }>;
  }> {
    return this.request(`/api/epub-images/${indexId}`);
  }

  /**
   * 获取 EPUB 图片数据（二进制）
   * @param indexId 索引 ID
   * @param imageName 图片文件名
   * @returns 图片的 ArrayBuffer 数据
   */
  async getEpubImage(indexId: string, imageName: string): Promise<ArrayBuffer> {
    const url = `${this.baseUrl}/api/epub-images/${indexId}/${imageName}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status}`);
    }

    return response.arrayBuffer();
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
   * @param indexId 索引 ID
   * 注意：导出时仅使用基于规则的快速格式化
   */
  async exportIndex(indexId: string): Promise<ExportIndexResponse> {
    return this.request<ExportIndexResponse>(`/api/export/${indexId}`);
  }

  /**
   * 导出书籍封面
   * 从 PDF/EPUB 文件中提取封面，如果没有则生成默认封面
   */
  async exportCover(indexId: string): Promise<CoverResponse> {
    return this.request<CoverResponse>(`/api/export/${indexId}/cover`);
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
    keepHistory?: boolean,
    contextDocs?: ContextDoc[]
  ): AbortController {
    const controller = new AbortController();

    log('[Agent] 开始流式请求:', { query, indexId, forceMode, includeCitations, sessionId, contextDocs: contextDocs?.length, baseUrl: this.baseUrl });

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
    if (contextDocs && contextDocs.length > 0) {
      body.context_docs = contextDocs;
    }

    fetch(`${this.baseUrl}/api/chat/agent/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    })
      .then(response => {
        log('[Agent] 收到响应:', { status: response.status, ok: response.ok, headers: Object.fromEntries((response.headers as any).entries()) });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('Response body is not readable');
        }

        log('[Agent] 开始读取流式数据');
        const decoder = new TextDecoder();
        let buffer = '';
        let chunkCount = 0;

        const read = (): Promise<void> => {
          return reader.read().then(({ done, value }) => {
            if (done) {
              log('[Agent] 流式读取完成');
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
                    log('[Agent] 收到数据块:', { chunkCount, data });
                  }

                  if (data.status === 'error') {
                    logError('[Agent] 错误状态:', data.error);
                    onError?.(data.error || 'Unknown error');
                    return;
                  }

                  if (data.status === 'done') {
                    log('[Agent] 收到完成信号, 总数据块:', chunkCount);
                    onComplete?.();
                    return;
                  }

                  // 构建元数据对象
                  const metadata: { status?: string; citations?: CitationInfo[] } = {};

                  if (data.status === 'citations_done') {
                    log('[Agent] 收到引用完成信号');
                    metadata.status = 'citations_done';
                  }

                  if (data.citations) {
                    log('[Agent] 收到引用数据:', data.citations);
                    metadata.citations = data.citations;
                  }

                  if (data.content) {
                    onChunk(data.content, metadata);
                  } else if (metadata.status || metadata.citations) {
                    // 只有元数据更新，没有新内容
                    onChunk('', metadata);
                  }
                } catch (e) {
                  logError('[Agent] Failed to parse SSE data:', jsonStr, e);
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
          log('[Agent] Stream aborted by user');
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

  /**
   * 获取书籍章节目录
   */
  async getTableOfContents(indexId: string): Promise<TableOfContents> {
    return this.request<TableOfContents>(`/api/reading/${indexId}/toc`, {
      method: 'GET'
    });
  }

  /**
   * 获取书籍扁平化章节目录（2 级结构：骨架+叶子）
   */
  async getTableOfContentsFlat(indexId: string): Promise<TableOfContentsFlat> {
    return this.request<TableOfContentsFlat>(`/api/reading/${indexId}/toc/flat`, {
      method: 'GET'
    });
  }

  /**
   * 获取书籍摘要
   */
  async getBookSummary(indexId: string, regenerate: boolean = false): Promise<BookSummary> {
    return this.request<BookSummary>(`/api/reading/${indexId}/summary?regenerate=${regenerate}`, {
      method: 'GET'
    });
  }

  // ==================== Skills API ====================

  /**
   * 获取所有可用的 Skills
   */
  async listSkills(): Promise<SkillListResponse> {
    return this.request<SkillListResponse>('/api/skills', {
      method: 'GET'
    });
  }

  /**
   * 获取内置 Skills 列表
   */
  async listBuiltinSkills(): Promise<SkillListResponse> {
    return this.request<SkillListResponse>('/api/skills/builtin', {
      method: 'GET'
    });
  }

  /**
   * 获取用户自定义 Skills 列表
   */
  async listUserSkills(): Promise<SkillListResponse> {
    return this.request<SkillListResponse>('/api/skills/user', {
      method: 'GET'
    });
  }

  /**
   * 获取 Skill 详情
   */
  async getSkillDetail(skillName: string): Promise<SkillDetail> {
    return this.request<SkillDetail>(`/api/skills/${skillName}`, {
      method: 'GET'
    });
  }

  /**
   * 路由到合适的 Skill
   * @param request 路由请求参数
   */
  async routeSkill(request: SkillRouteRequest): Promise<SkillRouteResponse> {
    return this.request<SkillRouteResponse>('/api/skills/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });
  }

  /**
   * 重新加载所有 Skills
   */
  async reloadSkills(): Promise<{ success: boolean; message: string; skills: string[] }> {
    return this.request<{ success: boolean; message: string; skills: string[] }>('/api/skills/reload', {
      method: 'POST'
    });
  }

  // ==================== 跨书籍搜索 API ====================

  /**
   * 跨书籍搜索
   * 在所有已索引的书籍中搜索相关内容
   */
  async crossBookSearch(
    query: string,
    options?: {
      indexIds?: string[];
      topK?: number;
    }
  ): Promise<CrossBookSearchResponse> {
    return this.request<CrossBookSearchResponse>('/api/cross-book/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        index_ids: options?.indexIds,
        top_k: options?.topK || 5
      })
    });
  }

  // ==================== 主题报告 API ====================

  /**
   * 生成主题整合报告
   * 跨书籍搜索并整合观点，生成 Markdown 报告
   */
  async generateThemeReport(
    theme: string,
    options?: {
      indexIds?: string[];
      topKPerBook?: number;
    }
  ): Promise<ThemeReportResponse> {
    return this.request<ThemeReportResponse>('/api/theme/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        theme,
        index_ids: options?.indexIds,
        top_k_per_book: options?.topKPerBook || 3,
      }),
    });
  }

  /**
   * 生成书籍结构化摘要（新 API）
   * 包含核心主旨、作者意图、书籍分类
   */
  async generateStructuredSummary(
    indexId: string,
    forceRegenerate: boolean = false
  ): Promise<GenerateSummaryResponse> {
    return this.request<GenerateSummaryResponse>('/api/summary/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        index_id: indexId,
        force_regenerate: forceRegenerate,
      }),
    });
  }

  /**
   * 获取书籍结构化摘要（新 API）
   */
  async getStructuredSummary(indexId: string): Promise<GenerateSummaryResponse> {
    return this.request<GenerateSummaryResponse>(`/api/summary/${indexId}`, {
      method: 'GET',
    });
  }
}

// ==================== 默认实例 ====================

export const deeppdfClient = new DeepPDFClient();
