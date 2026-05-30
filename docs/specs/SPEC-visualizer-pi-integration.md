# SPEC: PI 可视化集成到状态机 VISUALIZER 节点

## 1. 目标

将 PI skill 执行从入口拦截模式改为状态机内部集成，使 PI 在生成图表时能拿到 LangGraph 状态机收集的完整书籍分析数据，而非仅凭书名和一句话摘要。

### 当前问题

`FrontendAgent.chat()` 在调用状态机之前，通过 `isSkillIntent()` 正则匹配拦截用户请求（如"帮我生成思维导图"），直接转给 PI。PI 只收到：

- 书名 + 作者
- 当前章节 ID
- 一句话 `docDescription`

状态机（Router → Inspectional → Analytical → VISUALIZER）完全不执行，PI 缺乏书籍实际内容。

### 目标流程

```
用户请求 "为第三章生成思维导图"
  → S0 Router: 分类深度、重写查询、设置 allowedTools=["excalidraw"]
  → S1 Inspectional: 分析目录结构、提取章节要点 → structuralAnalysis
  → S2 Analytical: 深度分析 → analysisResult
  → hasDiagramIntent=true → VISUALIZER 节点
  → VISUALIZER: 拿到 structuralAnalysis + analysisResult
  → PI 可用 → 把完整分析数据传给 PI 生成图表
  → PI 不可用 → 回退到 ExcalidrawAutomate 插件路径
```

---

## 2. 涉及文件

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `src/agent/pi/types.ts` | 修改 | PiSkillContext 新增分析数据字段 |
| `src/agent/pi/pi-manager.ts` | 修改 | buildPrompt 追加分析数据块 |
| `src/agent/pi/pi-context.ts` | 修改 | buildSkillContext 接受新字段 |
| `src/agent/index.ts` | 修改 | configurable 传 piManager/piConfig；删除入口拦截 |
| `src/agent/graph/nodes/visualizer.ts` | 修改 | 新增 PI 执行路径作为首选后端 |
| `src/agent/graph/node-io.ts` | 修改 | VisualizerInput 新增 tocSummary |
| `src/agent/router/intent-router.ts` | 修改 | 删除 isSkillIntent 方法 |

---

## 3. 详细设计

### 3.1 PiSkillContext 类型扩展

**文件**: `src/agent/pi/types.ts`

`PiSkillContext.context` 新增三个可选字段：

```typescript
context: {
  currentSection: string;
  analysisSummary: string;
  analysisData?: string;        // VISUALIZER 传入的完整分析内容（S2 analysisResult 或 S1 structuralAnalysis）
  structuralAnalysis?: string;  // S1 结构分析（depth=1 时可用）
  tocSummary?: string;          // S1 目录概览
};
```

向后兼容 — 现有调用方不传这些字段即可。

### 3.2 buildPrompt 追加分析数据

**文件**: `src/agent/pi/pi-manager.ts` — `buildPrompt()` 方法

当 `context.context.analysisData` 存在时，在 prompt 中追加：

```
## 分析内容
{analysisData（截断至 6000 字符）}

## 结构分析
{structuralAnalysis（截断至 4000 字符）}

## 目录概览
{tocSummary（截断至 2000 字符）}
```

这些块放在 `## 任务上下文` 之后、`## 可用 Skill` 之前，确保 PI 能看到完整的分析数据。

### 3.3 buildSkillContext 扩展

**文件**: `src/agent/pi/pi-context.ts`

`buildSkillContext()` 的 options 参数和返回值同步新增 `analysisData?`、`structuralAnalysis?`、`tocSummary?`。

### 3.4 configurable 注入 PiProcessManager

**文件**: `src/agent/index.ts` — `buildGraphConfigurable()` 返回值

在 line 480 的返回对象中新增：

```typescript
piManager: context.vault.plugin?.settings?.piEnabled ? this.piManager : undefined,
piConfig: piEnabled ? this.piManager.buildConfig(...) : undefined,
```

`piConfig` 构建逻辑：复用当前 `handleSkillRequest` 中的参数（apiKey、model、providerId、customPiPath），在 `buildGraphConfigurable` 中构建一次，传入 configurable。

### 3.5 visualizerNode 改写（核心）

**文件**: `src/agent/graph/nodes/visualizer.ts`

在现有 ExcalidrawAutomate 逻辑之前，新增 PI 执行路径：

```
visualizerNode 入口
  ├── 取 piManager + piConfig from config.configurable
  ├── 取 sourceContent = analysisResult || structuralAnalysis
  │
  ├── PI 可用？
  │   ├── YES → 构建 PiSkillContext（含 analysisData=sourceContent）
  │   │        → piManager.executeSkill()
  │   │        → 成功 → return { analysisResult: 结果描述 }
  │   │        → 失败 → fall through
  │   └── NO → fall through
  │
  └── 现有路径：ExcalidrawAutomate / SenseNova infographic
      → 成功 → return { analysisResult: 图表描述 }
      → 失败 → return { analysisResult: 错误信息 }
```

新增导入：
- `PiProcessManager` from `../../pi/pi-manager.js`
- `PiConfig` from `../../pi/types.js`
- `detectPiCli`, `buildSkillContext`, `scanSkillDescriptions`, `generateOutputPath` from `../../pi/pi-context.js`

PI 执行时的回调处理：
- `onProgress` → `config.configurable.callbacks.onProgress`
- `onStreamDelta` → `config.configurable.callbacks.onContent`

### 3.6 VisualizerInput 扩展

**文件**: `src/agent/graph/node-io.ts`

```typescript
export interface VisualizerInput {
  analysisResult: string;
  structuralAnalysis: string;
  rewrittenQuery: string;
  pdfName: string;
  tocSummary: string;  // 新增
}
```

### 3.7 移除入口拦截

**文件**: `src/agent/index.ts`

1. 删除 `chat()` 中 isSkillIntent 检查（约 line 538-541）
2. 删除 `continueChat()` 中同样检查（约 line 555-558）
3. 删除 `handleSkillRequest()` 方法整体（约 line 567-654）
4. 清理不再需要的导入（`detectPiCli`, `buildSkillContext`, `scanSkillDescriptions`, `generateOutputPath`）

**文件**: `src/agent/router/intent-router.ts`

删除 `isSkillIntent()` 方法（约 line 122-132）。

注意：`intent-rules.json` 中的 `action_output` 规则保持不变，它已经能把 `excalidraw` 加入 `allowedTools`，确保请求路由到 VISUALIZER。

---

## 4. 数据流对比

### Before

```
用户 "生成思维导图"
  → isSkillIntent() 拦截
  → handleSkillRequest()
  → PI prompt: 书名 + 一句话摘要
  → PI 凭训练数据编造内容
```

### After

```
用户 "为第三章生成思维导图"
  → S0 Router: depth=2, allowedTools=["excalidraw"]
  → S1 Inspectional: 分析目录 → structuralAnalysis="第三章讲STEPPS六个原则..."
  → S2 Analytical: 深度分析 → analysisResult="社交货币是...诱因是...情绪是..."
  → VISUALIZER 节点:
    → sourceContent = analysisResult（4000+ 字符的真实数据）
    → PI prompt: 书名 + 完整分析内容 + 结构分析 + 目录
    → PI 基于真实数据生成图表
```

---

## 5. 边界条件

| 场景 | 处理 |
|------|------|
| PI 未安装 | piManager=undefined → 跳过 PI → 走 ExcalidrawAutomate |
| PI 执行超时 | executeSkill 内部 150s 超时 → 返回失败 → 走 ExcalidrawAutomate |
| PI 正忙 | piManager.isBusy()=true → 跳过 PI → 走 ExcalidrawAutomate |
| PI 生成成功 | return analysisResult → FORMATTER 格式化输出 |
| Excalidraw 插件也未安装 | 返回错误提示 |
| depth=1（只有 structuralAnalysis） | analysisData = structuralAnalysis |
| depth=2/3（有 analysisResult） | analysisData = analysisResult |
| 无书籍上下文（pdfName 为空） | PI 不触发，走 ExcalidrawAutomate |

---

## 6. 实施顺序

```
Phase 1: 类型扩展（无运行时影响）
  Step 1: types.ts — PiSkillContext 新增字段
  Step 3: pi-context.ts — buildSkillContext 新增参数
  Step 7: node-io.ts — VisualizerInput 新增 tocSummary

Phase 2: 数据注入
  Step 2: pi-manager.ts — buildPrompt 追加分析数据块
  Step 4: index.ts — configurable 新增 piManager/piConfig

Phase 3: 核心逻辑
  Step 5: visualizer.ts — 新增 PI 执行路径

Phase 4: 清理
  Step 6: 移除入口拦截（index.ts + intent-router.ts）
```

---

## 7. 验证计划

1. `npm run build` — 编译通过
2. `npm run test:run` — 单元测试通过
3. 部署到 test-vault，手动测试：
   - "帮我生成这本书的思维导图" → 状态机流转 → PI 收到分析数据 → 生成 excalidraw 文件
   - 检查 Obsidian console 日志中 `[Visualizer] PI available, using PI backend`
   - 检查 PI 生成的文件内容是否基于书籍实际内容
4. 无 PI 环境测试：回退到 ExcalidrawAutomate 正常工作
