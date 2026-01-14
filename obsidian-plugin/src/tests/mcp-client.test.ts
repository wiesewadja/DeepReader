import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MCPClient } from '../mcp/client';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

// Mock MCP SDK
vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
    Client: vi.fn().mockImplementation(() => ({
        connect: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        callTool: vi.fn()
    }))
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
    StdioClientTransport: vi.fn().mockImplementation(() => ({
        start: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined)
    }))
}));

describe('MCPClient', () => {
    let client: MCPClient;
    let mockClient: any;
    let mockTransport: any;

    beforeEach(() => {
        client = new MCPClient('/fake/path');
        // 获取 mock 实例
        mockClient = new Client({ name: 'test', version: '1.0.0' }, { capabilities: {} });
        mockTransport = new StdioClientTransport({ command: 'test' });
    });

    afterEach(async () => {
        try {
            await client.disconnect();
        } catch {
            // 忽略 disconnect 中的错误
        }
        vi.clearAllMocks();
    });

    describe('构造函数和基本属性', () => {
        it('should create client instance', () => {
            expect(client).toBeDefined();
            expect(client.isConnected).toBe(false);
        });

        it('should have correct server path', () => {
            expect(client.serverPath).toBe('/fake/path');
        });
    });

    describe('connect()', () => {
        it('should successfully connect to MCP server', async () => {
            await client.connect();

            expect(StdioClientTransport).toHaveBeenCalledWith({
                command: 'sh',
                args: ['-c', 'cd "/fake/path" && uv run python -m deeppdf.server']
            });
            expect(Client).toHaveBeenCalledWith({
                name: 'obsidian-deeppdf',
                version: '0.1.0'
            }, { capabilities: {} });
            expect(client.isConnected).toBe(true);
        });

        it('should not connect again if already connected', async () => {
            await client.connect();
            const transportCallsBefore = (StdioClientTransport as any).mock.calls.length;

            await client.connect(); // 第二次连接
            const transportCallsAfter = (StdioClientTransport as any).mock.calls.length;

            expect(transportCallsAfter).toBe(transportCallsBefore);
            expect(client.isConnected).toBe(true);
        });

        it('should handle connection errors and clean up resources', async () => {
            (StdioClientTransport as any).mockImplementationOnce(() => ({
                start: vi.fn().mockRejectedValue(new Error('Connection failed')),
                close: vi.fn().mockResolvedValue(undefined)
            }));

            await expect(client.connect()).rejects.toThrow('Failed to connect to MCP server');
            expect(client.isConnected).toBe(false);
        });
    });

    describe('disconnect()', () => {
        it('should disconnect when connected', async () => {
            await client.connect();
            expect(client.isConnected).toBe(true);

            await client.disconnect();
            expect(client.isConnected).toBe(false);
        });

        it('should handle disconnect when not connected', async () => {
            await expect(client.disconnect()).resolves.not.toThrow();
            expect(client.isConnected).toBe(false);
        });

        it('should handle errors during disconnect gracefully', async () => {
            await client.connect();

            // Mock close methods to throw errors
            const clientInstance = (client as any).client;
            const transportInstance = (client as any).transport;

            clientInstance.close = vi.fn().mockImplementation(() => {
                throw new Error('Client close failed');
            });
            transportInstance.close = vi.fn().mockImplementation(() => {
                throw new Error('Transport close failed');
            });

            // Should throw aggregated error
            await expect(client.disconnect()).rejects.toThrow('Errors during disconnect');

            // Should still set isConnected to false
            expect(client.isConnected).toBe(false);
        });
    });

    describe('工具方法 - 未连接状态', () => {
        it('indexPDF() should throw when not connected', async () => {
            await expect(client.indexPDF('/path/to/file.pdf')).rejects.toThrow(
                'Not connected to MCP server'
            );
        });

        it('queryPDF() should throw when not connected', async () => {
            await expect(client.queryPDF('test query', 'index-123')).rejects.toThrow(
                'Not connected to MCP server'
            );
        });

        it('listIndexes() should throw when not connected', async () => {
            await expect(client.listIndexes()).rejects.toThrow(
                'Not connected to MCP server'
            );
        });

        it('deleteIndex() should throw when not connected', async () => {
            await expect(client.deleteIndex('index-123')).rejects.toThrow(
                'Not connected to MCP server'
            );
        });
    });

    describe('indexPDF()', () => {
        beforeEach(async () => {
            await client.connect();
        });

        it('should successfully index a PDF', async () => {
            const mockResult = {
                index_id: 'test-index-123',
                filename: 'test.pdf',
                status: 'completed',
                chunks: 10
            };

            // 设置 mock 返回值
            mockClient.callTool = vi.fn().mockResolvedValue({
                content: [{ type: 'text', text: JSON.stringify(mockResult) }]
            });

            // 我们需要直接访问私有的 client 实例来设置 mock
            const clientInstance = (client as any).client;
            clientInstance.callTool = mockClient.callTool;

            const result = await client.indexPDF('/path/to/file.pdf');

            expect(result).toEqual(mockResult);
            expect(clientInstance.callTool).toHaveBeenCalledWith({
                name: 'index_pdf',
                arguments: { path: '/path/to/file.pdf' }
            });
        });

        it('should handle single content item response', async () => {
            const mockResult = { index_id: 'test-123' };
            const clientInstance = (client as any).client;
            clientInstance.callTool = vi.fn().mockResolvedValue({
                content: { type: 'text', text: JSON.stringify(mockResult) }
            });

            const result = await client.indexPDF('/path/to/file.pdf');
            expect(result).toEqual(mockResult);
        });

        it('should throw on invalid response format', async () => {
            const clientInstance = (client as any).client;
            clientInstance.callTool = vi.fn().mockResolvedValue({
                content: [{ type: 'image', data: 'base64...' }]
            });

            await expect(client.indexPDF('/path/to/file.pdf')).rejects.toThrow(
                'Invalid response from MCP server'
            );
        });

        it('should throw on response without text', async () => {
            const clientInstance = (client as any).client;
            clientInstance.callTool = vi.fn().mockResolvedValue({
                content: [{ type: 'text' }]
            });

            await expect(client.indexPDF('/path/to/file.pdf')).rejects.toThrow(
                'Invalid response from MCP server'
            );
        });

        it('should throw on JSON parse error', async () => {
            const clientInstance = (client as any).client;
            clientInstance.callTool = vi.fn().mockResolvedValue({
                content: [{ type: 'text', text: 'invalid json' }]
            });

            await expect(client.indexPDF('/path/to/file.pdf')).rejects.toThrow(
                'Failed to parse MCP server response'
            );
        });
    });

    describe('queryPDF()', () => {
        beforeEach(async () => {
            await client.connect();
        });

        it('should successfully query a PDF index', async () => {
            const mockResult = {
                results: [
                    { page: 1, content: 'test content', score: 0.95 }
                ],
                query: 'test query'
            };

            const clientInstance = (client as any).client;
            clientInstance.callTool = vi.fn().mockResolvedValue({
                content: [{ type: 'text', text: JSON.stringify(mockResult) }]
            });

            const result = await client.queryPDF('test query', 'index-123');

            expect(result).toEqual(mockResult);
            expect(clientInstance.callTool).toHaveBeenCalledWith({
                name: 'query_pdf',
                arguments: { query: 'test query', index_id: 'index-123' }
            });
        });

        it('should handle invalid response', async () => {
            const clientInstance = (client as any).client;
            clientInstance.callTool = vi.fn().mockResolvedValue({
                content: [{ type: 'unknown' }]
            });

            await expect(client.queryPDF('test', 'index-123')).rejects.toThrow(
                'Invalid response from MCP server'
            );
        });

        it('should throw on JSON parse error', async () => {
            const clientInstance = (client as any).client;
            clientInstance.callTool = vi.fn().mockResolvedValue({
                content: [{ type: 'text', text: 'invalid json' }]
            });

            await expect(client.queryPDF('test', 'index-123')).rejects.toThrow(
                'Failed to parse MCP server response'
            );
        });
    });

    describe('listIndexes()', () => {
        beforeEach(async () => {
            await client.connect();
        });

        it('should successfully list all indexes', async () => {
            const mockResult = {
                indexes: [
                    { index_id: 'index-1', filename: 'file1.pdf', created_at: '2024-01-01' },
                    { index_id: 'index-2', filename: 'file2.pdf', created_at: '2024-01-02' }
                ],
                total: 2
            };

            const clientInstance = (client as any).client;
            clientInstance.callTool = vi.fn().mockResolvedValue({
                content: [{ type: 'text', text: JSON.stringify(mockResult) }]
            });

            const result = await client.listIndexes();

            expect(result).toEqual(mockResult);
            expect(clientInstance.callTool).toHaveBeenCalledWith({
                name: 'list_indexes',
                arguments: {}
            });
        });

        it('should handle invalid response', async () => {
            const clientInstance = (client as any).client;
            clientInstance.callTool = vi.fn().mockResolvedValue({
                content: 'invalid'
            });

            await expect(client.listIndexes()).rejects.toThrow(
                'Invalid response from MCP server'
            );
        });

        it('should throw on JSON parse error', async () => {
            const clientInstance = (client as any).client;
            clientInstance.callTool = vi.fn().mockResolvedValue({
                content: [{ type: 'text', text: 'invalid json' }]
            });

            await expect(client.listIndexes()).rejects.toThrow(
                'Failed to parse MCP server response'
            );
        });
    });

    describe('deleteIndex()', () => {
        beforeEach(async () => {
            await client.connect();
        });

        it('should successfully delete an index', async () => {
            const mockResult = {
                index_id: 'index-123',
                deleted: true
            };

            const clientInstance = (client as any).client;
            clientInstance.callTool = vi.fn().mockResolvedValue({
                content: [{ type: 'text', text: JSON.stringify(mockResult) }]
            });

            const result = await client.deleteIndex('index-123');

            expect(result).toEqual(mockResult);
            expect(clientInstance.callTool).toHaveBeenCalledWith({
                name: 'delete_index',
                arguments: { index_id: 'index-123' }
            });
        });

        it('should handle invalid response', async () => {
            const clientInstance = (client as any).client;
            clientInstance.callTool = vi.fn().mockResolvedValue({
                content: [{ type: 'text', text: '' }] // 空文本
            });

            await expect(client.deleteIndex('index-123')).rejects.toThrow(
                'Failed to parse MCP server response'
            );
        });
    });

    describe('资源清理', () => {
        it('should clean up resources on connection failure', async () => {
            const mockTransportWithFailure = {
                start: vi.fn().mockRejectedValue(new Error('Failed to start')),
                close: vi.fn().mockResolvedValue(undefined)
            };

            (StdioClientTransport as any).mockImplementationOnce(() => mockTransportWithFailure);

            await expect(client.connect()).rejects.toThrow();

            // 验证清理被调用
            expect(mockTransportWithFailure.close).toHaveBeenCalled();
            expect(client.isConnected).toBe(false);
        });

        it('should properly disconnect and allow reconnection', async () => {
            // 第一次连接
            await client.connect();
            expect(client.isConnected).toBe(true);

            // 断开
            await client.disconnect();
            expect(client.isConnected).toBe(false);

            // 重新连接应该成功
            await client.connect();
            expect(client.isConnected).toBe(true);
        });
    });
});
