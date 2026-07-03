# DeepReader

Obsidian 插件，奚童，AI 伴读 + PDF/EPUB 索引 + 微信读书同步。




## 架构
- UI: 纯 TypeScript + DOM（无框架）
- AI: LangGraph（四层认知引擎） + FrontendAgent
- 索引: PageIndex（Vector + BM25 混合搜索）
- 阅读: ReadingModeService + PagePaginator（分页+章节导航+位置恢复）
- 记忆: 用户画像 + 长期记忆（MEMORY.md → 渐进理解用户）
- 语音: TTS（语音合成）+ ASR（语音识别）
- 同步: 微书读书 API + 热门划线缓存
- 可视化: Excalidraw（AI 生成图表）

## 运行时

- Obsidian 插件，跑在 Electron 渲染进程
- 有 DOM + Obsidian API，无完整 Node.js
- 调试: Obsidian 内 `Cmd+Option+I` → `app.plugins.plugins['deepreader-dev']`
- ⛔ 不是网页，不要用浏览器 MCP / Playwright 调试


## 命令

### 四层测试架构

| 层级 | 命令 | 适用场景 | 典型时长 |
|------|------|----------|----------|
| L1 单元 | `npm run test:run` | 函数逻辑、组件测试 | ~55s |
| L2 冒烟 | `npm run smoke:core` | 部署后快速验证 | ~10-30s |
| L3 轻量 E2E | `npm run e2e-light` | 流程级验证（默认选择） | ~90s |
| L4 WebdriverIO | `npx wdio run tests/wdio.conf.ts` | 隔离环境/特殊场景 | ~5min |

### 其他命令

- 部署: `npm run deploy` → test-vault
- 跨 worktree 部署: 复制 `bin/main.js` + `bin/styles.css` + `bin/manifest.json` 到目标 vault 的 `plugins/<plugin-dir>/`

### Obsidian CLI 连接

- `obsidian plugin id=deepreader-dev` 报 "Unable to connect to main process" = Obsidian 未运行或 vault 未加载
- 必须用户手动打开 Obsidian 并加载 test-vault 后才能连接
- 部署后需 `npm run deploy` + 用户重新加载插件（或 Obsidian 自动热重载）

## 约束

- 日志用 `utils/logger.ts`
- 数据文件用 `fs`（原子写入），用户内容用 Vault API
- 插件 ID 用 `this.manifest.id`，不硬编码 `'deepreader'`
- Agent 唯入口: `FrontendAgent.chat()` → `runGraphEngine()` → `stream()`
- 提交前将代码修改方案整理后告知用户审查，用户确认后提交代码
- 每个重要功能都拉取.worktrees/目录下的独立worktree分支，完成后调用测试工程师代理进行测试

### 跨平台兼容约束 (PC & Mobile)

- **禁止顶层静态引入 Node.js 模块**：在 `main.ts` 或被其静态引入的传递闭包（如 `paths.ts`、搜索链等）中，禁止在顶层使用 `import * as fs from 'fs'` 或任何带 `node:` 前缀的静态 import。
- **惰性 require**：需要使用 Node.js 专有 API（如 `fs/promises`、`child_process`）时，桌面端专用代码必须使用 `src/utils/node-fs.ts` 的 `nodeFs()` 惰性加载，或在函数内部动态 `require`/`await import()`。
- **I/O 双轨机制**：文件读写优先使用 Vault API。非 UI CLI 脚本必须支持 `app ? vaultRead(...) : nodeFs().readFile(...)` 双轨兼容。
- **UI 手势与定位兼容**：
  - 移动端禁止注册自定义触摸滑动翻页（防与 Obsidian 原生滑动侧栏冲突），翻页应通过点击 UI 按钮或赋能 `scrollView.scrollLeft`。
  - 选区工具栏在移动端应通过 `selectionchange` 结合 `range.getBoundingClientRect()` 精准定位，不得使用 mouseup 坐标。
  - 尽量使用 `Platform.isMobile` 来处理特定平台样式（如阅读模式下通过 `toggleMobileNavbar` 隐藏底部导航栏，退出时还原）。
- **提交前置卡点**：每次改动后必须运行 `node scripts/smoke/lib/mobile-load-trace.mjs`，确保加载阶段触发的 Node 模块集合为空（加载期零 Node 触达）。

## 部署陷阱

- `manifest.json` 的 `id` 字段必须与插件目录名一致（`deepreader-dev/` → id=`deepreader-dev`），否则 Obsidian 静默加载失败
- `community-plugins.json` 只能包含实际存在的插件 ID，空目录会导致加载冲突
- wdio 从 `bin/` 加载插件（不是 test-vault），`bin/manifest.json` 的 id 也要匹配
- 跨 worktree 部署时需同时更新主仓库的 `bin/` 和 `test-vault/.obsidian/plugins/deepreader-dev/`


## 项目规则

完整规则见 `.project-rules/` 目录
