<div align="center">
  <img src="public/icons/icon.svg" width="120" height="120" alt="Bili Pin Logo" />
  <h1>Bili Pin</h1>
  <p>一个 Bilibili 浏览器扩展，在动态页置顶你最关心的 UP 主，并把置顶入口延伸到动态卡片、搜索页、空间页和视频页。</p>
</div>

## ✨ 主要功能

- **📌 动态页置顶栏**
  在 B 站动态首页 (`t.bilibili.com`) 顶部增加“置顶 UP 主”头像栏。
  - 点击头像：快速筛选查看该 UP 的动态。
  - 拖拽排序：自定义头像排列顺序。
  - 底部拖拽手柄：可纵向拉伸置顶栏，并在刷新后保持上次高度。
  - 超出可视高度时：列表内部滚动，不再依赖旧版“展开/收起”切换。

- **🚀 全站快捷操作**
  为了保持流畅的原生体验，我们在多处集成了置顶入口：
  - 动态页推荐横条（头像右上角图钉按钮）
  - 动态卡片右上角“三点菜单”
  - 动态页头像 / 昵称 hover 用户资料卡
  - 搜索页用户结果卡片
  - UP 主空间页 / 视频播放页的“已关注”菜单

- **🕒 关注时间显示**
  在个人空间“全部关注”列表中显示精确的关注时间，帮你回忆“入坑”时刻。

- **🔒 隐私安全**
  纯前端实现，无后端服务。配置以 `chrome.storage.sync` 为主存储，并镜像写入 `chrome.storage.local` 作为同机回退；置顶列表使用压缩同步状态并兼容旧数据迁移，无需手动导出。

- **🧪 同步摘要**
  点击扩展工具栏图标，可快速查看头像数量和最后同步时间。

## 🧩 实现摘要

- **运行环境拆分**
  - 动态页和空间页的内容脚本运行在 `MAIN` world，尽早拦截必须的 B 站接口，只缓存 `portal/uplist/feed/relation` 这些真正依赖的响应。
  - 搜索页内容脚本运行在 `MAIN` world，但不拦截 API，只基于用户结果卡片中的 space 链接注入置顶入口。
  - 视频页同样运行在 `MAIN` world，但当前不拦截 API，而是直接读取 `window.__INITIAL_STATE__` 和页面 DOM 来识别 UP 主。
- **存储访问**
  - `entrypoints/storageBridge.content.ts` 运行在 `ISOLATED` world，为 `MAIN` world 提供 `chrome.storage.local/sync` 代理。
  - 置顶列表以压缩状态同步，保留旧版本状态兼容读取；UI 偏好通过 `storage.onChanged` 主动回灌，已打开页面也会响应远端同步变化。
- **样式注入**
  - 扩展样式通过 JS 动态插入 `<style>` 标签，而不是在 manifest 里声明内容脚本 CSS，以减少对 Dark Reader 等插件的干扰。

## 📦 安装指南

### 加载已解压的扩展程序 (源码安装)

1. **获取代码**
   ```bash
   git clone https://github.com/jiyu93/bili-pin.git
   cd bili-pin
   ```

2. **安装依赖并构建**
   ```bash
   npm install
   npm run build
   ```

3. **加载到 Chrome/Edge**
   - 打开扩展管理页：Chrome 输入 `chrome://extensions`，Edge 输入 `edge://extensions`。
   - 开启右上角的 **开发者模式**。
   - 点击 **加载已解压的扩展程序**。
   - 选择项目根目录下的 `.output/chrome-mv3` 文件夹。

### 跨设备本地调试（保持相同扩展 ID）

- 项目会优先读取 `config/manifest-key.txt` 中的公钥作为 `manifest.key`，这样两台电脑加载同一份源码构建产物时会得到同一个扩展 ID。
- 仓库中的 `config/manifest-key.txt` 是公开的 Chrome Web Store public key，属于刻意提交的公开配置，不是私钥。
- 你只需要把同一个 `config/manifest-key.txt` 保持在两台电脑一致即可。
- 如果后续需要重新生成固定身份，请保留你自己的私钥文件；仓库里只需要公钥文本。

## 🛠️ 本地开发

本项目使用 [WXT](https://wxt.dev/) 框架开发，支持 TypeScript。

```bash
# 启动开发服务器 (支持热重载)
npm run dev

# 构建生产版本
npm run build

# 运行类型检查
npm run typecheck

# 打包发布文件 (.zip)
npm run zip
```

## 📚 项目文档

- **`AGENTS.md`** — **AI / 贡献者必读**：核心架构、开发规范、内存泄漏防护、功能模块速查、验收清单。
- [`docs/prd.md`](docs/prd.md) — 项目简介、背景与当前结构说明。
- [`docs/roadmap.md`](docs/roadmap.md) — 版本规划与未来计划。
