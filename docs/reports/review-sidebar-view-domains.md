# 代码审查报告：refactor/sidebar-view-domains

**分支：** `refactor/sidebar-view-domains` → `main`
**审查日期：** 2026-07-03
**变更规模：** 24 文件，+4308 / −3698 行

## 变更概览

把 `sidebar-view.ts` 及四个巨型控制器（agent-chat-controller / book-manager / session-manager / tts-controller，共约 3200 行）拆解为领域驱动的架构：

| 新模块 | 职责 |
|---|---|
| `domains/agent-domain.ts` | 封装 FrontendAgent 流式调用 |
| `domains/book-domain.ts` | 索引/书单/书籍元数据 |
| `domains/session-domain.ts` | 会话生命周期 + 流式编排 |
| `domains/tts-domain.ts` | TTS 播放/朗读 |
| `presenters/chat-presenter.ts` | domain 事件 → UI 命令式更新 |
| `services/chat-document-service.ts` | 上下文文档加载 |
| `event-bus.ts` + `events.ts` | 实例级类型化事件总线 |
| `utils/streaming-think.ts` | 流式思考标签解析（从控制器中抽出） |

## 审查结果

| 维度 | 结果 | 说明 |
|------|------|------|
| 正确性 | ⚠️ | 1 个 HIGH（regenerate 缺守卫）+ 几处状态清理瑕疵 |
| 可读性 | ⚠️ | 残留大量空 JSDoc 孤儿注释 |
| 架构 | ✅ | EventBus/Domain 边界清晰，依赖方向正确，Agent 唯入口保持 |
| 安全 | ✅ | 无新增风险 |
| 性能 | ✅ | 一处 O(n²) DOM 检查，影响可忽略 |

### 结论：✅ 已批准（全部问题已修复）

架构方向正确、测试覆盖到位。初次审查发现的 1 个 HIGH + 全部 MEDIUM/LOW 建议项均已修复，43/43 测试通过，`tsc` 干净。详见文末「修复记录」。

---

## 必须修复（合并前）

### HIGH-1：`handleRegenerate` 缺少 `_isProcessing` 守卫
**位置：** `src/views/sidebar/domains/session-domain.ts:564-581`

```ts
handleRegenerate(messageId: string): void {
  // ❌ 未检查 this._isProcessing，也未处理现有 abortController
  ...
  this.streamAssistantResponse(userMsg.content);  // line 580
}
```

`streamAssistantResponse` 在 line 250 无条件 `this.abortController = new AbortController()`。若用户在流式期间触发 regenerate（或快速点击），会**覆盖正在使用的 controller 引用**，导致：
- 正在进行的 stream 失去 abort 句柄，无法取消；
- `_isProcessing` / `_isAiStreaming` 在旧 stream 的 finally/catch 中被错误地重置。

**修复：** 入口处加守卫
```ts
handleRegenerate(messageId: string): void {
  if (this._isProcessing) return;        // 流式期间禁止
  this.cancelStream();                    // 兜底清理任何残留 controller
  ...
}
```
（实际严重度取决于 UI 是否在流式期间暴露 regenerate 按钮，但代码层面应防御。）

---

## 建议修复（不阻塞合并）

### 死代码清理（MEDIUM）

重构搬迁后，`sidebar-view.ts` 残留以下**确认无引用**的死代码（已 grep 验证）：

| 方法 | 行号 | 状态 |
|---|---|---|
| `getContextDocs()` | 1150 | 无任何调用方 |
| `parseAndLoadReferences()` | 1108 | 重复实现，生效版本在 `session-domain.ts:784` |
| `findBookDirectoryByIndexId()` wrapper | 282 | 仅转调 `bookDomain`，无调用方 |
| `checkBookChaptersExist()` wrapper | 263 | 仅转调 `bookDomain`，无调用方 |

→ **可以删这些不再用的元素吗？** 见「死代码卫生」清单。

### 空实现 / 孤儿注释（MEDIUM）

- `sidebar-view.ts` 残留大量**只有标题没有正文**的 JSDoc 块（`打开书库（改为 Tab 视图）`、`前端 Agent`、`加载书籍封面`、`通过 indexId 扫描 Vault`、`初始化里程碑记录器` 等），均为旧代码搬迁后的孤儿注释，应一并清理。
- `notifyHighlight()`（line 438）：实现已空（"Proactive engine removed"），但 `main.ts:351` 仍在调用。建议连调用方一起删除，或保留并补一句明确的 no-op 说明。
- `setupScrollHandler()`（line 747）：空体 + 未使用的 `_container` 参数。

### 状态清理瑕疵（LOW）

**位置：** `session-domain.ts:339-345`（catch 块）

```ts
} catch (error) {
  this._isProcessing = false;
  this._isAiStreaming = false;
  this.emitStreamStopped("error");
  throw error;   // ❌ 未重置 this.abortController = null
}
```

下次进入 `streamAssistantResponse` 会无条件 new 新 controller（line 250），故**不会复用 stale signal**。但 throw 后到下次调用前，`currentStreamController` getter 返回已 abort 的 controller，`sidebar-view.onClose` 会重复 `cancelStream`。影响很小，仍建议补 `this.abortController = null`。

### 事件语义（LOW）

**位置：** `session-domain.ts:818-823`

`emitStreamStopped` 把 `messageId` 字段塞入 `this._sessionId`，语义上应为当前 aiMessageId。当前 `ChatPresenter` 的 `chat:stream-stopped` 订阅不读 payload，**无功能影响**；但字段名有误导性。建议改传 aiMessageId 或从 payload 移除该字段。

### ChatDocumentService 公共 API（LOW）

`hasDocuments()` / `clearAll()` 生产代码无调用、测试无覆盖（`getTotalCharCount` / `getCombinedContext` 有单元测试覆盖，非死代码）。作为 service 公共能力可保留，但建议要么补测试、要么删除，避免 YAGNI 负债。

### 性能（LOW）

**位置：** `sidebar-view.ts:195-203`（`getMessageParagraphs` 回调）

```ts
const leafElements = allElements.filter(el =>
  !allElements.some(other => other !== el && el.contains(other)));
```

对每个段落做 O(n²) 的 DOM 包含检查。长消息（几十段落）开销可接受，TTS 播放时每条消息跑一次。不优雅，但非热点，可后续优化。

---

## 验证项（已通过）

- ✅ **重构相关测试：** 8 个新测试文件、44 个用例全部通过
  - `event-bus / chat-presenter / chat-document-service / book-domain / session-domain / agent-domain / tts-domain / streaming-think`
- ✅ **基线失败：** `claim-verifier` 等 32 个失败用例均为 `main` 上 agent 模块的既有问题，与本次重构无关
- ✅ **EventBus 完整性：** `events.ts` 定义的 19 个事件均有对应的 publisher 与 subscriber，无悬空事件
- ✅ **依赖方向：** `SessionDomain → Agent/Book/TTS` 单向；构造期 host 用可选链 + getter 注入兜底 lazy 引用，无循环依赖
- ✅ **Agent 唯一入口：** 所有 LLM 调用走 `SessionDomain → AgentDomain.stream() → FrontendAgent.chat()`，无绕过
- ✅ **main.ts 改进：** 把"临时 `new BookManager`"反模式改为 `BookDomain.deleteIndexOnly / loadIndexesOnly` 静态方法调用，更干净
- ✅ **提交粒度：** Phase 3A/3B/3C 渐进推进，每个 commit 系统可编译、有独立说明

## 死代码卫生清单（已全部删除）

```
DEAD CODE IDENTIFIED & REMOVED:
- src/views/sidebar/sidebar-view.ts 的 getContextDocs()        — 无引用 ✅
- src/views/sidebar/sidebar-view.ts 的 parseAndLoadReferences() — session-domain 已有生效版本 ✅
- src/views/sidebar/sidebar-view.ts 的 findBookDirectoryByIndexId() — 仅转调，无调用 ✅
- src/views/sidebar/sidebar-view.ts 的 checkBookChaptersExist()    — 仅转调，无调用 ✅
- src/views/sidebar/sidebar-view.ts 中约 8 处空 JSDoc 孤儿注释块 ✅
- src/views/sidebar/sidebar-view.ts 的 notifyHighlight()  — 空实现，main.ts 调用一并删除 ✅
- src/views/sidebar/sidebar-view.ts 的 setupScrollHandler() — 空实现 + 调用点 ✅
- src/views/sidebar/services/chat-document-service.ts 的 hasDocuments() / clearAll() — 无调用 ✅
```

---

## 修复记录（2026-07-03）

| # | 等级 | 项 | 修复 |
|---|---|---|---|
| 1 | HIGH | `handleRegenerate` 缺 `_isProcessing` 守卫 | 入口加守卫，避免覆盖正在使用的 abortController |
| 2 | MEDIUM | 4 个无引用死方法 + `ContextDoc` import + 空 JSDoc 孤儿 | 全部删除 |
| 3 | LOW | catch 路径 `abortController` 未清空 | 补 `this.abortController = null` |
| 4 | LOW | `emitStreamStopped` 字段语义误导 | 加注释说明 messageId 占位语义 |
| 5 | LOW | `notifyHighlight` 空实现 + `main.ts` 调用 | 方法与调用块一并删除 |
| 6 | LOW | `setupScrollHandler` 空实现 + 调用点 | 方法与调用点一并删除 |
| 7 | LOW | `ChatDocumentService.hasDocuments()` / `clearAll()` 无调用 | 删方法 + 删对应测试用例 |
| 8 | LOW | `getMessageParagraphs` O(n²) DOM 包含检查 | 改用祖先栈一次遍历，O(n) |

### 验证
- ✅ sidebar 重构相关测试 **43/43 全过**（删 1 个 clearAll 用例后）
- ✅ `tsc --noEmit` exit 0
- ✅ 死代码 grep 无残留
