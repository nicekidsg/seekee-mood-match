# Seekee Music Tab · 轻量情境推荐 Demo

这个版本把原仓库的“落地页 + 三步问卷 + 结果页 + 外跳 YouTube”重构成 PRD v1.1 的 App 内轻量入口：用户进入 Music Tab 后，从每次会话随机展示的 6 个 One Tap 分类中任选一个，即在当前页面用 YouTube IFrame Player API 加载并播放现有歌单。

## 本地运行

必须通过 HTTP 运行，不能直接双击 `index.html`。HTTP 页面会给 YouTube 播放器提供所需的 `Referer` 和 `origin`。

```bash
npm run serve
```

然后访问 `http://127.0.0.1:8000`。

可用于 QA 的 URL 参数：

- `?lang=es|pt|en`：模拟 App 语言，不在界面显示语言切换器。
- `?country=MX|BR|CO`：模拟国家配置。
- `?feature=off`：验证远程关闭后原 Music Tab 内容仍保留。
- `?group=control|treatment`：验证实验分组。

## 测试

```bash
npm test
```

测试覆盖完整歌单目录、随机分类、稳定抽样、候选过滤、primary → fallback 顺序，以及两步辅助流程的意图解析。

## PRD v1.1 对照

- 已实现：One Tap 从 16 个分类中稳定随机展示 6 个，保持 2 列 × 3 行；默认路径一次点击即请求播放。
- 已实现：“帮我选”最多两步，第二步点击后直接播放；无曲风页、确认页或推荐结果页。
- 已实现：ES/PT/EN 随浏览器/App 语言；界面无语言选择器。
- 已实现：恢复原仓库全部 622 个 YouTube Music 歌单；分类推荐和 Top right now 都从完整目录稳定随机抽取，并保留 2 个 primary + 1 个 fallback。
- 已实现：`IDLE → REQUESTING → PLAYING` 与 `REQUESTING → FALLBACK → PLAYING / ERROR` 状态。
- 已实现：`music_tab_impression`、`intent_module_view`、`intent_click`、`play_request`、`play_start`、`play_fail`、`play_30s`、`play_3m`、`first_track_skip`、`refine_click`、`shuffle_click` 等事件；`play_start` 只由 `YT.PlayerState.PLAYING` 回调产生。
- 已实现：离线、请求超时、播放器错误、fallback、全部失败、重复点击节流、Feature Flag 与实验组。
- 已实现：Top right now 每次会话从完整歌单目录随机展示 3 个；底部导航仅保留 Music。
- 接口依赖：这是纯 Web demo，事件目前写入 `window.__SEKEE_EVENTS__` 并发出 `seekee:analytics` 事件；接入 Android App 时需替换为现有 AnalyticsAdapter。

## YouTube IFrame 合规实现

- 播放器视口始终至少 `200 × 200px`；在宽屏 demo 容器中是官方推荐的 `480 × 270px`、16:9。
- 自动播放只由明确的意图点击触发，并在播放器滚入屏幕且超过 50% 可见后发起。
- 页面只创建一个 YouTube 播放器，不同时自动播放多个实例。
- 使用原生 YouTube 控件；播放器上方没有遮罩、浮层或自定义框架，也不拦截其触控事件。
- 使用 `controls=1`、`playsinline=1`、`fs=1`、`listType=playlist`、`origin`，并设置 `strict-origin-when-cross-origin`。
- 处理 `onError` 与 `onAutoplayBlocked`；浏览器拦截自动播放时，提示用户在原生播放器内点击播放。

参考：[YouTube IFrame Player API](https://developers.google.com/youtube/iframe_api_reference)、[Player Parameters](https://developers.google.com/youtube/player_parameters)、[Required Minimum Functionality](https://developers.google.com/youtube/terms/required-minimum-functionality)。

若播放器显示 YouTube 的登录或“确认不是机器人”提示，这是 YouTube 的反滥用校验；demo 不遮挡、不替换也不绕过该界面。请在正常浏览器/网络中完成 YouTube 要求的验证后重试。

### Android WebView 接入注意

正式 App 若把此页面作为本地 HTML 加载，必须用 Android `WebView.loadDataWithBaseURL(...)` 设置基于真实包名/App ID 的 HTTPS base URL，从而向 YouTube 提供有效 `Referer`；否则播放器可能返回错误 `153`。真实包名未出现在仓库中，因此这一项需要在 Seekee Android 宿主工程中完成。
