---
name: obsidian-e2e-tester
description: 使用 WebdriverIO 和 wdio-obsidian-service 执行完整的端到端插件测试。
---

# Obsidian E2E 自动化测试流程

当用户要求“进行深度测试”或“验证 UI 逻辑”时，请执行以下操作：

### 1. 环境自检
- 检查是否存在 `wdio.conf.mts`。如果不存在，建议用户运行 `npm init wdio@latest` 并安装 `wdio-obsidian-service`。
- 确保测试目录（通常是 `tests/specs/`）已准备就绪。

### 2. 自动化执行步骤
使用 `bash` 调用以下逻辑：
1. **构建插件**: `npm run build`。
2. **启动测试**: 执行 `npx wdio run wdio.conf.mts`。
   - 注意：该工具会自动下载指定版本的 Obsidian 并启动隔离的 Vault。
3. **获取断言结果**: 捕获终端输出。`wdio-obsidian-service` 会提供详细的失败堆栈和截图路径。

### 3. 智能修复循环
- **如果测试失败**: 
    - 使用 `read_file` 读取失败的测试脚本（`.e2e.ts`）。
    - 结合 `obsidian dev:errors`（如果正在开发中）或 WDIO 日志定位代码 Bug。
    - 修改源码后重新触发此 Skill。

### 4. 辅助指令集
告知用户你可以通过 `browser.executeObsidianCommand()` 触发任何命令，或通过 `browser.execute()` 在 Obsidian 环境内注入 JS。