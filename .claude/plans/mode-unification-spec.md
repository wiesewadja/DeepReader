# #8 Mode Unification Spec — isProactive/isSocratic → mode

## 目标

将图状态中已废弃的 `isProactive` / `isSocratic` 布尔对完全替换为统一的 `mode: EngineMode` 字段。迁移已 80% 完成（`EngineMode` 类型、`resolveMode()` 读取、边/节点路由），本 spec 覆盖剩余的 20%。

## 当前状态

```ts
// state.ts — 三者并存
isProactive: Annotation<boolean>(),      // @deprecated
isSocratic: Annotation<boolean>(),       // @deprecated
mode: Annotation<EngineMode>(),          // 新版

// resolveMode() — mode 优先，booleans 兜底
function resolveMode(state) {
  if (state.mode) return state.mode;
  if (state.isProactive) return 'proactive';
  if (state.isSocratic) return 'socratic';
  return 'normal';
}
```

## 目标状态

```ts
// state.ts — 只保留 mode
mode: Annotation<EngineMode>(overwriteWithDefault('normal')),

// resolveMode() — 直接返回 mode，无兜底
function resolveMode(state) {
  return state.mode || 'normal';
}
```

## 变更清单（7 个文件）

### 1. `src/agent/tools/types.ts` — ToolContext

```diff
- isProactive?: boolean;
- isSocratic?: boolean;
+ mode?: EngineMode;
```

同时添加 `import type { EngineMode } from '../graph/state.js';`

### 2. `src/agent/index.ts` — runGraphEngine 的初始状态

```diff
- isSocratic: context.isSocratic ?? false,
- isProactive: context.isProactive ?? false,
- mode: (context.isProactive ? 'proactive' : context.isSocratic ? 'socratic' : 'normal') as EngineMode | undefined,
+ mode: context.mode || 'normal' as EngineMode,
```

### 3. `src/agent/graph/state.ts` — 图状态定义

```diff
- /** @deprecated Use mode */
- isProactive: Annotation<boolean>(),
- /** @deprecated Use mode */
- isSocratic: Annotation<boolean>(),
```

### 4. `src/agent/graph/node-io.ts` — FormatterInput

```diff
- /** @deprecated Use mode */
- isProactive?: boolean;
- /** @deprecated Use mode */
- isSocratic?: boolean;
```

### 5. `src/agent/graph/utils/engine-helpers.ts` — resolveMode()

```diff
  export function resolveMode(state: { mode?: EngineMode; isProactive?: boolean; isSocratic?: boolean }): EngineMode {
-   if (state.mode) return state.mode;
-   if (state.isProactive) return 'proactive';
-   if (state.isSocratic) return 'socratic';
-   return 'normal';
+   return state.mode || 'normal';
  }
```

### 6. `src/agent/graph/__tests__/proactive-edges.test.ts` — 测试

所有测试 state 中：
```diff
- isProactive: true,
+ mode: 'proactive' as EngineMode,
```
以及：
```diff
- isSocratic: true,
+ mode: 'socratic' as EngineMode,
```

### 7. `src/views/sidebar/agent-chat-controller.ts` — Proactive 调用者

在 `executeProactiveGuidance` 和 `handleAgentQuery` 中构造 ToolContext 时：
```diff
- isProactive: true,
+ mode: 'proactive',
```

## 不变的文件

- `src/agent/graph/edges.ts` — 已通过 `resolveMode()` 使用 mode，无需改动
- `src/agent/graph/nodes/formatter.ts` — 已通过 `resolveMode()` 使用 mode，无需改动
- `src/agent/proactive/` — `ProactiveParams` 和 `ProactiveEngine` 不直接涉及图状态字段

## 验证

1. `npm run build` — TypeScript 编译通过
2. `npm run test:run` — 测试通过
3. 在 Obsidian 中测试三种模式：
   - 普通对话 → `mode: 'normal'`
   - 主动引导（打开新书/高亮触发） → `mode: 'proactive'`
   - Socratic 模式 → `mode: 'socratic'`

## 风险

- **低风险**：所有边/节点路由已通过 `resolveMode()` 走 `mode` 字段，删除 boolean fallback 不影响运行时行为
- **唯一关注点**：`depth` 字段目前根据 `context.isProactive` 设置为 `INSPECTIONAL`，需改为 `context.mode === 'proactive'`
