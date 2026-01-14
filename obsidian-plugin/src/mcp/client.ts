import { ChildProcess } from "child_process";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
    IndexPDFResult,
    QueryPDFResult,
    ListIndexesResult,
    DeleteIndexResult
} from "./types.js";

export class MCPClient {
    private client: Client | null = null;
    private transport: StdioClientTransport | null = null;
    private _isConnected: boolean = false;

    constructor(public readonly serverPath: string) {}

    get isConnected(): boolean {
        return this._isConnected;
    }

    async connect(): Promise<void> {
        if (this._isConnected) {
            return;
        }

        try {
            // 创建传输层 - StdioClientTransport 会自动启动进程
            // 注意：serverPath 应该是包含 MCP 服务器的目录
            // 我们通过修改环境变量来设置工作目录
            this.transport = new StdioClientTransport({
                command: "sh",
                args: [
                    "-c",
                    `cd "${this.serverPath}" && uv run python -m deeppdf.server`
                ]
            });

            // 启动传输
            await this.transport.start();

            // 创建 MCP 客户端
            this.client = new Client({
                name: "obsidian-deeppdf",
                version: "0.1.0"
            }, {
                capabilities: {}
            });

            // 连接
            await this.client.connect(this.transport);
            this._isConnected = true;

        } catch (error) {
            this.disconnect();
            throw new Error(`Failed to connect to MCP server: ${error}`);
        }
    }

    async disconnect(): Promise<void> {
        const errors: Error[] = [];

        // 清理 client
        if (this.client) {
            try {
                this.client.close();
                this.client = null;
            } catch (error) {
                errors.push(new Error(`Failed to close MCP client: ${error}`));
            }
        }

        // 清理 transport
        if (this.transport) {
            try {
                await this.transport.close();
                this.transport = null;
            } catch (error) {
                errors.push(new Error(`Failed to close transport: ${error}`));
            }
        }

        this._isConnected = false;

        // 如果有错误，抛出聚合错误
        if (errors.length > 0) {
            throw new Error(`Errors during disconnect: ${errors.map(e => e.message).join('; ')}`);
        }
    }

    async indexPDF(pdfPath: string): Promise<IndexPDFResult> {
        if (!this._isConnected || !this.client) {
            throw new Error("Not connected to MCP server");
        }

        const result = await this.client.callTool({
            name: "index_pdf",
            arguments: {
                path: pdfPath
            }
        });

        // 解析返回的文本内容
        const content = Array.isArray(result.content) ? result.content[0] : result.content;
        if (content && typeof content === "object" && "type" in content && content.type === "text" && "text" in content) {
            try {
                return JSON.parse(content.text as string);
            } catch (error) {
                throw new Error(`Failed to parse MCP server response: ${error}`);
            }
        }

        throw new Error("Invalid response from MCP server");
    }

    async queryPDF(query: string, indexId: string): Promise<QueryPDFResult> {
        if (!this._isConnected || !this.client) {
            throw new Error("Not connected to MCP server");
        }

        const result = await this.client.callTool({
            name: "query_pdf",
            arguments: {
                query,
                index_id: indexId
            }
        });

        const content = Array.isArray(result.content) ? result.content[0] : result.content;
        if (content && typeof content === "object" && "type" in content && content.type === "text" && "text" in content) {
            try {
                return JSON.parse(content.text as string);
            } catch (error) {
                throw new Error(`Failed to parse MCP server response: ${error}`);
            }
        }

        throw new Error("Invalid response from MCP server");
    }

    async listIndexes(): Promise<ListIndexesResult> {
        if (!this._isConnected || !this.client) {
            throw new Error("Not connected to MCP server");
        }

        const result = await this.client.callTool({
            name: "list_indexes",
            arguments: {}
        });

        const content = Array.isArray(result.content) ? result.content[0] : result.content;
        if (content && typeof content === "object" && "type" in content && content.type === "text" && "text" in content) {
            try {
                return JSON.parse(content.text as string);
            } catch (error) {
                throw new Error(`Failed to parse MCP server response: ${error}`);
            }
        }

        throw new Error("Invalid response from MCP server");
    }

    async deleteIndex(indexId: string): Promise<DeleteIndexResult> {
        if (!this._isConnected || !this.client) {
            throw new Error("Not connected to MCP server");
        }

        const result = await this.client.callTool({
            name: "delete_index",
            arguments: {
                index_id: indexId
            }
        });

        const content = Array.isArray(result.content) ? result.content[0] : result.content;
        if (content && typeof content === "object" && "type" in content && content.type === "text" && "text" in content) {
            try {
                return JSON.parse(content.text as string);
            } catch (error) {
                throw new Error(`Failed to parse MCP server response: ${error}`);
            }
        }

        throw new Error("Invalid response from MCP server");
    }
}
