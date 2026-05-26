# SPEC: PageIndex 存储路径迁移

> 版本: 2026.05.25
> 分支: `refactor/pageindex-path`

---

## 1. 目标

将书籍索引数据从 vault 根目录 `.pageindex/` 迁移到插件私有目录 `.obsidian/plugins/deepreader/pageindex/`，统一插件数据管理，减少 vault 污染和移动端同步开销。

### 验收标准

- [ ] 新安装的插件，所有索引数据写入 `.obsidian/plugins/deepreader/pageindex/`
- [ ] 升级的插件自动将旧 `.pageindex/` 迁移到新路径，迁移后旧目录被删除
- [ ] vault 根目录不再出现 `.pageindex/` 目录
- [ ] Obsidian 文件浏览器中不再显示索引数据
- [ ] 所有现有功能（索引、搜索、对话、微信读书同步）正常工作
- [ ] `npm run build` 和 `npm run test:run` 通过

### 动机

1. `.pageindex/` 包含大量机器生成的数据（向量、BM25 索引），用户无需看到
2. Obsidian 文件浏览器和搜索会暴露这些文件
3. 向量数据量大（每本书几 MB~几十 MB），同步到移动端成本高
4. 不符合 Obsidian 插件惯例——插件数据应归 `.obsidian/plugins/{plugin}/`

---

## 2. 修改范围

### 2.1 核心改动：集中路径常量

**新建 `src/pageindex/paths.ts`**：

```typescript
// 新路径（插件私有目录）
export const PAGEINDEX_DIR = '.obsidian/plugins/deepreader/pageindex';

// 旧路径（用于迁移检测）
export const LEGACY_PAGEINDEX_DIR = '.pageindex';

// 辅助：bookId 的绝对路径（fs 操作）
export function getBookDir(vaultPath: string, bookId: string): string;

// 辅助：bookId 的 vault 相对路径（adapter 操作）
export function getBookPath(bookId: string): string;

// 辅助：pageindex 根目录的绝对路径（fs 操作）
export function getPageindexRoot(vaultPath: string): string;
```

### 2.2 生产代码改动（~25 个文件）

#### A. `fs` 直接访问（~15 个文件）

将 `path.join(vaultPath, ".pageindex", ...)` 替换为 `getPageindexRoot(vaultPath)` + `getBookDir(vaultPath, bookId)` 等。

| 文件 | 引用数 |
|------|--------|
| `src/pageindex/book-indexer.ts` | 7 处 |
| `src/pageindex/book-search-v2.ts` | 1 处 |
| `src/pageindex/proposition-indexer.ts` | 1 处 |
| `src/pageindex/proposition-search.ts` | 2 处 |
| `src/pageindex/reading-progress.ts` | 1 处 |
| `src/pageindex/vault/index.ts` | 3 处 |
| `src/pageindex/vault/compiler.ts` | 1 处 |
| `src/pageindex/vault/search.ts` | 1 处 |
| `src/pageindex/vault/search-v2.ts` | 1 处 |
| `src/agent/utils/syntopical-search.ts` | 3 处 |
| `src/views/sidebar/book-manager.ts` | 5 处 |
| `src/views/library-view.ts` (fs 部分) | 1 处 |
| `src/weread/utils/indexed-books.ts` | 1 处 |
| `src/services/tts/book-genre-detector.ts` | 1 处 |

#### B. `app.vault.adapter` 访问（~7 个文件）

将 `.pageindex/${bookId}/...` 替换为使用 `PAGEINDEX_DIR` 或 `getBookPath()`。

| 文件 | 引用数 |
|------|--------|
| `src/agent/tools/local/utils.ts` | 1 处 |
| `src/agent/graph/utils/tree-loader.ts` | 1 处 |
| `src/agent/graph/nodes/analytical-pre-search.ts` | 1 处 |
| `src/agent/proactive/state.ts` | 1 处 |
| `src/views/library-view.ts` (adapter 部分) | 4 处 |
| `src/weread/sync/highlight-importer.ts` | 1 处 |
| `src/services/profile-builder.ts` | 2 处 |

#### C. 排除/过滤模式（3 个文件）

| 文件 | 说明 |
|------|------|
| `src/pageindex/vault/scan.ts` | glob 排除模式 |
| `src/pageindex/vault/compiler-scan.ts` | 目录名比较 |
| `src/pageindex/vault/compiler-reorg.ts` | 目录名比较 |

#### D. 特殊子路径（4 个文件）

| 文件 | 说明 |
|------|------|
| `src/weread/sync/state.ts` | `WEREAD_DIR` 常量 |
| `src/services/profile-builder.ts` | journal 路径 |
| `src/services/journal-search.ts` | journal 路径 |
| `src/pageindex/vault/scan.ts` | catalog + vectors 路径 |

### 2.3 数据迁移

**新建 `src/pageindex/migration.ts`**，在插件 `onload` 时调用：

1. 检测旧路径 `LEGACY_PAGEINDEX_DIR` 是否存在
2. 检测迁移标记 `.obsidian/plugins/deepreader/.migrated-pageindex-v2`
3. 如果旧路径存在且未迁移：
   - 将 `.pageindex/` 整个目录移动到新路径
   - 写入迁移标记
   - 删除旧目录
4. 迁移标记确保幂等性

### 2.4 测试和脚本

- `src/pageindex/__tests__/` 中的单元测试
- `tests/specs/` 中的 e2e 测试
- `scripts/` 中的构建脚本

---

## 3. 详细设计

### 3.1 `src/pageindex/paths.ts`

```typescript
import { join } from 'node:path';

export const PAGEINDEX_DIR = '.obsidian/plugins/deepreader/pageindex';
export const LEGACY_PAGEINDEX_DIR = '.pageindex';
export const MIGRATION_MARKER = '.obsidian/plugins/deepreader/.migrated-pageindex-v2';

export function getPageindexRoot(vaultPath: string): string {
    return join(vaultPath, PAGEINDEX_DIR);
}

export function getBookDir(vaultPath: string, bookId: string): string {
    return join(vaultPath, PAGEINDEX_DIR, bookId);
}

export function getBookPath(bookId: string): string {
    return `${PAGEINDEX_DIR}/${bookId}`;
}

export function getCatalogPath(vaultPath: string): string {
    return join(vaultPath, PAGEINDEX_DIR, 'catalog.json');
}

export function getWereadPath(filename: string): string {
    return `${PAGEINDEX_DIR}/weread/${filename}`;
}

export function getJournalPath(hash: string): string {
    return `${PAGEINDEX_DIR}/journal_${hash}`;
}
```

### 3.2 `src/pageindex/migration.ts`

```typescript
import { rename, access, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LEGACY_PAGEINDEX_DIR, PAGEINDEX_DIR, MIGRATION_MARKER } from './paths';

export async function migratePageindexPath(vaultPath: string): Promise<void> {
    const markerPath = join(vaultPath, MIGRATION_MARKER);
    const legacyPath = join(vaultPath, LEGACY_PAGEINDEX_DIR);
    const newPath = join(vaultPath, PAGEINDEX_DIR);

    // 已迁移则跳过
    try { await access(markerPath); return; } catch {}

    // 旧路径不存在则跳过（新安装）
    try { await access(legacyPath); } catch { return; }

    // 确保新父目录存在
    await mkdir(newPath, { recursive: true });

    // 移动旧数据到新路径
    await rename(legacyPath, newPath);

    // 写入迁移标记
    await writeFile(markerPath, new Date().toISOString());
}
```

### 3.3 更新模式示例

**fs 模式（之前）**：
```typescript
const indexDir = path.join(vaultPath, ".pageindex", bookId);
```
**fs 模式（之后）**：
```typescript
import { getBookDir } from '../pageindex/paths';
const indexDir = getBookDir(vaultPath, bookId);
```

**adapter 模式（之前）**：
```typescript
const treePath = `.pageindex/${bookId}/tree.json`;
```
**adapter 模式（之后）**：
```typescript
import { getBookPath } from '../../pageindex/paths';
const treePath = `${getBookPath(bookId)}/tree.json`;
```

**排除模式（之前）**：
```typescript
entry.name === ".pageindex"
```
**排除模式（之后）**：
```typescript
import { PAGEINDEX_DIR } from '../paths';
entry.name === PAGEINDEX_DIR.split('/').pop()  // "pageindex"
```

---

## 4. 测试策略

### 4.1 单元测试适配

- 路径相关断言更新（所有引用 `.pageindex` 的测试）
- 迁移函数测试：旧路径存在→迁移成功，旧路径不存在→跳过，已迁移→跳过

### 4.2 手动验证

1. 全新安装 → 索引一本书 → 数据在新路径下
2. 从旧版升级 → 自动迁移 → 旧目录消失 → 功能正常
3. 微信读书同步 → 数据在新路径下
4. 搜索、对话、引导按钮等均正常

---

## 5. 代码风格

- 遵循项目现有风格：中文注释、英文标识符
- 日志使用 `utils/logger.ts`
- 不引入新依赖

---

## 6. 边界

### 始终做

- 迁移过程幂等（标记文件保证）
- 迁移失败时日志警告，不阻塞插件加载
- 所有路径引用集中到 `paths.ts`

### 先问

- 迁移时如果新路径已存在数据（部分迁移场景），需要合并策略

### 永不做

- 不修改索引数据的内部格式
- 不修改 agent/graph 的业务逻辑
- 不优化向量存储结构
