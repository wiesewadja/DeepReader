

# ==================== 导出相关端点 ====================

@router.get("/export/{index_id}", response_model=ExportIndexResponse)
async def export_index_endpoint(index_id: str):
    """
    导出索引的节点数据,供前端生成 Markdown 文件
    
    返回所有节点的数据,包括文本内容、章节信息、页码范围等
    """
    logger.info(f"[API] 收到导出请求: index_id='{index_id}'")
    result = await export_index_data(index_id)
    logger.info(f"[API] 导出完成: 返回 {len(result.get('nodes', []))} 个节点")
    return ExportIndexResponse(**result)


@router.post("/markdown-mapping/{index_id}", response_model=SaveMarkdownMappingResponse)
async def save_markdown_mapping_endpoint(index_id: str, req: SaveMarkdownMappingRequest):
    """
    保存 Markdown 文件映射到索引元数据
    
    前端导出 Markdown 文件后,调用此接口保存文件路径映射
    """
    logger.info(f"[API] 收到保存映射请求: index_id='{index_id}', files={len(req.file_mapping)}")
    result = await save_markdown_mapping(index_id, req.file_mapping)
    logger.info(f"[API] 映射保存完成")
    return SaveMarkdownMappingResponse(**result)
