# 进度追踪 API 使用文档

本文档说明如何在 Obsidian 插件（前端）中使用 DeepPDF API 的进度追踪功能。

## 概述

PDF 索引是一个耗时操作（可能需要几分钟），因此 API 采用异步任务模式：

1. **创建任务**：调用 `POST /api/index` 立即返回 `task_id`
2. **轮询进度**：定期调用 `GET /api/tasks/{task_id}/progress` 获取最新进度
3. **获取结果**：任务完成后，通过响应中的 `index_id` 查询结果

## API 端点

### 1. 创建索引任务

**请求**
```http
POST /api/index
Content-Type: application/json

{
  "path": "/path/to/pdf.pdf",
  "llm_provider": "deepseek",
  "llm_model": "deepseek-chat",
  "deepseek_api_key": "sk-...",
  "if_add_node_summary": true
}
```

**响应**（立即返回，通常 < 100ms）
```json
{
  "status": "pending",
  "index_id": "task_abc123",
  "message": "索引任务已创建，使用 GET /api/indexes/task_abc123 查询进度"
}
```

> 注意：`index_id` 字段此时返回的是 `task_id`（以 `task_` 开头），用于后续查询进度。

---

### 2. 查询任务进度（推荐）

**请求**
```http
GET /api/tasks/{task_id}/progress
```

**响应**（处理中）
```json
{
  "id": "task_abc123",
  "status": "processing",
  "message": "正在解析 PDF 结构 (这可能需要几分钟)...",
  "pdf_path": "/path/to/pdf.pdf",
  "created_at": "2026-01-18 12:00:00",
  "current_step": "parse_pdf_structure",
  "progress_percent": 50,
  "total_steps": 6,
  "completed_steps": 3
}
```

**响应**（完成）
```json
{
  "id": "task_abc123",
  "status": "completed",
  "message": "索引创建成功！",
  "progress_percent": 100,
  "index_id": "idx_xyz789",
  "node_count": 23,
  "pdf_name": "document.pdf"
}
```

**响应**（失败）
```json
{
  "id": "task_abc123",
  "status": "failed",
  "error": "PDF file is too small"
}
```

**状态说明**
- `pending`: 任务已创建，等待处理
- `processing`: 正在处理
- `completed`: 完成（此时 `index_id` 才是真正的索引 ID，以 `idx_` 开头）
- `failed`: 失败
- `cancelled`: 已取消

**进度阶段说明**

| `current_step` | 百分比 | 说明 |
|----------------|--------|------|
| `validate_pdf` | 10% | 验证 PDF 文件 |
| `check_llm_config` | 20% | 检查 LLM API 配置 |
| `init_pageindex` | 30% | 初始化 PageIndex 配置 |
| `create_llm_client` | 40% | 创建 LLM 客户端 |
| `parse_pdf_structure` | 50-70% | 解析 PDF 结构（最耗时） |
| `parse_complete` | 70% | PDF 解析完成 |
| `store_vectors` | 80% | 向量化并存储 |
| `save_metadata` | 95% | 保存元数据 |
| `complete` | 100% | 完成 |

---

### 3. 查询索引/任务状态（兼容接口）

**请求**
```http
GET /api/indexes/{id}
```

- 如果 `{id}` 以 `task_` 开头：返回任务状态（同 `/tasks/{id}/progress` 的简化版）
- 如果 `{id}` 以 `idx_` 开头：返回已完成的索引信息

---

### 4. 列出所有索引和任务

**请求**
```http
GET /api/indexes
```

**响应**
```json
{
  "status": "success",
  "indexes": [
    {
      "id": "idx_abc123",
      "pdf_name": "document.pdf",
      "node_count": 23,
      "created_at": "2026-01-18 12:00:00"
    },
    {
      "id": "task_xyz789",
      "pdf_name": "another.pdf",
      "status": "processing",
      "created_at": "2026-01-18 12:05:00",
      "message": "正在解析 PDF 结构..."
    }
  ]
}
```

---

### 5. 取消任务

**请求**
```http
DELETE /api/tasks/{task_id}
```

**响应**
```json
{
  "status": "success",
  "message": "任务 task_abc123 已取消",
  "task_id": "task_abc123",
  "current_status": "cancelled"
}
```

---

## 前端实现示例

### TypeScript (Obsidian Plugin)

```typescript
// 1. 创建索引任务
async function createIndexTask(pdfPath: string, config: IndexConfig): Promise<string> {
  const response = await fetch('http://localhost:6088/api/index', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      path: pdfPath,
      llm_provider: config.llmProvider,
      llm_model: config.llmModel,
      deepseek_api_key: config.apiKey,
      if_add_node_summary: true
    })
  });

  const data = await response.json();
  return data.index_id; // 返回 task_id
}

// 2. 轮询进度
async function pollTaskProgress(taskId: string): Promise<ProgressResult> {
  const response = await fetch(`http://localhost:6088/api/tasks/${taskId}/progress`);
  return await response.json();
}

// 3. 完整流程
async function indexPDFWithProgress(
  pdfPath: string,
  config: IndexConfig,
  onProgress: (step: string, percent: number, message: string) => void
): Promise<string> {
  // 创建任务
  const taskId = await createIndexTask(pdfPath, config);
  console.log('任务已创建:', taskId);

  // 轮询进度
  while (true) {
    const progress = await pollTaskProgress(taskId);

    // 触发进度回调
    if (progress.current_step && progress.progress_percent !== undefined) {
      onProgress(
        progress.current_step,
        progress.progress_percent,
        progress.message || ''
      );
    }

    // 检查状态
    if (progress.status === 'completed') {
      console.log('索引完成!', progress.index_id);
      return progress.index_id!; // 返回真正的索引 ID
    }

    if (progress.status === 'failed') {
      throw new Error(progress.error || '索引失败');
    }

    if (progress.status === 'cancelled') {
      throw new Error('任务已取消');
    }

    // 等待 1 秒后再次轮询
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

// 4. 在 Obsidian 插件中使用
class DeepPDFPlugin extends Plugin {
  async indexPDF(pdfPath: string) {
    const modal = new ProgressModal(this.app);
    modal.open();

    try {
      const indexId = await indexPDFWithProgress(
        pdfPath,
        this.settings,
        (step, percent, message) => {
          // 更新进度条
          modal.updateProgress(percent, message);
        }
      );

      modal.showSuccess(`索引创建成功！ID: ${indexId}`);
    } catch (error) {
      modal.showError(error.message);
    }
  }
}

// 5. 取消任务
async function cancelTask(taskId: string): Promise<void> {
  await fetch(`http://localhost:6088/api/tasks/${taskId}`, {
    method: 'DELETE'
  });
}
```

### 进度 UI 示例

```typescript
class ProgressModal extends Modal {
  private progressBar: HTMLElement;
  private statusText: HTMLElement;

  constructor(app: App) {
    super(app);
    this.contentEl.createEl('h2', { text: 'PDF 索引进度' });

    // 进度条
    const progressBarContainer = this.contentEl.createDiv();
    progressBarContainer.style.cssText = 'width: 100%; height: 20px; background: #e0e0e0; border-radius: 10px; overflow: hidden;';

    this.progressBar = progressBarContainer.createDiv();
    this.progressBar.style.cssText = 'height: 100%; background: #4CAF50; width: 0%; transition: width 0.3s;';

    // 状态文本
    this.statusText = this.contentEl.createEl('p', { text: '准备中...' });

    // 取消按钮
    const cancelBtn = this.contentEl.createEl('button', { text: '取消' });
    cancelBtn.onclick = () => this.close();
  }

  updateProgress(percent: number, message: string) {
    this.progressBar.style.width = `${percent}%`;
    this.statusText.textContent = `${percent}% - ${message}`;
  }

  showSuccess(message: string) {
    this.progressBar.style.background = '#4CAF50';
    this.statusText.textContent = message;
  }

  showError(message: string) {
    this.progressBar.style.background = '#f44336';
    this.statusText.textContent = `错误: ${message}`;
  }
}
```

---

## JavaScript (Obsidian Plugin - 非异步版本)

如果您的插件不使用 `async/await`，可以使用 Promise 链：

```javascript
function indexPDF(pdfPath, config) {
  return new Promise((resolve, reject) => {
    // 1. 创建任务
    fetch('http://localhost:6088/api/index', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: pdfPath,
        llm_provider: config.llmProvider,
        llm_model: config.llmModel,
        deepseek_api_key: config.apiKey
      })
    })
    .then(res => res.json())
    .then(data => {
      const taskId = data.index_id;
      console.log('任务已创建:', taskId);

      // 2. 轮询进度
      const poll = () => {
        fetch(`http://localhost:6088/api/tasks/${taskId}/progress`)
          .then(res => res.json())
          .then(progress => {
            // 更新 UI
            this.updateProgressUI(progress);

            // 检查状态
            if (progress.status === 'completed') {
              resolve(progress.index_id);
            } else if (progress.status === 'failed') {
              reject(new Error(progress.error));
            } else if (progress.status === 'cancelled') {
              reject(new Error('任务已取消'));
            } else {
              // 继续轮询
              setTimeout(poll, 1000);
            }
          });
      };

      poll();
    });
  });
}
```

---

## 最佳实践

### 1. 轮询间隔
- **推荐**：1-2 秒
- **最小**：500 毫秒（避免过载）
- **最大**：5 秒（用户体验差）

### 2. 超时处理
```typescript
async function pollWithTimeout(taskId: string, timeoutMs: number = 300000) {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const progress = await pollTaskProgress(taskId);

    if (progress.status === 'completed') return progress;
    if (['failed', 'cancelled'].includes(progress.status)) {
      throw new Error(progress.status);
    }

    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  throw new Error('索引超时');
}
```

### 3. 错误重试
```typescript
async function pollWithRetry(taskId: string, maxRetries: number = 3) {
  let retries = 0;

  while (retries < maxRetries) {
    try {
      return await pollTaskProgress(taskId);
    } catch (error) {
      retries++;
      if (retries >= maxRetries) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}
```

### 4. 清理完成的任务
定期清理 `_running_tasks` 中已完成的任务，避免内存泄漏：

```typescript
// 后端应实现定期清理逻辑（当前未实现）
// 前端可以忽略已完成的任务
```

---

## 故障排查

### 问题 1：进度卡在 50%
**原因**：PDF 解析是 CPU 密集型操作，大文件可能需要很长时间。
**解决**：耐心等待，或检查服务器日志。

### 问题 2：`status: pending` 一直不变
**原因**：任务未开始处理。
**解决**：检查服务器是否正常运行，查看日志。

### 问题 3：`status: failed`
**原因**：各种原因（文件不存在、API key 无效等）。
**解决**：查看响应中的 `error` 字段。

### 问题 4：`404 Not Found`
**原因**：任务 ID 不存在或已过期。
**解决**：重新创建任务。

---

## 总结

1. **创建任务** → 获取 `task_id`
2. **轮询进度** → `GET /api/tasks/{task_id}/progress`
3. **处理完成** → 获取 `index_id`
4. **查询结果** → `GET /api/indexes/{index_id}`
5. **语义搜索** → `POST /api/query`

通过轮询进度接口，前端可以实时展示索引进度，提供更好的用户体验。
