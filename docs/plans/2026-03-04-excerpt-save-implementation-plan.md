# 摘录保存功能实现计划

## 概述

基于 [设计文档](./2026-03-04-excerpt-save-feature-design.md)，实现摘录保存功能。

## 实现阶段

### Phase 1: 基础设施 (P0 - 必须)

**目标**: 吴建基础组件和配置项

**任务**:
1. 创建 `ExcerptService` 服务类
   - 文件: `frontend/src/services/excerpt-service.ts`
   - 功能:
     - `saveExcerpt(content, metadata, targetPath)` - 保存摘录
     - `getDefaultExcerptPath()` - 获取默认保存路径
     - `ensureExcerptFile(path)` - 确保摘录文件存在

     - `formatExcerpt(content, metadata)` - 格式化摘录内容
     - `generateExcerptTitle(content)` - 生成摘录标题

2. 添加插件配置项
   - 文件: `frontend/src/settings.ts` (修改)
   - 配置项:
     - `excerptDefaultPath`: 默认保存路径， 默认 `Excerpts/DeepPDF.md`
     - `excerptIncludeBacklink`: 是否包含双向链接， 默认 `true`

3. 创建摘录相关类型定义
   - 文件: `frontend/src/types/excerpt.ts`
   - 类型:
     - `ExcerptContent` - 摘录内容
     - `ExcerptMetadata` - 摘录元数据
     - `ExcerptOptions` - 摘录选项

### Phase 2: UI 组件 (P0 - 必须)

**目标**: 创建摘录相关的 UI 组件

**任务**:
1. 创建 `SelectionMenu` 组件
   - 文件: `frontend/src/components/excerpt/selection-menu.ts`
   - 功能: 文字选中后显示悬浮菜单
   - 交互:
     - 检测文字选中
     - 显示"摘录"按钮
     - 点击后触发摘录

2. 创建 `ExcerptModal` 绑态框
   - 文件: `frontend/src/components/excerpt/excerpt-modal.ts`
   - 功能:
     - 预览摘录内容
     - 编辑笔记
     - 选择保存位置
     - 配置选项（是否包含链接）
     - 确认/取消按钮

3. 添加摘录按钮到消息工具栏
   - 文件: `frontend/src/components/message/message.ts` (修改)
   - 在工具栏添加"摘录"按钮
   - 点击后打开 `ExcerptModal`

4. 创建摘录组件样式
   - 文件: `frontend/src/components/excerpt/excerpt-modal.css`
   - 样式:
     - 模态框样式
     - 表单样式
     - 预览区域样式

### Phase 3: 集成 (P0 - 必须)

**目标**: 将摘录功能集成到主界面

**任务**:
1. 修改 `sidebar-view.ts`
   - 导入 `ExcerptService`
   - 处理摘录回调
   - 显示成功提示

2. 修改 `MessageList` 组件
   - 传递摘录回调

3. 修改 `Message` 组件
   - 添加摘录按钮
   - 处理文字选中事件

### Phase 4: 测试和优化 (P1 - 可佳)

**目标**: 确保功能稳定可靠

**任务**:
1. 单元测试
   - 测试 `ExcerptService`
   - 测试摘录格式化

2. 集成测试
   - 测试完整流程

3. 边缘情况处理
   - 处理文件不存在
   - 处理权限问题
   - 处理长文本

## 文件结构

```
frontend/src/
├── services/
│   └── excerpt-service.ts      # 摘录服务
├── types/
│   └── excerpt.ts              # 摘录类型定义
├── components/
│   └── excerpt/
│       ├── selection-menu.ts   # 文字选中菜单
│       ├── excerpt-modal.ts    # 摘录编辑模态框
│       └── excerpt-modal.css   # 样式
└── settings.ts                # 配置项 (修改)
```

## 依赖关系

```
Message组件
    ↓ 点击摘录按钮
ExcerptModal组件
    ↓ 用户确认
ExcerptService.saveExcerpt()
    ↓ 追加到文件
Obsidian笔记文件
```

## 配置项

```typescript
interface DeepPDFSettings {
  // ... 现有配置 ...

  // 摘录配置
  excerptDefaultPath: string;      // 默认: 'Excerpts/DeepPDF.md'
  excerptIncludeBacklink: boolean; // 默认: true
}
```

## 错误处理

- 文件不存在: 自动创建
- 权限问题: 显示错误提示
- 长文本: 允许保存，不做限制

## 验收标准
- [ ] 可以从消息工具栏点击摘录按钮
- [ ] 摘录模态框显示正确的消息内容
- [ ] 可以编辑摘录内容
- [ ] 可以选择保存位置
- [ ] 摘录正确保存到指定文件
- [ ] 摘录包含正确的元数据
- [ ] 双向链接可以跳转回原对话
