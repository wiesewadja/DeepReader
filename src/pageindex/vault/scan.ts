/**
 * pageindex-vault: Obsidian Vault File Scanning
 * Scans vault for markdown files, detects derived files, computes hashes
 * 
 * Node.js compatible version (replaces Bun.Glob and Bun.file)
 */

import * as path from "path";
import * as fs from "fs/promises";
import * as crypto from "crypto";
import type { ObsidianVaultIndexOptions, VaultIndexMeta } from "./types";

export interface ScannedFile {
  relativePath: string;
  absolutePath: string;
  directory: string;
  hash: string;
  mtime: number;
  content: string;
}

/**
 * Simple glob implementation for Node.js
 * Recursively finds files matching a pattern
 */
async function glob(pattern: string, cwd: string): Promise<string[]> {
  const results: string[] = [];
  
  // Simple implementation for **/*.md pattern
  if (pattern === "**/*.md") {
    await walkDir(cwd, cwd, results);
  } else {
    throw new Error(`Glob pattern "${pattern}" not supported. Only "**/*.md" is implemented.`);
  }
  
  return results;
}

async function walkDir(basePath: string, currentPath: string, results: string[]): Promise<void> {
  const entries = await fs.readdir(currentPath, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(currentPath, entry.name);
    
    if (entry.isDirectory()) {
      await walkDir(basePath, fullPath, results);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      const relativePath = path.relative(basePath, fullPath);
      results.push(relativePath);
    }
  }
}

/**
 * Check if a path matches a glob pattern
 */
function matchPattern(filePath: string, pattern: string): boolean {
  // Simple implementation for exclude patterns like **/.obsidian/**
  if (pattern.startsWith("**/") && pattern.endsWith("/**")) {
    const dirName = pattern.slice(3, -3); // Extract directory name
    const parts = filePath.split("/");
    return parts.includes(dirName);
  }
  
  // For patterns like "**/Templates/**"
  if (pattern.startsWith("**/") && pattern.endsWith("/**")) {
    const dirName = pattern.slice(3, -3);
    const parts = filePath.split("/");
    return parts.includes(dirName);
  }
  
  // Default: use regex
  const regexPattern = pattern
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]");
  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(filePath);
}

export async function scanVaultFiles(
  vaultPath: string,
  options: ObsidianVaultIndexOptions
): Promise<ScannedFile[]> {
  const excludePatterns = options.excludePatterns || [
    "**/.obsidian/**",
    "**/.trash/**",
    "**/Templates/**",
  ];

  // Scan all markdown files
  const allFiles = await glob("**/*.md", vaultPath);
  
  // Filter out excluded patterns
  const files = allFiles.filter((f: string) =>
    !excludePatterns.some((pattern: string) => matchPattern(f, pattern))
  );

  let filtered = files;

  if (options.subdirectories && options.subdirectories.length > 0) {
    filtered = files.filter((f: string) =>
      options.subdirectories!.some(
        (dir) =>
          f.startsWith(dir + "/") || f === dir || f.startsWith(normalizeDir(dir))
      )
    );
  }

  // Single-pass: read each file once, check frontmatter and build scanned result
  const scanned: ScannedFile[] = [];

  for (const relativePath of filtered) {
    const absolutePath = path.join(vaultPath, relativePath);
    
    try {
      // Read file content
      const content = await fs.readFile(absolutePath, "utf-8");
      
      if (options.excludeDerivedFiles !== false && isDerivedFile(content)) {
        continue;
      }

      // Get file stats
      const stats = await fs.stat(absolutePath);
      const mtime = stats.mtimeMs;
      const hash = await hashContent(content);
      const directory = resolveDirectory(relativePath, options.subdirectories);

      scanned.push({
        relativePath,
        absolutePath,
        directory,
        hash,
        mtime,
        content,
      });
    } catch (error) {
      // Skip files that can't be read
      console.error(`[scan] Error reading file ${relativePath}:`, error);
    }
  }

  return scanned;
}

function isDerivedFile(content: string): boolean {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return false;
  const frontmatter = fmMatch[1];
  // Only exclude raw derived files (e.g. direct PDF text dumps), not
  // Obsidian notes exported by docToObsidian() which carry `indexed: true`.
  if (/indexed:\s*true/i.test(frontmatter)) return false;
  return /type:\s*(pdf|epub)/i.test(frontmatter);
}

async function hashContent(content: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  hash.update(content);
  return hash.digest("hex").slice(0, 16);
}

function resolveDirectory(
  relativePath: string,
  subdirectories?: string[]
): string {
  if (subdirectories && subdirectories.length > 0) {
    for (const dir of subdirectories) {
      const normalized = normalizeDir(dir);
      if (relativePath.startsWith(normalized + "/") || relativePath.startsWith(normalized)) {
        return normalized;
      }
    }
  }
  const parts = relativePath.split("/");
  return parts.length > 1 ? parts.slice(0, -1).join("/") : "";
}

function normalizeDir(dir: string): string {
  return dir.replace(/\/+$/, "");
}

export function detectChangedFiles(
  files: ScannedFile[],
  meta: VaultIndexMeta | null
): { changed: ScannedFile[]; unchanged: ScannedFile[] } {
  if (!meta) {
    return { changed: files, unchanged: [] };
  }

  const changed: ScannedFile[] = [];
  const unchanged: ScannedFile[] = [];

  for (const file of files) {
    const existing = meta.files[file.relativePath];
    if (!existing || existing.hash !== file.hash || existing.mtime !== file.mtime) {
      changed.push(file);
    } else {
      unchanged.push(file);
    }
  }

  return { changed, unchanged };
}

export function groupFilesByDirectory(
  files: ScannedFile[]
): Map<string, ScannedFile[]> {
  const groups = new Map<string, ScannedFile[]>();

  for (const file of files) {
    if (!groups.has(file.directory)) {
      groups.set(file.directory, []);
    }
    groups.get(file.directory)!.push(file);
  }

  for (const [, dirFiles] of groups) {
    dirFiles.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  }

  return groups;
}