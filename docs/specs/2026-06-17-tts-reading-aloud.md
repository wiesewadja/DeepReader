# TTS 朗读原文 — 功能规格书

> 在阅读模式下添加"朗读原文"按钮，复用现有 MiniMax TTS 服务朗读当前阅读内容。

## 1. 背景

DeepReader 已有完整的 TTS 服务（MiniMax 驱动），但仅用于朗读 **Agent 回复**（消息气泡）。用户希望在阅读模式下也能朗读**书籍原文**。

### 现有资产

| 资产 | 位置 | 说明 |
|------|------|------|
| `TTSService` | `src/services/tts/tts-service.ts` | 核心 TTS 引擎，`play(content)` / `stop()` / `togglePauseResume()` |
| `TTSController` | `src/views/sidebar/tts-controller.ts` | SidebarView 内的 TTS 子系统控制器 |
| `ReadingModeService` | `src/components/reading-mode/reading-mode-orchestrator.ts` | 阅读模式服务，提供章节导航 |
| `PagePaginator` | `src/components/reading-mode/page-paginator.ts` | 分页器，管理当前页 |
| `ReadingTopbar` | `src/components/reading-topbar/reading-topbar.ts` | 阅读顶栏，右侧已有书库/设置按钮 |

## 2. 用户故事

> 作为一名读者，我在阅读模式中看到当前内容，点击右侧工具栏的"朗读原文"按钮，插件用 MiniMax TTS 朗读当前阅读部分。再次点击同一按钮停止朗读。

## 3. 功能需求

### F-01: 朗读按钮

- **位置**：ReadingTopbar 右侧区域（与书库、设置按钮同行），新增朗读按钮
- **图标**：扬声器图标（🔊 或使用 Obsidian 图标 `lucide-volume-2`）
- **状态**：`idle`（停止态） / `playing`（播放中，图标变为暂停/停止样式）
- **交互**：
  - 点击 idle 态按钮 → 开始朗读当前内容
  - 点击 playing 态按钮 → 停止朗读
- **Hotkey**：注册 Obsidian 命令 `deepreader:tts-reading-toggle`，默认无快捷键

### F-02: 朗读内容确定

朗读"当前阅读的部分"按以下优先级确定：

| 优先级 | 内容来源 | 说明 |
|--------|----------|------|
| 1 | 当前选中文本（Selection） | 用户有选区时，朗读选区内容 |
| 2 | 当前可见页文本 | 从 PagePaginator 获取当前页的文本内容 |
| 3 | 当前章节全文 | 从 ContextManager 获取当前章节完整 Markdown 文本（需过滤 Markdown 标记） |

**选择策略**：按优先级从上到下取第一个非空来源。

### F-03: 文本预处理

朗读文本需经过以下处理链：

1. **去除 Markdown 标记**：`#` 标题标记、`**` 加粗、`*` 斜体、`[]()` 链接、`![]()` 图片
2. **去除 wiki-link 标记**：`[[...]]` → 提取显示文本
3. **去除 block id**：`^block-id` 后缀
4. **空白压缩**：多余空行合并
5. **分句**：按句号/问号/感叹号分句，便于流式 TTS

### F-04: 播放状态管理

- `TTSController` 需要支持两种"来源"：`message`（现有 agent 回复）和 `reading`（新增原文朗读）
- 原文朗读开始时通知 UI 更新按钮状态
- 原文朗读结束时自动恢复按钮到 idle 态
- 切换章节/关闭阅读模式时自动停止朗读
- 原文朗读和 Agent 回复朗读**互斥**：开始一个会自动停止另一个

### F-05: 与阅读模式的联动

| 事件 | 行为 |
|------|------|
| 用户翻页（PagePaginator） | 自动停止当前朗读（新页内容不同） |
| 用户切换章节 | 自动停止当前朗读 |
| 用户关闭阅读模式 | 自动停止当前朗读 |
| 用户选中文本 | 不自动影响朗读，但按钮下次点击读选区 |
| 朗读中用户选中文本 + 点击按钮 | 切换到朗读选中文本 |

## 4. 非功能需求

- **低侵入**：不修改 TTS 服务核心逻辑，只在 UI 层和控制器层扩展
- **状态隔离**：原文朗读和 Agent 回复朗读共享 `TTSService` 实例但状态不混淆
- **响应式**：按钮状态实时反映播放状态

## 5. UI 示意

```
┌──────────────────────────────────────┐
│  ReadingTopbar                        │
│  😺  书名：xxx    [🔊] [📚] [⚙️]    │
└──────────────────────────────────────┘
                          ↑
                    新增朗读原文按钮
```

按钮状态：
- **idle**: 🔇 `lucide-volume-x` 或 `lucide-volume-2`（灰色）
- **loading**: ⏳ 加载中动画
- **playing**: 🔊 `lucide-volume-2`（高亮色，脉冲动画）
- **paused**: ⏸️ `lucide-pause`（暂不实现，后续扩展）

## 6. 涉及的文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/components/reading-topbar/reading-topbar.ts` | 修改 | 新增朗读按钮和状态管理 |
| `src/components/reading-topbar/reading-topbar.css` | 修改 | 按钮样式、播放状态动画 |
| `src/views/sidebar/tts-controller.ts` | 修改 | 支持原文朗读源的 play/stop |
| `src/views/sidebar/sidebar-view.ts` | 修改 | 连接 ReadingTopbar 朗读按钮 ↔ TTSController |
| `src/components/reading-mode/reading-mode-orchestrator.ts` | 修改 | 可选：暴露获取当前页文本的方法 |
| `src/components/reading-mode/page-paginator.ts` | 修改 | 可选：添加 `getCurrentPageText()` |

## 7. 验收标准

- [ ] 阅读模式顶栏右侧显示朗读按钮
- [ ] 点击按钮开始朗读当前内容（选中的文本 / 当前页 / 当前章）
- [ ] 再次点击停止朗读
- [ ] 按钮图标在 idle/playing 状态间正确切换
- [ ] 翻页/切换章节自动停止朗读
- [ ] 原文朗读与 agent 回复朗读互斥
- [ ] 文本预处理正确去除 Markdown/wiki-link/block-id
