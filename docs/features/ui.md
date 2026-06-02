# 用户界面（F-22 ~ F-25）

> 对话应随时可达。书多了就需要管理。
> 新用户的第一个门槛是配置。不同角色需要不同模型。

---

## F-22: Sidebar 聊天界面

- **为什么存在**: 对话应随时可达。侧边栏不遮挡阅读内容，用户可以边读边聊。如果 AI 对话需要切换窗口或打开新视图，使用频率会大幅降低。
- **用户故事**: 作为用户，我希望在右侧栏直接和 AI 对话，无需切换窗口
- **前置条件**: 插件已加载
- **输入**: 点击 DeepReader 图标 / 命令面板打开 sidebar
- **输出**: 右侧栏出现聊天界面（含书库选择、消息列表、输入框）
- **验收标准**:
  - [ ] 命令 `DeepReader: Open DeepReader sidebar` 可打开
  - [ ] sidebar 包含书库选择、消息区、输入框
  - [ ] 消息流式输出（逐字显示）
  - [ ] 操作按钮（重新生成/复制）可点击
  - [ ] 支持多轮对话
  - [ ] sidebar 可关闭/重开不丢消息
- **对应测试**:
  - 单元: `tests/unit/components/{chat-input,drawer,top-nav,chapter-nav-keyboard}.test.ts`
  - E2E: `tests/e2e/specs/langgraph-agent.e2e.ts`、`weread-ui.e2e.ts`
  - 覆盖状态: ⚠️ 部分
- **详见**: product-manual §3.1

---

## F-23: Library 书库管理

- **为什么存在**: 书多了就需要管理。没有集中视图，用户不知道自己索引了什么、哪些书已读、哪些可以开始。Library 是用户进入 DeepReader 工作流的起点。
- **用户故事**: 作为用户，我希望在一个集中视图里管理所有已索引的书籍
- **前置条件**: 插件已加载
- **输入**: 命令 `DeepReader: Open Library` / sidebar 中的"书库"按钮
- **输出**: Library 视图（书籍列表 + 添加按钮 + 搜索框）
- **验收标准**:
  - [ ] 书籍列表显示书名、作者、进度
  - [ ] 添加 PDF/EPUB 按钮可点击
  - [ ] 支持搜索书名/作者
  - [ ] 支持按标签/状态过滤
  - [ ] 删除书籍二次确认
  - [ ] 大库（> 100 本）滚动流畅
- **对应测试**: 无
- **覆盖状态**: ❌ 无
- **详见**: product-manual §3.1

---

## F-24: Quick Setup 向导

- **为什么存在**: 新用户的第一个门槛是配置。5 分钟内能让 AI 跑起来，否则用户流失。Quick Setup 把"安装→配置→第一次对话"的路径压缩到最短。
- **用户故事**: 作为新用户，我希望有个引导帮我配置 API Key 和模型
- **前置条件**: 首次安装或主动触发
- **输入**: 命令 `DeepReader: 打开快速配置`
- **输出**: 模态框（含 API Key 输入、provider 选择、模型选择）
- **验收标准**:
  - [ ] 模态框含 API Key 输入（密码类型）
  - [ ] provider 下拉列表（DeepSeek/Kimi/MiniMax/...）
  - [ ] 选择 provider 后显示对应模型
  - [ ] 配置保存后可立即使用
  - [ ] 已有配置时显示"重新配置"选项
  - [ ] 关闭后下次启动不再弹出
- **对应测试**:
  - 单元: `tests/unit/config/setup-complete.test.ts`
  - 覆盖状态: ✅ 强
- **详见**: product-manual §4

---

## F-25: Settings 面板（双层 providers/roles）

- **为什么存在**: 不同角色需要不同模型。chat 要聪明但慢，router 要快但便宜。精细控制降低成本 + 提升体验。双层架构（providers → roles）让用户先配账号、再分配角色，直觉清晰。
- **用户故事**: 作为高级用户，我希望精细控制每个角色（chat/router/embedding/...）用哪个模型
- **前置条件**: 插件已加载
- **输入**: Obsidian Settings → DeepReader
- **输出**: 多 tab 设置面板
- **验收标准**:
  - [ ] 含 6 个 tab：API/Embedding/Indexing/Reading/Tracing/Advanced
  - [ ] 双层结构：providers（账号）→ roles（角色）
  - [ ] 添加 provider 时校验 endpoint
  - [ ] 修改角色模型立即生效
  - [ ] 配置可导出/导入（备份）
  - [ ] 旧配置自动迁移（settings-migrator）
- **对应测试**:
  - 单元: `tests/unit/config/{providers,presets,presets-detect,apply-preset,embedding-dimensions,settings-migrator}.test.ts`、`settings/helpers.test.ts`
  - 覆盖状态: ✅ 强
- **详见**: product-manual §4
