# 轻量 E2E 测试

## 架构

```
scripts/e2e-light/
├── run.mjs              # 入口，含环境健康检查
├── env-check.mjs        # 环境检查模块（Obsidian 连接、插件、索引、API Key）
├── baseline.mjs         # spec 级别的 requires 检查
├── trace-helper.mjs     # LangSmith trace 集成
└── specs/               # 测试 spec
    ├── index.mjs        # spec 注册表
    └── *.spec.mjs       # 具体测试
```

## 关键流程

1. `run.mjs` 启动 → `checkEnvironment()` 检查环境（失败则退出码 2）
2. 逐个执行 spec → `checkRequires()` 检查 spec 前置条件（失败则 skip）
3. spec 内部每个步骤独立 try/catch → pass/fail/skip 状态

## 环境检查 vs Spec Requires

| 维度 | 环境检查 (env-check) | Spec Requires |
|------|---------------------|---------------|
| 时机 | 套件运行前，一次 | 每个 spec 运行前 |
| 范围 | 全局基础设施 | spec 特定依赖 |
| 失败 | 整个套件停止 | 单个 spec skip |

## Trace 集成模式

```javascript
import { startTraceCollection } from '../trace-helper.mjs';

const traceCollector = await startTraceCollection();
// ... 执行测试 ...
const traceSummary = await traceCollector.getTraceSummary();
// traceSummary 格式: "tokens=1234, 耗时=5.2s"
```

## 常见问题

- `obsidian plugin id=deepreader-dev` 报 "Unable to connect to main process" → Obsidian 未运行或 vault 未加载
- 环境检查失败 → 检查 Obsidian 是否打开 test-vault、插件是否加载
- spec 返回不可序列化的值 → runner JSON 化会丢字段，只返回简单数据
