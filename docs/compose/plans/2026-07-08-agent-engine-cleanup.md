# Agent Engine 死代码清理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 清理 Agent 引擎中的死代码和废弃代码，减少认知负担，完成未完成的重构。

**Architecture:** 删除 3 个死代码/废弃文件（738 行），清理 1 个死常量。评分函数已抽取到 `scoring-utils.ts`，搜索融合已抽取到 `keyword-search-fusion.ts`，但 `analytical-pre-search.ts` 仍内联逻辑未调用抽取模块。最简方案是删除死代码文件。

**Tech Stack:** TypeScript, Vitest

## Global Constraints

- 不使用前端框架，全部原生 DOM API
- 所有 Vault 文件操作通过 `app.vault.adapter` 或 `app.vault` API
- 统一日志使用 `src/utils/logger.ts`
- 业务代码禁止静态 `import` Node 核心模块
- 测试必须分模块执行，先评估影响范围

## 当前状态分析

| 文件 | 行数 | 状态 | 建议 |
|------|------|------|------|
| `pre-search-engine.ts` | 213 | 死代码（仅测试导入） | 删除 |
| `early-stop-decider.ts` | 180 | 死代码（仅测试导入） | 删除 |
| `react-loop.ts` | 345 | 废弃代码（@deprecated） | 删除 |
| `node-names.ts` ROUTER | - | 死常量 | 删除 |
| `analytical-pre-search.ts` | 566 | 重构未完成 | 保持现状（逻辑正确，只是未调用抽取模块） |

## File Structure

| 文件 | 职责 | 操作 |
|------|------|------|
| `src/agent/graph/nodes/pre-search-engine.ts` | 搜索引擎封装 | 删除 |
| `src/agent/graph/nodes/early-stop-decider.ts` | 早停决策封装 | 删除 |
| `src/agent/graph/subgraphs/react-loop.ts` | ReAct 循环子图 | 删除 |
| `src/agent/graph/node-names.ts` | 节点名称常量 | 修改：删除 ROUTER |
| `tests/unit/agent/graph/nodes/pre-search-engine.test.ts` | 搜索引擎测试 | 删除 |
| `tests/unit/agent/graph/nodes/early-stop-decider.test.ts` | 早停决策测试 | 删除 |
| `tests/unit/agent/graph/react-loop.test.ts` | ReAct 循环测试 | 删除 |

---

## Task 1: 删除 pre-search-engine.ts 及其测试

**Covers:** Agent 引擎死代码清理

**Files:**
- Delete: `src/agent/graph/nodes/pre-search-engine.ts`
- Delete: `tests/unit/agent/graph/nodes/pre-search-engine.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: 无（纯删除）

- [ ] **Step 1: 确认无生产代码导入**

```bash
grep -r "pre-search-engine" src/ --include="*.ts"
```

预期：无输出（或仅注释）

- [ ] **Step 2: 删除文件**

```bash
rm src/agent/graph/nodes/pre-search-engine.ts
rm tests/unit/agent/graph/nodes/pre-search-engine.test.ts
```

- [ ] **Step 3: 运行类型检查**

```bash
npx tsc --noEmit --skipLibCheck
```

预期：无错误

- [ ] **Step 4: 运行相关测试**

```bash
npm run test:run -- tests/unit/agent/graph/nodes/
```

预期：测试通过（删除的是死代码测试）

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(agent): delete dead code pre-search-engine.ts"
```

---

## Task 2: 删除 early-stop-decider.ts 及其测试

**Covers:** Agent 引擎死代码清理

**Files:**
- Delete: `src/agent/graph/nodes/early-stop-decider.ts`
- Delete: `tests/unit/agent/graph/nodes/early-stop-decider.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: 无（纯删除）

- [ ] **Step 1: 确认无生产代码导入**

```bash
grep -r "early-stop-decider" src/ --include="*.ts"
```

预期：无输出（或仅注释）

- [ ] **Step 2: 删除文件**

```bash
rm src/agent/graph/nodes/early-stop-decider.ts
rm tests/unit/agent/graph/nodes/early-stop-decider.test.ts
```

- [ ] **Step 3: 运行类型检查**

```bash
npx tsc --noEmit --skipLibCheck
```

预期：无错误

- [ ] **Step 4: 运行相关测试**

```bash
npm run test:run -- tests/unit/agent/graph/nodes/
```

预期：测试通过

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(agent): delete dead code early-stop-decider.ts"
```

---

## Task 3: 删除 react-loop.ts 及其测试

**Covers:** Agent 引擎废弃代码清理

**Files:**
- Delete: `src/agent/graph/subgraphs/react-loop.ts`
- Delete: `tests/unit/agent/graph/react-loop.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: 无（纯删除）

- [ ] **Step 1: 确认无生产代码导入**

```bash
grep -r "react-loop" src/ --include="*.ts"
```

预期：无输出（或仅注释）

- [ ] **Step 2: 删除文件**

```bash
rm src/agent/graph/subgraphs/react-loop.ts
rm tests/unit/agent/graph/react-loop.test.ts
```

- [ ] **Step 3: 运行类型检查**

```bash
npx tsc --noEmit --skipLibCheck
```

预期：无错误

- [ ] **Step 4: 运行相关测试**

```bash
npm run test:run -- tests/unit/agent/graph/
```

预期：测试通过

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(agent): delete deprecated react-loop.ts"
```

---

## Task 4: 清理 ROUTER 死常量

**Covers:** Agent 引擎死代码清理

**Files:**
- Modify: `src/agent/graph/node-names.ts`

**Interfaces:**
- Consumes: 无
- Produces: 无（纯删除）

- [ ] **Step 1: 读取 node-names.ts**

```bash
cat src/agent/graph/node-names.ts
```

确认 ROUTER 常量位置

- [ ] **Step 2: 确认 ROUTER 未被使用**

```bash
grep -r "NODE_NAMES.ROUTER\|ROUTER" src/ --include="*.ts" | grep -v "node-names.ts"
```

预期：无输出

- [ ] **Step 3: 删除 ROUTER 常量**

从 `node-names.ts` 中删除 `ROUTER: 'router'` 行

- [ ] **Step 4: 运行类型检查**

```bash
npx tsc --noEmit --skipLibCheck
```

预期：无错误

- [ ] **Step 5: Commit**

```bash
git add src/agent/graph/node-names.ts
git commit -m "chore(agent): remove dead ROUTER constant from node-names.ts"
```

---

## Task 5: 端到端验证

**Covers:** 完整功能验证

**Files:**
- 无文件修改

**Interfaces:**
- Consumes: 完整的 Agent 引擎
- Produces: 功能验证通过

- [ ] **Step 1: 构建项目**

```bash
npm run build
```

预期：构建成功

- [ ] **Step 2: 运行全量测试**

```bash
npm run test:run
```

预期：所有测试通过

- [ ] **Step 3: 运行 Agent 测试**

```bash
npm run test:run -- tests/unit/agent/
```

预期：所有 agent 测试通过

- [ ] **Step 4: 检查 Git 状态**

```bash
git status
git log --oneline -5
```

确认所有修改已提交

- [ ] **Step 5: 输出验证报告**

---

## Self-Review

**1. Spec coverage:**
- ✅ 删除 pre-search-engine.ts（死代码）
- ✅ 删除 early-stop-decider.ts（死代码）
- ✅ 删除 react-loop.ts（废弃代码）
- ✅ 清理 ROUTER 死常量

**2. Placeholder scan:** 无 TBD/TODO

**3. Type consistency:** 所有删除操作不影响类型系统
