/**
 * pageindex-vault: Obsidian Vault Indexing - Main Entry
 * Orchestrates file scanning, indexing, aggregation, and vector storage
 * 
 * Node.js compatible version
 */

import * as path from "path";
import * as fs from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import {
  scanVaultFiles,
  detectChangedFiles,
  groupFilesByDirectory,
} from "./scan";
import { indexFile } from "./index-engine";
import { aggregateDirectories } from "./aggregate";
import { buildSearchIndex } from "./search-index";
import {
  initVectorStore,
  loadVectorStore,
  generateEmbeddings,
  appendVector,
  updateVector,
  compactVectors,
} from "./vectors";
import type {
  ObsidianVaultIndexOptions,
  VaultIndexMeta,
  VaultIndexResult,
  FileMeta,
} from "./types";
import { countTokens } from "../core/utils";

const INDEX_DIR = ".pageindex";

export async function indexObsidianVault(
  options: ObsidianVaultIndexOptions
): Promise<VaultIndexResult> {
  const { vaultPath, incremental = true } = options;
  const indexPath = path.join(vaultPath, INDEX_DIR);

  // 1. Scan files
  console.log("[obsidian-vault] Scanning vault files...");
  const files = await scanVaultFiles(vaultPath, options);
  console.log(`[obsidian-vault] Found ${files.length} files`);

  // 2. Load existing meta for incremental
  let meta: VaultIndexMeta | null = null;
  let changedFiles: typeof files = files;

  if (incremental) {
    meta = await loadMeta(indexPath);
    if (meta) {
      const { changed, unchanged } = detectChangedFiles(files, meta);
      changedFiles = changed;
      console.log(
        `[obsidian-vault] Incremental: ${changed.length} changed, ${unchanged.length} unchanged`
      );
    }
  }

  // 3. Build file index (only changed files)
  const fileIndex: Record<string, FileMeta> = meta?.files
    ? { ...meta.files }
    : {};

  for (const file of changedFiles) {
    console.log(`[obsidian-vault] Indexing: ${file.relativePath}`);
    const result = await indexFile(file, options);
    fileIndex[file.relativePath] = {
      hash: file.hash,
      mtime: file.mtime,
      tokenCount: countTokens(file.content),
      result,
    };
  }

  // 4. Aggregate directories
  console.log("[obsidian-vault] Aggregating directories...");
  const directories = aggregateDirectories(fileIndex);
  const dirList = Object.keys(directories);

  // 5. Build search index
  console.log("[obsidian-vault] Building search index...");
  const searchIndex = buildSearchIndex(fileIndex);

  // 6. Build/update vector index
  if (options.embedding) {
    console.log("[obsidian-vault] Building vector index...");
    await buildOrUpdateVectors(indexPath, fileIndex, changedFiles, options);
  }

  // 7. Build meta
  const newMeta: VaultIndexMeta = {
    version: 1,
    indexedAt: new Date().toISOString(),
    vaultPath,
    files: fileIndex,
    directories,
    searchIndex,
  };

  await saveMeta(indexPath, newMeta);

  return {
    vaultPath,
    totalFiles: files.length,
    changedFiles: changedFiles.length,
    directories: dirList,
    files: fileIndex,
    directoriesIndex: directories,
    searchIndex,
    meta: newMeta,
  };
}

export async function getVaultIndexStatus(
  vaultPath: string
): Promise<{
  exists: boolean;
  lastIndexed: string | null;
  fileCount: number;
  staleFiles: string[];
}> {
  const indexPath = path.join(vaultPath, INDEX_DIR);
  const meta = await loadMeta(indexPath);

  if (!meta) {
    return { exists: false, lastIndexed: null, fileCount: 0, staleFiles: [] };
  }

  const files = await scanVaultFiles(vaultPath, {
    vaultPath,
    excludeDerivedFiles: true,
  });

  const staleFiles = files
    .filter((f) => {
      const existing = meta.files[f.relativePath];
      return !existing || existing.hash !== f.hash || existing.mtime !== f.mtime;
    })
    .map((f) => f.relativePath);

  return {
    exists: true,
    lastIndexed: meta.indexedAt,
    fileCount: Object.keys(meta.files).length,
    staleFiles,
  };
}

// ─── Vector sync ────────────────────────────────────────────────────────────

async function buildOrUpdateVectors(
  indexPath: string,
  fileIndex: Record<string, FileMeta>,
  changedFiles: Array<{ relativePath: string }>,
  options: ObsidianVaultIndexOptions
): Promise<void> {
  await mkdir(indexPath, { recursive: true });

  const vectorStore = await loadVectorStore(indexPath);
  const dimensions = options.embedding?.dimensions || 1536;

  const store = vectorStore || await initVectorStore(indexPath, dimensions);

  const changedPaths = new Set(changedFiles.map((f) => f.relativePath));

  // Collect texts to embed
  const textsToEmbed: Array<{ nodeId: string; text: string; file: string }> = [];

  for (const [filePath, fileMeta] of Object.entries(fileIndex)) {
    if (!changedPaths.has(filePath)) continue;

    for (const node of fileMeta.result.structure) {
      if (!node.nodeId) continue;
      const text = `${node.title}. ${node.summary || ""}`;
      textsToEmbed.push({ nodeId: node.nodeId, text, file: filePath });

      if (node.nodes) {
        collectChildNodes(node.nodes, textsToEmbed, filePath);
      }
    }
  }

  // Generate embeddings
  const vectors = await generateEmbeddings(
    textsToEmbed.map((t) => t.text),
    options.embedding!
  );

  // Update vector store
  for (let i = 0; i < textsToEmbed.length; i++) {
    const { nodeId, file } = textsToEmbed[i];
    const existingSlot = store.meta.slots[nodeId];

    if (existingSlot && !existingSlot.deleted) {
      await updateVector(store, nodeId, vectors[i]);
    } else {
      await appendVector(store, nodeId, vectors[i]);
    }
  }

  // Maybe compact
  if (store.meta.deletedCount / Math.max(store.meta.count, 1) > 0.2) {
    console.log("[obsidian-vault] Compacting vector store...");
    await compactVectors(store);
  }
}

function collectChildNodes(
  nodes: Array<{ title: string; nodeId?: string; summary?: string; nodes?: unknown[] }>,
  textsToEmbed: Array<{ nodeId: string; text: string; file: string }>,
  filePath: string
): void {
  for (const node of nodes) {
    if (!node.nodeId) continue;
    const text = `${node.title}. ${node.summary || ""}`;
    textsToEmbed.push({ nodeId: node.nodeId, text, file: filePath });

    if (node.nodes && node.nodes.length > 0) {
      collectChildNodes(node.nodes as typeof nodes, textsToEmbed, filePath);
    }
  }
}

// ─── Meta persistence ───────────────────────────────────────────────────────

async function loadMeta(indexPath: string): Promise<VaultIndexMeta | null> {
  try {
    const metaPath = path.join(indexPath, "meta.json");
    const content = await fs.readFile(metaPath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Load an existing vault index from disk for searching
 */
export async function loadVaultIndex(vaultPath: string): Promise<VaultIndexResult | null> {
  const indexPath = path.join(vaultPath, INDEX_DIR);
  const meta = await loadMeta(indexPath);
  if (!meta) return null;

  const files = Object.keys(meta.files);
  const directories = Object.keys(meta.directories);

  return {
    vaultPath: meta.vaultPath,
    totalFiles: files.length,
    changedFiles: 0,
    directories,
    files: meta.files,
    directoriesIndex: meta.directories,
    searchIndex: meta.searchIndex,
    meta,
  };
}

async function saveMeta(indexPath: string, meta: VaultIndexMeta): Promise<void> {
  await mkdir(indexPath, { recursive: true });
  await fs.writeFile(path.join(indexPath, "meta.json"), JSON.stringify(meta, null, 2), "utf-8");
}
