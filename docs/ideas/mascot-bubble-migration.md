# 奚童表情气泡迁移 SPEC

## 问题

当前奚童表情固定在 topbar 左侧。AI 回复时用户视线在消息气泡区域，topbar 的表情变化容易被忽略。需要让表情在 AI 回复期间"跳"到消息气泡中，与状态文字一起展示。

## 行为

| 阶段 | topbar 表情 | 气泡内表情 |
|------|------------|-----------|
| idle / 用户浏览 | 显示（idle + 眨眼动画） | 无 |
| 用户发消息 → AI 处理中 | **隐藏** | **显示**，与状态文字同行，表情随 Agent 状态切换 |
| AI 完成（onComplete） | 恢复显示（happy → 2s → idle） | **隐藏** |
| AI 出错 / 用户取消 | 恢复显示（idle） | **隐藏** |

关键约束：**同一个 MascotFace 实例**，通过 DOM reparenting 在 topbar 和气泡之间移动，保持状态连续（idle timer、blink timer 不中断）。

## 布局

### topbar（正常态）

```
[mascot] [封面 书名/作者 居中] [书库 设置]
```

### topbar（AI 处理中）

```
[封面 书名/作者 居中] [书库 设置]    ← mascot 隐藏
```

### 消息气泡 header-left（AI 处理中）

```
┌─────────────────────────────────┐
│ [badge 奚童] [mascot] [状态文字] │
└─────────────────────────────────┘
```

mascot 与 status text 同行横排，badge 左侧，mascot 居中，状态文字右侧。

## 改动清单

### 1. `reading-topbar.ts`

新增方法：

```ts
// 从 topbar 移除 mascot DOM 并返回，topbar 区域收缩
detachMascot(): HTMLElement | null

// 将 mascot DOM 重新插入 topbar
reattachMascot(el: HTMLElement): void
```

`detachMascot` 返回 mascot 的 DOM element（`this.mascotFace.getElement()`），从 centerSection 中移除。topbar 无 mascot 时布局自然收缩。

`reattachMascot` 将元素重新插入 topbar（作为第一个子元素）。

### 2. `agent-chat-controller.ts`

改动 6 个位置：

**a) `sendMessage()` — 设 curious 后迁移 mascot 到气泡**

```ts
this.host.readingTopbar?.setMascotExpression('curious');
const mascotEl = this.host.readingTopbar?.detachMascot();
if (mascotEl) {
    // 找到当前 AI 消息的 header-left 容器
    const headerLeft = this.host.messageList?.getMessage(aiMessageId)
        ?.getElement()?.querySelector('.deeppdf-message-header-left');
    headerLeft?.insertBefore(mascotEl, statusEl);
}
```

需要在 `sendMessage` 中保存 `mascotEl` 引用到实例字段 `private detachedMascotEl: HTMLElement | null = null`。

**b) `onHumanizedProgress` — 不变**

已经通过 `this.host.readingTopbar?.setMascotExpression(expr)` 调用。MascotFace 实例不变，DOM 移动不影响 JS 引用，所以 `setExpression` 仍然有效。

**c) `onComplete` — 恢复 mascot 到 topbar**

```ts
self.host.readingTopbar?.reattachMascot(self.detachedMascotEl);
self.detachedMascotEl = null;
self.host.readingTopbar?.setMascotExpression('happy');
```

**d) `onError` — 恢复到 topbar**

```ts
self.host.readingTopbar?.reattachMascot(self.detachedMascotEl);
self.detachedMascotEl = null;
self.host.readingTopbar?.setMascotExpression('idle');
```

**e) `handleAgentQuery` catch 块 — 恢复**

```ts
this.host.readingTopbar?.reattachMascot(this.detachedMascotEl);
this.detachedMascotEl = null;
```

**f) `cancelActiveStream` / `stopGeneration` — 恢复**

```ts
this.host.readingTopbar?.reattachMascot(this.detachedMascotEl);
this.detachedMascotEl = null;
```

### 3. `message.css`

`.deeppdf-message-header-left` 改为横排布局以容纳 mascot：

```css
.deeppdf-message-header-left {
    display: flex;
    flex-direction: row;       /* 改为横排 */
    align-items: center;
    gap: 6px;
}
```

mascot 在气泡内时尺寸缩小（24×24）以适配 header 行高：

```css
.deeppdf-message-header-left .deeppdf-mascot-face {
    width: 24px;
    height: 24px;
}
```

### 4. 不改动的文件

- `mascot-face.ts` — 组件本身无变化
- `message.ts` — 不给 AIMessage 添加 mascot 逻辑，controller 直接操作 DOM
- `sidebar-view.ts` — 不变
- `stream-processor.ts` — 不变

## 风险

| 风险 | 缓解 |
|------|------|
| DOM reparenting 导致 tooltip 定位错误 | tooltip 已改为 fixed + getBoundingClientRect，跟随 anchor 自动更新 |
| MascotFace 实例的 blink timer 在移动后继续运行 | 这是预期行为，idle 时在气泡内也会眨眼 |
| 用户快速连续提问，mascot 还未迁回就再次 detach | reattachMascot 先检查 el 是否还在 DOM 中，避免重复插入 |
| proactive 引导流程也需处理 | proactive 的 onHumanizedProgress 已接入表情映射，但 proactive 不迁移 mascot（proactive 不需要） |

## 验证

1. 发送消息 → mascot 从 topbar 消失，出现在消息气泡 badge 右侧
2. Agent 处理中 → 气泡内表情切换（thinking / reading / curious）
3. Agent 完成 → mascot 回到 topbar，显示 happy
4. 用户取消 → mascot 回到 topbar，显示 idle
5. 错误 → mascot 回到 topbar，显示 idle
6. 气泡内 mascot 眨眼动画正常
7. tooltip 在气泡内也能正常显示
