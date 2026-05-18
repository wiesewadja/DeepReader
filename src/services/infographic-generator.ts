import { requestUrl, type FileSystemAdapter } from 'obsidian';
import { safeRequest } from '../utils/safe-request.js';
import { serviceLog } from '../utils/logger.js';

const LEGACY_SENSENOVA_URL = 'https://token.sensenova.cn/v1';
const LEGACY_SENSENOVA_MODEL = 'sensenova-u1-fast';
const API_TIMEOUT = 60_000;
const DOWNLOAD_TIMEOUT = 30_000;

export const INFOGRAPHIC_SIZES: Record<string, string> = {
  '2:3':   '1664x2496',
  '3:2':   '2496x1664',
  '3:4':   '1760x2368',
  '4:3':   '2368x1760',
  '4:5':   '1824x2272',
  '5:4':   '2272x1824',
  '1:1':   '2048x2048',
  '16:9':  '2752x1536',
  '9:16':  '1536x2752',
  '21:9':  '3072x1376',
  '9:21':  '1344x3136',
};

export const DEFAULT_INFOGRAPHIC_SIZE = INFOGRAPHIC_SIZES['16:9'];

export interface InfographicOptions {
  prompt: string;
  size?: string;
  /** Vault 内的相对目录，如 "DeepReader/infographics" */
  relativeDir: string;
  /** Vault adapter 用于文件操作（替代 fs/promises） */
  vaultAdapter: FileSystemAdapter;
  filename?: string;
  /** API 端点，默认使用 MiniMax Image API */
  baseUrl?: string;
  /** 图片生成模型，默认 image-01 */
  model?: string;
}

export interface InfographicResult {
  url: string;
  localPath: string;
  relativePath: string;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} 超时 (${ms / 1000}s)`)), ms);
    }),
  ]);
}

function sanitizeFileName(name: string): string {
  return name.replace(/[\/\\]/g, '').replace(/\.\./g, '') || `infographic-${Date.now()}.png`;
}

export async function generateInfographic(
  apiKey: string,
  options: InfographicOptions,
): Promise<InfographicResult> {
  const size = options.size || DEFAULT_INFOGRAPHIC_SIZE;
  const baseUrl = options.baseUrl || LEGACY_SENSENOVA_URL;
  const model = options.model || LEGACY_SENSENOVA_MODEL;
  const apiUrl = `${baseUrl}/images/generations`;

  serviceLog(`[Infographic] 请求 ${model}, size: ${size}, baseUrl: ${baseUrl}`);

  const response = await withTimeout(
    safeRequest({
      url: apiUrl,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        prompt: options.prompt,
        size,
        n: 1,
      }),
      throw: true,
    }),
    API_TIMEOUT,
    'API 请求',
  );

  const data = response.json;
  const imageUrl: string = data?.data?.[0]?.url;
  if (!imageUrl) {
    throw new Error('图片生成 API 未返回图片 URL');
  }
  if (!imageUrl.startsWith('https://')) {
    throw new Error('图片生成 API 返回的图片 URL 无效（仅支持 HTTPS）');
  }

  let fileName = options.filename
    ? sanitizeFileName(options.filename)
    : `infographic-${Date.now()}.png`;
  const extMatch = imageUrl.match(/\.(png|jpg|jpeg|webp)/i);
  if (extMatch && !fileName.match(/\.(png|jpg|jpeg|webp)$/i)) {
    fileName += `.${extMatch[1]}`;
  }

  const relativePath = `${options.relativeDir}/${fileName}`;
  const localPath = `${options.vaultAdapter.getBasePath()}/${relativePath}`;

  serviceLog(`[Infographic] 下载图片: ${new URL(imageUrl).hostname}/...`);
  const imgResponse = await withTimeout(
    requestUrl({
      url: imageUrl,
      method: 'GET',
      contentType: 'application/octet-stream',
    }),
    DOWNLOAD_TIMEOUT,
    '图片下载',
  );

  await options.vaultAdapter.mkdir(options.relativeDir);
  await options.vaultAdapter.writeBinary(relativePath, imgResponse.arrayBuffer as ArrayBuffer);

  serviceLog(`[Infographic] 已保存: ${relativePath}`);
  return { url: imageUrl, localPath, relativePath };
}
