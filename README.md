<div align="center">
  <img src="public/icons/icon.svg" width="120" height="120" alt="Bili Pin Logo" />
  <h1>Bili Pin</h1>
  <p>一个 Bilibili 浏览器扩展，在动态页置顶你最关心的 UP 主，并把置顶入口延伸到动态卡片、搜索页、空间页和视频页。</p>
</div>

## ✨ 主要功能

- **📌 动态页置顶栏**
  在 B 站动态首页 (`t.bilibili.com`) 顶部增加“置顶”头像栏。
  - 点击头像：快速筛选查看该 UP 的动态。
  - 拖拽排序：自定义头像排列顺序。
  - 底部拖拽手柄：可纵向拉伸置顶栏，并在刷新后保持上次高度。
  - 点击整行标题（含空白处）折叠/展开，右侧仅显示折线图标：收起整个头像区域，只保留标题和数量；展开后恢复原有高度，刷新后保留折叠状态。
  - 超出可视高度时：列表内部滚动。

- **动态页热搜折叠**
  点击“bilibili热搜”的整行标题也可折叠/展开，右侧仅显示折线图标；收起后只保留标题；与置顶栏独立记忆状态。

- **社区中心简洁入口**
  动态页右侧社区中心大图压缩为 40px 高的白底文字入口，点击“bilibili社区中心 ↗”沿用原图的跳转行为，支持键盘操作。入口与收起的热搜栏使用相同字号、字重、图标规格和上下留白。

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
  纯前端实现，无后端服务。配置以 `chrome.storage.sync` 为权威存储，并镜像写入 `chrome.storage.local`；置顶状态按 UP 的 mid 分键保存，避免新设备尚未收到旧列表时覆盖其它 UP；兼容旧格式，在用户操作时迁移已读取的旧数据。

- **🧪 同步摘要**
  点击扩展工具栏图标，可快速查看置顶数量和最后数据更新时间（不代表云端同步完成）。

## 🧩 实现摘要

- **运行环境拆分**
  - 动态页和空间页的内容脚本运行在 `MAIN` world，尽早拦截必须的 B 站接口，只缓存 `portal/uplist/feed/relation` 这些真正依赖的响应。
  - 搜索页内容脚本运行在 `MAIN` world，但不拦截 API，只基于用户结果卡片中的 space 链接注入置顶入口。
  - 视频页同样运行在 `MAIN` world，但当前不拦截 API，而是直接读取 `window.__INITIAL_STATE__` 和页面 DOM 来识别 UP 主。
- **存储访问**
  - `entrypoints/storageBridge.content.ts` 运行在 `ISOLATED` world，为 `MAIN` world 提供 `chrome.storage.local/sync` 代理。
  - 置顶/取消按 mid 分键同步，排序单独保存，兼容 v3/v2/v1；UI 偏好通过 `storage.onChanged` 主动回灌，已打开页面也会响应远端同步变化。
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

### 新电脑同步与升级

- 使用同一种浏览器、同一个浏览器同步账号，并启用扩展设置同步；登录 B 站账号不会触发扩展配置同步。Chrome 同步关闭时，`storage.sync` 只在本机保存，离线时也要等联网后才同步（[Chrome 官方说明](https://developer.chrome.com/docs/extensions/reference/api/storage#sync)）。源码加载还需保持相同扩展 ID，见上节。
- 新设备首次打开可能暂时为空，收到数据后页面会自动更新。v1.2.3 按 mid 保存操作，新设备新增或取消一个 UP 不会发布空的整表。不同 UP 的离线操作可以共存；同一个 UP 和排序的并发修改由浏览器同步决定。
- 两台设备都需升级至 v1.2.3，旧版本不识别新记录。源码安装用原目录更新并重载扩展。旧列表若只在 local，在保有列表的旧设备进行一次置顶、取消或排序，才会迁移到 sync；仅打开页面不会上传。已被旧版覆盖的数据能否恢复取决于是否还有旧副本。
- 弹窗的时间表示最后数据更新，无法证明云端已经上传/下载完毕。同步受每项 8 KB、总计约 100 KB 和 512 个键的限制；取消记录保留防止复活，也计入键数，超限时拒绝保存。

## 🛠️ 本地开发

本项目使用 [WXT](https://wxt.dev/) 框架开发，支持 TypeScript。

```bash
# 启动开发服务器 (支持热重载)
npm run dev

# 构建生产版本
npm run build

# 运行类型检查
npm run typecheck

# 运行同步/桥接回归（仅内存数据）
npm run test

# 打包发布文件 (.zip)
npm run zip
```

## 📚 项目文档

- [`AGENTS.md`](AGENTS.md) — **AI / 贡献者必读**：维护规范、模块索引、内置浏览器调试与验证流程。
- [`docs/prd.md`](docs/prd.md) — 产品目标、当前功能与数据行为。
- [`docs/roadmap.md`](docs/roadmap.md) — 版本规划与未来计划。
