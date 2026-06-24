import { existsSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, renameSync } from "fs";
import { join } from "path";
import { log as piLog } from "../core/logger";
import { getPageindexRoot } from '../paths.js';
import { planMerge, insertWikiLinks, detectRemovedLinks } from "./compiler-enhance";
import { generateL0, generateMOC, generateDirectoryIndex, groupExtractionsByTopic } from "./compiler-index";
import { extractConcepts, mergeTags } from "./compiler-llm";
import { planReorg, buildLinkReverseIndex, updateLinksAfterMove } from "./compiler-reorg";
import { scanDirectories } from "./compiler-scan";
import { loadCompilerState, saveCompilerState, loadLinkSnapshots, saveLinkSnapshots } from "./compiler-state";
import type { CompileOptions, CompileResult, ConceptExtraction, NoteMetadata } from "./compiler-types";
import type { EmbeddingOptions } from "./types";
import { generateEmbeddings, readVectorJsonl, writeVectorJsonl } from "./vectors";

const BATCH_SIZE = 5;

export async function compileVault(options: CompileOptions): Promise<CompileResult> {
  const { vaultPath, dryRun = false, confirm = false } = options;
  const indexPath = getPageindexRoot(vaultPath);

  // 首次编译强制 dry-run
  const isFirstRun = !existsSync(join(indexPath, "compiler-state.json"));
  const shouldWrite = isFirstRun ? (confirm && !dryRun) : (!dryRun || confirm);

  const result: CompileResult = {
    totalNotes: 0,
    compiled: [],
    skipped: [],
    errors: [],
    indexFiles: [],
  };

  // Step 1: Scan
  piLog("[compiler] Scanning directories...");
  const dirs = scanDirectories(vaultPath);

  // Step 2: Directory reorg (plan only in dry-run)
  for (const dir of dirs) {
    if (dir.needsReorg && dir.type === "timeline") {
      const plan = planReorg(dir);
      if (shouldWrite && plan.moves.length > 0) {
        piLog(`[compiler] Reorganizing ${dir.relativePath}: ${plan.moves.length} files`);
        // 执行重组
        for (const newDir of plan.newDirs) {
          mkdirSync(newDir, { recursive: true });
        }
        // 构建反向索引用于链接更新
        const reverseIndex = buildLinkReverseIndex(vaultPath);
        for (const move of plan.moves) {
          renameSync(move.from, move.to);
        }
        // 更新引用了被移动文件的链接
        for (const update of plan.linkUpdates) {
          const refFiles = reverseIndex.get(update.oldLink) || [];
          for (const refFile of refFiles) {
            if (!existsSync(refFile)) continue;
            const content = readFileSync(refFile, "utf-8");
            const updated = updateLinksAfterMove(content, update.oldLink, update.newLink);
            writeFileSync(refFile, updated);
          }
        }
      } else {
        piLog(`[compiler] [dry-run] Would reorganize ${dir.relativePath}: ${plan.moves.length} files`);
      }
    }
  }

  // Step 3: Structure parsing — collect note summaries
  piLog("[compiler] Parsing note structures...");
  const noteSummaries: Array<{ file: string; summary: string }> = [];

  for (const dir of dirs) {
    for (const f of dir.files) {
      const filePath = join(dir.path, f.fileName);
      if (!existsSync(filePath)) continue;
      const content = readFileSync(filePath, "utf-8");
      // 提取标题（第一个 # 开头的行）+ 首段（前 200 字符）
      const titleMatch = content.match(/^#\s+(.+)/m);
      const title = titleMatch ? titleMatch[1] : f.fileName.replace(/\.md$/, "");
      // 跳过 frontmatter
      const fmMatch = content.match(/^---\n[\s\S]*?\n---\n/);
      const bodyStart = fmMatch ? fmMatch[0].length : 0;
      const firstPara = content.slice(bodyStart, bodyStart + 200).replace(/^#+\s/gm, "").trim();
      noteSummaries.push({ file: join(dir.relativePath, f.fileName), summary: `# ${title}\n${firstPara}` });
    }
  }

  // Step 4: Concept extraction (LLM)
  piLog("[compiler] Extracting concepts via LLM...");
  const existingState = loadCompilerState(indexPath);
  const isFirstConceptExtraction = !existingState?.phase1CompletedAt;
  const allExtractions: ConceptExtraction[] = [];

  for (let i = 0; i < noteSummaries.length; i += BATCH_SIZE) {
    const batch = noteSummaries.slice(i, i + BATCH_SIZE);
    try {
      const extractions = await extractConcepts(batch, [], [], {
        model: options.model,
        apiKey: options.apiKey,
        baseUrl: options.baseUrl,
      });
      allExtractions.push(...extractions);
    } catch (err) {
      result.errors.push({ file: `batch-${i}`, error: String(err) });
    }
  }

  // Cold start: second round with merged tags
  if (isFirstConceptExtraction && allExtractions.length > 0) {
    const allTags = allExtractions.flatMap((e) => e.tags);
    const mergedTags = mergeTags([...new Set(allTags)]);
    const allTopics = [...new Set(allExtractions.map((e) => e.topic.replace("新建:", "")))];
    // 第二轮：用合并后的标签作为约束重新提取
    for (let i = 0; i < noteSummaries.length; i += BATCH_SIZE) {
      const batch = noteSummaries.slice(i, i + BATCH_SIZE);
      try {
        const refined = await extractConcepts(batch, allTopics, mergedTags, {
          model: options.model, apiKey: options.apiKey, baseUrl: options.baseUrl,
        });
        // 用第二轮结果覆盖第一轮
        for (const r of refined) {
          const idx = allExtractions.findIndex((e) => e.file === r.file);
          if (idx >= 0) allExtractions[idx] = r;
        }
      } catch (err) {
        result.errors.push({ file: `refine-batch-${i}`, error: String(err) });
      }
    }
  }

  // Step 5: Generate index files
  piLog("[compiler] Generating index files...");
  const bookDirs = dirs.filter((d) => d.type === "book").map((d) => d.relativePath);
  const l0Content = generateL0(allExtractions, bookDirs);

  if (shouldWrite) {
    if (!existsSync(indexPath)) mkdirSync(indexPath, { recursive: true });
    writeFileSync(join(vaultPath, "_总目录.md"), l0Content);
    result.indexFiles.push("_总目录.md");

    // Generate MOC files
    const topicGroups = groupExtractionsByTopic(allExtractions);
    for (const [topic, extractions] of topicGroups) {
      const concepts = extractions.flatMap((e) => e.tags);
      const notes = extractions.map((e) => ({
        file: e.file,
        tags: e.tags,
        description: e.tags.join("、"),
      }));
      const mocContent = generateMOC(topic, [...new Set(concepts)], notes);
      writeFileSync(join(vaultPath, `${topic}.md`), mocContent);
      result.indexFiles.push(`${topic}.md`);
    }

    // Generate _目录.md for book dirs
    for (const dir of dirs.filter((d) => d.type === "book")) {
      const files = dir.files.map((f) => ({
        name: f.fileName,
        title: f.fileName.replace(/\.md$/, ""),
        description: "",
      }));
      const indexContent = generateDirectoryIndex(dir.relativePath, files);
      writeFileSync(join(dir.path, "_目录.md"), indexContent);
      result.indexFiles.push(`${dir.relativePath}/_目录.md`);
    }
  } else {
    piLog("[compiler] [dry-run] Would generate:");
    piLog(l0Content.split("\n").map((l) => `  ${l}`).join("\n"));
  }

  // Step 6: In-place enhancement
  piLog("[compiler] Enhancing notes...");
  if (shouldWrite) {
    const snapshots = loadLinkSnapshots(indexPath);
    let backupCounter = 0;
    for (const extraction of allExtractions) {
      const filePath = join(vaultPath, extraction.file);
      if (!existsSync(filePath)) continue;

      const content = readFileSync(filePath, "utf-8");
      const fileKey = extraction.file; // 相对于 vault 的路径作为 key
      const removedLinks = detectRemovedLinks(fileKey, content, snapshots);

      const metadata: NoteMetadata = {
        tags: extraction.tags,
        topic: extraction.topic,
        wikiLinks: extraction.wikiLinks,
        relatedConcepts: extraction.relatedConcepts.filter((c) => !c.isNewConcept).map((c) => c.concept),
      };

      const mergePlan = planMerge(content, metadata, removedLinks);
      let enhanced = content;

      // 1. 更新 frontmatter
      enhanced = applyFrontmatter(enhanced, mergePlan.frontmatter);

      // 2. 插入 wiki 链接
      enhanced = insertWikiLinks(enhanced, extraction.wikiLinks.filter(
        (wl) => !mergePlan.linksToSkip.includes(wl.target)
      ));

      // 3. 备份原文件
      const backupDir = join(indexPath, "backup");
      if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true });
      copyFileSync(filePath, join(backupDir, `${String(backupCounter++).padStart(4, "0")}-${extraction.file.replace(/\//g, "_")}`));

      // 4. 写入增强后的文件
      writeFileSync(filePath, enhanced);
      result.compiled.push(extraction.file);

      // 5. 更新链接快照
      const newLinks = extraction.wikiLinks.map((wl) => wl.target);
      snapshots[fileKey] = newLinks;
    }
    saveLinkSnapshots(indexPath, snapshots);
  }

  // Step 7: 向量化嵌入
  if (options.embedding) {
    piLog("[compiler] Generating vector embeddings...");
    const embedOpts: EmbeddingOptions = {
      provider: options.embedding.provider,
      model: options.embedding.model,
      apiKey: options.embedding.apiKey || options.apiKey,
      baseUrl: options.embedding.baseUrl || options.baseUrl,
      dimensions: options.embedding.dimensions,
    };

    if (shouldWrite) {
      if (!existsSync(indexPath)) mkdirSync(indexPath, { recursive: true });

      // Load existing vectors
      const jsonlPath = join(indexPath, "vectors.jsonl");
      const existing = await readVectorJsonl(jsonlPath);
      const existingMap = new Map(existing.map((r) => [r.nodeId, r]));

      // 批量生成嵌入
      const texts = noteSummaries.map((n) => n.summary);
      const batchSize = 50;
      let embedded = 0;

      for (let i = 0; i < texts.length; i += batchSize) {
        const batch = texts.slice(i, i + batchSize);
        const batchFiles = noteSummaries.slice(i, i + batchSize).map((n) => n.file);

        try {
          const vectors = await generateEmbeddings(batch, embedOpts);
          for (let j = 0; j < vectors.length; j++) {
            existingMap.set(batchFiles[j], {
              chunkId: batchFiles[j],
              nodeId: batchFiles[j],
              blockIds: [],
              type: "summary",
              level: "L1",
              vector: vectors[j],
            });
          }
          embedded += vectors.length;
          piLog(`[compiler] Embedded ${embedded}/${texts.length} notes`);
        } catch (err) {
          result.errors.push({ file: `embed-batch-${i}`, error: String(err) });
        }
      }

      // Write merged vectors back
      await writeVectorJsonl(jsonlPath, Array.from(existingMap.values()));

      piLog(`[compiler] Vector embeddings complete: ${embedded} notes`);
    } else {
      piLog(`[compiler] [dry-run] Would embed ${noteSummaries.length} notes with ${embedOpts.model || "default"} model`);
    }
  }

  // Save state
  if (shouldWrite) {
    saveCompilerState(indexPath, {
      phase1CompletedAt: new Date().toISOString(),
      phase2: { queue: [], completed: {}, inProgress: null },
    });
  }

  result.totalNotes = noteSummaries.length;
  return result;
}

/** 应用 frontmatter 变更到内容 */
function applyFrontmatter(
  content: string,
  changes: { add: Record<string, unknown>; overwrite: Record<string, unknown> }
): string {
  const fm = content.match(/^---\n([\s\S]*?)\n---/);

  if (!fm) {
    // 没有 frontmatter，创建新的
    const addTags = (changes.add as Record<string, string[]>).tags || [];
    const newFm: Record<string, unknown> = { ...changes.add, ...changes.overwrite };
    if (addTags.length > 0) newFm.tags = addTags;
    const fmStr = Object.entries(newFm)
      .filter(([_, v]) => {
        if (Array.isArray(v)) return v.length > 0;
        return v !== undefined;
      })
      .map(([k, v]) => {
        if (Array.isArray(v)) return `${k}: [${v.join(", ")}]`;
        return `${k}: ${v}`;
      })
      .join("\n");
    return `---\n${fmStr}\n---\n\n${content}`;
  }

  // 已有 frontmatter，合并
  const yaml = fm[1];
  const existingLines = yaml.split("\n");
  const existingKeys = new Set(existingLines.map((l) => l.match(/^(\w+):/)?.[1]).filter(Boolean));

  // 添加新字段
  const addTags = (changes.add as Record<string, string[]>).tags || [];
  const linesToAdd: string[] = [];

  if (addTags.length > 0) {
    if (existingKeys.has("tags")) {
      // 合并到已有 tags
      const tagLineIdx = existingLines.findIndex((l) => l.match(/^tags:\s*\[/));
      if (tagLineIdx >= 0) {
        // 内联格式: tags: [a, b]
        const existingTagsStr = existingLines[tagLineIdx].match(/tags:\s*\[(.*)\]/)?.[1] || "";
        const existingTags = existingTagsStr.split(",").map((s) => s.trim().replace(/["']/g, ""));
        const merged = [...new Set([...existingTags, ...addTags])];
        existingLines[tagLineIdx] = `tags: [${merged.join(", ")}]`;
      } else {
        // 换行数组格式: tags:\n  - a\n  - b
        const tagKeyIdx = existingLines.findIndex((l) => l.match(/^tags:\s*$/));
        if (tagKeyIdx >= 0) {
          const newItems = addTags.map((t) => `  - ${t}`);
          existingLines.splice(tagKeyIdx + 1, 0, ...newItems);
        } else {
          linesToAdd.push(`tags: [${addTags.join(", ")}]`);
        }
      }
    } else {
      linesToAdd.push(`tags: [${addTags.join(", ")}]`);
    }
  }

  // 覆盖字段
  for (const [key, value] of Object.entries(changes.overwrite)) {
    const idx = existingLines.findIndex((l) => l.match(new RegExp(`^${key}:`)));
    if (idx >= 0) {
      existingLines[idx] = `${key}: ${value}`;
    } else {
      linesToAdd.push(`${key}: ${value}`);
    }
  }

  const newYaml = [...existingLines, ...linesToAdd].join("\n");
  return content.replace(/^---\n[\s\S]*?\n---/, `---\n${newYaml}\n---`);
}
