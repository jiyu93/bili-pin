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
  - `npm run zip` — 打包发布文件
- **依赖**：`sortablejs`（拖拽排序）

---

## 2. 必守规范（违反会导致严重缺陷）

### 2.1 内存泄漏防护（历史 OOM 崩溃主因）
B 站是 SPA，Content Script 可能在页面切换时重复执行注入逻辑。**所有全局监听器和 Observer 必须使用单例模式保护。**

- **单例检查**：在注册 `window.addEventListener` 或 `MutationObserver` 前，必须检查 DOM 标记，例如：
  ```ts
  if (document.body.getAttribute('data-bili-pin-xxx-installed')) return;
  document.body.setAttribute('data-bili-pin-xxx-installed', 'true');
  ```
- **MutationObserver 防递归**：
  1. 修改 DOM 前先检查值是否真正改变（如对比 `textContent`）。
  2. 在 Observer 回调中过滤掉由插件自身元素（带 `data-bili-pin-*` 属性）引起的变动。

### 2.2 文档维护义务
- **每次完成一个"可验收"的改动后，必须回来更新 `AGENTS.md`**。
- 写清改动点、涉及文件、如何验证，并删除过时描述。

### 2.3 版本号规范
- 功能变更增加第二位数字（如 `v1.1.0`）。
- 只修 Bug 无功能变更增加第三位数字（如 `v1.0.2`）。
- 修改版本号后同步更新 `package.json` 和本文档 **第 6 章**。

---

## 3. 核心架构

### 3.1 运行环境隔离 (Content Script Worlds)
- **`MAIN` World**：动态页 (`t.bilibili.com`)、空间页 (`space.bilibili.com`)、视频页 (`video.content.ts`)。
  - 用途：拦截/修改 XHR/Fetch（`apiInterceptor`）、访问 `window.__INITIAL_STATE__`、操作原生 DOM。
- **`ISOLATED` World**：`entrypoints/storageBridge.content.ts`。
  - 用途：为 `MAIN` world 提供 `chrome.storage` 代理服务（通过 `window.postMessage` 转发）。
  - 原因：`MAIN` world 无法直接访问 `chrome.storage.local`。

### 3.2 数据存储
- **同步策略**：优先使用 **`chrome.storage.sync`**（同一 Google 账号自动跨设备同步），未登录/不可用时自动降级到 **`chrome.storage.local`** 作为离线缓存。
- 跨子域共享：通过 `storageBridge`（`ISOLATED` world）为 `MAIN` world 提供代理服务。
- 状态管理核心文件：`src/storage/pins.ts`，统一存储层：`src/storage/syncStorage.ts`。
- 响应式机制：修改数据后广播 `onPinsChange` 事件；同时监听 `chrome.storage.sync.onChanged`，在其他设备同步过来时自动重绘 UI。

### 3.3 API 拦截 (`src/bili/apiInterceptor.ts`)
- **拦截范围**：仅限 `portal`、`uplist`、`feed`、`relation` 等我们真正依赖的 B 站接口。
- **用途**：
  - 拦截 `portal` / `uplist` / `feed`：缓存 UP 主头像/昵称，避免依赖不稳定 DOM 解析。
  - 拦截 `followings`：获取 `mid` -> `mtime` 关注时间映射。
- **Feed 切换黑魔法**：当点击置顶 UP 且该 UP 不在原生推荐栏时，拦截"全部动态"请求，强行替换 `host_mid` 参数，欺骗 B 站前端渲染目标 UP 的 Feed。

### 3.4 样式注入
- CSS 文件：`src/styles/content.css`
- 注入方式：使用 JS 动态注入 `<style>` 标签（而非 Manifest `css` 字段），确保 Dark Reader 等插件不受影响。

---

## 4. 功能模块速查

| 功能 | 入口文件 | 核心逻辑文件 | 备注 |
|------|---------|-------------|------|
| **动态页置顶栏 & Feed 切换** | `entrypoints/content.ts` | `src/ui/pinBar.ts` (渲染), `src/bili/feedSwitch.ts` (切换逻辑) | 使用 `sortablejs` 实现拖拽排序。 |
| **动态页推荐栏图钉按钮** | - | `src/ui/injectPinButtons.ts` | 在头像容器右上角插入图钉按钮。 |
| **动态卡片菜单置顶选项** | - | `src/ui/dynamicMoreMenuPin.ts` | **克隆**原生"三点菜单"项插入。 |
| **动态页头像 hover 卡片置顶** | - | `src/ui/dynamicUserCardPin.ts` | 在 feed 流头像 hover 弹出的 UP 主信息卡片（"已关注"/"发消息"区域）中注入置顶/取消置顶按钮。 |
| **空间页/视频页菜单置顶** | `entrypoints/space.content.ts`, `video.content.ts` | 各自入口文件内实现 | 监听"已关注"按钮 hover 弹层 (`.vui_popover` / `.van-popover`)，**克隆**原生菜单项插入。难点：通过 `mouseover` 追踪和 API 缓存识别当前 hover 的是哪个 UP。 |
| **关注时间显示** | - | `src/ui/followTime.ts` | 依赖 `apiInterceptor` 缓存的 `mid -> mtime` 映射，在 DOM 中插入格式化时间文本。 |
| **数据同步/状态管理** | - | `src/storage/pins.ts` + `src/storage/syncStorage.ts` | 所有 UI 通过 `onPinsChange` 事件响应式同步；跨设备通过 `chrome.storage.sync` 自动同步。 |

---

## 5. 调试与验证

- **调试工具**：在页面控制台输入 `window.__biliPin.dump()` 可查看诊断信息。
- **验收清单**（每次改动后按场景自测）：
  - [ ] 动态页置顶栏显示正常，且能拖拽排序。
  - [ ] 点击置顶头像能正确切换 Feed（无论该 UP 是否在推荐栏）。
  - [ ] 动态页推荐横条、动态卡片菜单、空间页/视频页关注菜单均显示置顶选项，且状态同步。
  - [ ] 空间页"全部关注"列表显示正确的关注时间。
  - [ ] 刷新页面后数据不丢失。
  - [ ] 同一 Google 账号下的其他 Chrome 设备能自动同步置顶列表（测试：设备 A 置顶/取消置顶后，设备 B 打开 B 站动态页应自动更新）。
  - [ ] 长时间挂机（如视频页播放 30 分钟以上）无内存泄漏 / OOM 崩溃。

---

## 6. 当前状态与近期变更

**当前版本：`v1.1.1`**

### 已完成（最近在上面的变更）
- `v1.1.1`：在动态页 `t.bilibili.com` 的 feed 流头像 hover 弹出的 UP 主信息卡片中，新增"置顶动态/取消置顶"按钮（位于"发消息"右侧）。通过内容特征识别卡片 DOM，克隆原生按钮样式，支持响应式状态同步。
- `v1.1.0`：新增配置同步功能。存储层迁移到 `chrome.storage.sync`，在同一 Google 账号内自动同步置顶列表与 UI 展开状态；保留 `local` 作为离线降级；通过 `storageBridge` 实时监听同步变更并自动刷新 UI。
- `v1.0.4`：移除不必要的 `host_permissions`；收窄 API 拦截脚本注入范围（仅限视频页）；清理废弃 API 调用代码。
- `v1.0.3`：修复视频播放页长时间挂机后因 `MutationObserver` 死循环导致的 OOM 崩溃。
- `v1.0.2`：收窄 API 拦截范围至必要接口；增加 UP 信息缓存上限与裁剪策略；将 `mid -> mtime` 关注时间独立缓存；增加单例保护防止 API 拦截器重复初始化。
- `v1.0.1`：修复动态页推荐栏"加载更多"后新加载的 UP 主置顶按钮置灰问题（拦截 `v1/uplist` 接口）；修复 SPA 环境下多次注入导致的全局监听器和 Observer 内存泄漏。
- `v1.0.0`：完成核心功能（置顶栏、全站置顶入口、Feed 切换、拖拽排序、关注时间显示、本地持久化）。

### 下一步规划
详见 `docs/roadmap.md`（未来新功能或优化方向会记录在此，启动新功能前建议对照）。

### 历史需求档案
详见 `docs/prd.md`（产品设计初衷与详细功能定义）。

---

## 7. 快速目录结构

```
entrypoints/
  content.ts          # 动态页 (MAIN world)
  space.content.ts    # 空间页 (MAIN world)
  video.content.ts    # 视频页 (MAIN world)
  storageBridge.content.ts  # Storage Bridge (ISOLATED world)
src/
  bili/
    apiInterceptor.ts # API 拦截与缓存
    feedSwitch.ts     # Feed 切换逻辑
  storage/
    pins.ts           # 置顶数据管理与响应式同步
    syncStorage.ts    # 统一存储层（sync 优先 + local 兜底）
  styles/
    content.css       # 插件样式
  ui/
    pinBar.ts             # 置顶栏渲染
    injectPinButtons.ts   # 推荐栏图钉按钮
    dynamicMoreMenuPin.ts # 动态卡片菜单注入
    dynamicUserCardPin.ts # 动态页头像 hover 卡片置顶按钮
    followTime.ts         # 关注时间显示
```
