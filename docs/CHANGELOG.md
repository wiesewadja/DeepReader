# Changelog

> 从 git 历史反推的版本记录。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/)。

---

## [Unreleased]

### Added
- 上次阅读位置持久化（last-page-store v2，支持 v1→v2 自动迁移）
- 最近阅读入口（sidebar 封面点击 → openMostRecent）
- Library 封面点击直接进入阅读模式（自动恢复页码）
- 阅读进度反回归测试（S-RP-ANTI 冒烟检查 + 单元测试）
- 书籍软归档切换 E2E spec
- 上次阅读位置恢复 E2E spec

### Changed
- 插件 ID 硬编码 `'deepreader'` 全部替换为 `this.manifest.id`（支持 dev/daily 双安装）
- 测试/脚本统一使用 `deepreader-dev` 插件 ID
- deploy.js 支持 pluginId 配置
- PagePaginator 增加 onPageChange 回调，翻页即记录

---

## 2026-06-01 — 删除阅读进度 + 测试基础设施

### Added
- 冒烟测试 26 场景 + 轻量 E2E 框架
- .env 驱动的 test-vault 配置注入
- Archon 审查工作流 + S-24/S-25 稳定性修复

### Changed
- 删除旧阅读进度系统（reading-progress.ts、milestones.ts），新增书籍软归档（archive.ts）
- 抽取 EPUB 拆分纯函数 + 死代码清理

### Fixed
- 安全守卫：段级路径匹配 + JSON 输入解析 + 审计日志
- 恢复严格断言——暴露真实问题而非降级通过

---

## 2026-05-30~31 — PI 可视化集成

### Added
- PI 可视化器集成到状态机 VISUALIZER 节点
- PI Agent provider/api-key CLI 传递

### Fixed
- PI 可视化稳定性：session 隔离、心跳检测、输出容错
- routeAfterPreSearch 条件边映射表漏注册 VISUALIZER
- depth=2 + 可视化意图 + pre_search 早停时路由到 VISUALIZER

---

## 2026-04 — 微信读书 + Z-Library + 用户画像

### Added
- 微信读书账号绑定、标注同步、强制全量同步
- Z-Library 搜索下载（默认关闭）
- 用户画像 + 长期记忆（profile-facts、MEMORY.md）
- 提早停止（Early Stop）机制

---

## 2026-03 — Agent 认知引擎

### Added
- 四层认知引擎（闲聊/检视/分析/主题阅读）
- LangGraph 状态机编排
- Agent 工具：search_book、read_book_section、write_note、canvas、excalidraw
- 主动阅读引导
- 意图路由器（IntentRouter）
- 配置系统双层架构（providers → roles）
- Quick Setup 向导

---

## 2026-02 — 阅读模式

### Added
- 分页阅读（PagePaginator）
- 章节导航（ChapterNav）
- 文字选择工具栏（SelectionToolbar）
- 高亮/摘录保存
- 阅读模式服务（ReadingModeService）

---

## 2026-01 — 项目初始化

### Added
- Obsidian 插件脚手架
- PageIndex 索引引擎（PDF/EPUB 解析）
- BM25 混合搜索
- 索引导出为 Obsidian Markdown 笔记
- 向量搜索（embedding 支持）
- 中文 embedding 模型（BAAI/bge-small-zh-v1.5）
