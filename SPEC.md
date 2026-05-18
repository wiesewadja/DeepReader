# SPEC: 微信读书集成 — DeepReader × WeRead

> 状态：**评审中** | 更新日期：2026-05-16

---

## 1. 目标

### 1.1 核心目标

将微信读书作为奚童（DeepReader）的标注数据来源。用户在微信读书里的高亮、笔记、书评、阅读统计等全量数据同步到 Obsidian，并与奚童中已有的书籍索引建立关联。用户后续可在奚童中继续阅读和讨论这些书籍。

### 1.2 目标用户

- 微信读书重度用户，积累了大量高亮和笔记
- 同时使用奚童进行深度阅读和 AI 辅助分析
- 希望在奚童中统一管理阅读记录，并让 AI Agent 同时理解书籍内容和个人标注

### 1.3 阶段划分

| 阶段 | 内容 | 状态 |
|------|------|------|
| **Phase 1** | 数据同步 + 书籍关联：扫码登录 → 全量书架获取 → Markdown 导出 → 与奚童索引匹配 | 本次实现 |
| **Phase 2** | 场景集成：阅读标注定位、AI Agent 标注上下文、书库状态展示、跨源搜索 | 后续 |
| **Phase 3** | 高级功能：自动同步调度、自定义模板、阅读统计看板 | 后续 |

### 1.4 整体数据流

```
用户在微信读书读书、划线、写笔记
            │
            ▼
  ┌─────────────────────┐
  │  微信读书 API        │  书架、高亮、笔记、书评、进度
  └─────────┬───────────┘
            │ sync
            ▼
  ┌─────────────────────┐     ┌──────────────────────┐
  │  Obsidian Markdown   │     │  .pageindex/weread/    │
  │  DeepReader/微信读书/  │     │  sync-state.json      │
  │  {分类}/{书名}.md     │     │  mapping.json          │
  │  assets/{cover}.jpg  │     │  (wereadId↔bookId)     │
  └─────────┬───────────┘     └──────────┬───────────┘
            │                            │
            │  匹配成功（书名+作者）         │
            ▼                            ▼
  ┌─────────────────────────────────────────────┐
  │  .pageindex/{bookId}/                       │
  │  book-meta.json  ← wereadBookId 写入        │
  └─────────────────────────────────────────────┘
```

---

## 2. Phase 1 功能规格

### 2.1 认证模块 (`src/weread/auth/`)

#### 2.1.1 Electron BrowserWindow 扫码登录

参考 obsidian-weread-plugin 的实现方式：

1. 打开 Electron `BrowserWindow`，导航至 `https://weread.qq.com/#login`
2. 微信读书在 BrowserWindow 内展示二维码，用户扫码
3. 通过拦截网络请求检测登录成功：监听 `weread.qq.com/api/auth/getLoginInfo?uid=*` 返回 HTTP 200
4. 登录成功后从 Electron session cookie 中提取：
   - `wr_vid` — 用户 ID
   - `wr_skey` — 会话密钥
   - `wr_name` — 用户昵称
   - `wr_avatar` — 用户头像 URL
5. 验证条件：`wr_vid` 存在，且 `wr_name` 或 `wr_skey` 有非空值

关键实现：
- BrowserWindow 使用 `partition: 'persist:weread-plugin-browser'` 隔离 session
- 监听 `did-navigate` 事件检测 `weread.qq.com/web/user?userVid=*` URL
- 定期轮询 session cookie store 获取最新值
- 登录成功后自动关闭 BrowserWindow

#### 2.1.2 Cookie 管理

- **存储**：Obsidian `data.json`（明文，与 obsidian-weread-plugin 一致）
- **刷新**：`HEAD https://weread.qq.com/` 合并 `Set-Cookie` 响应头
- **自动刷新**：每 12 小时检查一次
- **有效性验证**：`GET https://weread.qq.com/api/user/notebook` 检查是否有 `books` 数组
- **失败处理**：Cookie 失效时提示用户重新扫码登录

#### 2.1.3 Cookie 手动输入（备选）

设置页面提供手动输入 `wr_vid` + `wr_skey` 的选项，用于扫码失败的场景。

### 2.2 数据获取模块 (`src/weread/api/`)

#### 2.2.1 API 端点清单

所有请求通过 `src/utils/safe-request.ts` 的 `safeRequest()` 发起（CORS 安全）。
所有端点使用硬编码完整 URL，不区分 base URL 抽象。

| 端点 | 完整 URL | 方法 | 用途 |
|------|---------|------|------|
| 笔记本书架 | `https://weread.qq.com/api/user/notebook` | GET | 获取有笔记的书籍列表 |
| 完整书架 | `https://i.weread.qq.com/shelf/sync?synckey=0&teenmode=0&album=1` | GET | 获取完整书架（含无笔记的书） |
| 书籍详情 | `https://i.weread.qq.com/book/info?bookId={id}` | GET | ISBN、出版商、评分、简介 |
| 高亮列表 | `https://weread.qq.com/web/book/bookmarklist?bookId={id}` | GET | 划线高亮 |
| 评论列表 | `https://weread.qq.com/web/review/list?bookId={id}&listType=11&mine=1&synckey=0` | GET | 书评/想法 |
| 章节结构 | `https://weread.qq.com/web/book/chapterInfos` | POST `{"bookIds":["{id}"]}` | 目录 |
| 阅读进度 | `https://weread.qq.com/web/book/getProgress?bookId={id}` | GET | 进度、时长 |
| 公众号文章 | `https://i.weread.qq.com/article/list?synckey=0` | GET | 微信公众号文章列表 |

#### 2.2.2 请求头

```typescript
{
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Content-Type': 'application/json',
  'Cookie': `wr_vid=${vid}; wr_skey=${skey}`,
  'x-vid': vid,
  'x-skey': skey,
}
```

#### 2.2.3 数据模型 (`src/weread/types.ts`)

```typescript
// ═══ API 原始响应 ═══

interface WereadNotebookResponse {
  books: WereadBookItem[];
}

interface WereadShelfResponse {
  books: WereadShelfBook[];
  archives?: any[];
}

interface WereadHighlightResponse {
  updated: WereadBookmark[];
  chapters: { chapterUid: number; title: string }[];
  book: { title: string; author: string; cover: string };
  refMpInfos?: any[];
}

interface WereadReviewResponse {
  reviews: WereadReviewItem[];
}

interface WereadChapterResponse {
  data: Record<string, { chapterUid: number; title: string; chapterIdx: number; level: number }[]>;
}

interface WereadProgressResponse {
  progress: number;
  readingTime: number;
  startReadingTime: string;
  finishTime: string;
}

// ═══ 内部模型 ═══

interface WereadBook {
  bookId: string;
  title: string;
  author: string;
  cover: string;
  isbn: string;
  publisher: string;
  category: string;
  intro: string;
  totalWords: number;
  rating: number;
  publishTime: string;
  bookType: number;         // 3 = 微信公众号文章
  noteCount: number;
  reviewCount: number;
  lastReadDate: string;
  readingStatus: 'unread' | 'reading' | 'finished';
  progress: number;         // 0-100
  readingTime: number;      // 秒
}

interface WereadHighlight {
  bookmarkId: string;
  markText: string;
  chapterUid: number;
  chapterTitle: string;
  style: number;            // 0=下划线, 1=波浪线, 2=马克笔
  colorStyle: number;
  range: string;
  createTime: number;
  reviewContent?: string;   // 附加批注
}

interface WereadReview {
  reviewId: string;
  content: string;
  mdContent: string;        // HTML → Markdown 转换后
  chapterUid: number;
  chapterTitle: string;
  createTime: number;
  type: 1 | 4;              // 1=章节评论, 4=全书评论
  abstract?: string;
  range?: string;
}

interface WereadChapter {
  chapterUid: number;
  chapterIdx: number;
  title: string;
  level: number;
  isMPChapter: boolean;
}

// ═══ 聚合模型 ═══

interface WereadNotebook {
  meta: WereadBook;
  chapters: WereadChapter[];
  highlights: WereadHighlight[];
  reviews: WereadReview[];
}

// ═══ 同步状态 ═══

interface WereadSyncState {
  lastSyncTime: number;
  syncedBooks: Record<string, {
    bookId: string;
    title: string;
    author: string;
    noteCount: number;
    reviewCount: number;
    lastSyncTime: number;
    filePath: string;       // vault 内的 Markdown 路径
  }>;
}

// ═══ 关联映射 ═══

interface WereadMapping {
  // wereadBookId → deepReaderBookId
  mappings: Record<string, {
    wereadBookId: string;
    wereadTitle: string;
    deepReaderBookId: string;
    deepReaderTitle: string;
    matchMethod: 'title-author';  // 预留其他匹配方式
    matchedAt: number;
    confirmed: boolean;           // 用户是否确认匹配
  }>;
}
```

### 2.3 同步引擎 (`src/weread/sync/`)

#### 2.3.1 同步流程

```
用户触发同步
  │
  ├─ 1. 验证 Cookie
  │     └─ 无效 → 弹出扫码登录 BrowserWindow
  │
  ├─ 2. 获取书籍列表（两个 API 合并去重）
  │     ├─ GET /shelf/sync → 完整书架
  │     └─ GET /api/user/notebook → 有笔记的书（补充 noteCount/reviewCount）
  │
  ├─ 3. 差异检测
  │     └─ 对比 syncState 中的 noteCount/reviewCount，过滤无变化的书
  │
  ├─ 4. 逐书获取详细数据（并发 3）
  │     ├─ GET /book/info → 详细元数据
  │     ├─ GET /web/book/bookmarklist → 高亮
  │     ├─ GET /web/review/list → 书评
  │     ├─ POST /web/book/chapterInfos → 章节
  │     └─ GET /web/book/getProgress → 进度
  │
  ├─ 5. 下载封面图片
  │     └─ 保存到 DeepReader/微信读书/assets/{bookId}.jpg
  │
  ├─ 6. 渲染为 Markdown（简单字符串拼接）
  │     ├─ YAML frontmatter
  │     └─ 按章节组织高亮与评论
  │
  ├─ 7. 写入 Vault（全量覆盖）
  │     └─ DeepReader/微信读书/{分类}/{书名}.md
  │
  ├─ 8. 书籍关联匹配
  │     ├─ 遍历已同步书籍，用书名+作者在 .pageindex/ 中查找匹配
  │     ├─ 匹配成功 → 在 frontmatter 写入 deepReaderBookId
  │     │            → 在 .pageindex/{bookId}/book-meta.json 写入 wereadBookId
  │     └─ 未匹配 → frontmatter 中标注 wereadStatus: "unlinked"
  │
  └─ 9. 更新状态
        ├─ .pageindex/weread/sync-state.json
        ├─ .pageindex/weread/mapping.json
        └─ Notice 通知同步结果
```

#### 2.3.2 差异检测

- **增量同步**：对比本地 `noteCount` + `reviewCount`，相同则跳过
- **强制同步**：忽略差异检测，全量重新获取
- **过滤选项**：排除公众号文章、最低笔记数量阈值、黑名单

#### 2.3.3 书籍关联匹配

匹配算法（`src/weread/sync/matcher.ts`）：

1. 读取 `.pageindex/` 下所有 `book-meta.json`，构建索引 `{title, author} → bookId`
2. 对每本微信读书的书籍，标准化书名和作者（去除空格、标点、大小写）
3. 在索引中查找匹配，书名完全一致 + 作者包含关系即视为匹配
4. 匹配结果写入 mapping，并更新双方元数据

未匹配处理：
- 同步完成后弹出提示 Modal，列出未匹配的书籍
- 用户可选择"忽略"或"稍后导入对应书籍"
- 不强制要求匹配

### 2.4 Markdown 输出格式

#### 2.4.1 文件路径

```
DeepReader/微信读书/assets/{bookId}.jpg     # 封面图片
DeepReader/微信读书/{分类}/{书名}.md         # 笔记文件
```

路径规则可配置：`{书名}` / `{分类}/{书名}` / `{作者} - {书名}`

#### 2.4.2 Frontmatter

```yaml
---
doc_type: weread-notebook
wereadBookId: "3300032341"
deepReaderBookId: "abc123"            # 关联成功时存在
wereadStatus: "linked"                # linked | unlinked
title: "深度学习"
author: "Ian Goodfellow"
cover: "DeepReader/微信读书/assets/3300032341.jpg"
isbn: "9787115461708"
publisher: "人民邮电出版社"
category: "计算机/人工智能"
totalWords: 580000
rating: 88.6
progress: 72%
readingTime: "18小时30分钟"
readingStatus: "在读"
lastReadDate: "2025-05-10"
finishedDate: ""
noteCount: 45
reviewCount: 12
syncTime: "2025-05-16T10:30:00Z"
---
```

#### 2.4.3 正文结构（简单字符串拼接生成）

```markdown
# 深度学习

> [!summary] 书籍简介
> 本书介绍了深度学习的核心概念...

## 第一章 引言

### 高亮
> [!quote] 📌 这是一段划线高亮的内容 ^bookmark-id-1

> [!quote] 📌 另一段高亮文本 ^bookmark-id-2
> 💬 附带的批注内容

### 想法
这是一条章节想法/评论的内容。
> 📌 关联的高亮原文

## 全书评论
这里是全书级别的书评内容...
```

### 2.5 设置扩展

在 `DeepPDFSettings` 中新增：

```typescript
// ═══ 微信读书集成 ═══
wereadCookie: {
  wr_vid: string;
  wr_skey: string;
  refreshToken?: string;
  expireAt?: number;
} | null;
wereadNoteLocation: string;          // 默认 "DeepReader/微信读书"
wereadSubFolder: 'none' | 'category' | 'title';
wereadFileName: 'title' | 'title-author' | 'title-bookId';
wereadSyncInterval: number;          // 自动同步间隔（小时），0 = 手动
wereadExcludeArticles: boolean;      // 排除公众号文章
wereadNoteCountThreshold: number;    // 最低笔记数量阈值
```

设置页面新增独立 **"微信读书" Tab**（SettingsTabId 增加 `'weread'`），包含：
- 登录状态显示（头像、昵称）
- 扫码登录 / 手动输入 Cookie 按钮
- 同步路径和文件命名配置
- 过滤规则（文章排除、笔记阈值）
- 同步按钮 + 上次同步时间
- 已同步书籍列表 + 关联状态

**设置 Tab 布局**：

```
┌─────────────────────────────────┐
│  微信读书                         │
├─────────────────────────────────┤
│                                 │
│  ┌─ 账号 ─────────────────────┐ │
│  │  头像  昵称                  │ │  ← 已登录时
│  │  [登出]                     │ │
│  └────────────────────────────┘ │
│  或                              │
│  ┌─ 登录 ─────────────────────┐ │
│  │  [扫码登录]  [手动输入Cookie] │ │  ← 未登录时
│  └────────────────────────────┘ │
│                                 │
│  ┌─ 同步 ─────────────────────┐ │
│  │  [同步笔记] [强制全量同步]    │ │  ← 未登录时置灰
│  │  上次同步：2025-05-16 10:30  │ │
│  │  已同步 25 本，已关联 18 本   │ │
│  └────────────────────────────┘ │
│                                 │
│  ┌─ 配置 ─────────────────────┐ │
│  │  笔记存放路径：DeepReader/... │ │
│  │  子文件夹：[按分类 ▾]        │ │
│  │  文件名格式：[书名 ▾]        │ │
│  │  排除公众号文章：[开关]       │ │
│  │  最低笔记数量：[1]           │ │
│  └────────────────────────────┘ │
└─────────────────────────────────┘
```

### 2.6 UX 交互规格

#### 2.6.1 首次同步流程

全部在"微信读书"设置 Tab 内完成：
1. 打开设置 Tab → 显示登录区域
2. 点击"扫码登录" → 弹出 BrowserWindow → 用户扫码
3. 扫码成功 → BrowserWindow 关闭 → Tab 内刷新为账号区域（头像+昵称）
4. 点击"同步笔记" → 后台开始同步

#### 2.6.2 同步过程

- **后台执行**：用户可离开设置页、正常使用 Obsidian
- **进度通知**：Obsidian Notice 实时显示 `正在同步微信读书 (12/50)...`
- **设置 Tab 内**：同步按钮变为进度状态，显示当前同步的书名
- **完成后**：Notice 显示 `同步完成：新增 5 本，更新 3 本`

#### 2.6.3 关联匹配

- **宽松匹配**：标准化书名和作者（去空格、括号内容、中英文标点），书名包含关系 + 作者任意名字匹配即可
- **展示位置**：Library View 中已关联的书卡片显示"微信读书"标签
- **自动重试**：每次同步后，对所有 unlinked 的书重新执行匹配算法
- **无需用户确认**：匹配结果静默记录，不弹窗

#### 2.6.4 Cookie 过期处理

- 设置 Tab 登录区域显示"登录已过期"状态 + "重新登录"按钮
- 用户主动点击才弹出 BrowserWindow 重新扫码
- 不自动弹窗

### 2.6 命令注册

| 命令 ID | 名称 | 功能 |
|---------|------|------|
| `deepreader:weread-login` | 微信读书：扫码登录 | 打开 BrowserWindow |
| `deepreader:weread-sync` | 微信读书：同步笔记 | 增量同步 |
| `deepreader:weread-sync-force` | 微信读书：强制全量同步 | 忽略差异检测 |
| `deepreader:weread-logout` | 微信读书：登出 | 清除 Cookie |
| `deepreader:weread-rematch` | 微信读书：重新匹配书籍 | 重新执行关联算法 |

---

## 3. 项目结构

### 3.1 新增文件

```
src/weread/                          # 微信读书集成模块
├── index.ts                         # WereadService 入口类
├── types.ts                         # 所有类型定义
├── auth/
│   ├── browser-login.ts             # Electron BrowserWindow 扫码登录
│   ├── cookie-manager.ts            # Cookie 存储、刷新、验证
│   └── login-modal.ts               # 登录状态 Modal（非 BrowserWindow）
├── api/
│   ├── client.ts                    # HTTP 客户端（封装 safeRequest，硬编码 URL）
│   ├── shelf.ts                     # 书架/书籍列表（两个 API 合并去重）
│   ├── notes.ts                     # 高亮/笔记/评论 API
│   ├── book.ts                      # 书籍详情/章节 API
│   └── progress.ts                  # 阅读进度 API
├── sync/
│   ├── sync-engine.ts               # 同步引擎主逻辑
│   ├── diff.ts                      # 差异检测
│   ├── matcher.ts                   # 书名+作者匹配算法
│   └── state.ts                     # sync-state.json + mapping.json 管理
├── render/
│   ├── markdown-renderer.ts         # Markdown 字符串拼接渲染
│   ├── frontmatter.ts               # YAML frontmatter 生成
│   └── cover.ts                     # 封面图片下载
└── utils/
    ├── bookid.ts                    # bookId 规范化（处理 bookId/bookid/docId 变体）
    ├── html-to-md.ts                # HTML → Markdown (node-html-markdown)
    └── time.ts                      # 阅读时长格式化
```

### 3.2 修改文件

| 文件 | 改动 |
|------|------|
| `src/config/settings.ts` | 新增 `weread*` 配置字段 + 默认值 |
| `src/main.ts` | 注册 WereadService、5 个命令 |
| `src/settings/setting-tab.ts` | SettingsTabId 增加 `'weread'`，tabs 数组增加条目 |
| `src/settings/sections/weread-section.ts` | 新建，微信读书 Tab 渲染 |
| `src/views/library-view.ts` | 已关联书籍卡片显示"微信读书"标签 |

### 3.3 数据文件

| 路径 | 用途 |
|------|------|
| `.pageindex/weread/sync-state.json` | 同步状态（已同步书籍列表、noteCount/reviewCount 快照） |
| `.pageindex/weread/mapping.json` | 关联映射（wereadBookId ↔ deepReaderBookId） |
| `DeepReader/微信读书/assets/` | 封面图片 |
| `DeepReader/微信读书/{分类}/` | 同步的 Markdown 笔记 |

### 3.4 依赖新增

```json
{
  "node-html-markdown": "^1.3.0",
  "set-cookie-parser": "^2.6.0"
}
```

---

## 4. 代码风格

遵循 DeepReader 现有约定（`.project-rules/05-conventions.md`）：

- TypeScript strict mode，ES Module
- 中文注释用于业务逻辑，英文标识符
- 日志使用 `serviceLog`（`src/utils/logger.ts` 现有模块日志器）
- 所有 HTTP 请求通过 `safeRequest()`
- 文件路径通过 Vault API (`app.vault.adapter`)，不硬编码
- UI 使用 Obsidian 原生 DOM API + `createEl`
- BrowserWindow 通过 `require('electron')` 获取，Obsidian `isDesktopOnly: true` 保证可用

---

## 5. 测试策略

### 5.1 单元测试（Vitest）

| 测试文件 | 覆盖范围 |
|---------|---------|
| `src/weread/__tests__/client.test.ts` | 请求头构建、响应解析、错误处理 |
| `src/weread/__tests__/shelf.test.ts` | 两个书架 API 合并去重逻辑 |
| `src/weread/__tests__/diff.test.ts` | 增量同步差异检测 |
| `src/weread/__tests__/matcher.test.ts` | 书名+作者匹配算法（正常匹配、大小写、空格、同名书） |
| `src/weread/__tests__/markdown-renderer.test.ts` | frontmatter 生成、章节组织、高亮格式化 |
| `src/weread/__tests__/html-to-md.test.ts` | HTML → Markdown 转换 |
| `src/weread/__tests__/bookid.test.ts` | bookId 规范化（多种字段名变体） |

### 5.2 Mock 策略

- API 调用：Mock `safeRequest` 返回预定义 JSON
- Electron：Mock `BrowserWindow` 构造
- 文件系统：Mock Vault adapter
- 不实际调用微信读书 API

---

## 6. 边界

### 6.1 必须做

- 所有 HTTP 请求通过 `safeRequest()`，不用原生 fetch
- Cookie 存储在 Obsidian `data.json`，绝不明文暴露到日志
- 同步过程可中断、可恢复
- 文件冲突：全量覆盖（与 obsidian-weread-plugin 一致）
- 封面图片下载到本地
- 关联匹配失败时提示用户，不阻断同步流程
- `bookId` 字段规范化（处理 `bookId`/`bookid`/`docId`/`docid` 变体）

### 6.2 先问再做

- 自动同步调度（Phase 1 默认手动触发）
- 自定义 Markdown 模板
- 微信公众号文章的详细内容获取方式

### 6.3 绝不做

- 不获取/展示书籍正文内容（版权风险，仅获取用户自己的标注数据）
- 不实现微信读书在线阅读功能
- Phase 1 不修改 DeepReader 现有索引系统的核心逻辑
- Phase 1 不实现 Phase 2 的四个使用场景
- 不自行提交 git 代码

---

## 7. 关键参考

### 7.1 obsidian-weread-plugin（主要参考）

| 特性 | 实现方式 |
|------|---------|
| 认证 | Electron BrowserWindow + cookie 拦截 |
| Cookie 存储 | 明文 Obsidian `loadData()` |
| API 客户端 | 单文件 `api.ts`，硬编码完整 URL |
| 同步 | `syncNotebooks.ts` 编排，支持增量检测 |
| 模板 | Nunjucks 引擎（我们不用，改为字符串拼接） |
| HTML→MD | `node-html-markdown` |
| 冲突策略 | 全量覆盖 |

### 7.2 VSCode-WeRead（补充参考）

| 特性 | 实现方式 |
|------|---------|
| 书架合并 | `/api/user/notebook` + `/shelf/sync` 双源去重 |
| bookId 规范化 | `normalizeBookItem()` 处理多种字段名变体 |
| 并发同步 | 最大 3 线程 |
| Cookie 刷新 | 主动调度 + 指数退避 |
