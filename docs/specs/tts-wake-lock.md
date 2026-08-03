# Spec：移动端朗读防熄屏（Screen Wake Lock）

## 背景

原方案「Android 锁屏后台朗读 + MediaSession + 静音底噪保活」经评审证伪：

- Android WebView **不支持** MediaSession API（[Chromium #40540400](https://issues.chromium.org/40540400)、[W3C mediasession #337](https://github.com/w3c/mediasession/issues/337)）→ 锁屏卡片/通知栏控制做不出
- 后台/锁屏时 Android WebView **挂起 JS 定时器**（约 5 分钟）→ 静音底噪保活救不了 JS，连续朗读链条断裂
- Obsidian 插件**无权加装** Capacitor 原生层 → 原生 MediaSession + Foreground Service 路线走不通

**降级目标**：朗读进行时用 `navigator.wakeLock.request('screen')` 防止屏幕自动熄屏，实现「前台连续朗读、用户无需反复点亮屏幕」。此能力在 Android WebView 6.0+ / iOS WebView 16.4+ / 桌面 Electron 均受支持，且无需原生权限，Obsidian 插件沙箱内可调用。

## 目标

- **用户价值**：朗读一本书时，屏幕保持常亮不熄屏，用户不必每几十秒点一下屏幕防熄。
- **诚实边界**：不承诺锁屏/后台继续朗读（技术上不可行）。一旦页面切后台或被系统挂起，朗读即受平台约束停止——这是已知边界，不在本规格修复范围。
- **成功定义**：朗读 `playing` 态下屏幕不熄屏；`paused`/`idle`/`destroy` 立即释放 wake lock；不支持 Wake Lock API 的环境静默降级，朗读功能不受任何影响。

## 命令（Commands）

- 构建：`npm run build`
- 单元测试：`npm run test:run`
- 单个测试：`npx vitest run tests/unit/services/tts/tts-service.test.ts`
- 部署：`npm run deploy` → `test-vault/.obsidian/plugins/deepreader-dev/`
- 移动端真机验证：`deepreader-mobile-test` skill（Android AVD `obsidian_test`）

## 受影响模块

- `src/services/tts/tts-service.ts` — **主改动**：新增 wake lock 持有/释放/重获取逻辑，挂入现有 `pause/resume/stop/destroy` 状态机与 `setState('playing')` 路径
- `tests/unit/services/tts/tts-service.test.ts` — 新增 wake lock 行为用例
- 不改动 `pcm-stream-player.ts`（其 `visibilitychange` 监听管 AudioContext，与本特性的 `visibilitychange` 监听职责分离、互不干扰）

## 技术约束

- 遵循现有 TTS 状态机模式：`this.state`（`'playing' | 'paused' | 'idle'`）+ `setState()`
- 平台守卫：先 `'wakeLock' in navigator` feature detect，再 `try/catch` 请求
- 日志用 `serviceLog`（`utils/logger.ts`），不引入 `console.log`
- TypeScript 严格模式；若当前 `lib` 不含 `WakeLockSentinel` 类型，用局部接口声明，不新增 `@types` 依赖
- 不静态 import Node 核心模块（移动端兼容红线，本特性本身不涉及）

## 代码风格

对齐 `tts-service.ts` 现有风格（私有字段 + 私有方法 + `serviceLog`）：

```typescript
// 私有字段命名：camelCase
private wakeLockSentinel: WakeLockSentinel | null = null;
private wakeLockVisibilityHandler: (() => void) | null = null;

// 生命周期方法与现有 pause/resume/stop 对齐
private async acquireWakeLock(): Promise<void> {
    if (!('wakeLock' in navigator)) return;        // 静默降级
    // ... 请求 + 监听 release
}

private async releaseWakeLock(): Promise<void> {
    // ... release + 清引用 + 移除监听
}
```

## 行为规约（核心逻辑）

1. **获取时机**：`setState('playing')` 路径触发（即 `play()` 真正开始、`resume()` 从 paused 恢复）
2. **释放时机**：`pause()`（→paused）、`stop()`（→idle）、`destroy()` 三处立即释放
3. **可见性重获取**：监听 `visibilitychange`，当 `visibilityState === 'visible'` 且 `this.state === 'playing'` 时重新 `acquireWakeLock()`（因为切后台时 sentinel 会被平台自动释放，回到前台需手动重获）
4. **release 事件处理**：sentinel 的 `release` 事件触发时清空引用，避免重复 `release()`
5. **异常容忍**：`acquireWakeLock` 全程 `try/catch`，任何失败（用户拒绝、策略不允许、API 缺失）都不影响朗读主流程
6. **不与 pcm-stream-player 的 visibilitychange 合并**：两个监听各自独立注册，浏览器允许多个 listener

## 测试策略

- **层级**：单元（Vitest）
- **位置**：扩展 `tests/unit/services/tts/tts-service.test.ts`
- **Mock 策略**：mock `navigator.wakeLock`（jsdom 默认无此 API，需手动 stub），mock `document.visibilitychange` 派发
- **覆盖用例**：
  1. 不支持 wakeLock（`'wakeLock' in navigator === false`）→ 朗读正常，不抛错
  2. 进入 playing → `wakeLock.request('screen')` 被调用
  3. pause → sentinel.release() 被调用
  4. stop / destroy → sentinel.release() 被调用
  5. visibilitychange→visible 且 playing → 重新 request
  6. visibilitychange→visible 但 paused/idle → **不**重新 request
  7. request 抛异常 → 被吞，朗读主流程不受影响
- **真机验证**（移动端必须，单元测试不足以证明 WebView 行为）：用 `deepreader-mobile-test` skill 在 Android AVD 实测：朗读时屏幕在系统熄屏超时后是否仍亮

## 边界

**Always（必须做）**
- `npm run test:run` 和 `npm run build` 通过
- feature detect + try/catch 包裹所有 wake lock 调用
- 暂停/停止/销毁三处都释放，不漏 destroy
- 移动端真机验证（AVD）

**Ask First（先问用户）**
- 是否给用户加一个设置开关（默认开）来启用/关闭防熄屏
- 是否调整 `pcm-stream-player.ts` 的 visibilitychange（本规格默认不动）

**Never（禁止）**
- 静态 import Node 核心模块
- 引入 `@types/*` 新依赖补 WakeLock 类型
- 在不支持 wakeLock 的环境抛错或阻塞朗读
- 把 wake lock 监听塞进 `pcm-stream-player.ts`（职责混淆）
- 提交 git（由用户审查后自行提交）

## 验收标准

1. 在支持 wakeLock 的设备上：朗读进入 `playing` 后，屏幕超过系统熄屏超时仍不熄灭
2. `pause` / `stop` / `destroy` 任一触发后，wake lock 立即释放（屏幕恢复正常熄屏行为）
3. 朗读中切到其他 app 再切回（visible），且仍处于 `playing`，wake lock 重新持有
4. 朗读中切到其他 app 再切回，但已 `paused`/`idle`，不重新持有
5. 在不支持 `navigator.wakeLock` 的环境（旧设备/被策略禁用），所有朗读功能正常，无报错日志噪音
6. `npm run test:run` 全绿，新增 wake lock 单测覆盖上述行为
7. Android AVD 真机验证：朗读时屏幕不熄屏（桌面 Electron 验证不足以代表移动端）

## 已确认决策（阶段 1 评审结论）

1. **不加设置开关**：无条件开启。朗读才持有 wake lock、无副作用，无需暴露 UI。
2. **暂停态释放 wake lock**：`paused` 即释放（省电优先，假设暂停≈用户可能离开）；`resume` 重新获取。
3. **iOS 验证缺口接受**：代码层 feature-detect 兼容 iOS 16.4+，但 CI/本地只在 Android AVD 验证；iOS 行为靠用户真机回归，不阻塞合入。该缺口已在「测试策略」「验收标准 7」如实标注。
