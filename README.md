# X Follower Badge

在 X（Twitter）的时间线、搜索结果和推文详情中，在 `@用户名` 后显示该用户的粉丝数。

当前版本：`1.1.4`。徽标挂载在“用户名 + 发布时间”的外层横排中，并校正缩小字体后的基线位置。

## 安装

1. 浏览器安装 Tampermonkey（油猴）。
2. 点击 [安装/更新脚本](https://raw.githubusercontent.com/Abelliuxl/x-follower-badge/main/x-follower-badge.user.js)。
3. 在油猴安装页面确认安装，然后刷新已登录的 X 页面。

脚本内已配置 `@updateURL` 和 `@downloadURL`。以后发布更高版本号后，油猴可以从 GitHub 检查更新。

如果没有显示，打开浏览器开发者工具的 Console，搜索 `[X Follower Badge]`。X 的网页内部 GraphQL 查询 ID 会不定期轮换；出现 `HTTP 400/404` 通常表示需要更新脚本中的 `QUERY_ID`。

## 原脚本为什么失效

- 它在请求开始前把容器标记为 `followersInjected=1`，请求成功后 `injectBadge()` 看到该标记就直接返回，因此永远不会创建徽标。
- `UserByScreenName` 的 GraphQL 查询 ID 是硬编码值，X 更新网页后旧 ID 会失效。
- 缺少登录态请求常用的 `x-csrf-token` 请求头。
- 把整条时间线单元格当作挂载位置，容易错位；X 的虚拟列表复用 DOM 后也可能把旧用户的状态留给新用户。
