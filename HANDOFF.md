# 任务交接与开发规范 （主要是给AI看的，人类也可以看）

## 0. 协作约定（必读）

在开始开发前，请务必遵守以下约定：

1.  **文档阅读**：
    - **PRD（主需求文档）**：[`docs/prd.md`](docs/prd.md) - 了解产品设计初衷与核心功能。
    - **Roadmap（版本规划）**：[`docs/roadmap.md`](docs/roadmap.md) - 了解未来规划。
    - **本通过文档**：了解当前核心架构与实现细节。

2.  **文档维护**：
    - **每次完成一个“可验收”的改动后，务必回来更新本文档 (`HANDOFF.md`)**。
    - 写清改动点、涉及文件、如何验证，并删除过时描述，避免文档落后于实现。

3.  **版本号规范**：
    - 功能变更增加第二位数字（v1.1.0）。
    - 只修 Bug 无功能变更只增加第三位数字（v1.0.1）。

## 1. 核心架构

- **运行环境 (Worlds)**:
  - `MAIN` World: 动态页 (`t.bilibili.com`) 和空间页 (`space.bilibili.com`)。必须在此环境运行以拦截/修改 XHR/Fetch 请求（`apiInterceptor`）和操作原生 DOM。
  - `ISOLATED` World: 视频页 (`video.content.ts`) 和 Storage Bridge。用于相对独立的 UI 注入或与扩展 API 通信。
- **数据存储**: 使用 `chrome.storage.local`。这是为了跨子域（space vs dynamic）共享数据。
  - *注意*: `MAIN` world 无法直接访问 `chrome.storage`，通过 `entrypoints/storageBridge.content.ts` (Isolated) 转发 `window.postMessage` 实现读写。
- **API 拦截 (`src/bili/apiInterceptor.ts`)**:
  - 拦截 `portal` 和 `feed` 接口：缓存 UP 主头像/昵称（避免依赖不稳定的 DOM 解析）。
  - 拦截 `followings` 接口：获取关注时间。
  - **Feed 切换黑魔法**: 当点击置顶 UP 且该 UP 不在原生推荐栏时，拦截“全部动态”请求，强行替换 `host_mid` 参数，从而“欺骗”B 站前端渲染目标 UP 的 Feed。

## 2. 功能模块实现

### 2.1 动态页置顶栏 & Feed 切换
- **入口**: `entrypoints/content.ts`
- **渲染**: `src/ui/pinBar.ts` 负责渲染置顶栏。支持 `sortablejs` 拖拽排序。
- **切换逻辑 (`src/bili/feedSwitch.ts`)**:
  1. 尝试在原生推荐栏找该 UP 的 DOM 节点 -> 找到则直接 `.click()` (原生高亮)。
  2. 找不到 -> 设置 `desiredHostMid` 标记 -> 点击“全部动态” -> `apiInterceptor` 自动修改请求参数。
  3. **UI 同步**: 通过 CSS (`data-bili-pin-filtered-mid`) 隐藏原生 Tabs，模拟筛选状态。

### 2.2 全站置顶按钮注入
为了保持原生体验，我们在多处注入了置顶入口。
- **动态页推荐栏**: `src/ui/injectPinButtons.ts`。在头像容器右上角插入图钉按钮。
- **动态卡片菜单**: `src/ui/dynamicMoreMenuPin.ts`。监听/寻找卡片右上角的“三点菜单”弹层，**克隆**原生菜单项插入。
- **空间页/视频页菜单**: `entrypoints/space.content.ts` & `video.content.ts`。监听“已关注”按钮的 hover 弹层 (`.vui_popover` 或 `.van-popover`)，**克隆**原生菜单项插入。
  - *难点*: 需准确识别当前 hover 的是哪个 UP（Space 页列表 vs Space 主人），通过 `mouseover` 追踪和 API 缓存解决。

### 2.3 关注时间显示
- **逻辑**: `src/ui/followTime.ts`
- **原理**: 拦截 `/x/relation/followings` 接口响应，缓存 `mid` -> `mtime` 映射。在 DOM 中找到对应关注卡片，插入格式化的时间文本。

### 2.4 数据同步
- **状态管理**: `src/storage/pins.ts`。
- **响应式**: 修改数据后广播 `onPinsChange` 事件，所有 UI 组件（PinBar, Buttons, Menus）监听此事件并自动重绘，确保状态实时同步。

## 3. 样式与适配
- **CSS**: `src/styles/content.css`。
- **注入方式**: 使用 JS 动态注入 `<style>` 标签，确保 Dark Reader 等插件功能不受影响。

## 4. 调试与验证
- **调试工具**: 控制台输入 `window.__biliPin.dump()` 可查看诊断信息。
- **验收清单**:
  - [ ] 动态页置顶栏显示正常，且能拖拽排序。
  - [ ] 点击置顶头像能正确切换 Feed（无论该 UP 是否在推荐栏）。
  - [ ] 动态页推荐横条、动态卡片菜单、空间页/视频页关注菜单均显示置顶选项，且状态同步。
  - [ ] 空间页“全部关注”列表显示正确的关注时间。
  - [ ] 刷新页面后数据不丢失。
