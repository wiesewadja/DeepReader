# MiCode 开发体验扩展

基于 `self-extend` 能力，可以通过创建 Tool/Hook/Skill/Workflow 来优化开发流程。

## 扩展文件位置

```
.mimocode/
├── tools/           # Tool 脚本
├── hooks/           # Hook 脚本
├── skills/          # Skill 文档
└── workflows/       # Workflow 脚本
```

---

## Tool 建议

### 1. deploy（一键部署）

**用途**：自动执行构建、部署、重载插件

**实现**：
```typescript
// .mimocode/tools/deploy.ts
import { tool } from "@mimo-ai/plugin"
import { execSync } from "child_process"

export default tool({
  description: "部署 DeepReader 到 Obsidian 并重载",
  args: {
    target: tool.schema.string().optional().describe("部署目标：dev 或 daily"),
    reload: tool.schema.boolean().optional().describe("是否自动重载"),
  },
  async execute(args, ctx) {
    const target = args.target || "dev"
    const reload = args.reload !== false

    execSync(`npm run deploy:${target}`, { cwd: ctx.directory, stdio: "pipe" })

    if (reload) {
      execSync(`obsidian plugin:reload id=deepreader-dev`, { stdio: "pipe" })
    }

    return `✅ 部署完成 (${target})${reload ? "，插件已重载" : ""}`
  },
})
```

### 2. obsidian-eval（运行时执行器）

**用途**：在运行中的 Obsidian 里执行 JavaScript 代码

**实现**：
```typescript
// .mimocode/tools/obsidian-eval.ts
import { tool } from "@mimo-ai/plugin"
import { execSync } from "child_process"

export default tool({
  description: "在 Obsidian 中执行 JavaScript",
  args: {
    code: tool.schema.string().describe("要执行的代码"),
    timeout: tool.schema.number().optional().describe("超时时间(ms)"),
  },
  async execute(args) {
    const timeout = args.timeout || 10000
    const escaped = args.code.replace(/"/g, '\\"')
    return execSync(`obsidian-cli eval "${escaped}"`, {
      encoding: "utf-8",
      timeout,
    })
  },
})
```

### 3. smoke-test（冒烟测试）

**用途**：快速运行冒烟测试

**实现**：
```typescript
// .mimocode/tools/smoke-test.ts
import { tool } from "@mimo-ai/plugin"
import { execSync } from "child_process"

export default tool({
  description: "运行 DeepReader 冒烟测试",
  args: {
    level: tool.schema.string().optional().describe("core 或 full"),
    only: tool.schema.string().optional().describe("指定场景，逗号分隔"),
  },
  async execute(args, ctx) {
    const level = args.level || "core"
    const cmd = args.only
      ? `node scripts/smoke/smoke.mjs --only ${args.only}`
      : `node scripts/smoke/smoke.mjs --level ${level}`

    return execSync(cmd, { cwd: ctx.directory, encoding: "utf-8" })
  },
})
```

### 4. agent-query（Agent 对话测试）

**用途**：测试 Agent 的回复质量

**实现**：
```typescript
// .mimocode/tools/agent-query.ts
import { tool } from "@mimo-ai/plugin"
import { execSync } from "child_process"

export default tool({
  description: "测试 Agent 回复质量",
  args: {
    query: tool.schema.string().describe("测试查询"),
  },
  async execute(args, ctx) {
    const escaped = args.query.replace(/"/g, '\\"')
    return execSync(
      `node scripts/smoke/agent-live-test.mjs "${escaped}"`,
      { cwd: ctx.directory, encoding: "utf-8" }
    )
  },
})
```

---

## Hook 建议

### 1. 危险命令拦截

**用途**：阻止可能破坏系统的命令

**实现**：
```typescript
// .mimocode/hooks/safety-guard.ts
export default {
  "tool.execute.before": async (input, output) => {
    if (input.tool === "bash") {
      const cmd = output.args.command || ""
      const blocked = ["rm -rf /", "sudo rm", "> /dev/sda"]
      if (blocked.some((p) => cmd.includes(p))) {
        output.cancel = true
        output.cancelReason = "危险命令已拦截"
      }
    }
  },
}
```

### 2. 命令执行日志

**用途**：记录所有 bash 命令执行历史

**实现**：
```typescript
// .mimocode/hooks/command-logger.ts
import { appendFileSync } from "fs"
import { join } from "path"

export default {
  "tool.execute.after": async (input, output) => {
    if (input.tool === "bash") {
      const log = `[${new Date().toISOString()}] ${output.args.command}\n`
      appendFileSync(join(process.cwd(), ".mimocode", "command.log"), log)
    }
  },
}
```

### 3. 系统提示注入

**用途**：为 Agent 注入项目上下文

**实现**：
```typescript
// .mimocode/hooks/project-context.ts
export default {
  "experimental.chat.system.transform": async (input, output) => {
    output.system.push(`
## 项目上下文
- 这是 DeepReader Obsidian 插件项目
- 核心功能：PDF/EPUB 解析、AI Agent、微信读书同步
- 测试：npm run test:run | npm run smoke:core
- 部署：npm run deploy
    `)
  },
}
```

---

## Skill 建议

### 1. deepreader-dev（开发工作流）

**文件**：`.mimocode/skills/deepreader-dev/SKILL.md`

```markdown
---
name: deepreader-dev
description: DeepReader 开发工作流指南
---

# DeepReader 开发工作流

## 快速开始

1. 安装依赖：npm install
2. 启动开发：npm run dev
3. 部署测试：npm run deploy

## 测试层级

| 层级 | 命令 | 时长 |
|------|------|------|
| 单元 | npm run test:run | ~55s |
| 冒烟 | npm run smoke:core | ~10s |
| 轻量 E2E | npm run e2e-light | ~90s |

## 常见任务

### 添加新功能
1. 写单元测试
2. 运行 npm run test:run
3. 写冒烟测试
4. 运行 npm run smoke:core

### 修复 Bug
1. 先写复现测试（必须失败）
2. 修复代码
3. 确认测试通过
```

---

## Workflow 建议

### 1. quick-dev-cycle（快速开发循环）

**用途**：一键完成构建 → 部署 → 冒烟测试

**文件**：`.mimocode/workflows/quick-dev-cycle.js`

```javascript
export const meta = {
  name: "quick-dev-cycle",
  description: "快速开发循环：构建 → 部署 → 冒烟测试",
  phases: [
    { title: "构建", detail: "TypeScript 类型检查" },
    { title: "部署", detail: "部署到 Obsidian" },
    { title: "冒烟测试", detail: "验证核心功能" },
  ],
}

phase("构建")
await bash("npm run build:check")

phase("部署")
await bash("npm run deploy")

phase("冒烟测试")
const result = await bash("npm run smoke:core")
if (result.includes("FAIL")) {
  log("❌ 冒烟测试失败")
  process.exit(1)
}
log("✅ 全部通过")
```

### 2. full-test-suite（完整测试套件）

**用途**：运行完整测试流程（单元 + 冒烟 + 轻量 E2E）

**文件**：`.mimocode/workflows/full-test-suite.js`

```javascript
export const meta = {
  name: "full-test-suite",
  description: "完整测试套件：单元 → 冒烟 → 轻量 E2E",
  phases: [
    { title: "单元测试", detail: "~55s" },
    { title: "冒烟测试", detail: "~10s" },
    { title: "轻量 E2E", detail: "~90s" },
  ],
}

phase("单元测试")
await bash("npm run test:run")

phase("冒烟测试")
await bash("npm run smoke:core")

phase("轻量 E2E")
await bash("npm run e2e-light")

log("✅ 所有测试通过")
```

### 3. deploy-and-verify（部署验证）

**用途**：部署后运行验证脚本

**文件**：`.mimocode/workflows/deploy-and-verify.js`

```javascript
export const meta = {
  name: "deploy-and-verify",
  description: "部署并验证插件状态",
  phases: [
    { title: "部署" },
    { title: "重载插件" },
    { title: "验证" },
  ],
}

phase("部署")
await bash("npm run deploy")

phase("重载插件")
await bash("obsidian plugin:reload id=deepreader-dev")

phase("验证")
await bash("npm run verify-deploy")

log("✅ 部署验证通过")
```

### Workflow 调用方式

```
# 在 MiCode 对话中
/quick-dev-cycle
帮我运行 full-test-suite workflow

# 或使用 workflow 工具
workflow({ operation: "run", name: "quick-dev-cycle" })
```

### Workflow API 参考

| API | 说明 |
|-----|------|
| `phase(title)` | 进入新阶段 |
| `log(message)` | 输出日志 |
| `bash(cmd)` | 执行 shell 命令 |
| `readFile(path)` | 读取文件 |
| `writeFile(path, content)` | 写入文件 |
| `glob(pattern)` | 文件匹配 |
| `agent(prompt, opts)` | 派生子 agent |
| `parallel(thunks)` | 并行执行 |

---

## 参考

- [self-extend skill 文档](https://mimocode.ai/docs/skills/self-extend)
- [Tool API 参考](https://mimocode.ai/docs/api/tool)
- [Hook API 参考](https://mimocode.ai/docs/api/hook)
- [Workflow API 参考](https://mimocode.ai/docs/api/workflow)
