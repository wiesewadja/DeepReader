# Z-Library 集成

> 搜书 / 下载电子书到 DeepReader Library。
>
> 配套阅读：[features/integrations.md F-29](../features/integrations.md#f-29-z-library-搜索--下载)（产品视角 + 验收标准）、[system-overview.md 第 8 节 集成边界](../architecture/system-overview.md#integrations)、[ARCHITECTURE/product-manual §1.2](../product-manual.md)（用户操作手册）。

---

## 目录

1. [设计意图：搜书是"找书到 DeepReader" 的入口](#why-zlibrary)
2. [法律合规边界](#legal)
3. [数据流：用户点击 → 下载到书库](#flow)
4. [Cookie 持久化与降级](#cookie)
5. [免责声明 + 双重确认](#disclaimer)
6. [关键源文件](#files)

---
## Cookie 持久化与降级

## 设计意图 (why-zlibrary)

DeepReader 的核心输入是"已索引的 PDF / EPUB"——但用户首先要有**书**。Z-Library 提供 1000 万+ 英文电子书 + 700 万+ 中文电子书的搜索 + 下载，**降低"获取电子书"门槛**。

**两个关键边界**：

- **法律边界**：Z-Library 在多个司法管辖区涉版权侵权诉讼（2022 年 FBI 查封、2023 年多个镜像被封）。**默认关闭**，用户必须**显式启用** + 阅读完整免责声明。
- **技术边界**：依赖 Z-Library 镜像可达性。镜像经常换 IP / 域名 / 验证码策略——**客户端有降级 + 重试**。

---

## 法律合规边界 (legal)

> 状态：**默认关闭**。DeepReader 不主动 enable 这项功能。

启用流程（`src/views/zlibrary-search-modal.ts`）：

1. 用户在设置中**显式勾选**"启用 Z-Library"（`settings.zLibraryEnabled = true`）
2. 首次启用时弹出**完整免责声明** Modal
3. 用户必须**主动勾选**"我已阅读并同意"才能继续
4. 启用后，Library 视图的书本卡才能看到"在 Z-Library 搜索" 入口

**隐私声明**（每次启用时显示）：

- **不上传 API Key**——Z-Library 不需要 Key，**只用 cookie**
- **不存密码**——cookie 加密存在 vault 内的 `.obsidian/plugins/deepreader/zlibrary-cookie.enc`
- **不传用户身份**——只发搜索关键词和 cookie

---

## 数据流 (flow)

```
用户在 Library 视图点击"在 Z-Library 搜索"
  └─→ library-weread-bridge.ts 桥接器
        └─→ new ZLibrarySearchModal(app, title, author, client)
              └─→ 模态框 onOpen() → 立即触发 doSearch()
                    └─→ ZLibraryClient.search(query, {title, author})
                          └─→ POST https://zh.zlibrary.com/search
                                └─→ 解析 HTML → SearchResult[] (书名/作者/格式/大小)
                                      └─→ modal.renderResults(listEl)
                                            └─→ 用户点某本 → client.download(book)
                                                  └─→ POST 下载链接
                                                        └─→ 存到 DeepReader/Downloads/{书名}.{ext}
                                                              └─→ 通知用户"可加入书库"
```

**关键设计**：

- **标题/作者预填**：模态框构造时接收 `bookTitle` / `bookAuthor`——直接预填搜索框
- **格式优先级**（`FORMAT_ORDER`）：`epub > pdf > mobi > azw3 > djvu`——自动选最优格式
- **下载完成 → 一键加入书库**：避免"下载了不知道放哪"

---

## Cookie 持久化与降级 (cookie)

**位置**：`src/zlibrary/cookie-jar.ts`

Z-Library 用 cookie 维持登录态。**DeepReader 用 crypto 加密存 cookie**——重启 Obsidian 后仍保留登录。

### 三层降级

```
Layer 1: cookie 有效 → 直接搜索
Layer 2: cookie 过期 → 提示用户重新登录（弹模态框）
Layer 3: 镜像不可达 → 提示"Z-Library 暂时不可达，请稍后重试"
```

### 重试策略

- 单次请求失败：**不重试**（避免触发反爬）
- 模态框"重试"按钮：用户主动触发
- 全局：**5 分钟冷却**（避免高频失败触发 IP 封禁）

---

## 免责声明 + 双重确认 (disclaimer)

`src/views/zlibrary-search-modal.ts:onOpen()` 流程：

1. 检查 `settings.zLibraryEnabled`——false → 弹"启用 Z-Library" 设置入口
2. true 但未确认过免责 → 弹完整免责 Modal（`src/views/zlibrary-disclaimer-modal.ts`）
3. 全部通过 → 弹搜索结果 Modal

**二次确认**（下载前）：

```typescript
if (book.size > 100 * 1024 * 1024) {  // > 100MB
  // 弹"大文件警告" Modal
  // 用户必须显式确认
}
```

**大文件 + 慢网络** 容易下载失败，提前警告节省用户时间。

---

## 关键源文件 (files)

| 文件 | 职责 |
|---|---|
| `src/views/zlibrary-search-modal.ts` | 搜索 / 下载模态框 UI |
| `src/views/zlibrary-disclaimer-modal.ts` | 免责声明模态框（首次启用时） |
| `src/views/zlibrary-search-modal.css` | 模态框样式 |
| `src/zlibrary/client.ts` | Z-Library HTTP 客户端（搜索 + 下载） |
| `src/zlibrary/cookie-jar.ts` | Cookie 加密存储 + 自动重试 |
| `src/zlibrary/types.ts` | 类型：`ZLibraryBook` / `SearchResult` |
| `src/views/library/library-weread-bridge.ts` | Library 视图触发"在 Z-Library 搜索" |
| `tests/unit/zlibrary/client.test.ts` | HTTP 客户端单测（含 mock 镜像） |
| `tests/unit/zlibrary/cookie-jar.test.ts` | Cookie 加密/解密单测 |

---

## 已知限制 [INFERENCE]

- **不支持 EPUB 拆分**——大 EPUB（> 50MB）下载后**会失败索引**（PageIndex EPUB 解析有 token 上限）
- **不镜像切换**——Z-Library 镜像换了域名，需要用户手动改 URL
- **不显示官方搜索历史**——只显示本 Obsidian 内的搜索历史
- **不支持批量下载**——一次只能下一本

---

| 日期 | 变更 |
|---|---|
| 2026-06-10 | 初版：架构视角 4 节（why / flow / cookie / disclaimer）+ 9 个源文件索引。配套 features/integrations.md F-29 产品视角 |
