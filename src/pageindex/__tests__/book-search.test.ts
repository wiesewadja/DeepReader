/**
 * Tests for book-search module
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as crypto from "crypto";
import { searchBook } from "../book-search.js";
import type { BookMeta, BM25Data } from "../book-types.js";

function generateBookId(filePath: string): string {
  return crypto.createHash("sha256").update(filePath).digest("hex").slice(0, 8);
}

describe("book-search", () => {
  const testDir = "/tmp/deepreader-book-search-test";
  const testVault = path.join(testDir, "vault");
  const testIndexDir = path.join(testVault, ".pageindex");

  beforeEach(async () => {
    await fs.mkdir(testVault, { recursive: true });
    await fs.mkdir(testIndexDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe("searchBook - basic", () => {
    it("should throw INDEX_INCOMPLETE when index does not exist", async () => {
      const fakeBookPath = path.join(testVault, "nonexistent.pdf");

      await expect(
        searchBook({
          filePath: fakeBookPath,
          query: "test query",
        })
      ).rejects.toThrow("Index not found");
    });

    it("should search using pure BM25 when embedding not provided", async () => {
      const filePath = path.join(testVault, "test.pdf");
      const bookId = generateBookId(filePath);
      const bookIndexDir = path.join(testIndexDir, bookId);
      await fs.mkdir(bookIndexDir, { recursive: true });

      const bookMeta: BookMeta = {
        version: 1,
        bookId,
        title: "Test Book",
        description: "A test book for search",
        filePath,
        fileType: "pdf",
        indexedAt: new Date().toISOString(),
        chapters: [
          {
            id: "L1-001",
            title: "Chapter 1: Introduction",
            summary: "This chapter introduces the basics of machine learning",
            mdFilePath: "Test Book/Chapter 1.md",
            sortOrder: 0,
            mdFileHash: "",
            paragraphs: [],
          },
        ],
      };

      await fs.writeFile(
        path.join(bookIndexDir, "book-meta.json"),
        JSON.stringify(bookMeta, null, 2)
      );

      const bm25Data: BM25Data = {
        nodes: {
          "L0-root": {
            text: "Test Book A test book for search",
            length: 10,
            level: "L0",
          },
          "L1-001": {
            text: "Chapter 1: Introduction This chapter introduces the basics of machine learning",
            length: 20,
            level: "L1",
          },
          "L1-002": {
            text: "Other chapter with different content",
            length: 10,
            level: "L1",
          },
        },
        invertedIndex: {
          machine: [{ nodeId: "L1-001", tf: 1 }],
          learning: [{ nodeId: "L1-001", tf: 1 }],
          chapter: [{ nodeId: "L1-001", tf: 1 }, { nodeId: "L1-002", tf: 1 }],
          introduction: [{ nodeId: "L1-001", tf: 1 }],
        },
        stats: {
          totalDocs: 3,
          avgDocLength: 15,
          df: {
            machine: 1,
            learning: 1,
            chapter: 2,
            introduction: 1,
          },
        },
        params: {
          k1: 1.5,
          b: 0.75,
        },
      };

      await fs.writeFile(
        path.join(bookIndexDir, "bm25.json"),
        JSON.stringify(bm25Data, null, 2)
      );

      const chapterDir = path.join(testVault, "Test Book");
      await fs.mkdir(chapterDir, { recursive: true });
      await fs.writeFile(
        path.join(chapterDir, "Chapter 1.md"),
        "---\ntitle: Chapter 1\n---\n\nThis is chapter 1 content about machine learning.\n\n^block-001"
      );

      const results = await searchBook({
        filePath,
        query: "machine learning",
        topK: 3,
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].bm25Score).toBeGreaterThan(0);
      expect(results[0].vectorScore).toBe(0);
      expect(results[0].rawText).toBeDefined();
    });
  });

  describe("fuseScores", () => {
    it("should correctly fuse vector and BM25 scores", async () => {
      const filePath = path.join(testVault, "fuse.pdf");
      const bookId = generateBookId(filePath);
      const bookIndexDir = path.join(testIndexDir, bookId);
      await fs.mkdir(bookIndexDir, { recursive: true });

      const bookMeta: BookMeta = {
        version: 1,
        bookId,
        title: "Fusion Test Book",
        description: "Testing score fusion",
        filePath,
        fileType: "pdf",
        indexedAt: new Date().toISOString(),
        chapters: [
          {
            id: "L1-001",
            title: "Deep Learning",
            summary: "Neural networks and deep learning techniques",
            mdFilePath: "Fusion Test Book/Chapter 1.md",
            sortOrder: 0,
            mdFileHash: "",
            paragraphs: [],
          },
          {
            id: "L1-002",
            title: "Natural Language Processing",
            summary: "Text processing and NLP fundamentals",
            mdFilePath: "Fusion Test Book/Chapter 2.md",
            sortOrder: 1,
            mdFileHash: "",
            paragraphs: [],
          },
        ],
      };

      await fs.writeFile(
        path.join(bookIndexDir, "book-meta.json"),
        JSON.stringify(bookMeta, null, 2)
      );

      const bm25Data: BM25Data = {
        nodes: {
          "L1-001": {
            text: "Deep Learning Neural networks and deep learning techniques",
            length: 15,
            level: "L1",
          },
          "L1-002": {
            text: "Natural Language Processing Text processing and NLP fundamentals",
            length: 15,
            level: "L1",
          },
          "L1-003": {
            text: "Other content unrelated",
            length: 10,
            level: "L1",
          },
        },
        invertedIndex: {
          deep: [{ nodeId: "L1-001", tf: 2 }],
          learning: [{ nodeId: "L1-001", tf: 2 }],
          neural: [{ nodeId: "L1-001", tf: 1 }],
        },
        stats: {
          totalDocs: 3,
          avgDocLength: 13,
          df: {
            deep: 1,
            learning: 1,
            neural: 1,
          },
        },
        params: {
          k1: 1.5,
          b: 0.75,
        },
      };

      await fs.writeFile(
        path.join(bookIndexDir, "bm25.json"),
        JSON.stringify(bm25Data, null, 2)
      );

      const chapterDir = path.join(testVault, "Fusion Test Book");
      await fs.mkdir(chapterDir, { recursive: true });
      await fs.writeFile(
        path.join(chapterDir, "Chapter 1.md"),
        "# Deep Learning\n\nNeural networks and deep learning techniques.\n^block-dl"
      );
      await fs.writeFile(
        path.join(chapterDir, "Chapter 2.md"),
        "# NLP\n\nText processing.\n^block-nlp"
      );

      const results = await searchBook({
        filePath,
        query: "deep learning",
        topK: 2,
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].score).toBeGreaterThan(0);
      expect(results[0].bm25Score).toBeDefined();
      expect(results[0].vectorScore).toBeDefined();
    });
  });

  describe("readChapterContent", () => {
    it("should read chapter content and preserve block IDs", async () => {
      const filePath = path.join(testVault, "read.pdf");
      const bookId = generateBookId(filePath);
      const bookIndexDir = path.join(testIndexDir, bookId);
      await fs.mkdir(bookIndexDir, { recursive: true });

      const bookMeta: BookMeta = {
        version: 1,
        bookId,
        title: "Read Test",
        description: "Testing content reading",
        filePath,
        fileType: "pdf",
        indexedAt: new Date().toISOString(),
        chapters: [
          {
            id: "L1-001",
            title: "Chapter 1",
            summary: "Test summary",
            mdFilePath: "Read Test/Chapter 1.md",
            sortOrder: 0,
            mdFileHash: "",
            paragraphs: [],
          },
        ],
      };

      await fs.writeFile(
        path.join(bookIndexDir, "book-meta.json"),
        JSON.stringify(bookMeta, null, 2)
      );

      const bm25Data: BM25Data = {
        nodes: {
          "L1-001": {
            text: "Chapter 1 Test summary",
            length: 5,
            level: "L1",
          },
        },
        invertedIndex: {
          chapter: [{ nodeId: "L1-001", tf: 1 }],
        },
        stats: {
          totalDocs: 1,
          avgDocLength: 5,
          df: { chapter: 1 },
        },
        params: { k1: 1.5, b: 0.75 },
      };

      await fs.writeFile(
        path.join(bookIndexDir, "bm25.json"),
        JSON.stringify(bm25Data, null, 2)
      );

      const chapterDir = path.join(testVault, "Read Test");
      await fs.mkdir(chapterDir, { recursive: true });

      const mdContent = `---
title: Chapter 1
type: pdf
---

%% This is a comment %%

> [!note] Important
> This is important content.

[[Navigation|Prev]] [[Navigation|Next]]

This is the main content paragraph 1.

^block-id-001

This is paragraph 2.

^block-id-002
`;

      await fs.writeFile(
        path.join(chapterDir, "Chapter 1.md"),
        mdContent
      );

      const results = await searchBook({
        filePath,
        query: "chapter",
        topK: 1,
      });

      expect(results.length).toBe(1);
      expect(results[0].rawText).toContain("^block-id-001");
      expect(results[0].rawText).toContain("^block-id-002");
      expect(results[0].rawText).not.toContain("---");
      expect(results[0].rawText).not.toContain("[!note]");
      expect(results[0].rawText).not.toContain("%%");
      expect(results[0].rawText).not.toContain("[[Navigation");
    });

    it("should truncate long content", async () => {
      const filePath = path.join(testVault, "truncate.pdf");
      const bookId = generateBookId(filePath);
      const bookIndexDir = path.join(testIndexDir, bookId);
      await fs.mkdir(bookIndexDir, { recursive: true });

      const bookMeta: BookMeta = {
        version: 1,
        bookId,
        title: "Truncate Test",
        description: "Testing truncation",
        filePath,
        fileType: "pdf",
        indexedAt: new Date().toISOString(),
        chapters: [
          {
            id: "L1-001",
            title: "Long Chapter",
            summary: "A very long chapter",
            mdFilePath: "Truncate Test/Long Chapter.md",
            sortOrder: 0,
            mdFileHash: "",
            paragraphs: [],
          },
        ],
      };

      await fs.writeFile(
        path.join(bookIndexDir, "book-meta.json"),
        JSON.stringify(bookMeta, null, 2)
      );

      const bm25Data: BM25Data = {
        nodes: {
          "L1-001": {
            text: "Long Chapter A very long chapter",
            length: 10,
            level: "L1",
          },
        },
        invertedIndex: {
          long: [{ nodeId: "L1-001", tf: 2 }],
        },
        stats: {
          totalDocs: 1,
          avgDocLength: 10,
          df: { long: 1 },
        },
        params: { k1: 1.5, b: 0.75 },
      };

      await fs.writeFile(
        path.join(bookIndexDir, "bm25.json"),
        JSON.stringify(bm25Data, null, 2)
      );

      const chapterDir = path.join(testVault, "Truncate Test");
      await fs.mkdir(chapterDir, { recursive: true });

      const longContent = "A".repeat(15000);
      await fs.writeFile(
        path.join(chapterDir, "Long Chapter.md"),
        longContent
      );

      const results = await searchBook({
        filePath,
        query: "long",
        topK: 1,
        maxContextLength: 1000,
      });

      expect(results.length).toBe(1);
      expect(results[0].truncated).toBe(true);
      expect(results[0].rawText.length).toBeLessThan(1100);
      expect(results[0].rawText).toContain("truncated");
    });
  });

  describe("edge cases", () => {
    it("should return empty results when no matches", async () => {
      const filePath = path.join(testVault, "empty.pdf");
      const bookId = generateBookId(filePath);
      const bookIndexDir = path.join(testIndexDir, bookId);
      await fs.mkdir(bookIndexDir, { recursive: true });

      const bookMeta: BookMeta = {
        version: 1,
        bookId,
        title: "Empty Test",
        description: "No content",
        filePath,
        fileType: "pdf",
        indexedAt: new Date().toISOString(),
        chapters: [],
      };

      await fs.writeFile(
        path.join(bookIndexDir, "book-meta.json"),
        JSON.stringify(bookMeta, null, 2)
      );

      const bm25Data: BM25Data = {
        nodes: {},
        invertedIndex: {},
        stats: {
          totalDocs: 0,
          avgDocLength: 0,
          df: {},
        },
        params: { k1: 1.5, b: 0.75 },
      };

      await fs.writeFile(
        path.join(bookIndexDir, "bm25.json"),
        JSON.stringify(bm25Data, null, 2)
      );

      const results = await searchBook({
        filePath,
        query: "nothing matches this query",
        topK: 5,
      });

      expect(results.length).toBe(0);
    });

    it("should skip missing MD files gracefully", async () => {
      const filePath = path.join(testVault, "missing.pdf");
      const bookId = generateBookId(filePath);
      const bookIndexDir = path.join(testIndexDir, bookId);
      await fs.mkdir(bookIndexDir, { recursive: true });

      const bookMeta: BookMeta = {
        version: 1,
        bookId,
        title: "Missing File Test",
        description: "Test",
        filePath,
        fileType: "pdf",
        indexedAt: new Date().toISOString(),
        chapters: [
          {
            id: "L1-001",
            title: "Chapter 1",
            summary: "Summary",
            mdFilePath: "Missing File Test/Chapter 1.md",
            sortOrder: 0,
            mdFileHash: "",
            paragraphs: [],
          },
        ],
      };

      await fs.writeFile(
        path.join(bookIndexDir, "book-meta.json"),
        JSON.stringify(bookMeta, null, 2)
      );

      const bm25Data: BM25Data = {
        nodes: {
          "L1-001": {
            text: "Chapter 1 Summary",
            length: 5,
            level: "L1",
          },
        },
        invertedIndex: {
          chapter: [{ nodeId: "L1-001", tf: 1 }],
        },
        stats: {
          totalDocs: 1,
          avgDocLength: 5,
          df: { chapter: 1 },
        },
        params: { k1: 1.5, b: 0.75 },
      };

      await fs.writeFile(
        path.join(bookIndexDir, "bm25.json"),
        JSON.stringify(bm25Data, null, 2)
      );

      const results = await searchBook({
        filePath,
        query: "chapter",
        topK: 5,
      });

      expect(results.length).toBe(0);
    });
  });

  describe("score normalization", () => {
    it("should normalize BM25 scores for fusion", async () => {
      const filePath = path.join(testVault, "norm.pdf");
      const bookId = generateBookId(filePath);
      const bookIndexDir = path.join(testIndexDir, bookId);
      await fs.mkdir(bookIndexDir, { recursive: true });

      const bookMeta: BookMeta = {
        version: 1,
        bookId,
        title: "Normalization Test",
        description: "Test",
        filePath,
        fileType: "pdf",
        indexedAt: new Date().toISOString(),
        chapters: [
          {
            id: "L1-001",
            title: "Chapter 1",
            summary: "High relevance",
            mdFilePath: "Normalization Test/Chapter 1.md",
            sortOrder: 0,
            mdFileHash: "",
            paragraphs: [],
          },
          {
            id: "L1-002",
            title: "Chapter 2",
            summary: "Low relevance",
            mdFilePath: "Normalization Test/Chapter 2.md",
            sortOrder: 1,
            mdFileHash: "",
            paragraphs: [],
          },
        ],
      };

      await fs.writeFile(
        path.join(bookIndexDir, "book-meta.json"),
        JSON.stringify(bookMeta, null, 2)
      );

      const bm25Data: BM25Data = {
        nodes: {
          "L1-001": {
            text: "Chapter 1 High relevance with many keywords keywords keywords",
            length: 20,
            level: "L1",
          },
          "L1-002": {
            text: "Chapter 2 Low relevance",
            length: 5,
            level: "L1",
          },
        },
        invertedIndex: {
          keywords: [{ nodeId: "L1-001", tf: 3 }],
          chapter: [{ nodeId: "L1-001", tf: 1 }, { nodeId: "L1-002", tf: 1 }],
          relevance: [{ nodeId: "L1-001", tf: 1 }, { nodeId: "L1-002", tf: 1 }],
        },
        stats: {
          totalDocs: 2,
          avgDocLength: 12.5,
          df: {
            keywords: 1,
            chapter: 2,
            relevance: 2,
          },
        },
        params: { k1: 1.5, b: 0.75 },
      };

      await fs.writeFile(
        path.join(bookIndexDir, "bm25.json"),
        JSON.stringify(bm25Data, null, 2)
      );

      const chapterDir = path.join(testVault, "Normalization Test");
      await fs.mkdir(chapterDir, { recursive: true });
      await fs.writeFile(
        path.join(chapterDir, "Chapter 1.md"),
        "Content 1\n^block-1"
      );
      await fs.writeFile(
        path.join(chapterDir, "Chapter 2.md"),
        "Content 2\n^block-2"
      );

      const results = await searchBook({
        filePath,
        query: "keywords",
        topK: 2,
      });

      expect(results.length).toBeGreaterThan(0);
      if (results.length >= 2) {
        expect(results[0].bm25Score).toBeGreaterThan(results[1].bm25Score);
      }
    });
  });

  describe("edge cases - vector search failures", () => {
    it("should fallback to pure BM25 when vectors not available", async () => {
      const filePath = path.join(testVault, "no-vectors.pdf");
      const bookId = generateBookId(filePath);
      const bookIndexDir = path.join(testIndexDir, bookId);
      await fs.mkdir(bookIndexDir, { recursive: true });

      const bookMeta: BookMeta = {
        version: 1,
        bookId,
        title: "No Vectors Book",
        description: "Book without vector embeddings",
        filePath,
        fileType: "pdf",
        indexedAt: new Date().toISOString(),
        chapters: [
          {
            id: "L1-001",
            title: "Neural Networks Deep Learning",
            summary: "Neural network architectures deep learning overview",
            mdFilePath: "No Vectors Book/Neural Networks Deep Learning.md",
            sortOrder: 0,
            mdFileHash: "",
            paragraphs: [],
          },
        ],
      };

      await fs.writeFile(
        path.join(bookIndexDir, "book-meta.json"),
        JSON.stringify(bookMeta, null, 2)
      );

      const bm25Data: BM25Data = {
        nodes: {
          "L0-root": {
            text: "No Vectors Book Book without vector embeddings",
            length: 30,
            level: "L0",
          },
          "L1-001": {
            text: "Neural Networks Deep Learning Neural network architectures deep learning overview neural network deep learning",
            length: 60,
            level: "L1",
          },
        },
        invertedIndex: {
          neural: [{ nodeId: "L1-001", tf: 4 }],
          network: [{ nodeId: "L1-001", tf: 3 }],
          deep: [{ nodeId: "L1-001", tf: 3 }],
          learning: [{ nodeId: "L1-001", tf: 3 }],
        },
        stats: {
          totalDocs: 2,
          avgDocLength: 45,
          df: { neural: 1, network: 1, deep: 1, learning: 1 },
        },
        params: { k1: 1.5, b: 0.75 },
      };

      await fs.writeFile(
        path.join(bookIndexDir, "bm25.json"),
        JSON.stringify(bm25Data, null, 2)
      );

      const chapterDir = path.join(testVault, "No Vectors Book");
      await fs.mkdir(chapterDir, { recursive: true });
      await fs.writeFile(
        path.join(chapterDir, "Neural Networks Deep Learning.md"),
        "# Neural Networks\n\nArchitecture details.\n^block-nn"
      );

      const results = await searchBook({
        filePath,
        query: "neural network deep learning",
        topK: 3,
        embedding: {
          provider: "openai",
          apiKey: "test-key",
          model: "text-embedding-3-small",
          dimensions: 1536,
        },
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].vectorScore).toBe(0);
      expect(results[0].bm25Score).toBeDefined();
      expect(results[0].bookTitle).toBe("No Vectors Book");
    });

    it("should handle dimension mismatch error", async () => {
      const filePath = path.join(testVault, "dim-mismatch.pdf");
      const bookId = generateBookId(filePath);
      const bookIndexDir = path.join(testIndexDir, bookId);
      await fs.mkdir(bookIndexDir, { recursive: true });

      const bookMeta: BookMeta = {
        version: 1,
        bookId,
        title: "Dimension Mismatch Book",
        description: "Book with 768-dim vectors",
        filePath,
        fileType: "pdf",
        indexedAt: new Date().toISOString(),
        embedding: {
          provider: "openai",
          model: "text-embedding-3-small",
          dimensions: 768,
        },
        chapters: [
          {
            id: "L1-001",
            title: "Chapter Content Summary",
            summary: "Summary of chapter content overview details",
            mdFilePath: "Dimension Mismatch Book/Chapter Content Summary.md",
            sortOrder: 0,
            mdFileHash: "",
            paragraphs: [],
          },
        ],
      };

      await fs.writeFile(
        path.join(bookIndexDir, "book-meta.json"),
        JSON.stringify(bookMeta, null, 2)
      );

      const bm25Data: BM25Data = {
        nodes: {
          "L0-root": {
            text: "Dimension Mismatch Book",
            length: 20,
            level: "L0",
          },
          "L1-001": {
            text: "Chapter Content Summary Summary of chapter content overview details chapter content summary",
            length: 50,
            level: "L1",
          },
        },
        invertedIndex: {
          chapter: [{ nodeId: "L1-001", tf: 3 }],
          content: [{ nodeId: "L1-001", tf: 3 }],
          summary: [{ nodeId: "L1-001", tf: 2 }],
          overview: [{ nodeId: "L1-001", tf: 1 }],
        },
        stats: {
          totalDocs: 2,
          avgDocLength: 35,
          df: { chapter: 1, content: 1, summary: 1, overview: 1 },
        },
        params: { k1: 1.5, b: 0.75 },
      };

      await fs.writeFile(
        path.join(bookIndexDir, "bm25.json"),
        JSON.stringify(bm25Data, null, 2)
      );

      const chapterDir = path.join(testVault, "Dimension Mismatch Book");
      await fs.mkdir(chapterDir, { recursive: true });
      await fs.writeFile(
        path.join(chapterDir, "Chapter Content Summary.md"),
        "# Chapter 1\n\nContent.\n^block-dim"
      );

      const results = await searchBook({
        filePath,
        query: "chapter content summary",
        topK: 3,
        embedding: {
          provider: "openai",
          apiKey: "test-key",
          model: "text-embedding-3-small",
          dimensions: 1536,
        },
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].vectorScore).toBe(0);
      expect(results[0].bm25Score).toBeDefined();
      expect(results[0].bookTitle).toBe("Dimension Mismatch Book");
    });
  });

  describe("edge cases - file errors", () => {
    it("should throw INDEX_INCOMPLETE for missing book-meta.json", async () => {
      const filePath = path.join(testVault, "missing-meta.pdf");
      const bookId = generateBookId(filePath);
      const bookIndexDir = path.join(testIndexDir, bookId);
      await fs.mkdir(bookIndexDir, { recursive: true });

      await fs.writeFile(
        path.join(bookIndexDir, "bm25.json"),
        JSON.stringify({ nodes: {}, invertedIndex: {}, stats: {}, params: {} })
      );

      await expect(
        searchBook({
          filePath,
          query: "test",
          topK: 5,
        })
      ).rejects.toThrow();
    });

    it("should return empty for query with no matches in populated index", async () => {
      const filePath = path.join(testVault, "specific-query.pdf");
      const bookId = generateBookId(filePath);
      const bookIndexDir = path.join(testIndexDir, bookId);
      await fs.mkdir(bookIndexDir, { recursive: true });

      const bookMeta: BookMeta = {
        version: 1,
        bookId,
        title: "Specific Topics",
        description: "Book about specific topics",
        filePath,
        fileType: "pdf",
        indexedAt: new Date().toISOString(),
        chapters: [
          {
            id: "L1-001",
            title: "Machine Learning",
            summary: "Introduction to ML",
            mdFilePath: "Specific Topics/ML.md",
            sortOrder: 0,
            mdFileHash: "",
            paragraphs: [],
          },
        ],
      };

      await fs.writeFile(
        path.join(bookIndexDir, "book-meta.json"),
        JSON.stringify(bookMeta, null, 2)
      );

      const bm25Data: BM25Data = {
        nodes: {
          "L1-001": {
            text: "Machine Learning Introduction to ML",
            length: 15,
            level: "L1",
          },
        },
        invertedIndex: {
          machine: [{ nodeId: "L1-001", tf: 1 }],
          learning: [{ nodeId: "L1-001", tf: 1 }],
        },
        stats: {
          totalDocs: 1,
          avgDocLength: 15,
          df: { machine: 1, learning: 1 },
        },
        params: { k1: 1.5, b: 0.75 },
      };

      await fs.writeFile(
        path.join(bookIndexDir, "bm25.json"),
        JSON.stringify(bm25Data, null, 2)
      );

      const chapterDir = path.join(testVault, "Specific Topics");
      await fs.mkdir(chapterDir, { recursive: true });
      await fs.writeFile(
        path.join(chapterDir, "ML.md"),
        "# ML\n\nContent.\n^block-ml"
      );

      const results = await searchBook({
        filePath,
        query: "quantum physics cryptography unrelated",
        topK: 5,
      });

      expect(results.length).toBe(0);
    });

    it("should handle missing chapter MD file gracefully", async () => {
      const filePath = path.join(testVault, "missing-chapter.pdf");
      const bookId = generateBookId(filePath);
      const bookIndexDir = path.join(testIndexDir, bookId);
      await fs.mkdir(bookIndexDir, { recursive: true });

      const bookMeta: BookMeta = {
        version: 1,
        bookId,
        title: "Missing Chapter",
        description: "Book with deleted chapter",
        filePath,
        fileType: "pdf",
        indexedAt: new Date().toISOString(),
        chapters: [
          {
            id: "L1-001",
            title: "Chapter 1",
            summary: "First chapter",
            mdFilePath: "Missing Chapter/Chapter 1.md",
            sortOrder: 0,
            mdFileHash: "",
            paragraphs: [],
          },
          {
            id: "L1-002",
            title: "Chapter 2",
            summary: "Second chapter (file deleted)",
            mdFilePath: "Missing Chapter/Chapter 2.md",
            sortOrder: 1,
            mdFileHash: "",
            paragraphs: [],
          },
        ],
      };

      await fs.writeFile(
        path.join(bookIndexDir, "book-meta.json"),
        JSON.stringify(bookMeta, null, 2)
      );

      const bm25Data: BM25Data = {
        nodes: {
          "L1-001": {
            text: "Chapter 1 First chapter",
            length: 10,
            level: "L1",
          },
          "L1-002": {
            text: "Chapter 2 Second chapter file deleted",
            length: 15,
            level: "L1",
          },
        },
        invertedIndex: {
          chapter: [{ nodeId: "L1-001", tf: 1 }, { nodeId: "L1-002", tf: 1 }],
        },
        stats: {
          totalDocs: 2,
          avgDocLength: 12.5,
          df: { chapter: 2 },
        },
        params: { k1: 1.5, b: 0.75 },
      };

      await fs.writeFile(
        path.join(bookIndexDir, "bm25.json"),
        JSON.stringify(bm25Data, null, 2)
      );

      const chapterDir = path.join(testVault, "Missing Chapter");
      await fs.mkdir(chapterDir, { recursive: true });
      await fs.writeFile(
        path.join(chapterDir, "Chapter 1.md"),
        "# Chapter 1\n\nContent.\n^block-c1"
      );

      const results = await searchBook({
        filePath,
        query: "chapter",
        topK: 5,
      });

      expect(results.some(r => r.nodeId === "L1-001")).toBe(true);
      expect(results.some(r => r.nodeId === "L1-002")).toBe(false);
    });
  });

  describe("edge cases - special queries", () => {
    it("should handle single-character query with bigram fallback", async () => {
      const filePath = path.join(testVault, "single-char.pdf");
      const bookId = generateBookId(filePath);
      const bookIndexDir = path.join(testIndexDir, bookId);
      await fs.mkdir(bookIndexDir, { recursive: true });

      const bookMeta: BookMeta = {
        version: 1,
        bookId,
        title: "Chinese Content",
        description: "中文内容测试",
        filePath,
        fileType: "pdf",
        indexedAt: new Date().toISOString(),
        chapters: [
          {
            id: "L1-001",
            title: "第一章",
            summary: "中文摘要",
            mdFilePath: "Chinese Content/第一章.md",
            sortOrder: 0,
            mdFileHash: "",
            paragraphs: [],
          },
        ],
      };

      await fs.writeFile(
        path.join(bookIndexDir, "book-meta.json"),
        JSON.stringify(bookMeta, null, 2)
      );

      const bm25Data: BM25Data = {
        nodes: {
          "L0-root": {
            text: "Chinese Content 中文内容测试",
            length: 20,
            level: "L0",
          },
          "L1-001": {
            text: "第一章 中文摘要",
            length: 15,
            level: "L1",
          },
        },
        invertedIndex: {
          "第一": [{ nodeId: "L1-001", tf: 2 }],
          "一章": [{ nodeId: "L1-001", tf: 2 }],
          "中文": [{ nodeId: "L1-001", tf: 2 }, { nodeId: "L0-root", tf: 1 }],
          "文摘": [{ nodeId: "L1-001", tf: 1 }],
          "摘要": [{ nodeId: "L1-001", tf: 1 }],
        },
        stats: {
          totalDocs: 2,
          avgDocLength: 17.5,
          df: {
            "第一": 1,
            "一章": 1,
            "中文": 2,
            "文摘": 1,
            "摘要": 1,
          },
        },
        params: { k1: 1.5, b: 0.75 },
      };

      await fs.writeFile(
        path.join(bookIndexDir, "bm25.json"),
        JSON.stringify(bm25Data, null, 2)
      );

      const chapterDir = path.join(testVault, "Chinese Content");
      await fs.mkdir(chapterDir, { recursive: true });
      await fs.writeFile(
        path.join(chapterDir, "第一章.md"),
        "# 第一章\n\n内容。\n^block-zh"
      );

      const results = await searchBook({
        filePath,
        query: "中文",
        topK: 3,
      });

      expect(results.length).toBeGreaterThan(0);
    });

    it("should handle very long query string", async () => {
      const filePath = path.join(testVault, "long-query.pdf");
      const bookId = generateBookId(filePath);
      const bookIndexDir = path.join(testIndexDir, bookId);
      await fs.mkdir(bookIndexDir, { recursive: true });

      const bookMeta: BookMeta = {
        version: 1,
        bookId,
        title: "Long Query Test",
        description: "Test",
        filePath,
        fileType: "pdf",
        indexedAt: new Date().toISOString(),
        chapters: [
          {
            id: "L1-001",
            title: "Test Chapter",
            summary: "Summary",
            mdFilePath: "Long Query Test/Test Chapter.md",
            sortOrder: 0,
            mdFileHash: "",
            paragraphs: [],
          },
        ],
      };

      await fs.writeFile(
        path.join(bookIndexDir, "book-meta.json"),
        JSON.stringify(bookMeta, null, 2)
      );

      const bm25Data: BM25Data = {
        nodes: {
          "L1-001": {
            text: "Test Chapter Summary with keywords",
            length: 15,
            level: "L1",
          },
        },
        invertedIndex: {
          test: [{ nodeId: "L1-001", tf: 1 }],
          chapter: [{ nodeId: "L1-001", tf: 1 }],
          keywords: [{ nodeId: "L1-001", tf: 1 }],
        },
        stats: {
          totalDocs: 1,
          avgDocLength: 15,
          df: { test: 1, chapter: 1, keywords: 1 },
        },
        params: { k1: 1.5, b: 0.75 },
      };

      await fs.writeFile(
        path.join(bookIndexDir, "bm25.json"),
        JSON.stringify(bm25Data, null, 2)
      );

      const chapterDir = path.join(testVault, "Long Query Test");
      await fs.mkdir(chapterDir, { recursive: true });
      await fs.writeFile(
        path.join(chapterDir, "Test Chapter.md"),
        "Content.\n^block-lq"
      );

      const longQuery = "test chapter keywords " + "extra ".repeat(100);
      const results = await searchBook({
        filePath,
        query: longQuery,
        topK: 3,
      });

      expect(results.length).toBeGreaterThan(0);
    });

    it("should handle empty query gracefully", async () => {
      const filePath = path.join(testVault, "empty-query.pdf");
      const bookId = generateBookId(filePath);
      const bookIndexDir = path.join(testIndexDir, bookId);
      await fs.mkdir(bookIndexDir, { recursive: true });

      const bookMeta: BookMeta = {
        version: 1,
        bookId,
        title: "Empty Query Test",
        description: "Test",
        filePath,
        fileType: "pdf",
        indexedAt: new Date().toISOString(),
        chapters: [
          {
            id: "L1-001",
            title: "Chapter 1",
            summary: "Summary",
            mdFilePath: "Empty Query Test/Chapter 1.md",
            sortOrder: 0,
            mdFileHash: "",
            paragraphs: [],
          },
        ],
      };

      await fs.writeFile(
        path.join(bookIndexDir, "book-meta.json"),
        JSON.stringify(bookMeta, null, 2)
      );

      const bm25Data: BM25Data = {
        nodes: {
          "L1-001": {
            text: "Chapter 1 Summary",
            length: 5,
            level: "L1",
          },
        },
        invertedIndex: {
          chapter: [{ nodeId: "L1-001", tf: 1 }],
        },
        stats: {
          totalDocs: 1,
          avgDocLength: 5,
          df: { chapter: 1 },
        },
        params: { k1: 1.5, b: 0.75 },
      };

      await fs.writeFile(
        path.join(bookIndexDir, "bm25.json"),
        JSON.stringify(bm25Data, null, 2)
      );

      const chapterDir = path.join(testVault, "Empty Query Test");
      await fs.mkdir(chapterDir, { recursive: true });
      await fs.writeFile(
        path.join(chapterDir, "Chapter 1.md"),
        "Content.\n^block-eq"
      );

      const results = await searchBook({
        filePath,
        query: "",
        topK: 3,
      });

      expect(results.length).toBe(0);
    });
  });
});