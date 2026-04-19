/**
 * pageindex-vault: Vector Storage (JSONL format)
 * Manages vector embeddings using JSONL files + global catalog
 *
 * Node.js compatible version
 */

import * as path from "path";
import * as fs from "node:fs/promises";
import type {
  EmbeddingOptions,
  VectorRecord,
  CatalogMeta,
  CatalogBookEntry,
} from "./types";
import { cosineSimilarity } from "../core/utils";

// ─── JSONL Vector Storage ─────────────────────────────────────

/**
 * Write vector records to a JSONL file (replaces entire file)
 */
export async function writeVectorJsonl(
  filePath: string,
  records: VectorRecord[]
): Promise<void> {
  const lines = records.map((r) => JSON.stringify(r));
  await fs.writeFile(filePath, lines.join("\n") + "\n", "utf-8");
}

/**
 * Read all vector records from a JSONL file
 */
export async function readVectorJsonl(
  filePath: string
): Promise<VectorRecord[]> {
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return content
      .trim()
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as VectorRecord);
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
  topK: number
): Promise<Array<{ nodeId: string; title: string; score: number }>> {
  const records = await readVectorJsonl(filePath);
  const query = new Float32Array(queryVector);
  const scores: Array<{ nodeId: string; title: string; score: number }> = [];

  for (const record of records) {
    const vector = new Float32Array(record.vector);
    const score = cosineSimilarity(query, vector);
    scores.push({ nodeId: record.nodeId, title: record.title, score });
  }

  return scores.sort((a, b) => b.score - a.score).slice(0, topK);
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
  await fs.writeFile(catalogPath, JSON.stringify(catalog, null, 2), "utf-8");
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
  await fs.writeFile(catalogPath, JSON.stringify(catalog, null, 2), "utf-8");
}

// ─── Embedding Generation ─────────────────────────────────────

export async function generateEmbedding(
  text: string,
  options: EmbeddingOptions
): Promise<number[]> {
  if (options.provider === "local") {
    throw new Error("Local provider does not support embedding generation. Use BM25-only search instead.");
  }
  if (options.provider === "openai") {
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
  options: EmbeddingOptions
): Promise<number[][]> {
  if (options.provider === "local") {
    throw new Error("Local provider does not support embedding generation. Use BM25-only search instead.");
  }

  const batchSize = 100;
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);

    if (options.provider === "openai" || options.provider === "lmstudio") {
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

      const response = await fetch(`${options.baseUrl || (options.provider === "lmstudio" ? "http://localhost:1234/v1" : "https://api.openai.com/v1")}/embeddings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Embedding API error: ${response.status} ${response.statusText} - ${errorText}`);
      }

      const data = await response.json() as { data: Array<{ embedding: number[] }> };
      if (data.data.length !== batch.length) {
        throw new Error(`Embedding API returned ${data.data.length} results for ${batch.length} inputs`);
      }
      results.push(...data.data.map((item) => item.embedding));
    } else if (options.provider === "ollama") {
      for (const text of batch) {
        const embedding = await generateOllamaEmbedding(text, options);
        results.push(embedding);
      }
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

  const baseUrl = options.baseUrl || (options.provider === "lmstudio" ? "http://localhost:1234/v1" : "https://api.openai.com/v1");

  const response = await fetch(`${baseUrl}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Embedding API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as { data: Array<{ embedding: number[] }> };
  return data.data[0].embedding;
}

async function generateOllamaEmbedding(
  text: string,
  options: EmbeddingOptions
): Promise<number[]> {
  const baseUrl = options.baseUrl || "http://localhost:11434";
  const response = await fetch(`${baseUrl}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: options.model || "nomic-embed-text",
      prompt: text,
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama embedding API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as { embedding: number[] };
  return data.embedding;
}
