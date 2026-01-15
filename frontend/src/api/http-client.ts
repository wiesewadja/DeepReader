/**
 * DeepPDF HTTP 客户端
 * 替代原有的 MCP Client
 */

export interface IndexPDFResult {
  status: string;
  index_id?: string;
  node_count?: number;
  pdf_name?: string;
  indexing_method?: string;
  error?: string;
}

export interface QueryPDFResult {
  status: string;
  results: Array<{
    text: string;
    metadata: {
      section: string;
      page: number;
      distance?: number;
      start_index?: number;
      end_index?: number;
      node_name?: string;
      node_id?: string;
    };
  }>;
}

export interface IndexListItem {
  id: string;
  pdf_name: string;
  node_count: number;
  created_at: string;
}

export interface ListIndexesResult {
  status: string;
  indexes: IndexListItem[];
}

export interface DeleteIndexResult {
  status: string;
  message?: string;
}

export class DeepPDFClient {
  private baseUrl: string;
  private readonly DEFAULT_PORT = 8000;

  constructor(port?: number) {
    this.baseUrl = `http://localhost:${port || this.DEFAULT_PORT}`;
  }

  /**
   * 健康检查
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      const data = await response.json();
      return data.status === 'ok';
    } catch {
      return false;
    }
  }

  /**
   * 创建 PDF 索引
   */
  async indexPDF(pdfPath: string): Promise<IndexPDFResult> {
    const response = await fetch(`${this.baseUrl}/api/index`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: pdfPath })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.detail || 'Index creation failed');
    }

    return response.json();
  }

  /**
   * 查询 PDF
   */
  async queryPDF(query: string, indexId: string): Promise<QueryPDFResult> {
    const response = await fetch(`${this.baseUrl}/api/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, index_id: indexId })
    });

    if (!response.ok) {
      throw new Error('Query failed');
    }

    return response.json();
  }

  /**
   * 列出所有索引
   */
  async listIndexes(): Promise<ListIndexesResult> {
    const response = await fetch(`${this.baseUrl}/api/indexes`);
    return response.json();
  }

  /**
   * 删除索引
   */
  async deleteIndex(indexId: string): Promise<DeleteIndexResult> {
    const response = await fetch(`${this.baseUrl}/api/indexes/${indexId}`, {
      method: 'DELETE'
    });
    return response.json();
  }
}
