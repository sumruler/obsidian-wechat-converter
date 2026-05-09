# Wechatsync MCP Heartbeat Handover

本文档给 Obsidian 插件侧接入 Session 使用，说明 Wechatsync 浏览器扩展 bridge 侧新增的连接稳定性改造，以及 Obsidian 侧应该如何配合。

## 背景

之前 MCP bridge 的主要风险来自 Chrome MV3 Service Worker 空闲休眠：

- 浏览器扩展 background 是 Service Worker，不是常驻页面。
- Service Worker 空闲后会被 Chrome 终止。
- MCP WebSocket 连接存在内存里，Service Worker 被终止时连接也会断。
- 用户回到 Obsidian 点击“测试连接 / 同步 / 查看任务”时，可能遇到第一次请求失败或需要等待重连。

Deepseek 之前加过 `chrome.alarms` keepalive，但只靠 alarm 不能真正持续保住 WebSocket：

- `chrome.alarms` 最小周期是 `0.5` 分钟，也就是 30 秒。
- 低于 `0.5` 的 `periodInMinutes` 不应依赖。
- alarm 更适合作为“断线后的兜底唤醒和重连”，不是保持连接不断的主机制。

## 扩展侧已完成的改造

Wechatsync 扩展侧现在使用双层策略：

1. WebSocket heartbeat
   - MCP WebSocket 连接成功后，扩展每 25 秒发送一个轻量 heartbeat。
   - heartbeat 用来制造 WebSocket activity，降低 MV3 Service Worker 因空闲休眠而断开连接的概率。
   - WebSocket 断开或 MCP 被关闭时，heartbeat 会停止。

2. `chrome.alarms` fallback
   - alarm 周期改为合法的 `0.5` 分钟。
   - alarm 不再承担主要保活职责，只做兜底恢复。
   - alarm 触发时会重新读取 `mcpEnabled`。
   - 如果用户已经关闭 MCP，即使旧 alarm 残留，也不会重新连接。

3. MCP server bridge
   - MCP server 会忽略扩展发来的 heartbeat 帧。
   - heartbeat 不会进入普通 request/response 协议，也不会污染 pending request 日志。

## 对 Obsidian 侧 API 的影响

没有新增必需 API。

Obsidian 侧继续使用已有能力：

- `health`
- `list_supported_platforms`
- `get_auth_snapshot`
- `check_auth`
- `enqueue_sync_article`
- `get_sync_task`
- `open_sync_task`

这次改造只提升 bridge 连接稳定性，不改变请求参数或响应结构。

## Obsidian 侧应该做什么

### 1. 保留 `health` 作为连接入口

设置页“测试连接”仍然调用 `health`。

建议 UI 文案区分两种状态：

- `ok:true`：扩展桥接已连接。
- `ok:false` 或请求失败：浏览器扩展可能未连接、MCP server 未启动，或正在恢复连接。

### 2. 对连接失败做短重试

因为 MV3 仍可能存在冷启动/恢复窗口，Obsidian 不要在第一次失败时立刻判定“不可用”。

建议策略：

- 首次 `health` 失败后等待 800ms 到 1500ms。
- 最多重试 2 次。
- 总等待时间控制在 3 到 5 秒内。
- 仍失败再显示用户可理解的错误。

这不是为了掩盖真实错误，而是给扩展 Service Worker 和 WebSocket bridge 一个恢复窗口。

### 3. 发布链路不要长阻塞

同步文章仍然调用 `enqueue_sync_article`。

成功拿到 `syncId` 后：

- Obsidian 显示“已发送到 Wechatsync 扩展”。
- 保存最近任务 `{ syncId, title, platforms, createdAt }`。
- 如果需要展示轻量状态，短生命周期调用 `get_sync_task(syncId)`。
- 不要长时间等待所有平台完成。

### 4. “查看任务”继续调用 `open_sync_task`

用户点击“查看任务”时调用：

```json
{
  "tool": "open_sync_task",
  "arguments": {
    "syncId": "sync_xxx"
  }
}
```

扩展会在浏览器里打开任务历史窗口并定位到该任务。草稿链接、失败原因、单平台重试仍在扩展侧处理。

### 5. 不需要在 Obsidian 内实现平台登录

这次 heartbeat 改造只是让浏览器扩展 bridge 更稳定，不改变产品边界。

平台登录态、Cookie、CSRF token 和草稿编辑仍然属于浏览器扩展/默认浏览器。

Obsidian 侧不应尝试内嵌所有平台登录，也不应复制浏览器扩展的完整任务中心。

## 推荐错误提示

当短重试后仍失败，可以提示：

```text
未连接到 Wechatsync 浏览器扩展。请确认：
1. MCP Server 已启动；
2. 浏览器扩展已启用 MCP；
3. 浏览器正在运行；
4. Token 与 Server URL 配置一致。
```

当 `health` 成功但后续请求偶发失败，可以提示：

```text
Wechatsync bridge 正在恢复连接，请稍后重试。
```

## 验收建议

Obsidian 侧可以用以下场景验证：

1. 浏览器扩展启用 MCP 后，Obsidian 测试连接成功。
2. 闲置 1 到 3 分钟后，再次点击测试连接，应仍能快速返回。
3. 闲置后直接同步文章，`enqueue_sync_article` 应能返回 `syncId`。
4. 点击“查看任务”，浏览器应打开扩展任务窗口并定位到对应任务。
5. 在扩展里关闭 MCP 后，Obsidian 测试连接应失败，且不应被旧 alarm 自动拉起。

## 总结

扩展侧现在的连接模型是：

```text
WebSocket heartbeat：保持已连接 bridge 活跃
chrome.alarms 0.5min：断线后的兜底恢复
mcpEnabled check：尊重用户关闭状态
```

Obsidian 侧不需要改协议，只需要把连接失败视为“可能正在恢复”，做短重试和清晰提示即可。
