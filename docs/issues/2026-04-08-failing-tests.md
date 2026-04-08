# Issue: 前端测试失败

**日期**: 2026-04-08
**优先级**: P2
**状态**: Open
**影响范围**: 已存在的 agent 模块测试

---

## 问题总结

前端有 35 个测试失败，分布在 8 个测试文件中。这些测试失败与 PageIndex 替换后端的实施计划无关。

---

## 失败测试分类

### 1. state-machine-flow.test.ts (5 failures)

**Root Cause**: 测试数据缺失

**症状**:
- `outline.length` = 0 (期望 > 50)
- `results.length` = 0 (期望 > 0)
- 状态 = 'NOT_FOUND' (期望 'SUCCESS')

**根本原因**:
```typescript
const VAULT_PATH = process.env.VAULT_PATH || '/Users/lizhao/workspace/deepreadertest';
const BOOK_NAME = '如何阅读一本书';  // ❌ 这本书不存在
```

**修复方案**:
- 选项 A: 添加测试书籍到 vault
- 选项 B: 使用现有书籍更新测试
- 选项 C: 使用 mock 数据替代真实 vault

---

### 2. inspectional.test.ts (2 failures)

**症状**:
- `formatTreeStructure` 格式化问题

**涉及文件**: 
- `frontend/src/agent/__tests__/cognitive-engine/inspectional.test.ts`

---

### 3. interceptor.test.ts (3 failures)

**症状**:
- `createScopeInterceptor` 作用域注入问题

**涉及文件**:
- `frontend/src/agent/__tests__/cognitive-engine/interceptor.test.ts`

---

### 4. canvas.test.ts (20+ failures)

**症状**:
- Canvas Tool 和 mindmap 功能问题

**涉及文件**:
- `frontend/src/agent/tools/__tests__/canvas.test.ts`

---

## 影响评估

**对 PageIndex 实施的影响**: **无**

我们的实施计划涉及：
- 新建文件：book-indexer.ts, book-search.ts, bm25.ts
- 修改 UI：LibraryModal, SidebarView

这些失败测试涉及：
- 已存在的 agent 模块
- Canvas 功能
- 状态机集成

**结论**: 这些测试应该作为**单独的 issue** 修复，不阻塞 PageIndex 实施。

---

## 后续行动

### 短期（本周）
- [ ] 为 state-machine-flow.test.ts 创建测试数据或使用 mock
- [ ] 调查 inspectional.test.ts 和 interceptor.test.ts 失败原因
- [ ] 调查 canvas.test.ts 失败原因

### 长期
- [ ] 建立测试数据管理机制
- [ ] 减少测试对真实 vault 的依赖
- [ ] 提高测试隔离性

---

## 相关链接

- 测试命令: `cd frontend && npm run test:run`
- 测试 vault: `/Users/lizhao/workspace/deepreadertest`
- 失败日志: 见本文件

---

**创建人**: Claude (investigate skill)
**创建时间**: 2026-04-08