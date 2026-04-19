import { readFileSync, existsSync } from "node:fs";
import { join } from "path";
import { generateEmbedding, cosineSearchJsonl } from "./vectors";
import type { EmbeddingOptions } from "./types";
import type { SearchResultV2 } from "./compiler-types";

/** 关键词快速匹配 L0 */
export function keywordMatchL0(query: string, l0Content: string): string[] {
  const targets: string[] = [];
  const lines = l0Content.split("\n");

  for (const line of lines) {
    if (line.includes("[[") && line.includes("]]")) {
      if (line.toLowerCase().includes(query.toLowerCase())) {
        const match = line.match(/\[\[([^\]]+)\]\]/);
        if (match) targets.push(match[1]);
      }
    }
  }

  return targets;
}

/** 从 L0 提取所有 L1 候选 */
export function extractL1Candidates(l0Content: string): string[] {
  const candidates: string[] = [];
  const regex = /\[\[([^\]]+)\]\]/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(l0Content)) !== null) {
    const target = match[1];
    if (target.startsWith("概念/")) continue;
    candidates.push(target);
  }

  return candidates;
}

/** 读取 L1 索引文件内容 */
function readL1Content(vaultPath: string, l1Target: string): string | null {
  const filePath = join(vaultPath, l1Target + ".md");
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, "utf-8");
}

/** 从笔记文件路径读取标题和摘要 */
function readNoteMeta(vaultPath: string, notePath: string): { title: string; summary: string } | null {
  const fullNotePath = join(vaultPath, notePath.endsWith(".md") ? notePath : notePath + ".md");
  if (!existsSync(fullNotePath)) return null;

  const content = readFileSync(fullNotePath, "utf-8");
  const title = content.match(/^#\s+(.+)/m)?.[1] || notePath;
  return { title, summary: content.slice(0, 200) };
}

/** 搜索 V2 主入口 — 混合搜索（关键词 + 向量语义） */
export async function searchV2(
  query: string,
  vaultPath: string,
  options?: {
    model?: string;
    apiKey?: string;
    baseUrl?: string;
    topK?: number;
    /** 向量化嵌入配置，启用后支持语义搜索 */
    embedding?: EmbeddingOptions;
  }
): Promise<SearchResultV2[]> {
  const topK = options?.topK || 5;
  const indexPath = join(vaultPath, ".pageindex");
  const resultMap = new Map<string, SearchResultV2>();

  // Step 1: 关键词匹配 L0
  const l0Path = join(vaultPath, "_总目录.md");
  if (existsSync(l0Path)) {
    const l0Content = readFileSync(l0Path, "utf-8");
    const keywordTargets = keywordMatchL0(query, l0Content);

    // 关键词匹配的 L1 目标
    let targets = keywordTargets;
    if (targets.length === 0) {
      targets = extractL1Candidates(l0Content).slice(0, 3);
    }

    for (const target of targets.slice(0, 3)) {
      const l1Content = readL1Content(vaultPath, target);
      if (!l1Content) continue;

      const linkRegex = /\[\[([^\]#|]+)(?:[#|][^\]]*)?\]\]/g;
      let match: RegExpExecArray | null;
      while ((match = linkRegex.exec(l1Content)) !== null) {
        const notePath = match[1];
        const meta = readNoteMeta(vaultPath, notePath);
        if (meta && !resultMap.has(notePath)) {
          resultMap.set(notePath, {
            file: notePath,
            title: meta.title,
            summary: meta.summary,
            score: 0.5, // 关键词基础分
          });
        }
        if (resultMap.size >= topK * 2) break;
      }
      if (resultMap.size >= topK * 2) break;
    }
  }

  // Step 2: 向量语义搜索
  if (options?.embedding) {
    try {
      const jsonlPath = join(indexPath, "vectors.jsonl");
      if (existsSync(jsonlPath)) {
        const queryVector = await generateEmbedding(query, options.embedding);
        const vectorResults = await cosineSearchJsonl(jsonlPath, queryVector, topK);

        for (const vr of vectorResults) {
          const meta = readNoteMeta(vaultPath, vr.nodeId);
          if (!meta) continue;

          const existing = resultMap.get(vr.nodeId);
          if (existing) {
            // 混合评分：关键词分 + 向量分
            existing.score = Math.min(0.5 + vr.score * 0.5, 1.0);
          } else {
            resultMap.set(vr.nodeId, {
              file: vr.nodeId,
              title: meta.title,
              summary: meta.summary,
              score: vr.score,
            });
          }
        }
      }
    } catch {
      // 向量搜索失败，降级为纯关键词结果
    }
  }

  // 排序并返回 topK
  return Array.from(resultMap.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
