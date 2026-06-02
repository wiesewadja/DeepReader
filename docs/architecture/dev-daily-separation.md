# Dev / Daily 插件 ID 分离

> DeepReader 同一代码库同时支持 `deepreader-dev`（本地开发构建）和 `deepreader`（生产 daily 构建）。本设计确保两条部署线完全隔离，dev 改数据不污染 daily，daily 的生产数据不被 dev 误读。

---

## 背景

Obsidian 插件通过 `manifest.json` 里的 `id` 字段决定身份。同一个 vault 里可同时启用多个实例，但所有 `<pluginId>/` 下的数据（settings、缓存、sync state、命令注册）都按这个 id 隔离。

历史问题：DeepReader 早期把所有路径硬编码成 `.obsidian/plugins/deepreader/...`，开发模式（id=`deepreader-dev`）会落到不同物理目录，于是出现：

- `SyncStateManager` 找不到同步数据（因为它在 `deepreader/`，dev 在 `deepreader-dev/`）
- `SESSIONS_DIR`、`tts-cache`、`PAGEINDEX_DIR` 等全部指向错的目录
- 测试 fixture 写到 daily 目录，污染生产数据

---

## 核心约定

**唯一真相源：`this.manifest.id`**

- dev 构建 → `manifest.json` 的 `id` 是 `deepreader-dev`
- daily 构建 → 是 `deepreader`
- 任何路径、命令 ID、视图 ID 派生时，**必须**用 `this.manifest.id`，**严禁**硬编码字面量

pluginId 派生统一通过 `src/main.ts` 上的 getter：

```ts
get pluginId(): string {
    return this.manifest.id;
}
```

---

## 改动清单

### 1. 路径全面 pluginId 化

| 文件 | 改动 |
|---|---|
| `src/weread/sync/state.ts` | `SyncStateManager` 构造函数接收 `pluginId: string`（必填），内部计算 `.obsidian/plugins/${pluginId}/pageindex/weread` |
| `src/weread/sync/sync-engine.ts` | `SyncEngineHost` 字段从 `pluginDir` 改为 `pluginId`，构造时透传 |
| `src/weread/index.ts` | `WereadPluginHost` 字段从 `pluginDir` 改为 `pluginId`，5 处引用全部更新 |
| `src/weread/auth/unmatched-modal.ts` | 构造参数 `pluginId: string` 必填，去掉 `= 'deepreader'` 默认值 |
| `src/agent/session/store.ts` | `SessionStore` 构造参数 `pluginId: string` 必填，`SESSIONS_DIR` 用 pluginId 计算 |
| `src/services/tts/tts-service.ts` | `TTSServiceConfig.pluginId: string` 必填，`tts-cache` 用 pluginId 计算 |
| `src/services/reading-mode-service.ts` | 构造参数 `pluginId: string` 必填，去掉 `|| 'deepreader'` 兜底 |
| `src/pageindex/last-page-store.ts` | `loadLastPages` / `saveLastPages` 的 `pluginId` 改为必填 |

### 2. PAGEINDEX_DIR 动态化（零调用点改动）

`src/pageindex/paths.ts` 原本导出常量 `PAGEINDEX_DIR = '.obsidian/plugins/deepreader/pageindex'`，散布在 87 个调用点。改成：

```ts
let _activePluginId: string = 'deepreader';  // 由 setActivePluginId 覆盖

export function setActivePluginId(pluginId: string): void {
    _activePluginId = pluginId;
}

export function getPageindexDir(): string {
    return `.obsidian/plugins/${_activePluginId}/pageindex`;
}

/** Proxy：toString/valueOf/Symbol.toPrimitive 返回当前 pluginId 对应路径 */
export const PAGEINDEX_DIR: string = new Proxy({}, {
    get(_t, prop) {
        if (prop === 'toString' || prop === 'valueOf') return () => getPageindexDir();
        if (typeof prop === 'symbol' && prop === Symbol.toPrimitive) return () => getPageindexDir();
        return undefined;
    },
}) as unknown as string;
```

`main.ts onload` 第一行调用 `setActivePluginId(this.manifest.id)`，之后所有 `${PAGEINDEX_DIR}/xxx` 模板字符串拼接自动跟随。

⚠️ 约束（已写入模块顶部注释）：
- 禁止解构为 const 变量
- 禁止 `typeof === 'string'` 判定
- 禁止 `===` 字符串比较
- 新代码建议直接用 `pageindexPaths(pluginId)` 显式函数

### 3. Host 接口统一

5 个 host 接口统一为 `pluginId: string` 必填（无 `?`、无默认值）：

| 接口 | 文件 |
|---|---|
| `DeepReaderPluginInterface` | `src/agent/tools/context/vault.ts` |
| `WereadPluginHost` | `src/weread/index.ts` |
| `SyncEngineHost` | `src/weread/sync/sync-engine.ts` |
| `ReadingModeCallbacks` 周边 | `src/services/reading-mode-service.ts` |
| `TTSControllerHost` | `src/views/sidebar/tts-controller.ts` |

所有调用点显式传 `this.manifest.id` 或 `this.host.plugin.manifest.id`，不允许走默认 fallback。

### 4. settings tab 4 处 host 补全

`src/settings/sections/weread-section.ts` 内有 4 个 `host` 对象字面量（验证连接、保存并验证、同步进度回调、加载统计回调），原先缺失 `pluginDir` 字段。改为传 `pluginId: plugin.manifest.id`，与新接口对齐。

### 5. 死代码清理

`src/pageindex/plugin-data.ts` 已确认无外部引用（grep 全仓库），标记为可移除。当前 commit 未删除（避免影响其他在飞任务），列入下次清理批次。

---

## 验证矩阵

| 场景 | 期望 | 当前状态 |
|---|---|---|
| dev 构建（`manifest.id = "deepreader-dev"`）加载 | syncState 落在 `deepreader-dev/pageindex/weread/` | ✅ 代码层保证 |
| daily 构建（`manifest.id = "deepreader"`）加载 | syncState 落在 `deepreader/pageindex/weread/` | ✅ 代码层保证 |
| 两个构建同时启用同一 vault | 数据互不污染 | ✅ 路径完全分离 |
| 切换 dev/daily 共享 vault | 各自独立初始空状态 | ✅ 旧数据不会被新 id 误读（也无回退） |
| 单元测试 | 全用 `deepreader-dev` fixture | ✅ 已统一 |

### 端到端 smoke test（已完成部分）

**已完成（2026-06-03）**：

1. ✅ **部署**：`npm run deploy` 成功，dev 主程序落在 `test-vault/.obsidian/plugins/deepreader-dev/`
2. ✅ **manifest 校验**：`deepreader-dev/manifest.json` 的 `id = "deepreader-dev"`
3. ✅ **编译产物**：`main.js` 编译后含 7 处 `this.manifest.id` 引用
4. ✅ **daily 运行时隔离**：CDP 验证 daily 插件 `manifest.id === "deepreader"`，settings 完整（wereadApiKey 存在），`pageindex/weread/sync-state.json` 落在 daily 路径下（20KB），dev 路径无对应文件
5. ✅ **物理路径隔离**：CDP 写入 probe 文件到两条路径，互不污染

**未做（需用户重启 Obsidian）**：

- dev 插件动态加载验证：需在 Obsidian 启动时已部署 dev，目前在 Obsidian 启动后才部署，registry 没扫到。已在 `community-plugins.json` 登记 `"deepreader-dev"`，下次启动生效
- dev 触发同步写入到 dev 路径的端到端验证

**用户操作步骤**：

```bash
# 重启 Obsidian，然后 CDP 验证：
obsidian dev:cdp method=Runtime.evaluate params='{"expression":"(async()=>{return JSON.stringify({dev:!!app.plugins.plugins[\"deepreader-dev\"],id:app.plugins.plugins[\"deepreader-dev\"]?.manifest?.id})})()","returnByValue":true,"awaitPromise":true}'

# 触发 dev 同步（从设置面板点"同步笔记"）后：
obsidian dev:cdp method=Runtime.evaluate params='{"expression":"(async()=>{const a=app.vault.adapter;return JSON.stringify({devExists:await a.exists(\".obsidian/plugins/deepreader-dev/pageindex/weread/sync-state.json\"),dailyExists:await a.exists(\".obsidian/plugins/deepreader/pageindex/weread/sync-state.json\")})})()","returnByValue":true,"awaitPromise":true}'
```

---

## 已知风险

1. **`_activePluginId` 默认值兜底**：`src/pageindex/paths.ts:17` 默认是 `'deepreader'`，理论上 `setActivePluginId` 必须在任何 `PAGEINDEX_DIR` 访问前调用。当前 `main.ts onload` 已是第一行，但若未来有人插入更早的访问（例如顶部 import 时副作用），会读到错的目录。建议未来加一道 assert。

2. **PAGEINDEX_DIR Proxy 字符串方法不可用**：`PAGEINDEX_DIR.startsWith('x')` 返回 `undefined`（Proxy `get` 默认行为）。当前 87 个调用点全部走 `path.join`、`${}` 模板字符串、函数参数——均通过 `Symbol.toPrimitive` 正常工作。但新代码若用 `.includes` / `.startsWith` / `+` 直接拼接会炸。已写入模块注释。

3. **旧数据无回退**：`last-page-store.ts` 的 JSDoc 注释里说"dev 切到 daily 时回退到 daily 目录"，但代码实际未实现回退逻辑。dev 第一次启动会是空 state，未来用户升级会感知不到旧数据。如需兼容，应在 `loadLastPages` 内先尝试当前 pluginId → 失败再尝试对方 pluginId。

4. **`this.manifest.id` 在 onload 之前不可靠**：Obsidian 在 `onload` 调用前 `manifest` 字段已注入（构造函数阶段），但 getter 通过 `this` 访问，跨模块调用要小心初始化时序。当前所有跨模块调用都发生在 `onload` 之后，无问题。

---

## 回滚方案

本次改动全部增量向后兼容（旧 manifest id 在的代码不依赖新参数），回滚策略：

```bash
git revert <commit-hash>
npm run build
npm run deploy
```

不影响数据本身——所有 syncState / sessions / cache 都在原 pluginId 目录下，回滚后仍能读。

---

## 后续 TODO

- [ ] 跑端到端 smoke test（dev + daily 双开验证）
- [ ] 删除 `src/pageindex/plugin-data.ts` 死代码
- [ ] 考虑 `loadLastPages` 实现 daily↔dev 跨读回退
- [ ] `_activePluginId` 加 assert guard
- [ ] 把 `last-page-store` 里"回退到 daily"的 JSDoc 注释与实际行为对齐
