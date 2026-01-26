/**
 * HTTP 客户端测试
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

// Mock XMLHttpRequest for file upload
const mockXHR = vi.fn();
global.XMLHttpRequest = mockXHR as any;

import { DeepPDFClient, deeppdfClient } from '../http-client.js';

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
        it('should return health status when server is healthy', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ status: 'ok', version: '1.0.0' })
            });

            const result = await client.healthCheck();
            expect(result).toEqual({ status: 'ok', version: '1.0.0' });
            expect(mockFetch).toHaveBeenCalledWith(
                'http://localhost:8000/health',
                {}
            );
        });

        it('should throw error when server returns error', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                json: async () => ({ detail: 'Server error' })
            });

            await expect(client.healthCheck()).rejects.toThrow('Server error');
        });

        it('should throw error on network error', async () => {
            mockFetch.mockRejectedValueOnce(new Error('Network error'));

            await expect(client.healthCheck()).rejects.toThrow('Network error');
        });
    });

    describe('indexPDF', () => {
        it('should create index with path successfully', async () => {
            const mockResult = {
                status: 'pending',
                index_id: 'task_test-id',
                message: '索引任务已创建'
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

        it('should create index with file_id', async () => {
            const mockResult = {
                status: 'pending',
                index_id: 'task_test-id'
            };
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => mockResult
            });

            const result = await client.indexPDFWithFile('f_abc123', 'my-config');

            expect(result).toEqual(mockResult);
            expect(mockFetch).toHaveBeenCalledWith(
                'http://localhost:8000/api/index',
                expect.objectContaining({
                    body: JSON.stringify({ file_id: 'f_abc123', config_name: 'my-config' })
                })
            );
        });

        it('should handle error response', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: false,
                json: async () => ({ detail: 'File not found' })
            });

            await expect(client.indexPDF('/invalid/path.pdf')).rejects.toThrow('File not found');
        });
    });

    describe('queryPDF', () => {
        it('should query PDF successfully', async () => {
            const mockResult = {
                status: 'success',
                query: 'test query',
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
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        query: 'test query',
                        index_id: 'test-index-id',
                        max_results: 10
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

    describe('getIndexStatus', () => {
        it('should get index status', async () => {
            const mockResult = {
                id: 'task_abc123',
                status: 'processing',
                message: '正在解析 PDF...',
                progress_percent: 50
            };
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => mockResult
            });

            const result = await client.getIndexStatus('task_abc123');

            expect(result.status).toBe('processing');
            expect(result.progress_percent).toBe(50);
        });
    });

    describe('getTaskProgress', () => {
        it('should get task progress', async () => {
            const mockResult = {
                id: 'task_abc123',
                status: 'processing',
                current_step: 'parse_pdf',
                progress_percent: 60,
                total_steps: 9,
                completed_steps: 5
            };
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => mockResult
            });

            const result = await client.getTaskProgress('task_abc123');

            expect(result.current_step).toBe('parse_pdf');
            expect(result.progress_percent).toBe(60);
        });
    });

    describe('cancelTask', () => {
        it('should cancel task', async () => {
            const mockResult = {
                status: 'success',
                message: '任务已取消',
                task_id: 'task_abc123',
                current_status: 'cancelled'
            };
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => mockResult
            });

            const result = await client.cancelTask('task_abc123');

            expect(result.status).toBe('success');
            expect(result.current_status).toBe('cancelled');
        });
    });

    describe('deleteIndex', () => {
        it('should delete index successfully', async () => {
            const mockResult = {
                status: 'success',
                message: '索引已删除'
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

describe('File API', () => {
    let client: DeepPDFClient;

    beforeEach(() => {
        client = new DeepPDFClient(8000);
    });

    describe('listFiles', () => {
        it('should list all files', async () => {
            const mockFiles = [
                {
                    file_id: 'f_abc123',
                    file_name: 'doc1.pdf',
                    file_size: 1024000,
                    uploaded_at: '2026-01-15T00:00:00',
                    status: 'uploaded',
                    indexed: true,
                    indexes: ['idx_xyz789']
                }
            ];

            global.fetch = vi.fn().mockResolvedValueOnce({
                ok: true,
                json: async () => ({ status: 'success', files: mockFiles })
            }) as any;

            const result = await client.listFiles();

            expect(result.files).toHaveLength(1);
            expect(result.files[0].file_name).toBe('doc1.pdf');
        });
    });

    describe('getFileInfo', () => {
        it('should get file info', async () => {
            const mockFile = {
                file_id: 'f_abc123',
                file_name: 'doc1.pdf',
                file_size: 1024000,
                uploaded_at: '2026-01-15T00:00:00',
                status: 'uploaded',
                indexed: true,
                indexes: ['idx_xyz789']
            };

            global.fetch = vi.fn().mockResolvedValueOnce({
                ok: true,
                json: async () => ({ status: 'success', file: mockFile })
            }) as any;

            const result = await client.getFileInfo('f_abc123');

            expect(result.file.file_name).toBe('doc1.pdf');
        });
    });

    describe('deleteFile', () => {
        it('should delete file', async () => {
            global.fetch = vi.fn().mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    status: 'success',
                    message: "文件 f_abc123 已成功删除",
                    file_id: 'f_abc123'
                })
            }) as any;

            const result = await client.deleteFile('f_abc123');

            expect(result.status).toBe('success');
        });
    });
});

describe('Config API', () => {
    let client: DeepPDFClient;

    beforeEach(() => {
        client = new DeepPDFClient(8000);
    });

    describe('listConfigs', () => {
        it('should list all configs', async () => {
            const mockConfigs = [
                {
                    name: 'config1',
                    description: '配置 1',
                    is_default: true,
                    llm: { provider: 'deepseek', model: 'deepseek-chat' },
                    indexing: { max_pages_per_node: 10, max_tokens_per_node: 20000, toc_check_pages: 20, if_add_node_summary: true, if_add_node_text: false }
                }
            ];

            global.fetch = vi.fn().mockResolvedValueOnce({
                ok: true,
                json: async () => ({ status: 'success', configs: mockConfigs })
            }) as any;

            const result = await client.listConfigs();

            expect(result.configs).toHaveLength(1);
            expect(result.configs[0].name).toBe('config1');
        });
    });

    describe('getDefaultConfig', () => {
        it('should get default config', async () => {
            const mockConfig = {
                name: 'default',
                is_default: true,
                llm: { provider: 'deepseek', model: 'deepseek-chat' },
                indexing: { max_pages_per_node: 10, max_tokens_per_node: 20000, toc_check_pages: 20, if_add_node_summary: true, if_add_node_text: false }
            };

            global.fetch = vi.fn().mockResolvedValueOnce({
                ok: true,
                json: async () => ({ status: 'success', config: mockConfig })
            }) as any;

            const result = await client.getDefaultConfig();

            expect(result.config?.name).toBe('default');
        });
    });

    describe('createConfig', () => {
        it('should create config', async () => {
            const newConfig = {
                name: 'new-config',
                is_default: false,
                llm: { provider: 'deepseek', model: 'deepseek-chat' },
                indexing: { max_pages_per_node: 10, max_tokens_per_node: 20000, toc_check_pages: 20, if_add_node_summary: true, if_add_node_text: false }
            };

            global.fetch = vi.fn().mockResolvedValueOnce({
                ok: true,
                json: async () => ({ status: 'success', config: newConfig, message: 'Configuration created' })
            }) as any;

            const result = await client.createConfig(newConfig);

            expect(result.config?.name).toBe('new-config');
        });
    });

    describe('setDefaultConfig', () => {
        it('should set default config', async () => {
            global.fetch = vi.fn().mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    status: 'success',
                    config: { name: 'my-config', is_default: true, llm: { provider: 'deepseek', model: 'deepseek-chat' }, indexing: { max_pages_per_node: 10, max_tokens_per_node: 20000, toc_check_pages: 20, if_add_node_summary: true, if_add_node_text: false } },
                    message: 'Configuration set as default'
                })
            }) as any;

            const result = await client.setDefaultConfig('my-config');

            expect(result.config?.is_default).toBe(true);
        });
    });
});
