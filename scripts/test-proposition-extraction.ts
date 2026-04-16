/**
 * Test script for proposition card extraction + full book indexing
 */

import { indexPropositions, buildExtractionPrompt, calculateTargetCards } from "../src/pageindex/proposition-indexer.js";
import * as fs from "fs/promises";
import * as path from "path";

const vaultPath = "/Users/lizhao/workspace/deepreadertest";
const bookId = "1553db0b";
const indexDir = path.join(vaultPath, ".pageindex", bookId);

async function main() {
  // Load tree.json
  const treePath = path.join(indexDir, "tree.json");
  const treeContent = await fs.readFile(treePath, "utf-8");
  const treeData = JSON.parse(treeContent);

  console.log(`Book: ${treeData.title}`);
  console.log(`Chapters: ${Object.keys(treeData.nodeFileMap).length}`);

  // LLM config (siliconflow)
  const llmConfig = {
    model: "Qwen/Qwen3-8B",
    apiKey: "sk-xoulukidezsjyvdhyxcoatdtmsbhgrmsikhxtrlfrzqwoney",
    baseUrl: "https://api.siliconflow.cn/v1",
  };

  // Embedding config
  const embeddingConfig = {
    provider: "openai" as const,
    model: "text-embedding-3-small",
    apiKey: process.env.OPENAI_API_KEY || "",
    baseUrl: "https://api.openai.com/v1",
  };

  console.log("\n--- Indexing propositions for all chapters ---\n");

  // Index propositions
  const result = await indexPropositions({
    bookId,
    vaultPath,
    treeData,
    embedding: embeddingConfig,
    llm: llmConfig,
    onProgress: (p) => {
      console.log(`[${p.percent}%] ${p.message}`);
    },
  });

  console.log(`\n✅ Total cards extracted: ${result.totalCards}`);
  console.log(`Saved to: ${result.indexDir}`);
}

main().catch(console.error);