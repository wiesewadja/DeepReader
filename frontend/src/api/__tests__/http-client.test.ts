/**
 * HTTP 客户端测试
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

import { DeepPDFClient } from '../http-client.js';

describe('DeepPDFClient', () => {
    let client: DeepPDFClient;

    beforeEach(() => {
        client = new DeepPDFClient(8000);
        mockFetch.mockClear();
    });

    afterEach(() => {
        mockFetch.mockReset();
    });

    describe('healthCheck', () => {
        it('should return true when server is healthy', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ status: 'ok', version: '1.0.0' })
            });

            const result = await client.healthCheck();
            expect(result).toBe(true);
            expect(mockFetch).toHaveBeenCalledWith(
                'http://localhost:8000/health'
            );
        });

        it('should return false when server is unhealthy', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ status: 'error' })
            });

            const result = await client.healthCheck();
            expect(result).toBe(false);
        });

        it('should return false on network error', async () => {
            mockFetch.mockRejectedValueOnce(new Error('Network error'));

            const result = await client.healthCheck();
            expect(result).toBe(false);
        });
    });

    describe('indexPDF', () => {
        it('should create index successfully', async () => {
            const mockResult = {
                status: 'success',
                index_id: 'test-id',
                node_count: 10,
                pdf_name: 'test.pdf'
            };
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => mockResult
            });

            const result = await client.indexPDF('/path/to/file.pdf');

            expect(result).toEqual(mockResult);
            expect(mockFetch).toHaveBeenCalledWith(
                'http://localhost:8000/api/index',
                expect.objectContaining({
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ path: '/path/to/file.pdf' })
                })
            );
        });

        it('should handle error response', async () => {
            const mockResult = {
                status: 'error',
                error: 'File not found'
            };
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => mockResult
            });

            const result = await client.indexPDF('/invalid/path.pdf');

            expect(result.status).toBe('error');
            expect(result.error).toBe('File not found');
        });
    });

    describe('queryPDF', () => {
        it('should query PDF successfully', async () => {
            const mockResult = {
                status: 'success',
                results: [
                    {
                        text: 'Sample text',
                        metadata: { page: 1, section: 'Introduction' }
                    }
                ]
            };
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => mockResult
            });

            const result = await client.queryPDF('test query', 'test-index-id');

            expect(result).toEqual(mockResult);
            expect(mockFetch).toHaveBeenCalledWith(
                'http://localhost:8000/api/query',
                expect.objectContaining({
                    method: 'POST',
                    body: JSON.stringify({
                        query: 'test query',
                        index_id: 'test-index-id'
                    })
                })
            );
        });

        it('should handle empty results', async () => {
            const mockResult = {
                status: 'success',
                results: []
            };
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => mockResult
            });

            const result = await client.queryPDF('no results query', 'test-index-id');

            expect(result.results).toEqual([]);
        });
    });

    describe('listIndexes', () => {
        it('should list all indexes', async () => {
            const mockResult = {
                status: 'success',
                indexes: [
                    {
                        id: 'index-1',
                        pdf_name: 'doc1.pdf',
                        created_at: '2026-01-15T00:00:00',
                        node_count: 10
                    },
                    {
                        id: 'index-2',
                        pdf_name: 'doc2.pdf',
                        created_at: '2026-01-15T01:00:00',
                        node_count: 15
                    }
                ]
            };
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => mockResult
            });

            const result = await client.listIndexes();

            expect(result.status).toBe('success');
            expect(result.indexes).toHaveLength(2);
            expect(result.indexes[0].pdf_name).toBe('doc1.pdf');
        });

        it('should handle empty index list', async () => {
            const mockResult = {
                status: 'success',
                indexes: []
            };
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => mockResult
            });

            const result = await client.listIndexes();

            expect(result.indexes).toEqual([]);
        });
    });

    describe('deleteIndex', () => {
        it('should delete index successfully', async () => {
            const mockResult = {
                status: 'success',
                message: 'Index deleted'
            };
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => mockResult
            });

            const result = await client.deleteIndex('test-index-id');

            expect(result.status).toBe('success');
            expect(mockFetch).toHaveBeenCalledWith(
                'http://localhost:8000/api/indexes/test-index-id',
                expect.objectContaining({
                    method: 'DELETE'
                })
            );
        });

        it('should handle delete error', async () => {
            const mockResult = {
                status: 'error',
                message: 'Index not found'
            };
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => mockResult
            });

            const result = await client.deleteIndex('nonexistent-id');

            expect(result.status).toBe('error');
        });
    });
});
