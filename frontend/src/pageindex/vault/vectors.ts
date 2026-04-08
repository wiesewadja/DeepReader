/**
 * bun-pageindex: Obsidian Vault Vector Storage
 * Manages vector embeddings using flat binary file (Float32) + slot mapping
 */

import * as path from "path";
import { open } from "node:fs/promises";
import type { EmbeddingOptions, VectorIndexMeta } from "./types";
import { cosineSimilarity } from "../core/utils";

const VECTOR_HEADER = "BPI_VEC";
const VECTOR_VERSION = 1;
const HEADER_SIZE = 24; // 8 + 4 + 4 + 4 + 4

export interface VectorStore {
  vectors: Float32Array;
  meta: VectorIndexMeta;
  vectorPath: string;
  metaPath: string;
}

export async function initVectorStore(
  indexPath: string,
  dimensions: number = 1536
): Promise<VectorStore> {
  const vectorPath = path.join(indexPath, "vectors.f32");
  const metaPath = path.join(indexPath, "vectors.meta.json");

  const meta: VectorIndexMeta = {
    model: "text-embedding-3-small",
    dimensions,
    count: 0,
    deletedCount: 0,
    indexedAt: new Date().toISOString(),
    slots: {},
  };

  // Write header
  const header = buildHeader(dimensions, 0, 0);
  await Bun.write(vectorPath, header);
  await Bun.write(metaPath, JSON.stringify(meta, null, 2));

  return { vectors: new Float32Array(0), meta, vectorPath, metaPath };
}

export async function loadVectorStore(indexPath: string): Promise<VectorStore | null> {
  const vectorPath = path.join(indexPath, "vectors.f32");
  const metaPath = path.join(indexPath, "vectors.meta.json");

  try {
    const metaContent = await Bun.file(metaPath).text();
    const meta = JSON.parse(metaContent) as VectorIndexMeta;

    const buffer = await Bun.file(vectorPath).arrayBuffer();
    // Skip header bytes so vectors are aligned to slot boundaries
    const vectors = new Float32Array(buffer, HEADER_SIZE);

    return { vectors, meta, vectorPath, metaPath };
  } catch {
    return null;
  }
}

export async function generateEmbedding(
  text: string,
  options: EmbeddingOptions
): Promise<number[]> {
  if (options.provider === "openai") {
    return generateOpenAIEmbedding(text, options);
  } else if (options.provider === "ollama") {
    return generateOllamaEmbedding(text, options);
  }
  throw new Error(`Unsupported embedding provider: ${options.provider}`);
}

export async function generateEmbeddings(
  texts: string[],
  options: EmbeddingOptions
): Promise<number[][]> {
  const batchSize = 100;
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);

    if (options.provider === "openai" || options.provider === "lmstudio" || options.provider === "local") {
      const response = await fetch(`${options.baseUrl || "https://api.openai.com/v1"}/embeddings`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${options.apiKey || (options.provider === "lmstudio" ? "lm-studio" : process.env.OPENAI_API_KEY)}`,
        },
        body: JSON.stringify({
          model: options.model || "text-embedding-3-small",
          input: batch,
          dimensions: options.dimensions || 1536,
        }),
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
  const response = await fetch(`${options.baseUrl || "https://api.openai.com/v1"}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${options.apiKey || process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: options.model || "text-embedding-3-small",
      input: text,
      dimensions: options.dimensions || 1536,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI embedding API error: ${response.status} ${response.statusText}`);
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

export async function appendVector(
  store: VectorStore,
  nodeId: string,
  vector: number[]
): Promise<number> {
  const slotIndex = store.meta.count;
  const vectorData = new Float32Array(vector);

  // Append to file
  const file = await open(store.vectorPath, "a");
  await file.write(Buffer.from(vectorData.buffer));
  await file.close();

  store.meta.slots[nodeId] = { slotIndex, deleted: false };
  store.meta.count++;

  await Bun.write(store.metaPath, JSON.stringify(store.meta, null, 2));

  return slotIndex;
}

export async function updateVector(
  store: VectorStore,
  nodeId: string,
  vector: number[]
): Promise<void> {
  const slot = store.meta.slots[nodeId];
  if (!slot) {
    throw new Error(`Node ${nodeId} not found in vector store`);
  }

  const vectorData = new Float32Array(vector);
  const offset = HEADER_SIZE + slot.slotIndex * store.meta.dimensions * 4;

  const file = await open(store.vectorPath, "r+");
  await file.write(Buffer.from(vectorData.buffer), 0, vectorData.buffer.byteLength, offset);
  await file.close();
}

export async function markVectorDeleted(
  store: VectorStore,
  nodeId: string
): Promise<void> {
  const slot = store.meta.slots[nodeId];
  if (!slot || slot.deleted) return;

  slot.deleted = true;
  store.meta.deletedCount++;

  await Bun.write(store.metaPath, JSON.stringify(store.meta, null, 2));
}

export async function getNodeVector(
  store: VectorStore,
  nodeId: string
): Promise<Float32Array | null> {
  const slot = store.meta.slots[nodeId];
  if (!slot || slot.deleted) return null;

  const offset = HEADER_SIZE + slot.slotIndex * store.meta.dimensions * 4;
  const file = Bun.file(store.vectorPath);
  const buffer = await file.slice(offset, offset + store.meta.dimensions * 4).arrayBuffer();

  return new Float32Array(buffer);
}

export async function loadAllVectors(store: VectorStore): Promise<Float32Array> {
  const file = Bun.file(store.vectorPath);
  const buffer = await file.arrayBuffer();
  return new Float32Array(buffer);
}

export async function compactVectors(store: VectorStore): Promise<void> {
  const liveSlots: Array<{ nodeId: string; slotIndex: number; vector: Float32Array }> = [];

  for (const [nodeId, slot] of Object.entries(store.meta.slots)) {
    if (!slot.deleted) {
      const offset = HEADER_SIZE + slot.slotIndex * store.meta.dimensions * 4;
      const file = Bun.file(store.vectorPath);
      const buffer = await file.slice(offset, offset + store.meta.dimensions * 4).arrayBuffer();
      liveSlots.push({
        nodeId,
        slotIndex: slot.slotIndex,
        vector: new Float32Array(buffer),
      });
    }
  }

  // Rewrite file
  const header = buildHeader(store.meta.dimensions, liveSlots.length, 0);
  const file = await open(store.vectorPath, "w");
  await file.write(Buffer.from(header));

  for (let i = 0; i < liveSlots.length; i++) {
    await file.write(Buffer.from(liveSlots[i].vector.buffer));
    store.meta.slots[liveSlots[i].nodeId].slotIndex = i;
  }

  await file.close();

  // Remove deleted slots from meta
  for (const [nodeId, slot] of Object.entries(store.meta.slots)) {
    if (slot.deleted) {
      delete store.meta.slots[nodeId];
    }
  }

  store.meta.count = liveSlots.length;
  store.meta.deletedCount = 0;
  await Bun.write(store.metaPath, JSON.stringify(store.meta, null, 2));
}

function buildHeader(
  dimensions: number,
  count: number,
  deletedCount: number
): ArrayBuffer {
  const buffer = new ArrayBuffer(HEADER_SIZE);
  const view = new DataView(buffer);

  // Magic: "BPI_VEC"
  const encoder = new TextEncoder();
  const magicBytes = encoder.encode(VECTOR_HEADER);
  new Uint8Array(buffer, 0, 8).set(magicBytes);

  view.setUint32(8, VECTOR_VERSION, true);
  view.setUint32(12, dimensions, true);
  view.setUint32(16, count, true);
  view.setUint32(20, deletedCount, true);

  return buffer;
}

export async function cosineSearch(
  queryVector: number[],
  store: VectorStore,
  topK: number
): Promise<Array<{ nodeId: string; score: number }>> {
  const query = new Float32Array(queryVector);
  const scores: Array<{ nodeId: string; score: number }> = [];

  for (const [nodeId, slot] of Object.entries(store.meta.slots)) {
    if (slot.deleted) continue;

    // vectors already starts after HEADER_SIZE (see loadVectorStore)
    const offset = slot.slotIndex * store.meta.dimensions * 4;
    const vector = store.vectors.subarray(
      offset / 4,
      offset / 4 + store.meta.dimensions
    );
    const score = cosineSimilarity(query, vector);

    scores.push({ nodeId, score });
  }

  return scores.sort((a, b) => b.score - a.score).slice(0, topK);
}
