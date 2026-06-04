# Plan C: 端到端验证

> 验证项目，**依赖** Plan A + Plan B 都完成。0 代码改动。
> 跑一遍真实用户场景，确认链路全通。

---

## 目标

Obsidian 启动 → DeepReader 调 xiting_render_diagram → vault 出现 excalidraw 文件 → 关闭 Obsidian 子进程无 orphan。

---

## 验收步骤

- [ ] C1: 启动 Obsidian（开发模式：`npm run dev` + `npm run deploy:daily`）
- [ ] C2: 日志显示 `[INFO] Xiting MCP server connected`（在 Obsidian Console: Cmd+Option+I）
- [ ] C3: 在 DeepReader chat 输入"为最近这本书画个思维导图"
- [ ] C4: vault 路径下出现新文件：`DeepReader/Excalidraw/{book}-{timestamp}.excalidraw.md`
- [ ] C5: visualizer node 返回的不再是占位文案（看到"图表已生成: ..."）
- [ ] C6: 杀 Obsidian 进程，hermes 子进程跟着死（`ps aux | grep "mcp agent-serve"` 应为空）
- [ ] C7: 重启 Obsidian，xiting MCP 重新连接成功（验证 reconnect 逻辑）

---

## 边界场景

- [ ] C8: vault_path 不存在（用户改 vault 路径但 xiting profile 没改） → visualizer 报清晰错误
- [ ] C9: LLM 输出不是合法 excalidraw JSON → 工具报解析错误，不写半成品文件
- [ ] C10: 用户重复触发同一请求 → 不会写重复文件（命名加时间戳已经避免，但确认无 race）

---

## 风险

- 中：LLM 输出格式与 visualizer 解析对得上否（端到端才能验）

## 范围外

- 性能压测
- 多个 vault 切换
- xiting profile 之外的业务场景

## 完成后

- 三个 plan 标 completed
- 写一份"xiting-mcp-server 集成总结"放到 `DeepReader/.hermes/summaries/`
- 在 DeepReader 项目 CHANGELOG 记一笔
