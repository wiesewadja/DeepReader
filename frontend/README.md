# DeepPDF Obsidian Plugin

PDF 智能索引和问答插件，通过 HTTP API 与 FastAPI 后端通信。

## 功能

- 📚 PDF 文档索引（使用 PageIndex 进行智能章节分割）
- 🔍 语义搜索和问答
- 📊 侧边栏查询界面
- ⚙️ 可配置的设置面板
- 🗂️ 索引管理
- 🚀 自动启动后端服务器

## 安装

1. 构建插件：
   ```bash
   cd frontend
   npm install
   npm run build
   ```

2. 复制到 Obsidian 插件目录：
   ```bash
   cp -r frontend /path/to/obsidian/vault/.obsidian/plugins/deeppdf
   ```

3. 在 Obsidian 设置中启用 DeepPDF 插件

## 配置

1. 打开 Obsidian 设置 > DeepPDF
2. 设置 Backend Path 为 FastAPI 后端目录（`backend` 的绝对路径）
3. 设置 API Port（默认：8000）
4. 调整 Max Results 设置

## 使用

### 索引 PDF

1. 打开 DeepPDF 侧边栏
2. 点击"管理索引"
3. 选择 PDF 文件进行索引

### 查询 PDF

1. 在侧边栏输入框中输入问题
2. 点击"提问"按钮
3. 查看搜索结果

## 开发

```bash
# 安装依赖
npm install

# 开发模式（热重载）
npm run dev

# 构建
npm run build

# 测试
npm run test:run
```

## 架构

```
frontend/
├── src/
│   ├── main.ts              # 插件入口
│   ├── api/                 # HTTP 客户端
│   │   ├── http-client.ts   # API 客户端
│   │   └── server-manager.ts # 服务器进程管理
│   ├── views/               # 视图组件
│   │   └── sidebar-view.ts
│   ├── ui/                  # UI 组件
│   │   └── index-manager-modal.ts
│   └── styles/              # 样式
│       └── main.css
└── styles.css               # 构建输出的样式
```

## 许可证

MIT
