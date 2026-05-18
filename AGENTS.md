# Bili Pin - AI Maintenance Guide

> 本文档是 AI 维护本项目的权威入口。每次开始任务前，必须先完整阅读 **第 2 章（必守规范）** 和 **第 4 章（功能模块速查）**；完成一个可验收改动后，必须更新 **第 6 章（当前状态）** 和被影响的相关章节。

## 1. 项目概览

**Bili Pin** 是一个 Bilibili Chrome MV3 浏览器扩展，使用 WXT + TypeScript 开发。它的目标是在 B 站网页版动态页提供更稳定的“置顶 UP 主”工作流，并把置顶入口扩展到搜索页、动态卡片、空间页、视频页和扩展弹窗。

### 当前核心功能

1. **动态页置顶栏**：在 `t.bilibili.com` 顶部插入置顶 UP 主头像栏；支持点击筛选 Feed、拖拽排序、纵向拉伸高度和栏内滚动。
2. **多页面置顶入口**：在动态推荐横条、动态卡片三点菜单、动态页 hover 用户资料卡、搜索用户结果、空间页和视频页“已关注”菜单中注入置顶/取消置顶入口。
3. **关注时间显示**：在 `space.bilibili.com` 的“全部关注”列表中显示精确关注时间。
4. **同步摘要弹窗**：点击扩展图标后展示置顶数量和最后同步时间，用于快速确认同步状态。

### 技术栈与命令

- **框架**：WXT `0.20.13`
- **语言**：TypeScript，ES Module
- **依赖**：`sortablejs`
- **常用命令**：
  - `npm run dev`：启动 WXT 开发服务器
  - `npm run typecheck`：运行 TypeScript 静态检查
  - `npm run build`：构建 Chrome MV3 产物到 `.output/chrome-mv3`
  - `npm run zip`：生成发布 zip

## 2. 必守规范

### 2.1 工作方式

- 先读现状，再改代码。优先用 `rg`、真实代码、已有文档、页面快照和用户提供的现象来建立证据链，不凭记忆猜 B 站 DOM。
- 实现必须直接、可靠、低开销。遇到历史补丁堆叠时，应在保持行为不变的前提下主动收敛和重构，避免继续叠补丁。
- 改动范围要贴着需求走。不要顺手重构无关模块，不要修改未涉及的发布产物和私人页面快照。
- 遇到用户或其他工具留下的未提交修改，必须先识别并保留；不要 `git reset`、`git checkout --` 或覆盖不属于本次任务的改动。

### 2.2 B 站页面与账号安全

- 开发 DOM 注入逻辑时，优先参考用户用 Chrome `cmd+s` 保存的真实页面快照，默认位置是 `pages/` 或 `docs/pages/`。这两个目录被 `.gitignore` 忽略，只能作为本地调试资料。
- 页面快照可能包含账号、关注列表、搜索词、Cookie 痕迹或其它隐私信息。禁止提交、整理、复制或在文档中摘录其中的个人内容。
- 选择器最终必须落到稳定语义上：优先使用真实 `mid`、`space.bilibili.com/{mid}` 链接、原生按钮容器、局部 popover 根节点和页面功能结构；不要把一次快照里的临时 class 或个人数据硬编码进代码。
- 登录态 Chrome / Bilibili 页面只能用于轻量观察：hover 浮层、视觉状态、鼠标状态、异步列表刷新等。Computer Use 不是 DevTools DOM API，不能替代 HTML 快照或 outerHTML。
- 任何可能改变账号、内容或社交关系的动作，都必须先获得用户明确许可，包括关注/取消关注、置顶/取消置顶、点赞、投币、收藏、发消息和投稿相关操作。未获许可时只做观察、滚动、hover、截图级别动作。

### 2.3 架构不变量

- `MAIN` world 业务代码不能直接依赖 `chrome.storage`。存储读写统一走 `src/storage/config.ts`；`config.ts` 在当前 world 暴露 `chrome.storage` 时可直接使用，否则必须通过 `src/utils/bridgeClient.ts` 访问 `entrypoints/storageBridge.content.ts`。
- `chrome.storage.sync` 是跨设备配置的权威存储，`chrome.storage.local` 只作为同机镜像和升级回退。升级迁移必须先读旧 local，再写 sync，禁止用空 sync 覆盖已有 local 数据。
- 持久化 UP 唯一标识只能使用真实数字字符串 `mid`。头像 hash、昵称、DOM 位置只能用于辅助反查，不能作为持久化主键。
- API 拦截只允许处理项目真正依赖的 B 站接口：`portal`、`uplist`、`feed`、`relation/followings`、`relation/fans`、`relation/tag`。不要扩大到全站 API 解析。
- 样式通过 JS 动态插入 `<style>` 标签，不在 manifest 里声明内容脚本 CSS，避免影响 Dark Reader 等插件。
- 项目版本号单一真源是 `package.json`。`wxt.config.ts` 的 manifest 版本必须读取 `package.json`，禁止另写一份。

### 2.4 性能与长期运行

- MutationObserver 必须窄范围、可断开、幂等。优先监听具体列表容器或 `body` 直接子节点；只有在等待根节点出现时才短暂监听更大范围。
- 频繁 DOM 变化必须用 `requestAnimationFrame`、microtask 或显式队列合并，避免每个 mutation 都重扫整页。
- teleport 到 `body` 的菜单/popover 要按节点生命周期清理 observer。节点移除时必须断开对应观察器。
- 全局监听器和 monkey patch 必须有单例保护。重复进入 SPA 页面时不得重复 wrap `fetch` / XHR 或重复安装全局事件。
- 网络请求错误必须保持页面原语义。拦截器不得因为自身异常导致真实请求重试或被吞掉。

### 2.5 版本与文档

- 大功能变更提升第二位版本号，如 `v1.3.0`；小功能和 bugfix 提升第三位版本号，如 `v1.2.1`。
- 同一批未发版改动中的返工、回归修复和 UI 收敛，不额外提升版本号；把记录合并为该目标版本的最终说明。
- 纯文档、注释或开发流程更新默认不改版本号。
- 改版本号时必须同步 `package.json`、`package-lock.json` 和本文档第 6 章，并在 `npm run build` 后确认 `.output/chrome-mv3/manifest.json` 的 `version` 与 `package.json` 一致。
- 每次完成可验收改动后，更新第 6 章：写清日期、改动点、涉及文件、验证方式；同时删除或修正过时描述。

### 2.6 验证底线

- TypeScript 或运行时代码变更后，至少运行 `npm run typecheck`；涉及 manifest、构建配置、入口匹配或发布包时还要运行 `npm run build`，必要时运行 `npm run zip`。
- DOM 注入逻辑变更后，要用页面快照、DevTools outerHTML 或登录态页面观察做选择器依据；只靠静态类型检查不算完整验证。
- 存储、同步、版本号、升级迁移相关变更必须覆盖 sync/local 读写方向和空数据/旧数据回退场景。

## 3. 核心架构

### 3.1 Content Script Worlds

| 入口 | 匹配页面 | world | 主要职责 |
|------|----------|-------|----------|
| `entrypoints/content.ts` | `https://t.bilibili.com/*` | `MAIN` | 注入样式，尽早初始化 API 拦截，安装调试桥，注入动态页置顶栏、推荐横条按钮、动态卡片菜单项、hover 用户资料卡按钮。 |
| `entrypoints/search.content.ts` | `https://search.bilibili.com/*` | `MAIN` | 注入搜索用户结果置顶按钮，不拦截 API。 |
| `entrypoints/space.content.ts` | `https://space.bilibili.com/*` | `MAIN` | 注入样式，初始化 relation API 缓存，安装关注时间显示和空间页“已关注”菜单置顶项。 |
| `entrypoints/video.content.ts` | `https://www.bilibili.com/video/*` | `MAIN` | 读取 `window.__INITIAL_STATE__` 和 DOM，注入视频页“已关注”菜单置顶项，不拦截 API。 |
| `entrypoints/storageBridge.content.ts` | 动态页、搜索页、空间页、视频页 | `ISOLATED` | 代理 `chrome.storage.local/sync`，并把 `storage.onChanged` 转发给 MAIN world。 |

### 3.2 数据流

- UI 操作统一调用 `src/storage/pins.ts` 的 `pinUp`、`unpinUp`、`setPinnedUps`、`isPinned`。
- `pins.ts` 负责把置顶列表规范化为 `mid` 主键，维护排序、更新时间和删除墓碑，再通过 `src/storage/config.ts` 双写 sync/local。
- `config.ts` 优先使用当前 world 可用的 `chrome.storage`，不可用时经 `bridgeClient.ts` 访问 storage bridge。
- `onPinsChange` 订阅 storage 变化后通知所有已打开页面，动态页置顶栏、菜单项和按钮状态都必须跟着刷新。
- `src/bili/apiInterceptor.ts` 缓存 `mid -> { name, face, has_update }`、头像 hash 映射和 `mid -> mtime`。这些缓存只服务于页面运行时，不替代持久化数据。
- Feed 切换由 `src/bili/feedSwitch.ts` 和 `src/bili/clickBridge.ts` 协作完成。目标 UP 不在推荐横条时，通过 `setDesiredHostMid` 让 API 拦截器改写后续 `feed/*` 请求的 `host_mid`。

### 3.3 调试入口

- `src/bili/debugFlag.ts`：读取 `localStorage.biliPin.debug`。
- `src/bili/debugBridge.ts`：调试模式下暴露 `window.__biliPin.dump()` 和 `window.__biliPin.cache()`。
- `public/popup.js`：读取 storage 摘要，显示头像数量和最后同步时间。

## 4. 功能模块速查

| 功能 | 入口文件 | 核心文件 | 维护要点 |
|------|----------|----------|----------|
| 动态页置顶栏与 Feed 切换 | `entrypoints/content.ts` | `src/ui/injectPinButtons.ts`、`src/ui/pinBar.ts`、`src/bili/feedSwitch.ts`、`src/bili/clickBridge.ts` | `pinBar` 负责 DOM、拖拽排序、高度拉伸和高度持久化；`injectPinButtons` 负责推荐横条按钮、置顶栏刷新编排和高亮状态；Feed 切换必须保留“推荐栏内原生点击”和“不在推荐栏时改写 `host_mid`”两条路径。 |
| 推荐横条图钉按钮 | `entrypoints/content.ts` | `src/ui/injectPinButtons.ts`、`src/bili/observe.ts`、`src/bili/selectors.ts` | 推荐列表定位集中在 `selectors.ts`；优先用 `.bili-dyn-up-list__window`，兜底才使用 space 链接启发式。按钮 mid 来自 portal/uplist 缓存，拿不到时禁用并等待缓存事件重刷。 |
| 动态卡片三点菜单 | `entrypoints/content.ts` | `src/ui/dynamicMoreMenuPin.ts` | 菜单 DOM 常在 hover 后生成。只 hook 动态列表项的 more 按钮，短重试注入；菜单项必须克隆原生项以继承 scoped 样式。 |
| 动态页 hover 用户资料卡 | `entrypoints/content.ts` | `src/ui/dynamicUserProfilePin.ts` | `.bili-user-profile` 通常 teleport 到 `body` 下；监听 `body` 直接子节点新增/移除并清理 profile observer；从资料卡 space 链接提取真实 mid。 |
| 搜索页用户结果置顶 | `entrypoints/search.content.ts` | `src/ui/searchUserPin.ts` | 支持 `.b-user-video-card` 和 `.b-user-info-card`；在 `.user-actions` 中追加按钮；克隆原生按钮时必须清理 disabled 状态和 `vui_button--disabled`。 |
| 空间页“已关注”菜单 | `entrypoints/space.content.ts` | `src/ui/spaceFollowMenuPin.ts` | 菜单弹层是 `.vui_popover`；空间 owner 默认取 URL mid，关注列表项通过最近 hover 的 space 链接推断 mid。列表项和 header 菜单不要串 mid。 |
| 视频页“已关注”菜单 | `entrypoints/video.content.ts` | `src/ui/videoFollowMenuPin.ts` | 优先读 `window.__INITIAL_STATE__.videoData.owner`，DOM 兜底；hook `.van-popover.van-popper` 并在 popover 移除时断开 observer。 |
| 关注时间显示 | `entrypoints/space.content.ts` | `src/ui/followTime.ts`、`src/bili/apiInterceptor.ts` | 关注时间来自 relation 接口缓存的 `mid -> mtime`；优先绑定关注列表容器，不要长期高频观察整页 body subtree。 |
| 数据同步与状态管理 | `entrypoints/storageBridge.content.ts` | `src/storage/pins.ts`、`src/storage/config.ts`、`src/storage/keys.ts`、`src/utils/bridgeClient.ts` | sync 为权威，local 为镜像；storage bridge 只允许 `STORAGE_BRIDGE_ALLOWED_KEYS` 中的 `biliPin.*` key。 |
| 样式与提示 | 所有页面入口 | `src/styles/content.css`、`src/utils/style.ts`、`src/ui/toast.ts` | 样式由入口文件 inline 注入；新增 UI class 应集中在 `content.css`，避免散落大量 inline 样式。 |
| 扩展弹窗 | `public/popup.html` | `public/popup.js`、`src/storage/keys.ts` | MV3 禁止内联脚本；弹窗只做同步摘要，不承担复杂配置。 |

## 5. 调试与验证

### 5.1 调试工具

1. 在目标 B 站页面 DevTools 执行：
   ```js
   localStorage.setItem('biliPin.debug', '1')
   ```
2. 刷新页面后可执行：
   ```js
   window.__biliPin.dump()
   window.__biliPin.cache()
   ```
3. 调试完成后关闭：
   ```js
   localStorage.removeItem('biliPin.debug')
   ```

### 5.2 页面证据优先级

1. 运行态登录页面观察：确认真实 hover、弹层、视觉状态和异步刷新。
2. 本地 HTML 快照或 DevTools outerHTML：确认 DOM 层级、稳定选择器和真实 mid 来源。
3. 代码中的选择器集中点：优先改 `src/bili/selectors.ts` 或对应 UI 模块的局部选择器。
4. 静态类型检查和构建：确认 TypeScript、WXT manifest 和产物没有回归。

### 5.3 验收清单

- [ ] 动态页置顶栏显示正常，拖拽排序和高度拉伸可用。
- [ ] 点击置顶头像能切换 Feed，无论目标 UP 是否在推荐横条。
- [ ] 动态推荐横条、动态卡片三点菜单、hover 用户资料卡、搜索用户结果、空间页菜单、视频页菜单的置顶状态能互相同步。
- [ ] 空间页“全部关注”列表显示正确关注时间。
- [ ] 刷新页面后置顶列表、排序和置顶栏高度不丢失。
- [ ] 升级旧数据时，local 配置能迁移到 sync，空 sync 不会覆盖已有 local。
- [ ] 长时间停留动态页或视频页时，observer、缓存和 popover 生命周期没有持续增长风险。

## 6. 当前状态

**当前版本：`v1.2.0`**，版本号来自 `package.json`，manifest 版本由 `wxt.config.ts` 自动读取。

### 当前实现状态

- 动态页置顶栏、推荐横条按钮、动态卡片三点菜单、动态页 hover 用户资料卡、搜索用户结果、空间页/视频页关注菜单、关注时间显示和扩展弹窗均已实现。
- 存储模型已收敛为 `chrome.storage.sync` 权威 + `chrome.storage.local` 镜像；置顶列表使用 v2 状态结构，包含排序、更新时间和删除墓碑。
- API 拦截范围已收窄到项目依赖接口，缓存有上限；fetch 真实网络错误保持页面原语义，XHR 使用 `loadend` 旁路读取响应。
- 主要长期运行风险已做过收敛：推荐横条刷新合并到帧、动态三点菜单短重试、关注时间列表级观察、视频 popover observer 清理、资料卡 body 直接子节点观察。

### 最近维护记录（不改版本号）

- `2026-05-18`：按 commit skill 标准做项目级收尾检查，不只检查未提交 diff；全仓库扫描旧口径、临时残留、调试残留和版本一致性后，将内部动态页 mid 相关命名从早期 `uid` 收敛为 `mid`，并移除 `filterFeedDirectly` 不再使用的 name/face 参数。保留 B 站接口响应中的 `mid ?? uid` 兼容读取，不改变存储 schema、用户数据或运行行为。本次为内部命名与维护性收口，不提升版本号。涉及文件：`src/bili/selectors.ts`、`src/bili/clickBridge.ts`、`src/ui/injectPinButtons.ts`、`src/ui/pinBar.ts`、`AGENTS.md`。验证：`npm run typecheck`、`npm run build`、`git diff --check` 通过；`.output/chrome-mv3/manifest.json` 的 `version` 与 `package.json` 一致为 `1.2.0`。
- `2026-05-18`：重写 `AGENTS.md` 为当前维护手册，压缩早期流水账式版本记录，明确工作方式、账号安全边界、架构不变量、性能约束、功能模块速查和验收路径；同步修正 `README.md`、`docs/prd.md`、`docs/roadmap.md` 中关于搜索页、动态页 hover 用户资料卡和当前版本的旧口径。本次仅改文档，不修改运行时代码，不提升版本号。涉及文件：`AGENTS.md`、`README.md`、`docs/prd.md`、`docs/roadmap.md`。验证：人工核对入口文件、storage、API 拦截和主要 UI 模块；`git diff --check` 通过；未运行构建，因本次无代码变更。
- `2026-04-28`：补充页面快照与 Computer Use 边界。AI 可读取 `pages/` / `docs/pages/` 中的私有 HTML 作为 DOM 依据，但禁止提交或摘录个人内容；Computer Use 只用于轻量观察，不能替代 DOM 证据。
- `2026-04-23`：核对并修正仓库 Markdown 文档中关于置顶栏、存储方案、模块拆分和运行环境的过时描述；同步重写 `docs/prd.md` 为当前实现说明。

### 最近发布摘要

- `v1.2.0`：正式合并动态页 hover 用户资料卡置顶入口、搜索页用户结果置顶入口、搜索页 storage bridge 匹配、按钮禁用态清理、置顶按钮视觉收敛，以及页面快照 / Computer Use 开发流程文档。
- `v1.1.7`：新增搜索页用户结果置顶入口，支持综合搜索和用户 Tab 的用户卡片。
- `v1.1.6`：新增动态页头像/昵称 hover 用户资料卡置顶入口。
- `v1.1.5`：收紧 fetch / XHR API 拦截实现，避免扩展导致重复请求或覆盖页面回调。
- `v1.1.4`：收敛长期运行相关 observer 和刷新链路，降低动态页、空间页、视频页长时间停留风险。
- `v1.1.3`：修复置顶栏高度持久化问题，并将 manifest 版本号改为读取 `package.json`。
- `v1.1.0` - `v1.1.2`：完成 sync/local 同步模型、弹窗摘要、固定扩展 ID、置顶栏可拉伸高度和高度持久化。
- `v1.0.0` - `v1.0.4`：完成首版核心功能、权限收窄、API 缓存上限、SPA 单例保护和视频页 OOM 修复。

### 相关文档

- `docs/prd.md`：项目目的、背景、当前结构与实现方式。
- `docs/roadmap.md`：历史版本和未来规划；若产品能力或版本计划变化，需要同步更新。

## 7. 快速目录

```text
entrypoints/
  content.ts                 # 动态页 MAIN world 入口
  search.content.ts          # 搜索页 MAIN world 入口
  space.content.ts           # 空间页 MAIN world 入口
  video.content.ts           # 视频页 MAIN world 入口
  storageBridge.content.ts   # ISOLATED world storage bridge
public/
  popup.html                 # 扩展弹窗结构
  popup.js                   # 同步摘要逻辑
config/
  manifest-key.txt           # 固定扩展 ID 用的 public manifest key
src/
  bili/
    apiInterceptor.ts        # API 拦截、UP 信息缓存、关注时间缓存、host_mid 改写
    clickBridge.ts           # 动态页 Feed 切换触发
    debugBridge.ts           # 调试入口
    debugFlag.ts             # 调试开关
    faceKey.ts               # 头像 URL hash 提取
    feedSwitch.ts            # 动态页筛选切换逻辑
    observe.ts               # 推荐横条根节点观察
    selectors.ts             # 动态页选择器与诊断
  storage/
    config.ts                # sync/local 读写、迁移、镜像与变更监听
    keys.ts                  # storage key 白名单
    pins.ts                  # 置顶列表、排序、墓碑和状态通知
  styles/
    content.css              # 内容脚本样式
  ui/
    dynamicMoreMenuPin.ts    # 动态卡片三点菜单置顶项
    dynamicUserProfilePin.ts # 动态页 hover 用户资料卡置顶按钮
    followTime.ts            # 空间页关注时间显示
    injectPinButtons.ts      # 推荐横条按钮与置顶栏刷新编排
    pinBar.ts                # 置顶栏渲染、排序、高度持久化
    searchUserPin.ts         # 搜索用户结果置顶按钮
    spaceFollowMenuPin.ts    # 空间页关注菜单置顶项
    toast.ts                 # 页面提示
    videoFollowMenuPin.ts    # 视频页关注菜单置顶项
  utils/
    bridgeClient.ts          # MAIN world storage bridge 客户端
    style.ts                 # 动态注入 style 标签
```
