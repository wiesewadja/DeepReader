# Spec: 奚童回复配图

## Objective

为 DeepReader 的 AI 伴读助手"奚童"的每条回复增加配图，营造"书信感"和文人伴读氛围。配图应与回复内容有一点相关性，但不必完全对应；核心目标是让高频对话更有温度、更具辨识度，而不是精确图解。

### 用户故事

- 作为读者，我希望奚童的每条回复都像一封来自书斋的信，顶部有契合当下情境的小插画。
- 作为读者，当我向奚童询问、总结或寻求安慰时，配图能微妙地呼应当前气氛（分析时沉静、安慰时温暖、总结时清明、日常时朴素）。
- 作为用户，我不希望配图占据过多屏幕空间或拖慢回复速度。

### 成功标准

1. 每条 AI 回复顶部默认带有一张 80px 高的横幅配图。
2. 长回复/主题切换时可在段落间插入 36px 高的段落小图。
3. 配图风格统一为 line art 中式书生风，人物形象参考 `src/assets/xitong.png`。
4. MVP 支持 4 个基础场景 + 8 个可叠加内容意象（motifs）。
5. 暗色模式下配图自动适配，不突兀。
6. 配图生成不阻塞主回复流，TTCF 与现在基本持平。
7. L1 单元测试覆盖 illustrator 选择逻辑与占位符解析；L3 轻量 E2E 验证真实消息气泡渲染。

## Tech Stack

- 语言：TypeScript
- 运行时：Obsidian 插件渲染进程（Electron）
- AI 引擎：LangGraph（现有 `src/agent/graph/`）
- UI：纯 TypeScript + DOM（无框架，沿用 `src/components/message/`）
- 矢量图：内联 SVG，CSS 变量控制亮/暗色
- 构建：沿用项目现有 esbuild / npm scripts

## Commands

```bash
# 单元测试
npm run test:run

# 轻量 E2E
npm run e2e-light

# 构建并部署到 test-vault
npm run deploy

# 格式化
npm run format

# 类型检查
npm run typecheck
```

## Project Structure

```
src/
  agent/
    graph/
      nodes/
        illustrator.ts          # 新增：生成 illustrationIntent
      state.ts                    # 新增：illustrationIntent 字段
      edges.ts                    # 修改：analytical → illustrator → formatter
      index.ts                    # 修改：注册 illustrator 节点
      nodes/
        formatter.ts              # 修改：读取 intent 并插入占位符
      utils/
        illustration-matcher.ts   # 新增：场景/元素规则映射
    prompts/
      auxiliary/
        illustration-quote.ts     # 新增：提炼金句的 prompt
  components/
    message/
      message.ts                  # 修改：解析 <illustration> 占位符并渲染 SVG
      message.css                 # 修改：配图样式与 CSS 变量
      illustration-library.ts     # 新增：SVG 模板库（4 场景 + 8 motifs）
  styles/
    main.css                      # 可能修改：全局暗色变量兜底
  assets/
    xitong.png                    # 已有人物参考图

docs/specs/
  xitong-illustration.md          # 本文件

test-output/
  xitong-banner-*.svg             # 设计稿示例（不入 git）
  xitong-scenes-prototype.html    # 视觉原型（不入 git）
```

## Code Style

节点与工具保持现有风格：显式类型、函数式默认导出、logger 统一用 `utils/logger.ts`。

```ts
// src/agent/graph/utils/illustration-matcher.ts
export interface IllustrationIntent {
  scene: SceneKey;
  motifs: MotifKey[];
  quote: string;
  type: 'hero' | 'inline';
}

export function pickSceneAndMotifs(content: string): Pick<IllustrationIntent, 'scene' | 'motifs'> {
  const lowered = content.toLowerCase();
  let scene: SceneKey = 'ink-grind';

  if (hasAny(lowered, ['因为', '意味着', '角度', '分析', '表达'])) scene = 'study-night';
  else if (hasAny(lowered, ['没关系', '慢慢来', '很正常', '不必'])) scene = 'plum-tea';
  else if (hasAny(lowered, ['总结', '梳理', '归纳', '三点', '层面'])) scene = 'scroll-summary';

  const motifs = extractMotifs(lowered);
  return { scene, motifs };
}
```

占位符统一使用 XML 自闭合标签，便于前端正则解析：

```xml
<illustration scene="study-night" motifs="moon,bamboo" quote="夜深秉烛，细解书中意" type="hero" />
```

SVG 模板内部颜色使用 CSS 变量，例如 `fill="var(--xitong-bg)"`、 `stroke="var(--xitong-ink)"`，由 `.theme-light` / `.theme-dark` 赋值。

## Performance Constraints

为保证 formatter 首字出现时间（TTCF）不受配图影响：

1. **illustrator 节点零 LLM 调用**：scene、motifs、quote 全部通过本地规则/字符串处理生成。
2. **quote 生成策略**：从 `analysisResult` 首句截取 ≤12 字；首句过短或不存在时使用场景默认金句。不单独调用 LLM 提炼。
3. **SVG 非动态生成**：前端从预制模板库直接取 SVG 字符串替换占位符，无网络请求、无 LLM、无复杂计算。
4. **执行顺序**：`analytical` → `illustrator`（同步微秒级）→ `formatter` 立即启动流式输出。

## Layout & Rendering Specification

### B. 图片与文字在消息气泡中的排版

```
┌─────────────────────────────────────┐
│  hero illustration (80px)           │  ← 主图，宽度 100%，贴顶
├─────────────────────────────────────┤
│  回复正文第一段……                    │
│                                     │
│  [inline illustration] 第二段主题    │  ← 小图 36px，左浮动
│                                     │
│  回复正文第三段……                    │
└─────────────────────────────────────┘
```

- **主图（type="hero"）**：
  - 高度固定 `80px`，宽度占满消息气泡内容区。
  - 位于整条回复的最顶部，与消息气泡上边缘对齐。
  - 下方无额外 margin，紧接正文第一段。
  - 渲染为块级元素 `div.xitong-illustration-hero`。

- **小图（type="inline"）**：
  - 固定 `36px × 36px` 徽章，出现在段落开头作为主题切换的视觉标记。
  - 左浮动，右侧留出 `10px`、下方留出 `4px` 与文字保持呼吸感。
  - 渲染为内联块元素 `.xitong-illustration-inline`。
  - 触发条件：回复正文自然分成的段落数 ≥ 3，且检测到情绪/主题转换信号（如"另一方面""不过""其次"等转折词）。

- **占位符渲染流程（preprocess + hydrate）**：
  1. `formatter` 输出 XML 自闭合占位符：`<illustration type="hero" scene="..." motifs="..." quote="..." />`。
  2. 前端在调用 `MarkdownRenderer.render` 之前，先通过 `preprocessIllustrationTags()` 把占位符替换为不会破坏 Markdown 语法的 `<div class="xitong-illustration-placeholder" data-type="..." data-scene="..." data-motifs="..." data-quote="..."></div>`。
  3. `MarkdownRenderer.render` 渲染正文 + 占位 div。
  4. 渲染完成后，通过 `hydrateIllustrationPlaceholders()` 读取占位 div 的 `data-*` 属性，调用 `renderIllustration()` 生成 SVG 并填充到占位 div 中。
  5. 这种方式避免了对整个消息容器做 `innerHTML` 全局替换，也避免 XML 标签在 Markdown 解析阶段被误处理。

### C. SVG 内部图文排版

所有横幅 SVG 统一使用 `viewBox="0 0 600 80"`，内部按三栏布局：

```
0      140              460       600
├───────┬────────────────┬──────────┤
│ 场景  │   标题 + 金句  │   印章   │
│ 小景  │                │          │
└───────┴────────────────┴──────────┘
```

- **左侧场景区（0–140px）**：
  - 绘制奚童人物 + 场景道具（书案、烛台、梅枝等）。
  - 人物高度控制在 50–60px，不超出横幅下边缘。
  - motifs 叠加在此区域：例如 `moon` 出现在右上方，`bamboo` 出现在右侧边缘，`plum` 从上方伸入。

- **中间文字区（140–460px）**：
  - 主标题 `"奚童来信"` 居中，y ≈ 34px，字号 19px，字间距 7px。
  - 金句居中，y ≈ 56px，字号 10px，字间距 1px，透明度 0.7。
  - 标题与金句总宽度不超过 280px，避免侵入两侧区域。

- **右侧印章区（460–600px）**：
  - 红色印章（28×28px）位于 `(505, 22)`。
  - 竖排小字落款位于 `x=548`，用于平衡左侧场景重量。

- **安全边距**：
  - 上下各留 8px 安全区，避免场景元素贴边。
  - 文字区左右各留 10px 安全区。

- **响应式兜底**：
  - 当消息气泡宽度 < 360px 时，隐藏金句小字，仅保留 `"奚童来信"` 标题和印章，保证主标题可读。
  - SVG 本身使用 `preserveAspectRatio="xMidYMid slice"`，在极窄宽度下自动裁剪两侧，中间文字保持可见。

## Testing Strategy

- **L1 单元测试**：`tests/unit/agent/illustration-matcher.test.ts`
  - 验证规则映射：输入含"因为"返回 `study-night`；输入含"总结"返回 `scroll-summary`。
  - 验证 motifs 提取："月下独酌"提取 `moon`；"江边"提取 `water`。
  - 验证占位符序列化与反序列化。

- **L1 组件测试**：`tests/unit/components/message/illustration-render.test.ts`
  - 验证 `<illustration>` 占位符被替换为 `<svg>`。
  - 验证未知 scene 回退到 `ink-grind`。
  - 验证暗色 class 下 SVG 使用暗色 CSS 变量。

- **L3 轻量 E2E**：`tests/e2e-light/agent-illustration.spec.ts`
  - 触发一条分析型查询，检查最终 DOM 中存在 `img` 或 `svg` 形式的配图。
  - 触发一条安慰型查询，检查配图场景为 `plum-tea`。

## Boundaries

- **Always:**
  - 所有代码改动必须有对应测试。
  - SVG 颜色必须使用 CSS 变量以支持暗色模式。
  - illustrator 节点同步返回 intent，不阻塞 formatter 流式输出。
  - 使用项目统一的 `agentLog` 记录关键路径。

- **Ask first:**
  - 新增 npm 依赖。
  - 修改 LangGraph 节点顺序或 state 结构之外的节点接口。
  - 改变占位符格式（如从 XML 改为 Markdown 注释）。
  - 将配图范围从"尽量每条"改为"部分触发"。

- **Never:**
  - 在 illustrator 中调用 LLM 动态生成完整 SVG（成本和延迟不可接受）。
  - 把 SVG 模板硬编码进 formatter prompt 中传输大量 token。
  - 修改现有 visualizer 的 Excalidraw 图表逻辑。
  - 在 MVP 中引入用户开关或配置面板。

## Success Criteria（可测试）

1. `npm run test:run` 新增测试全部通过，原有测试不失败。
2. 在 Obsidian test-vault 中发送任意查询，AI 回复顶部出现 80px 横幅配图。
3. 发送分析型问题（"为什么宝玉挨打？"），配图 scene 为 `study-night`。
4. 发送安慰型表达（"读到这里很难过"），配图 scene 为 `plum-tea`。
5. 在暗色主题下，配图背景变深、线条变浅，不刺眼。
6. 发送超过 3 个段落的长回复，段落间出现 36px 小图。
7. 配图生成不使 TTCF 增加超过 200ms（通过 E2E 日志或手动计时）。

## Open Questions

1. ~~是否需要为每个 motif 设计独立的小图 icon，还是只在主横幅中叠加 motifs？~~ **已决定：motifs 只在主横幅中叠加；inline 小图使用 36×36 场景徽章。**
2. ~~quote 是否允许 LLM 从回复正文首句截取，还是必须由独立 prompt 提炼？~~ **已决定：首句截取或默认金句，零 LLM 调用。**
3. ~~小图触发条件是否严格按"3 个段落"，还是由 formatter 根据内容结构决定？~~ **已决定：段落数 ≥ 3 且检测到转折词时触发，由 formatter 在注入占位符时判断。**