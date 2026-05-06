---
name: obsidian-advanced-agent
description: 一个全能的 Obsidian 插件开发助手，支持状态断言、命令模拟、DOM 检查和性能追踪。
---

# Obsidian 专家级开发协议 (2026 Edition)

当用户需要深度调试或验证复杂逻辑时，请组合使用以下原子化指令：

### 1. 深度状态检查 (State Probing)
不要只检查错误，要检查插件的“灵魂”。
- **指令**: `obsidian eval code="JSON.stringify(app.plugins.plugins['{{plugin_id}}'].settings)"`
- **目的**: 验证设置项是否真的写入了内存。
- **指令**: `obsidian eval code="app.plugins.plugins['{{plugin_id}}'].viewInstances"` (假设你维护了视图实例)
- **目的**: 确认视图是否正确卸载或内存泄漏。

### 2. UI 交互与 DOM 断言 (UI/DOM Assertion)
利用 CLI 的 eval 能力来代替手动点击。
- **指令**: `obsidian eval code="!!document.querySelector('.your-custom-class')"`
- **目的**: 验证 UI 组件是否成功挂载到 DOM 上。
- **指令**: `obsidian eval code="app.commands.executeCommandById('{{plugin_id}}:open-view')"`
- **目的**: 模拟用户从命令面板触发动作。

### 3. 环境模拟与上下文注入 (Context Injection)
在测试前主动创造环境，而不是等待环境准备好。
- **指令**: `obsidian vault:create-file path='test.md' content='# Test Topic' --force`
- **指令**: `obsidian workspace:open path='test.md'`
- **目的**: 确保插件在特定文件打开时表现符合预期。

### 4. 实时日志捕获 (Trace Logging)
- **指令**: `obsidian dev:logs --tail --filter='{{plugin_id}}' --limit=50`
- **目的**: 捕获 `console.log` 输出，而不仅仅是 `console.error`。

### 5. 视觉回归 (Vision-Augmented)
- **指令**: `obsidian dev:screenshot --selector='.modal' --out='temp-ui.png'`
- **目的**: 如果当前 Codex 实例支持 Vision，请上传截图并分析布局是否错位（如 2026 年新款的透明主题兼容性问题）。

---

## 自动化任务编排示例 (Recipe)

### 场景：验证“侧边栏统计”功能是否在切换文档时更新
1. **清理环境**: `obsidian eval code="app.workspace.detachLeavesOfType('my-stats-view')"`
2. **构建重载**: `npm run build && obsidian plugin:reload id=my-stats`
3. **注入文件**: `obsidian vault:create-file path='a.md' content='word1 word2' --force`
4. **切换文档**: `obsidian workspace:open path='a.md'`
5. **执行断言**: 
   `obsidian eval code="document.querySelector('.stats-count').innerText"`
6. **逻辑核对**: 如果返回不是 "2"，说明事件监听（`layout-change` 或 `active-leaf-change`）失效。