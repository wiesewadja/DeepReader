# Plan A: Hermes 端暴露 xiting_* 4 工具

> 独立项目，**不**依赖 DeepReader。完成后用 mcporter 当 client 即可验收。
> 改的文件全在 Hermes 侧：`~/.hermes/config.yaml` + `mcp_server/entry.py` + `mcp_server/tools.py`。

---

## 目标

`hermes mcp agent-serve --profile xiting` 启动后，能通过 stdio 给任何 MCP client 暴露 4 个 xiting 工具。xiting profile 与通用 Hermes profile 完全隔离（独立 provider / model / api_key / system_prompt / vault_path）。

---

## 4 步实施

### Step 1: `~/.hermes/config.yaml` 加 xiting profile

顶层加 5 字段：

```yaml
xiting:
  provider: minimax-cn
  model: MiniMax-M3
  api_key: ""
  system_prompt: |
    你是奚童读书伴读助手，隶属于 DeepReader 深度阅读插件。
    职责：帮用户整理读书笔记、生成可视化图表、维护并理解用户阅读画像、回答读书相关问题。
    约束：所有输出文件必须写到 vault_path 白名单内；不调用任何对外副作用工具（不发消息、不下载书）；使用中文输出。
  vault_path: /Users/lizhao/Nutstore Files/昭见森2030
```

### Step 2: `mcp_server/entry.py` 加 `--profile` 参数

```python
p.add_argument(
    "--profile",
    default=None,
    help="Named profile to load from config.yaml (e.g. 'xiting').",
)
# main() 里：
if args.profile:
    os.environ["HERMES_MCP_PROFILE"] = args.profile
```

### Step 3: `mcp_server/tools.py` 加 `_resolve_xiting_profile()`

```python
def _resolve_xiting_profile():
    profile_name = os.environ.get("HERMES_MCP_PROFILE", "").strip()
    if not profile_name:
        return None
    with open(os.path.join(get_hermes_home(), "config.yaml")) as f:
        cfg = yaml.safe_load(f) or {}
    profile = cfg.get(profile_name)
    return profile if isinstance(profile, dict) else None
```

### Step 4: `mcp_server/tools.py` 加 4 工具

**TOOL_MANIFEST 末尾追加 4 schema**：

- **xiting_render_diagram** — `book_title` / `book_author` / `section` / `analysis_data` / `diagram_type` (mindmap|flowchart|concept_map|timeline) / `output_filename`
- **xiting_write_note** — `book_title` / `book_author` / `section` / `user_request` / `source_content` / `output_filename`
- **xiting_user_profile** — `scope` (full|preferences|history|style) / `limit`
- **xiting_chat** — `message` / `session_id` (续接) / `model` (覆盖)

**每个 handler 自实现 LLM 客户端**：`httpx` POST `base_url/v1/chat/completions`，system prompt 来自 xiting profile。

**写文件必须过 `_safe_join()` 校验**（`os.path.realpath` + `startswith` 防越界 + symlink attack）。

**`xiting_chat` 走 xiting profile** 而**不**走 `_resolve_runtime()` 通用 profile，确保 LLM 配置独立。

---

## 验收清单

- [ ] A1: `cat ~/.hermes/config.yaml | grep -A 8 "^xiting:"` 看到 5 字段
- [ ] A2: `python -m mcp_server --help | grep profile` 看到 `--profile` 参数
- [ ] A3: `HERMES_MCP_PROFILE=xiting python -c "from mcp_server.tools import _resolve_xiting_profile; print(_resolve_xiting_profile())"` 拿到 5 字段
- [ ] A4: `python -m mcp_server --list-tools` 输出 10 个工具（6 hermes_* + 4 xiting_*）
- [ ] A5: mcporter 注册 `hermes mcp agent-serve --profile xiting`，list 4 个 xiting_*
- [ ] A6: mcporter call `xiting_user_profile scope=preferences` 返回 USER.md 命中
- [ ] A7: mcporter call `xiting_render_diagram` 传 `output_filename: ../../etc/passwd`，handler 报错不写
- [ ] A8: mcporter call `xiting_chat message="ping"`，返回 LLM 真实回复

---

## 风险

- 中：4 工具的 LLM 客户端是新增代码（之前 mcp_server handler 都调已有 module）
- 中：vault_path 路径校验要 robust

## 范围外

- Hermes HTTP transport
- 4 工具之外的 xiting 工具
- xiting user profile 自动更新
- 流式响应
- Hermes CLI / gateway 改动
