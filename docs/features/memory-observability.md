# 记忆与可观测（F-32, F-34, F-35）

> 一个月后的奚童应该比第一天更懂你。
> Agent 行为是黑盒。AI 的贪婪倾向：不停搜索直到 token 用完。

---

## F-32: 用户画像 + 长期记忆

- **为什么存在**: 信念四的核心实现。画像让奚童"认识"用户，记忆让对话有延续性。一个月后的奚童应该比第一天更懂你——知道你关心什么、你的思维方式、你的价值观倾向。这不是推荐系统的数据源，而是让 AI 成为真正的"伙伴"的基础。
- **用户故事**: 作为用户，我希望 AI 记住我的阅读偏好和重要洞察（跨对话）
- **前置条件**: 已配置 LLM API Key；至少 5 轮对话
- **输入**: 对话历史 + 主动确认
- **输出**: 用户画像（`profile-facts.json`）+ 长期记忆条目
- **验收标准**:
  - [ ] 提取用户偏好（喜欢/不喜欢/关心的话题）
  - [ ] 长期记忆按主题组织
  - [ ] 记忆在 System Prompt 中注入
  - [ ] 用户可查看/编辑/删除记忆
  - [ ] 关闭后记忆持久化
  - [ ] 嵌入画像支持语义搜索
- **对应测试**:
  - 单元: `tests/unit/services/{profile-facts,voice-profile}.test.ts`、`tests/unit/services/profile-builder-embedding.e2e.test.ts`
  - 覆盖状态: ✅ 强
- **详见**: product-manual §8.2

---

## F-34: LangSmith 追踪

- **为什么存在**: Agent 行为是黑盒。没有 trace 就无法诊断"为什么 AI 给了这个回答"。开发者工具，普通用户不感知。是持续改进 AI 质量的基础设施。
- **用户故事**: 作为开发者/调试者，我希望把 Agent 执行 trace 上传到 LangSmith 用于分析
- **前置条件**: 已配置 LangSmith API Key（设置中）
- **输入**: 触发 Agent 对话
- **输出**: LangSmith 项目中可查看完整 trace
- **验收标准**:
  - [ ] 包含所有 LangGraph 节点
  - [ ] 包含 LLM 调用的 prompt/response
  - [ ] 包含工具调用的 args/result
  - [ ] 包含错误堆栈（如有）
  - [ ] 关闭后不上传（隐私开关）
  - [ ] 项目名可配置
- **对应测试**: 无（langsmith-tracer skill 用于手动调试）
- **覆盖状态**: ❌ 无
- **详见**: product-manual §8.3

---

## F-35: 提早停止（Early Stop）

- **为什么存在**: AI 的贪婪倾向——不停搜索直到 token 用完。提早停止防止浪费用户的钱和时间，在信息充分时果断停下来。这也是"尊重用户"的体现。
- **用户故事**: 作为用户，我希望 AI 在没有新信息时停止搜索（不浪费 token/时间）
- **前置条件**: 分析阅读（depth=2）执行中
- **输入**: 连续 N 轮工具调用结果重复/无新意
- **输出**: ReAct 循环提前终止，进入 Formatter
- **验收标准**:
  - [ ] 检测到重复搜索关键词时停止
  - [ ] 检测到结果无新信息时停止
  - [ ] 最大轮数限制（防失控）
  - [ ] 停止原因可在 trace 中查看
  - [ ] 响应时间 < 配置上限
  - [ ] 不影响其他对话流
- **对应测试**:
  - 单元: `tests/unit/agent/graph/{react-loop,stream-processor}.test.ts`、`agent/tools/langchain-tools.test.ts`
  - E2E: `tests/e2e/specs/{early-stop,summary-description,scope-nodefilemap,l2-vectorization}.e2e.ts`
  - 覆盖状态: ✅ 强
- **详见**: product-manual §2.3.1
