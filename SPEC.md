# SPEC: 用户画像构建优化 — 微信读书维度 + 多维度格式 + 并行化

> 版本: 2026.05.20
> 分支: `simplify-settings`

---

## 1. 目标

优化 DeepReader 用户画像构建系统，实现三项改进：

1. **新增微信读书数据源** — 从阅读记录中提取「阅读画像」维度事实
2. **多维度结构化输出** — 画像和摘要按维度严格分段，空维度保留标题
3. **构建并行化** — embedding / chat / 微信读书三路并行，首次构建从 ~55s 降至 ~20s

### 目标用户

DeepReader 插件的用户（Obsidian 深度阅读者），已配置微信读书同步的个人用户。

### 验收标准

- [ ] 画像维度从 7 个增至 8 个（新增 `reading` 阅读画像）
- [ ] 配置微信读书且已同步时，画像包含基于划线/想法/书评的阅读画像维度事实
- [ ] 未配置微信读书时，进度条提示「跳过微信读书（未配置）」，阅读画像维度输出「暂无足够信息」
- [ ] `USER_PROFILE.md` 严格按 8 个维度标题分段输出
- [ ] `.profile-summary.txt` 同样按维度分段
- [ ] 首次构建耗时降至 ~20s（原 ~55s）
- [ ] 增量构建不受影响（只处理变更文件）
- [ ] 现有单元测试全部通过
- [ ] `npm run build` 类型检查通过

---

## 2. 修改范围

### 2.1 文件清单

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `src/services/profile-facts.ts` | 修改 | 新增 `reading` 维度到 `DEFAULT_DIMENSIONS` |
| `src/services/profile-builder.ts` | 重构 | 核心改动：微信读书数据源 + 并行化 + prompt 重写 |
| `src/settings/sections/profile-section.ts` | 修改 | 进度条阶段文案更新 + 内置维度描述从 7→8 |

### 2.2 不修改的文件

- `src/weread/` — 只读取已有数据（sync-state.json + Markdown 笔记），不改微信读书代码
- `src/services/__tests__/profile-facts.test.ts` — 需要更新维度计数断言

---

## 3. 详细设计

### 3.1 新增维度：`reading`（阅读画像）

**文件**: `src/services/profile-facts.ts`

```typescript
// 在 DEFAULT_DIMENSIONS 数组末尾新增
{ key: 'reading', label: '阅读画像' }
```

**维度含义**: 从微信读书数据中提取的阅读行为事实。

### 3.2 微信读书数据源集成

**文件**: `src/services/profile-builder.ts`

#### 3.2.1 新增 `extractWereadFacts()` 方法

**数据来源（两个）**:
1. **`sync-state.json` 元数据** — 书名、作者、笔记数、阅读进度、阅读时长（统计类事实）
2. **`书籍摘录/{title}/{title}.md`** — 已渲染的划线+想法+书评 Markdown（深度事实）

**流程**:
```
1. 检查 settings.wereadApiKey 是否配置
2. 读取 .pageindex/weread/sync-state.json → WereadSyncState
3. 如果 syncedBooks 为空 → 返回空 facts
4. 从 syncState 提取统计类事实（书单、阅读量、完读率、领域分布）
5. 并发读取每本书的 Markdown 笔记文件（书籍摘录/{title}/{title}.md）
6. 按 ~12000 字符分批，用 LLM 按阅读画像维度抽取深度事实
7. 合并统计事实 + LLM 抽取事实 → Record<string, string[]>
```

**LLM 抽取 prompt**:
```
你是一个善于观察的人。现在你读到了一个用户在微信读书上的阅读记录，
包括他读过的书、划线内容、写的想法和书评。

请从中提取关于用户的阅读画像。具体关注：
- 他读什么类型的书（领域、主题偏好）
- 他反复关注的话题（通过划线内容推断）
- 他对书中内容的思考深度（通过想法/书评推断）
- 他的阅读习惯（速度、完读率、笔记频率）
- 值得注意的具体阅读体验（引用原话）

输出格式：
[阅读画像] 事实1；事实2；...

注意：
- 只提取明确可见的，不推测
- 保留划线原文（用引号标注）
- 标注书籍来源（如「在《书名》中划线：...」）
```

**统计事实提取**（纯逻辑，不调 LLM）:
```typescript
// 从 syncState.syncedBooks 中提取
const books = Object.values(syncedBooks);
const totalBooks = books.length;
const finishedBooks = books.filter(b => b.progress >= 100).length;
const totalNotes = books.reduce((s, b) => s + b.noteCount + b.reviewCount, 0);
const readingTimes = books.filter(b => b.readingTime).map(b => b.readingTime);

facts.reading.push(
    `共阅读 ${totalBooks} 本书`,
    `读完 ${finishedBooks} 本，完读率 ${Math.round(finishedBooks/totalBooks*100)}%`,
    `累计做笔记/划线 ${totalNotes} 条`,
    // ...更多统计
);
```

#### 3.2.2 降级策略

- `wereadApiKey` 未配置 → 进度条 emit `{ stage: 'extracting', message: '跳过微信读书（未配置 API Key）' }`，返回空 facts
- sync-state.json 不存在 → emit `{ stage: 'extracting', message: '跳过微信读书（尚未同步）' }`，返回空 facts
- syncedBooks 为空 → 同上
- 单本书 Markdown 文件读取失败 → 跳过该书，不中断流程

### 3.3 多维度结构化输出

**文件**: `src/services/profile-builder.ts`

#### 3.3.1 修改 `SYNTHESIZE_SYSTEM_PROMPT`

从连续散文改为严格维度分段：

```
你是一个认识了用户很多年的老朋友。你从他的笔记和阅读记录中提取了关于他方方面面的事实。

请基于这些事实，按以下结构描绘他。每个维度独立成段。

输出格式（严格遵循每个维度标题）：

## 身份与阶段
## 家庭与关系
## 工作与事业
## 兴趣与投入
## 性格与思维
## 情绪与状态
## 价值观与信念
## 阅读画像

规则：
- 用「你」称呼他
- 保留具体细节——他说过的原话、比喻、顿悟
- 时间线上有明显变化的要写出来
- 如果某个维度没有事实，写「暂无足够信息」
- 不编造他没有说过的话
- 每个维度的标题必须是「## 维度名」格式，不要修改标题文字
```

#### 3.3.2 修改 `SUMMARY_SYSTEM_PROMPT`

摘要同样按维度分段：

```
你是一个认识了用户很多年的老朋友，现在要给另一个朋友简要介绍他。

请按以下结构输出，每个维度 2-3 句话：

## 身份与阶段
## 家庭与关系
## 工作与事业
## 兴趣与投入
## 性格与思维
## 情绪与状态
## 价值观与信念
## 阅读画像

要求：
- 每个维度抓住最能定义他的那条线
- 用"他"来称呼
- 如果某个维度信息不足，写「信息不足」
- 总共 500-800 字
```

### 3.4 构建并行化

**文件**: `src/services/profile-builder.ts`

#### 3.4.1 新增 `prepareFileContents()` — 合并文件读取

将 `buildIndex()` 和 `extractFacts()` 中重复的文件读取合并为一次遍历：

```typescript
interface PreparedContents {
    nodes: Array<{ id: string; text: string; level: 'L1' }>;
    contents: string[];  // 带 "--- {filename} ---" 前缀的文件内容
}

private async prepareFileContents(
    files: TFile[],
    onProgress?: (p: BuildProgress) => void,
    signal?: AbortSignal,
): Promise<PreparedContents> {
    const nodes: PreparedContents['nodes'] = [];
    const contents: string[] = [];
    const BATCH = 50;

    for (let i = 0; i < files.length; i += BATCH) {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
        const slice = files.slice(i, i + BATCH);
        const results = await Promise.all(
            slice.map(async f => {
                let c = await this.vault.cachedRead(f);
                c = c.replace(/^---[\s\S]*?---\n*/, '').trim();
                return { file: f, content: c };
            }),
        );
        for (const { file, content } of results) {
            if (!content) continue;
            nodes.push({ id: generateBookIdFromPath(file.path), text: content, level: 'L1' });
            contents.push(`--- ${file.name} ---\n${content}`);
        }
        onProgress?.({ stage: 'scanning', current: Math.min(i + BATCH, files.length), total: files.length, message: `读取笔记中... (${Math.min(i + BATCH, files.length)}/${files.length})` });
    }
    return { nodes, contents };
}
```

#### 3.4.2 `buildIndex` 改为接收预读数据 + embedding 并行化

```typescript
// 改名: buildIndex → buildIndexFromNodes，接收 nodes[] 而非 files[]
async buildIndexFromNodes(
    nodes: Array<{ id: string; text: string; level: 'L1' }>,
    onProgress?: (p: BuildProgress) => void,
    signal?: AbortSignal,
): Promise<void> {
    // BM25 构建（同原逻辑）
    // Embedding 并行化: EMB_CONCURRENCY=3
    const BATCH = 16;
    const EMB_CONCURRENCY = 3;
    for (let i = 0; i < nodes.length; i += BATCH * EMB_CONCURRENCY) {
        const chunks: Array<typeof nodes> = [];
        for (let j = 0; j < EMB_CONCURRENCY && i + j * BATCH < nodes.length; j++) {
            chunks.push(nodes.slice(i + j * BATCH, i + (j + 1) * BATCH));
        }
        await Promise.all(chunks.map(batch => this.embedBatch(batch, embOpts, signal)));
    }
}
```

#### 3.4.3 `extractFacts` 改为接收预读数据

```typescript
// 改名: extractFacts → extractFactsFromContents，接收 contents[] 而非 files[]
async extractFactsFromContents(
    contents: string[],
    onProgress?: (p: BuildProgress) => void,
    signal?: AbortSignal,
): Promise<Record<string, string[]>> {
    // 跳过文件读取，直接用 contents 分批调 LLM（同原逻辑）
}
```

#### 3.4.4 主流程 `build()` 重构

```typescript
async build(onProgress?: (p: BuildProgress) => void, force = false): Promise<void> {
    // ... 前置检查（同原逻辑）...

    // 1. 一次性读取所有文件
    const { nodes, contents } = await this.prepareFileContents(filesToExtract, emit, signal);

    // 2. 三路并行
    const [factsResult, wereadFactsResult] = await Promise.all([
        // 路径A: buildIndex (embedding) + extractFacts (chat) 并行
        Promise.all([
            this.buildIndexFromNodes(allNodes, emit, signal),
            this.extractFactsFromContents(contents, emit, signal),
        ]).then(([_, facts]) => facts),

        // 路径B: 微信读书（可选）
        this.extractWereadFacts(emit, signal),
    ]);

    // 3. 合并事实
    const mergedFacts = mergeFacts(
        mergeFacts(factsResult, wereadFactsResult),
        existingFacts?.dimensions || {},
    );

    // 4. 画像 + 摘要（一次 LLM 调用，用分隔符拆分）
    emit({ stage: 'synthesizing', ... });
    const combined = await this.synthesizeAndSummarize(mergedFacts, signal);
    const [profileText, summaryText] = combined.split('---SUMMARY---').map(s => s.trim());

    // 5. 写入文件（同原逻辑）
}
```

#### 3.4.5 合并 `synthesizeProfile` + `generateSummary`

一次 LLM 调用，prompt 尾部追加：

```
先输出完整的维度画像，然后输出一行「---SUMMARY---」，
再输出精炼的维度摘要（每个维度 2-3 句话，用"他"称呼，500-800 字）。
```

### 3.5 进度条更新

**文件**: `src/settings/sections/profile-section.ts`

`stageLabels` 新增微信读书阶段：

```typescript
const stageLabels: Record<string, string> = {
    scanning: '扫描笔记文件',
    indexing: '建立索引',
    weread: '抽取微信读书阅读画像',    // 新增
    extracting: '抽取维度事实',
    synthesizing: '生成画像',
    summarizing: '生成摘要',
    done: '构建完成',
};
```

`BuildProgress.stage` 类型新增 `'weread'`。

内置维度描述更新：`'内置 7 个维度'` → `'内置 8 个维度'`。

---

## 4. 测试策略

### 4.1 现有测试适配

| 文件 | 改动 |
|------|------|
| `src/services/__tests__/profile-facts.test.ts` | `DEFAULT_DIMENSIONS` 长度断言从 7→8；新增 `reading` key 测试 |

### 4.2 手动验证清单

1. `npm run build` 类型检查通过
2. `npm run test:run` 单元测试通过
3. **无微信读书**:
   - 不配置 API Key → 构建成功，阅读画像维度输出「暂无足够信息」
   - 进度条显示「跳过微信读书（未配置）」
4. **有微信读书**:
   - 已同步书籍 → 阅读画像维度有具体事实
   - 画像和摘要均为多维度结构化格式
5. **增量构建**:
   - 第二次 build 只处理变更文件
   - 已有 facts 正确合并
6. **性能**: 首次构建时间 < 25s

---

## 5. 代码风格

- 遵循项目现有风格：中文注释、英文标识符
- 日志使用 `utils/logger.ts` 的 `serviceLog`
- 文件路径通过 `this.vault.adapter` API
- 不引入新依赖

---

## 6. 边界

### 始终做

- 微信读书读取失败时静默降级，不中断构建
- 保留增量构建逻辑（meta 比对 mtime）
- 空维度标题必须输出（严格格式）

### 先问

- 是否需要修改 Agent 运行时消费画像的方式（S2/S4 prompt 中的 `<user_profile>` 注入）
- 是否需要修改 `accumulateConversationRound` 增量更新的逻辑

### 永不做

- 不修改 `src/weread/` 目录下的任何代码
- 不修改微信读书同步流程
- 不修改 Agent 的 `update_profile` 工具
