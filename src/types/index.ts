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
 * 索引进度步骤配置
 *
 * 进度流程说明（后端 indexer.py + pageindex-lib）：
 * 0-10%:   验证文件 (validate_pdf)
 * 10-15%:  检测 PDF 视觉类型 (detect_visual) - 仅 PDF
 * 15-30%:  检查 LLM 配置 (check_llm_config)
 * 30-40%:  初始化 PageIndex 配置 (init_pageindex)
 * 40-50%:  创建 LLM 客户端 (create_llm_client)
 * 50-55%:  加载文档 (parsing_pdf)
 * 55-60%:  检测目录 + 生成目录结构 (detecting_toc, generating_toc_*)
 * 60-85%:  生成摘要 (generating_summaries) - 最耗时的步骤
 * 85-90%:  存储向量数据 (store_vectors)
 * 90-95%:  保存元数据 (save_metadata)
 * 95-100%: 完成 (complete)
 */
export const STEP_CONFIG: Record<string, { label: string; icon: string; minPercent: number; maxPercent: number }> = {
    // === 后端 indexer.py 直接控制的步骤 (0-50%) ===
    "start": { label: "任务开始", icon: "🚀", minPercent: 0, maxPercent: 5 },
    "validate_pdf": { label: "验证文件", icon: "📁", minPercent: 5, maxPercent: 10 },
    "detect_visual": { label: "检测文档类型", icon: "🔍", minPercent: 10, maxPercent: 15 },
    "check_llm_config": { label: "检查 LLM 配置", icon: "🔑", minPercent: 15, maxPercent: 20 },
    "init_pageindex": { label: "初始化索引配置", icon: "⚙️", minPercent: 20, maxPercent: 30 },
    "create_llm_client": { label: "连接 LLM 服务", icon: "🔌", minPercent: 30, maxPercent: 40 },

    // === 文档加载阶段 (40-55%) ===
    "parse_pdf": { label: "开始解析文档", icon: "📄", minPercent: 40, maxPercent: 50 },
    "parsing_pdf": { label: "加载文档内容", icon: "📖", minPercent: 50, maxPercent: 55 },

    // === pageindex-lib 目录检测阶段 (55-60%) ===
    "detecting_toc": { label: "检测文档目录", icon: "🔍", minPercent: 55, maxPercent: 56 },
    "generating_toc_init": { label: "生成初始目录", icon: "📋", minPercent: 56, maxPercent: 58 },
    "generating_toc_continue": { label: "完善目录结构", icon: "📑", minPercent: 58, maxPercent: 60 },

    // === 结构解析和文本添加 (60-65%) ===
    "structure_parsed": { label: "结构解析完成", icon: "📊", minPercent: 60, maxPercent: 62 },
    "adding_ids": { label: "添加节点标识", icon: "🏷️", minPercent: 62, maxPercent: 63 },
    "adding_text": { label: "提取节点文本", icon: "📝", minPercent: 63, maxPercent: 65 },

    // === 摘要生成阶段 (60-85%) - 最耗时 ===
    "generating_summaries": { label: "生成章节摘要", icon: "✍️", minPercent: 65, maxPercent: 85 },
    "summaries_complete": { label: "摘要生成完成", icon: "✅", minPercent: 85, maxPercent: 87 },

    // === 解析完成 (85%) ===
    "parse_complete": { label: "文档解析完成", icon: "🎉", minPercent: 85, maxPercent: 87 },

    // === 存储阶段 (85-95%) ===
    "store_vectors": { label: "存储向量数据", icon: "🗄️", minPercent: 87, maxPercent: 90 },
    "save_metadata": { label: "保存索引元数据", icon: "💾", minPercent: 90, maxPercent: 95 },

    // === 完成 (95-100%) ===
    "complete": { label: "索引创建完成", icon: "🎊", minPercent: 95, maxPercent: 100 },
    "completed": { label: "索引创建完成", icon: "🎊", minPercent: 95, maxPercent: 100 },

    // === 兼容旧的步骤名称 ===
    "store_chromadb": { label: "存储向量数据", icon: "🗄️", minPercent: 70, maxPercent: 90 },
    "parsing_structure": { label: "解析文档结构", icon: "📊", minPercent: 55, maxPercent: 60 },
    "saving_metadata": { label: "保存元数据", icon: "💾", minPercent: 90, maxPercent: 95 },
};
