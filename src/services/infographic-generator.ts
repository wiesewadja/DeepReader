import { writeFile, mkdir } from 'fs/promises';
import { requestUrl } from 'obsidian';
import { safeRequest } from '../utils/safe-request.js';
import { serviceLog } from '../utils/logger.js';

const BASE_URL = 'https://token.sensenova.cn/v1';
const MODEL = 'sensenova-u1-fast';

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
  outputDir: string;
  filename?: string;
}

export interface InfographicResult {
  url: string;
  localPath: string;
  relativePath: string;
}

export async function generateInfographic(
  apiKey: string,
  options: InfographicOptions,
): Promise<InfographicResult> {
  const size = options.size || DEFAULT_INFOGRAPHIC_SIZE;
  const apiUrl = `${BASE_URL}/images/generations`;

  serviceLog(`[Infographic] 请求 U1 Fast API, size: ${size}`);

  const response = await safeRequest({
    url: apiUrl,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      prompt: options.prompt,
      size,
      n: 1,
    }),
    throw: true,
  });

  const data = response.json;
  const imageUrl: string = data?.data?.[0]?.url;
  if (!imageUrl) {
    throw new Error('SenseNova API 未返回图片 URL');
  }

  let fileName = options.filename;
  if (!fileName) {
    const extMatch = imageUrl.match(/\.(png|jpg|jpeg|webp)/i);
    const ext = extMatch ? extMatch[1] : 'png';
    fileName = `infographic-${Date.now()}.${ext}`;
  }
  const localPath = `${options.outputDir}/${fileName}`;
  // outputDir = <vaultPath>/DeepReader/infographics → relativePath = DeepReader/infographics/<fileName>
  const dirSuffix = options.outputDir.split('/').slice(-2).join('/');
  const relativePath = `${dirSuffix}/${fileName}`;

  serviceLog(`[Infographic] 下载图片: ${imageUrl}`);
  const imgResponse = await requestUrl({
    url: imageUrl,
    method: 'GET',
    contentType: 'application/octet-stream',
  });
  const imgData = imgResponse.arrayBuffer;

  await mkdir(options.outputDir, { recursive: true });
  await writeFile(localPath, Buffer.from(imgData));

  serviceLog(`[Infographic] 已保存: ${localPath}`);
  return { url: imageUrl, localPath, relativePath };
}
