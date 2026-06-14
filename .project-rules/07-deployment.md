# 部署规范

## 核心规则

**所有 worktree 部署都覆盖到同一个 `deepreader-dev/` 目录。**

| 项 | 值 |
|----|-----|
| 部署目标 | `test-vault/.obsidian/plugins/deepreader-dev/` |
| 插件 ID | `deepreader-dev`（固定，不随分支变） |
| Obsidian 中可见实例数 | 1（永远是最新部署的版本） |
| 部署命令 | `npm run deploy` |

## 版本号格式（让用户知道改动生效）

dev 目标的 manifest.version 自动注入为 `<baseVersion>-<feature>.<HHMM>` 格式：

| 字段 | 来源 | 示例 |
|------|------|------|
| baseVersion | `package.json.version` | `2026.06.13` |
| feature | 当前分支名（去掉 `feat/`、`fix/` 等前缀） | `async-visualizer` |
| HHMM | 部署时刻 | `1638` |

最终版本号示例：`2026.06.13-async-visualizer.1638`

用户在 Obsidian → 设置 → 第三方插件 → DeepReader 一眼能看到当前部署的是哪个分支、何时部署的。每次部署 HHMM 都不同，立刻验证生效。

**这条规则只在 dev 目标生效**。daily 目标（坚果云）保持原版本号，因为它是发布版本，不应带特性标识。

## 为什么不能按分支隔离

历史上的 deploy.js 曾经按分支名生成独立插件目录（如 `deepreader-wt-feat-async-visualizer`），看似优雅，实际有三个问题：

1. **Obsidian 无法区分**：所有 manifest.name 都是 `"DeepReader"`，第三方插件列表里出现多个同名条目，用户无法分辨
2. **冲突风险**：多个插件实例同时启用会命令字冲突、设置冲突、状态冲突
3. **遗留垃圾**：每次切分支都会留下一个目录，永远不被清理（test-vault 已发现 3 个历史遗留）

## worktree 工作流下的部署约定

- worktree 中改代码 → `npm run deploy` → 直接覆盖 `deepreader-dev/`
- 想对比两个 worktree 的效果？**手动**改 manifest.id + 改 name（加后缀）+ 启用，**不要**让 deploy.js 自动做这件事
- 主仓库 main 分支的 deploy.js 是黄金版本；当前 worktree 改动合并回 main 后，新建的 worktree 会继承

## 部署脚本架构

`scripts/deploy.js` 必须遵循：

```javascript
// 部署循环里：所有 target 都走 target.path，没有 worktree 特殊路径
for (const targetName of targets) {
  const target = config.targets[targetName];
  // dev 目标注入特性版本号
  const overrideVersion = targetName === 'dev' ? getDevVersion(baseManifest.version) : undefined;
  deployToPath(target.path, target.pluginId, target.name, overrideVersion);
}
```

`scripts/deploy.js` **禁止**包含以下任一行为：
- `git worktree list` 或类似命令检测 worktree
- 用 `branch.replace(...)` 生成分支名 slug 作为 pluginId
- 写入 `deepreader-wt-*` 这种带分支名的目录

`scripts/deploy.js` **必须**包含：
- `getDevVersion(baseVersion)` 函数：从分支名提取特性标识 + 当前时间 HHMM
- dev 目标调用 deployToPath 时传 overrideVersion
- 控制台打印 `🏷️  版本: <生成的版本号>` 方便确认

## 配置文件

`.deploy-config.json`（gitignored，主仓库共享）：

```json
{
  "targets": {
    "dev": {
      "path": "/Users/lizhao/workspace/DeepReader/test-vault/.obsidian/plugins/deepreader-dev",
      "pluginId": "deepreader-dev"
    },
    "daily": { ... }
  },
  "files": ["main.js", "manifest.json", "styles.css"]
}
```

**禁止**重新引入 `worktree.basePluginId` / `worktree.testVaultPath` 字段。

## 清理历史遗留

如果 `test-vault/.obsidian/plugins/` 出现 `deepreader-wt-*` 目录，直接 `rm -rf` 删除——它们是旧脚本留下的垃圾，无任何保留价值。

## 验证清单

每次部署后：

```bash
# 1. 目录里只有 deepreader-dev + 第三方插件（如 obsidian-excalidraw-plugin）
ls /Users/lizhao/workspace/DeepReader/test-vault/.obsidian/plugins/
# 期望：deepreader-dev  obsidian-excalidraw-plugin（不应有 deepreader-wt-* 或额外的 deepreader）

# 2. community-plugins.json 不含 deepreader-wt-*
cat /Users/lizhao/workspace/DeepReader/test-vault/.obsidian/community-plugins.json

# 3. deepreader-dev/manifest.json 的 id 是 deepreader-dev，version 含特性标识
cat /Users/lizhao/workspace/DeepReader/test-vault/.obsidian/plugins/deepreader-dev/manifest.json | grep -E '"id"|"version"'
# 期望：
#   "id": "deepreader-dev"
#   "version": "2026.06.13-async-visualizer.1638"（HHMM 随部署时刻变）
```
