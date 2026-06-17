# TTS 朗读原文 — 功能规格书

> 在阅读模式下添加"朗读原文"按钮，复用现有 MIMO v2.5 TTS 服务朗读当前阅读内容。

## 1. 背景

DeepReader 已有完整的 TTS 服务，支持 **mimo（小米 MIMO）** 和 **MiniMax** 两种 TTS 引擎，通过 `ttsProvider` 配置切换。目前 TTS 仅用于朗读 **Agent 回复**（消息气泡）。用户希望在阅读模式下也能朗读**书籍原文**，使用 **mimo v2.5** TTS 引擎。

### 现有资产

| 资产 | 位置 | 说明 |
|------|------|------|
| `TTSService` | `src/services/tts/tts-service.ts` | 核心 TTS 编排，`play(content)` / `stop()` / `togglePauseResume()` |
| `TTSClient` | `src/services/tts/tts-client.ts` | **mimo v2.5** TTS 客户端（小米 MIMO），OpenAI 兼容 `/chat/completions`，base64 音频 |
| `MiniMaxTTSClient` | `src/services/tts/minimax-tts-client.ts` | MiniMax TTS 客户端（本项目也支持，但本次用 mimo） |
| `ITTSSynthesizer` | `src/services/tts/tts-client.ts:21` | 统一 TTS 合成接口，两客户端共享 |
| `TTSController` | `src/views/sidebar/tts-controller.ts` | SidebarView 内的 TTS 子系统控制器 |
| `ReadingModeService` | `src/components/reading-mode/reading-mode-orchestrator.ts` | 阅读模式服务，提供章节导航 |
| `PagePaginator` | `src/components/reading-mode/page-paginator.ts` | 分页器，管理当前页 |
| `ReadingTopbar` | `src/components/reading-topbar/reading-topbar.ts` | 阅读顶栏，右侧已有书库/设置按钮 |

## 2. 用户故事

> 作为一名读者，我在阅读模式中看到当前内容，点击右侧顶栏的"朗读原文"按钮，插件用 MIMO v2.5 TTS 朗读当前阅读部分。再次点击同一按钮停止朗读。

## 3. 功能需求

### F-01: 朗读按钮

- **位置**：`ReadingTopbar` 右侧区域（与书库、设置按钮同行），新增朗读按钮
- **图标**：🔊（使用 `lucide-volume-2`）
- **状态机**：

```
      点击                 点击
  idle ────→ playing ──────────→ idle
               │ 朗读结束 │
               └──────────┘
```

- **交互**：
  - idle 态 → 点击开始朗读当前内容
  - playing 态 → 点击停止朗读
- **Hotkey**：注册 Obsidian 命令 `deepreader:tts-reading-toggle`，默认无快捷键

### F-02: 朗读内容确定

朗读"当前阅读的部分"按以下优先级确定：

| 优先级 | 内容来源 | 获取方法 |
|--------|----------|----------|
| 1 | 当前选中文本 | `window.getSelection().toString()` |
| 2 | 当前页文本 | `PagePaginator` 新增 `getCurrentPageText(): string` |
| 3 | 当前章节全文 | `ContextManager.loadCurrentDocument()` 获取 Markdown 后去标记 |

**选择策略**：按优先级从上到下取第一个非空来源。

### F-03: 文本预处理链

朗读文本需经过以下处理（复用 `TTSSummarizer` 或新建纯文本工具函数）：

1. **去除 Markdown 标记**：`#` 标题、`**` 加粗、`*` 斜体、`[]()` 链接、`![]()` 图片
2. **去除 wiki-link 标记**：`[[...|alias]]` → 提取 alias 或标题文本
3. **去除 block id**：`^block-id` 后缀
4. **空白压缩**：多余空行合并
5. **分句**：按句号/问号/感叹号分句（供流式 TTS 使用）

### F-04: 播放状态管理

- `TTSController` 新增区分 `source: 'message' | 'reading'`
- 原文朗读和 Agent 回复朗读**互斥**：开始一个会自动停止另一个
- 原文朗读结束时自动恢复按钮到 idle 态

### F-05: 与阅读模式的联动

| 事件 | 行为 |
|------|------|
| 用户翻页（PagePaginator） | 自动停止朗读（新页内容不同） |
| 用户切换章节（ChapterNav） | 自动停止朗读 |
| 用户关闭阅读模式（deactivate） | 自动停止朗读 |
| 用户选中文本 | 不自动影响朗读；但下次点击按钮读选区内容 |

### F-06: 复用 mimo v2.5

朗读原文沿用用户已配置的 TTS 设置：

```
ttsProvider = 'xiaomi'（默认）
ttsModel = 'mimo-v2.5-tts' 或 'mimo-v2.5-tts-voicedesign'（按用户 settings）
```

无需新增 TTS 配置项。TTS 服务的初始化流程（`TTSController.initTTSService()`）不变，`play()` 接口不变。

## 4. 非功能需求

- **低侵入**：不修改 `TTSService` 核心逻辑，只在 UI 层和控制器层扩展
- **状态隔离**：原文朗读和 Agent 回复朗读共享同一个 `TTSService` 实例，但按钮状态互不干扰
- **响应式**：按钮图标实时反映播放状态

## 5. UI 示意

```
┌──────────────────────────────────────────┐
│  ReadingTopbar                            │
│  😺  书名：xxx      [🔊] [📚] [⚙️]      │
└──────────────────────────────────────────┘
                        ↑
                  新增朗读原文按钮
```

按钮视觉状态：

| 状态 | 图标 | 样式 |
|------|------|------|
| idle | `lucide-volume-x` | 灰色，常规 |
| loading | — | 旋转动画（等待 TTS 首帧） |
| playing | `lucide-volume-2` | 主题高亮色 + 脉冲动画 |

## 6. 涉及的文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/components/reading-topbar/reading-topbar.ts` | 修改 | 新增朗读按钮、状态管理、回调 |
| `src/components/reading-topbar/reading-topbar.css` | 修改 | 按钮样式、playing 态脉冲动画 |
| `src/views/sidebar/tts-controller.ts` | 修改 | 新增 `source: 'reading'` 支持、`stopReading()` |
| `src/views/sidebar/sidebar-view.ts` | 修改 | 连接 ReadingTopbar 按钮 ↔ TTSController + ReadingModeService |
| `src/components/reading-mode/page-paginator.ts` | 修改 | 新增 `getCurrentPageText(): string` |

## 7. 验收标准

- [ ] 阅读模式顶栏右侧显示朗读按钮
- [ ] idle 态点击 → 开始朗读（mimo v2.5），图标切为 playing
- [ ] playing 态点击 → 停止朗读，图标切回 idle
- [ ] 朗读内容按优先级：选区 > 当前页 > 当前章
- [ ] 翻页/切换章节/关闭阅读模式 → 自动停止
- [ ] 原文朗读与 agent 回复朗读互斥
- [ ] 文本预处理正确去除 Markdown/wiki-link/block-id
- [ ] 朗读中按钮有脉冲动画反馈
