#!/usr/bin/env python
"""
测试智能检索功能
"""
import json
import sys
import os

# 添加路径
sys.path.insert(0, 'deeppdf-api/deeppdf/src')
sys.path.insert(0, 'deeppdf-api/src')

from deeppdf.services.smart_search import TreeSearchEngine, hybrid_search

# 加载测试数据（使用已有的索引元数据）
test_metadata_path = "deeppdf-api/data/indexes/idx_1b671ee0d703.json"

if not os.path.exists(test_metadata_path):
    print(f"错误: 测试数据不存在 {test_metadata_path}")
    print("请先创建一个索引")
    sys.exit(1)

with open(test_metadata_path, "r", encoding="utf-8") as f:
    test_metadata = json.load(f)

print("=" * 60)
print("智能检索测试")
print("=" * 60)
print(f"PDF: {test_metadata.get('pdf_name')}")
print(f"节点数: {test_metadata.get('node_count')}")
print()

# 初始化搜索引擎
tree_structure = test_metadata.get("tree_structure", {})
engine = TreeSearchEngine(tree_structure)

# 测试查询
test_queries = [
    "Transformer",
    "attention",
    "什么是编码器",
    "self-attention",
    "positional encoding"
]

for query in test_queries:
    print(f"\n查询: '{query}'")
    print("-" * 60)

    # 1. 标题匹配
    title_results = engine.search_by_title(query, threshold=0.3)
    print(f"标题匹配: {len(title_results)} 个结果")
    for i, result in enumerate(title_results[:3]):
        print(f"  [{i+1}] {result['path']} (score: {result['score']:.3f})")

    # 2. 关键点匹配
    key_point_results = engine.search_by_key_points(query, threshold=0.3)
    print(f"关键点匹配: {len(key_point_results)} 个结果")
    for i, result in enumerate(key_point_results[:3]):
        point_preview = result['matched_point'][:80]
        print(f"  [{i+1}] {point_preview}... (score: {result['score']:.3f})")

# 测试混合检索
print("\n" + "=" * 60)
print("混合检索测试")
print("=" * 60)

# 模拟向量搜索结果
mock_vector_results = [
    {
        "text": "This is about attention mechanisms...",
        "metadata": {
            "section": "Model Architecture > Attention",
            "node_name": "Attention",
            "node_id": "0005",
            "distance": 0.8
        }
    },
    {
        "text": "Positional encoding injects position information...",
        "metadata": {
            "section": "Model Architecture > Positional Encoding",
            "node_name": "Positional Encoding",
            "node_id": "0011",
            "distance": 0.6
        }
    }
]

query = "attention mechanism"
print(f"\n查询: '{query}'")
print(f"向量结果数: {len(mock_vector_results)}")

hybrid_result = hybrid_search(
    query=query,
    index_metadata=test_metadata,
    vector_results=mock_vector_results,
    max_results=5
)

print(f"检索方法: {hybrid_result['method']}")
print(f"最终结果数: {len(hybrid_result['results'])}")
print("\nTop 3 结果:")
for i, result in enumerate(hybrid_result['results'][:3]):
    match_type = result['metadata'].get('match_type', 'unknown')
    score = result['metadata'].get('score', 0)
    text_preview = result['text'][:100].replace('\n', ' ')
    print(f"  [{i+1}] type={match_type}, score={score:.3f}")
    print(f"      {text_preview}...")

print("\n✓ 测试完成")
