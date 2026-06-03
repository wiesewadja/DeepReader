/**
 * MinerU API Client
 *
 * 封装 MinerU 云 API 的调用逻辑：
 * - Agent 轻量 API（免 Token）
 * - 精准 API（需 Token）
 *
 * 使用 safeRequest（Obsidian requestUrl）绕过 CORS 限制
 */

import path from 'path';
import AdmZip from 'adm-zip';
import { safeRequest } from '../utils/safe-request';
import { log as piLog } from '../pageindex/core/logger';
import { parseMineruJson } from '../pageindex/parsers/mineru';
import { buildTocTree, fillNodeText, countTokens, extractImageExt } from '../pageindex/parsers/mineru-types';
import type { MineruJson, MineruPdfResult, MineruImage, PageText } from '../pageindex/parsers/mineru-types';
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
const MAX_PRECISION_PAGES = 200;

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
  /** 自定义 Agent API 端点（默认: https://mineru.net/api/v1） */
  agentBaseUrl?: string;
  /** 自定义 Precision API 端点（默认: https://mineru.net/api/v4） */
  precisionBaseUrl?: string;
  /** 进度回调（分批上传/解析时触发） */
  onProgress?: (message: string) => void;
}

export class MineruClient {
  private agentTimeout: number;
  private precisionTimeout: number;
  private pollInterval: number;
  private language: string;
  private agentBaseUrl: string;
  private precisionBaseUrl: string;
  private onProgress?: (message: string) => void;

  constructor(
    private token?: string,
    options?: MineruClientOptions
  ) {
    this.agentTimeout = options?.timeout ?? AGENT_TIMEOUT;
    this.precisionTimeout = options?.timeout ?? PRECISION_TIMEOUT;
    this.pollInterval = options?.pollInterval ?? POLL_INTERVAL;
    this.language = options?.language ?? 'ch';
    this.agentBaseUrl = options?.agentBaseUrl ?? AGENT_BASE;
    this.precisionBaseUrl = options?.precisionBaseUrl ?? PRECISION_BASE;
    this.onProgress = options?.onProgress;
  }

  /**
   * 从 PDF buffer 中快速提取页数（解析 /Count 字段）
   */
  private getPdfPageCount(buffer: Buffer): number {
    const text = buffer.toString('latin1');
    let maxCount = 0;
    const regex = /\/Count\s+(\d+)/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const count = parseInt(match[1]);
      if (count > maxCount) maxCount = count;
    }
    return maxCount;
  }

  /**
   * 解析 PDF（自动选择 API）
   */
  async parse(input: Buffer, fileName: string): Promise<MineruPdfResult> {
    // 有 Token 优先用精准 API（支持 200MB/200页）
    if (this.token) {
      return this.parseViaPrecision(input, fileName);
    }

    // 免费用户检查文件大小和页数限制
    const pageCount = this.getPdfPageCount(input);
    if (input.length > MAX_AGENT_FILE_SIZE) {
      throw new MineruError(
        `文件过大（${(input.length / 1024 / 1024).toFixed(1)}MB），免费 API 限 10MB。` +
        '请在设置中配置 MinerU Token 以支持大文件。'
      );
    }
    if (pageCount > MAX_AGENT_PAGES) {
      throw new MineruError(
        `文档共 ${pageCount} 页，免费 API 限 ${MAX_AGENT_PAGES} 页。` +
        '请在设置中配置 MinerU Token 以支持完整解析。'
      );
    }

    return this.parseViaAgent(input, fileName);
  }

  /**
   * Agent 轻量 API（≤10MB / ≤20页，免 Token）
   */
  async parseViaAgent(input: Buffer, fileName: string): Promise<MineruPdfResult> {
    const task = await this.requestUploadUrl(fileName);
    await this.uploadFile(task.fileUrl, input);
    const markdown = await this.pollAgentResult(task.taskId);
    return this.parseMarkdown(markdown, fileName);
  }

  /**
   * 从 Markdown 构建 MineruPdfResult
   */
  private parseMarkdown(markdown: string, fileName: string): MineruPdfResult {
    const lines = markdown.split('\n');

    const pages: PageText[] = [];
    const allTitles: { title: string; level: 1 | 2 | 3; pageIdx: number }[] = [];
    const images: MineruImage[] = [];
    const seenUrls = new Set<string>();
    let imgSeq = 0;

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

    const imageRegex = /!\[([^\]]*)\]\((https:\/\/cdn-mineru\.openxlab\.org\.cn\/[^\)]+)\)/g;

    for (const rawLine of lines) {
      const pageMatch = rawLine.match(/<!--\s*Page\s+(\d+)\s*-->/i);
      if (pageMatch) {
        flushPage();
        currentPageNum = parseInt(pageMatch[1]);
        continue;
      }

      const headingMatch = rawLine.match(/^(#{1,3})\s+(.+)/);
      if (headingMatch) {
        const level = headingMatch[1].length as 1 | 2 | 3;
        const title = headingMatch[2].trim();
        if (title) {
          allTitles.push({ title, level, pageIdx: currentPageNum - 1 });
        }
      }

      // Extract and replace image references
      // Collect matches first, then replace from end to avoid index shifting
      let line = rawLine;
      const imgMatches: Array<{ index: number; length: number; replacement: string }> = [];
      let match;
      imageRegex.lastIndex = 0;
      while ((match = imageRegex.exec(line)) !== null) {
        const url = match[2];
        let imgFileName: string;
        if (seenUrls.has(url)) {
          const existingImg = images.find(i => i.url === url);
          if (!existingImg) continue;
          imgFileName = existingImg.fileName;
        } else {
          seenUrls.add(url);
          imgSeq++;
          const ext = extractImageExt(url);
          imgFileName = `img-${imgSeq}${ext}`;
          images.push({
            url,
            fileName: imgFileName,
            caption: match[1] || undefined,
          });
        }
        imgMatches.push({
          index: match.index,
          length: match[0].length,
          replacement: `![[images/${imgFileName}]]`,
        });
      }
      // Replace from end to start to preserve indices
      for (let mi = imgMatches.length - 1; mi >= 0; mi--) {
        const m = imgMatches[mi];
        line = line.slice(0, m.index) + m.replacement + line.slice(m.index + m.length);
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
      images,
    };
  }

  /**
   * 精准 API（需 Token，支持 ≤200MB / ≤200页）
   * 超过 200 页时自动拆分 PDF，分批解析后合并结果
   */
  async parseViaPrecision(input: Buffer, fileName: string): Promise<MineruPdfResult> {
    if (!this.token) {
      throw new MineruError('MinerU Token not configured');
    }

    const totalPages = this.getPdfPageCount(input);
    piLog(`[parseViaPrecision] ${fileName}: ${totalPages} pages, ${input.length} bytes`);

    // 单次可处理，直接调用
    if (totalPages <= MAX_PRECISION_PAGES || totalPages === 0) {
      return this.precisionSingleBatch(input, fileName);
    }

    // 超过 200 页，拆分为多个 batch
    piLog(`[parseViaPrecision] Splitting ${totalPages} pages into batches of ${MAX_PRECISION_PAGES}`);
    const { PDFDocument } = await import('pdf-lib');
    const srcDoc = await PDFDocument.load(input, { ignoreEncryption: true });

    const batchCount = Math.ceil(totalPages / MAX_PRECISION_PAGES);
    const results: MineruPdfResult[] = [];

    for (let i = 0; i < batchCount; i++) {
      const startPage = i * MAX_PRECISION_PAGES;
      const endPage = Math.min(startPage + MAX_PRECISION_PAGES, totalPages);
      const pageIndices = Array.from({ length: endPage - startPage }, (_, k) => startPage + k);

      const batchLabel = `分批解析 ${i + 1}/${batchCount}（第 ${startPage + 1}-${endPage} 页）`;
      piLog(`[parseViaPrecision] ${batchLabel}`);
      this.onProgress?.(batchLabel);

      // 创建只包含当前页范围的新 PDF
      const newDoc = await PDFDocument.create();
      const copiedPages = await newDoc.copyPages(srcDoc, pageIndices);
      for (const page of copiedPages) {
        newDoc.addPage(page);
      }
      const batchBytes = await newDoc.save();
      const batchBuffer = Buffer.from(batchBytes);

      const batchFileName = `${path.parse(fileName).name}_part${i + 1}.pdf`;
      const result = await this.precisionSingleBatch(batchBuffer, batchFileName);
      results.push(result);
    }

    // 合并结果：修正页码编号 + 合并 pages/outline/images
    return this.mergeBatchResults(results, fileName, totalPages);
  }

  /** 单批次精准 API 调用 */
  private async precisionSingleBatch(input: Buffer, fileName: string): Promise<MineruPdfResult> {
    piLog(`[precisionSingleBatch] ${fileName}: ${(input.length / 1024 / 1024).toFixed(1)} MB`);
    const batch = await this.requestPrecisionUploadUrl(fileName);
    piLog(`[precisionSingleBatch] Upload URL obtained, batch ID: ${batch.batchId}`);
    await this.uploadFile(batch.fileUrls[0], input);
    piLog(`[precisionSingleBatch] Upload done, polling...`);
    const zipUrl = await this.pollPrecisionResult(batch.batchId);
    piLog(`[precisionSingleBatch] Parsing complete, downloading ZIP...`);
    return this.downloadAndParseZip(zipUrl);
  }

  /** 合并多批次结果 */
  private mergeBatchResults(results: MineruPdfResult[], fileName: string, totalPages: number): MineruPdfResult {
    let pageOffset = 0;
    const allPages: PageText[] = [];
    const allOutline: TreeNode[] = [];
    const allImages: MineruImage[] = [];

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      // 修正页码：每个 batch 的页码从 1 开始，需要加上偏移量
      for (const page of r.pages) {
        allPages.push({
          ...page,
          pageNumber: page.pageNumber + pageOffset,
        });
      }
      const adjustOutline = (nodes: TreeNode[]): TreeNode[] =>
        nodes.map(n => ({
          ...n,
          startIndex: n.startIndex !== undefined ? n.startIndex + pageOffset : n.startIndex,
          endIndex: n.endIndex !== undefined ? n.endIndex + pageOffset : n.endIndex,
          nodes: n.nodes ? adjustOutline(n.nodes) : undefined,
        }));
      allOutline.push(...adjustOutline(r.outline));
      allImages.push(...r.images);
      pageOffset += r.totalPages;
    }

    return {
      title: results[0]?.title || path.parse(fileName).name,
      totalPages,
      pages: allPages,
      outline: allOutline,
      images: allImages,
    };
  }

  // ════════════════════════════════════════════════════════════
  // Agent API 私有方法
  // ════════════════════════════════════════════════════════════

  private async requestUploadUrl(fileName: string): Promise<{ taskId: string; fileUrl: string }> {
    const resp = await safeRequest({
      url: `${this.agentBaseUrl}/parse/file`,
      method: 'POST',
      contentType: 'application/json',
      body: JSON.stringify({
        file_name: fileName,
        language: this.language,
      }),
    });

    if (resp.status >= 400) {
      throw new MineruError(`Agent API request failed: ${resp.status}`, resp.status);
    }

    const data = resp.json;
    if (data.code !== 0) {
      throw new MineruError(data.msg || 'Agent API error', data.code);
    }

    return {
      taskId: data.data.task_id,
      fileUrl: data.data.file_url,
    };
  }

  private async uploadFile(url: string, data: Buffer): Promise<void> {
    // 注意：OSS 预签名 URL 不包含 Content-Type，不能传 contentType 参数
    // 否则会导致签名验证失败 (SignatureDoesNotMatch)
    piLog(`[uploadFile] Uploading ${(data.length / 1024 / 1024).toFixed(1)} MB to OSS...`);
    const resp = await safeRequest({
      url,
      method: 'PUT',
      body: data.buffer as ArrayBuffer,
    });

    piLog(`[uploadFile] Upload response: ${resp.status}`);
    if (resp.status >= 400) {
      const errText = resp.text?.slice(0, 200) || '';
      piLog(`[uploadFile] Error response: ${errText}`);
      throw new MineruError(`File upload failed: ${resp.status}`, resp.status);
    }
  }

  private async pollAgentResult(taskId: string): Promise<string> {
    const start = Date.now();

    while (Date.now() - start < this.agentTimeout) {
      const resp = await safeRequest({ url: `${this.agentBaseUrl}/parse/${taskId}` });

      if (resp.status >= 400) {
        throw new MineruError(`Poll request failed: ${resp.status}`, resp.status);
      }

      const data = resp.json;
      const state = data.data?.state;

      if (state === 'done') {
        const mdResp = await safeRequest({ url: data.data.markdown_url });
        return mdResp.text;
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
    const resp = await safeRequest({
      url: `${this.precisionBaseUrl}/file-urls/batch`,
      method: 'POST',
      contentType: 'application/json',
      headers: {
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

    if (resp.status >= 400) {
      throw new MineruError(`Precision API request failed: ${resp.status}`, resp.status);
    }

    const data = resp.json;
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
    let lastState = '';

    while (Date.now() - start < this.precisionTimeout) {
      const resp = await safeRequest({
        url: `${this.precisionBaseUrl}/extract-results/batch/${batchId}`,
        headers: { 'Authorization': `Bearer ${this.token}` },
      });

      if (resp.status >= 400) {
        throw new MineruError(`Poll request failed: ${resp.status}`, resp.status);
      }

      const data = resp.json;
      const results = data.data?.extract_result;

      // API 还在处理中，extract_result 可能为空
      if (!results || results.length === 0) {
        piLog(`[pollPrecisionResult] ${batchId}: no results yet, waiting...`);
        await this.sleep(this.pollInterval);
        continue;
      }

      const result = results[0];
      const state = result.state;

      // 只在状态变化时打印日志
      if (state !== lastState) {
        const elapsed = ((Date.now() - start) / 1000).toFixed(0);
        piLog(`[pollPrecisionResult] ${batchId}: ${state} (${elapsed}s)`);
        lastState = state;
      }

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
    const resp = await safeRequest({ url: zipUrl });

    if (resp.status >= 400) {
      throw new MineruError(`ZIP download failed: ${resp.status}`, resp.status);
    }

    const arrayBuffer = resp.arrayBuffer;
    if (!arrayBuffer) {
      throw new MineruError('ZIP download returned empty response');
    }

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
 *
 * @param input PDF 文件内容
 * @param fileName 文件名（用于日志和结果标题）
 * @param token MinerU API Token（可选，不提供则使用免费 API）
 * @param options 额外选项（如自定义 API 端点）
 */
export async function parsePdfWithMineru(
  input: Buffer,
  fileName: string,
  token?: string,
  options?: MineruClientOptions
): Promise<MineruPdfResult> {
  const client = new MineruClient(token, options);
  return client.parse(input, fileName);
}
