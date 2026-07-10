# UI 组件基类统一 + Mock 整合 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 整合两份 Obsidian Mock 为一份，统一组件生命周期管理。

**Architecture:** 保留 `tests/__mocks__/obsidian.ts` 作为唯一 mock 源，将 `tests/mocks/obsidian.ts` 中有用的补充合并，删除旧文件。

**Tech Stack:** TypeScript, Vitest

## Global Constraints

- 不使用前端框架，全部原生 DOM API
- 所有 Vault 文件操作通过 `app.vault.adapter` 或 `app.vault` API
- 统一日志使用 `src/utils/logger.ts`
- 测试必须分模块执行，先评估影响范围

## 当前状态分析

| 文件 | 行数 | 用途 |
|------|------|------|
| `tests/__mocks__/obsidian.ts` | 126 | Vitest 自动 mock（完整实现） |
| `tests/mocks/obsidian.ts` | 69 | 类型兼容（最小 stub） |

**问题**：两份 mock 并存，可能被不同测试导入，导致行为不一致。

## File Structure

| 文件 | 职责 | 操作 |
|------|------|------|
| `tests/__mocks__/obsidian.ts` | 唯一 mock 源 | 修改：合并补充 |
| `tests/mocks/obsidian.ts` | 旧 mock | 删除 |

---

## Task 1: 分析两份 Mock 差异

**Covers:** Mock 整合分析

**Files:**
- Read: `tests/__mocks__/obsidian.ts`
- Read: `tests/mocks/obsidian.ts`

**Interfaces:**
- Consumes: 两份 mock 文件
- Produces: 差异清单

- [ ] **Step 1: 读取两份 mock**

确认差异点：
- `tests/mocks/obsidian.ts` 中有但 `__mocks__/obsidian.ts` 中没有的内容
- 哪些测试导入了 `tests/mocks/obsidian.ts`

- [ ] **Step 2: 检查导入关系**

```bash
grep -r "from.*tests/mocks/obsidian" tests/ --include="*.ts"
```

- [ ] **Step 3: 输出差异清单**

---

## Task 2: 合并 Mock 到 __mocks__

**Covers:** Mock 整合

**Files:**
- Modify: `tests/__mocks__/obsidian.ts`

**Interfaces:**
- Consumes: 差异清单
- Produces: 统一的 mock 文件

- [ ] **Step 1: 合并补充内容**

将 `tests/mocks/obsidian.ts` 中有用的补充合并到 `__mocks__/obsidian.ts`：
- `moment` 模块 mock
- `requestUrl` 模块 mock
- 完整的 `Platform` 对象
- `Menu`/`MenuItem` 接口

- [ ] **Step 2: 运行测试验证**

```bash
npm run test:run
```

- [ ] **Step 3: Commit**

```bash
git add tests/__mocks__/obsidian.ts
git commit -m "test: merge obsidian mocks into single __mocks__ source"
```

---

## Task 3: 更新导入路径

**Covers:** Mock 整合

**Files:**
- Modify: 所有导入 `tests/mocks/obsidian.ts` 的测试文件

**Interfaces:**
- Consumes: 统一的 mock
- Produces: 更新后的测试文件

- [ ] **Step 1: 查找所有导入**

```bash
grep -r "from.*tests/mocks/obsidian" tests/ --include="*.ts" -l
```

- [ ] **Step 2: 更新导入路径**

将 `from "../../tests/mocks/obsidian.js"` 改为使用 Vitest 自动 mock（无需显式导入）

- [ ] **Step 3: 运行测试验证**

```bash
npm run test:run
```

- [ ] **Step 4: Commit**

```bash
git add tests/
git commit -m "test: update obsidian mock imports to use __mocks__ source"
```

---

## Task 4: 删除旧 Mock 文件

**Covers:** Mock 整合清理

**Files:**
- Delete: `tests/mocks/obsidian.ts`

**Interfaces:**
- Consumes: 无
- Produces: 无（纯删除）

- [ ] **Step 1: 确认无导入**

```bash
grep -r "from.*tests/mocks/obsidian" tests/ --include="*.ts"
```

预期：无输出

- [ ] **Step 2: 删除文件**

```bash
rm tests/mocks/obsidian.ts
```

- [ ] **Step 3: 运行测试验证**

```bash
npm run test:run
```

- [ ] **Step 4: Commit**

```bash
git add tests/
git commit -m "test: remove legacy obsidian mock file"
```

---

## Task 5: 端到端验证

**Covers:** 完整功能验证

**Files:**
- 无文件修改

- [ ] **Step 1: 构建**

```bash
npm run build
```

- [ ] **Step 2: 全量测试**

```bash
npm run test:run
```

- [ ] **Step 3: 检查 Git 状态**

```bash
git status
git log --oneline -5
```
