# 轻量 E2E

基于 `obsidian-cli dev:cdp` 的轻量 E2E 测试框架，取代 WDIO 重量级方案。

## 用法

```bash
npm run e2e-light                    # 跑全部
npm run e2e-light -- --only <id>     # 跑指定 spec
npm run e2e-light:verbose            # 详细输出
```

## 目录结构

```
scripts/e2e-light/
├── run.mjs              # 入口
├── specs/
│   ├── index.mjs        # 注册表
│   └── *.spec.mjs       # 各 spec 文件
└── README.md
```

复用 `scripts/smoke/lib/` 和 `scripts/smoke/reporter.mjs`，不重复造轮子。

## Spec 契约

```javascript
export default {
  id: 'unique-id',
  name: '中文名',
  feature: 'F-17',
  timeout: 60_000,
  async run({ evalObsidian, countBySelector, listPrefixedClasses, log, projectRoot }) {
    // 多步骤串行测试
    // 失败 throw new Error()
    // 成功 return { steps: [...] }
  },
};
```

## 新增 Spec

1. 在 `specs/` 下新建 `.spec.mjs` 文件
2. 在 `specs/index.mjs` 注册
3. 跑 `npm run e2e-light -- --only <id>` 验证
