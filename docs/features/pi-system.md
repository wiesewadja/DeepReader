# PI 系统（F-30 ~ F-31）

> Obsidian 插件进程不适合跑重计算。Agent 行为不透明是调试噩梦。

---

## F-30: PI 子进程

- **为什么存在**: Obsidian 插件进程不适合跑重计算。独立进程隔离崩溃风险，支持更复杂的 Agent 任务。PI 崩溃不会把 Obsidian 一起拖死。
- **用户故事**: 作为开发者/高级用户，我希望 DeepReader 用持久化 PI 子进程管理 AI 任务，而非每次都重启
- **前置条件**: 已配置 LLM API Key
- **输入**: 启动 Obsidian / 触发 AI 任务
- **输出**: PI 子进程（Node.js）常驻，接收 RPC 调用
- **验收标准**:
  - [ ] 启动 Obsidian 时自动拉起 PI
  - [ ] PI 崩溃后自动重启（最多 3 次）
  - [ ] RPC 调用支持超时和重试
  - [ ] PI 配置（skills、tools）通过参数注入
  - [ ] 关闭 Obsidian 时 PI 也关闭
  - [ ] PI 日志可查看
- **对应测试**:
  - 单元: `tests/unit/agent/pi/{pi-client,pi-config,pi-context,pi-manager}.test.ts`
  - E2E: `tests/e2e/specs/pi-rpc.e2e.ts`、`pi-agent.e2e.ts`、`pi-detection.e2e.ts`
  - 覆盖状态: ✅ 强
- **详见**: product-manual §2.3

---

## F-31: PI 可视化器

- **为什么存在**: Agent 行为不透明是调试噩梦。没有 trace 就无法诊断"为什么 AI 给了这个回答"。可视化让开发者（和产品作者）能看懂 Agent 在干什么，是迭代改进 AI 质量的基础。
- **用户故事**: 作为开发者/调试者，我希望实时看到 PI 子进程的内部状态（节点、tokens、tool calls）
- **前置条件**: F-30 已激活
- **输入**: 命令 `Debug: Test mindmap skill` / 自动触发
- **输出**: 可视化面板（含图、节点状态、统计）
- **验收标准**:
  - [ ] 显示当前 LangGraph 节点
  - [ ] 显示 token 用量
  - [ ] 显示工具调用历史
  - [ ] 实时刷新（每秒）
  - [ ] 关闭后不残留 DOM
- **对应测试**:
  - E2E: `tests/e2e/specs/pi-visualizer.e2e.ts`、`visualizer-pi.e2e.ts`
  - 覆盖状态: ✅ 强
- **详见**: product-manual §2.3
