# 异常处理与降级链

> DeepReader 全栈的错误处理与降级机制——3 层架构：网络层 `safe-request.ts` CORS 降级 →
> 索引层 `pageindex.ts` 4 策略级降级 → 业务层 `try-catch` 模式 + `getErrorMessage` 工具。
>
> 配套阅读：[error-model-and-degradation.md](./error-model-and-degradation.md)（LangGraph Agent 节点降级）、
> [logger-and-error-handler.md](./logger-and-error-handler.md)（ErrorHandler 单例 + 5 类处理）、
> [书籍索引系统.md §解析质量兜底](./书籍索引系统.md)（PDF / EPUB 解析兜底）。

---

## 目录

1. [Why：3 层错误处理各自解决什么](#why3)
2. [Layer 1：网络层 safe-request CORS 降级](#layer-1-safe-request-cors)
3. [Layer 2：索引层 4 策略级降级](#layer-2-4)
4. [Layer 3：业务层 try-catch 模式](#layer-3-try-catch)
5. [ErrorMessage 工具：避免 70+ 处重复](#errormessage-70)
6. [降级链决策表 Chain](#chain)
7. [关键源文件 Files](#files)
8. [已知限制 Limitations](#limitations)

## Why：3 层错误处理各自解决什么
DeepReader 错误来源分 3 类，**对应 3 层降级机制**：

| 错误源 | 例子 | 降级层 |
|---|---|---|
| **网络** | CORS / DNS / 连接拒绝 | Layer 1 safe-request |
| **解析** | MinerU 失败 / TOC 提取失败 | Layer 2 pageindex 4 策略 |
| **业务** | 工具抛错 / 节点崩 / 用户操作失败 | Layer 3 try-catch + ErrorHandler |

**为什么分 3 层**：
- **网络错误跨业务**——任何 HTTP 请求都可能遇到 → **统一基础设施**处理
- **解析错误是子系统特有**——PDF/EPUB 解析有自己 4 策略，**集中到 pageindex**
- **业务错误分散**——每个模块都可能抛，**靠 try-catch 模式 + 统一工具**覆盖

**不混在一起的原因**：
- 基础设施**不应该知道业务**
- 业务**不应该重复实现 CORS 降级**
- 解析策略**不应该耦合 LLMClient**

---

## Layer 1：网络层 safe-request CORS 降级
**位置**：`src/utils/safe-request.ts`（201 行）

### 问题背景

Obsidian 插件运行在 **Electron 渲染进程**——**原生 `fetch()` 受 CORS 限制**。普通网页上的 `fetch` API 直接调跨域 API 会被浏览器拒绝。

### 解决方案

**2 套请求路径**：

| API | 路径 | 用途 |
|---|---|---|
| `safeRequest()` | 直接走 `Obsidian.requestUrl()` | 非流式请求（不需 SSE） |
| `fetchWithCorsFallback()` | 先 fetch → 失败回 requestUrl | **流式请求**（SSE） |
| `createCorsSafeFetch()` | 返回一个 CORS 安全的 fetch 函数 | 给 LangChain SDK 用 |

### fetchWithCorsFallback 流程

```typescript
async function fetchWithCorsFallback(url, init): Promise<Response> {
  try {
    return await fetch(url, init);  // 1. 先尝试原生 fetch（支持 SSE）
  } catch (error) {
    if (!isNetworkError(error)) throw error;

    // 2. 网络/CORS 错误 → 降级到 requestUrl 非流式
    const resp = await requestUrl({ url, method, headers, body, throw: false });

    // 3. 构造 SSE 格式的 Response（让下游流式解析器正常工作）
    const sseBody = `data: ${resp.text}\n\ndata: [DONE]\n\n`;
    return new Response(sseBody, { ... });
  }
}
```

**3 步**：
1. **试原生 fetch**——支持 SSE 流式
2. **捕获 CORS / 网络错误**——`isNetworkError()` 判定 TypeError / DOMException
3. **降级到 requestUrl**——Electron 主进程发请求，**绕过 CORS**

### isNetworkError 判定

```typescript
function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (error instanceof DOMException) {
    const msg = (error.message || '').toLowerCase();
    return msg.includes('cors') || msg.includes('blocked') || msg.includes('network');
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return msg.includes('cors') || msg.includes('blocked') || msg.includes('network');
  }
  return false;
}
```

**3 类错误识别**：
- `TypeError`（fetch 标准）
- `DOMException`（某些 Electron 版本 CORS 错误）
- `Error`（含 "cors" / "blocked" / "network" 关键词）

### createCorsSafeFetch：LangChain 适配

**位置**：`safe-request.ts:172-200`

```typescript
function createCorsSafeFetch(): (url, init) => Promise<Response> {
  return async (url, init) => {
    const cleanedInit = { ...init };
    if (cleanedInit.headers) {
      cleanedInit.headers = stripStainlessHeaders(cleanedInit.headers);
    }
    return fetchWithCorsFallback(url.toString(), cleanedInit);
  };
}
```

**特殊处理**：`x-stainless-*` 头是 OpenAI SDK 遥测头，**部分供应商**（如 MiniMax）的 CORS 配置不允许——**剥离后即可避免预检失败**。

### 调用方

- LLMClient（`llm-client.ts`）—— 所有流式 LLM 调用
- MinerU API（`mineru-api.ts`）—— PDF 解析
- Wiki Link 验证
- 任何外部 API 调用

---

## Layer 2：索引层 4 策略级降级
**位置**：`src/pageindex/pageindex.ts`（898 行）

### PDF 解析的 4 策略

```
[1] MinerU 云 API（主路径）
        ↓ 失败
[2] Outline-first（如果 PDF 有书签，跳过 LLM）
        ↓ 失败
[3] LLM TOC 提取（6 阶段）
        ↓ 失败
[4] OCR 兜底（pdftocairo + GLM-OCR）
        ↓ 失败
      抛错 → 上层 try-catch 处理
```

### 策略 1：MinerU 云 API

**位置**：`pageindex.ts:240-278`

```typescript
const hasMineruToken = !!this.options.mineruApiKey;

if (hasMineruToken || this.options.extractionMode !== "ocr") {
  // MinerU 精准 API 使用 VLM 视觉模型
  // 本身能处理扫描版 PDF
  // 因此不再做文本密度检测和 OCR 回退，直接信任 MinerU 结果
  const pdfInfo = await parsePdf(input, this.options.mineruApiKey, ...);
  // ...成功就用，失败就抛错
}
```

**关键**：
- **有 MinerU Token** → **直接走 MinerU**，**不 OCR 兜底**（VLM 已经能处理扫描版）
- 失败 → 抛错，**不降级到 OCR**（注释明确说明）
- **`extractionMode === 'ocr'`** → 强制走 OCR（用户显式要求）

### 策略 2：Outline-first 书签

```typescript
if (savedOutline && savedOutline.length > 0 && isOutlineHighQuality(savedOutline, pdfInfo.totalPages)) {
  // PDF 自带书签质量够高 → 跳过 LLM 提取 TOC
  // 直接构建树
}
```

**触发条件**：
- 书签数 ≥ 5
- 书签覆盖 ≥ 60% 页面

**降级意义**：避免 LLM 调用（**省 token + 省时间**）。

### 策略 3：LLM TOC 提取

**位置**：`core/toc.ts` + `core/tree.ts`

6 阶段：检测 TOC → 解析结构 → 验证页码 → 构建树 → 生成摘要 → 生成描述

**降级重试链**：

```
有页码 TOC  →  无页码 TOC  →  从内容生成  →  书签回退
```

**准确率 ≥ 60%** 时调 `fixIncorrectToc()` 修正，**最多重试 2 次**。

### 策略 4：OCR 兜底

**位置**：`parsers/ocr.ts`

```
PDF 解析失败
  └─→ pdftocairo 把 PDF 转图片
        └─→ GLM-OCR 识别图片中的文字
              └─→ 走策略 3 LLM TOC
```

**触发条件**：上述 3 策略都失败 + 用户没配 MinerU Token + `extractionMode !== 'ocr'`

### 索引搜索降级

**位置**：`src/pageindex/vault/search-v2.ts:135-137`

```typescript
} catch {
  // 向量搜索失败，降级为纯关键词结果
}
```

**关键**：**空 catch** —— 静默降级到 BM25 关键词搜索，**不抛错给用户**。

---

## Layer 3：业务层 try-catch 模式
### 标准模式

```typescript
try {
  const result = await someAsyncOp();
  return result;
} catch (e) {
  const msg = getErrorMessage(e);
  logError('[Module] Operation failed:', msg);
  return fallback;  // 静默降级
}
```

### 4 变体

| 模式 | 示例 | 用法 |
|---|---|---|
| **静默降级** | `return null` / `return []` | 工具执行（不阻塞主流程） |
| **抛错给上层** | `throw e` | 关键路径（让 ErrorHandler 接） |
| **重试一次** | `try { ... } catch { try { fallback } catch { throw } }` | 网络抖动 |
| **包装为 DeepPDFError** | `throw new DeepPDFError(msg, category, severity)` | 业务错误统一化 |

### 调用方覆盖

```bash
grep -rn "try {" src/ | wc -l
# → 约 200+ try 块，覆盖几乎所有异步操作
```

**`safeRequest`** + **`safeNode`** + **业务 `try-catch`** 3 道防线。

---

## ErrorMessage 工具：避免 70+ 处重复
**位置**：`src/utils/error-message.ts`（29 行）

### 问题

`catch (e: unknown) { ... }` 块里**安全取消息**：

```typescript
// 之前要写 70+ 处这种
const msg = e instanceof Error ? e.message : String(e);
```

### 解决

```typescript
export function getErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return String(e);
}

export function getErrorName(e: unknown): string {
  if (e instanceof Error) return e.name;
  return 'Error';
}
```

**好处**：
- **避免 70+ 处重复** `instanceof Error` 三元
- **类型安全**——`unknown` 类型安全降级
- **统一行为**——所有 catch 块取消息**一致**

### 配套：ErrorHandler + Notice

```typescript
} catch (e) {
  const msg = getErrorMessage(e);
  logError('[ContextManager] 读取文件失败:', e);  // 原始对象给 log（可序列化）
  new Notice(`读取文件失败: ${msg}`);              // 字符串给用户
}
```

**分工**：
- **`getErrorMessage(e)`**—— 给用户
- **`logError(..., e)`**—— 给调试（保完整对象）

---

## 降级链决策表 Chain
| 错误 | 触发位置 | 降级到 | 用户感知 |
|---|---|---|---|
| LLM 流式 fetch 失败（CORS） | `LLMClient.stream()` | `requestUrl` 非流式 | **无感知**（降级透明） |
| LLM HTTP 4xx/5xx | LLMClient | `fallbackApiKey`（仅 xiaomi） | 失败弹窗 |
| MinerU 失败 | `pageindex.fromPdf()` | OCR 兜底 | 索引时间变长 |
| TOC 准确率 < 60% | `pageindex.core.toc` | 重试链（最多 2 次）→ 书签回退 | 索引稍慢 |
| PDF 解析全失败 | pageindex | 抛错 | 索引失败，UI 提示 |
| 向量搜索失败 | `searchBookV2` | 纯 BM25 | 搜索质量略降 |
| 工具调用失败 | `executeSingleToolCall` | 抛错给 finishReason | "工具 X 失败" 提示 |
| 文件读取失败 | `ContextManager.loadByPath` | 弹窗 + return null | 用户看到通知 |
| 网络抖动 | `safeRequest` | 抛错给上游 | 工具节点降级或上层处理 |
| 用户操作失败 | UI handler | `ErrorHandler.handle` | 弹窗 5/10 秒 |

---

## 关键源文件 Files
| 文件 | 职责 |
|---|---|
| `src/utils/safe-request.ts` | 网络层 CORS 降级（201 行） |
| `src/utils/error-message.ts` | `getErrorMessage` / `getErrorName` 工具（29 行） |
| `src/pageindex/pageindex.ts` | PDF 解析 4 策略（898 行） |
| `src/pageindex/parsers/ocr.ts` | OCR 兜底 |
| `src/pageindex/core/toc.ts` | LLM TOC 6 阶段 + 降级重试链 |
| `src/pageindex/vault/search-v2.ts` | 向量失败 → BM25 降级 |
| `src/services/mineru-api.ts` | MinerU API + 失败重试 |
| `src/utils/logger.ts` | `logError` 含完整对象 |
| `src/agent/graph/utils/safe-node.ts` | LangGraph 节点 try-catch 包装（详见 error-model-and-degradation.md） |
| `src/agent/tracing/langsmith.ts` | LangSmith safeWrap 静默错误（详见会话与记忆系统.md） |
| `tests/unit/utils/safe-request.test.ts` | CORS 降级单测 |
| `tests/unit/utils/error-message.test.ts` | error-message 工具单测 |
| `tests/unit/pageindex/pageindex.test.ts` | 4 策略降级单测 |

---

## 已知限制 Limitations
### Layer 1：网络层

- **流式降级丢 SSE 体验** —— `requestUrl` 拿到完整响应后**模拟 SSE 格式**，下游解析器能跑但**失去流式体验**
- **`isNetworkError` 关键词匹配不可靠** —— 某些错误 message 是 "Failed to fetch" 不含 "cors"，**可能漏判**
- **不重试** —— `fetch` 失败**1 次就降级**，不重试原 fetch
- **剥离 `x-stainless-*` 头** —— 对部分供应商是 hack，**正式 fix 应在供应商 CORS 配置**
- **不处理超时** —— `fetch` 默认无超时，依赖上游 AbortSignal
- **不区分 4xx / 5xx** —— 400 / 500 都按网络错误降级（**应该重抛**）

### Layer 2：索引层

- **MinerU 失败不 OCR 兜底**（有 Token 时）—— 注释里说"信任 MinerU"，但 MinerU 不可达时**用户卡死**
- **OCR 兜底慢** —— pdftocairo + GLM-OCR **5-10 分钟**，用户以为卡死
- **LLM TOC 6 阶段重试链硬编码 2 次** —— 复杂 PDF 可能需要更多重试
- **不并行尝试 4 策略** —— 当前**串行**（MinerU 失败才走 LLM，**没"两个并行选快"**）
- **OCR 失败不重试** —— GLM-OCR 偶尔 503，**直接抛错**
- **没 MinerU Token 强制 OCR** —— 用户没配 Token，**所有 PDF 都走 OCR（极慢）**

### Layer 3：业务层

- **`try-catch` 模式不统一** —— 有些 catch 空（静默），有些 catch `log + rethrow`
- **重试逻辑散落** —— 没统一的 retry 工具（应该学 safe-request.ts 模式）
- **不区分 silent error vs fatal** —— 业务模块不知道自己的错"对用户可不可见"
- **错误码体系缺失** —— 全栈只 PageIndex 有 `IndexError`，**业务模块没有 error code**
- **跨调用栈错误链路断裂** —— NodeError → ErrorHandler → Notice，**链路不串**

### 通用

- **无统一错误上报** —— 没有 Sentry / Bugsnag 集成
- **无用户错误历史** —— 弹窗消失后**用户看不到历史**
- **无自动重试** —— 用户遇到网络错误要**手动重试**
- **无错误回放** —— 调试时**无法重放"出错的请求"**
- **无错误聚合** —— 5 个错误弹 5 次窗
- **无错误模式识别** —— 连续 3 次同样错误**不主动降级**（如自动切到 fallback Provider）

---

| 日期 | 变更 |
|---|---|
| 2026-06-10 | 初版：基于 `src/utils/safe-request.ts` 201 行 + `pageindex.ts` 4 策略 + `error-message.ts` 29 行的架构视角文档。3 层降级架构 + 9 类错误决策表 + 5 子主题 28 条已知限制 |
