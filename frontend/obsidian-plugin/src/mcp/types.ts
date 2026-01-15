/** MCP 工具定义 */
export interface MCPTool {
    name: string;
    description: string;
    inputSchema: {
        type: string;
        properties: Record<string, unknown>;
        required?: string[];
    };
}

/** 索引 PDF 结果 */
export interface IndexPDFResult {
    status: "success" | "error";
    index_id?: string;
    node_count?: number;
    pdf_name?: string;
    error?: string;
}

/** 查询结果项 */
export interface QueryResultItem {
    id: string;
    text: string;
    metadata: {
        pdf_name: string;
        page: number;
        [key: string]: unknown;
    };
    distance?: number;
}

/** 查询 PDF 结果 */
export interface QueryPDFResult {
    status: "success" | "error";
    query?: string;
    results?: QueryResultItem[];
    index_info?: {
        pdf_name: string;
        node_count: number;
    };
    error?: string;
}

/** 索引信息 */
export interface IndexInfo {
    id: string;
    pdf_name: string;
    created_at: string;
    node_count: number;
}

/** 列出索引结果 */
export interface ListIndexesResult {
    status: "success" | "error";
    indexes?: IndexInfo[];
    error?: string;
}

/** 删除索引结果 */
export interface DeleteIndexResult {
    status: "success" | "error";
    message?: string;
    error?: string;
}
