# DeepReader 开源分析报告

> 生成时间: 2026-05-28
> 分析范围: 项目整体架构、敏感信息、代码模块、开源风险
> 分析师: Claude Code (多 Agent 并行分析)

---

## 一、项目概述

### 1.1 主要功能

| 功能 | 说明 |
|------|------|
| **PDF/EPUB 深度阅读** | 解析、索引、结构化导出到 Obsidian Vault |
| **本地混合搜索** | BM25 + 向量语义搜索，完全本地执行 |
| **AI Agent 四层认知引擎** | 基于《如何阅读一本书》：Router → Inspectional → Analytical → Syntopical → Formatter |
| **微信读书同步** | 绑定账号同步标注、笔记、进度 |
| **Z-Library 集成** | 搜索和下载电子书 |
| **TTS 语音播报** | MiniMax 小米 TTS 服务 |
| **PI Agent 子进程** | 技能执行引擎（知识卡片、思维导图等） |

### 1.2 技术栈

| 层级 | 技术 |
|------|------|
| 语言 | TypeScript |
| 构建 | esbuild |
| Agent 框架 | LangGraph + LangChain |
| 平台 | Obsidian Plugin（Electron 桌面端） |
| 测试 | Vitest + WebdriverIO |

### 1.3 核心目录结构

```
src/
├── main.ts                      # 插件入口
├── config/                      # 配置（providers、settings）
├── agent/                       # AI Agent（pi/、react/）
│   ├── pi/                      # PI Agent 子进程
│   └── react/                   # ReAct 循环引擎
├── pageindex/                   # 索引引擎（PDF/EPUB 解析）
│   ├── node.ts                  # Node.js 兼容入口
│   ├── parser/                  # 解析器
│   └── search/                  # BM25 + 向量搜索
├── weread/                      # 微信读书集成
├── zlibrary/                    # Z-Library 集成
├── ui/                          # Obsidian 视图组件
└── utils/                       # 工具（logger 等）
```

---

## 二、敏感信息分析

### 2.1 高敏感 - 必须处理

| 字段/模块 | 说明 | 处理方式 |
|-----------|------|----------|
| `settings.providers` | LLM API Keys（deepseek/kimi/openai/minimax 等） | 用户自行配置，开源版本清空 |
| `wereadApiKey` | 微信读书 API Key | 同上 |
| `zlibraryUserId` / `zlibraryUserKey` | Z-Library Cookie 凭证 | 建议移除或加密存储 |
| `langsmithApiKey` | LangSmith 追踪配置 | 开源版清空 |
| `sensenovaApiKey` | SenseNova 图片生成 | 清空 |
| `mineruApiKey` | PDF 解析云服务 | 清空 |
| `fallbackApiKey` / `fallbackBaseUrl` | Xiaomi MIMO Token | 清空 |
| `journalDir` | 用户画像目录 | 需用户确认或排除 |
| **System Prompt "奚童"** | 开发者个人姓名硬编码在多个 Prompt 中 | 替换为通用名称 |

### 2.2 中敏感 - 需要注意

| 字段/模块 | 说明 | 处理方式 |
|-----------|------|----------|
| System Prompt | 包含用户"昭见森"的个人信息（年龄、阅读偏好、兴趣主题等） | 泛化或移除 |
| 内置 Skill 定义 | 可能包含专有逻辑 | 审查后开源 |
| `src/agent/pi/pi-config.ts` | PI_SYSTEM_PROMPT | 需审查内容 |

### 2.3 低敏感 - 架构层面

| 内容 | 说明 |
|------|------|
| 本地索引数据 | `.pageindex/` 目录下的搜索索引（用户 vault 内容） |
| 会话历史 | JSONL 格式的对话记录（用户数据） |
| 设置配置 | Obsidian `data.json` 存储（用户本地文件） |

---

## 三、代码模块开源适合度

### 3.1 适合直接开源

| 模块 | 说明 |
|------|------|
| `src/agent/react/` | ReAct 循环引擎（通用架构） |
| `src/pageindex/parser/` | PDF/EPUB 解析器 |
| `src/pageindex/search/` | BM25 + 向量搜索（本地执行） |
| `src/ui/` | Obsidian 视图组件 |
| `src/utils/` | 通用工具（logger 等） |
| `docs/` | 项目文档和架构说明 |
| 测试框架 | Vitest + WebdriverIO 配置 |

### 3.2 需处理后再开源

| 模块 | 原因 | 建议处理方式 |
|------|------|--------------|
| `src/config/providers.ts` | 服务商预设 URL（`token-plan-cn.xiaomimimo.com` 等） | 抽象为配置文件或环境变量 |
| `src/weread/` | 依赖微信读书私有 API | 拆为独立插件，用户需申请 API |
| `src/zlibrary/` | Z-Library 版权争议 | **建议移除** |
| `src/agent/pi/` | 依赖外部 CLI 工具 | 明确依赖关系，文档说明 |
| 内置 System Prompt | 包含具体用户画像示例 | 泛化为通用模板或模板变量 |

### 3.3 第三方服务 URL（需审查）

```
mineru.net/api/v1/agent          # PDF 解析云服务
mineru.net/api/v4                # PDF 解析精度版
openxlab.org.cn (CDN)            # MinerU CDN
i.weread.qq.com/api/agent/gateway # 微信读书网关
token.sensenova.cn/v1            # 商汤 SenseNova
open.bigmodel.cn/api/paas/v4     # 智谱 GLM-OCR
```

---

## 四、开源风险评估

### 4.1 高风险

| 风险 | 说明 | 建议 |
|------|------|------|
| **微信读书 API 逆向** | 使用了私有网关 API `https://i.weread.qq.com/api/agent/gateway`，可能涉及逆向工程 | 确认合法性，或改为官方 API（如有） |
| **Z-Library 版权** | 该平台存在版权争议，开源可能带来法律风险 | **建议移除该模块** |
| **System Prompt 含个人信息** | "奚童"是开发者姓名，硬编码在多个 Prompt 中 | 替换为通用名称 |

### 4.2 中风险

| 风险 | 说明 | 建议 |
|------|------|------|
| **第三方服务商绑定** | 硬编码了多个国内服务商（小米 MIMO、SiliconFlow、MinerU 等），开源后服务可能不稳定 | 抽象为可插拔接口 |
| **内置 System Prompt 泄露** | 包含具体用户画像示例，直接暴露开发者个人信息 | 泛化处理 |

### 4.3 低风险

| 风险 | 说明 | 建议 |
|------|------|------|
| **API Key 暴露** | 用户的个人 API Key 可能被提交到代码仓库 | 添加 `.gitignore`，文档说明 |
| **用户数据泄露** | vault 内容、搜索索引可能意外提交 | 同上 |

---

## 五、模块详细分析

### 5.1 System Prompt 详细分析

#### 发现的敏感个人信息

| 严重程度 | 文件路径 | 行号 | 内容 |
|---------|---------|------|------|
| **高** | `src/agent/pi/pi-config.ts` | 13 | `你是奚童的技能执行引擎，隶属于 DeepReader 深度阅读插件。` |
| **高** | `src/agent/context/builder.ts` | 146 | `你叫奚童，是一个运行在 Obsidian 中的顶级 AI 阅读与知识管理助手。` |
| **高** | `src/agent/graph/prompts/formatter-prompt.ts` | 11, 77, 153 | `你是奚童，用户的专属 AI 伴读...` |
| **高** | `src/agent/graph/prompts/proactive-formatter-prompt.ts` | 2, 15, 28, 75 | `你是奚童，用户的阅读伙伴...` |
| **高** | `src/agent/graph/prompts/visualizer-prompt.ts` | 64 | `右下角：仿古印章，红色方框内写"奚童"二字，opacity 0.6` |

#### 写作风格绑定

**文件: `src/agent/context/builder.ts` 第 147-152 行**:
```
- 自然、风趣，偶带书卷气
- 对问题予以情感肯定，引导深入
- 积极引导用户继续提问和深入阅读
- 仿照书信体，避免过度格式化写作
```

#### 通用 Prompt 模板（可开源）

| 文件 | 用途 | 评估 |
|------|------|------|
| `router-prompt.ts` | 阅读意图路由 | 通用，无个人信息 |
| `analytical-prompt.ts` | 分析阅读 (S2) | 通用，基于艾德勒方法论 |
| `inspectional-prompt.ts` | 检视阅读 (S1) | 通用，无个人信息 |
| `syntopical-prompt.ts` | 主题阅读 (S3) | 通用，无个人信息 |
| `pre-search-prompt.ts` | 预检索 | 通用，无个人信息 |

#### 需修改的 Prompt 模板

| 文件 | 问题 |
|------|------|
| `pi-config.ts` | 硬编码 "奚童" |
| `formatter-prompt.ts` | 硬编码 "奚童" 和写作风格 |
| `proactive-formatter-prompt.ts` | 硬编码 "奚童" |
| `visualizer-prompt.ts` | 印章使用 "奚童" |
| `context/builder.ts` | 硬编码 "你叫奚童" |

---

### 5.2 Z-Library 模块详细分析

#### 发现的敏感信息

| 文件路径 | 行号 | 内容 |
|---------|------|------|
| `src/zlibrary/constants.ts` | 1-4 | `DEFAULT_DOMAINS = ['z-library.sk', 'singlelogin.re']` |
| `src/zlibrary/constants.ts` | 7 | `User-Agent: 'Mozilla/5.0 ...'` |
| `src/zlibrary/__tests__/client.test.ts` | 42 | 测试用模拟凭证 `user: { id: 23688146, remix_userkey: 'd07560abc' }` |

#### API 端点

| 端点 | 用途 |
|------|------|
| `/eapi/user/login` | 用户登录 |
| `/eapi/book/search` | 书籍搜索 |
| `/eapi/book/{id}/{hash}/file` | 获取下载链接 |
| `/eapi/user/profile` | 用户信息 |
| `/eapi/info/domains` | 域名发现 |

#### 版权风险

Z-Library 是全球规模最大的侵权电子书平台之一：
- **2022年**：美国贸易代表处将其列入"恶名市场名单"
- **多个国家**：已被执法机关封锁或采取法律行动
- **版权侵权**：分发数百万受版权保护的书籍，未经授权

#### 开源建议：**移除（Remove）**

理由：
1. Z-Library 是公认的侵权平台，与之集成存在极高法律风险
2. 即便代码本身是技术中立的，但集成行为本身可能构成"帮助侵权"
3. 开源后可能使项目被用于大规模版权侵权，带来法律追责

#### 文件去留清单

| 文件 | 建议 |
|------|------|
| `src/zlibrary/` | **保留**（功能开关控制） |
| `src/views/zlibrary-search-modal.ts` | **保留**（功能开关控制） |
| `src/views/zlibrary-search-modal.css` | **保留**（功能开关控制） |
| `src/config/settings.ts` 中的 zlibrary 配置项 | 添加 `enableZlibrary` 开关 |
| `src/views/library-view.ts` 中的 zlibrary 逻辑 | 条件导入 + 开关检查 |
| `tests/specs/` 中的 zlibrary 相关测试文件 | **保留** |

#### 已实施的拆分方案

**方案：编译时常量 + 运行时检查**

**1. 功能开关文件** (`src/config/features.ts`)
```typescript
// Z-Library 插件（版权风险模块，默认关闭）
export const ZLIBRARY_ENABLED = false;
```

**2. 设置界面** (`src/config/settings.ts`)
```typescript
// Z-Library 集成
enableZlibrary: boolean;  // 新增开关，默认 false
zlibraryUserId: string;
zlibraryUserKey: string;
zlibraryDomain: string;
```

**3. 条件导入** (`src/views/library-view.ts`)
```typescript
import { ZLIBRARY_ENABLED } from '../config/features.js';

private proceedZlibDownload(index: IndexListItem): void {
    // 检查 Z-Library 功能开关
    if (!ZLIBRARY_ENABLED) {
        new Notice('Z-Library 功能已关闭，请前往设置启用', 3000);
        return;
    }

    const settings = this.options.plugin?.settings;
    if (!settings?.enableZlibrary) {
        new Notice('请先在设置中启用 Z-Library 功能', 3000);
        return;
    }
    // ... 继续原有逻辑
}
```

**4. 法律免责声明** (`src/zlibrary/DISCLAIMER.ts`)
```typescript
export const ZLIBRARY_DISCLAIMER = `
【法律警告】

本模块集成了 Z-Library 服务。Z-Library 是一个存在版权争议的电子书平台。

使用本模块前，请确保：
1. 您下载的书籍已进入公版领域（作者去世超过 70 年），或
2. 您拥有该书籍的合法授权

用户需自行承担使用风险。DeepReader 不对任何版权侵权行为承担责任。
...
`.trim();
```

**开源发布操作**
```bash
# 发布开源版本时，确保 ZLIBRARY_ENABLED = false
# 用户需要时可手动启用
```

---

### 5.3 微信读书模块详细分析

#### 发现的敏感信息

**本模块未发现硬编码的 API Key、Token 或凭证。**

| 类型 | 文件路径 | 行号 | 内容 | 风险等级 |
|------|----------|------|------|----------|
| API Gateway URL | `src/weread/api/client.ts` | 21 | `https://i.weread.qq.com/api/agent/gateway` | 低（服务端点，非凭证） |
| Skill 版本号 | `src/weread/api/client.ts` | 22 | `SKILL_VERSION = '1.0.3'` | 低（客户端版本标识） |
| 用户 API Key | `src/config/settings.ts` | 252 | `wereadApiKey: ''`（默认空） | 无（用户自行提供） |

#### API 交互分析

**架构：网关代理模式（Gateway Agent）**

所有 API 调用统一发送到：
```
POST https://i.weread.qq.com/api/agent/gateway
```

**涉及的 API 端点：**

| API 端点 | 用途 | 对应方法 |
|----------|------|----------|
| `/user/notebooks` | 获取用户书籍列表 | `getNotebook()` |
| `/shelf/sync` | 同步书架 | `getShelf()` |
| `/book/bookmarklist` | 获取高亮/书签 | `getHighlights(bookId)` |
| `/review/list/mine` | 获取评论 | `getReviews(bookId)` |
| `/book/chapterinfo` | 获取章节信息 | `getChapters(bookId)` |
| `/book/getprogress` | 获取阅读进度 | `getProgress(bookId)` |
| `/store/search` | 搜索书籍 | `searchBooks(keyword)` |
| `/book/recommend` | 推荐书籍 | `recommendBooks()` |
| `/readdata/detail` | 阅读统计数据 | `getReadingData()` |

#### 是否涉及逆向工程

**结论：存在争议，需要进一步确认。**

支持"官方 API"的依据：
- 使用微信读书官方域名 `i.weread.qq.com`
- Bearer Token 认证方式符合标准 OAuth/API Key 规范
- 代码注释称其为"网关代理模式"，暗示这是有意设计的架构

存在疑虑的依据：
- 这些 API 端点未在微信读书公开文档中出现
- `i.weread.qq.com/api/agent/gateway` 路径中的 `/agent/` 暗示这是内部代理服务

#### 开源建议：保留，但需添加法律免责声明

**必须添加的保护措施：**

1. 在 README 中添加免责声明：
   ```
   本模块与微信读书 API 的交互基于"网关代理模式"。
   用户需自行获取微信读书 API 访问权限，并确保使用方式符合微信读书服务条款。
   DeepReader 不对因 API 使用导致的任何问题承担责任。
   ```

2. 考虑迁移到官方 API（如有）

---

### 5.4 PI Agent 模块详细分析

#### 发现的敏感信息

**文件: `src/agent/pi/pi-config.ts`**

| 类型 | 行号 | 内容 |
|------|------|------|
| System Prompt | 13-23 | 硬编码品牌信息"DeepReader"、"奚童"、语言约束"中文输出" |
| CLI 路径 | 113-118 | 仅覆盖 macOS + Homebrew 环境 |

**测试中的 Mock 数据（无风险）**:
- `src/agent/pi/__tests__/pi-manager.test.ts:23` - `const config = manager.buildConfig('my-key', 'gpt-4', 'openai');`

#### 硬编码 CLI 路径

```typescript
candidates.push(
    '/opt/homebrew/bin/pi',           // Apple Silicon Homebrew
    '/usr/local/bin/pi',              // Intel Homebrew
    join(home, '.npm-global/bin/pi'), // 用户自定义 npm prefix
    join(home, '.local/bin/pi'),      // 手动安装
    'pi',                             // 最后尝试 PATH（兜底）
);
```

**问题：**
- 仅覆盖 macOS + Homebrew 环境
- Linux (apt/yum/pacman)、Windows (scoop/choco) 完全缺失
- PATH 拼接是白名单，只加了 Homebrew/npm-global/.local，nix、conda 等未覆盖

#### 子进程通信机制

| 层级 | 实现 |
|------|------|
| 传输 | `child_process` spawn → stdin/stdout pipe |
| 序列化 | JSONL（每行一个 JSON 对象） |
| 方向 | stdin → PI（命令），stdout → 本地（事件） |

**状态机：**
```
STOPPED → STARTING → READY → BUSY → READY
                      ↓
                   ERROR → (重启后回到 STARTING)
```

#### 风险评估

| 风险 | 概率 | 影响 | 当前缓解措施 |
|------|------|------|-------------|
| PI CLI 未安装 | 中 | 高 | `detectPiCli()` 带缓存，5 分钟 TTL |
| 版本不兼容 | 低 | 高 | 无版本检查；`setAutoRetry` 等调用用 catch 吞掉错误 |
| 子进程崩溃 | 中 | 高 | `on('close')` 标记 ERROR；90s overall timeout |
| macOS GUI PATH 不完整 | 高 | 高 | `buildSpawnEnv()` 手动拼接 Homebrew 路径 |
| 并发调用 | 低 | 中 | `busy` 标志 + 并发拒绝错误消息 |

#### 开源建议

**必须修复：**
1. 移除 System Prompt 中的品牌信息 "DeepReader"、"奚童"
2. "中文输出" 应变为 locale 配置

**强烈建议：**
1. 路径检测扩展到全平台（Linux、Windows）
2. 添加 PI 版本协商
3. `setAutoRetry`/`setAutoCompaction` 失败应 warn 而非静默

---

### 5.5 Config 模块详细分析

#### 硬编码的 API URL（公开信息）

| 服务商 | Base URL | 硬编码位置 |
|--------|----------|-----------|
| DeepSeek | `https://api.deepseek.com` | `providers.ts:45`, `defaults.ts:11` |
| MiniMax | `https://api.minimaxi.com/v1` | `providers.ts:39` |
| Kimi | `https://api.moonshot.cn/v1` | `providers.ts:52` |
| SiliconFlow | `https://api.siliconflow.cn/v1` | `providers.ts:59` |
| OpenAI | `https://api.openai.com/v1` | `providers.ts:65` |
| 小米 MIMO | `https://token-plan-cn.xiaomimimo.com/v1` | `providers.ts:72` |
| 小米 MIMO fallback | `https://api.xiaomimo.com/v1` | `providers.ts:161` |
| SenseNova | `https://token.sensenova.cn/v1` | `providers.ts:78`, `infographic-generator.ts:5` |

#### 硬编码的默认模型

| 服务商 | 默认模型 |
|--------|----------|
| minimax | `MiniMax-M2.7` |
| deepseek | `deepseek-v4-flash` |
| kimi | `kimi-k2.5` |
| siliconflow | `Qwen/Qwen3-8B` |
| openai | `gpt-4o` |
| xiaomi | `mimo-v2.5` |
| sensenova | `sensenova-u1-fast` |

#### 敏感配置字段（需用户自行设置）

| 字段 | 存储位置 |
|------|----------|
| `sensenovaApiKey` | `settings.ts:113,233` |
| `wereadApiKey` | `settings.ts:132,252` |
| `zlibraryUserId` | `settings.ts:138,258` |
| `zlibraryUserKey` | `settings.ts:139,259` |
| `langsmithApiKey` | `settings.ts:123,239` |

#### 开源建议

**可安全开源的内容：**
- 所有 Base URL（公开 API 端点）
- 默认模型名称列表
- Embedding 维度映射表
- 思考模型检测模式
- 服务商能力矩阵
- 预设配置

**需注意的事项：**
1. 第三方服务依赖（SenseNova、MinerU）建议抽象为接口
2. Z-Library 集成的法律风险需在文档中说明

---

### 5.6 第三方服务 URL 汇总

#### AI 服务提供商 (LLM)

| 服务商 | Base URL | 用途 |
|--------|----------|------|
| DeepSeek | `https://api.deepseek.com` | 对话、Embedding |
| MiniMax | `https://api.minimaxi.com/v1` | 对话、图片生成 |
| Kimi | `https://api.moonshot.cn/v1` | 对话 |
| SiliconFlow | `https://api.siliconflow.cn/v1` | 对话、Embedding、Reranker |
| OpenAI | `https://api.openai.com/v1` | 对话、Embedding |
| 小米 MIMO | `https://token-plan-cn.xiaomimimo.com/v1` | 对话、TTS |
| 商汤 SenseNova | `https://token.sensenova.cn/v1` | 对话、图片生成 |

#### PDF 解析服务

| 服务 | URL | 硬编码位置 |
|------|-----|-----------|
| MinerU Agent | `https://mineru.net/api/v1/agent` | `mineru-api.ts:22` |
| MinerU Precision | `https://mineru.net/api/v4` | `mineru-api.ts:23` |
| MinerU CDN | `https://cdn-mineru.openxlab.org.cn` | `mineru-api.ts:151` |

#### OCR 服务

| 服务 | URL | 硬编码位置 |
|------|-----|-----------|
| 智谱 GLM-OCR | `https://open.bigmodel.cn/api/paas/v4` | `ocr.ts:175`, `pageindex.ts:289` |

#### 微信读书

| 服务 | URL | 硬编码位置 |
|------|-----|-----------|
| 微信读书网关 | `https://i.weread.qq.com/api/agent/gateway` | `weread/api/client.ts:21` |

#### 追踪服务

| 服务 | URL | 硬编码位置 |
|------|-----|-----------|
| LangSmith | `https://api.smith.langchain.com` | `langsmith.ts:75` |

#### 电子书下载

| 服务 | 域名 | 硬编码位置 |
|------|------|-----------|
| Z-Library | `z-library.sk`, `singlelogin.re` | `constants.ts:2` |

#### 服务商稳定性评估

| 风险等级 | 服务 | 说明 |
|----------|------|------|
| **高** | Z-Library | 法律风险、域名不稳定 |
| **高** | MinerU | 创业公司，CDN 依赖商汤 |
| **高** | SenseNova | 商汤产品线可能调整 |
| **中** | 微信读书 | 非官方 API |
| **中** | 智谱 GLM-OCR | 商业公司，可能收费调整 |
| **中** | LangSmith | LangChain 官方，可能收费 |
| **低** | DeepSeek/OpenAI | 成熟服务 |

---

## 六、开源建议结构

```
deepreader/
├── src/                         # 核心代码（开源）
│   ├── agent/                   # AI Agent 引擎
│   │   ├── react/              # 可开源
│   │   └── pi/                 # 需处理 System Prompt
│   ├── pageindex/               # 索引引擎
│   ├── ui/                      # 视图组件
│   └── utils/                   # 工具
├── docs/                        # 文档（开源）
├── tests/                       # 测试用例
├── package.json                 # 依赖配置
├── README.md                    # 项目说明
├── COMMUNITY.md                 # 社区贡献指南
└── .gitignore                   # 排除敏感文件

# 需单独处理或模块化
├── plugins/                     # 可选插件（开源但需用户配置）
│   └── weread/                 # 微信读书集成（保留但需免责声明）
└── config/                      # 配置模板（环境变量注入）

# 强烈建议移除
└── src/zlibrary/               # Z-Library（法律风险太高）
```

---

## 七、开源前必做清单

### 安全类
- [ ] 清除所有硬编码 API Key（providers、settings）
- [ ] **移除 System Prompt 中的"奚童"个人信息**（5+ 文件）
- [ ] 确认微信读书 API 使用合法性
- [x] **Z-Library 模块使用功能开关控制**（默认关闭，已实施）
- [ ] 添加 `.gitignore` 排除用户数据

### 法务类
- [ ] 确认第三方服务条款（特别是小米 MIMO、MinerU）
- [x] Z-Library 法律风险通过功能开关和免责声明缓解（已实施）
- [ ] 准备开源许可证（建议 MIT 或 Apache 2.0）
- [ ] 微信读书模块添加法律免责声明

### 文档类
- [ ] 编写 README（项目介绍、安装、使用）
- [ ] 编写 CONTRIBUTING.md（贡献指南）
- [ ] 编写 SECURITY.md（安全政策）
- [ ] 编写 CHANGELOG.md（版本记录）
- [ ] 添加第三方服务使用说明

### 架构类
- [ ] 抽象第三方服务为可插拔接口（MinerU、OCR）
- [ ] 将 weread 拆为独立插件或可选模块
- [x] Z-Library 使用 ZLIBRARY_ENABLED 编译常量控制（已实施）
- [ ] 清理无用依赖和死代码
- [ ] PI Agent 添加跨平台路径检测

---

## 八、关键风险排序

| 优先级 | 风险项 | 模块 | 处理方式 |
|--------|--------|------|----------|
| **P0** | Z-Library 版权 | `src/zlibrary/` | **直接删除** |
| **P0** | System Prompt 含"奚童" | `pi-config.ts`, `formatter-prompt.ts` 等 | 替换为通用名称 |
| **P1** | 微信读书 API 合法性 | `src/weread/` | 添加免责声明，验证 API 来源 |
| **P1** | 小米 MIMO 非官方 API | `providers.ts` | 抽象为可配置接口 |
| **P2** | MinerU 服务不稳定 | `mineru-api.ts` | 添加 fallback 机制 |
| **P2** | PI Agent 跨平台支持 | `pi-config.ts` | 扩展路径检测 |

---

## 九、参考链接

- [Obsidian Plugin 官方文档](https://docs.obsidian.md/Plugins+Index)
- [LangGraph 官方文档](https://langchain-ai.github.io/langgraph/)
- [MIT License](https://opensource.org/licenses/MIT)
- [Apache 2.0 License](https://opensource.org/licenses/Apache-2.0)
- [恶名市场名单 2022](https://ustr.gov/sites/default/files/2022-02/2022%20Notorious%20Markets%20List.pdf)

---

*本文档由 Claude Code 多 Agent 并行分析生成，如需更新请重新分析。*
