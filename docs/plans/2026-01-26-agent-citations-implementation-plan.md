# Agent 返回结构化引用信息实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让 Agent 返回包含可点击 Obsidian 链接的结构化数据，解决 fast 模式和 Agent 模式的功能差异问题。

**Architecture:** 通过在 Agent 工具返回中增强元数据（markdown_file, page, anchor），让 Agent 生成答案时包含 Obsidian 风格的 `[[link]]` 引用，前端解析并渲染为可点击链接。

**Tech Stack:** Python 3.10+, FastAPI, Pydantic, TypeScript, Obsidian Plugin API

---

## 问题背景

当前系统有两种查询模式：
- **Fast 模式**（已移除）：前端直接调用 LLM，返回带锚点链接的 citations
- **Agent 模式**（当前默认）：后端 Agent 返回纯文本，无定位功能

用户需要在 Agent 模式下也能点击跳转到原文位置。

## 数据流分析

```
索引阶段:
PDF → tree_structure + sections → markdown_files (node_id → .md路径)
                               ↓
                        元数据存储: indexes/{index_id}.json

Agent 工具调用:
hybrid_search → 结果包含 node_id, page, metadata
                ↓
                查找 markdown_files[node_id]
                ↓
                生成 [[path#^page-N]] 链接

前端渲染:
解析 Agent 返回的 [[...]] → 渲染为可点击链接
```

## 关键数据结构

### 索引元数据 (indexes/{index_id}.json)
```json
{
  "pdf_name": "书籍名.pdf",
  "tree_structure": {...},
  "markdown_files": {
    "node_ch1": "DeepPDF/书籍名/第一章.md",
    "node_ch2": "DeepPDF/书籍名/第二章.md"
  }
}
```

### Markdown 文件结构
```markdown
---
pdf_name: 书籍名.pdf
node_id: node_ch1
section: 第一章
page_range: 1-10
---

# 第一章

## 第 1 页 ^page-1
内容...

## 第 5 页 ^page-5
内容...
```

---

## 实施任务

### Task 1: 添加 Markdown 映射查询辅助函数

**目标:** 在 Agent 工具中能够查询 node_id 对应的 Markdown 文件路径。

**Files:**
- Create: `backend/deeppdf-api/src/deeppdf/agent/markdown_locator.py`
- Modify: `backend/deeppdf-api/src/deeppdf/agent/executor.py`

**Step 1: 创建测试文件**

创建: `backend/deeppdf-api/tests/test_markdown_locator.py`

```python
import pytest
from deeppdf.agent.markdown_locator import MarkdownLocator

def test_find_markdown_file():
    """测试查找 Markdown 文件路径"""
    index_metadata = {
        "markdown_files": {
            "node_123": "DeepPDF/书名/第一章.md",
            "node_456": "DeepPDF/书名/第二章.md"
        },
        "pdf_name": "书名.pdf"
    }

    locator = MarkdownLocator(index_metadata)

    # 测试精确匹配
    assert locator.find_file("node_123") == "DeepPDF/书名/第一章.md"
    assert locator.find_file("node_456") == "DeepPDF/书名/第二章.md"

    # 测试未找到
    assert locator.find_file("unknown") is None

def test_generate_obsidian_link():
    """测试生成 Obsidian 链接"""
    index_metadata = {
        "markdown_files": {
            "node_123": "DeepPDF/书名/第一章.md"
        },
        "pdf_name": "书名.pdf"
    }

    locator = MarkdownLocator(index_metadata)

    # 测试页面锚点链接
    link = locator.generate_obsidian_link("node_123", 5)
    assert link == "[[DeepPDF/书名/第一章.md#^page-5]]"

    # 测试无页面锚点
    link_no_page = locator.generate_obsidian_link("node_123", None)
    assert link_no_page == "[[DeepPDF/书名/第一章.md]]"

def test_generate_citation_metadata():
    """测试生成引用元数据"""
    index_metadata = {
        "markdown_files": {
            "node_123": "DeepPDF/书名/第一章.md"
        },
        "pdf_name": "书名.pdf"
    }

    locator = MarkdownLocator(index_metadata)

    metadata = locator.generate_citation_metadata("node_123", 5, "相关内容...")

    assert metadata["markdown_file"] == "DeepPDF/书名/第一章.md"
    assert metadata["page"] == 5
    assert metadata["anchor"] == "^page-5"
    assert metadata["obsidian_link"] == "[[DeepPDF/书名/第一章.md#^page-5]]"
    assert "text" in metadata
```

**Step 2: 运行测试确认失败**

```bash
cd backend/deeppdf-api
uv run pytest tests/test_markdown_locator.py -v
```

Expected: `ModuleNotFoundError: No module named 'deeppdf.agent.markdown_locator'`

**Step 3: 实现 MarkdownLocator 类**

创建: `backend/deeppdf-api/src/deeppdf/agent/markdown_locator.py`

```python
"""
Markdown 定位器 - 查找节点对应的 Markdown 文件并生成 Obsidian 链接
"""
import logging
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)


class MarkdownLocator:
    """
    Markdown 定位器

    提供从 node_id 到 Markdown 文件路径的查询，以及生成 Obsidian 链接的功能。
    """

    def __init__(self, index_metadata: Dict[str, Any]):
        """
        初始化定位器

        Args:
            index_metadata: 索引元数据，必须包含 markdown_files 字段
        """
        self.index_metadata = index_metadata
        self.markdown_files = index_metadata.get("markdown_files", {})
        self.pdf_name = index_metadata.get("pdf_name", "Unknown")

    def find_file(self, node_id: str) -> Optional[str]:
        """
        查找节点对应的 Markdown 文件路径

        Args:
            node_id: 节点 ID

        Returns:
            Markdown 文件相对路径，如 "DeepPDF/书名/第一章.md"
            如果未找到返回 None
        """
        return self.markdown_files.get(node_id)

    def generate_obsidian_link(
        self,
        node_id: str,
        page_num: Optional[int] = None
    ) -> str:
        """
        生成 Obsidian 格式的链接

        Args:
            node_id: 节点 ID
            page_num: 页码（可选），用于生成页面锚点

        Returns:
            Obsidian 链接字符串，如 "[[DeepPDF/书名/第一章.md#^page-5]]"
        """
        markdown_file = self.find_file(node_id)

        if not markdown_file:
            # 如果没有对应的 Markdown 文件，返回 PDF 原文件链接
            return f"[[{self.pdf_name}]]"

        if page_num is not None:
            # 生成带页面锚点的链接
            return f"[[{markdown_file}#^page-{page_num}]]"
        else:
            # 生成不带锚点的链接
            return f"[[{markdown_file}]]"

    def generate_citation_metadata(
        self,
        node_id: str,
        page_num: Optional[int],
        text: str
    ) -> Dict[str, Any]:
        """
        生成完整的引用元数据

        Args:
            node_id: 节点 ID
            page_num: 页码
            text: 引用的文本内容

        Returns:
            包含所有定位信息的元数据字典
        """
        markdown_file = self.find_file(node_id)

        if not markdown_file:
            return {
                "type": "pdf",
                "pdf_name": self.pdf_name,
                "page": page_num,
                "text": text,
                "obsidian_link": f"[[{self.pdf_name}]]"
            }

        anchor = f"^page-{page_num}" if page_num else None
        obsidian_link = self.generate_obsidian_link(node_id, page_num)

        return {
            "type": "markdown",
            "node_id": node_id,
            "markdown_file": markdown_file,
            "page": page_num,
            "anchor": anchor,
            "text": text,
            "obsidian_link": obsidian_link
        }
```

**Step 4: 运行测试确认通过**

```bash
cd backend/deeppdf-api
uv run pytest tests/test_markdown_locator.py -v
```

Expected: `PASS` (3 passed)

**Step 5: 提交**

```bash
cd backend/deeppdf-api
git add tests/test_markdown_locator.py src/deeppdf/agent/markdown_locator.py
git commit -m "feat(agent): 添加 MarkdownLocator 用于生成 Obsidian 链接"
```

---

### Task 2: 修改 HybridSearchTool 返回增强元数据

**目标:** 让 `hybrid_search` 工具返回包含 Obsidian 链接的结构化数据。

**Files:**
- Modify: `backend/deeppdf-api/src/deeppdf/agent/tools.py`
- Modify: `backend/deeppdf-api/src/deeppdf/agent/executor.py`

**Step 1: 添加增强结果测试**

在 `tests/test_tools.py` 中添加：

```python
def test_hybrid_search_returns_enhanced_metadata():
    """测试 hybrid_search 返回增强的元数据"""
    from deeppdf.agent.executor import create_tool_executor
    from deeppdf.agent.markdown_locator import MarkdownLocator

    # 准备测试数据
    mock_tree = {"structure": []}
    mock_index_id = "test_index"
    mock_storage = "/tmp/test_storage"

    # 创建临时索引元数据
    import json
    from pathlib import Path
    Path(mock_storage).mkdir(parents=True, exist_ok=True)
    Path(mock_storage + "/indexes").mkdir(parents=True, exist_ok=True)

    index_metadata = {
        "markdown_files": {
            "node_123": "DeepPDF/Test/Chapter1.md"
        },
        "pdf_name": "Test.pdf"
    }

    with open(f"{mock_storage}/indexes/{mock_index_id}.json", "w") as f:
        json.dump({"markdown_files": index_metadata["markdown_files"]}, f)

    # 创建工具执行器
    executor = create_tool_executor(
        index_id=mock_index_id,
        storage_dir=mock_storage,
        tree_structure=mock_tree
    )

    # 注入 MarkdownLocator
    from unittest.mock import Mock
    executor.markdown_locator = MarkdownLocator(index_metadata)

    # 注意：这里需要 mock hybrid_search 的实际调用
    # 因为真实的向量数据库不可用
    # 实际测试中需要使用 Mock 或集成测试环境
```

**Step 2: 修改 HybridSearchTool 支持增强返回**

修改: `backend/deeppdf-api/src/deeppdf/agent/tools.py`

在 `HybridSearchTool` 类中添加：

```python
class HybridSearchTool:
    """混合检索工具 - 结合标题匹配、BM25 和向量检索"""

    name: str = "hybrid_search"
    description: str = (
        "快速检索与查询相关的文档片段，返回带 Obsidian 链接的结构化结果。"
        "适用于简单事实查询（如'某事发生在哪年'）。"
        "参数: query (str, 必需) - 搜索关键词; top_k (int, 可选) - 返回结果数，默认5"
    )

    def __init__(self, index_id: str, storage_dir: str):
        """
        初始化工具

        Args:
            index_id: 索引 ID
            storage_dir: 存储目录
        """
        self.index_id = index_id
        self.storage_dir = storage_dir
        self.markdown_locator: Optional['MarkdownLocator'] = None  # 延迟初始化

    def _get_markdown_locator(self) -> Optional['MarkdownLocator']:
        """获取 MarkdownLocator 实例"""
        if self.markdown_locator is None:
            try:
                from deeppdf.agent.markdown_locator import MarkdownLocator
                from deeppdf.services.querier import _load_index_metadata
                from pathlib import Path

                # 加载索引元数据
                index_metadata = _load_index_metadata(
                    Path(self.storage_dir),
                    self.index_id
                )
                self.markdown_locator = MarkdownLocator(index_metadata)
            except Exception as e:
                logger.warning(f"[HybridSearch] 无法加载 MarkdownLocator: {e}")
                return None

        return self.markdown_locator
```

**Step 3: 修改返回格式包含引用信息**

在 `HybridSearchTool.__call__` 方法中，修改结果格式化部分：

找到这段代码（约第 227-245 行）：
```python
# 格式化结果
lines = [f"# 检索结果 (共 {len(results)} 条)\n"]

for i, item in enumerate(results, 1):
    original_text = item.get("text", "")
    text = original_text[:500]
    if len(original_text) > 500:
        text += " [...]"

    metadata = item.get("metadata", {})
    section = metadata.get("section", "未知章节")
    score = metadata.get("score", 0)

    lines.append(f"## 结果 {i}: {section}")
    lines.append(f"相关性: {score:.2f}")
    lines.append(f"{text}")
    lines.append("")
```

替换为：

```python
# 格式化结果（增强版，包含 Obsidian 链接）
lines = [f"# 检索结果 (共 {len(results)} 条)\n"]

locator = self._get_markdown_locator()

for i, item in enumerate(results, 1):
    original_text = item.get("text", "")
    text = original_text[:500]
    if len(original_text) > 500:
        text += " [...]"

    metadata = item.get("metadata", {})
    section = metadata.get("section", "未知章节")
    score = metadata.get("score", 0)
    node_id = metadata.get("node_id", "")
    page = metadata.get("page", None)

    # 生成引用信息
    citation_info = ""
    if locator and node_id:
        citation_meta = locator.generate_citation_metadata(
            node_id=node_id,
            page_num=page,
            text=f"[结果{i+1}] {section}"
        )
        obsidian_link = citation_meta.get("obsidian_link", "")
        citation_info = f"\n引用链接: {obsidian_link}\n"

    lines.append(f"## 结果 {i}: {section}")
    lines.append(f"相关性: {score:.2f}")
    lines.append(f"{text}")
    lines.append(citation_info)
    lines.append("")
```

**Step 4: 运行测试**

```bash
cd backend/deeppdf-api
uv run pytest tests/test_tools.py -v -k hybrid_search
```

Expected: `PASS` (如果有现有测试通过，或新增测试通过)

**Step 5: 提交**

```bash
cd backend/deeppdf-api
git add src/deeppdf/agent/tools.py
git commit -m "feat(agent): hybrid_search 返回增强的 Obsidian 链接元数据"
```

---

### Task 3: 修改 Agent System Prompt 指导使用链接

**目标:** 让 Agent 在生成答案时使用工具返回的 Obsidian 链接。

**Files:**
- Modify: `backend/deeppdf-api/src/deeppdf/agent/prompts.py`

**Step 1: 查看当前 System Prompt**

```bash
cd backend/deeppdf-api
grep -n "可用工具" src/deeppdf/agent/prompts.py
```

**Step 2: 修改 Prompt 模板**

找到工具使用说明部分，添加引用格式指导：

```python
# 在 prompts.py 的 build_system_prompt 函数中
# 在工具使用说明后添加：

citation_format = """
## 引用格式要求

当使用 hybrid_search 工具时，工具会返回包含"引用链接"的结果。
在回答问题时，请使用以下格式引用来源：

1. **直接链接引用**：
   ```
   根据 [引用链接] 的内容，第五章提到了...
   ```

2. **脚注式引用**：
   ```
   根据研究显示...[^1]
   [^1]: [[DeepPDF/书名/第五章.md#^page-10]]

   然后在答案末尾统一列出所有引用。
   ```

这样可以确保用户能够点击链接跳转到原文位置。
"""
```

**Step 3: 更新 build_system_prompt**

将 `citation_format` 添加到 system prompt 中：

```python
def build_system_prompt(tool_descriptions: str) -> str:
    """构建 Agent 的 System Prompt"""

    base_prompt = f"""你是一个智能 PDF 文档助手，可以帮助用户查询和分析 PDF 文档内容。

{tool_descriptions}

{citation_format}

## 回答要求

1. **准确性**：基于工具返回的事实信息回答，不要编造
2. **清晰性**：使用简洁明了的语言，避免冗长
3. **结构化**：对于复杂问题，使用分点说明
4. **引用来源**：使用工具提供的引用链接，让用户可以验证

## 注意事项

- 如果工具调用失败，向用户说明具体错误
- 如果信息不足，诚实告知用户，不要猜测
- 对于需要多步骤分析的问题，逐步进行
"""

    return base_prompt
```

**Step 4: 测试 Prompt 生成**

```python
# 在 tests/test_prompts.py 中添加
def test_system_prompt_includes_citation_format():
    """测试 System Prompt 包含引用格式说明"""
    from deeppdf.agent.prompts import build_system_prompt

    prompt = build_system_prompt("## 可用工具\n\n...")

    assert "引用格式要求" in prompt
    assert "[[^1]:" in prompt
    assert "引用链接" in prompt
```

**Step 5: 提交**

```bash
cd backend/deeppdf-api
git add src/deeppdf/agent/prompts.py
git commit -m "feat(agent): 添加引用格式说明到 System Prompt"
```

---

### Task 4: 后端 API 返回结构化引用数据

**目标:** 修改 AgentResponse 模型，支持返回结构化的 citations 数组。

**Files:**
- Modify: `backend/deeppdf-api/src/deeppdf/api/models.py`
- Modify: `backend/deeppdf-api/src/deeppdf/api/routes.py`

**Step 1: 添加 Citation 数据模型**

在 `models.py` 中添加：

```python
class AgentCitation(BaseModel):
    """Agent 引用信息"""
    type: str  # "markdown" | "pdf"
    obsidian_link: str
    markdown_file: Optional[str] = None
    page: Optional[int] = None
    anchor: Optional[str] = None
    text: str

class AgentResponse(BaseModel):
    """Agent 响应"""
    status: str
    answer: Optional[str] = None
    error: Optional[str] = None
    iterations: Optional[int] = None
    citations: Optional[List[AgentCitation]] = None  # 新增
```

**Step 2: 修改 Agent 流式响应包含 citations**

在流式响应中，citations 需要通过特殊标记传递：

```python
# 在 SSE 流中添加 citations 事件
# 格式: data: {"status": "citation", "data": {...}}
```

**Step 3: 更新路由层传递 citations**

修改 `routes.py` 中的 `_agent_stream_generator`，在流中注入 citations：

```python
# 在 _agent_stream_generator 中
# 解析 Agent 返回的内容，提取 [[...]] 链接
import re

citation_pattern = r'\[\[([^\]]+)\]\]'
citations = []

# 检测到链接时发送 citation 事件
for match in re.finditer(citation_pattern, fullContent):
    link = match.group(1)
    yield f"data: {json.dumps({'status': 'citation', 'link': link})}\n\n"
```

**Step 4: 测试 API 返回**

```bash
# 测试 Agent API 返回 citations
curl -X POST http://localhost:6088/api/chat/agent/stream \
  -H "Content-Type: application/json" \
  -d '{"query": "第一章讲了什么", "index_id": "idx_xxx"}'
```

Expected: 响应中包含 `citation` 类型的 SSE 事件

**Step 5: 提交**

```bash
cd backend/deeppdf-api
git add src/deeppdf/api/models.py src/deeppdf/api/routes.py
git commit -m "feat(api): AgentResponse 支持 citations 字段"
```

---

### Task 5: 前端解析和渲染 Obsidian 链接

**目标:** 前端解析 Agent 返回的 `[[...]]` 链接并渲染为可点击的 Obsidian 链接。

**Files:**
- Modify: `frontend/src/components/message/message.ts`
- Modify: `frontend/src/views/sidebar-view.ts`

**Step 1: 添加 Obsidian 链接解析函数**

在 `message.ts` 中添加：

```typescript
/**
 * 解析 Agent 返回的 Obsidian 链接
 * @param content - Agent 返回的原始内容
 * @returns 解析后的内容和链接列表
 */
export function parseObsidianLinks(content: string): {
    cleaned: string;
    links: ObsidianLink[];
}

interface ObsidianLink {
    original: string;      // "[[file.md#^page-5]]"
    path: string;          // "file.md"
    anchor?: string;       // "^page-5"
    displayName?: string;  // 显示名称
}

export function parseObsidianLinks(content: string): {
    const linkPattern = /\[\[([^\]]+)\]\](#[^\]\s]+)?/g;
    const links: ObsidianLink[] = [];
    let cleaned = content;

    // 提取所有链接
    let match;
    while ((match = linkPattern.exec(content)) !== null) {
        const fullMatch = match[0];  // "[[file.md#^page-5]]"
        const target = match[1];     // "file.md"
        const anchor = match[2];     // "#^page-5" 或 undefined

        links.push({
            original: fullMatch,
            path: target,
            anchor: anchor?.replace('#', ''),
            displayName: target
        });
    }

    return { cleaned, links };
}
```

**Step 2: 修改 AIMessage 渲染链接**

在 `AIMessage` 类的 `renderContent` 方法中，添加 Obsidian 链接渲染：

```typescript
private renderContent(container: HTMLElement) {
    const contentEl = container.createEl('div', { cls: 'deeppdf-message-content' });

    // 解析 Obsidian 链接
    const { cleaned, links } = parseObsidianLinks(this.data.content);

    if (this.app) {
        // 先渲染 Markdown（不包含链接）
        MarkdownRenderer.render(this.app, cleaned, contentEl, '', new Component());

        // 后处理：将 [[link]] 替换为可点击的 Obsidian 链接
        links.forEach(link => {
            const fullLink = link.original;
            const linkHtml = `<a href="obsidian://${link.path}${link.anchor ? '#' + link.anchor : ''}"
                          class="deeppdf-obsidian-link"
                          data-link="${link.path}${link.anchor ? '#' + link.anchor : ''}">
                          ${link.displayName}
                        </a>`;

            // 替换原始链接标记
            contentEl.innerHTML = contentEl.innerHTML.replace(
                fullLink.replace(/\[/g, '\\[').replace(/\]/g, '\\]'),
                linkHtml
            );
        });
    } else {
        contentEl.innerHTML = this.escapeHtml(cleaned);
    }
}
```

**Step 3: 添加链接点击处理**

```typescript
// 添加链接点击事件监听
contentEl.addEventListener('click', (evt) => {
    const target = evt.target as HTMLElement;
    if (target.hasClass('deeppdf-obsidian-link')) {
        evt.preventDefault();
        const linkData = target.getData('link');

        // 触发 Obsidian 导航
        if (this.app) {
            this.app.workspace.openLinkText(linkData);
        }
    }
});
```

**Step 4: 添加 CSS 样式**

在 `styles.css` 中：

```css
.deeppdf-obsidian-link {
    color: var(--text-accent);
    text-decoration: underline;
    cursor: pointer;
    border-radius: 2px;
    padding: 0 2px;
}

.deeppdf-obsidian-link:hover {
    background-color: var(--background-modifier-hover);
}
```

**Step 5: 测试前端渲染**

```bash
cd frontend
npm run dev
```

在 Obsidian 中测试 Agent 查询，验证链接可点击。

**Step 6: 提交**

```bash
cd frontend
git add src/components/message/message.ts src/views/sidebar-view.ts styles.css
git commit -m "feat(ui): 解析并渲染 Agent 返回的 Obsidian 链接"
```

---

## 验收标准

完成所有任务后，系统应满足：

1. ✅ Agent 工具返回包含 `obsidian_link` 的元数据
2. ✅ Agent 答案中包含 `[[file.md#^page-N]]` 格式的链接
3. ✅ 前端解析链接并渲染为可点击的 Obsidian 链接
4. ✅ 点击链接跳转到正确的 Markdown 文档位置
5. ✅ 所有测试通过

## 风险点

1. **性能影响**：每次工具调用需要查询 markdown_files 映射
   - 缓解：在 ToolExecutor 初始化时加载一次

2. **Markdown 文件缺失**：用户可能未导出 Markdown
   - 缓解：fallback 到 PDF 原文件链接

3. **链接格式冲突**：Agent 可能生成错误格式的链接
   - 缓解：在 System Prompt 中明确说明格式要求

## 下一步

计划完成并保存后，可以选择：
1. **Subagent-Driven**（本会话）：逐任务执行，快速迭代
2. **Parallel Session**（独立会话）：批量执行，定期检查

选择哪种方式？
