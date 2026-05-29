/**
 * pageindex-vault: Vector Storage (JSONL format)
 * Manages vector embeddings using JSONL files + global catalog
 *
 * Node.js compatible version
 */

import * as path from "path";
import * as fs from "node:fs/promises";
import type { App } from "obsidian";
import type {
  EmbeddingOptions,
  VectorRecord,
  ChunkTextRecord,
  CatalogMeta,
  CatalogBookEntry,
} from "./types";
import { cosineSimilarity } from "../core/utils";
import { safeRequest } from "../../utils/safe-request.js";
import { vaultRead } from "../../utils/mobile-fs.js";

// ─── JSONL Vector Storage ─────────────────────────────────────

/**
 * Atomic write: write to tmp file then rename (prevents data loss on crash)
 */
async function atomicWriteText(filePath: string, content: string): Promise<void> {
  const tmpPath = filePath + ".tmp";
  await fs.writeFile(tmpPath, content, "utf-8");
  await fs.rename(tmpPath, filePath);
}

/**
 * Write vector records to a JSONL file (atomic replace)
 */
export async function writeVectorJsonl(
  filePath: string,
  records: VectorRecord[]
): Promise<void> {
  const lines = records.map((r) => JSON.stringify(r));
  await atomicWriteText(filePath, lines.join("\n") + "\n");
}

/**
 * Read all vector records from a JSONL file (tolerates corrupt lines)
 */
export async function readVectorJsonl(
  filePath: string,
  app?: App
): Promise<VectorRecord[]> {
  try {
    const content = app
      ? await vaultRead(app, filePath)
      : await fs.readFile(filePath, "utf-8");
    const records: VectorRecord[] = [];
    for (const line of content.trim().split("\n")) {
      if (!line.trim()) continue;
      try { records.push(JSON.parse(line) as VectorRecord); }
      catch { /* skip corrupt line */ }
    }
    return records;
  } catch {
    return [];
  }
}

/**
 * Cosine search over a JSONL vector file
 */
export async function cosineSearchJsonl(
  filePath: string,
  queryVector: number[],
  topK: number,
  filter?: { level?: string },
  app?: App
): Promise<Array<{ chunkId: string; nodeId: string; blockIds: string[]; score: number }>> {
  const records = await readVectorJsonl(filePath, app);
  const query = new Float32Array(queryVector);
  const scores: Array<{ chunkId: string; nodeId: string; blockIds: string[]; score: number }> = [];

  for (const record of records) {
    if (filter?.level && record.level !== filter.level) continue;
    const vector = new Float32Array(record.vector);
    const score = cosineSimilarity(query, vector);
    scores.push({
      chunkId: record.chunkId,
      nodeId: record.nodeId,
      blockIds: record.blockIds,
      score,
    });
  }

  return scores.sort((a, b) => b.score - a.score).slice(0, topK);
}

/**
 * Write chunk text records to a JSONL file (atomic replace)
 */
export async function writeChunkTexts(
  filePath: string,
  records: ChunkTextRecord[]
): Promise<void> {
  const lines = records.map((r) => JSON.stringify(r));
  await atomicWriteText(filePath, lines.join("\n") + "\n");
}

/**
 * Read chunk text records from a JSONL file (tolerates corrupt lines)
 */
export async function readChunkTexts(
  filePath: string,
  app?: App
): Promise<ChunkTextRecord[]> {
  try {
    const content = app
      ? await vaultRead(app, filePath)
      : await fs.readFile(filePath, "utf-8");
    const records: ChunkTextRecord[] = [];
    for (const line of content.trim().split("\n")) {
      if (!line.trim()) continue;
      try { records.push(JSON.parse(line) as ChunkTextRecord); }
      catch { /* skip corrupt line */ }
    }
    return records;
  } catch {
    return [];
  }
}

// ─── Global Catalog ───────────────────────────────────────────

const CATALOG_FILE = "catalog.json";

/**
 * Load global catalog from .pageindex/catalog.json
 */
export async function loadCatalog(
  pageindexPath: string
): Promise<CatalogMeta> {
  const catalogPath = path.join(pageindexPath, CATALOG_FILE);
  try {
    const content = await fs.readFile(catalogPath, "utf-8");
    return JSON.parse(content) as CatalogMeta;
  } catch {
    return { version: 1, books: {} };
  }
}

/**
 * Update or insert a book entry in the global catalog
 */
export async function updateCatalogEntry(
  pageindexPath: string,
  bookId: string,
  entry: CatalogBookEntry
): Promise<void> {
  const catalog = await loadCatalog(pageindexPath);
  catalog.books[bookId] = entry;
  const catalogPath = path.join(pageindexPath, CATALOG_FILE);
  await fs.mkdir(pageindexPath, { recursive: true });
  await atomicWriteText(catalogPath, JSON.stringify(catalog, null, 2));
}

/**
 * Remove a book entry from the global catalog
 */
export async function removeCatalogEntry(
  pageindexPath: string,
  bookId: string
): Promise<void> {
  const catalog = await loadCatalog(pageindexPath);
  delete catalog.books[bookId];
  const catalogPath = path.join(pageindexPath, CATALOG_FILE);
  await atomicWriteText(catalogPath, JSON.stringify(catalog, null, 2));
}

// ─── Embedding Generation ─────────────────────────────────────

export async function generateEmbedding(
  text: string,
  options: EmbeddingOptions
): Promise<number[]> {
  if (options.provider === "local") {
    throw new Error("Local provider does not support embedding generation. Use BM25-only search instead.");
  }
  if (options.provider === "openai" || options.provider === "siliconflow" || options.provider === "deepseek") {
    return generateOpenAIEmbedding(text, options);
  } else if (options.provider === "ollama") {
    return generateOllamaEmbedding(text, options);
  } else if (options.provider === "lmstudio") {
    return generateOpenAIEmbedding(text, options);
  }
  throw new Error(`Unsupported embedding provider: ${options.provider}`);
}

export async function generateEmbeddings(
  texts: string[],
  options: EmbeddingOptions,
  onEmbedCall?: (info: { model: string; durationMs: number; inputTokens?: number; batchSize: number }) => void
): Promise<number[][]> {
  if (options.provider === "local") {
    throw new Error("Local provider does not support embedding generation. Use BM25-only search instead.");
  }

  const batchSize = options.batchSize ?? 32;
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    // 清洗：移除控制字符；空文本替换为占位符以保持索引对齐
    const batch = texts.slice(i, i + batchSize)
      .map(t => t.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') || ' ');

    if (options.provider === "openai" || options.provider === "lmstudio" || options.provider === "siliconflow" || options.provider === "deepseek") {
      const t0 = Date.now();
      const body: Record<string, unknown> = {
        model: options.model || "text-embedding-3-small",
        input: batch,
      };

      if (options.dimensions) {
        body.dimensions = options.dimensions;
      }

      const apiKey = options.apiKey || (options.provider === "lmstudio" ? "lm-studio" : process.env.OPENAI_API_KEY);
      if (!apiKey) {
        throw new Error(`API Key is required for ${options.provider} provider`);
      }

      const response = await safeRequest({
        url: `${options.baseUrl || (options.provider === "lmstudio" ? "http://localhost:1234/v1" : "https://api.openai.com/v1")}/embeddings`,
        method: "POST",
        contentType: "application/json",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
      });

      if (response.status >= 400) {
        throw new Error(`Embedding API error: ${response.status} - ${response.text}`);
      }

      const data = response.json as {
        data: Array<{ embedding: number[] }>;
        usage?: { prompt_tokens: number };
      };
      if (data.data.length !== batch.length) {
        throw new Error(`Embedding API returned ${data.data.length} results for ${batch.length} inputs`);
      }
      results.push(...data.data.map((item) => item.embedding));
      onEmbedCall?.({
        model: body.model as string,
        durationMs: Date.now() - t0,
        inputTokens: data.usage?.prompt_tokens,
        batchSize: batch.length,
      });
    } else if (options.provider === "ollama") {
      const t0 = Date.now();
      for (const text of batch) {
        const embedding = await generateOllamaEmbedding(text, options);
        results.push(embedding);
      }
      onEmbedCall?.({
        model: options.model || "nomic-embed-text",
        durationMs: Date.now() - t0,
        batchSize: batch.length,
      });
    }
  }

  return results;
}

async function generateOpenAIEmbedding(
  text: string,
  options: EmbeddingOptions
): Promise<number[]> {
  const body: Record<string, unknown> = {
    model: options.model || "text-embedding-3-small",
    input: text,
  };

  if (options.dimensions) {
    body.dimensions = options.dimensions;
  }

  const apiKey = options.apiKey || (options.provider === "lmstudio" ? "lm-studio" : process.env.OPENAI_API_KEY);
  if (!apiKey) {
    throw new Error(`API Key is required for ${options.provider} provider`);
  }

  const baseUrl = options.baseUrl ||
    (options.provider === "lmstudio" ? "http://localhost:1234/v1" :
     options.provider === "siliconflow" ? "https://api.siliconflow.cn/v1" :
     options.provider === "deepseek" ? "https://api.deepseek.com/v1" :
     "https://api.openai.com/v1");

  const response = await safeRequest({
    url: `${baseUrl}/embeddings`,
    method: "POST",
    contentType: "application/json",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });

  if (response.status >= 400) {
    throw new Error(`Embedding API error: ${response.status} - ${response.text}`);
  }

  const data = response.json as { data: Array<{ embedding: number[] }> };
  return data.data[0].embedding;
}

async function generateOllamaEmbedding(
  text: string,
  options: EmbeddingOptions
): Promise<number[]> {
  const baseUrl = options.baseUrl || "http://localhost:11434";
  const response = await safeRequest({
    url: `${baseUrl}/api/embeddings`,
    method: "POST",
    contentType: "application/json",
    body: JSON.stringify({
      model: options.model || "nomic-embed-text",
      prompt: text,
    }),
  });

  if (response.status >= 400) {
    throw new Error(`Ollama embedding API error: ${response.status} - ${response.text}`);
  }

  const data = response.json as { embedding: number[] };
  return data.embedding;
}
