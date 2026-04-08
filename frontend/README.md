# DeepReader Obsidian Plugin

PDF 智能索引和问答插件，使用 PageIndex 本地引擎实现完全本地化的语义搜索。

## 核心特性

- 📚 **PDF/EPUB 智能索引** - 使用 PageIndex 进行智能章节分割和向量化
- 🔍 **混合搜索** - 向量语义搜索 + BM25 关键词检索
- 💬 **AI 助手** - FrontendAgent 智能对话，自动引用书籍内容
- 🔒 **完全本地化** - 所有数据存储在本地，保护隐私
- 🚀 **无需后端** - 纯前端架构，无需外部服务

## 安装

### 从发布版本安装

1. 下载最新版本的 `main.js`, `styles.css`, `manifest.json`
2. 复制到 Obsidian vault 的 `.obsidian/plugins/deepreader/` 目录
3. 在 Obsidian 设置中启用 DeepReader 插件

### 从源码构建

```bash
# 克隆项目
git clone https://github.com/your-repo/deepreader.git
cd deepreader/frontend

# 安装依赖
npm install

# 构建
npm run build

# 复制到测试 vault
npm run deploy
```

## 配置

### 基础配置

1. 打开 Obsidian 设置 > DeepReader
2. 配置 LLM API：
   - **API Key**: OpenAI/DeepSeek API 密钥
   - **Model**: 模型选择（推荐 gpt-4o-mini）
   - **API URL**: API 端点（默认 OpenAI）

### Embedding 配置（可选）

如需启用向量搜索，配置 Embedding API：

```json
{
  "embedding": {
    "provider": "openai",
    "model": "text-embedding-3-small",
    "dimensions": 1536,
    "apiKey": "your-api-key",
    "baseUrl": "https://api.openai.com/v1"
  }
}
```

## 使用指南

### 索引书籍

**方式 1: 通过书库界面**
1. 打开 DeepReader 侧边栏
2. 点击"书库"按钮
3. 点击"+"添加 PDF/EPUB 文件
4. 等待索引完成

**方式 2: 直接打开 PDF**
1. 在 Obsidian 中打开 PDF 文件
2. 点击顶部工具栏的"索引"按钮
3. 自动开始索引流程

### 搜索书籍

1. 在侧边栏搜索框输入关键词
2. 查看搜索结果
3. 点击结果跳转到原文位置

### AI 对话

1. 在聊天输入框输入问题
2. AI 助手会自动引用已索引书籍的相关内容
3. 点击引用标记跳转到原文

## 开发

### 开发命令

```bash
# 安装依赖
npm install

# 开发模式（监听文件变化）
npm run dev

# 构建（包含类型检查）
npm run build

# 测试
npm run test:run

# 测试 UI
npm run test:ui

# 部署到测试 vault
npm run deploy
```

### 调试

在 Obsidian 中：
1. 按 Cmd+Option+I 打开开发者工具
2. 在 Console 中查看日志
3. 使用 `app.plugins.plugins['deepreader']` 访问插件实例

## 架构

```
frontend/
├── src/
│   ├── main.ts                    # 插件入口
│   ├── pageindex/                 # PageIndex 核心引擎
│   │   ├── node.ts                # Node.js 入口
│   │   ├── book-indexer.ts        # 书籍索引
│   │   ├── book-search.ts         # 混合搜索
│   │   ├── bm25.ts                # BM25 算法
│   │   ├── parsers/               # 文档解析器
│   │   ├── exporters/             # Obsidian 导出
│   │   └── vault/                 # 向量存储
│   ├── agent/                     # AI 助手
│   │   └── tools/                 # 工具集
│   ├── api/                       # HTTP 客户端（LLM API）
│   ├── views/                     # 视图组件
│   │   └── sidebar-view.ts        # 侧边栏
│   ├── components/                # UI 组件
│   │   ├── library-modal/         # 书库
│   │   └── chat-input/            # 聊天输入
│   └── services/                  # 业务服务
└── styles.css                     # 构建输出的样式
```

### 核心模块

- **PageIndex**: 本地索引和搜索引擎
- **FrontendAgent**: AI 对话助手
- **LibraryModal**: 书籍管理界面
- **SidebarView**: 主界面

## 存储结构

所有索引数据存储在 vault 的 `.pageindex/` 目录：

```
.pageindex/
└── {bookId}/
    ├── book-meta.json         # 书籍元数据
    ├── bm25.json              # BM25 索引
    ├── vectors.f32            # 向量数据（可选）
    └── vectors.meta.json      # 向量元数据（可选）
```

## 性能

### 索引速度

- PDF 解析: ~1-2 秒/页
- LLM 摘要: ~0.5-1 秒/章节
- 向量化: ~100ms/章节（可选）

### 存储占用

- BM25 索引: ~1KB/章节
- 向量存储: ~6KB/章节（Float32, 1536 维）

## 故障排查

### 索引失败

1. 检查 API Key 是否正确
2. 查看 Obsidian Console 日志
3. 确认文件路径可访问

### 搜索无结果

1. 确认书籍已索引完成
2. 检查 `.pageindex/` 目录是否存在
3. 尝试重新索引

### 插件无法加载

1. 检查 `manifest.json` 是否正确
2. 确认 Node.js 版本 >= 18
3. 查看 Obsidian Console 错误信息

## 许可证

MIT