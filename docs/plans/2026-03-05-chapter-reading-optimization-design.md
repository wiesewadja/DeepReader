# 章节阅读优化功能设计

## 概述

为 DeepReader 下载的本地章节文件提供书籍化阅读体验，支持选中文本的翻译、提问和摘录操作。

## 需求总结

1. **阅读样式美化** - 为章节文件提供电子书般的阅读体验
2. **目录和导航** - 生成目录、支持章节跳转、显示阅读进度
3. **选中文本操作** - 悬浮工具栏支持翻译、提问/解释、摘录保存
4. **AI 对话** - 复用右侧边栏进行对话
5. **自动识别** - 打开章节文件时自动应用书籍化样式

## 整体架构

```
┌─────────────────────────────────────────────────────────┐
│                    Obsidian 窗口                        │
├──────────────┬──────────────────────────────────────────┤
│   目录侧边栏   │           阅读内容区域          │  右侧边栏  │
│              │                              │           │
│  □ 第一章     │   # 第一章 标题              │  AI 对话   │
│  □ 1.1 小节   │                              │           │
│  □ 1.2 小节   │   段落内容...选中的文字...    │  回复内容  │
│  □ 第二章     │   ┌───────────────────┐      │           │
│  ...         │   │ 📖 翻译 💬提问 📝摘录│ ←悬浮│           │
│              │   └───────────────────┘      │           │
└──────────────┴──────────────────────────────────────────┘
```

### 核心组件

1. **ChapterReadingView** - 主控制器，监听文件打开，识别章节文件并激活阅读模式
2. **ReadingOutline** - 左侧目录导航，显示章节结构和阅读进度
3. **SelectionToolbar** - 悬浮工具栏，提供翻译/提问/摘录操作

### 交互流程

- 用户打开 `DeepReader/书名/*.md` 文件 → 自动应用阅读样式 + 显示目录
- 用户选中文字 → 显示悬浮工具栏
- 点击「提问」→ 将选中文本作为上下文，在右侧边栏打开对话

## 章节文件识别与阅读模式激活

### 识别规则

```typescript
// 判断是否为 DeepReader 章节文件
function isChapterFile(file: TFile): boolean {
  // 1. 路径以 DeepReader/ 开头
  // 2. 文件名格式为 NN-章节名.md (如 01-引言.md)
  // 3. frontmatter 包含 node_id 或 pdf_name
  return file.path.startsWith('DeepReader/') &&
         /^\d{2}-/.test(file.name) &&
         hasChapterFrontmatter(file);
}
```

### 阅读模式激活流程

1. 监听 `workspace.on('file-open')` 事件
2. 检测文件是否符合章节文件规则
3. 如果是：
   - 注入阅读样式 CSS
   - 在左侧显示目录导航
   - 启用文字选中监听
4. 如果不是：
   - 移除阅读样式和目录
   - 禁用选中监听

### 样式注入方式

- 通过 `document.body.classList.add('deeppdf-reading-mode')` 添加全局类
- CSS 使用 `.deeppdf-reading-mode` 前缀选择器，避免影响其他文件

```css
/* 示例：阅读模式下的段落样式 */
.deeppdf-reading-mode .markdown-preview-view p {
  line-height: 1.8;
  font-size: 16px;
  text-align: justify;
}
```

## 目录导航

### 目录数据来源

- 从当前文件的 frontmatter 获取 `pdf_name`（书名）
- 扫描 `DeepReader/{书名}/` 目录下的所有章节文件
- 按文件名排序（01-xxx.md, 02-xxx.md...）
- 从每个文件的 frontmatter 提取 `section` 作为章节标题

### 目录组件功能

```
┌─────────────────────┐
│ 📖 书名             │
├─────────────────────┤
│ ○ 01-引言          │ ← 已读（灰色）
│ ● 02-核心概念       │ ← 当前章节（高亮）
│ ○ 03-实践应用       │ ← 未读
│   ├─ 3.1 基础      │
│   └─ 3.2 进阶      │
│ ○ 04-总结          │
├─────────────────────┤
│ 进度: 2/4 (50%)     │
└─────────────────────┘
```

### 交互行为

- 点击章节 → 跳转到对应文件（`app.workspace.openLinkText`）
- 当前章节高亮显示
- 已访问章节显示不同颜色（基于 `last_read` 或本地记录）

### 位置实现

- 使用 Obsidian 的 `WorkspaceLeaf` 在左侧创建独立面板
- 或者使用浮动面板覆盖在内容区左侧

## 悬浮工具栏

### 触发条件

- 阅读模式下，用户选中文字后松开鼠标
- 选中文本长度 > 0

### 工具栏布局

```
┌──────────────────────────────────┐
│  📖 翻译  │  💬 提问  │  📝 摘录  │
└──────────────────────────────────┘
```

### 各按钮功能

| 按钮 | 功能 | 交互 |
|------|------|------|
| 📖 翻译 | 将选中文本翻译 | 调用 AI 翻译，结果在右侧边栏显示 |
| 💬 提问 | 对选中文本提问 | 打开右侧边栏，自动填充上下文，用户输入问题 |
| 📝 摘录 | 保存到笔记 | 复用现有 `ExcerptModal` 功能 |

### 位置计算

```typescript
const selection = window.getSelection();
const range = selection.getRangeAt(0);
const rect = range.getBoundingClientRect();
// 工具栏定位在选区上方或下方（根据空间自动调整）
toolbar.style.left = rect.left + rect.width / 2 - toolbarWidth / 2;
toolbar.style.top = rect.top - toolbarHeight - 8; // 上方 8px
```

### 点击提问后的流程

1. 获取选中文本
2. 获取当前文件的 `index_id`（从 frontmatter）
3. 打开右侧边栏
4. 将选中文本作为上下文自动发送：「请解释以下内容：{选中文本}」

## 阅读样式美化

### 核心样式优化

```css
/* 阅读模式容器 */
.deeppdf-reading-mode .markdown-preview-view {
  max-width: 800px;
  margin: 0 auto;
  padding: 40px 20px;
}

/* 标题样式 */
.deeppdf-reading-mode .markdown-preview-view h1 {
  font-size: 28px;
  font-weight: 700;
  margin-bottom: 24px;
  color: var(--text-normal);
}

.deeppdf-reading-mode .markdown-preview-view h2 {
  font-size: 22px;
  font-weight: 600;
  margin-top: 32px;
  border-bottom: 1px solid var(--background-modifier-border);
  padding-bottom: 8px;
}

/* 段落样式 */
.deeppdf-reading-mode .markdown-preview-view p {
  line-height: 1.8;
  font-size: 16px;
  text-align: justify;
  margin-bottom: 16px;
  color: var(--text-normal);
}

/* 引用块（页码标记）*/
.deeppdf-reading-mode .markdown-preview-view h3 {
  color: var(--text-muted);
  font-size: 14px;
  font-weight: 500;
  margin-top: 24px;
  padding-left: 12px;
  border-left: 3px solid var(--interactive-accent);
}
```

### 额外增强

- 代码块：添加背景色和圆角
- 列表：增加缩进和行间距
- 链接：下划线 + 悬停效果
- 选中文本：高亮背景色

## 文件结构

```
frontend/src/
├── services/
│   └── reading-mode-service.ts    # 阅读模式核心服务
├── components/
│   └── reading-mode/
│       ├── index.ts               # 导出入口
│       ├── reading-outline.ts     # 目录导航组件
│       ├── selection-toolbar.ts   # 悬浮工具栏组件
│       └── reading-mode.css       # 阅读模式样式
```

## 实现计划

| 阶段 | 内容 | 优先级 |
|------|------|--------|
| Phase 1 | 章节文件识别 + 样式注入 | P0 |
| Phase 2 | 悬浮工具栏（翻译、提问、摘录） | P0 |
| Phase 3 | 目录导航组件 | P1 |
| Phase 4 | 阅读进度记录 | P2 |

## 关键依赖

- 复用现有 `ExcerptModal` 和 `ExcerptService`
- 复用现有右侧边栏 `SidebarView` 进行对话
- 复用 `DeepPDFClient` 调用 AI 接口

---

# 后端内容优化设计

## 概述

优化后端对书籍章节内容的解析和排版，提升导出 Markdown 的可读性。

## 当前问题分析

### PDF 文档问题
1. **原始文本格式混乱** - pypdf/PyMuPDF 提取的文本常有：
   - 换行断裂（句子中间断开）
   - 段落无分隔
   - 标题和正文混在一起
   - 无语义结构（列表、引用等丢失）

2. **页码标记处理简单** - 只是简单的 `<physical_index_N>` 替换

### EPUB 文档问题
1. **html2text 配置过于简单** - 忽略了链接、图片、强调等格式
2. **HTML 语义丢失** - `<blockquote>`, `<code>`, `<ul>/<ol>` 等标签的语义没有保留

## 整体处理流程

```
原始文本 (PDF/EPUB)
       ↓
┌─────────────────────┐
│  规则预处理层        │
│  - 换行合并          │
│  - 段落识别          │
│  - 空白清理          │
│  - 标题检测          │
└─────────────────────┘
       ↓
┌─────────────────────┐
│  LLM 格式化层 (可选) │
│  - 段落重排          │
│  - 标题层级优化      │
│  - 列表识别          │
└─────────────────────┘
       ↓
  格式化的 Markdown
```

## 规则预处理层

### PDF 文本清洗规则

**1. 软换行合并**
```python
def merge_soft_line_breaks(text: str) -> str:
    """
    合并句子中间的换行
    - 如果换行后是小写字母开头，合并到上一行
    - 如果换行前是标点符号（句号、问号、感叹号），保留换行
    """
    lines = text.split('\n')
    result = []
    for i, line in enumerate(lines):
        if i > 0 and should_merge(lines[i-1], line):
            result[-1] += ' ' + line.strip()
        else:
            result.append(line)
    return '\n'.join(result)

def should_merge(prev_line: str, curr_line: str) -> bool:
    """判断两行是否应该合并"""
    # 当前行以小写开头
    if curr_line and curr_line[0].islower():
        return True
    # 上一行以连接符结尾（但不是破折号）
    if prev_line.rstrip().endswith('-') and not prev_line.rstrip().endswith('--'):
        return True
    return False
```

**2. 段落识别**
```python
def identify_paragraphs(text: str) -> List[str]:
    """
    识别段落边界
    - 空行分隔
    - 缩进开头
    - 编号开头（1. 2. 等）
    """
    paragraphs = []
    current_para = []

    for line in text.split('\n'):
        if is_paragraph_boundary(line, current_para):
            if current_para:
                paragraphs.append(' '.join(current_para))
            current_para = [line]
        else:
            current_para.append(line)

    if current_para:
        paragraphs.append(' '.join(current_para))

    return paragraphs
```

**3. 标题检测**
```python
def detect_headings(text: str) -> str:
    """
    检测并标记标题
    - 数字编号模式：1. 1.1 第1章 Chapter 1
    - 全大写行
    - 短行且后面紧跟段落
    """
    lines = text.split('\n')
    result = []

    for i, line in enumerate(lines):
        if is_likely_heading(line, lines, i):
            # 根据层级添加 Markdown 标题标记
            level = detect_heading_level(line)
            result.append('#' * level + ' ' + line.strip())
        else:
            result.append(line)

    return '\n'.join(result)
```

### EPUB HTML 增强解析

**保留更多 HTML 语义：**
```python
def html_to_markdown(html: str) -> str:
    """
    增强的 HTML 转 Markdown
    """
    h = html2text.HTML2Text()
    h.ignore_links = False      # 保留链接
    h.ignore_images = True      # 仍然忽略图片
    h.ignore_emphasis = False   # 保留强调
    h.body_width = 0            # 不换行
    h.unicode_snob = True       # 使用 Unicode
    h.skip_internal_links = False

    # 后处理：增强格式
    markdown = h.handle(html)
    markdown = enhance_blockquotes(markdown)
    markdown = enhance_code_blocks(markdown)
    markdown = enhance_lists(markdown)

    return markdown
```

## LLM 格式化层（可选）

### 触发条件
- 用户在设置中启用「使用 LLM 优化排版」
- 节点文本长度 > 500 字符（避免短文本浪费 token）

### LLM Prompt 模板
```
你是一个文本格式化专家。请将以下从 PDF 提取的文本重新排版为结构清晰的 Markdown 格式。

要求：
1. 保持原文内容不变，只调整格式
2. 识别标题层级并使用 # ## ### 标记
3. 将段落合并为完整的句子
4. 识别列表并使用 - 或 1. 标记
5. 识别引用块并使用 > 标记
6. 不要添加任何解释或总结

原文：
{original_text}

请输出格式化后的 Markdown：
```

### 实现位置
```python
# backend/deeppdf-api/src/deeppdf/services/text_formatter.py

class TextFormatter:
    def __init__(self, llm_client=None, use_llm=False):
        self.llm_client = llm_client
        self.use_llm = use_llm

    async def format(self, text: str, doc_type: str) -> str:
        # 1. 规则预处理
        text = self.rule_based_clean(text, doc_type)

        # 2. LLM 格式化（可选）
        if self.use_llm and len(text) > 500:
            text = await self.llm_format(text)

        return text

    def rule_based_clean(self, text: str, doc_type: str) -> str:
        if doc_type == 'pdf':
            text = merge_soft_line_breaks(text)
            text = identify_paragraphs(text)
            text = detect_headings(text)
        elif doc_type == 'epub':
            text = html_to_markdown(text)
        return text
```

## 后端文件结构

```
backend/deeppdf-api/src/deeppdf/
├── services/
│   ├── text_formatter.py       # 新增：文本格式化服务
│   └── indexer.py              # 修改：集成格式化服务
├── api/
│   └── routes.py               # 修改：添加格式化配置参数
```

## 配置项

```python
class IndexSettings(BaseModel):
    # ... 现有配置 ...

    # 格式化配置
    enable_text_formatting: bool = True   # 启用文本格式化
    use_llm_formatting: bool = False      # 使用 LLM 格式化（较慢但效果更好）
```

## 实现计划

| 阶段 | 内容 | 优先级 |
|------|------|--------|
| Phase 1 | PDF 规则预处理（换行合并、段落识别） | P0 |
| Phase 2 | EPUB HTML 增强解析 | P0 |
| Phase 3 | LLM 格式化层（可选） | P1 |
| Phase 4 | 配置项和 API 集成 | P1 |

## 验收标准

- [ ] PDF 提取的文本不再有断裂的句子
- [ ] 段落正确分隔，阅读流畅
- [ ] EPUB 保留列表、引用、代码块格式
- [ ] LLM 格式化可选且稳定
- [ ] 导出的 Markdown 可读性显著提升
