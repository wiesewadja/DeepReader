/** 编译选项 */
export interface CompileOptions {
  vaultPath: string;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  dryRun?: boolean;
  noInplace?: boolean;
  phases?: (1 | 2)[];
  concurrency?: number;
  confirm?: boolean;
  /** 向量化嵌入配置 */
  embedding?: {
    provider: "openai" | "ollama" | "lmstudio" | "local";
    model?: string;
    apiKey?: string;
    baseUrl?: string;
    dimensions?: number;
  };
}

/** 编译结果 */
export interface CompileResult {
  totalNotes: number;
  compiled: string[];
  skipped: string[];
  errors: Array<{ file: string; error: string }>;
  indexFiles: string[];
}

/** 目录扫描结果 */
export interface DirectoryScan {
  path: string;
  relativePath: string;
  fileCount: number;
  type: "timeline" | "topic" | "book" | "mixed";
  needsReorg: boolean;
  files: ScannedFile[];
}

/** 已扫描文件 */
export interface ScannedFile {
  relativePath: string;
  fileName: string;
  mtime: number;
  size: number;
}

/** 概念提取结果（Phase 1 Step 4）*/
export interface ConceptExtraction {
  file: string;
  tags: string[];
  topic: string;
  wikiLinks: Array<{ text: string; target: string }>;
  relatedConcepts: Array<{ concept: string; isNewConcept: boolean }>;
}

/** 深度分析结果（Phase 2）*/
export interface DeepAnalysis {
  concepts: {
    explicit: string[];
    implicit: string[];
    argumentative: { premises: string[]; conclusion: string };
  };
  suggestedLinks: Array<{
    originalText: string;
    replacement: string;
    target: string;
    confidence: number;
  }>;
  conceptNoteUpdates: Array<{ concept: string; action: string; content: string }>;
  newConceptNotes: Array<{
    name: string;
    definition: string;
    sources: string[];
    relatedConcepts: string[];
  }>;
}

/** 笔记元数据（用于原地增强）*/
export interface NoteMetadata {
  tags: string[];
  topic: string;
  wikiLinks: Array<{ text: string; target: string }>;
  relatedConcepts: string[];
}

/** 重组计划 */
export interface ReorgPlan {
  directory: string;
  moves: Array<{ from: string; to: string }>;
  linkUpdates: Array<{ file: string; oldLink: string; newLink: string }>;
  newDirs: string[];
}

/** 编译状态（持久化）*/
export interface CompilerState {
  phase1CompletedAt?: string;
  phase2: {
    queue: string[];
    completed: Record<string, string>;
    inProgress: string | null;
  };
}

/** 合并计划 */
export interface MergePlan {
  frontmatter: { add: Record<string, unknown>; overwrite: Record<string, unknown> };
  linksToAdd: Array<{ text: string; replacement: string }>;
  linksToSkip: string[];
}

/** 搜索结果 V2 */
export interface SearchResultV2 {
  file: string;
  title: string;
  summary: string;
  score: number;
  context?: string;
}
