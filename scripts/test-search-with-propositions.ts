/**
 * Test search with proposition cards
 */

import { searchBookV2 } from "../src/pageindex/book-search-v2.js";
import * as fs from "fs/promises";
import * as path from "path";

const vaultPath = "/Users/lizhao/workspace/DeepReader/test-vault";
const bookId = "1553db0b";
const indexDir = path.join(vaultPath, ".pageindex", bookId);

// First, rename test-propositions.json to propositions.json
async function setup() {
  const testPath = path.join(indexDir, "test-propositions.json");
  const propPath = path.join(indexDir, "propositions.json");
  
  try {
    const content = await fs.readFile(testPath, "utf-8");
    const data = JSON.parse(content);
    
    // Add required fields
    const propositionsData = {
      version: 1,
      bookId,
      totalCards: data.cards.length,
      cards: data.cards,
      generatedAt: new Date().toISOString(),
      model: "Qwen/Qwen3-8B",
    };
    
    await fs.writeFile(propPath, JSON.stringify(propositionsData, null, 2), "utf-8");
    console.log(`✅ Converted to propositions.json (${data.cards.length} cards)`);
  } catch (err) {
    console.log(`⚠️  propositions.json already exists or test file missing`);
  }
}

async function main() {
  await setup();
  
  // Test search
  const query = "批判性思维的核心是什么";
  
  console.log(`\n--- Testing search with query: "${query}" ---\n`);
  
  const results = await searchBookV2({
    filePath: "/Users/lizhao/workspace/DeepReader/test-vault/test.pdf",
    query,
    bookId,
    vaultPath,
    embedding: {
      provider: "openai",
      model: "text-embedding-3-small",
      apiKey: process.env.OPENAI_API_KEY || "",
    },
    topK: 3,
  });
  
  console.log(`Found ${results.length} results:\n`);
  
  for (const r of results) {
    console.log(`【${r.title}】 score=${r.score.toFixed(3)}`);
    console.log(`  BM25=${r.bm25Score.toFixed(3)}, Vector=${r.vectorScore.toFixed(3)}`);
    console.log(`  Blocks: ${r.matchedBlocks.length}`);
    
    for (const block of r.matchedBlocks) {
      console.log(`    - ${block.blockId}: ${block.content.slice(0, 100)}...`);
    }
    console.log("");
  }
}

main().catch(console.error);