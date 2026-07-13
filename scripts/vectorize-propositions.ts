/**
 * Vectorize existing proposition cards
 */

import { generateEmbeddings } from "../src/pageindex/vault/vectors.js";
import * as fs from "fs/promises";
import { open } from "node:fs/promises";
import * as path from "path";
import type { PropositionCard } from "../src/pageindex/book-types.js";

const vaultPath = "/Users/lizhao/workspace/DeepReader/test-vault";
const bookId = "1553db0b";
const indexDir = path.join(vaultPath, ".pageindex", bookId);

const HEADER_SIZE = 24;

async function main() {
  // Load propositions
  const propPath = path.join(indexDir, "propositions.json");
  const content = await fs.readFile(propPath, "utf-8");
  const data = JSON.parse(content) as { cards: PropositionCard[] };
  
  console.log(`Loaded ${data.cards.length} cards`);
  
  // Embedding config
  const embedding = {
    provider: "openai" as const,
    model: "text-embedding-3-small",
    apiKey: process.env.OPENAI_API_KEY || "",
    baseUrl: "https://api.openai.com/v1",
  };
  
  // Vector content: answer + context + tags
  const texts = data.cards.map(c => `${c.answer}\n${c.context}\n${c.tags.join(" ")}`);
  
  console.log("Generating embeddings...");
  
  const vectors = await generateEmbeddings(texts, embedding);
  const dimensions = vectors[0].length;
  
  console.log(`Generated ${vectors.length} vectors (dim=${dimensions})`);
  
  // Build meta
  const meta = {
    model: embedding.model,
    dimensions,
    count: data.cards.length,
    deletedCount: 0,
    indexedAt: new Date().toISOString(),
    slots: {} as Record<string, { slotIndex: number; deleted: boolean }>,
  };
  
  for (let i = 0; i < data.cards.length; i++) {
    meta.slots[data.cards[i].id] = { slotIndex: i, deleted: false };
  }
  
  // Write vectors
  const vectorPath = path.join(indexDir, "prop_vectors.f32");
  const metaPath = path.join(indexDir, "prop_vectors.meta.json");
  
  const header = buildHeader(dimensions, data.cards.length);
  const vectorData = new Float32Array(data.cards.length * dimensions);
  
  for (let i = 0; i < vectors.length; i++) {
    vectorData.set(vectors[i], i * dimensions);
  }
  
  const fileHandle = await open(vectorPath, "w");
  await fileHandle.write(Buffer.from(header));
  await fileHandle.write(Buffer.from(vectorData.buffer));
  await fileHandle.close();
  
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), "utf-8");
  
  console.log(`✅ Saved to ${vectorPath}`);
  console.log(`✅ Saved to ${metaPath}`);
}

function buildHeader(dimensions: number, count: number): ArrayBuffer {
  const buffer = new ArrayBuffer(HEADER_SIZE);
  const view = new DataView(buffer);
  
  const encoder = new TextEncoder();
  const magicBytes = encoder.encode("BPI_VEC");
  new Uint8Array(buffer, 0, 8).set(magicBytes);
  
  view.setUint32(8, 1, true);
  view.setUint32(12, dimensions, true);
  view.setUint32(16, count, true);
  view.setUint32(20, 0, true);
  
  return buffer;
}

main().catch(console.error);