# SPEC: 奚童 PI Agent 集成

> **版本**: 1.0
> **日期**: 2026-05-27
> **状态**: 待确认

---

## 1. Objective

### 目标

将奚童的 Skill 执行能力（知识卡片、思维导图、阅读笔记等）和可视化生成分离到外部 PI Coding Agent，插件核心只保留阅读认知引擎。PI 作为奚童的"技能执行引擎"运行，通过 RPC 子进程集成。

### 目标用户

DeepReader 插件的现有 Obsidian 用户。其中愿意启用高级 Skill 能力的用户需要安装 PI CLI。

### 核心价值

- **插件瘦身**：移除 skill 加载/执行逻辑，插件只保留 LangGraph 认知引擎核心
- **能力扩展**：PI 拥有文件读写、搜索等工具，skill 执行能力远超当前的 LLM-only 方案
- **Skill 外置**：skill 定义留在 vault，PI 从 vault 加载，新增 skill 无需改代码

### 成功标准

1. 用户触发 skill 请求时，奚童能识别并转交 PI 执行
2. PI 结果写入 vault 指定路径，奚童通知用户并自动打开文件
3. 现有 5 个内置 skill 全部迁移为 PI 可执行的格式
4. 插件设置页可管理 PI 的安装、更新和状态检测
5. PI 未安装时，skill 请求有明确的降级提示

---

## 2. Architecture

### 路由架构

```
用户消息 → Intent Router
  ├─ 阅读认知类（检视/分析/主题阅读）→ LangGraph 认知引擎（不变）
  ├─ Skill 类 → PI RPC 子进程
  └─ 意图不明 → PI RPC 子进程（兜底）

LangGraph 执行中"能力不足" → PI RPC 子进程（兜底）
```

### PI 集成规格

| 项 | 决策 |
|---|------|
| 集成方式 | RPC 子进程（`pi --mode rpc`） |
| 职责 | Skill 执行 + 可视化（全部 skill 化） |
| 生命周期 | 懒启动，长驻到插件卸载，每次 `new_session` |
| 配置存储 | vault 目录内（`DeepReader/pi/`） |
| 模型/API Key | 复用奚童配置，通过启动参数传入 |
| 工具白名单 | `read,write,edit,grep,find,ls`（无 bash） |
| Skill 选择 | PI 自行判断（奚童传意图 + skill 列表描述） |
| 结果输出 | PI 写入 vault 指定路径 |
| 用户通知 | 聊天回复路径 + 自动打开文件 |
| 并发策略 | 拒绝 + 提示"正在执行中" |
| 错误处理 | PI 自带 auto_retry，奚童管进程 + 超时 abort |

### 上下文传递格式

奚童构造结构化上下文传给 PI：

```typescript
interface PiSkillContext {
  book: {
    title: string;
    author: string;
  };
  context: {
    currentSection: string;
    analysisSummary: string;
  };
  skillDescriptions: string[];   // vault 中所有 skill 的名称和描述
  outputPath: string;            // 奚童指定的输出文件路径
  userRequest: string;           // 用户的原始请求
}
```

### PI 启动命令

```bash
pi --mode rpc --no-session \
   --session-dir "<vault>/DeepReader/pi/sessions" \
   --no-skills \
   --skill "<vault>/DeepReader/skills" \
   --no-context-files \
   --tools read,write,edit,grep,find,ls \
   --api-key "<key>" \
   --model "<model>" \
   --append-system-prompt "你是奚童的技能执行引擎..."
```

> **注意**: 必须使用 `--no-skills` 先禁用全局 skill 发现，再用 `--skill` 只加载 vault 的 skill，否则 PI 会混入全局安装的 skills。

### PI 系统提示词

```
你是奚童的技能执行引擎，隶属于 DeepReader 深度阅读插件。

你的职责：
- 根据用户的阅读请求，执行对应的 skill（知识卡片、思维导图、阅读笔记等）
- 结果写入指定路径的文件

你的约束：
- 只处理与阅读相关的任务
- 所有输出写入文件，不直接回复用户
- 使用 vault 中的 skill 定义来指导执行
- 使用中文输出
```

### 调用时序

```
1. 用户发送消息（"帮我画个思维导图"）
2. IntentRouter 识别为 skill 意图
3. FrontendAgent 构造 PiSkillContext
4. PiRpcClient.newSession()
5. PiRpcClient.prompt(context)
6. 等待 agent_end 事件
7. 奚童回复："思维导图已生成，保存在 DeepReader/exports/xxx.md"
8. Obsidian 自动打开该文件
```

---

## 3. Commands

### 开发命令

无新增构建命令。PI 是运行时外部依赖。

### 运行时命令（PI 管理）

| 操作 | 实现方式 |
|------|---------|
| 检测 PI 是否已安装 | `child_process.execSync('pi --version')` |
| 安装 PI | `npm install -g @mariozechner/pi-coding-agent` |
| 更新 PI | `pi update --self` |
| 启动 PI RPC | `child_process.spawn('pi', ['--mode', 'rpc', ...])` |
| 发送 prompt | stdin 写入 JSONL `{"type":"prompt","message":"..."}` |
| 等待完成 | 监听 stdout JSONL `agent_end` 事件 |
| 新建 session | stdin 写入 `{"type":"new_session"}` |
| 终止 PI | `process.kill()` |

---

## 4. Project Structure

### 新增文件

```
src/agent/pi/
├── pi-client.ts          # PiRpcClient — RPC JSONL 通信客户端
├── pi-manager.ts         # PiProcessManager — 进程生命周期管理（懒启动、长驻、重启）
├── pi-config.ts          # PI 配置管理（启动参数构建、vault 路径解析）
├── pi-context.ts         # PiSkillContext 构造逻辑
└── types.ts              # PI 相关类型定义

src/settings/sections/
└── pi-section.ts         # 设置页 PI 管理 section（安装/更新/状态检测）
```

### 修改文件

| 文件 | 改动内容 |
|------|---------|
| `src/agent/router/intent-router.ts` | 增加 skill 意图识别逻辑 |
| `src/agent/router/intent-rules.json` | 新增 skill 意图路由规则 |
| `src/agent/index.ts` | 集成 PiProcessManager，增加 PI 调用路径 |
| `src/settings/setting-tab.ts` | 新增 PI 管理 Tab |
| `src/config/settings.ts` | 新增 PI 相关设置字段 |

### 移除文件

| 文件 | 原因 |
|------|------|
| `src/agent/skills/loader.ts` | skill 加载逻辑移交给 PI |
| `src/agent/skills/types.ts` | skill 类型不再需要 |
| `src/agent/skills/index.ts` | 模块导出不再需要 |
| `src/agent/tools/skill.ts` | skill 工具不再需要（PI 直接执行） |
| `src/built-in-skills.ts` | 内置 skill 定义移除（skill 文件保留在 vault） |

---

## 5. Code Style

### 遵循现有规范

- TypeScript strict mode
- 使用 `utils/logger.ts` 按模块分类日志
- 文件路径通过 Vault API 获取，不硬编码
- 错误日志不受开关影响

### PI 模块特定约定

- **JSONL 解析**：不在 Node `readline` 上做（它把 U+2028/U+2029 当换行符），自行按 `\n` 分割
- **进程管理**：所有 `child_process` 操作封装在 `PiProcessManager` 内，不暴露给外部
- **超时控制**：PI 调用设置 60 秒超时，超时发 `abort` 命令
- **错误边界**：PI 相关错误不抛出到 LangGraph 引擎，独立处理

---

## 6. Testing Strategy

### 单元测试

| 测试对象 | 测试内容 |
|---------|---------|
| `PiRpcClient` | JSONL 序列化/反序列化、事件解析 |
| `PiProcessManager` | 进程启动参数构建、重启逻辑、超时处理 |
| `PiConfig` | 启动命令构建、路径解析 |
| `PiContext` | PiSkillContext 构造、skill 描述提取 |
| IntentRouter | skill 意图识别（新增规则的正则匹配） |

### 集成测试

| 测试场景 | 验证点 |
|---------|--------|
| PI 未安装时触发 skill | 降级提示正确显示 |
| PI 进程启动/关闭 | 进程生命周期管理正确 |
| Skill 完整调用链 | 用户请求 → 路由 → PI 执行 → 文件写入 → 通知用户 |
| PI 进程崩溃 | 自动重启、错误通知 |
| 并发请求 | 第二个请求被拒绝 + 提示 |

### 测试环境

- 使用 Vitest（`npm run test:run`）
- PI 进程测试需要 mock `child_process`
- 端到端测试需要实际安装 PI CLI

---

## 7. Boundaries

### Must Do（必须做）

- PI RPC 进程管理（启动、停止、重启、超时）
- Intent Router 增加 skill 意图分类
- PiSkillContext 构造与传递
- PI 结果通知（聊天回复路径 + 自动打开文件）
- 设置页 PI 安装/更新/状态检测管理
- 移除现有 skill 加载/执行代码（`src/agent/skills/`、`src/agent/tools/skill.ts`、`src/built-in-skills.ts`）
- 确保迁移后 skill 文件仍保留在 vault `DeepReader/skills/` 目录

### Ask First（需要先讨论）

- 现有 5 个内置 skill 的 SKILL.md 格式是否需要调整为 PI 的 skill 规范（Agent Skills standard）
- PI 安装失败时的详细降级策略（是否提供离线 skill 执行作为兜底）
- PI 的 API key 是否支持多 provider 切换（当前奚童配置了多个 provider）
- 是否需要在插件卸载时清理 PI session 文件

### Never Do（不做）

- 不修改 LangGraph 阅读认知引擎的核心图结构
- 不给 PI 开放 `bash` 工具
- 不实现 PI 结果的流式展示（PI 只写文件）
- 不实现多 PI 进程并发
- 不将 PI SDK 作为 npm 依赖打包进插件
- 不在 PI 执行期间屏蔽用户的阅读对话（两个通道独立）

---

## 8. Implementation Phases

### Phase 1: PI 基础设施

**目标**：PI 进程管理和 RPC 通信可用

1. 实现 `PiRpcClient` — JSONL 通信、事件解析
2. 实现 `PiProcessManager` — 懒启动、长驻、new_session、重启
3. 实现 `PiConfig` — 启动参数构建
4. 单元测试覆盖上述模块

**验证**：能启动 PI RPC 进程、发送 prompt、收到 agent_end 事件

### Phase 2: 路由集成

**目标**：奚童能识别 skill 意图并转交 PI

1. 修改 IntentRouter — 增加 skill 意图规则
2. 实现 `PiContext` — 上下文构造逻辑
3. 修改 `FrontendAgent` — 集成 PI 调用路径
4. 移除 `src/agent/skills/`、`src/agent/tools/skill.ts`、`src/built-in-skills.ts`
5. 清理相关 import 和引用

**验证**：用户说"画个思维导图"→ PI 执行 → 结果写入 vault → 通知用户

### Phase 3: 设置页集成

**目标**：用户可在设置页管理 PI

1. 实现 `pi-section.ts` — 安装/更新/状态检测
2. 修改 `setting-tab.ts` — 新增 PI 管理 Tab
3. 修改 `settings.ts` — 新增 PI 相关设置字段

**验证**：设置页可检测 PI 状态、触发安装/更新

### Phase 4: Skill 迁移与测试

**目标**：5 个内置 skill 在 PI 下正常工作

1. 确认 vault 中现有 skill 文件格式与 PI 兼容（Agent Skills standard）
2. 端到端测试每个 skill
3. 错误场景测试（PI 崩溃、超时、未安装）
4. 并发测试

**验证**：所有 skill 正常执行，降级和错误处理符合预期

---

## Appendix A: PI RPC 协议关键要素

### 命令（stdin → PI）

| 命令 | 格式 | 用途 |
|------|------|------|
| `prompt` | `{"type":"prompt","message":"..."}` | 发送用户请求 |
| `new_session` | `{"type":"new_session"}` | 重置上下文 |
| `abort` | `{"type":"abort"}` | 中止当前执行 |

### 事件（PI → stdout）

| 事件 | 含义 |
|------|------|
| `agent_start` | PI 开始处理 |
| `agent_end` | PI 完成（包含所有生成的消息） |
| `message_update` | 流式文本/thinking/toolcall 更新 |
| `tool_execution_start/end` | 工具执行状态 |

### 帧协议

- 严格 JSONL，`\n` 为唯一分隔符
- 不使用 Node `readline`（它误把 U+2028/U+2029 当换行符）
- 自行按 `\n` 分割，可选去除尾部 `\r`

## Appendix B: PI CLI 参考命令

```bash
# 版本检测
pi --version

# 安装（全局）
npm install -g @mariozechner/pi-coding-agent

# 更新
pi update --self

# RPC 模式启动
pi --mode rpc --no-session \
   --session-dir "<path>" \
   --no-skills \
   --skill "<path>" \
   --no-context-files \
   --tools read,write,edit,grep,find,ls \
   --api-key "<key>" \
   --model "<model>" \
   --append-system-prompt "<text>"
```
