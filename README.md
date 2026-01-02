# Bili Pin

一个轻量级的 Bilibili 浏览器扩展，置顶你的宝藏UP主，解决“关注了但错过动态乃至遗忘了曾经喜欢的UP主”的烦恼。

## ✨ 主要功能

- **📌 动态页置顶栏**
  在 B 站动态首页 (`t.bilibili.com`) 顶部增加“置顶动态”头像栏。
  - 点击头像：快速筛选查看该 UP 的动态。
  - 拖拽排序：自定义头像排列顺序。

- **🚀 全站快捷操作**
  为了保持流畅的原生体验，我们在多处集成了置顶入口：
  - 动态页推荐横条（头像右上角图钉按钮）
  - 动态卡片右上角“三点菜单”
  - UP 主空间页 / 视频播放页的“已关注”菜单

- **🕒 关注时间显示**
  在个人空间“全部关注”列表中显示精确的关注时间，帮你回忆“入坑”时刻。

- **🔒 隐私安全**
  纯前端实现，所有数据仅存储在本地浏览器 (`chrome.storage.local`)，绝不上传任何服务器。

## 📦 安装指南

### 方法一：加载已解压的扩展程序 (开发者/源码安装)

1. **获取代码**
   ```bash
   git clone https://github.com/your-username/bili-pin.git
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

## 🛠️ 本地开发

本项目使用 [WXT](https://wxt.dev/) 框架开发，支持 TypeScript。

### 常用命令

```bash
# 启动开发服务器 (支持热重载)
npm run dev

# 构建生产版本
npm run build

# 打包发布文件 (.zip)
npm run zip
```

### 项目文档

- [PRD (产品需求)](docs/prd.md): 了解设计初衷与详细功能定义。
- [Handoff (技术架构)](HANDOFF.md): 了解核心实现原理、运行环境隔离与拦截策略（**贡献代码前必读**）。
- [Roadmap (版本规划)](docs/roadmap.md): 查看未来计划。
