# Spec：Excalidraw 可视化绘图工具

## 目标

为 DeepReader Agent 增加 Excalidraw 工具，支持通过自然语言指令（如"画一个思维导图"）自动生成可视化图形。当用户表达可视化意图时，Agent 通过 `diagram-helper` 生成 Excalidraw JSON 元素数组，最终写入 `.excalidraw` 文件并通过 `![[Excalidraw/xxx.excalidraw]]` 嵌入聊天回复。

## 命令

- 构建：`npm run build`
- 单元测试：`npm run test:run`
- 单个测试：`npx vitest run tests/unit/agent/tools/excalidraw.test.ts`
- 开发：`npm run dev`
- 部署：`npm run deploy` → test-vault

## 受影响模块

- `src/agent/tools/excalidraw.ts` — 新增，Excalidraw 工具执行器（碰撞检测、JSON 构建、Vault API 写入）
- `src/agent/tools/definitions/excalidraw.ts` — 新增，LangChain `tool()` 包装，闭包注入 `ToolContext`
- `src/agent/tools/index.ts` — 修改，注册 `createExcalidrawTool(ctx)`
- `src/agent/graph/utils/diagram-helper.ts` — 新增，意图检测 + LLM 生成 Excalidraw JSON
- `src/agent/graph/nodes/visualizer.ts` — 修改，集成图表生成并追加 embed 到分析结果
- `src/agent/graph/edges.ts` — 修改，根据可视化意图路由到 `VISUALIZER`
- `src/agent/graph/nodes/formatter.ts` — 修改，保护 `![[...]]` 嵌入语法不被 wiki 链接处理误删
- `src/agent/graph/prompts/formatter-prompt.ts` — 修改，提示保留 Excalidraw 嵌入语法
- `src/agent/graph/prompts/router-prompt.ts` — 修改，可视化请求判定为 `depth=1`
- `src/agent/graph/subgraphs/plan-execute.ts` — 修改，综合提示保留 Excalidraw 嵌入语法
- `.agents/skills/excalidraw-visualizer/SKILL.md` — 新增，Agent skill 指引
- `tests/unit/agent/tools/excalidraw.test.ts` — 新增，工具执行器单元测试
- `tests/unit/agent/graph/utils/diagram-helper.test.ts` — 新增，意图检测与生成逻辑测试
- `tests/unit/agent/graph/nodes/visualizer.test.ts` — 新增，Visualizer 节点测试
- `tests/unit/agent/graph/visualization-flow.test.ts` — 新增，路由与流程集成测试

## 技术约束

- 不依赖 `ExcalidrawAutomate` 全局对象，直接通过 Obsidian Vault API 写入 `.excalidraw` JSON 文件
- 遵循现有 LangChain `tool()` 模式（参考 `write-note.ts`）
- 日志用 `utils/logger.ts`
- TypeScript 严格模式（strictNullChecks）
- 通过 `zod` schema 定义工具参数

## 代码风格

```typescript
// 工具执行器：ToolExecutor 接口
export const excalidrawTool: ToolExecutor = {
  async execute(args: Record<string, unknown>, context: ToolContext): Promise<string> {
    // ...
  },
};

// LangChain tool() 包装：ToolFactory 函数
export const createExcalidrawTool: ToolFactory = (ctx: ToolContext) =>
  tool(async ({ filename, elements }) => {
    return excalidrawTool.execute({ filename, elements }, ctx);
  }, { name: 'excalidraw', description: '...', schema: z.object({...}) });
```

## 测试策略

- 测试层级：单元（Vitest）
- 测试位置：
  - `tests/unit/agent/tools/excalidraw.test.ts`
  - `tests/unit/agent/graph/utils/diagram-helper.test.ts`
  - `tests/unit/agent/graph/nodes/visualizer.test.ts`
  - `tests/unit/agent/graph/visualization-flow.test.ts`
- 覆盖范围：
  - mock Vault adapter，验证文件写入与 embed 返回
  - 验证碰撞检测、语义校验、边交点、viewport 计算
  - 验证意图检测、LLM JSON 解析失败降级
  - 验证 Visualizer 节点在缺 model/context/内容时的降级
  - 验证各阶段路由到 `VISUALIZER` 的条件
- 不依赖外部 API（mock Vault adapter 与 LLM）

## 边界

**Always**
- 跑 `npm run test:run` 和 `npm run build` 再提交
- 遵循命名约定
- 新增方法写 JSDoc

**Ask First**
- 新增 npm 依赖
- 改构建配置

**Never**
- 提交密钥到 git
- `console.log` 替代 `utils/logger.ts`

## 验收标准

1. `src/agent/tools/excalidraw.ts` 存在，导出 `excalidrawTool` 执行器
2. `src/agent/tools/definitions/excalidraw.ts` 存在，导出 `createExcalidrawTool` 工厂函数
3. `src/agent/tools/index.ts` 中 `createLangChainTools` 包含 `createExcalidrawTool(ctx)`
4. `src/agent/graph/utils/diagram-helper.ts` 能正确检测"画图/思维导图/流程图"等意图
5. `src/agent/graph/nodes/visualizer.ts` 在可视化意图下生成 `.excalidraw` 文件并将 embed 追加到分析结果
6. `src/agent/graph/edges.ts` 在 S1/S2-Pre/S2/S3 后将可视化意图路由到 `VISUALIZER`
7. Formatter 输出中的 `![[Excalidraw/xxx.excalidraw]]` 不被 wiki 链接清洗误删
8. 写入文件名经过校验，禁止路径穿越与非法字符
9. `npm run build` 通过
10. `npm run test:run` 中相关测试通过
11. `.agents/skills/excalidraw-visualizer/SKILL.md` 存在，包含使用指引
