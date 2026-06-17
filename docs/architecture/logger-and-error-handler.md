# Logger 与 Error Handler

> DeepReader 系统级基础设施——**Logger**（按模块分类的日志系统 + 性能计时器）
> + **Error Handler**（自定义错误类 + 全局单例 + 5 类错误处理 + 包装工具）。
>
> 配套阅读：[系统鸟瞰.md 第 9 条设计巧思](../architecture/系统鸟瞰.md#tricks)、
> [错误模型与降级链.md](./error-model-and-degradation.md)（Agent 节点级错误）、
> [wiki-link-system.md](./wiki-link-system.md)（post-processing 调用 logger）。

---

## 目录

1. [设计意图：日志与错误的边界](#why)
2. [Logger：模块化日志 + 性能计时](#logger)
3. [ErrorHandler：自定义错误类 + 单例](#errorhandler)
4. [5 类错误处理 + 5 包装工具](#handlers)
5. [与状态机的集成](#integration)
6. [关键源文件](#files)
7. [已知限制](#limitations-inference)

---

## 设计意图 (why)

DeepReader 有两套"错误处理"机制，但**职责不同**：

| 维度 | Logger | ErrorHandler |
|---|---|---|
| 关注 | 开发者调试 | 用户感知 |
| 输出 | `console.log/warn/error` | `Notice`（Obsidian 弹窗） |
| 严重度 | debug / info / warn / error | INFO / WARNING / ERROR / FATAL |
| 分类 | 6 模块（agent/tools/...） | 5 类别（network/api/...） |
| 用户可见 | 否（仅控制台） | 是（弹窗） |
| 用途 | trace + 计时 + 调试 | 错误兜底 + 用户提示 |

**不合并**的原因：
- **Logger 高频**——每次 LLM 调用、每次工具执行都 log，**不能阻塞 UI**
- **ErrorHandler 低频但高危**——错误要用户看到 + 友好提示

---

## Logger

**位置**：`src/utils/logger.ts`（341 行）

### 5 个 API 层级

| API | 职责 | 调用方 |
|---|---|---|
| `debug / info / log / warn / error` | 5 级别基础 log | 所有模块 |
| `startTimer / endTimer` | 性能计时 | 性能敏感操作 |
| `peekTimer / clearAllTimers` | 计时器管理 | 调试 |
| `setLogEnabled / setModuleEnabled` | 运行时开关 | 调试模式 |
| `generateRequestId` | 请求追踪 ID 生成 | API 调用 |

### 6 模块分类

```typescript
type LogModule = 'agent' | 'tools' | 'context' | 'ui' | 'service' | 'api';
```

**默认配置**（`defaultConfig`）：

| 模块 | 默认 | 用途 |
|---|---|---|
| `agent` | ✓ | Agent 循环、消息处理 |
| `tools` | ✓ | 工具执行详情 |
| `context` | ✓ | 上下文加载 |
| `ui` | ✗ | UI 组件（噪音多） |
| `service` | ✓ | 服务层 |
| `api` | ✗ | API 调用（详细见 LangSmith） |
| `other` | ✓ | 其他 |

**为什么 `ui` / `api` 默认关**——**噪音**。`api` 的 trace **走 LangSmith** 更好。

### 性能计时器

```typescript
const timer = startTimer('LLM call', 'agent');
// ... 干活
endTimer(timer);  // 输出: [LLM call] 1234ms
```

**内部实现**：每个 `startTimer` 返回 `timerId`，内部 Map 存 startTime + metadata。`endTimer` 算耗时 + 输出到 `log()` 通道。

**典型使用**：
- S2 ReAct 循环：每个工具调用的耗时
- S1 Inspectional：树加载耗时
- S1 Inspectional（含原 S0 Router）：意图分类耗时

### `agentLog` 别名

**位置**：`src/utils/logger.ts:30+`

## Handlers

```typescript
import { agentLog as log } from '../../utils/logger';
// ...
log('[IntentRouter] 命中规则:', rule.id);
```

**约定**：所有日志用 `[模块名]` 前缀，便于 grep。

### 运行时开关

```typescript
setLogEnabled(false);            // 全关
setModuleEnabled('api', true);   // 单独开 API
setModulesEnabled({ ui: true, api: true });  // 批量
```

**用途**：用户在 Obsidian 控制台跑 `setModuleEnabled('ui', true)` 临时开 UI 调试。

---

## ErrorHandler

**位置**：`src/utils/error-handler.ts`（489 行）

### 自定义错误类

```typescript
class DeepPDFError extends Error {
  category: ErrorCategory;     // 5 类别
  severity: ErrorSeverity;    // 4 级别
  userMessage: string;        // 用户友好提示
  originalError?: Error;      // 原始错误（调试用）
  context?: Record<string, unknown>;  // 错误上下文
}
```

**5 类别**：

| 类别 | 含义 | 用户提示 |
|---|---|---|
| `NETWORK` | 网络错误 | "网络连接异常，请检查网络" |
| `API` | API 错误 | "AI 服务返回错误：[status]" |
| `VALIDATION` | 验证错误 | "输入不符合要求" |
| `FILE` | 文件处理 | "文件读取失败" |
| `UNKNOWN` | 未知 | "发生未知错误" |

**4 级别**：

| 级别 | 用户感知 |
|---|---|
| `INFO` | 不弹窗，只 log |
| `WARNING` | 弹窗 5 秒 |
| `ERROR` | 弹窗 10 秒 |
| `FATAL` | 弹窗 + 阻断操作 |

### 单例模式

```typescript
const errorHandler = ErrorHandler.getInstance();
errorHandler.handle(err);
```

**为什么单例**——全局错误状态（如"连续 3 次 API 失败"应该主动降级）需要**统一协调点**。

### 5 类错误处理

```typescript
handleError(err, options);                  // 通用入口
handleNetworkError(err, context);            // 网络
handleAPIError(statusCode, message, ctx);    // API
handleValidationError(message, ctx);         // 验证
handleFileError(err, fileName, ctx);         // 文件
```

### 包装工具

```typescript
withErrorHandling(async (args) => {
  // 业务代码
}, { category: ErrorCategory.NETWORK, severity: ErrorSeverity.WARNING });
```

**自动**：捕获异常 → 包装为 `DeepPDFError` → 单例分发 → 用户提示。

---

## Files

| 文件 | 职责 |
|---|---|
| `src/utils/logger.ts` | Logger 主模块（341 行） |
| `src/utils/error-handler.ts` | ErrorHandler 主模块（489 行） |
| `src/utils/error-message.ts` | 错误消息文案（29 行） |
| `src/utils/safe-request.ts` | fetch + CORS 兜底（200 行） |
| `tests/unit/utils/logger.test.ts` | Logger 单测 |
| `tests/unit/utils/error-handler.test.ts` | ErrorHandler 单测 |

---

## Integration

**Logger** 在 7 类模块中调用：

```
src/agent/        ← agentLog
src/agent/tools/  ← agentLog (tools 模块)
src/agent/context/ ← agentLog (context 模块)
src/agent/skills/ ← agentLog (其他)
src/services/     ← agentLog (service 模块)
src/components/   ← agentLog (ui 模块, 默认关)
src/utils/api/    ← agentLog (api 模块, 默认关)
```

**ErrorHandler** 在 3 处兜底：

- **服务层**：`withErrorHandling` 包裹网络 / API / 文件 IO
- **UI 层**：用户操作失败时 `handleError` 弹窗
- **主入口**：`main.ts` 加载失败时 `handleError` 显示启动错误

### 与 [error-model-and-degradation.md](./error-model-and-degradation.md) 的关系

| 关注点 | ErrorHandler | Agent 错误模型 |
|---|---|---|
| 位置 | 系统级（utils/） | Agent 级（graph/utils/） |
| 关注 | 单次错误友好提示 | LangGraph 节点降级 |
| 机制 | 弹窗 + Notice | safeNode 包装 + nodeErrors 字段 |
| 用户感知 | Obsidian 通知 | 拼到 AI 回答末尾 |

**互补**：
- `ErrorHandler` 弹"AI 服务挂了"——**整体不可用**
- Agent 错误模型隐藏个别节点失败——**部分不可用**

---

## Limitations [INFERENCE]

### Logger

- **不支持结构化日志** —— `log('xxx', obj1, obj2)` 是字符串拼接，**不是 JSON**
- **不支持日志级别运行时切换** —— `setLogEnabled` 只能开关，**不能动态调 level**
- **不支持日志文件持久化** —— 重启 Obsidian 后**日志丢失**
- **不支持日志聚合** —— 多个 LLMClient / 多个工具并行调用时**日志交错**
- **不支持采样** —— 高频 debug 全部输出，**性能有损**
- **模块分类硬编码 6 个** —— 新增模块要改类型
- **没有日志 ID** —— 同一次对话的日志**无法串起来**（request_id 不在 log 输出里）

### ErrorHandler

- **5 类别硬编码** —— 新增类别要改 enum
- **Notice 弹窗 5/10 秒**硬编码 —— 不可配置
- **不实现错误码体系** —— 只区分类别，不区分具体错误码
- **不实现错误聚合** —— 5 个错误弹 5 次窗
- **不实现重试** —— 网络错误**只提示**，不自动重试
- **不支持国际化** —— 错误消息写死中文
- **不写入磁盘** —— 用户事后看不到错误历史

### 集成

- **与 LangSmith 不联动** —— Logger 的日志**和 LangSmith trace 是两套**
- **与 LangGraph error model 不联动** —— `ErrorHandler.handle` 不知道当前 LangGraph state
- **不实现全局未捕获异常兜底** —— 业务抛错**只走 `withErrorHandling`**，**裸 throw 不被捕获**

### 性能

- **`log('xxx', obj)` 会**用 util.inspect**序列化** —— 大对象 log 时**阻塞主线程**
- **startTimer 内存常驻** —— 计时器 Map 不主动清理（除 `clearAllTimers`）
- **`generateRequestId` 每次 `Math.random()`** —— 不保证唯一

---

| 日期 | 变更 |
|---|---|
| 2026-06-10 | 初版：基于 `src/utils/logger.ts` 341 行 + `src/utils/error-handler.ts` 489 行的架构视角文档。5 API + 6 模块 + 4 级别 + 5 类别 + 20 条已知限制 |
