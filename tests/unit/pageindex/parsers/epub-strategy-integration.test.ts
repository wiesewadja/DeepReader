/**
 * Tests for parseEpub() with strategy integration
 *
 * Validates that EpubParsingStrategy changes parseEpub() behavior correctly:
 * - ncxAnchors: splits bulkPdf books into proper chapters
 * - ncxText: uses NCX TOC text for chapter titles
 * - diamondLines: skips ◆ TOC entries
 * - Backward compatible: no strategy → existing behavior unchanged
 *
 * @vitest-environment node
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  parseEpub,
  type EpubInfo,
  type EpubChapter,
} from "../../../../src/pageindex/parsers/epub";
import {
  inferStrategyFromZip,
  type EpubParsingStrategy,
} from "../../../../src/pageindex/parsers/epub-structure-sampler";
import * as fs from "fs";
import * as path from "path";
import AdmZip from "adm-zip";

// ─── Test fixtures ──────────────────────────────────────────────

const TEST_VAULT_ASSETS = path.resolve(
  __dirname,
  "../../../../test-vault/DeepReader/assets"
);
const NUTSTORE_ASSETS =
  "/Users/lizhao/Nutstore Files/昭见森2030/DeepReader/assets";

function findEpubPath(keyword: string): string | null {
  for (const dir of [TEST_VAULT_ASSETS, NUTSTORE_ASSETS]) {
    try {
      const files = fs.readdirSync(dir).filter((f) => f.endsWith(".epub"));
      const match = files.find((f) => f.includes(keyword));
      if (match) return path.join(dir, match);
    } catch {}
  }
  return null;
}

function readBuffer(keyword: string): Buffer | null {
  const p = findEpubPath(keyword);
  return p ? fs.readFileSync(p) : null;
}

function openZip(keyword: string): AdmZip | null {
  const p = findEpubPath(keyword);
  return p ? new AdmZip(p) : null;
}

// ─── Strategy-driven parsing results ────────────────────────────

let 疯传_default: EpubInfo | null = null;
let 疯传_strategy: EpubInfo | null = null;
let 自卑与超越_default: EpubInfo | null = null;
let 自卑与超越_strategy: EpubInfo | null = null;
let 优秀的绵羊_default: EpubInfo | null = null;
let 优秀的绵羊_strategy: EpubInfo | null = null;

beforeAll(async () => {
  const parses: Promise<void>[] = [];

  // 疯传: bulkPdf → should split from 2 chapters to ~50+
  const 疯传_buf = readBuffer("疯传");
  if (疯传_buf) {
    parses.push(
      parseEpub(疯传_buf).then((v) => { 疯传_default = v; })
    );
    const zip = openZip("疯传")!;
    const strategy = inferStrategyFromZip(zip);
    parses.push(
      parseEpub(疯传_buf, strategy).then((v) => { 疯传_strategy = v; })
    );
  }

  // 自卑与超越: bulkPdf → should split from 3 chapters to ~70+
  const 自卑_buf = readBuffer("自卑与超越");
  if (自卑_buf) {
    parses.push(
      parseEpub(自卑_buf).then((v) => { 自卑与超越_default = v; })
    );
    const zip = openZip("自卑与超越")!;
    const strategy = inferStrategyFromZip(zip);
    parses.push(
      parseEpub(自卑_buf, strategy).then((v) => { 自卑与超越_strategy = v; })
    );
  }

  // 优秀的绵羊: perChapter → should be unchanged
  const 绵羊_buf = readBuffer("优秀的绵羊");
  if (绵羊_buf) {
    parses.push(
      parseEpub(绵羊_buf).then((v) => { 优秀的绵羊_default = v; })
    );
    const zip = openZip("优秀的绵羊")!;
    const strategy = inferStrategyFromZip(zip);
    parses.push(
      parseEpub(绵羊_buf, strategy).then((v) => { 优秀的绵羊_strategy = v; })
    );
  }

  await Promise.all(parses);
}, 60000);

// ═══════════════════════════════════════════════════════════════
// ncxAnchors splitting
// ═══════════════════════════════════════════════════════════════

describe("Strategy: ncxAnchors splitting (bulkPdf)", () => {
  it("疯传: strategy splits into many more chapters", () => {
    if (!疯传_default || !疯传_strategy) return;
    // Without strategy: 2-3 chapters (bulk HTML files)
    expect(疯传_default.chapters.length).toBeLessThan(5);
    // With strategy: should have much more (NCX has 54+ entries)
    expect(疯传_strategy.chapters.length).toBeGreaterThan(20);
  });

  it("疯传: strategy chapter titles come from NCX TOC", () => {
    if (!疯传_strategy) return;
    // Should have titles like "第一章　社交货币　Social Currency"
    const titles = 疯传_strategy.chapters.map((c) => c.title);
    const hasChapterTitle = titles.some((t) =>
      t.includes("第一章") || t.includes("第二章") || t.includes("第三章")
    );
    expect(hasChapterTitle).toBe(true);
  });

  it("疯传: strategy produces no chapter with title like 'Chapter N'", () => {
    if (!疯传_strategy) return;
    const genericTitles = 疯传_strategy.chapters.filter((c) =>
      /^Chapter \d+$/.test(c.title)
    );
    // Should not have generic titles when NCX provides real ones
    expect(genericTitles.length).toBe(0);
  });

  it("自卑与超越: strategy splits into many more chapters", () => {
    if (!自卑与超越_default || !自卑与超越_strategy) return;
    expect(自卑与超越_default.chapters.length).toBeLessThan(5);
    expect(自卑与超越_strategy.chapters.length).toBeGreaterThan(20);
  });

  it("自卑与超越: strategy chapter titles include 'Chapter N'", () => {
    if (!自卑与超越_strategy) return;
    const titles = 自卑与超越_strategy.chapters.map((c) => c.title);
    const hasChapterTitle = titles.some((t) =>
      t.includes("Chapter 01") || t.includes("生命的意义")
    );
    expect(hasChapterTitle).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// ncxText title source
// ═══════════════════════════════════════════════════════════════

describe("Strategy: ncxText title source", () => {
  it("疯传: titles match NCX entry text, not HTML fragments", () => {
    if (!疯传_strategy) return;
    // Old titles were truncated fragments from HTML first lines
    // New titles should be complete NCX entries
    const titles = 疯传_strategy.chapters.map((c) => c.title);
    for (const t of titles) {
      // Title should not be an overly long truncated fragment
      expect(t.length).toBeLessThan(60);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// diamondLines handling
// ═══════════════════════════════════════════════════════════════

describe("Strategy: diamondLines = tocEntries", () => {
  it("疯传: ◆ lines are skipped in markdown output", () => {
    if (!疯传_strategy) return;
    // With strategy, ◆ lines should not appear in content
    // (they're TOC entries, not section headings)
    const h3s = 疯传_strategy.chapters.flatMap((ch) =>
      (ch.content.match(/^### .+$/gm) || [])
    );
    const diamondH3s = h3s.filter((h) => h.includes("◆"));
    // Should have very few or no ◆ headings
    expect(diamondH3s.length).toBeLessThan(5);
  });
});

// ═══════════════════════════════════════════════════════════════
// Backward compatibility
// ═══════════════════════════════════════════════════════════════

describe("Strategy: backward compatibility", () => {
  it("no strategy produces same results as before for perChapter books", () => {
    if (!优秀的绵羊_default || !优秀的绵羊_strategy) return;
    // For well-structured perChapter books, strategy should not change chapter count
    expect(优秀的绵羊_strategy.chapters.length).toBe(
      优秀的绵羊_default.chapters.length
    );
    // Titles should also match
    const defaultTitles = 优秀的绵羊_default.chapters.map((c) => c.title);
    const strategyTitles = 优秀的绵羊_strategy.chapters.map((c) => c.title);
    expect(strategyTitles).toEqual(defaultTitles);
  });
});
