#!/usr/bin/env python3
"""Scope Search Test Script"""

import requests
import sys
import time
from pathlib import Path

API_BASE = "http://localhost:6088/api"
HEALTH_URL = "http://localhost:6088/health"

def test_health():
    print("\n" + "="*50)
    print("1. Test Backend Health")
    print("="*50)
    try:
        resp = requests.get(HEALTH_URL, timeout=10)
        data = resp.json()
        print(f"   Status: {data}")
        return resp.status_code == 200 and data.get("status") == "ok"
    except Exception as e:
        print(f"   Failed: {e}")
        return False

def list_indexes():
    print("\n" + "="*50)
    print("2. List Indexes")
    print("="*50)
    resp = requests.get(f"{API_BASE}/indexes")
    data = resp.json()
    indexes = data.get("indexes", [])
    print(f"   Found {len(indexes)} indexes:")
    for idx in indexes[:5]:
        print(f"   - {idx.get('pdf_name', 'Unknown')} (index_id: {idx.get('index_id', 'N/A')})")
    return indexes

def get_toc(index_id):
    print("\n   Getting TOC...")
    resp = requests.get(f"{API_BASE}/reading/{index_id}/toc/flat")
    if resp.status_code != 200:
        print(f"   Failed: {resp.status_code}")
        return None
    data = resp.json()
    toc = data.get("toc", [])
    print(f"   Found {len(toc)} level-1 sections")
    for section in toc[:3]:
        level1 = section.get("level_1", "Unknown")
        node_id = section.get("node_id", "N/A")
        print(f"   - {level1} (node_id: {node_id})")
    return toc

def query_test(index_id, query, scope_node_ids=None):
    print(f"\n   Query: '{query}'")
    if scope_node_ids:
        print(f"   Scope: {scope_node_ids}")

    payload = {
        "query": query,
        "index_id": index_id,
        "max_results": 5
    }
    if scope_node_ids:
        payload["scope_node_ids"] = scope_node_ids

    resp = requests.post(f"{API_BASE}/query", json=payload)
    data = resp.json()

    if data.get("status") != "success":
        print(f"   Query failed: {data.get('error', 'Unknown error')}")
        return None

    results = data.get("results", [])
    print(f"   Returned {len(results)} results")

    paragraph_count = 0
    section_count = 0

    for i, r in enumerate(results):
        metadata = r.get("metadata", {})
        result_type = metadata.get("type", "section")
        block_id = metadata.get("block_id")
        parent_node_id = metadata.get("parent_node_id")

        if result_type == "paragraph":
            paragraph_count += 1
            print(f"   [{i+1}] PARAGRAPH | block_id: {block_id} | parent: {parent_node_id}")
        else:
            section_count += 1
            node_id = metadata.get("node_id", "N/A")
            print(f"   [{i+1}] SECTION | node_id: {node_id}")

        text = r.get("text", "")
        preview = text[:60].replace("\n", " ") + "..." if len(text) > 60 else text.replace("\n", " ")
        print(f"       Preview: {preview}")

    print(f"\n   Stats: {section_count} sections + {paragraph_count} paragraphs")
    return data

def create_index(file_path):
    """Create a new index from file"""
    print("\n" + "="*50)
    print("Creating New Index")
    print("="*50)

    file_path = Path(file_path)
    if not file_path.exists():
        print(f"   File not found: {file_path}")
        return None

    print(f"   File: {file_path.name}")

    with open(file_path, "rb") as f:
        resp = requests.post(
            f"{API_BASE}/index",
            files={"file": (file_path.name, f)},
            data={"doc_type": "epub" if file_path.suffix.lower() == ".epub" else "pdf"}
        )

    if resp.status_code not in [200, 201]:
        print(f"   Failed to create index: {resp.status_code}")
        print(f"   Response: {resp.text}")
        return None

    data = resp.json()
    index_id = data.get("index_id") or data.get("task_id")
    print(f"   Index ID: {index_id}")

    # Wait for indexing to complete
    print("   Waiting for indexing to complete...")
    max_wait = 300  # 5 minutes
    start_time = time.time()

    while time.time() - start_time < max_wait:
        resp = requests.get(f"{API_BASE}/indexes/{index_id}")
        if resp.status_code == 200:
            data = resp.json()
            status = data.get("status")
            if status == "completed":
                print(f"   Indexing completed!")
                return index_id
            elif status == "failed":
                print(f"   Indexing failed: {data.get('error')}")
                return None
            else:
                progress = data.get("progress", 0)
                message = data.get("message", "")
                print(f"   Progress: {progress}% - {message}")
        time.sleep(3)

    print("   Timeout waiting for indexing")
    return None

def main():
    print("\n" + "="*60)
    print("Scope Search Test")
    print("="*60)

    # Parse arguments
    index_id = None
    file_path = None

    args = sys.argv[1:]
    i = 0
    while i < len(args):
        if args[i] == "--index-id" and i + 1 < len(args):
            index_id = args[i + 1]
            i += 2
        elif args[i] == "--file" and i + 1 < len(args):
            file_path = args[i + 1]
            i += 2
        else:
            i += 1

    # 1. Health check
    if not test_health():
        print("Backend service unavailable")
        return

    # Create index if file provided
    if file_path:
        index_id = create_index(file_path)
        if not index_id:
            print("Failed to create index")
            return

    # 2. Get or list indexes
    if not index_id:
        indexes = list_indexes()
        if not indexes:
            print("\nNo indexes available. Use --file to create a new index.")
            print("Example: uv run python test_scope_search.py --file /path/to/book.epub")
            return
        index_id = indexes[0].get("index_id")
        print(f"\n   Using index: {indexes[0].get('pdf_name')} ({index_id})")

    # 3. Get TOC
    toc = get_toc(index_id)

    # 4. Full search
    print("\n" + "="*50)
    print("3. Full Search Test")
    print("="*50)

    query = "analysis reading key points"
    full_result = query_test(index_id, query)

    # 5. Scoped search
    if toc and len(toc) > 0:
        print("\n" + "="*50)
        print("4. Scoped Search Test")
        print("="*50)

        first_section = toc[0]
        scope_node_id = first_section.get("node_id")

        if scope_node_id:
            print(f"\n   Scope: {first_section.get('level_1')}")
            scoped_result = query_test(index_id, query, scope_node_ids=[scope_node_id])

            if scoped_result:
                results = scoped_result.get("results", [])
                paragraph_results = [
                    r for r in results
                    if r.get("metadata", {}).get("type") == "paragraph"
                ]

                if paragraph_results:
                    all_in_scope = all(
                        r.get("metadata", {}).get("parent_node_id") == scope_node_id
                        for r in paragraph_results
                    )
                    if all_in_scope:
                        print(f"\n   Scope verification PASSED: all paragraphs in scope")
                    else:
                        print(f"\n   Scope verification FAILED: some paragraphs out of scope")
                else:
                    print(f"\n   No paragraph results")

    print("\n" + "="*60)
    print("Test Complete")
    print("="*60)

if __name__ == "__main__":
    main()
