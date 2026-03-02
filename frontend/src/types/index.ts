/**
 * DeepPDF - 类型定义
 */

export interface TaskProgress {
    id: string;
    status: "pending" | "processing" | "completed" | "failed" | "cancelled";
    message: string;
    pdf_name?: string;
    current_step?: string;
    progress_percent?: number;
    total_steps?: number;
    completed_steps?: number;
    error?: string;
}

/**
 * 搜索过滤条件
 */
export interface SearchFilters {
    booklists: string[];
    tags: string[];
}

/**
 * 跨书籍搜索事件参数
 */
export interface CrossBookSearchParams {
    booklists?: string[];
    tags?: string[];
}

export const STEP_CONFIG: Record<string, { label: string; icon: string; minPercent: number; maxPercent: number }> = {
    "start": { label: "任务开始", icon: "🚀", minPercent: 0, maxPercent: 5 },
    "init_pageindex": { label: "初始化索引配置", icon: "⚙️", minPercent: 5, maxPercent: 30 },
    "create_llm_client": { label: "连接 LLM 服务", icon: "🔌", minPercent: 30, maxPercent: 40 },
    "parse_pdf": { label: "解析 PDF", icon: "📄", minPercent: 40, maxPercent: 70 },
    "store_chromadb": { label: "存储向量数据", icon: "🗄️", minPercent: 70, maxPercent: 90 },
    "save_metadata": { label: "保存元数据", icon: "💾", minPercent: 90, maxPercent: 95 },
    "completed": { label: "完成", icon: "✅", minPercent: 95, maxPercent: 100 }
};
