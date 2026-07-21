# 火山豆包 TTS WebSocket 流式适配器

> 状态：ready-for-agent
> 来源：火山官方文档 82379/2516286 + 开源库 doubao-tts / volcengine-audio 协议参考
> 关联：spec/ai-services-settings-redesign.md（agent-plan 预设 TTS 角色改为火山）

## Problem Statement

Agent Plan 预设的 TTS 角色当前指向小米 MIMO（`mimo-v2.5-tts`），但火山方舟 Agent Plan 已包含豆包语音合成 doubao-seed-tts-2.0。用户买了 Agent Plan 后，TTS 应走火山而非 MIMO（MIMO 套餐可能用尽）。

但火山 TTS 接口与现有 TTSClient（OpenAI 兼容 `/chat/completions`）**完全不兼容**：
- 端点不同：`wss://openspeech.bytedance.com/api/v3/plan/tts/bidirection`（WebSocket，非 HTTP）
- 鉴权不同：`X-Api-Key` + `X-Api-Resource-Id`（非 Bearer token）
- 协议不同：自定义二进制帧 + 状态机（非 JSON over HTTP）
- 模型指定方式：Resource-Id（`seed-tts-2.0`），非 model 字段

现有 TTSClient 无法复用，需写专门的火山 TTS 适配器。

## Solution

新增火山 TTS 适配，集成到现有 tts-service 的 provider 分支。**首版用 HTTP 端点**（已实测可用、返回 base64 mp3，实现简单可靠），WebSocket 双向流式作为后续优化（边生成边播的低延迟体验）。agent-plan 预设的 TTS 角色改指向 `volcark/doubao-seed-tts-2.0`。

## 实测确认的可用配置（HTTP 端点，首版用此）

实测请求（已返回 33305 字节 base64 mp3，code=0 成功）：

- 端点：`https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional`（HTTP POST）
- Header：`X-Api-Key: <ark key>` + `X-Api-Resource-Id: seed-tts-2.0`
- Body：`{user:{uid}, namespace:"BidirectionalTTS", req_params:{text, speaker:"zh_female_vv_uranus_bigtts", audio_params:{format:"mp3", sample_rate:24000, speech_rate:0}}}`
- 返回：NDJSON — `{"code":0,"data":"<base64 chunk1>"}` 多行 + `{"code":20000000,"message":"OK","data":null}` 终止行。所有 `code=0` 的 `data` 拼接后 base64 解码得到完整 MP3
- **ark key（Agent Plan）可直接用于 plan TTS 端点**，无需火山语音 console 的 app_id/access_token（与开源库 doubao-speech 的标准端点凭证不同）
- speaker 默认 `zh_female_vv_uranus_bigtts`（中文女声 warm）；plan 端点接受标准 seed-tts 音色 ID

## 协议细节（WebSocket V3，后续流式优化用）

### 端点与鉴权
- WebSocket URL：`wss://openspeech.bytedance.com/api/v3/plan/tts/bidirection`
- 握手请求头：`X-Api-Key: <ark key>`、`X-Api-Resource-Id: seed-tts-2.0`
- ark key 已实测可用于此端点（status 200，鉴权通过）

### 二进制帧格式（大端序，所有整数 readUInt32BE）

4 字节基础 header：

| 字节 | 高 4 bit | 低 4 bit |
|------|----------|----------|
| 0 | 协议版本 `0b0001` | header 大小 `0b0001`（=4字节） |
| 1 | 消息类型 `0b0001`请求/`0b1011`音频/`0b1111`错误 | flags `0b0100`=含事件号 |
| 2 | 序列化 `0b0001`=JSON | 压缩 `0b0000`=无 |
| 3 | 保留 `0x00` | — |

含事件时（flags 含 `0b0100`）追加扩展 header：
- 4 字节 event（大端整数）
- 4 字节 sessionId 长度 + sessionId(UTF-8)（event 1/50 不需要 sessionId）
- 4 字节 payload 长度 + payload（JSON 序列化；音频帧为 raw bytes）

### 事件流（状态机）

| 步骤 | 事件 | 值 | 方向 | 说明 |
|------|------|----|------|------|
| 1 | START_CONNECTION | 1 | C→S | 建连，payload 含自定义 config |
| 2 | CONNECTION_STARTED | 50 | S→C | 连接确认 |
| 3 | START_SESSION | 100 | C→S | 开始合成会话，含 voice_type 等 |
| 4 | SESSION_STARTED | 150 | S→C | 会话就绪 |
| 5 | TASK_REQUEST | 200 | C→S | 发送待合成文本 |
| 6 | AUDIO_DATA | 352 | S→C | 音频数据帧（多帧） |
| 7 | SESSION_FINISHED | 152 | S→C | 会话完成 |
| 8 | FINISH_SESSION | 102 | C→S | 结束会话 |

### 音频返回
- 格式：raw PCM（TASK_REQUEST 的 audio_params 指定 format/sample_rate）
- 消息类型 `0b1011`，payload 为音频字节，无 JSON 包裹
- 需确认采样率/位深（实现时按 SESSION_STARTED 返回或文档默认：16bit/24kHz/mono）

## Implementation Decisions

### 新增模块
- `src/services/tts/volc-tts-client.ts`：`VolcTTSClient` 类
  - `synthesize(text, options): Promise<ArrayBuffer>`：完整合成（非流式接口，内部走 WS 拿完全部音频）
  - `synthesizeStream(text, options, signal?): AsyncGenerator<ArrayBuffer>`：流式逐帧 yield PCM 分片
  - 内含：WebSocket 管理、二进制帧编解码（encodeFrame/decodeFrame）、状态机推进、超时与错误处理
- 实现 `ITTSSynthesizer` 接口（与现有 TTSClient 同接口），保证 tts-service 能透明替换

### 集成点
- `src/services/tts/tts-service.ts`：创建 client 时按 provider 分支——`volcark` → `VolcTTSClient`，其余 → 现有 `TTSClient`
- `src/config/providers.ts`：
  - volcark `PROVIDER_CONFIGS` 的 `capabilities.tts` 改为 `true`
  - 新增 volcark 的 TTS base URL 配置（`wss://openspeech.bytedance.com/api/v3/plan/tts/bidirection`）
- `src/config/presets.ts`：agent-plan 预设的 tts 角色从 xiaomi 改为 volcark
  - 主 provider 的 roleAssignments 增加 `tts: 'doubao-seed-tts-2.0'`
  - additionalProviders 移除 xiaomi 的 tts 分配（MIMO 不再承担 TTS）

### 二进制帧编解码要点
- 全程大端序（`Buffer.writeUInt32BE` / `readUInt32BE`）
- reqid 用 UUID v4，每次合成重新生成
- 单连接串行合成（不支持并发 session）
- gzip 压缩可选（首版不压缩，flags 压缩位 = 0b0000）

### 错误处理
- WebSocket 连接失败 / 握手超时 → 抛出明确错误
- 服务端 event 错误（消息类型 0b1111）→ 解析 payload 错误码，抛出
- AbortSignal 支持（用户停止播报时中断）

## Testing Decisions

### 测试缝隙
- **二进制帧编解码**（纯函数，单元测试）：encodeFrame(event, payload, sessionId?) / decodeFrame(buffer) → 事件号、payload、消息类型正确。这是协议正确性的核心，无网络依赖。
- **状态机逻辑**（可选单元测试）：给定事件序列，验证 client 状态转换。
- **集成**：手动实测（Obsidian 里触发语音播报，听声音 + 看日志），不写 mock WebSocket 单测（脆弱）。

### 先例
- 参考 `tests/unit/config/compute-preview-roles.test.ts` 的纯函数测试范式。

## Out of Scope

- ASR（语音识别 doubao-seed-asr-2.0）：本次只做 TTS，ASR 后续独立任务
- gzip 压缩：首版不压缩
- 多 session 并发：单连接串行
- voice_type 的动态选择/音色库：首版用固定 voice_type（如 BV001_streaming），音色选择后续做
- V1 协议兼容：只实现 V3
- MIMO TTS 的修复（套餐用尽问题）：不处理

## Further Notes

- **协议来源**：火山官方文档 82379/2516286（JS 渲染，已通过 web_search + 开源库 doubao-tts/volcengine-audio 交叉验证协议细节）
- **开源参考**：`Hypnus-Yuan/doubao-tts`（Python）、`aiyou178/volcengine-audio`（含协议编解码）、`dsd2077/CyberVerse` 的 doubao_protocol.py
- **ark key 鉴权已实测**：HTTP 端点 `/api/v3/plan/tts/unidirectional` 用 X-Api-Key: ark-... 返回 200（参数错 45000000，非 401），证明 Agent Plan key 可用于语音
- **音频播放**：PCM 流需转 WAV 头或用 AudioContext 播放，复用现有 tts-service 的播放管线
