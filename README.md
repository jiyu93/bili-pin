# Bili Pin

一个纯前端 Bilibili 浏览器扩展，帮你管理常看的 UP 主。

## 主要功能

1.  **动态页置顶栏**：在 `https://t.bilibili.com/` 增加“置顶动态”头像栏，点击即可筛选查看该 UP 的动态。支持拖拽排序。
2.  **全站快捷置顶**：
    *   动态页推荐横条（图钉按钮）
    *   动态卡片三点菜单
    *   UP 主空间页 / 视频播放页的“已关注”菜单
3.  **关注时间显示**：在个人空间“全部关注”列表中显示精确的关注时间。
4.  **隐私安全**：所有数据存储在本地 `chrome.storage.local`，不上传任何服务器。

## 协作约定（对 AI & 人类）

- 请先阅读以下文档了解项目需求、当前状态和待办事项。
- **PRD（主需求文档）**：[`plans/prd.md`](plans/prd.md)
- **Roadmap（版本规划）**：[`plans/roadmap.md`](plans/roadmap.md)
- **任务交接文档**：[`plans/handoff.md`](plans/handoff.md)
- **每次完成一个“可验收”的改动后，务必回来更新 [`plans/handoff.md`](plans/handoff.md)文档**：写清改动点、涉及文件、如何验证，并删除过时描述，避免文档落后于实现。
- **版本号规范**：
  - 功能变更增加第二位数字（v1.1.0）
  - 只修 Bug 无功能变更只增加第三位数字（v1.0.1）

## 如何在 Chrome 中加载本插件（生产构建）

1. 先运行 `npm run build`
2. 打开 Chrome 扩展管理页：`chrome://extensions`
3. 打开右上角 **开发者模式**
4. 点击 **加载已解压的扩展程序**，选择本项目生成的 `.output/chrome-mv3` 目录
