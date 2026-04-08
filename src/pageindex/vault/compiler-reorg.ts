import { readdirSync, readFileSync } from "node:fs";
import { join } from "path";
import type { DirectoryScan, ReorgPlan } from "./compiler-types";

/** 日期文件名中提取 YYYY-MM */
function extractYearMonth(fileName: string): { year: string; month: string } | null {
  const match = fileName.match(/^(\d{4})[-_]?(\d{2})/);
  if (!match) return null;
  return { year: match[1], month: match[2] };
}

/** 生成分组键 */
function groupKey(fileName: string, type: DirectoryScan["type"]): string {
  if (type === "timeline") {
    const ym = extractYearMonth(fileName);
    if (ym) return join(ym.year, ym.month);
  }
  return "";
}

/** 规划目录重组 */
export function planReorg(scan: DirectoryScan): ReorgPlan {
  const plan: ReorgPlan = {
    directory: scan.path,
    moves: [],
    linkUpdates: [],
    newDirs: [],
  };

  if (!scan.needsReorg) return plan;

  const files = readdirSync(scan.path, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".md") && e.name !== "_目录.md");

  const groups = new Map<string, string[]>();
  for (const file of files) {
    const key = groupKey(file.name, scan.type);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(file.name);
  }

  const createdDirs = new Set<string>();
  for (const [key, filenames] of groups) {
    const targetDir = join(scan.path, key);
    if (!createdDirs.has(targetDir)) {
      createdDirs.add(targetDir);
      plan.newDirs.push(targetDir);
    }

    for (const filename of filenames) {
      const oldPath = join(scan.path, filename);
      const newPath = join(targetDir, filename);
      plan.moves.push({ from: oldPath, to: newPath });

      const baseName = filename.replace(/\.md$/, "");
      const oldRel = join(scan.relativePath, baseName);
      const newRel = join(scan.relativePath, key, baseName);
      plan.linkUpdates.push({
        file: "",
        oldLink: oldRel,
        newLink: newRel,
      });
    }
  }

  return plan;
}

/** 构建链接反向索引：链接目标 → 引用该目标的文件列表（递归扫描） */
export function buildLinkReverseIndex(dirPath: string): Map<string, string[]> {
  const index = new Map<string, string[]>();
  const linkRegex = /\[\[([^\]#|]+)(?:[#|][^\]]*)?\]\]/g;

  function scanDir(currentDir: string): void {
    const entries = readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory()) {
        // 跳过隐藏目录和系统目录
        if (!entry.name.startsWith(".") && entry.name !== ".pageindex") {
          scanDir(fullPath);
        }
      } else if (entry.isFile() && entry.name.endsWith(".md")) {
        const content = readFileSync(fullPath, "utf-8");
        let match: RegExpExecArray | null;
        while ((match = linkRegex.exec(content)) !== null) {
          const target = match[1].trim();
          if (!index.has(target)) index.set(target, []);
          index.get(target)!.push(fullPath);
        }
      }
    }
  }

  scanDir(dirPath);
  return index;
}

/** 更新文件内容中的链接路径 */
export function updateLinksAfterMove(
  content: string,
  oldPath: string,
  newPath: string
): string {
  // 匹配 [[oldPath]]、[[oldPath#heading]]、[[oldPath|display]]
  const escapedOld = oldPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`\\[\\[${escapedOld}([#|\\]])`, "g");
  return content.replace(regex, `[[${newPath}$1`);
}
