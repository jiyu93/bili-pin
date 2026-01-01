# 任务交接（以当前代码为准）

> 本文是**接手必读版**：只保留“现在到底怎么实现的/怎么改最安全”。如发现文档与代码不一致，以代码为准并回写本文。

## TL;DR（现状）
- **动态页** `https://t.bilibili.com/*`：有“置顶UP”栏 + 推荐横条每个头像右上角有图钉按钮（可置顶/取消）
- **置顶UP点击后可切 Feed**：即使该 UP 不在当前推荐横条里也能切
- **选中高亮**：置顶栏选中态为蓝色圆环 + 蓝色文字（用 `box-shadow`，不抖动）
- **图标**：图钉（Tabler outline/filled 两态），取消（Tabler x）

## 核心架构（为什么这样做）
目标：**不碰 B 站前端状态机**，通过改写请求参数让 B 站自行渲染正确的 feed。

- **运行世界**：动态页 content script 必须是 `world: 'MAIN'`（隔离世界无法改写页面 fetch/xhr）
- **mid 获取**：从 `portal` 接口响应拿 `mid/name/face`，不可靠的 DOM 解析一律回避
- **切换 feed**：
  - 设置 `desiredHostMid`
  - 触发一次会让 B 站发起 `feed/*` 请求的点击
  - 在 `apiInterceptor` 中改写 `/x/polymer/web-dynamic/v1/feed/*` 的 `host_mid`

## 关键流程（按调用链理解）
1. `entrypoints/content.ts`
   - `runAt: document_start` + `world: 'MAIN'`
   - `initApiInterceptor()` 先拦截 API
   - `observeUpAvatarStrip(...)` 找到推荐横条根节点后调用 `injectPinUi()`

2. `src/bili/apiInterceptor.ts`
   - 拦截 `fetch`/`XHR`
   - 解析 `/x/polymer/web-dynamic/v1/portal` 的 `up_list.items[]`，缓存 `mid/name/face`
   - 若设置了 `desiredHostMid`：改写 `feed/*` 的 `host_mid`
   - 同步 UI：`desiredHostMid` ↔ `html[data-bili-pin-filtered-mid]`（用于隐藏 tabs）

3. `src/ui/injectPinButtons.ts`
   - 给推荐横条每个 UP 注入图钉按钮（定位到头像容器右上角）
   - **mid 映射策略**：用头像 URL → `getUpInfoByFace()` → portal 缓存 mid
   - 渲染置顶栏：`renderPinBar(...)`
   - 退出筛选态：用户点击推荐横条/tabs（capture + `e.isTrusted`）时清空 `desiredHostMid`

4. `src/bili/feedSwitch.ts` & `src/bili/clickBridge.ts`
   - `clickBridge.filterFeedDirectly()` 仅调用 `switchFeedInDynamicPage()`
   - `feedSwitch` 为了“每次都触发请求”：优先点击一个**非 active** 的推荐 UP item，并轮换 index；必要时用其它兜底点击

## 样式与交互（UI 要点）
- `src/styles/content.css`
  - `html[data-bili-pin-filtered-mid] .bili-dyn-list-tabs { display:none }`：置顶筛选态隐藏 tabs
  - 置顶栏高亮用 `box-shadow` 圆环（避免 border 导致尺寸抖动）
  - 图钉按钮两态：未置顶显示 outline，已置顶显示 filled（颜色通过 `color` 控制）

## 数据存储
- `src/storage/pins.ts`
  - 仅以真实数字 `mid` 作为身份
  - 兼容旧字段（历史 `uid`）并迁移

## 调试入口
- `window.__biliPin.dump()`：定位推荐横条容器的诊断
- `window.__biliPin.cache()`：查看 portal 缓存与已置顶数量
- 实现在 `src/bili/debugBridge.ts`

## 验收清单（每次改完都跑一遍）
- 刷新动态页后：置顶栏与图钉按钮可见且不重复注入
- 点击置顶栏任意 UP：Feed 切换成功（UP 不在推荐横条也可）
- 置顶筛选态：tabs 隐藏；点推荐横条/tabs 后退出筛选态
- 连续切换置顶栏多个 UP：每次都触发切换，不出现“第二次没反应”

## 待办（优先级从高到低）
- 拖拽排序（`pinBar.ts` + `pins.ts` 增加顺序字段）
- （可选）点击置顶栏后同步高亮推荐横条对应 UP（如存在）
- 关注列表按关注时间筛选（见 `plans/prd.md`）

## 协作约定（对人类 & AI）
- **每次完成一个“可验收”的改动后，必须同步更新本文件（HANDOFF）**：
  - 写清：改动点、涉及文件、如何验证
  - 若替换了实现方式：删掉旧描述，避免“文档比代码更像历史记录”

