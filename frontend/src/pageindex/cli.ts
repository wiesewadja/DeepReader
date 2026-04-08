#!/usr/bin/env node
/**
 * pageindex CLI
 * Command-line interface for processing PDFs and Markdown documents
 */

import { parseArgs } from "util";
import { PageIndex } from "./pageindex";
import { mdToTree } from "./parsers/markdown";
import { compileVault } from "./vault/compiler";
import { scanDirectories } from "./vault/compiler-scan";
import { planReorg } from "./vault/compiler-reorg";
import { loadCompilerState } from "./vault/compiler-state";
import * as path from "path";
import * as fs from "fs";
import * as fsp from "fs/promises";

interface CliArgs {
  pdf?: string;
  md?: string;
  model: string;
  tocCheckPages: number;
  maxPagesPerNode: number;
  maxTokensPerNode: number;
  addNodeId: boolean;
  addNodeSummary: boolean;
  addDocDescription: boolean;
  addNodeText: boolean;
  thinning: boolean;
  thinningThreshold: number;
  summaryTokenThreshold: number;
  output?: string;
  lmstudio: boolean;
  ollama: boolean;
  baseUrl?: string;
  // OCR options
  ocr: boolean;
  ocrModel: string;
  ocrPromptType: "text" | "formula" | "table";
  imageDpi: number;
  help: boolean;
}

function printHelp(): void {
  console.log(`
bun-pageindex - Vectorless, reasoning-based RAG for document understanding

USAGE:
  bun-pageindex --pdf <path>     Process a PDF file
  bun-pageindex --md <path>      Process a Markdown file

OPTIONS:
  --pdf <path>                 Path to PDF file
  --md <path>                  Path to Markdown file
  --output, -o <path>          Output file path (default: ./results/<name>_structure.json)
  
  MODEL OPTIONS:
  --model <name>               Model to use (default: gpt-4o-2024-11-20)
  --lmstudio                   Use LM Studio (localhost:1234)
  --ollama                     Use Ollama (localhost:11434)
  --base-url <url>             Custom OpenAI-compatible API URL
  
  PDF OPTIONS:
  --toc-check-pages <n>        Pages to check for TOC (default: 20)
  --max-pages-per-node <n>     Max pages per node (default: 10)
  --max-tokens-per-node <n>    Max tokens per node (default: 20000)
  
  OCR OPTIONS (for scanned PDFs):
  --ocr                        Enable OCR mode for scanned PDFs
  --ocr-model <name>           OCR model (default: mlx-community/GLM-OCR-bf16)
  --ocr-prompt-type <type>     OCR prompt: text, formula, table (default: text)
  --image-dpi <n>              Image DPI for OCR (default: 150)
  
  MARKDOWN OPTIONS:
  --thinning                   Apply tree thinning
  --thinning-threshold <n>     Min tokens for thinning (default: 5000)
  --summary-token-threshold <n> Token threshold for summaries (default: 200)
  
  OUTPUT OPTIONS:
  --add-node-id                Add node IDs (default: true)
  --no-node-id                 Don't add node IDs
  --add-node-summary           Add node summaries (default: true)
  --no-node-summary            Don't add node summaries
  --add-doc-description        Add document description
  --add-node-text              Include raw text in output
  
  --help, -h                   Show this help message

EXAMPLES:
  bun-pageindex --pdf document.pdf
  bun-pageindex --md README.md --add-doc-description
  bun-pageindex --pdf paper.pdf --lmstudio --model llama3
  bun-pageindex --pdf report.pdf --base-url http://localhost:8080/v1
  bun-pageindex --pdf scanned.pdf --ocr --lmstudio --model qwen/qwen3-vl-30b
`);
}

function parseCliArgs(): CliArgs {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      pdf: { type: "string" },
      md: { type: "string" },
      model: { type: "string", default: "gpt-4o-2024-11-20" },
      "toc-check-pages": { type: "string", default: "20" },
      "max-pages-per-node": { type: "string", default: "10" },
      "max-tokens-per-node": { type: "string", default: "20000" },
      "add-node-id": { type: "boolean", default: true },
      "no-node-id": { type: "boolean", default: false },
      "add-node-summary": { type: "boolean", default: true },
      "no-node-summary": { type: "boolean", default: false },
      "add-doc-description": { type: "boolean", default: false },
      "add-node-text": { type: "boolean", default: false },
      thinning: { type: "boolean", default: false },
      "thinning-threshold": { type: "string", default: "5000" },
      "summary-token-threshold": { type: "string", default: "200" },
      output: { type: "string", short: "o" },
      lmstudio: { type: "boolean", default: false },
      ollama: { type: "boolean", default: false },
      "base-url": { type: "string" },
      // OCR options
      ocr: { type: "boolean", default: false },
      "ocr-model": { type: "string", default: "mlx-community/GLM-OCR-bf16" },
      "ocr-prompt-type": { type: "string", default: "text" },
      "image-dpi": { type: "string", default: "150" },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
  });

  return {
    pdf: values.pdf,
    md: values.md,
    model: values.model || "gpt-4o-2024-11-20",
    tocCheckPages: parseInt(values["toc-check-pages"] || "20", 10),
    maxPagesPerNode: parseInt(values["max-pages-per-node"] || "10", 10),
    maxTokensPerNode: parseInt(values["max-tokens-per-node"] || "20000", 10),
    addNodeId: values["no-node-id"] ? false : (values["add-node-id"] ?? true),
    addNodeSummary: values["no-node-summary"] ? false : (values["add-node-summary"] ?? true),
    addDocDescription: values["add-doc-description"] ?? false,
    addNodeText: values["add-node-text"] ?? false,
    thinning: values.thinning ?? false,
    thinningThreshold: parseInt(values["thinning-threshold"] || "5000", 10),
    summaryTokenThreshold: parseInt(values["summary-token-threshold"] || "200", 10),
    output: values.output,
    lmstudio: values.lmstudio ?? false,
    ollama: values.ollama ?? false,
    baseUrl: values["base-url"],
    // OCR options
    ocr: values.ocr ?? false,
    ocrModel: values["ocr-model"] || "mlx-community/GLM-OCR-bf16",
    ocrPromptType: (values["ocr-prompt-type"] || "text") as "text" | "formula" | "table",
    imageDpi: parseInt(values["image-dpi"] || "150", 10),
    help: values.help ?? false,
  };
}

async function main(): Promise<void> {
  // 子命令分发
  const rawArgs = process.argv.slice(2);
  if (rawArgs[0] === "compile") {
    await handleCompile(rawArgs.slice(1));
    return;
  } else if (rawArgs[0] === "reorg") {
    await handleReorg(rawArgs.slice(1));
    return;
  } else if (rawArgs[0] === "status") {
    await handleStatus(rawArgs.slice(1));
    return;
  }

  const args = parseCliArgs();

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  // Validate input
  if (!args.pdf && !args.md) {
    console.error("Error: Either --pdf or --md must be specified");
    console.error("Use --help for usage information");
    process.exit(1);
  }

  if (args.pdf && args.md) {
    console.error("Error: Only one of --pdf or --md can be specified");
    process.exit(1);
  }

  // Determine output path
  const inputPath = args.pdf || args.md!;
  const inputName = path.basename(inputPath, path.extname(inputPath));
  const outputDir = "./results";
  const outputPath = args.output || path.join(outputDir, `${inputName}_structure.json`);

  // Create output directory
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  let result;

  if (args.pdf) {
    // Validate PDF
    if (!args.pdf.toLowerCase().endsWith(".pdf")) {
      console.error("Error: PDF file must have .pdf extension");
      process.exit(1);
    }

    if (!fs.existsSync(args.pdf)) {
      console.error(`Error: PDF file not found: ${args.pdf}`);
      process.exit(1);
    }

    console.log(`Processing PDF: ${args.pdf}`);
    if (args.ocr) {
      console.log(`[OCR Mode] Using OCR model: ${args.ocrModel}`);
    }

    // Create PageIndex instance
    const pageIndex = new PageIndex({
      model: args.model,
      tocCheckPageNum: args.tocCheckPages,
      maxPageNumEachNode: args.maxPagesPerNode,
      maxTokenNumEachNode: args.maxTokensPerNode,
      addNodeId: args.addNodeId,
      addNodeSummary: args.addNodeSummary,
      addDocDescription: args.addDocDescription,
      addNodeText: args.addNodeText,
      // OCR options
      extractionMode: args.ocr ? "ocr" : "text",
      ocrModel: args.ocrModel,
      ocrPromptType: args.ocrPromptType,
      imageDpi: args.imageDpi,
    });

    // Configure endpoint
    if (args.lmstudio) {
      pageIndex.useLMStudio();
    } else if (args.ollama) {
      pageIndex.useOllama();
    } else if (args.baseUrl) {
      pageIndex.setBaseUrl(args.baseUrl);
    }

    // Process PDF
    result = await pageIndex.fromPdf(args.pdf);

  } else {
    // Validate Markdown
    const mdPath = args.md!;
    if (!mdPath.toLowerCase().endsWith(".md") && !mdPath.toLowerCase().endsWith(".markdown")) {
      console.error("Error: Markdown file must have .md or .markdown extension");
      process.exit(1);
    }

    if (!fs.existsSync(mdPath)) {
      console.error(`Error: Markdown file not found: ${mdPath}`);
      process.exit(1);
    }

    console.log(`Processing Markdown: ${mdPath}`);

    // Process Markdown
    result = await mdToTree(mdPath, {
      model: args.model,
      addNodeId: args.addNodeId,
      addNodeSummary: args.addNodeSummary,
      addDocDescription: args.addDocDescription,
      addNodeText: args.addNodeText,
      thinning: args.thinning,
      thinningThreshold: args.thinningThreshold,
      summaryTokenThreshold: args.summaryTokenThreshold,
    });
  }

  console.log("Parsing done, saving to file...");

  // Save results
  await fsp.writeFile(outputPath, JSON.stringify(result, null, 2));
  console.log(`Tree structure saved to: ${outputPath}`);
}

// Run
main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});

// ── Compiler Subcommands ──────────────────────────────────────────────────────

function parseModelFromEnv(): { model: string; apiKey?: string; baseUrl?: string } {
  return {
    model: process.env.API_MODEL || process.env.MODEL || "gpt-4o-2024-11-20",
    apiKey: process.env.API_KEY || process.env.OPENAI_API_KEY,
    baseUrl: process.env.API_BASE_URL || process.env.OPENAI_BASE_URL,
  };
}

async function handleCompile(args: string[]): Promise<void> {
  const vaultPath = args[0];
  if (!vaultPath) {
    console.error("Usage: pageindex compile <vault-path> [--dry-run] [--confirm] [--phase 1|2]");
    process.exit(1);
  }
  const dryRun = args.includes("--dry-run");
  const confirm = args.includes("--confirm");
  const phaseIdx = args.indexOf("--phase");
  const phases = phaseIdx >= 0 ? [parseInt(args[phaseIdx + 1]) as 1 | 2] : [1] as (1 | 2)[];
  const { model, apiKey, baseUrl } = parseModelFromEnv();

  // Embedding 配置：从环境变量读取，默认使用 LM Studio 本地嵌入
  const embedProvider = (process.env.EMBEDDING_PROVIDER as "openai" | "ollama" | "lmstudio" | "local") || undefined;
  const embedding = embedProvider ? {
    provider: embedProvider as "openai" | "ollama" | "lmstudio" | "local",
    model: process.env.EMBEDDING_MODEL,
    apiKey: process.env.EMBEDDING_API_KEY,
    baseUrl: process.env.EMBEDDING_BASE_URL,
    dimensions: process.env.EMBEDDING_DIMENSIONS ? parseInt(process.env.EMBEDDING_DIMENSIONS) : undefined,
  } : undefined;

  const result = await compileVault({
    vaultPath,
    model,
    apiKey,
    baseUrl,
    dryRun,
    confirm,
    phases,
    embedding,
  });

  console.log(`\nCompiled: ${result.compiled.length} notes`);
  console.log(`Skipped: ${result.skipped.length}`);
  console.log(`Index files: ${result.indexFiles.join(", ")}`);
  if (result.errors.length > 0) {
    console.error(`Errors: ${result.errors.length}`);
    for (const e of result.errors) {
      console.error(`  ${e.file}: ${e.error}`);
    }
  }
}

async function handleReorg(args: string[]): Promise<void> {
  const vaultPath = args[0];
  if (!vaultPath) {
    console.error("Usage: pageindex reorg <vault-path> [--confirm] [--rollback]");
    process.exit(1);
  }
  const confirm = args.includes("--confirm");
  const rollback = args.includes("--rollback");

  if (rollback) {
    console.log("Rollback not yet implemented");
    process.exit(0);
  }

  const dirs = scanDirectories(vaultPath);
  for (const dir of dirs) {
    if (!dir.needsReorg) continue;
    const plan = planReorg(dir);
    if (!confirm) {
      console.log(`[dry-run] ${dir.relativePath}: ${plan.moves.length} files to move`);
      for (const m of plan.moves.slice(0, 5)) {
        console.log(`  ${m.from} → ${m.to}`);
      }
      if (plan.moves.length > 5) console.log(`  ... and ${plan.moves.length - 5} more`);
    } else {
      console.log(`Reorganizing ${dir.relativePath}...`);
      // TODO: execute plan with mkdirSync + renameSync + link updates
    }
  }
}

async function handleStatus(args: string[]): Promise<void> {
  const vaultPath = args[0] || ".";
  const state = loadCompilerState(path.join(vaultPath, ".pageindex"));
  if (!state) {
    console.log("Vault not yet compiled. Run `pageindex compile <vault-path>` first.");
    process.exit(0);
  }
  console.log(`Phase 1 completed: ${state.phase1CompletedAt || "never"}`);
  console.log(`Phase 2 queue: ${state.phase2.queue.length} pending`);
  console.log(`Phase 2 completed: ${Object.keys(state.phase2.completed).length}`);
  if (state.phase2.inProgress) {
    console.log(`Phase 2 in progress: ${state.phase2.inProgress}`);
  }
}
