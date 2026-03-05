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
