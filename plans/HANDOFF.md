# 任务交接（以当前代码为准）

> 本文是**接手必读版**：只保留“现在到底怎么实现的/怎么改最安全”。如发现文档与代码不一致，以代码为准并回写本文。

## TL;DR（现状）
- **动态页** `https://t.bilibili.com/*`：有“置顶动态”栏 + 推荐横条每个头像右上角有图钉按钮（可置顶/取消）
- **置顶动态点击后可切 Feed**：
  - 若该 UP 在推荐横条存在：直接点击该 UP（B 站原生高亮 + 发请求）
  - 若该 UP 不在推荐横条：高亮“全部动态”（拦截请求改为目标 UP）
- **支持拖拽排序**：长按置顶栏头像可拖拽调整顺序，数据实时保存
- **选中高亮**：置顶栏选中态为蓝色圆环 + 蓝色文字（用 `box-shadow`，不抖动）
- **图标**：图钉（Tabler outline/filled 两态），取消（Tabler x）
- **个人空间主页** `https://space.bilibili.com/*`：在右上角“已关注”按钮的 hover 菜单里新增“置顶动态/取消置顶”，与动态页置顶数据完全共用
- **视频播放页** `https://www.bilibili.com/video/*`：在右侧 UP 信息区“已关注”按钮的 hover 菜单里新增“置顶动态/取消置顶”，与动态页置顶数据完全共用
- **动态首页 feed** `https://t.bilibili.com/*`：在每条动态卡片右上角“三点菜单”（菜单项包含“取消关注/举报”）里新增“置顶动态/取消置顶”，与置顶栏数据完全共用
- **个人空间关注列表** `https://space.bilibili.com/*/relation/follow`：在每个关注卡片上展示“关注时间: yyyy-mm-dd hh:mm:ss”，数据来源于 API 拦截。

## 核心架构（为什么这样做）
目标：**不碰 B 站前端状态机**，通过改写请求参数让 B 站自行渲染正确的 feed。

- **运行世界**：动态页 content script 必须是 `world: 'MAIN'`（隔离世界无法改写页面 fetch/xhr）
- **存储一致性**：pins 必须落在扩展 `chrome.storage.local`，不能用页面 localStorage（子域不共享，会导致 space 页置顶后动态页看不到）
- **mid 获取**：从 `portal` 接口响应拿 `mid/name/face`，不可靠的 DOM 解析一律回避
- **切换 feed**：
  - `src/bili/feedSwitch.ts` 负责策略：
    1. 优先在 DOM 找目标 UP（通过注入的 `data-mid` 或头像反查），找到则直接点击（原生行为）。
    2. 找不到则设置 `desiredHostMid`，然后点击“全部动态”制造请求，`apiInterceptor` 会拦截并修改 `host_mid`。
    3. 若“全部动态”已激活，则通过“先点别的 -> 再点全部”强行触发刷新。

## 关键流程（按调用链理解）
1. `entrypoints/content.ts`
   - `runAt: document_start` + `world: 'MAIN'`
   - `initApiInterceptor()` 先拦截 API
   - 监听动态流 feed 卡片“三点菜单”并注入“置顶动态/取消置顶”
   - `observeUpAvatarStrip(...)` 找到推荐横条根节点后调用 `injectPinUi()`

2. `entrypoints/space.content.ts`
   - `runAt: document_start` + `world: 'MAIN'`
   - **为何改 MAIN World**：为了拦截 `x/relation/followings` 等 API 请求以获取准确的粉丝/关注列表用户信息（昵称/头像），修复在粉丝列表置顶时误取 Space 主人信息的 Bug。
   - `initApiInterceptor()`：初始化 API 拦截。
   - `observeSpacePage()`：监听 DOM 注入菜单。由于 `document_start` 时 body 可能未就绪，内部已做 `DOMContentLoaded` 等待。
   - 监听 `body` 直接子节点新增的 `.vui_popover`（teleport 弹层容器），找到其中的 `.menu-popover__panel` 后插入一条 `.menu-popover__panel-item`
     - **位置**：优先放在“设置分组”上方，其次“取消关注”上方
     - **样式**：克隆一条原生菜单项作为模板（scoped CSS 需要 `data-v-*` 等属性），避免出现“字体颜色/hover 背景不一致”
     - **响应式更新**：通过 `onPinsChange` 监听数据变化，实时更新当前已打开菜单项的文案。
     - **目标识别**：通过 `mouseover` 监听器追踪最近悬停的列表项（`.list-item` / `.fans-card-item` 等），结合 API 缓存（`getUpInfoByMid`）确保置顶的是列表中的 UP 而不是 Space 主人。

3. `entrypoints/storageBridge.content.ts`
   - `runAt: document_start` + `world: 'ISOLATED'`
   - 提供 `window.postMessage` 的 storage bridge：给 MAIN world 代码（现在包括 space 页）转发 `chrome.storage.local.get/set`

4. `src/bili/apiInterceptor.ts`
   - 拦截 `fetch`/`XHR`
   - 解析 `/x/polymer/web-dynamic/v1/portal` 的 `up_list.items[]`，缓存 `mid/name/face`
   - 解析 `/x/polymer/web-dynamic/v1/feed/*` 的 `items[].modules.module_author`，缓存 `mid/name/face`
   - **新增**：解析 `/x/relation/followings` 和 `/x/relation/fans` 的 `list[]`，缓存粉丝/关注列表的 `mid/name/face`。
   - 若设置了 `desiredHostMid`：改写 `feed/*` 的 `host_mid`
   - 同步 UI：`desiredHostMid` ↔ `html[data-bili-pin-filtered-mid]`（用于隐藏 tabs）

5. `src/ui/injectPinButtons.ts`
   - 给推荐横条每个 UP 注入图钉按钮（定位到头像容器右上角）
   - **mid 映射策略**：用头像 URL → `getUpInfoByFace()` → portal 缓存 mid
   - 渲染置顶栏：`renderPinBar(...)`
   - **昵称/头像纠错**：渲染前按 `mid` 用 portal 缓存回填 `name/face` 并写回 pins（修复 space 页曾误取签名/头像的历史脏数据）
   - 退出筛选态：用户点击推荐横条/tabs（capture + `e.isTrusted`）时清空 `desiredHostMid`
   - **响应式更新**：通过 `onPinsChange` 监听数据变化，自动重新渲染 Pin Bar 和推荐栏按钮。
   - **特殊处理（Bug修复）**：当用户点击推荐栏中处于 active 状态的“全部动态”时，若此前处于“置顶劫持状态”（UI 欺骗），则通过 `forceReloadAllFeed` 强制触发一次“切换再切回”的动作，以确保 B 站真正加载全部动态内容。

6. `src/bili/feedSwitch.ts` & `src/bili/clickBridge.ts`
   - `clickBridge.filterFeedDirectly()` 仅调用 `switchFeedInDynamicPage()`
   - `switchFeedInDynamicPage`：智能选择点击对象（目标 UP 或 "全部动态"），兼顾 UI 高亮同步。
   - `forceReloadAllFeed`：专门用于“恢复全部动态流”的工具函数，解决 B 站前端忽略 active item 点击的问题。

7. `entrypoints/video.content.ts` & `src/ui/videoFollowMenuPin.ts`
   - `runAt: document_idle` + `world: 'ISOLATED'`
   - 监听/扫描 `van-popover`（`.van-popover.van-popper`），识别包含“设置分组/取消关注”的菜单后，**克隆原生菜单项** 插入“置顶动态/取消置顶`
     - 该菜单在当前 video 页结构中是：`ul.follow_dropdown > li`
   - UP 信息：优先 `__INITIAL_STATE__.videoData.owner`，DOM 兜底（space 链接/昵称/头像）
   - **响应式更新**：通过 `onPinsChange` 监听数据变化，实时更新当前已打开菜单项的文案。

8. `src/ui/dynamicMoreMenuPin.ts`
   - 动态流卡片右上角 `.bili-dyn-more__btn` 打开菜单（包含“取消关注/举报”）后注入“置顶动态/取消置顶”
   - 菜单可能不在卡片内部（cascader/popup 可能 teleport），因此会从“当前可见且包含 取消关注/举报 的 options 面板”中定位目标菜单并注入
   - 通过 **克隆 `.bili-cascader-options__item`** 注入，保证样式完全一致
   - 作者 mid 获取优先级：
     - 卡片内 `a[href*="space.bilibili.com/"]`
     - 否则用头像 URL 通过 `apiInterceptor` 的缓存（portal/feed 响应）反查 mid
   - hover 体验：菜单与按钮之间存在 hover 断档，使用 `data-bili-pin-more-hover-bridge` + CSS `::before` 做透明桥接，避免菜单闪烁
   - **响应式更新**：通过 `onPinsChange` 监听数据变化，实时更新当前已打开菜单项的文案。

9. `src/ui/followTime.ts`
   - **功能**：在个人空间“全部关注”列表页展示关注时间。
   - **原理**：
     - 拦截 `x/relation/followings` 接口，提取 `mid` 和 `mtime`（关注时间戳）并缓存。
     - 监听 `bili-pin:relation-list-updated` 事件（数据到达时）和 `popstate`（路由变化时）。
     - 遍历 DOM 中的关注卡片（`.relation-card`），通过 `a[href*="space..."]` 提取 mid。
     - 匹配缓存中的 `mtime`，格式化后插入到卡片内容区底部（操作按钮下方）。

## 样式与交互（UI 要点）
- `src/styles/content.css`
  - **深色模式/Dark Reader 适配**：全面使用 B 站原生 CSS 变量（如 `--bg1_float`, `--text1`, `--line_regular`）替代硬编码的 `rgba` 颜色。
  - **CSS 注入方式**：为了让 Dark Reader 能正确分析和处理（反转）插件样式，**不再使用 manifest 的 `content_scripts.css` 自动注入**，而是通过 JS (`import ...?inline` + `document.head.appendChild`) 动态注入 `<style>` 标签。这解决了“Chrome 扩展注入的 CSS 文件因跨域限制对 Dark Reader 不可见”的问题。
  - `html[data-bili-pin-filtered-mid] .bili-dyn-list-tabs { display:none }`：置顶筛选态隐藏 tabs
  - 置顶栏高亮与 hover 态：
    - **选中高亮**：`.is-active`，头像蓝圈（`box-shadow`）+ 蓝字 + 加粗
    - **Hover 高亮**：`.bili-pin-bar__itemMain:hover`，头像蓝圈（`box-shadow`）+ 蓝字（不加粗，避免抖动）
  - 图钉按钮两态：未置顶显示 outline，已置顶显示 filled（颜色通过 `color` 控制）
  - space 页菜单项：保持与原生菜单一致（不做 pinned 态高亮，避免样式串扰）
  - **新动态红点/蓝点**：
    - 数据源：B 站 portal 接口返回的 `has_update` 字段。
    - 表现：置顶栏头像右下角显示小蓝点（`.bili-pin-bar__updateDot`），样式复刻原生推荐栏。
    - 消除逻辑：点击置顶栏头像 或 点击原生推荐栏头像（触发 `setActiveUid`）时，更新缓存状态并立即移除 DOM 中的蓝点。

## 数据存储
- `src/storage/pins.ts`
  - 仅以真实数字 `mid` 作为身份
  - 兼容旧字段（历史 `uid`）并迁移
  - **事件通知**：提供 `onPinsChange`，在 `setPinnedUps` 后广播最新数据，驱动全站 UI 实时同步。

## 依赖变化
- 新增 `sortablejs`：用于实现丝滑的拖拽排序动画（替换原生 Drag API 实现）

## 调试入口
- `window.__biliPin.dump()`：定位推荐横条容器的诊断
- `window.__biliPin.cache()`：查看 portal 缓存与已置顶数量
- 实现在 `src/bili/debugBridge.ts`

## 验收清单（每次改完都跑一遍）
- 刷新动态页后：置顶栏与图钉按钮可见且不重复注入
- 点击置顶栏任意 UP：Feed 切换成功
  - 若 UP 在推荐栏：推荐栏对应头像高亮
  - 若 UP 不在推荐栏：推荐栏“全部动态”高亮（内容为该 UP）
- 置顶筛选态：tabs 隐藏；点推荐横条/tabs 后退出筛选态
  - **特别测试**：置顶劫持状态下点击“全部动态”，应能正常恢复到全部动态流，且置顶高亮清除。
- 连续切换置顶栏多个 UP：每次都触发切换，不出现“第二次没反应”
- 打开任意 UP 个人空间主页：hover 右上角“已关注”→ 菜单里出现“置顶动态/取消置顶”（优先位于“设置分组”上方）；点击可写入/移除置顶数据（刷新动态页可见同步）
- space 页置顶后：动态页置顶栏昵称/头像显示正确（不是签名；头像不丢失）
- 打开任意视频播放页：hover 右侧 UP 信息区“已关注”→ 菜单里出现“置顶动态/取消置顶”（优先位于“设置分组”上方）；点击可写入/移除置顶数据（刷新动态页可见同步）
- 在动态首页任意动态卡片：hover 右上角“三点菜单”→ 菜单里出现“置顶动态/取消置顶”（优先位于“取消关注”上方）；点击可写入/移除置顶数据（置顶栏同步）
- 拖拽排序：在置顶栏拖动 UP 头像可交换位置（有平滑动画）；刷新页面后顺序保持不变
- **关注时间展示**：进入个人空间“全部关注”页（`/relation/follow`），每个卡片内容区底部应显示“关注时间: yyyy-mm-dd hh:mm:ss”，且数据准确（对比接口返回值）。

## 待办（优先级从高到低）
- 关注列表按关注时间筛选（见 `plans/prd.md`）

## 协作约定（对人类 & AI）
- **每次完成一个“可验收”的改动后，必须同步更新本文件（HANDOFF）**：
  - 写清：改动点、涉及文件、如何验证
  - 若替换了实现方式：删掉旧描述，避免“文档比代码更像历史记录”

## 其它
- debug/文件夹下有参考用的页面html文件(文本量较大，请AI节约使用)
