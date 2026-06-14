> **提示**：本文件用于基于当前实现，简要说明项目的目的、背景、结构与功能模块。更细的开发约束、版本记录与验收要求请看根目录的 **`AGENTS.md`**。

# Bili Pin（PRD）
一个 Bilibili 专用的 Chrome 浏览器扩展，主要目标是在网页版动态页提供“置顶 UP 主”能力，并把相关快捷入口与信息补充延伸到搜索页、空间页、视频页和扩展弹窗中。

## 背景
- **解决痛点**: 在 B 站动态页，用户经常会感觉自己在某段时间错过了一些低频更新的宝藏 UP 主的视频，且这些 UP 主的头像不会出现在 B 站原生的动态推荐里。为了解决“久而久之忘记关注过谁”的问题，本插件允许用户将最关心的 UP 主头像置顶到动态首页，点击即可快速查看其动态 Feed 流。

## 当前功能模块

### 1. 动态页置顶栏
- 在 `t.bilibili.com` 顶部插入置顶 UP 主头像栏。
- 支持点击头像快速切换到对应 UP 的动态 Feed。
- 支持拖拽排序。
- 支持纵向拉伸高度，超出后在栏内滚动浏览。
- 高度与置顶列表都会持久化，刷新后保持上次状态。

### 2. 全站置顶入口
- 动态页推荐横条头像右上角提供图钉按钮。
- 动态卡片“三点菜单”中注入“置顶UP主 / 取消置顶”。
- 动态页头像 / 昵称 hover 出现的用户资料卡中注入置顶按钮。
- 搜索页综合结果和用户 Tab 的用户卡片中注入置顶按钮。
- 空间页“已关注”悬停菜单中注入置顶项。
- 视频页“已关注”悬停菜单中注入置顶项。

### 3. 动态页 Feed 切换
- 当目标 UP 本来就在推荐横条里时，直接复用 B 站原生点击切换。
- 当目标 UP 不在推荐横条里时，拦截动态页的目标接口请求并改写 `host_mid`，让页面仍然沿用 B 站自己的渲染链路显示该 UP 的 Feed。
- 用户重新点击推荐横条或 Tabs 时，会退出这种“劫持后的筛选态”，回到原生动态页状态。

### 4. 关注时间显示
- 在空间页“全部关注”列表中，为每个关注对象补充精确关注时间。
- 关注时间来自 relation 接口缓存的 `mid -> mtime` 映射，不依赖脆弱的 DOM 文本解析。

### 5. 同步摘要弹窗
- 点击扩展图标后，弹窗展示当前头像数量和最后同步时间。
- 这个弹窗的目标不是做复杂配置，而是快速确认同步状态是否收敛。

## 当前项目结构

### 页面入口
- `entrypoints/content.ts`
  - 动态页入口。
  - 负责初始化样式、API 拦截、推荐横条图钉按钮、置顶栏、动态卡片菜单和 hover 用户资料卡注入。
- `entrypoints/search.content.ts`
  - 搜索页入口。
  - 负责为综合搜索和用户搜索结果中的用户卡片注入置顶按钮，不拦截 API。
- `entrypoints/space.content.ts`
  - 空间页入口。
  - 负责初始化样式、relation 缓存、关注时间显示和空间页“已关注”菜单注入。
- `entrypoints/video.content.ts`
  - 视频页入口。
  - 负责初始化样式，并在视频页“已关注”菜单中注入置顶项。
- `entrypoints/storageBridge.content.ts`
  - `ISOLATED` world 下的 storage bridge。
  - 为 `MAIN` world 中的代码代理 `chrome.storage.local` / `chrome.storage.sync` 访问。

### 核心模块
- `src/ui/pinBar.ts`
  - 置顶栏 DOM 渲染、拖拽高度调整、高度持久化。
- `src/ui/injectPinButtons.ts`
  - 动态页推荐横条图钉按钮注入。
  - 置顶栏刷新编排。
  - 与动态页 Feed 切换逻辑联动。
- `src/ui/dynamicMoreMenuPin.ts`
  - 动态卡片“三点菜单”注入。
- `src/ui/dynamicUserProfilePin.ts`
  - 动态页 hover 用户资料卡置顶按钮注入。
- `src/ui/searchUserPin.ts`
  - 搜索页用户结果置顶按钮注入。
- `src/ui/spaceFollowMenuPin.ts`
  - 空间页“已关注”菜单注入。
- `src/ui/videoFollowMenuPin.ts`
  - 视频页“已关注”菜单注入。
- `src/ui/followTime.ts`
  - 空间页关注时间展示。

### B 站交互与缓存
- `src/bili/apiInterceptor.ts`
  - 只拦截项目真正依赖的 `portal`、`uplist`、`feed`、`relation` 接口。
  - 缓存 UP 主 `mid / name / face / has_update` 信息。
  - 缓存关注时间 `mid -> mtime`。
- `src/bili/feedSwitch.ts`
  - 负责动态页内的推荐横条点击、全部动态回切和“目标 UP 不在推荐栏中”时的切换策略。
- `src/bili/observe.ts`
  - 负责在动态页定位推荐 UP 横条，并适配 B 站 SPA / 异步渲染带来的 DOM 变化。
- `src/bili/selectors.ts`
  - 集中维护动态页推荐横条定位、space 链接解析和调试诊断。

### 数据与同步
- `src/storage/pins.ts`
  - 管理置顶列表、排序、删除墓碑、v3 压缩同步状态、旧状态兼容迁移和响应式通知。
- `src/storage/config.ts`
  - 管理 `sync` / `local` 双端读写、迁移、镜像写入、同步容量提示和变更监听。
- `src/storage/keys.ts`
  - 统一定义 storage key。
- `src/utils/bridgeClient.ts`
  - `MAIN` world 访问 storage bridge 的客户端通信实现。

## 当前实现方式
- 纯前端实现，无后端服务。
- 数据以 `chrome.storage.sync` 为主存储，并镜像写入 `chrome.storage.local` 作为同机回退与迁移兼容；置顶列表优先使用压缩 v3 状态，并保留 v2/v1 兼容读取。
- 动态页和空间页运行在 `MAIN` world，以便尽早拦截页面自身发起的 XHR / Fetch。
- 搜索页运行在 `MAIN` world，但当前不拦截 API，只基于结果卡片中的 space 链接提取真实 `mid`。
- 视频页也运行在 `MAIN` world，但当前主要依赖 `window.__INITIAL_STATE__` 和原生 DOM，不额外拦截 API。
- 样式通过 JS 动态插入 `<style>` 标签，而不是通过 manifest 直接声明内容脚本 CSS，以减少和页面样式、Dark Reader 之类插件的相互干扰。
- 菜单注入优先克隆 B 站原生菜单项，尽量保持原站样式、hover 行为和 scoped 属性兼容。
