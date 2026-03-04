# 摘录保存功能设计

## 概述

允许用户将 AI 的部分回复或全部回复以摘录的形式保存到 Obsidian vault 本地，便于知识积累和后续检索。

## 用户场景

1. **部分摘录**: 选中 AI 回复中的关键段落，2. **整条消息摘录**: 一键保存完整的 AI 回复
3. **多轮对话合并**: 选择多条消息，合并成一个摘录（后续扩展）

## 摘录格式

```markdown
## 2024-03-04 14:30 关于系统1与系统2

> 系统1的运行是无意识且快速的，完全处于自主控制状态...

**来源**: [[思考，快与慢.pdf#3]]
**问题**: 什么是系统1和系统2的区别？
**笔记**: 这个区分对理解认知偏差很重要
```

**元数据字段**:
- 标题: 时间戳 + 摘录主题
- 引用内容: blockquote 格式
- 来源: wikilink 链接到 PDF
- 问题: 触发该回答的用户问题
- 笔记: 用户可选的个人笔记

## 交互流程

```
用户选中文字 / 点击工具栏按钮
         ↓
悬浮菜单"摘录" / 模态框打开
         ↓
编辑内容 / 添加笔记
         ↓
选择保存位置
         ↓
确认保存 → 追加到目标笔记
         ↓
成功提示（可跳转到笔记）
```

## UI 组件

### 1. SelectionMenu（悬浮菜单）
- 文字选中后显示在选区附近
- 包含"摘录"按钮
- 点击后打开 ExcerptModal

### 2. ExcerptModal（摘录模态框）
- **标题区**: 摘录预览
- **内容区**:
  - 摘录内容预览（可编辑）
  - 笔记输入框（可选）
  - 来源信息显示
  - 保存位置选择器
- **底部**:
  - 取消 / 确认按钮

### 3. 消息工具栏扩展
- 在现有工具栏添加"摘录"按钮
- 点击后打开 ExcerptModal，预填整条消息内容

## 配置项

```typescript
interface ExcerptSettings {
  // 默认保存路径（相对于 vault 根目录）
  excerptDefaultPath: string;  // 如 "Excerpts/DeepPDF.md"

  // 是否默认包含双向链接
  excerptIncludeBacklink: boolean;

  // 是否显示笔记输入框
  excerptShowNoteField: boolean;
}
```

**默认值**:
- `excerptDefaultPath`: `Excerpts/DeepPDF.md`
- `excerptIncludeBacklink`: true
- `excerptShowNoteField`: true

## 技术实现

### 文件结构
```
frontend/src/components/
├── excerpt/
│   ├── selection-menu.ts      # 文字选中悬浮菜单
│   ├── selection-menu.css
│   ├── excerpt-modal.ts       # 摘录编辑模态框
│   └── excerpt-modal.css
```

### 关键依赖
- Obsidian API: `app.vault.create(folder)`, `app.workspace.openLinkText`
- 现有组件: 复用 Modal 基础组件

### 数据流
1. 用户选中文字 → `SelectionMenu` 获取选区和内容
2. 点击摘录 → `ExcerptModal` 接收内容和元数据
3. 用户确认 → 调用 `saveExcerpt()` 函数
4. `saveExcerpt()` → 追加内容到目标文件

## 后续扩展

- [ ] 多条消息合并摘录
- [ ] 摘录历史查看
- [ ] 摘录标签系统
- [ ] 摘录搜索功能
