# Push-to-Talk 语音输入设计

## [S1] 问题

移动端用户需要快速输入语音内容，但现有语音入口（点击麦克风按钮）在移动端体验不佳：
1. 点击麦克风按钮需要精确点击，移动端操作不便
2. 现有语音按钮在移动端隐藏后，语音入口缺失
3. 语音识别结果为口语文本，需要转为书面语才能有效使用

## [S2] 解决方案

新增 Push-to-Talk 语音输入模式：移动端长按输入框启动录音，松手停止并自动优化为书面语。

**核心交互：**
- 长按输入框 500ms → 显示语音交互覆盖层 + 开始录音
- 保持按住 → 波形动画表示聆听中
- 松手 → 停止录音 → ASR 识别 → LLM 重写 → 填入输入框
- 上滑超过阈值 → 取消录音

**覆盖层 UI（输入框上方轻量浮层）：**
```
┌─────────────────────────────┐
│  消息列表（保持可见）         │
│  ...                        │
├─────────────────────────────┤
│  🔴 [波形动画]               │  ← 浮层（覆盖输入框区域）
│  松开发送 · 上滑取消         │
└─────────────────────────────┘
```

**关键：** 覆盖层仅覆盖输入框区域（`position: fixed`，底部对齐输入框位置），消息列表保持可见，不全屏。

## [S3] 架构

```
ChatInput (触摸层)
    │ touchstart (长按 500ms 阈值)
    │ touchend
    ↓
PushToTalkController (核心控制器)
    ├─ AudioRecorder ← 现有，复用
    ├─ AsrClient ← 现有，复用
    └─ VoiceRewriter ← 新增，LLM 口语→书面语
         ↓
    重写文本 → ChatInput.value
```

**模块职责：**
| 模块 | 职责 |
|------|------|
| ChatInput | 触摸手势识别，长按回调 |
| PushToTalkController | 录音/ASR/重写编排，状态机 |
| VoiceRewriter | 轻量 LLM 调用，口语→书面语 |
| VoiceOverlay | 复用，录音/识别/优化状态 UI |

## [S4] 状态机

```
idle → listening → recognizing → rewriting → done
  ↑                                         │
  └─────────────────────────────────────────┘
         (任何阶段松手/取消/失败)
```

**状态流转：**

| 状态 | UI | 行为 |
|------|-----|------|
| `idle` | 无浮层 | 等待长按触发 |
| `listening` | 浮层 + 波形 + "松开发送" | 录音中，每 3 秒递增识别 |
| `recognizing` | 浮层 + "识别中..." | 松手，等待最终 ASR |
| `rewriting` | 浮层 + "优化中..." | ASR 完成，LLM 重写中 |
| `done` | 关闭浮层 | 重写文本填入输入框，回到 idle |

**取消路径：**
- `listening` → 上滑取消 → `idle`
- `recognizing` → 取消 → `idle`（ASR 无法中断，但丢弃结果）
- `rewriting` → 取消 → `idle`（LLM 无法中断，但丢弃结果）

## [S5] VoiceRewriter 模块

**职责：** 将 ASR 识别的口语文本转为书面语，带书籍上下文。

**API 设计：**
```typescript
interface VoiceRewriterConfig {
  apiKey: string;
  baseUrl: string;
}

class VoiceRewriter {
  constructor(config: VoiceRewriterConfig);
  
  async rewrite(
    rawText: string,
    bookContext?: {
      title: string;
      description?: string;
    }
  ): Promise<string>;
}
```

**Prompt 策略：**
```
你是文本优化助手。将用户口语化的表达转为书面语，保留原意但更正式。

${bookContext ? `当前书籍：${bookContext.title}。${bookContext.description || ''}` : ''}

用户语音：${rawText}

请输出优化后的书面语：
```

**LLM 选择：**
- 复用 `chat` 角色配置（与 Agent 使用相同模型）
- 流式响应（显示逐字输出效果）

## [S6] ChatInput 触摸事件集成

**新增配置项：**
```typescript
interface ChatInputOptions {
  // ...existing
  onLongPress?: () => void;
}
```

**触摸事件处理（仅移动端）：**
- `touchstart` → 启动长按计时器，`e.preventDefault()` 阻止键盘弹起
- `touchmove` → 检测上滑，超过阈值则取消
- `touchend` → 触发 `onLongPress` 回调（如果未取消）

**移动端行为：**
- 长按输入框 → 触发 `onLongPress` → 显示覆盖层
- 不显示麦克风按钮（`Platform.isMobile` 时 `showVoiceButton=false`）
- 桌面端：保留麦克风按钮，不注册 touch 事件

## [S7] 配置与依赖

**配置来源：**
| 配置 | 来源 | 用途 |
|------|------|------|
| ASR apiKey/baseUrl | `resolveRoleConfig("tts")` | MiMo ASR 调用 |
| LLM apiKey/baseUrl | `resolveRoleConfig("chat")` | VoiceRewriter 调用 |
| 书籍上下文 | `ContextManager` / `BookManager` | 重写时提供书名/摘要 |

**文件清单：**

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/services/push-to-talk.ts` | 新建 | PushToTalkController 核心类 |
| `src/services/voice-rewriter.ts` | 新建 | VoiceRewriter LLM 重写模块 |
| `src/components/chat-input/voice-overlay.ts` | 复用 | 覆盖层 UI（可能需微调） |
| `src/components/chat-input/chat-input.ts` | 修改 | 新增 touch 事件 + onLongPress |
| `src/views/sidebar/sidebar-view.ts` | 修改 | 集成 PushToTalkController |
| `src/components/chat-input/chat-input.css` | 修改 | 覆盖层样式 |
