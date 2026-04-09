# PageIndex Migration Guide

## Overview

This document describes the migration from backend API to PageIndex local indexing system in DeepReader.

## Migration Guide

### API Mapping Table

| Backend API | PageIndex Function | Notes |
|-------------|-------------------|-------|
| `POST /api/index` | `indexBook()` | Creates `.pageindex/{bookId}/` directory |
| `GET /api/index/{id}/status` | Progress callback | Use `onProgress` option |
| `POST /api/query` | `searchBook()` | Hybrid BM25 + vector search |
| `DELETE /api/index/{id}` | `deleteBookIndex()` | Removes `.pageindex/{bookId}/` |
| `GET /api/index/{id}` | `isBookIndexed()` | Checks `.pageindex/{bookId}/` existence |
| `GET /api/export/{id}` | MD files in vault | Chapter MD files exported to vault |

### Component Changes Checklist

#### 1. Import Changes

```typescript
// Before (Backend API)
import { indexAPI } from "./api/http-client.js";
const result = await indexAPI.createWithFile(file, options);

// After (PageIndex)
import { indexBook } from "./pageindex/book-indexer.js";
const result = await indexBook({
  filePath: "/path/to/book.pdf",
  fileType: "pdf",
  outputDir: vaultPath,
  model: "gpt-4o-mini",
  apiKey: settings.apiKey,
});
```

#### 2. Progress Tracking

```typescript
// Before (Polling)
const status = await indexAPI.poll(taskId);

// After (Callback)
await indexBook({
  ...options,
  onProgress: (progress) => {
    console.log(`${progress.percent}% - ${progress.stepLabel}`);
  },
});
```

#### 3. Search Changes

```typescript
// Before
const results = await queryAPI.search({
  indexId: bookId,
  query: searchText,
  topK: 5,
});

// After
const results = await searchBook({
  filePath: bookPath,
  query: searchText,
  topK: 5,
  embedding: {
    provider: "openai",
    apiKey: settings.embeddingApiKey,
    model: "text-embedding-3-small",
    dimensions: 1536,
  },
});
```

### Breaking Changes

1. **Book ID Generation**: Now uses SHA-256 hash of file path (first 8 chars)
2. **Storage Location**: `.pageindex/{bookId}/` instead of backend database
3. **Vector Storage**: Local `vectors.f32` file instead of ChromaDB
4. **Search Mode**: Requires explicit `embedding` config for vector search
5. **Progress**: No polling, use callback pattern

## Architecture Overview

### L0/L1/L2 Hierarchy

```
L0 (Book Root)
├── Book title + summary + description
├── L1 (Chapters)
│   ├── Chapter title + summary + text
│   └── L2 (Paragraphs)
│       └── Block IDs for FrontendAgent linking
└── L1 (Chapter N)
    └── ...
```

### Per-Book Storage Layout

```
.pageindex/{bookId}/
├── book-meta.json     # Book metadata (title, chapters, embedding config)
├── bm25.json          # BM25 inverted index
├── vectors.f32        # Binary vector store (Float32 array)
└── vectors.meta.json  # Vector metadata (slots, dimensions, model)
```

### Hybrid Search (Vector + BM25)

```typescript
// Score fusion formula
fusedScore = w_v * vectorScore + w_b * normalizedBM25Score

// Weights
w_v = 0.7 (vector weight when vectors available)
w_b = 0.3 (BM25 weight when vectors available)
w_b = 1.0 (BM25 weight when no vectors)
```

#### Search Flow

1. **BM25 Search**: Full-text search on node text
2. **Vector Search**: (Optional) Semantic similarity search
3. **Score Fusion**: Combine and normalize scores
4. **L2 Context**: Read chapter MD files with block IDs

## Testing Checklist

### Unit Tests

- [x] `generateBookId()` - SHA-256 hash generation
- [x] `indexBook()` - Full indexing workflow
- [x] `isBookIndexed()` - Index existence check
- [x] `deleteBookIndex()` - Index deletion
- [x] `searchBook()` - Hybrid search
- [x] BM25 tokenization and search
- [x] Progress events emission

### Integration Tests

- [x] PDF indexing → Search → Delete lifecycle
- [x] EPUB indexing → Delete lifecycle
- [x] Embedding API integration
- [x] Graceful degradation to pure BM25

### Edge Case Tests

- [x] File not found error
- [x] Embedding API failure → pure BM25 fallback
- [x] Missing MD files handling
- [x] Corrupted book-meta.json handling
- [x] Corrupted bm25.json handling
- [x] Dimension mismatch handling
- [x] Empty query handling
- [x] Long query handling
- [x] CJK text tokenization

### E2E Tests

- [x] Complete lifecycle (add → search → delete)
- [x] Vector search with OpenAI embedding
- [x] Pure BM25 search without embedding
- [x] Model dimension changes
- [x] Multiple books in vault
- [x] Progress tracking

### Manual Testing Steps

1. **Index a PDF**
   - Add a PDF to vault
   - Run index command
   - Verify `.pageindex/{bookId}/` created
   - Check `book-meta.json` structure

2. **Search**
   - Query the indexed book
   - Verify results contain block IDs
   - Check chapter content retrieval

3. **Delete**
   - Delete book index
   - Verify `.pageindex/{bookId}/` removed
   - Confirm search fails

4. **Embedding Fallback**
   - Use invalid API key for embedding
   - Verify graceful degradation to BM25
   - Check search still works

## Troubleshooting

### Common Errors

#### 1. `INDEX_INCOMPLETE`

**Symptom**: Search fails with "Index not found"

**Cause**: Index directory missing or incomplete

**Fix**:
```bash
# Check if index exists
ls .pageindex/{bookId}/

# Re-index if needed
await indexBook({ filePath, ... });
```

#### 2. `VECTOR_DIMENSION_MISMATCH`

**Symptom**: Vector search returns 0 results

**Cause**: Query embedding dimension differs from stored vectors

**Fix**:
```typescript
// Option 1: Use same embedding config
embedding: { dimensions: 1536 }

// Option 2: Delete and re-index with new model
await deleteBookIndex(filePath, vaultPath);
await indexBook({ ...options, embedding: newConfig });
```

#### 3. `BM25_INDEX_CORRUPT`

**Symptom**: Search throws parse error

**Cause**: `bm25.json` corrupted

**Fix**:
```bash
# Delete and re-index
rm -rf .pageindex/{bookId}/
await indexBook({ filePath, ... });
```

#### 4. Embedding API Timeout

**Symptom**: Indexing hangs at "vectorize" step

**Fix**:
```typescript
// Add timeout
const controller = new AbortController();
setTimeout(() => controller.abort(), 30000);

// Or skip vectorization
await indexBook({ ...options }); // No embedding config
```

### Performance Tuning

#### BM25 Parameters

```typescript
// Default values (in bm25.ts)
k1: 1.5  // Term frequency saturation
b: 0.75  // Document length normalization
```

#### Batch Size for Embeddings

```typescript
// In vectors.ts
const batchSize = 100;  // Adjust based on API limits
```

#### Max Context Length

```typescript
// In searchBook()
maxContextLength: 10000  // Characters per chapter
```

## Next Steps

### Future Improvements

1. **Incremental Updates**: Re-index only changed chapters
2. **Multi-model Support**: Store vectors from multiple models
3. **L2 Paragraph Search**: Fine-grained paragraph-level search
4. **Index Compaction**: Remove deleted vectors from `.f32` file
5. **Cross-book Search**: Search across multiple books simultaneously

### Known Limitations

1. **No Vector Updates**: Changing model requires full re-index
2. **No Partial Re-index**: Must delete entire book index to update
3. **Memory Usage**: Vectors loaded into memory for search
4. **No Concurrency**: One indexing operation per book at a time
5. **No Embedding Cache**: Re-embeds all nodes on each index

### Migration Path for Existing Users

1. **Backend Optional**: Keep backend for fallback during transition
2. **Gradual Migration**: Migrate one book at a time
3. **Data Export**: Backend can export existing indexes
4. **Rollback**: Keep backend connection config as fallback

---

**Document Version**: 1.0
**Last Updated**: 2026-04-08
**Authors**: DeepReader Team