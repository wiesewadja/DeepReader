# SPEC: Z-Library 书籍下载集成

> 版本: v1 | 日期: 2026-05-17 | 状态: 待评审

为微信读书中**本地没有对应 PDF/EPUB** 的书籍，提供从 Z-Library 搜索并下载的能力。下载完成后自动索引并关联，用户在书库卡片上一键操作即可完成全流程。

### 目标用户

DeepReader 插件用户，已同步微信读书笔记，希望获得本地书籍文件进行深度阅读和 AI 对话。

### 核心流程

```
书库卡片点击下载按钮
  ↓
弹出搜索结果 Modal（Z-Library 搜索该书名）
  ↓
用户选择版本（EPUB 优先展示）
  ↓
下载到 vault + 自动索引
  ↓
写入 weread/mapping.json 关联
  ↓
书库卡片状态更新（显示"微信读书"标签）

## 二、功能清单与验收标准

### Phase 1: Z-Library SDK 内嵌

| # | 功能 | 验收标准 |
|---|------|---------|
| 1.1 | `ZLibraryClient` 类 | 支持 login / search / downloadBook / getProfile |
| 1.2 | Cookie 管理 | 登录后自动管理 Cookie，无需手动传递 |
| 1.3 | 域名自动发现 | 初始化时自动获取可用域名 |
| 1.4 | HTTP 代理 | 从 `HTTPS_PROXY` / `HTTP_PROXY` 环境变量读取 |
| 1.5 | 错误处理 | 网络错误自动重试（2次），登录失败/限额超限明确报错 |
| 1.6 | 文件下载 | 流式写入，支持进度回调 |

### Phase 2: 设置页集成

| # | 功能 | 验收标准 |
|---|------|---------|
| 2.1 | Z-Library 设置区 | 在"微信读书"tab 下新增 Z-Library 配置区域 |
| 2.2 | 账号存储 | 邮箱 + 密码存入 `data.json`（密码不明文，仅存登录后的 Cookie） |
| 2.3 | 登录验证 | "保存并验证"按钮，成功后显示用户名和剩余下载次数 |
| 2.4 | 清除凭据 | "清除"按钮清除 Cookie |

### Phase 3: 书库下载交互

| # | 功能 | 验收标准 |
|---|------|---------|
| 3.1 | 下载按钮 | 未关联本地的 weread 书籍卡片上显示下载图标 |
| 3.2 | 搜索 Modal | 弹出搜索结果列表，按 EPUB 优先排序 |
| 3.3 | 版本选择 | 用户点击某条搜索结果开始下载 |
| 3.4 | 下载进度 | 卡片上显示下载 + 索引进度 |
| 3.5 | 自动关联 | 下载完成 → 自动索引 → 写入 mapping.json → 卡片更新 |

#### 3.2 搜索 Modal 详细设计

**触发**：点击 weread 卡片上的下载按钮。

**Modal 布局**（自上而下）：

```
┌─────────────────────────────────────────────┐
│  搜索: 高效能人士的七个习惯            [×]  │  ← 标题栏，显示搜索关键词
├─────────────────────────────────────────────┤
│ ┌──────┐ 高效能人士的七个习惯   EPUB 2.5MB │  ← 结果卡片（EPUB 优先）
│ │ 封面 │ 史蒂芬·柯维 · 2020 · 中文        │     左侧封面缩略图
│ │      │ [下载]                            │
│ └──────┘                                    │
├─────────────────────────────────────────────┤
│ ┌──────┐ 高效能人士的七个习惯   PDF 15.2MB │
│ │ 封面 │ 史蒂芬·柯维 · 2019 · 中文        │
│ │      │ [下载]                            │
│ └──────┘                                    │
├─────────────────────────────────────────────┤
│ ┌──────┐ The 7 Habits...       EPUB 1.8MB │  ← 英文版也展示
│ │ 封面 │ Stephen R. Covey · 2020 · English│
│ │      │ [下载]                            │
│ └──────┘                                    │
├─────────────────────────────────────────────┤
│  显示 1-5 / 共 5 条                         │
└─────────────────────────────────────────────┘
```

**搜索逻辑**：
1. 用 weread 书籍的 `title` 作为搜索 query
2. 默认参数：`limit: 10`，`languages: ['chinese']`，先搜 EPUB
3. 如果中文搜索结果为空，去掉语言限制重试
4. 结果排序：EPUB > PDF > MOBI，同格式按年份倒序

**结果卡片信息**：
- 封面缩略图（`book.cover`，Z-Library 返回的 URL，异步加载，无封面时显示占位符）
- 书名（`book.title`）
- 作者（`book.author`）
- 格式标签（`book.extension`，EPUB 绿色 / PDF 蓝色）
- 文件大小（`book.filesizeString`）
- 年份（`book.year`）
- 语言标签（`book.language`）

**交互**：
- 点击"下载"按钮 → 关闭 Modal → 开始下载流程
- 点击卡片行 → 也触发下载
- 点击 [×] 或 Modal 外 → 取消关闭
- 未登录时弹 Notice 提示"请先在设置中配置 Z-Library 账号"

**空状态**：
- 搜索中：显示加载动画 + "正在搜索..."
- 无结果：显示"未找到匹配书籍" + 建议修改关键词
- 网络错误：显示错误信息 + "重试"按钮

#### 3.4 + 3.5 下载 + 索引流程详细设计

**完整状态机**：

```
[空闲] → 点击下载按钮
  ↓
[搜索中] → Modal 显示搜索结果
  ↓ 用户选择
[下载中] → 卡片显示下载进度条
  ↓ 下载完成
[索引中] → 卡片显示索引进度条
  ↓ 索引完成
[关联写入] → 写入 mapping.json + 更新 sync-state
  ↓
[完成] → 卡片显示"微信读书"标签，可点击打开对话
```

**各阶段细节**：

| 阶段 | 卡片显示 | 数据流 | 失败处理 |
|------|---------|--------|---------|
| 搜索中 | Modal 加载动画 | `client.search(title)` | Modal 显示错误 + 重试按钮 |
| 下载中 | 卡片封面区显示蓝色进度条 + "下载中 45%" | `client.downloadBook()` → 写入 vault | 卡片显示红色错误标记 + "重试"按钮 |
| 索引中 | 卡片封面区显示绿色进度条 + "索引中 60%" | `indexBook()` → 生成 bookId | 卡片显示"索引失败" + "重试"按钮 |
| 关联写入 | 无特殊显示（瞬时完成） | 写入 mapping.json → 更新 wereadMappingCache | 日志记录，不阻塞 |
| 完成 | 正常卡片 + "微信读书"标签 | 卡片可点击进入对话 | — |

**下载阶段**：
1. 从搜索结果获取 `bookId` + `hash`
2. 调用 `client.getDownloadLink(bookId, hash)` 获取下载 URL
3. 通过 `requestUrl` 下载到 `{vaultPath}/DeepReader/assets/{safeTitle}.{ext}`
4. 进度回调更新卡片上的进度条

**索引阶段**：
1. 调用现有 `indexBook()` 函数，传入下载的文件路径
2. 复用书库已有的 `onProgress` 回调更新卡片进度
3. 索引完成后获得 `bookId`

**关联阶段**：
1. 读取 `.pageindex/weread/mapping.json`
2. 新增条目：`{ wereadBookId → { deepReaderBookId, title, filePath } }`
3. 更新 `library-view` 的 `wereadMappingCache`
4. 触发卡片重新渲染（添加"微信读书"标签）

**重试机制**：
- 每个阶段失败后，卡片上显示对应的"重试"按钮
- 重试从失败阶段重新开始，不重新执行已成功的阶段
- 下载文件已存在时跳过下载，直接进入索引阶段

## 三、项目结构

```
src/
├── zlibrary/                        ← 新增：Z-Library SDK
│   ├── client.ts                    ← ZLibraryClient 主类
│   ├── cookie-jar.ts                ← Cookie 管理
│   ├── types.ts                     ← 类型定义（Book, SearchResult 等）
│   ├── errors.ts                    ← ZLibraryError
│   └── constants.ts                 ← 默认域名、请求头
│
├── views/
│   ├── library-view.ts              ← 修改：下载按钮 + 进度
│   └── zlibrary-search-modal.ts     ← 新增：搜索结果选择 Modal
│
├── settings/
│   └── sections/
│       └── weread-section.ts        ← 修改：新增 Z-Library 配置区
│
├── config/
│   └── settings.ts                  ← 修改：新增 zlibrary 字段
│
└── weread/
    └── sync/
        └── state.ts                 ← 修改：mapping 写入逻辑
```

---

## 四、接口设计

### 4.1 Z-Library 设置字段

```typescript
// settings.ts 新增字段
interface DeepPDFSettings {
  // ... 现有字段 ...

  // Z-Library
  zlibraryUserId: string;        // 登录后的用户 ID
  zlibraryUserKey: string;       // 登录后的 Cookie key
  zlibraryDomain: string;        // 当前可用域名

### 4.2 ZLibraryClient

```typescript
// src/zlibrary/client.ts
class ZLibraryClient {
  constructor(options?: { domain?: string; timeout?: number });

  async login(email: string, password: string): Promise<UserProfile>;
  async search(query: string, options?: SearchOptions): Promise<SearchResult>;
  async getDownloadLink(bookId: number, hash: string): Promise<DownloadInfo>;
  async downloadBook(
    bookId: number, hash: string, outputPath: string,
    onProgress?: (downloaded: number, total: number) => void
  ): Promise<string>;
  async discoverDomain(): Promise<string>;
  async getProfile(): Promise<UserProfile>;
}
```

代理从 `process.env.HTTPS_PROXY || process.env.HTTP_PROXY` 读取，通过 Obsidian 的 `requestUrl` 发起请求（与项目现有模式一致，避免引入 undici 依赖）。

### 4.3 搜索 Modal

```typescript
// src/views/zlibrary-search-modal.ts
class ZLibrarySearchModal extends Modal {
  constructor(
    app: App,
    query: string,
    onSelect: (book: ZLibraryBook) => void
  );

  // 显示搜索中 → 展示结果列表 → 用户点击选择
}
```

### 4.4 书库卡片下载按钮

在 `createBookCard` 中，对 `fileType === 'weread'` 且**未关联本地**的卡片，显示下载按钮而非删除按钮。

判断"未关联"：`!this.wereadMappingCache.has(index.id)` 且不存在同名的 `.pageindex/` 索引。

---

## 五、代码风格

- 遵循项目现有约定：TypeScript strict，无 `any`（必须时注释原因）
- Z-Library SDK 不引入新运行时依赖，使用 Obsidian `requestUrl` 代替 undici/fetch
- 日志使用 `utils/logger.ts` 的 `serviceLog`
- 错误使用 `ZLibraryError` 自定义类，携带 `code` 字段
- 设置 UI 遵循 `sections/` 下其他 section 的模式

---

## 六、测试策略

| 层级 | 范围 | 工具 |
|------|------|------|
| 单元测试 | `ZLibraryClient` 核心逻辑（Cookie 管理、域名发现、搜索解析） | Vitest + mock |
| 单元测试 | 搜索 Modal 渲染逻辑 | Vitest + jsdom |
| 集成测试 | 下载 → 索引 → 关联全流程 | Vitest + 真实文件系统 |
| E2E 测试 | 书库卡片点击 → 搜索 → 下载 → 关联 | WDIO + wdio-obsidian-service |

### 关键测试用例

1. `cookie-jar.test.ts` — Cookie 设置和序列化
2. `client.test.ts` — 搜索返回正确解析，域名发现回退
3. `search-modal.test.ts` — 空结果、多结果、网络错误处理
4. `download-flow.test.ts` — 下载文件写入正确，进度回调触发

---

## 七、边界与约束

### 必须做

- Z-Library 凭据只存 Cookie，不存明文密码
- 使用 `requestUrl`（Obsidian 内置）发请求，不引入 undici
- 下载完成后必须自动触发索引
- EPUB 格式优先展示

### 先问再做

- 搜索无结果时的 UI 处理方式
- 下载限额超限时是否提示升级
- 是否支持批量下载多本书

### 不做

- 不实现 MCP 协议层
- 不支持 Anna's Archive / LibGen 等其他书源
- 不做 Z-Library 账号注册
- 不在设置页暴露代理配置（仅环境变量）
- 不实现下载历史记录管理

---

## 八、实施顺序

```
Step 1: src/zlibrary/ SDK 核心实现 + 单元测试
Step 2: src/config/settings.ts + weread-section.ts Z-Library 设置
Step 3: src/views/zlibrary-search-modal.ts 搜索 Modal
Step 4: src/views/library-view.ts 下载按钮 + 进度 + 关联
Step 5: 全流程测试 + E2E 验证
```