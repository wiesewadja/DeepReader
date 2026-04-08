/**
 * bun-pageindex: Obsidian Vault File Scanning
 * Scans vault for markdown files, detects derived files, computes hashes
 */

import * as path from "path";
import type { ObsidianVaultIndexOptions, VaultIndexMeta } from "./types";

export interface ScannedFile {
  relativePath: string;
  absolutePath: string;
  directory: string;
  hash: string;
  mtime: number;
  content: string;
}

export async function scanVaultFiles(
  vaultPath: string,
  options: ObsidianVaultIndexOptions
): Promise<ScannedFile[]> {
  const excludePatterns = options.excludePatterns || [
    "**/.obsidian/**",
    "**/.trash/**",
    "**/.pageindex/**",
    "**/Templates/**",
  ];

  const glob = new Bun.Glob("**/*.md");
  const allFiles = [...await Array.fromAsync(glob.scan({ cwd: vaultPath }))];
  const excludeGlobs = excludePatterns.map((p: string) => new Bun.Glob(p));
  const files = allFiles.filter((f: string) =>
    !excludeGlobs.some((g: Bun.Glob) => g.match(f))
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
    const file = Bun.file(absolutePath);
    const content = await file.text();

    if (options.excludeDerivedFiles !== false && isDerivedFile(content)) {
      continue;
    }

    const mtime = await file.lastModified;
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
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
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
