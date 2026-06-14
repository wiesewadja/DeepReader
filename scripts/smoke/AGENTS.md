# 冒烟测试

## 架构

```
scripts/smoke/
├── smoke.mjs           # 入口，支持 --level core/full --only S-22,S-23
├── checks/
│   ├── core/           # 核心场景（S-LD, S-22, S-23, S-24, S-25, S-17 等）
│   └── full/           # 完整场景
└── lib/
    └── obsidian-cli.mjs  # evalObsidian 底层工具
```

## 场景命名规范

- `S-XX` — 功能场景，如 S-22 (Sidebar), S-23 (Library)
- `S-LD` — 插件加载
- `S-RES` — 资源文件
- `S-CMD` — 命令注册
- `S-SEC` — 安全模块

## spec 结构

```javascript
export default {
  id: 'S-XX',
  name: '人类可读名',
  level: 'core',  // 或 'full'
  feature: 'F-NN',
  timeout: 8_000,
  async run({ log }) {
    // 返回 { ok: true } 或抛出错误
  },
};
```

## 与轻量 E2E 的区别

- 冒烟 = 存在性检查（元素/命令/API 是否存在）
- 轻量 E2E = 流程级验证（功能是否正确）
- 冒烟失败 = 插件坏了，轻量 E2E 失败 = 功能有问题
