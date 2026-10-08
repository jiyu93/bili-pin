# Bili Pin 维护指南

开始任务前完整阅读第 2、4 章；完成可验收改动后更新第 6 章及受影响文档。

## 1. 项目与命令

Bilibili Chrome MV3 扩展，使用 WXT + TypeScript + SortableJS，无后端。产品行为见 [PRD](docs/prd.md)，安装方式见 [README](README.md)，版本历史见 [roadmap](docs/roadmap.md)。

- `npm run dev`：开发服务器。
- `npm run typecheck`：TypeScript 检查。
- `npm run build`：构建到 `.output/chrome-mv3`。
- `npm run zip`：生成发布包。

## 2. 必守规范

### 工作方式与账号边界

- 先检查 `git status`，用 `rg` 和真实代码核对现状；保留用户未提交改动，不重置或覆盖，不顺手改无关模块及产物。实现应直接、可靠、低开销，相关历史补丁能收敛就收敛。
- 页面调查与注入逻辑调试优先使用 Codex 内置浏览器，复用其中的 B 站登录态，流程见第 5 章；不默认控制外部 Chrome，不凭记忆猜 DOM，不要求用户预先保存 HTML。
- 查看页面、导航、滚动、hover、检查 DOM 和诊断信息可直接进行。置顶/取消置顶会写跨设备配置；与关注/取消关注、点赞、投币、收藏、发消息、投稿一样，需要用户明确授权；已有授权不重复确认。
- 页面、DOM、控制台、请求和存储可能含个人信息，只读取任务所需部分，不提交或在文档中摘录账号内容、Cookie、令牌及关注列表。`pages/`、`docs/pages/` 的旧快照仅作可选本地补充，保持忽略，不整理或复制个人内容。

### 架构不变量

- 存储统一经 `src/storage/config.ts`：当前 world 有 `chrome.storage` 时直接访问，否则经 `bridgeClient.ts` → `storageBridge.content.ts`。MAIN 业务模块不得直接依赖 `chrome.storage`；bridge 只放行 `STORAGE_BRIDGE_ALLOWED_KEYS`。
- `chrome.storage.sync` 为置顶数据权威，local 只做镜像及旧数据迁移。置顶写入先做 sync 配额预检，成功写 sync 后再镜像 local；超限拒绝并提示，禁止 local-only 绕过。仅 sync 无可用置顶数据时读取旧 local。
- 持久化主键只用真实数字字符串 `mid`；头像 hash、昵称和 DOM 位置仅用于辅助识别。API 缓存只补全运行时渲染，不在刷新时自动写回置顶数据。
- API 拦截仅限 `portal`、`uplist`、`feed`、`relation/followings`、`relation/fans`、`relation/tag`；自身异常不得重试或吞掉真实网络请求，也不得覆盖页面回调。
- 样式集中在 `src/styles/content.css`，由 JS 插入 `<style>`；不在 manifest 声明内容脚本 CSS。MV3 弹窗脚本独立成文件。
- 版本唯一来源是 `package.json`，`wxt.config.ts` 从中读取 manifest 版本。

### 性能与生命周期

- Observer 窄范围、幂等、可断开：优先列表容器或 body 直接子节点，仅等待根节点时短暂扩大范围；频繁刷新合并到帧、microtask 或队列。
- teleport 菜单/popover 移除时清理对应 observer；缓存有上限，全局监听器和 fetch/XHR patch 有单例保护，SPA 重入不能重复安装。

## 3. 数据流

页面业务入口均为 MAIN；动态页和空间页拦截所需 API，搜索页和视频页不拦截。`entrypoints/storageBridge.content.ts` 在四类页面的 ISOLATED world 代理存储并转发变更。

UI → `pins.ts`（`pinUp` / `unpinUp` / `setPinnedUps` / `isPinned`）→ `config.ts` → sync / local。`onPinsChange` 通知所有打开页面刷新状态；置顶状态包含排序、更新时间及删除墓碑。

Feed 切换保留两条路径：推荐横条内复用原生点击；横条外用 `setDesiredHostMid` 改写后续 feed 请求的 `host_mid`，继续使用 B 站渲染链路。

## 4. 功能模块速查

以下路径相对仓库根目录；选择器以实时页面为准。

| 功能 / 入口 | 核心文件 | 维护要点 |
|---|---|---|
| 动态页 / `entrypoints/content.ts` | `src/ui/{injectPinButtons,pinBar}.ts`；`src/bili/{selectors,observe,feedSwitch,clickBridge}.ts` | 置顶栏、排序、高度持久化和 Feed 两条路径；推荐横条只接受 `main .bili-dyn-up-list > .bili-dyn-up-list__window`，加载时等待，不按空间链接猜容器；mid 来自 portal/uplist，缺失时禁用并等待缓存刷新。 |
| 动态卡片菜单 / 同上 | `src/ui/dynamicMoreMenuPin.ts` | 只 hook 卡片 more 按钮，短重试；克隆原生菜单项继承 scoped 样式。 |
| hover 资料卡 / 同上 | `src/ui/dynamicUserProfilePin.ts` | `.bili-user-profile` 挂在 body；从 space 链接取 mid，按节点生命周期清理 observer。 |
| 搜索页 / `entrypoints/search.content.ts` | `src/ui/searchUserPin.ts` | 支持 `.b-user-video-card`、`.b-user-info-card`，按钮放 `.user-actions`；克隆时清理 disabled 和 `vui_button--disabled`。 |
| 空间页 / `entrypoints/space.content.ts` | `src/ui/{spaceFollowMenuPin,followTime}.ts` | `.vui_popover`；header 取 URL mid，关注列表取最近 hover 的 space 链接，不能串用户；关注时间来自 relation 缓存 `mid → mtime`。 |
| 视频页 / `entrypoints/video.content.ts` | `src/ui/videoFollowMenuPin.ts` | 优先 `window.__INITIAL_STATE__.videoData.owner`，DOM 兜底；`.van-popover.van-popper` 移除时清理 observer。 |
| 存储与同步 | `src/storage/{pins,config,keys}.ts`、`src/utils/bridgeClient.ts` | v3 压缩写入，兼容 v2/v1；sync 权威、配额预检、local 镜像、空 sync 迁移。 |
| API / 样式 / 弹窗 | `src/bili/apiInterceptor.ts`；`src/styles/content.css`、`src/utils/style.ts`、`src/ui/toast.ts`；`public/popup.{html,js}` | API 缓存有界；头像 URL 规范化见 `src/utils/faceUrl.ts`；弹窗仅展示置顶数量和最后同步时间。 |

## 5. 内置浏览器调试与验证

1. 通过浏览器工具绑定内置浏览器（`iab`）中的目标 B 站标签，确认页面及登录状态；优先复用相关标签，新页面也在内置浏览器打开。复用已保存的登录态，不导出 Cookie 或复制到其它浏览器；登录过期时由用户重新登录。
2. 使用实时 DOM 快照定位元素，通过 locator 和只读 DOM 查询检查局部结构、链接、属性及 outerHTML，配合 hover、滚动和截图确认异步菜单/资料卡行为。截图和可访问性树只辅助观察，精确选择器以真实 DOM 为依据；不默认保存整页 HTML。
3. 按工具实际开放的能力调试：先阅读能力说明，再使用控制台日志接口或 CDP 检查运行时、执行页面脚本及观察相关请求。普通 DOM evaluate 仅用于只读查询；执行或注入代码走允许的开发接口，不假设所有 CDP 命令都可用。调试桥已安装时可用 `window.__biliPin.dump()` / `cache()`；开关为 `localStorage.biliPin.debug`，结束后恢复原值及临时注入状态。搜索页未安装调试桥。
4. 内置浏览器界面支持加载未打包扩展，但当前 Agent 工具不支持 `Extensions.loadUnpacked`，且禁止访问 `chrome://extensions`；这是自动化接口限制，不是浏览器不支持扩展，不绕过限制。先 `npm run build`，由用户在内置浏览器“扩展程序 → 管理扩展程序”开启开发者模式，选择“加载未打包的扩展程序”，加载本项目 `.output/chrome-mv3`，随后刷新 B 站页面。Agent 再检查实际注入、storage bridge 及错误；有 B 站登录态不等于扩展已加载或跨设备 sync 可用。
5. 修改后运行相应检查并更新构建产物，需要重载时由用户在扩展管理页操作，Agent 刷新目标页面并确认新代码生效，再复现受影响行为。无法加载扩展时才考虑开发注入及临时存储替身，并明确它们不能证明真实 MV3、sync/local、跨设备同步、弹窗或 `document_start` 行为，也不能接入正式存储兜底。账号操作遵守第 2 章授权边界；不自动转去控制外部 Chrome，能力不足时列明未验证项。

验证底线：运行时代码改动至少 `npm run typecheck`；manifest、构建配置、入口匹配、版本或发布包改动还需 `npm run build`，发布需要时运行 `npm run zip`。DOM 改动要有实时结构证据和页面行为验证；存储/同步/迁移改动覆盖 sync/local 方向、空数据和旧数据回退。纯文档改动检查链接、口径及 `git diff --check`，无需构建。

## 6. 当前状态与维护记录

当前版本 **v1.2.2**（以 `package.json` 为准）。

- PRD 所列功能均已实现；置顶数据使用 v3 压缩状态，兼容 v2/v1，sync 超限快速拒绝并提示；历史头像规范化为 HTTPS。
- API 拦截范围与缓存已收敛，XHR 使用 `loadend` 旁路读取；推荐横条刷新、列表观察及 popover 生命周期已有清理机制，改动时保持这些约束。
- `2026-10-08`：精简维护指南和 PRD，采用内置浏览器调试；用户通过管理界面加载/重载本地扩展，Agent 接手页面验证，修正把自动化接口限制等同于浏览器能力限制的结论。涉及 `AGENTS.md`、`docs/prd.md`、`README.md`、`docs/roadmap.md`。验证：`npm run build`、manifest 版本核对（1.2.1）、文档链接及 `git diff --check` 通过；用户加载后，确认动态页样式/置顶栏/图钉按钮/菜单 hook 及 API 拦截已注入，头像加载正常，MAIN → ISOLATED 存储桥可读取真实 sync/local v3 状态且镜像一致，未观察到扩展 warn/error。未修改运行时代码；未进行置顶写入、Feed 切换或跨设备同步回归。
- `2026-10-08`：v1.2.2 修复动态页置顶栏偶发误插三栏 flex 并被挤窄；移除启发式定位，增加明确锚点等待、错位校正、SPA 清理及串行刷新，修复按钮解禁和节点复用后的 mid。涉及 `entrypoints/content.ts`、`src/bili/{selectors,observe}.ts`、`src/ui/{injectPinButtons,pinBar}.ts`、版本文件及 PRD/roadmap。验证：内置浏览器实时 DOM 确认中栏锚点；合成页面复现旧版栏间 108px 窄条，新版为中栏 640px，`npm run typecheck`、`npm run build`、manifest 版本核对（1.2.2）及 `git diff --check` 通过；延迟加载、移除/重建、SPA 异步竞态、按钮身份及事件合并回归通过；使用临时存储/API 替身，未改账号置顶。用户重载后确认新版实例、置顶栏/推荐横条等宽（724px）、头像及按钮正常，无扩展 warn/error；临时错位后自动恢复且保留排序实例。未测试跨设备同步或账号写入。

后续维护：大功能升 minor，小功能/bugfix 升 patch；同批未发版返工不重复升版，纯文档/注释/流程不升版。升版同步 `package.json`、`package-lock.json` 及本章，构建后核对 manifest 版本。每次可验收改动在本章记录日期、改动、文件及验证，保持简短；产品行为变化更新 PRD，版本历史与计划更新 roadmap。
