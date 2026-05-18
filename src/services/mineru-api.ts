/**
 * MinerU API Client
 *
 * 封装 MinerU 云 API 的调用逻辑：
 * - Agent 轻量 API（免 Token）
 * - 精准 API（需 Token）
 */

import AdmZip from 'adm-zip';
import { parseMineruJson } from '../pageindex/parsers/mineru';
import { buildTocTree, fillNodeText, countTokens } from '../pageindex/parsers/mineru-types';
import type { MineruJson, MineruPdfResult, PageText } from '../pageindex/parsers/mineru-types';
import type { TreeNode } from '../pageindex/core/types';

// ════════════════════════════════════════════════════════════════
// 常量
// ════════════════════════════════════════════════════════════════

const AGENT_BASE = 'https://mineru.net/api/v1/agent';
const PRECISION_BASE = 'https://mineru.net/api/v4';

const AGENT_TIMEOUT = 300_000;    // 5 分钟
const PRECISION_TIMEOUT = 600_000; // 10 分钟
const POLL_INTERVAL = 3_000;       // 3 秒

const MAX_AGENT_FILE_SIZE = 10 * 1024 * 1024;  // 10MB
const MAX_AGENT_PAGES = 20;

// ════════════════════════════════════════════════════════════════
// 错误类型
// ════════════════════════════════════════════════════════════════

export class MineruError extends Error {
  constructor(
    message: string,
    public code?: number
  ) {
    super(message);
    this.name = 'MineruError';
  }
}

// ════════════════════════════════════════════════════════════════
// MineruClient
// ════════════════════════════════════════════════════════════════

export interface MineruClientOptions {
  timeout?: number;
  pollInterval?: number;
  language?: string;
}

export class MineruClient {
  private agentTimeout: number;
  private precisionTimeout: number;
  private pollInterval: number;
  private language: string;

  constructor(
    private token?: string,
    options?: MineruClientOptions
  ) {
    this.agentTimeout = options?.timeout ?? AGENT_TIMEOUT;
    this.precisionTimeout = options?.timeout ?? PRECISION_TIMEOUT;
    this.pollInterval = options?.pollInterval ?? POLL_INTERVAL;
    this.language = options?.language ?? 'ch';
  }

  /**
   * 判断文件是否适用 Agent 轻量 API（≤10MB 且≤20页）
   * 注意：页数在解析前未知，这里只能检查文件大小。
   * Agent API 服务端会在超限时返回错误。
   */
  private canUseAgentApi(fileSize: number): boolean {
    return fileSize <= MAX_AGENT_FILE_SIZE;
  }

  /**
   * 解析 PDF（自动选择 API）
   */
  async parse(input: Buffer, fileName: string): Promise<MineruPdfResult> {
    // 有 Token 优先用精准 API（支持 200MB/200页）
    if (this.token) {
      return this.parseViaPrecision(input, fileName);
    }

    // 免费用户用 Agent API（限 10MB/20页）
    if (this.canUseAgentApi(input.length)) {
      return this.parseViaAgent(input, fileName);
    }

    throw new MineruError(
      `File too large (${(input.length / 1024 / 1024).toFixed(1)}MB) for free API. ` +
      'Configure MinerU Token in settings for large PDFs.'
    );
  }

  /**
   * Agent 轻量 API（≤10MB / ≤20页，免 Token）
   *
   * 流程：
   * 1. POST /api/v1/agent/parse/file → { task_id, file_url }
   * 2. PUT file_url → 上传文件到 OSS
   * 3. GET /api/v1/agent/parse/{task_id} → 轮询直到 done
   */
  async parseViaAgent(input: Buffer, fileName: string): Promise<MineruPdfResult> {
    const task = await this.requestUploadUrl(fileName);
    await this.uploadFile(task.fileUrl, input);
    const markdown = await this.pollAgentResult(task.taskId);
    return this.parseMarkdown(markdown, fileName);
  }

  /**
   * 从 Markdown 构建 MineruPdfResult
   *
   * Agent API 返回纯 Markdown，没有 JSON 结构，
   * 需要自己解析分页标记和标题来构建结构
   */
  private parseMarkdown(markdown: string, fileName: string): MineruPdfResult {
    const lines = markdown.split('\n');

    const pages: PageText[] = [];
    const allTitles: { title: string; level: 1 | 2 | 3; pageIdx: number }[] = [];

    let currentPageNum = 1;
    let currentPageLines: string[] = [];

    const flushPage = () => {
      if (currentPageLines.length > 0 || pages.length === 0) {
        const pageText = currentPageLines.join('\n');
        pages.push({
          pageNumber: currentPageNum,
          text: pageText,
          tokenCount: countTokens(pageText),
        });
      }
      currentPageLines = [];
    };

    for (const line of lines) {
      const pageMatch = line.match(/<!--\s*Page\s+(\d+)\s*-->/i);
      if (pageMatch) {
        flushPage();
        currentPageNum = parseInt(pageMatch[1]);
        continue;
      }

      const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
      if (headingMatch) {
        const level = headingMatch[1].length as 1 | 2 | 3;
        const title = headingMatch[2].trim();
        if (title) {
          allTitles.push({ title, level, pageIdx: currentPageNum - 1 });
        }
      }

      currentPageLines.push(line);
    }

    flushPage();

    const outline = buildTocTree(allTitles);
    fillNodeText(
      outline,
      pages,
      (index: number) => {
        const nextNode = outline[index];
        return nextNode?.startIndex ?? Infinity;
      }
    );

    return {
      title: fileName.replace(/\.pdf$/i, ''),
      totalPages: pages.length,
      pages,
      outline,
    };
  }

  /**
   * 精准 API（需 Token，支持 ≤200MB / ≤200页）
   *
   * 流程：
   * 1. POST /api/v4/file-urls/batch → { batch_id, file_urls[] }
   * 2. PUT file_url → 上传文件到 OSS
   * 3. GET /api/v4/extract-results/batch/{batch_id} → 轮询直到 done
   * 4. 下载 ZIP → 解压 → 读 JSON → 解析
   */
  async parseViaPrecision(input: Buffer, fileName: string): Promise<MineruPdfResult> {
    if (!this.token) {
      throw new MineruError('MinerU Token not configured');
    }

    const batch = await this.requestPrecisionUploadUrl(fileName);
    await this.uploadFile(batch.fileUrls[0], input);
    const zipUrl = await this.pollPrecisionResult(batch.batchId);
    return this.downloadAndParseZip(zipUrl);
  }

  // ════════════════════════════════════════════════════════════
  // Agent API 私有方法
  // ════════════════════════════════════════════════════════════

  private async requestUploadUrl(fileName: string): Promise<{ taskId: string; fileUrl: string }> {
    const resp = await fetch(`${AGENT_BASE}/parse/file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_name: fileName,
        language: this.language,
      }),
    });

    if (!resp.ok) {
      throw new MineruError(`Agent API request failed: ${resp.status}`, resp.status);
    }

    const data = await resp.json();
    if (data.code !== 0) {
      throw new MineruError(data.msg || 'Agent API error', data.code);
    }

    return {
      taskId: data.data.task_id,
      fileUrl: data.data.file_url,
    };
  }

  private async uploadFile(url: string, data: Buffer): Promise<void> {
    const resp = await fetch(url, {
      method: 'PUT',
      body: new Uint8Array(data),
    });

    if (!resp.ok) {
      throw new MineruError(`File upload failed: ${resp.status}`, resp.status);
    }
  }

  private async pollAgentResult(taskId: string): Promise<string> {
    const start = Date.now();

    while (Date.now() - start < this.agentTimeout) {
      const resp = await fetch(`${AGENT_BASE}/parse/${taskId}`);
      if (!resp.ok) {
        throw new MineruError(`Poll request failed: ${resp.status}`, resp.status);
      }

      const data = await resp.json();
      const state = data.data?.state;

      if (state === 'done') {
        const markdownUrl = data.data.markdown_url;
        const mdResp = await fetch(markdownUrl);
        return mdResp.text();
      }

      if (state === 'failed') {
        throw new MineruError(
          data.data?.err_msg || 'Agent parsing failed',
          data.data?.err_code
        );
      }

      await this.sleep(this.pollInterval);
    }

    throw new MineruError('Agent API polling timeout');
  }

  // ════════════════════════════════════════════════════════════
  // 精准 API 私有方法
  // ════════════════════════════════════════════════════════════

  private async requestPrecisionUploadUrl(
    fileName: string,
    modelVersion: 'pipeline' | 'vlm' = 'vlm'
  ): Promise<{ batchId: string; fileUrls: string[] }> {
    const resp = await fetch(`${PRECISION_BASE}/file-urls/batch`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.token}`,
      },
      body: JSON.stringify({
        files: [{ name: fileName }],
        model_version: modelVersion,
        language: this.language,
        enable_formula: true,
        enable_table: true,
      }),
    });

    if (!resp.ok) {
      throw new MineruError(`Precision API request failed: ${resp.status}`, resp.status);
    }

    const data = await resp.json();
    if (data.code !== 0) {
      throw new MineruError(data.msg || 'Precision API error', data.code);
    }

    return {
      batchId: data.data.batch_id,
      fileUrls: data.data.file_urls,
    };
  }

  private async pollPrecisionResult(batchId: string): Promise<string> {
    const start = Date.now();

    while (Date.now() - start < this.precisionTimeout) {
      const resp = await fetch(
        `${PRECISION_BASE}/extract-results/batch/${batchId}`,
        {
          headers: { 'Authorization': `Bearer ${this.token}` },
        }
      );

      if (!resp.ok) {
        throw new MineruError(`Poll request failed: ${resp.status}`, resp.status);
      }

      const data = await resp.json();
      const results = data.data?.extract_result;

      if (!results || results.length === 0) {
        throw new MineruError('No results in precision API response');
      }

      const result = results[0];
      const state = result.state;

      if (state === 'done') {
        return result.full_zip_url;
      }

      if (state === 'failed') {
        throw new MineruError(result.err_msg || 'Precision parsing failed');
      }

      await this.sleep(this.pollInterval);
    }

    throw new MineruError('Precision API polling timeout');
  }

  private async downloadAndParseZip(zipUrl: string): Promise<MineruPdfResult> {
    const resp = await fetch(zipUrl);
    if (!resp.ok) {
      throw new MineruError(`ZIP download failed: ${resp.status}`, resp.status);
    }

    const arrayBuffer = await resp.arrayBuffer();
    const zip = new AdmZip(Buffer.from(arrayBuffer));

    const zipEntries = zip.getEntries();
    const jsonEntry =
      zipEntries.find(e => e.entryName === 'layout.json') ||
      zipEntries.find(e => e.entryName.endsWith('_content_list.json') && !e.entryName.includes('model') && !e.entryName.includes('layout')) ||
      zipEntries.find(e => e.entryName.endsWith('.json') && !e.entryName.includes('model') && !e.entryName.includes('layout'));

    if (!jsonEntry) {
      throw new MineruError('No JSON file found in ZIP');
    }

    const jsonContent = jsonEntry.getData().toString('utf-8');
    const mineruJson: MineruJson = JSON.parse(jsonContent);

    return parseMineruJson(mineruJson);
  }

  // ════════════════════════════════════════════════════════════
  // 工具方法
  // ════════════════════════════════════════════════════════════

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ════════════════════════════════════════════════════════════════
// 便捷函数
// ════════════════════════════════════════════════════════════════

/**
 * 使用 MinerU 解析 PDF 文件
 */
export async function parsePdfWithMineru(
  input: Buffer,
  fileName: string,
  token?: string
): Promise<MineruPdfResult> {
  const client = new MineruClient(token);
  return client.parse(input, fileName);
}
