# Question Minimap 设计文档

## 概述

在对话消息列表右侧添加一个类似 VSCode minimap 的导航组件，以缩略块的形式展示对话内容密度，用户可点击快速跳转到对应消息。

## 目标

- 提供对话历史的可视化概览
- 快速定位和跳转到用户提问位置
- 极简、非侵入式的 UI 设计

## 视觉设计

### 布局示意

```
┌───────────────────────────────────────────────────────┬──────┐
│                                                       │ ░░░░ │
│  [AI] 这本书主要讲述了人工智能的发展历程...              │ ░░░░ │
│                                                       │ ▓▓▓▓ │
│───────────────────────────────────────────────────────│ ░░░░ │
│                                     ┌───────────────┐ │ ░░░░ │
│  [用户] 第一章的核心观点是什么？     │ 第一章的核心... │ │      │
│                                     └───────────────┘ │ ▓▓▓▓ │
│  [AI] 第一章的核心观点是关于...                        │ ░░░░ │
│                                                       │ ░░░░ │
│───────────────────────────────────────────────────────│      │
│                                                       │ ░░░░ │
│  [用户] 作者为什么这样论证？                           │ ▓▓▓▓ │
│                                                       │ ░░░░ │
│  [AI] 作者采用这种论证方式是因为...                    │ ░░░░ │
│                                                       │      │
└───────────────────────────────────────────────────────┴──────┘
```

### 规格参数

| 属性 | 值 | 说明 |
|------|-----|------|
| minimap 宽度 | 18px | 紧凑但易于点击 |
| 消息块最小高度 | 4px | 确保可见性 |
| 消息块最大高度 | 按比例计算 | 根据消息实际高度映射 |
| 块间距 | 1px | 视觉分隔 |
| 用户消息颜色 | `--text-muted` (约 60% 透明度) | 深色块，突出显示 |
| AI 消息颜色 | `--background-modifier-hover` | 浅色块，背景融合 |

### Tooltip 设计

| 属性 | 值 |
|------|-----|
| 最大宽度 | 200px |
| 内边距 | 6px 10px |
| 背景 | `--background-primary` |
| 边框 | `--background-modifier-border` |
| 圆角 | 6px |
| 字体 | 12px |
| 内容 | 问题前 30 字符 + "..." |
| 位置 | 跟随鼠标，向左偏移 10px |

## 交互行为

### 状态机

```
┌─────────────┐    hover 用户块    ┌─────────────┐
│   默认状态   │ ─────────────────→ │  显示 tooltip │
└─────────────┘                    └─────────────┘
       ↑                                  │
       │                                  │
       │         click / mouseleave       │
       └──────────────────────────────────┘
```

### 交互规则

1. **hover 用户消息块**
   - 显示 tooltip，内容为问题摘要
   - tooltip 跟随鼠标移动

2. **click 用户消息块**
   - 平滑滚动到对应消息
   - tooltip 消失
   - 消息居中显示

3. **hover AI 消息块**
   - 无 tooltip
   - 鼠标样式保持默认

4. **click AI 消息块**
   - 可选：滚动到对应位置（建议实现）

5. **mouseleave minimap**
   - tooltip 立即消失

## 技术设计

### 组件结构

```
frontend/src/components/question-minimap/
├── index.ts                    # 导出
├── question-minimap.ts         # 主组件
└── question-minimap.css        # 样式
```

### 组件接口

```typescript
interface QuestionMinimapProps {
  /** 消息列表数据 */
  messages: MessageData[];
  /** 消息容器元素（用于计算位置） */
  containerEl: HTMLElement;
  /** 点击回调，返回消息 ID */
  onMessageClick: (messageId: string) => void;
}

interface MinimapBlock {
  id: string;
  role: 'user' | 'assistant';
  /** 块在 minimap 中的 Y 位置（百分比） */
  topPercent: number;
  /** 块的高度（百分比） */
  heightPercent: number;
  /** tooltip 内容（仅用户消息） */
  tooltipContent?: string;
}
```

### 位置计算算法

```typescript
function calculateBlockPosition(
  messageEl: HTMLElement,
  containerEl: HTMLElement
): { topPercent: number; heightPercent: number } {
  const containerHeight = containerEl.scrollHeight;
  const messageTop = messageEl.offsetTop;
  const messageHeight = messageEl.offsetHeight;

  return {
    topPercent: (messageTop / containerHeight) * 100,
    heightPercent: Math.max(
      (messageHeight / containerHeight) * 100,
      MIN_BLOCK_HEIGHT_PERCENT
    ),
  };
}
```

### 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `components/question-minimap/index.ts` | 新建 | 组件导出 |
| `components/question-minimap/question-minimap.ts` | 新建 | 主组件实现 |
| `components/question-minimap/question-minimap.css` | 新建 | 样式定义 |
| `components/message-list/message-list.ts` | 修改 | 集成 minimap |
| `components/message-list/message-list.css` | 修改 | 布局调整 |
| `styles/main.css` | 修改 | 导入 minimap 样式 |

### 集成方式

在 `MessageList` 组件中：

```typescript
// message-list.ts
class MessageList extends Component {
  private minimap: QuestionMinimap | null = null;

  render(): HTMLElement {
    // ... 现有代码

    // 创建 minimap（在容器右侧）
    this.minimap = new QuestionMinimap({
      containerEl: this.messagesContainer,
      onMessageClick: (id) => this.scrollToMessage(id),
    });
    container.appendChild(this.minimap.getElement());

    return container;
  }

  // 更新 minimap 数据
  private updateMinimap(): void {
    if (this.minimap) {
      this.minimap.updateMessages(this.getAllMessages());
    }
  }
}
```

## 性能考虑

1. **位置计算优化**
   - 使用 `ResizeObserver` 监听容器尺寸变化
   - 使用 `MutationObserver` 监听消息增删
   - 防抖处理频繁更新

2. **渲染优化**
   - 块数量超过 50 时，合并相邻 AI 消息块
   - 使用 CSS transform 代替 top 属性

3. **tooltip 优化**
   - 使用 `requestAnimationFrame` 更新位置
   - 防抖 mousemove 事件（100ms）

## 可访问性

- minimap 区域添加 `aria-label="对话导航"`
- 用户消息块添加 `role="button"` 和 `aria-label="跳转到：{问题摘要}"`
- 支持键盘导航（Tab 聚焦，Enter 跳转）

## 未来扩展

- [ ] 支持拖拽 minimap 快速滚动
- [ ] 高亮当前视口区域
- [ ] 支持书签/收藏功能
