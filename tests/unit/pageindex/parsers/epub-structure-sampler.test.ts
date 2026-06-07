/**
 * Unit tests for EPUB structure sampler
 *
 * Tests the sample extraction and strategy inference pipeline.
 * Uses real EPUB files from test-vault and Nutstore assets.
 *
 * @vitest-environment node
 */

import { describe, it, expect } from "vitest";
import AdmZip from "adm-zip";
import * as fs from "fs";
import * as path from "path";
import {
  extractEpubStructureSample,
  inferStrategyFromZip,
  type EpubParsingStrategy,
} from "../../../../src/pageindex/parsers/epub-structure-sampler";

// ─── Test fixtures ──────────────────────────────────────────────

const TEST_VAULT_ASSETS = path.resolve(
  __dirname,
  "../../../../test-vault/DeepReader/assets"
);
const NUTSTORE_ASSETS =
  "/Users/lizhao/Nutstore Files/昭见森2030/DeepReader/assets";

function findEpub(keyword: string): string | null {
  for (const dir of [TEST_VAULT_ASSETS, NUTSTORE_ASSETS]) {
    try {
      const files = fs.readdirSync(dir).filter((f) => f.endsWith(".epub"));
      const match = files.find((f) => f.includes(keyword));
      if (match) return path.join(dir, match);
    } catch {}
  }
  return null;
}

function openZip(keyword: string): AdmZip | null {
  const p = findEpub(keyword);
  return p ? new AdmZip(p) : null;
}

// ─── extractEpubStructureSample ─────────────────────────────────

describe("extractEpubStructureSample", () => {
  it("疯传: produces compact sample under 4KB", () => {
    const zip = openZip("疯传");
    if (!zip) return; // skip if EPUB not available
    const sample = extractEpubStructureSample(zip);
    expect(sample.length).toBeLessThan(4096);
    // Must contain key structural signals
    expect(sample).toContain("spine:");
    expect(sample).toContain("NCX TOC");
  });

  it("优秀的绵羊: includes heading tag counts", () => {
    const zip = openZip("优秀的绵羊");
    if (!zip) return;
    const sample = extractEpubStructureSample(zip);
    // Should detect <h1>/<h2> tags
    expect(sample).toMatch(/<h[1-6]>:/);
  });

  it("自卑与超越: detects no heading tags", () => {
    const zip = openZip("自卑与超越");
    if (!zip) return;
    const sample = extractEpubStructureSample(zip);
    // This EPUB has no <h> tags
    expect(sample).toMatch(/<h[1-6]>:\s*0/);
  });

  it("includes NCX TOC entries", () => {
    const zip = openZip("疯传");
    if (!zip) return;
    const sample = extractEpubStructureSample(zip);
    // Should list NCX entries with text
    expect(sample).toContain("第一章");
  });

  it("includes diamond (◆) count", () => {
    const zip = openZip("疯传");
    if (!zip) return;
    const sample = extractEpubStructureSample(zip);
    // 疯传 has ◆ lines
    expect(sample).toContain("◆");
  });
});

// ─── inferStrategyFromZip ───────────────────────────────────────

describe("inferStrategyFromZip", () => {
  // Expected results from epub-llm-structure-analysis.md
  // Expected results based on real EPUB data analysis
  // Key observations from HTML inspection:
  //   疯传: spine=4, no <h>, bold=CIP data (not headings), ◆=47 → bulkPdf
  //   自卑与超越: spine=4, no <h>, bold=CIP/版权 → bulkPdf
  //   鹤老师说经济: spine=11, <h1>+<h3> per file → mixed
  //   AI极简经济学: spine=30, <h2> as chapter+section headers → perChapter
  //   优秀的绵羊: spine=23, <h1>/<h2> as chapter headers → perChapter
  //   反脆弱: spine=48, NO <h> tags at all, only <p> → perChapter with ncxOnly
  const expectedStrategies: Record<
    string,
    Partial<EpubParsingStrategy>
  > = {
    疯传: {
      htmlStructure: "bulkPdf",
      headingDetection: "ncxOnly", // no <h>, bold is just CIP dots
      sectionDetection: "none",
      diamondLines: "tocEntries",
      titleSource: "ncxText",
      splitStrategy: "ncxAnchors",
    },
    自卑与超越: {
      htmlStructure: "bulkPdf",
      headingDetection: "ncxOnly", // no <h>, bold is CIP/版权
      sectionDetection: "none",
      diamondLines: "notPresent",
      titleSource: "ncxText",
      splitStrategy: "ncxAnchors",
    },
    鹤老师说经济: {
      htmlStructure: "mixed", // spine=11, <h1>+<h3> inside each file
      headingDetection: "hTags",
      sectionDetection: "h2h3", // <h3> = section headings within chapters
      diamondLines: "notPresent",
      titleSource: "ncxText",
      splitStrategy: "none",
    },
    AI极简经济学: {
      htmlStructure: "perChapter",
      headingDetection: "hTags", // <h2> in most files
      sectionDetection: "boldShort", // bold short text like "导言", "本章要点"
      diamondLines: "notPresent",
      titleSource: "hTag",
      splitStrategy: "none",
    },
    优秀的绵羊: {
      htmlStructure: "perChapter",
      headingDetection: "hTags", // <h1>/<h2> in most files
      sectionDetection: "boldShort", // "I.方向","II.风险" in part0011
      diamondLines: "notPresent",
      titleSource: "hTag",
      splitStrategy: "none",
    },
    反脆弱: {
      htmlStructure: "perChapter", // spine=48, each file = one section
      headingDetection: "ncxOnly", // NO <h> tags anywhere!
      sectionDetection: "none",
      diamondLines: "notPresent",
      titleSource: "ncxText", // must use NCX since no <h>
      splitStrategy: "none",
    },
  };

  // Test each book
  for (const [keyword, expected] of Object.entries(expectedStrategies)) {
    it(`${keyword}: infers correct strategy`, () => {
      const zip = openZip(keyword);
      if (!zip) return; // skip if EPUB not available
      const strategy = inferStrategyFromZip(zip);

      expect(strategy.htmlStructure).toBe(expected.htmlStructure);
      expect(strategy.headingDetection).toBe(expected.headingDetection);
      expect(strategy.sectionDetection).toBe(expected.sectionDetection);
      expect(strategy.diamondLines).toBe(expected.diamondLines);
      expect(strategy.titleSource).toBe(expected.titleSource);
      expect(strategy.splitStrategy).toBe(expected.splitStrategy);
    });
  }
});
