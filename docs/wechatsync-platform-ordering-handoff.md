# 浏览器插件平台排序与 Obsidian 配合说明

本文档给 Wechatsync 浏览器插件项目和 Obsidian 插件项目共同使用，说明“其他平台发布”里平台排序、平台清单来源、升级默认状态和引导文案应该如何配合。

## 背景

Obsidian 插件已经新增“其他平台（小红书/知乎/抖音等）”入口。用户从 Obsidian 进入这个入口时，通常已经完成了写作和预览，下一步要么是：

1. 先试用免费额度，每天发布到最多 3 个平台。
2. 购买 Pro 后，继续安装浏览器插件并完成配置。
3. 已经装好浏览器插件，直接选择平台并发送发布任务。

由于真实发布依赖用户浏览器里的登录态、平台适配器和任务历史，浏览器插件应该作为“实际支持哪些平台、平台如何排序”的来源。Obsidian 插件负责消费这份清单，并在没有连接浏览器插件时提供一个可用的本地备用清单。

## 当前 Obsidian 行为

### 升级后的默认状态

`multiPlatformSync.enabled` 默认是 `false`。也就是说，之前没有“其他平台”Tab 的用户升级后，不会自动开启浏览器插件发布。用户需要在 Obsidian 设置里主动打开“启用浏览器插件发布”。

这样比较稳妥：老用户升级后不会突然看到新的发布行为，也不会在未配置浏览器插件时误触发任务。

### 平台清单来源

Obsidian 侧当前有三类平台数据：

- `supportedPlatforms`：测试连接成功后，从浏览器插件 `listSupportedPlatforms` 读取并缓存的平台清单。
- `connection.platforms`：从浏览器插件读取到的登录状态快照，只用于展示已选平台的“上次可用 / 需登录 / 未检测”等状态。
- `FALLBACK_WECHATSYNC_PLATFORMS`：本地备用清单，用于未连接浏览器插件、老版本浏览器插件不支持平台清单、或者读取失败时展示。

真正展示平台列表时，Obsidian 会调用 `buildWechatsyncPlatformCatalog()`：

- 如果已经连接浏览器插件，且 `supportedPlatforms` 非空，就使用浏览器插件返回的顺序。
- 如果没有连接，或没有拿到 `supportedPlatforms`，就使用本地备用清单顺序。
- `connection.platforms` 不决定基础产品顺序，但会作为展示层“已登录优先”分组的依据。
- 如果登录状态里出现了主清单没有的平台，会追加到列表末尾。

因此，平台排序最适合放在浏览器插件侧定义成统一规则。Obsidian 侧应该使用浏览器插件返回的数组顺序作为基础顺序，再用登录状态做展示分组：已登录平台优先，未登录/未检测平台靠后；每个分组内部仍保持同一套产品优先级。

## 浏览器插件需要做什么

### 1. 让 `listSupportedPlatforms` 返回产品基础优先级顺序

浏览器插件应该把常用平台排在前面，再放长尾平台。`listSupportedPlatforms` 本身不检查登录态，所以它返回的是稳定的产品基础顺序。带登录状态的界面再基于这个基础顺序做“已登录优先”分组。

建议实现一个稳定的展示顺序表：

```js
const FEATURED_PLATFORM_ORDER = [
  'xiaohongshu',
  'zhihu',
  'weibo',
  'douyin',
  'toutiao',
  'bilibili',
  'csdn',
  'yuque',
  'jianshu',
  'smzdm',
];
```

排序时可以保留未知平台的原始顺序，并把它们放到已知平台后面：

```js
const orderIndex = new Map(FEATURED_PLATFORM_ORDER.map((id, index) => [id, index]));

function sortPlatformsForBaseDisplay(platforms) {
  return platforms
    .map((platform, originalIndex) => ({ platform, originalIndex }))
    .sort((a, b) => {
      const aOrder = orderIndex.has(a.platform.id) ? orderIndex.get(a.platform.id) : 9999;
      const bOrder = orderIndex.has(b.platform.id) ? orderIndex.get(b.platform.id) : 9999;
      return aOrder - bOrder || a.originalIndex - b.originalIndex;
    })
    .map((item) => item.platform);
}
```

有登录状态时再加第一层分组：

```js
function sortPlatformsForDisplay(platforms) {
  return platforms
    .map((platform, originalIndex) => ({ platform, originalIndex }))
    .sort((a, b) => {
      const authDiff = Number(!!b.platform.isAuthenticated) - Number(!!a.platform.isAuthenticated);
      if (authDiff !== 0) return authDiff;

      const aOrder = orderIndex.has(a.platform.id) ? orderIndex.get(a.platform.id) : 9999;
      const bOrder = orderIndex.has(b.platform.id) ? orderIndex.get(b.platform.id) : 9999;
      return aOrder - bOrder || a.originalIndex - b.originalIndex;
    })
    .map((item) => item.platform);
}
```

### 2. 保持平台 ID 稳定

Obsidian 侧依赖平台 `id` 做缓存、选择和任务投递，所以浏览器插件不要随意改 ID。

建议至少保持这些常见 ID：

- `xiaohongshu`：小红书
- `zhihu`：知乎
- `douyin`：抖音图文
- `toutiao`：头条号
- `weibo`：微博
- `bilibili`：B 站专栏
- `csdn`：CSDN
- `yuque`：语雀
- `jianshu`：简书
- `smzdm`：什么值得买

`weixin` 不应该放进“其他平台”清单。微信公众号仍然走 Obsidian 插件已有的公众号 API 链路。

### 3. 返回足够的展示元数据

`listSupportedPlatforms` 建议返回：

```json
[
  {
    "id": "xiaohongshu",
    "name": "小红书",
    "homepage": "https://creator.xiaohongshu.com",
    "icon": "",
    "capabilities": ["article", "draft", "image_upload"]
  }
]
```

Obsidian 侧目前会读取这些字段：

- `id`：必需，用于选择、缓存和任务投递。
- `name`：必需，用于 UI 展示。
- `homepage`：可选，用于后续打开平台入口。
- `icon`：可选，当前可以为空。
- `capabilities`：可选，但建议保留，后续可以做平台能力提示。

### 4. 用登录状态做第一层展示分组

登录状态应该通过 `getAuthSnapshot` 或平台状态字段返回。带登录状态的 UI 使用同一套展示规则：

- 已登录平台排在前面。
- 未登录和未检测平台排在后面。
- 每个分组内部按 `FEATURED_PLATFORM_ORDER` 排序。
- 未列入热门表的平台排在热门平台后面，并尽量保持原始稳定顺序。

例如用户已登录豆瓣但未登录小红书，则豆瓣先出现在“已登录”分组里；小红书仍然会在“未登录/未检测”分组内部排在其他未登录长尾平台前面。

### 5. 连接默认开启后，文案不要再强调“去浏览器插件里开启连接”

如果浏览器插件的连接服务已经默认开启，浏览器插件侧和 Obsidian 侧的文案都应该避免写成“请到浏览器插件开启连接”。

更推荐的表达是：

- “请先安装浏览器插件，再回到 Obsidian 测试连接并选择平台。”
- “如果连接失败，请确认浏览器正在运行、端口和连接令牌一致。”

只有在连接服务确实关闭、端口不可用、或令牌不一致时，才在错误诊断里提到具体检查项。

## Obsidian 插件需要配合什么

### 1. 使用同一套展示排序规则

Obsidian 侧应该尊重浏览器插件返回的平台基础顺序，并在合并登录状态后使用同一套“已登录优先 + 热门平台优先”的展示排序。后续不要在 Obsidian 里按平台名称、选择时间或其他临时维度重新排序。

设置页的平台选择器和发布弹窗都应该使用同一份 catalog 顺序。发布弹窗只过滤“设置页已勾选的平台”，过滤后仍保持 catalog 顺序。

发布历史也应该统一考虑：历史记录本身仍按时间倒序，但单条历史记录里的平台状态列表应尽量使用同一套平台展示顺序。若历史页能拿到当前登录状态，则已登录平台优先；若拿不到登录状态，则退化为热门平台优先的基础顺序。

建议在 Obsidian 侧新增一个小的排序 helper，和浏览器插件保持同一份热门表：

```js
const FEATURED_WECHATSYNC_PLATFORM_ORDER = [
  'xiaohongshu',
  'zhihu',
  'weibo',
  'douyin',
  'toutiao',
  'bilibili',
  'csdn',
  'yuque',
  'jianshu',
  'smzdm',
];
```

`buildWechatsyncPlatformCatalog()` 的推荐行为：

- 先选择基础清单：已连接且 `supportedPlatforms` 非空时用浏览器插件顺序；否则用 `FALLBACK_WECHATSYNC_PLATFORMS`。
- 再合并 `connection.platforms` / `authSnapshotPlatforms` 的登录态、用户名、错误信息。
- 最后返回前排序：已连接时按“已登录 → 未登录/未检测”分组；每组内部按 `FEATURED_WECHATSYNC_PLATFORM_ORDER` 排；未列入热门表的平台保留原始稳定顺序。
- 未连接时不做登录分组，只使用基础热门顺序，并把状态标成 `bridge_required`。

这样设置页、发布弹窗和结果弹窗只要都从 catalog 派生列表，就不会出现“设置页一个顺序、发布弹窗另一个顺序”的情况。

### 2. 等产品确认顺序后，同步本地备用清单

浏览器插件侧最终顺序已经确认。Obsidian 需要把 `services/wechatsync-results.js` 里的 `FALLBACK_WECHATSYNC_PLATFORMS` 调整成同样的基础顺序：

1. `xiaohongshu` 小红书
2. `zhihu` 知乎
3. `weibo` 微博
4. `douyin` 抖音图文
5. `toutiao` 头条号
6. `bilibili` B 站专栏
7. `csdn` CSDN
8. `yuque` 语雀
9. `jianshu` 简书
10. `smzdm` 什么值得买
11. 其他平台按现有长尾顺序追加

这样在这些情况下，用户看到的顺序仍然合理：

- 第一次进入设置页，还没测试连接。
- 浏览器插件暂时没运行。
- 老版本浏览器插件不支持 `listSupportedPlatforms`。
- 读取浏览器插件平台清单失败。

### 3. 清理“开启连接”相关文案

因为浏览器插件连接默认开启，Obsidian 侧文案应该从“去浏览器插件里开启连接”调整为“安装浏览器插件、回到 Obsidian 测试连接、选择平台”。

建议重点检查：

- `views/settings/multi-platform-tab.js` 的引导卡片和失败提示。
- `views/publish-modal/multi-platform.js` 的未启用提示。
- `services/wechatsync-bridge.js` 里的连接失败友好错误。
- `views/connection-status-bar.js` 的连接状态说明。

其中“尚未连接浏览器插件”“测试连接”“连接令牌”这些概念可以保留，因为它们描述的是 Obsidian 和浏览器插件之间是否连通，不等于要求用户在浏览器插件里手动开启连接。

### 4. 保持升级默认关闭

建议继续保持 `multiPlatformSync.enabled: false`。用户第一次看到这个能力时，由设置页的引导卡片说明：

- 免费版每天可以发布到 3 个平台。
- 先安装浏览器插件即可试用。
- 已购买 Pro 的用户可以直接查看配置步骤。

这比升级后默认开启更稳，也能减少用户误以为“Obsidian 已经自动配置好了所有平台”的误解。

### 5. 增加排序相关测试

Obsidian 侧建议补这些测试：

- `buildWechatsyncPlatformCatalog()` 在已连接且有 `supportedPlatforms` 时，使用浏览器插件返回顺序作为基础顺序。
- `buildWechatsyncPlatformCatalog()` 合并 `connection.platforms` 后，已登录平台排在未登录/未检测平台前面。
- 已登录分组和未登录分组内部都按热门顺序排序：小红书、知乎、微博、抖音图文、头条号、B 站、CSDN、语雀、简书、什么值得买。
- `buildWechatsyncPlatformCatalog()` 在未连接时，使用本地备用清单基础顺序，并全部标记为 `bridge_required`。
- 发布弹窗过滤已选平台后，仍保持 catalog 顺序。
- 结果弹窗 / 发布任务结果里的平台明细遵循同一套顺序；没有登录态时退化为基础热门顺序。

### 6. Obsidian 侧具体文件建议

建议优先改这些位置：

- `services/wechatsync-results.js`
  - 调整 `FALLBACK_WECHATSYNC_PLATFORMS` 的前 10 个顺序。
  - 增加 `FEATURED_WECHATSYNC_PLATFORM_ORDER`、`sortWechatsyncPlatformsForDisplay()` 之类的 helper。
  - 在 `buildWechatsyncPlatformCatalog()` 返回前统一排序。
- `services/wechatsync-settings.js`
  - 确认 `getAvailableWechatsyncPlatforms()` / `getConfiguredWechatsyncPlatforms()` 不再自行按选择时间、名称或 fallback 合并顺序重排。
- `views/settings/multi-platform-tab.js`
  - 平台选择器直接使用排序后的 catalog。
  - “读取所选平台登录状态”后保存 `connection.platforms`，下一次渲染应触发已登录优先。
- `views/publish-modal/multi-platform.js`
  - `displayedPlatforms = availablePlatforms.filter(...)` 这类过滤保留 catalog 顺序即可，不再重新排序。
- `input.js` 里的结果弹窗
  - `showWechatsyncEnqueueAcceptedModal()`、`showMultiPlatformSyncResultModal()` 如果展示逐平台结果，应按同一 catalog/platform order 展示；没有登录态时用基础热门顺序。

## 验收标准

浏览器插件侧：

- `listSupportedPlatforms` 返回常用平台优先的稳定基础顺序。
- 小红书、知乎、微博、抖音图文、头条号、哔哩哔哩、CSDN、语雀、简书、什么值得买排在长尾平台前面。
- 带登录状态的页面使用已登录优先；每个登录分组内部仍按热门平台优先。
- 新增未知平台时，会稳定追加在已知平台后面。

Obsidian 插件侧：

- 设置页和发布弹窗显示的平台顺序一致。
- 连接浏览器插件后，使用浏览器插件返回的顺序。
- 合并登录状态后，已登录平台显示在前；未登录/未检测平台显示在后。
- 未连接时，使用与产品基础优先级一致的本地备用顺序。
- 发布历史的单条任务平台列表遵循同一套排序；没有登录状态时退化为基础顺序。
- 文案不再暗示用户必须到浏览器插件中手动开启连接。

## 待确认问题

1. “其他平台（小红书/知乎/抖音等）”是否需要包含微博，目前建议不写微博，保持入口更聚焦。
2. 浏览器插件是否需要额外返回 `displayOrder` 字段。当前建议不需要，直接使用数组顺序即可，协议更简单。
