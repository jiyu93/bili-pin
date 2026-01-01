# 任务交接文档

> **创建时间**：2025-01-13  
> **上下文长度**：已接近上限，需要新会话接手

## 项目概述

**Bili Pin** - 一个Chrome扩展（WXT + TypeScript MV3），在B站动态页 `https://t.bilibili.com/` 添加“置顶UP”功能。

## 技术栈

- **框架**：WXT (浏览器扩展开发框架)
- **语言**：TypeScript
- **构建**：Vite
- **存储**：`chrome.storage.local`
- **目标页面**：`https://t.bilibili.com/*`
- **参考B站开源API文档**: `https://github.com/SocialSisterYi/bilibili-API-collect`

## 当前状态

### ✅ 已实现功能

1. **置顶UP栏**
   - 在“关注UP推荐列表”上方显示
   - 网格布局，自动换行
   - 展开/收起功能（记住状态）
   - 显示置顶总数
   - hover显示“已置顶”按钮，可取消置顶

2. **置顶按钮**
   - 在“关注UP推荐列表”每个UP头像上注入
   - hover时显示“置顶/已置顶”按钮
   - 点击可置顶/取消置顶

3. **数据持久化**
   - 使用 `chrome.storage.local` 存储置顶数据
   - 自动数据迁移和去重
   - **仅存储真实 `mid`（数字字符串）**

4. **DOM监听**
   - 使用 `MutationObserver` 监听SPA路由变化
   - 幂等注入，避免重复渲染

5. **新增：UP 个人主页置顶入口**
   - 在 `https://space.bilibili.com/<mid>` 的“已关注”下拉菜单中注入“动态页置顶/取消动态页置顶”
   - 该入口天然可获得 `mid`，是最稳定的置顶方式

### 🐛 已知Bug（优先级：高）

#### Bug #1: 点击置顶UP无法筛选Feed（核心问题）

**状态**：✅ 已修复（2026-01）

**原问题描述**：
- 点击置顶UP头像时，如果该UP**不在当前“关注UP推荐列表”**里，无法触发Feed刷新
- 控制台会输出 `[bili-pin] failed to bridge click`
- 这是**用户的核心需求**：必须能查看不在推荐列表的UP的动态

**最终实现（已落地）**：
- **mid 来源**：页面加载时拦截 `portal?up_list_more=1...`（`/x/polymer/web-dynamic/v1/portal`），响应中 `up_list.items[]` 自带 `mid/name/face`
- **不再从 DOM 抠 mid**：`src/ui/injectPinButtons.ts` 只用头像 URL 的 `bfs/face/<hash>` 去 portal 缓存映射出 mid
- **Feed 切换**：在 `MAIN world` 改写 B 站 `feed/*` 请求的 `host_mid`，让 B 站自己刷新/渲染 feed（不跳转 space 页）
- **保证每次触发刷新**：`src/bili/feedSwitch.ts` 会点击一个“非当前 active”的推荐UP item（轮换），必要时先点“全部动态”再点 UP，避免出现“第二次点置顶没反应”
- **置顶筛选态 UI**：通过 `html[data-bili-pin-filtered-mid]` 标记进入“置顶筛选模式”，隐藏 `.bili-dyn-list-tabs`（全部/视频投稿/追番追剧/专栏）
- **退出筛选态**：用户点击推荐UP/“全部动态”/tabs 时，在 **capture 阶段** 清空 `desiredHostMid`，避免“第一次点击仍被改写导致要点两次”

**用户要求**：
> "我做这个插件的主要目的就是为了能够在置顶UP列表里随时查看关注UP推荐列表里没推荐的UP主的Feed流，所以这个依赖必须解开"

**结论**：
- faceKey 不能 100% 反推 mid，因此 **切 Feed 的刚需必须以 mid 为准**
- 推荐横条的 mid 应以 portal 接口为准（而不是 DOM）

**相关文件**：
- `src/bili/clickBridge.ts` - 当前桥接逻辑
- `src/ui/injectPinButtons.ts` - 点击处理入口（`onClickUid` handler）
 - `src/bili/apiInterceptor.ts` - 拦截 portal 缓存 up_list(mid/name/face)；并改写 feed 请求的 host_mid
 - `src/bili/feedSwitch.ts` - 在动态页内触发一次“刷新”，配合 host_mid 改写实现切换
 - `entrypoints/content.ts` - `world: 'MAIN'`（关键：才能拦截页面 fetch/xhr）
 - `entrypoints/space.ts` / `src/ui/spacePagePin.ts` - space 页“动态页置顶”入口

#### Bug #2: 缺少高亮显示

**问题描述**：
- 点击置顶UP后，Feed会刷新，但缺少视觉反馈
- 用户期望：像B站原推荐列表一样，选中时显示**蓝色圆框**和**蓝色文字**

**用户原话**：
> "置顶UP的头像选中后虽然会更新Feed流，但是缺少上图红框指出的头像蓝色圆框和蓝色文字的'高亮显示'"

**解决方案**：
- 需要给置顶UP栏的头像添加选中状态样式
- 可能还需要同步高亮推荐列表中对应的UP（如果存在）
- 需要监听Feed变化，判断当前筛选的是哪个UP
（目前已实现置顶栏高亮；推荐横条点击时会同步置顶栏高亮/清空高亮，推荐横条自身的视觉高亮仍由 B 站原逻辑控制）

**相关文件**：
- `src/styles/content.css` - 样式定义
- `src/ui/pinBar.ts` - 置顶栏渲染逻辑

### 📋 待实现功能

#### Feature #1: 拖拽排序

**状态**：roadmap中标记为“已完成”，但实际**未实现**

**需求**：
- 置顶UP栏的头像支持拖拽排序
- 排序结果保存到本地存储
- 刷新后保持排序

**相关文件**：
- `src/ui/pinBar.ts` - 需要添加拖拽事件处理
- `src/storage/pins.ts` - 需要添加排序字段存储

## 关键文件说明

### 入口文件
- `entrypoints/content.ts` - Content script入口，监听DOM变化并注入UI

### 核心逻辑
- `src/ui/injectPinButtons.ts` - 注入置顶按钮和置顶栏的主要逻辑
- `src/ui/pinBar.ts` - 置顶栏的渲染和交互
- `src/bili/clickBridge.ts` - 置顶切换入口（当前实现为“站内切换”，已不再依赖“桥接 DOM 点击”）
- `src/bili/observe.ts` - DOM监听，确保在SPA路由变化时重新注入
- `src/bili/selectors.ts` - DOM选择器，定位“关注UP推荐列表”
- `src/storage/pins.ts` - 置顶数据存储和读取

### 样式
- `src/styles/content.css` - 所有注入UI的样式

### 工具函数
- `src/bili/faceKey.ts` - 从头像URL生成稳定的key（`face:<hash>` 或 `faceh:<short_hash>`）

## 调试工具

- `window.__biliPin.dump()` - 输出“关注UP推荐列表定位”诊断信息
- `window.__biliPin.cache()` - 输出 portal 缓存命中情况（mid/name）
- 实现位置：`src/bili/debugBridge.ts`

## 开发流程

1. **修改代码**
2. **构建**：`npm run build`
3. **加载扩展**：`chrome://extensions` → 刷新扩展
4. **测试**：刷新动态页 `https://t.bilibili.com/`

## 注意事项

1. **B站页面结构可能变化**：选择器集中在 `src/bili/selectors.ts`，如果失效需要更新
2. **Chrome 执行世界**：动态页 content script 需运行在 `world: 'MAIN'` 才能拦截页面请求（隔离世界改 fetch 无效）
3. **命名约定**：代码中统一使用 `mid` 表示 B 站用户 id（数字字符串）；历史字段名 `uid` 仅用于兼容读取
4. **幂等性**：所有UI注入必须保证幂等，避免重复渲染
5. **数据迁移**：`src/storage/pins.ts` 兼容读取旧字段 `uid`，并会在读取时写回为新结构

## 参考文档

- **PRD**：`plans/prd.md` - 产品需求文档
- **Roadmap**：`plans/roadmap.md` - 版本规划（已更新真实进度）

---

**交接完成**：请新会话先阅读此文档，然后听从用户的反馈进行下一步操作。

