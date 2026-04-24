# Bili Pin - AI Development Guide

> **必读提示**：本文档是 AI 维护本项目的唯一权威入口。每次开始任务前，请先完整阅读本文档的 **第 2 章（必守规范）** 和 **第 4 章（功能模块速查）**。完成任务后，必须更新本文档的 **第 6 章（当前状态）** 和相关章节。

## 1. 项目概述

**Bili Pin** 是一个 Bilibili 浏览器扩展（Chrome MV3），基于 [WXT](https://wxt.dev/) + TypeScript 开发。

### 核心功能
1. **动态页置顶栏**：在 `t.bilibili.com` 顶部增加置顶 UP 主头像栏，点击快速筛选 Feed，支持拖拽排序。
2. **全站快捷置顶入口**：在动态页推荐横条、动态卡片"三点菜单"、UP 主空间页/视频播放页"已关注"悬停菜单中注入置顶/取消置顶选项。
3. **关注时间显示**：在个人空间 `space.bilibili.com` 的"全部关注"列表中展示精确关注时间。

### 技术栈
- **框架**：WXT (v0.20.13)
- **语言**：TypeScript (ES Module)
- **构建命令**：
  - `npm run dev` — 启动开发服务器（热重载）
  - `npm run build` — 构建生产版本（输出至 `.output/chrome-mv3`）
  - `npm run typecheck` — 进行 TypeScript 静态检查
  - `npm run zip` — 打包发布文件
- **依赖**：`sortablejs`（拖拽排序）

---

## 2. 必守规范（违反会导致严重缺陷）

### 2.1 开发义务
- 确保相关功能的做法是直接的、可靠的、符合第一性原理的、没有过度设计的、没有无意义的性能开销的.
- 在多次迭代过程中,可能存在不断在补丁上加补丁的历史情况发生,如果发生了,需要主动积极地在严格保证原功能逻辑不变的情况下,优化/清理/乃至重新设计和重构代码,目的就是为了贴近上述的直接,可靠,第一性原理.

### 2.2 文档维护义务
- **每次完成一个"可验收"的改动后，必须回来更新 `AGENTS.md`**。
- 写清改动点、涉及文件、如何验证，并删除过时描述。

### 2.3 版本号规范
- 大功能变更增加第二位数字（如 `v1.1.0`）。
- 小功能变更和Bug修复,增加第三位数字（如 `v1.0.2`）。
- 同一批功能上线后的补完、修正、回归验证与 UI 收敛，默认继续增加第三位数字；不要因为还在打磨同一批功能就再次提升第二位数字。
- 若同一批改动尚未实际发版，中途为修复本次改动引入的回归或实现缺陷而继续返工，**不要再次增加版本号**；应保留同一个目标版本，并把文档记录合并为最终结果。
- 项目版本号的**单一真源**是 `package.json`；`wxt.config.ts` 中的 manifest 版本必须直接读取这里，禁止再次手写一个独立版本号。
- 修改版本号后同步更新 `package.json` 和本文档 **第 6 章**，并确认 `npm run build` 后 `.output/chrome-mv3/manifest.json` 的 `version` 与 `package.json` 一致。

---

## 3. 核心架构

### 3.1 运行环境隔离 (Content Script Worlds)
- **`MAIN` World**：
  - 动态页 (`entrypoints/content.ts`)：尽早初始化 `apiInterceptor`，渲染置顶栏、推荐横条图钉按钮、动态卡片菜单置顶项。
  - 空间页 (`entrypoints/space.content.ts`)：初始化 `apiInterceptor`，为关注时间与“已关注”悬停菜单提供 relation 接口缓存。
  - 视频页 (`entrypoints/video.content.ts`)：不拦截 API；直接访问 `window.__INITIAL_STATE__` 与原生 DOM，为“已关注”悬停菜单注入置顶项。
- **`ISOLATED` World**：`entrypoints/storageBridge.content.ts`。
  - 用途：为 `MAIN` world 提供 `chrome.storage.local/sync` 代理服务（通过 `window.postMessage` 转发）。
  - 原因：`MAIN` world 无法直接访问 `chrome.storage`。

### 3.2 数据存储
- 使用 **`chrome.storage.sync` + `chrome.storage.local` 镜像写入**：`sync` 作为跨设备同步主存储，`local` 保留同机镜像与回退能力。
- `MAIN` world 内的存储访问统一走 `chrome.storage` / storage bridge，不再回退到页面 `localStorage`。
- 版本升级时必须先读取旧 `local` 配置并迁移到 `sync`，禁止直接用空的同步配置覆盖已有本地数据。
- 状态管理核心文件：`src/storage/config.ts`、`src/storage/pins.ts`。
- 响应式机制：修改数据后广播 `onPinsChange` 事件，所有 UI 组件监听并自动重绘。

### 3.3 API 拦截 (`src/bili/apiInterceptor.ts`)
- **拦截范围**：仅限 `portal`、`uplist`、`feed`、`relation/followings`、`relation/fans`、`relation/tag` 等我们真正依赖的 B 站接口。
- **用途**：
  - 拦截 `portal` / `uplist` / `feed`：缓存 `mid -> { name, face, has_update }`，避免依赖不稳定 DOM 解析。
  - 拦截 `relation/*`：缓存列表用户信息，并提取 `mid -> mtime` 关注时间映射供空间页使用。
- **Feed 切换黑魔法**：当点击置顶 UP 且该 UP 不在原生推荐栏时，拦截"全部动态"请求，强行替换 `host_mid` 参数，欺骗 B 站前端渲染目标 UP 的 Feed。

### 3.4 样式注入
- CSS 文件：`src/styles/content.css`
- 注入方式：使用 JS 动态注入 `<style>` 标签（而非 Manifest `css` 字段），确保 Dark Reader 等插件不受影响。

---

## 4. 功能模块速查

| 功能 | 入口文件 | 核心逻辑文件 | 备注 |
|------|---------|-------------|------|
| **动态页置顶栏 & Feed 切换** | `entrypoints/content.ts` | `src/ui/injectPinButtons.ts` (推荐栏按钮 + 置顶栏编排), `src/ui/pinBar.ts` (渲染/高度持久化), `src/bili/feedSwitch.ts` (切换逻辑) | 使用 `sortablejs` 实现拖拽排序，置顶栏支持纵向拉伸和滚动；高度持久化以拖拽结束时写入 storage 为主路径，不依赖通用 `ResizeObserver` 回写。 |
| **动态页推荐栏图钉按钮** | - | `src/ui/injectPinButtons.ts` | 在头像容器右上角插入图钉按钮。 |
| **动态卡片菜单置顶选项** | - | `src/ui/dynamicMoreMenuPin.ts` | **克隆**原生"三点菜单"项插入。 |
| **空间页/视频页菜单置顶** | `entrypoints/space.content.ts`, `entrypoints/video.content.ts` | `src/ui/spaceFollowMenuPin.ts`, `src/ui/videoFollowMenuPin.ts` | 监听"已关注"按钮 hover 弹层 (`.vui_popover` / `.van-popover`)，**克隆**原生菜单项插入。空间页通过 `mouseover` 追踪最近 hover 的列表项 mid；视频页优先读取 `window.__INITIAL_STATE__`，DOM 作为兜底。 |
| **关注时间显示** | - | `src/ui/followTime.ts` | 依赖 `apiInterceptor` 缓存的 `mid -> mtime` 映射，在 DOM 中插入格式化时间文本；优先绑定到关注列表容器本身，避免长期对整页 `body subtree` 做高频观察。 |
| **数据同步/状态管理** | `entrypoints/storageBridge.content.ts` | `src/storage/config.ts`, `src/storage/pins.ts`, `src/utils/bridgeClient.ts` | `sync` 为主、本地缓存回退；监听 `storage.onChanged` 后将远端变化回灌到页面。 |
| **扩展图标同步摘要弹窗** | `public/popup.html` | `public/popup.html`, `public/popup.js` | 点击扩展图标可查看头像数量与最后同步时间；UI 保持紧凑，默认打开即刷新。 |

---

## 5. 调试与验证

- **调试工具**：先在 DevTools 执行 `localStorage.setItem('biliPin.debug','1')` 并刷新页面，再在控制台输入 `window.__biliPin.dump()` 查看选择器诊断信息，或输入 `window.__biliPin.cache()` 查看缓存与置顶数据摘要；调试结束后执行 `localStorage.removeItem('biliPin.debug')`。
- **同步摘要弹窗**：点击扩展工具栏图标，可查看头像数量与最后同步时间，用于快速确认跨设备同步是否收敛。
- **验收清单**（每次改动后按场景自测）：
  - [ ] 动态页置顶栏显示正常，且能拖拽排序。
  - [ ] 点击置顶头像能正确切换 Feed（无论该 UP 是否在推荐栏）。
  - [ ] 动态页推荐横条、动态卡片菜单、空间页/视频页关注菜单均显示置顶选项，且状态同步。
  - [ ] 空间页"全部关注"列表显示正确的关注时间。
  - [ ] 刷新页面后数据不丢失。
  - [ ] 升级到新版本后，旧设备原本保存在 `chrome.storage.local` 的配置会自动迁移到 `chrome.storage.sync`，且不会被空同步数据覆盖。
  - [ ] 长时间挂机（如视频页播放 30 分钟以上）无内存泄漏 / OOM 崩溃。

---

## 6. 当前状态与近期变更

**当前版本：`v1.1.4`**

### 文档同步（不改版本号）
- `2026-04-23`：全量核对仓库内 `*.md` 文档与当前代码实现，修正了 `README.md`、`docs/roadmap.md`、`docs/prd.md`、`AGENTS.md` 中关于置顶栏交互、存储方案、模块拆分和运行环境的过时描述；本次仅同步文档，不变更运行时代码与版本号。
- `2026-04-23`：按当前实现重写 `docs/prd.md`，不再保留旧版本功能文案与历史补注，仅保留简介与背景，并改为面向维护者说明“当前功能模块、页面入口、核心模块、数据同步与实现方式”；同步将本章对 `docs/prd.md` 的定位从“历史需求档案”更新为“项目简介、背景与当前结构说明”。

### 已完成（最近在上面的变更）
- `v1.1.4`：对整项目中最容易出现无意义性能开销和长时间挂机风险的观察器/刷新链路做了一轮收敛，保持功能不变但把实现拉回更直接的方案。空间页的关注时间注入不再长期监听整个 `document.body subtree`，而是改为先定位关注列表，再把观察范围收窄到实际列表容器，并用单帧调度合并重复检查；视频页“已关注”菜单改为显式追踪每个弹层对应的 `MutationObserver`，在弹层节点移除时主动断开，避免观察器跟着被销毁的 popover 残留；动态页卡片三点菜单把频繁的全局 attach 检测合并到同一帧，并在 hover 重试前清理上一次未完成的定时器，减少空转；推荐横条图钉按钮移除了每个按钮各自的一次性兜底 `setTimeout`，改由现有的 `portal/uplist` 事件和列表变更统一驱动重刷，同时把推荐栏 subtree 变化合并到单帧刷新，避免批量 DOM 追加时重复 `refreshPinUi`。涉及文件：`src/ui/followTime.ts`、`src/ui/videoFollowMenuPin.ts`、`src/ui/dynamicMoreMenuPin.ts`、`src/ui/injectPinButtons.ts`、`package.json`。验证：`npm run typecheck`、`npm run build` 通过；空间页“全部关注”列表首次进入、切换分页/路由、接口数据回灌后都应继续显示关注时间；视频页反复打开/关闭“已关注”菜单后仍能稳定显示置顶项，长时间停留不应因弹层 observer 累积而持续增长；动态页加载更多、hover 三点菜单、推荐横条异步补全 mid 时，置顶按钮与菜单项仍能正确出现且不会因为重复刷新造成明显抖动。
- `v1.1.3`：修复动态页置顶栏高度相关的一整批未发版问题，并将该批返工统一收敛到同一个目标版本，而不再额外占用 `v1.1.4+`。本次最终实现同时解决了两个用户可见缺陷：一是刷新后高度会逐次变高，原因是持久化逻辑曾误把 `.bili-pin-bar__list` 的渲染总高度（包含 padding）当成 CSS `height` 写回；二是手动调整后的高度在刷新后会退回默认两行，原因是中途返工时把“当前显示高度”和“已持久化高度”混在了一起，导致保存链路被自己短路。现已按更直接的方案收敛：初始化时读取并应用已保存高度；拖拽结束 (`pointerup/pointercancel`) 时把最终高度串行写入 storage；不再依赖 `ResizeObserver`、防抖定时器或多份 DOM dataset 影子状态回写，减少竞态与无意义的持续开销。同时把扩展 manifest 版本号改为直接读取 `package.json`，让版本只维护一处。涉及文件：`src/ui/pinBar.ts`、`package.json`、`wxt.config.ts`。验证：`npm run typecheck`、`npm run build` 通过；页面上不拖拽时连续刷新高度应保持不变，手动拖拽后无论立即刷新还是多次快速调整后刷新，都应恢复到最后一次释放手柄时的高度；`.output/chrome-mv3/manifest.json` 的 `version` 应与 `package.json` 一致为 `1.1.3`。
- `v1.1.2`：将动态页置顶栏从单一“展开/收起”切换为可自由纵向拉伸的滚动容器；置顶头像过多时可通过底部正中央的拖拽手柄调整高度，并通过纵向滚动条浏览完整列表；新增置顶栏高度的 `sync/local` 镜像存储与时间戳状态，已打开页面刷新后仍保留上次拉伸结果，同时兼容旧版展开状态作为一次性迁移回退；移除头部“恢复默认高度”按钮，改为更克制的底部拖拽交互。涉及文件：`src/ui/pinBar.ts`、`src/styles/content.css`、`src/storage/keys.ts`、`package.json`、`wxt.config.ts`。验证：`npm run typecheck` 通过，页面上需重点确认底部手柄拖拽、高度持久化、滚动浏览，以及点击头像切换 Feed/拖拽排序未回归；`npm run build` 后产物 manifest 版本应为 `1.1.2`。
- `v1.1.1`：补完配置同步闭环；修复跨设备同步分叉问题，将 `chrome.storage.sync` 明确为权威配置，`chrome.storage.local` 仅作为镜像与回退副本，避免两台设备持续各自坚持本地状态；置顶列表保留带时间戳的同步状态与删除墓碑，置顶栏展开状态也改为按更新时间收敛；通过 `storage.onChanged` 将远端 `sync` 变化主动回灌给已打开页面；支持从 `config/manifest-key.txt` 读取固定 `manifest.key`，便于两台电脑本地调试时保持相同扩展 ID；扩展图标弹窗收敛为头像数量和最后同步时间，并修复 MV3 下内联脚本不执行导致的空白问题，同时优化为更紧凑的卡片式样式；补做收尾清理，收紧生产环境调试桥与控制台诊断输出、抽出统一 storage key 常量，并补上 `npm run typecheck`。
- `v1.1.0`：新增配置同步能力；置顶列表与置顶栏展开状态改为 `chrome.storage.sync` / `chrome.storage.local` 双写；首次升级会把既有本地配置迁移到同步存储，避免更新后配置被空同步数据覆盖。
- `v1.0.4`：移除不必要的 `host_permissions`；收窄 API 拦截脚本注入范围（仅限视频页）；清理废弃 API 调用代码。
- `v1.0.3`：修复视频播放页长时间挂机后因 `MutationObserver` 死循环导致的 OOM 崩溃。
- `v1.0.2`：收窄 API 拦截范围至必要接口；增加 UP 信息缓存上限与裁剪策略；将 `mid -> mtime` 关注时间独立缓存；增加单例保护防止 API 拦截器重复初始化。
- `v1.0.1`：修复动态页推荐栏"加载更多"后新加载的 UP 主置顶按钮置灰问题（拦截 `v1/uplist` 接口）；修复 SPA 环境下多次注入导致的全局监听器和 Observer 内存泄漏。
- `v1.0.0`：完成核心功能（置顶栏、全站置顶入口、Feed 切换、拖拽排序、关注时间显示、本地持久化）。

### 下一步规划
详见 `docs/roadmap.md`（未来新功能或优化方向会记录在此，启动新功能前建议对照）。

### 项目说明
详见 `docs/prd.md`（项目简介、背景与当前结构说明）。

---

## 7. 快速目录结构

```
entrypoints/
  content.ts          # 动态页 (MAIN world, API 拦截 + UI 注入)
  space.content.ts    # 空间页 (MAIN world, relation 缓存 + 关注时间/菜单)
  video.content.ts    # 视频页 (MAIN world, 读取 __INITIAL_STATE__ + 菜单注入)
  storageBridge.content.ts  # Storage Bridge (ISOLATED world)
public/
  popup.html          # 扩展图标同步摘要弹窗
  popup.js            # 弹窗摘要逻辑
config/
  manifest-key.txt    # 固定扩展 ID 用的 manifest 公钥
src/
  bili/
    apiInterceptor.ts # portal/uplist/feed/relation API 拦截与缓存
    clickBridge.ts    # 动态页内触发 Feed 切换
    feedSwitch.ts     # 推荐栏/全部动态切换逻辑
  storage/
    config.ts         # sync/local 镜像存储与迁移
    pins.ts           # 置顶数据管理与响应式同步
  styles/
    content.css       # 插件样式
  utils/
    bridgeClient.ts   # MAIN world 访问 storage bridge 的客户端
  ui/
    pinBar.ts             # 置顶栏渲染
    injectPinButtons.ts   # 推荐栏图钉按钮
    dynamicMoreMenuPin.ts # 动态卡片菜单注入
    spaceFollowMenuPin.ts # 空间页“已关注”菜单注入
    videoFollowMenuPin.ts # 视频页“已关注”菜单注入
    followTime.ts         # 关注时间显示
```
