# DeepReader 项目分析地图

**创建时间**: 2026-07-03
**项目状态**: 活跃开发中，已完成 sidebar 重构和安全修复

## 已完成的核心工作

### sidebar-architecture: Sidebar 架构重构 ✅
**Status**: resolved
**完成时间**: 2026-07-02

**答案**: 完成 SidebarView 到 Domain/Presenter 模式的重构，提取出 BookDomain、SessionDomain、AgentDomain、TTSDomain、ChatPresenter、EventBus 等组件。

**关键决策**:
- ADR-0001: SharedContext 收敛（消除双轨制）
- ADR-0002: 安全边界机制（三层防御）

### security-hardening: 安全加固 ✅
**Status**: resolved
**完成时间**: 2026-07-03

**答案**: 修复奚童泄露系统提示词漏洞，实现三层防御机制（inspectional → advisor → formatter）。

**验证**: 安全性测试评分 100/100

### chat-input-refactor: ChatInput 重构 ✅
**Status**: resolved
**完成时间**: 2026-07-03

**答案**: 将 ChatInput 从两行布局（textarea + toolbar）改为单行 flex 布局，简化 UI 结构。

**验证**: 所有 39 个测试通过

---

## 当前前沿（Frontier）

### mobile-stability: 移动端稳定性
**Blocked by**: 无
**Status**: open
**Type**: Research

**问题**: DeepReader 在移动端（iOS/Android）的稳定性如何？是否有已知问题？

**下一步**: 
- 检查移动端兼容性问题
- 验证 Capacitor 集成
- 测试触摸交互

### performance-baseline: 性能基准 ✅
**Blocked by**: 无
**Status**: resolved
**Type**: Research

**答案**: 已建立性能基线，识别出关键瓶颈。

**基线数据**:
- 插件加载: 209.89ms (avg)
- LLM 响应: 202.73ms (avg)
- 搜索性能: 201.19ms (avg)
- 内存使用: 358.80MB RSS

**瓶颈分析**:
- LLM 调用（~200ms）：网络延迟 + 模型推理
- 插件加载（~210ms）：模块初始化、索引加载
- 内存占用（358MB）：Obsidian 框架 + 插件 + 索引

**产出**: [性能基线文档](./performance-baseline.md), [基准测试脚本](../tests/performance/benchmark.mjs)

### testing-coverage: 测试覆盖率
**Blocked by**: 无
**Status**: open
**Type**: Research

**问题**: 当前测试覆盖率如何？哪些模块需要补充测试？

**下一步**:
- 分析测试覆盖率报告
- 识别覆盖空白
- 制定测试策略

### ai-quality: AI 回复质量 ✅
**Blocked by**: 无
**Status**: resolved
**Type**: Grilling

**答案**: 已建立质量基线，识别出关键问题。

**基线数据**:
- 平均评分: 80.9/100
- 超时率: 10%（目标 <5%）
- 关键词命中率: 75%（目标 ≥80%）
- 安全性评分: 100/100

**关键问题**:
- 超时问题：深度阅读任务触发多次 LLM 调用
- 评分不一致：关键词匹配不完整

**产出**: [AI 质量基线文档](./ai-quality-baseline.md)

### documentation: 文档完善
**Blocked by**: 无
**Status**: open
**Type**: Task

**问题**: 项目文档是否完整？需要补充哪些？

**下一步**:
- 审查现有文档
- 识别文档空白
- 补充关键文档

---

## 模糊区域（Fog of War）

### cross-platform-sync: 跨平台同步
**状态**: 迷雾中

**可能的方向**:
- 微信读书同步增强
- 多设备状态同步
- 云存储集成

### advanced-ai-features: 高级 AI 功能
**状态**: 迷雾中

**可能的方向**:
- 多轮对话优化
- 个性化推荐
- 知识图谱构建

### collaborative-reading: 协作阅读
**状态**: 迷雾中

**可能的方向**:
- 书评分享
- 阅读小组
- 注释协作

---

## 下一步行动

**当前可解决的 tickets**:
1. mobile-stability
2. performance-baseline
3. testing-coverage
4. ai-quality
5. documentation

**建议优先级**:
1. **testing-coverage** - 基础工作，为其他优化提供保障
2. **performance-baseline** - 建立基准，指导优化方向
3. **ai-quality** - 核心功能质量提升
4. **mobile-stability** - 扩展用户群体
5. **documentation** - 长期维护

---

## Notes

- **领域**: DeepReader Obsidian 插件（AI 伴读 + PDF/EPUB 索引 + 微信读书同步）
- **关键技能**: deepreader-test-framework, langsmith-tracer, obsidian-quick-test
- **测试策略**: 四层测试架构（L1 单元 / L2 冒烟 / L3 轻量 E2E / L4 WebdriverIO）
- **部署**: test-vault 开发环境 + 日常使用环境
