# Plan: 奚童回复配图实现

基于已批准的 `xitong-illustration.md` spec，本计划描述技术实现路径、顺序、风险和验证检查点。

## 1. 主要组件与依赖

```
┌─────────────────────────────────────────────────────────────────┐
│  LangGraph 层                                                    │
│  ┌─────────────┐   ┌─────────────────┐   ┌─────────────────┐   │
│  │ analytical  │──▶│  illustrator    │──▶│   formatter     │   │
│  └─────────────┘   └─────────────────┘   └─────────────────┘   │
│                    │ illustration-matcher │                    │
│                    │ quote-trimmer        │                    │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  前端层                                                          │
│  ┌─────────────────────┐   ┌─────────────────────────────────┐ │
│  │ illustration-library │──▶│     AIMessage.render()          │ │
│  │ (SVG 模板 + motifs)  │   │  解析占位符 + 替换 SVG + CSS 变量 │ │
│  └─────────────────────┘   └─────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### 1.1 后端组件

| 组件 | 文件 | 职责 |
|------|------|------|
| `illustration-matcher` | `src/agent/graph/utils/illustration-matcher.ts` | 根据 `analysisResult` 内容匹配 scene 和 motifs |
| `quote-trimmer` | `src/agent/graph/utils/quote-trimmer.ts` | 从文本首句截取 ≤12 字，失败返回默认金句 |
| `illustrator` 节点 | `src/agent/graph/nodes/illustrator.ts` | 调用 matcher + trimmer，生成 `illustrationIntent` |
| `state` 扩展 | `src/agent/graph/state.ts` | 新增 `illustrationIntent` 字段 |
| `edges` 调整 | `src/agent/graph/edges.ts` | analytical → illustrator → formatter 路由 |
| `graph` 注册 | `src/agent/graph/index.ts` | 注册 illustrator 节点 |
| `formatter` 修改 | `src/agent/graph/nodes/formatter.ts` | 读取 intent，在 `formattedOutput` 中插入占位符 |

### 1.2 前端组件

| 组件 | 文件 | 职责 |
|------|------|------|
| `illustration-library` | `src/components/message/illustration-library.ts` | 4 个基础 SVG 模板 + 8 个 motif 叠加函数 |
| `message` 修改 | `src/components/message/message.ts` | 解析 `<illustration>` 占位符，替换为渲染后的 SVG |
| `message.css` 修改 | `src/components/message/message.css` | `.xitong-illustration-hero`、`.xitong-illustration-inline`、CSS 变量 |

### 1.3 测试

| 测试 | 文件 | 职责 |
|------|------|------|
| matcher 单元测试 | `tests/unit/agent/illustration-matcher.test.ts` | 场景选择、motifs 提取 |
| trimmer 单元测试 | `tests/unit/agent/quote-trimmer.test.ts` | 金句截取与默认回退 |
| 渲染单元测试 | `tests/unit/components/message/illustration-render.test.ts` | 占位符解析、SVG 替换、暗色变量 |
| E2E | `tests/e2e-light/agent-illustration.spec.ts` | 真实消息气泡配图验证 |

## 2. 实现顺序

按依赖关系排序，前置任务完成后才能可靠地开始后续任务。

### Phase 2.1：前端独立能力（可并行）

1. **创建 `illustration-library.ts`**
   - 实现 4 个基础 SVG 模板（study-night / plum-tea / scroll-summary / ink-grind）。
   - 实现 8 个 motif 叠加函数（moon / rain / snow / plum / bamboo / mountain / water / falling-flower）。
   - 实现 `renderIllustration(intent)`：返回完整 SVG 字符串。
   - 使用 CSS 变量：背景、墨线、竹青、朱砂等。

2. **实现占位符解析函数**
   - 在 `message.ts` 中新增 `parseIllustrationPlaceholders(text)`。
   - 正则匹配 `<illustration scene="..." motifs="..." quote="..." type="..." />`。
   - 返回占位符数组 + 替换后的文本。

3. **修改 `message.ts` 渲染流程**
   - 在 Markdown 渲染前替换占位符为 `<svg>` 占位 div/span。
   - 或者：在 Markdown 渲染后，把占位 div/span 替换为真实 SVG。
   - 优先方案：渲染前替换，避免 Markdown 解析干扰。

4. **添加 `message.css`**
   - `.xitong-illustration-hero`：高 80px，宽度 100%，块级。
   - `.xitong-illustration-inline`：高 36px，inline-block/浮动。
   - CSS 变量定义：`.theme-light` 与 `.theme-dark` 两套值。

**验证检查点 2.1**：
- 在测试用例中调用 `renderIllustration` 能返回 4 个场景的 SVG 字符串。
- HTML 原型（可用 `test-output/` 下的页面）显示 hero 80px / inline 36px 效果正确。
- 切换 `.theme-dark` 后 SVG 颜色自动反转。

### Phase 2.2：后端意图生成

5. **创建 `illustration-matcher.ts`**
   - 定义 `SceneKey` / `MotifKey` 联合类型。
   - 实现 `pickScene(content)`：关键词规则映射。
   - 实现 `extractMotifs(content)`：字典匹配提取 motifs。

6. **创建 `quote-trimmer.ts`**
   - 实现 `trimQuote(text, maxLength=12)`：取第一句，截断到 ≤12 字。
   - 实现默认金句映射表。

7. **创建 `illustrator.ts` 节点**
   - 输入 `state.analysisResult`。
   - 输出 `{ illustrationIntent: { scene, motifs, quote, type: 'hero' } }`。
   - 小图 type 暂不在 illustrator 中决定，由 formatter 根据段落结构判断。

**验证检查点 2.2**：
- 单元测试覆盖 4 种 scene 选择和 8 种 motif 提取。
- quote trimmer 测试覆盖长句、短句、空文本。

### Phase 2.3：接入 LangGraph 流

8. **扩展 `state.ts`**
   - 新增 `illustrationIntent: Annotation<IllustrationIntent | null>()`。

9. **修改 `formatter.ts`**
   - 读取 `state.illustrationIntent`。
   - 在 `formattedOutput` 开头插入 hero 占位符。
   - 根据段落数/主题切换信号插入 inline 占位符。

10. **修改 `edges.ts` 与 `index.ts`**
    - analytical 完成后无条件进入 illustrator（MVP 每条回复都配图）。
    - illustrator 完成后进入 formatter。

**验证检查点 2.3**：
- `npm run test:run` 新增测试通过。
- 通过 mock state 验证 formatter 输出包含正确占位符。

### Phase 2.4：集成与 E2E

11. **E2E 验证**
    - 在 test-vault 中触发分析型查询，检查 DOM 中存在 hero SVG。
    - 触发安慰型查询，检查 scene 为 plum-tea。
    - 触发长回复，检查 inline 小图出现。
    - 切换暗色主题，检查 SVG 颜色适配。

12. **性能验证**
    - 对比启用前后 TTCF，确保无明显增加（目标 < 200ms）。
    - 检查 illustrator 节点执行时间日志。

## 3. 风险与缓解

| 风险 | 影响 | 缓解策略 |
|------|------|----------|
| MarkdownRenderer 把占位符当文本解析 | 占位符泄露给用户 | 占位符使用 XML 自闭合标签；替换发生在 Markdown 渲染前；对占位符做 HTML 转义保护 |
| CSS 变量与 Obsidian 主题冲突 | 暗色模式颜色异常 | 使用自定义 `--xitong-*` 前缀变量，不依赖 Obsidian 内置变量；在 light/dark 下显式赋值 |
| SVG 在窄侧边栏被过度裁剪 | 文字不可读 | SVG 用 `preserveAspectRatio="xMidYMid slice"`；媒体查询在 <360px 时隐藏金句 |
| illustrator 节点影响现有路由 | 回复异常或失败 | illustrator 节点纯计算，失败时返回 null，formatter 回退到无配图输出；保留现有错误处理 |
| quote 截取不合适 | 金句奇怪或过长 | 严格 ≤12 字截断；按标点优先截断；空文本回退默认金句 |
| 高频消息中 80px 图造成视觉疲劳 | 用户体验下降 | MVP 阶段已确定不加开关，先观察 E2E 和用户反馈；二期可考虑根据消息密度动态调整 |

## 4. 并行与串行

- **可并行**：
  - Phase 2.1 的前端 4 个任务可以并行。
  - Phase 2.2 的 matcher 与 trimmer 可并行开发。
- **必须串行**：
  - Phase 2.1 完成后才能做 Phase 2.3（formatter 需要真实 SVG 渲染验证）。
  - Phase 2.2 完成后才能做 Phase 2.3（formatter 需要 intent 结构）。
  - Phase 2.3 完成后才能做 Phase 2.4。

## 5. 验证检查点总结

| 检查点 | 验证方式 | 通过标准 |
|--------|----------|----------|
| CP1 前端模板 | 单元测试 + HTML 原型 | 4 场景 + 8 motifs 能渲染，暗色变量生效 |
| CP2 matcher/trimmer | 单元测试 | 规则映射正确，金句截取符合约束 |
| CP3 formatter 占位符 | 单元测试 | 输出包含格式正确的 `<illustration>` |
| CP4 LangGraph 路由 | L3 E2E | 真实查询返回的 DOM 中包含配图 |
| CP5 场景正确性 | L3 E2E | 分析型 → study-night；安慰型 → plum-tea |
| CP6 暗色适配 | 手动/E2E | 暗色主题下图标不刺眼 |
| CP7 性能 | 日志/E2E | TTCF 增加 < 200ms |

## 6. 下一步

进入 Phase 3: Tasks，将以上计划拆分为具体可实现的 task 列表。