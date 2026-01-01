# Bili Pin

一个纯前端浏览器扩展：

- 在 B 站网页版动态页 `https://t.bilibili.com/` 增加“置顶动态”头像栏，方便快速筛选你最常看的UP。
- 在 UP 个人空间页 `https://space.bilibili.com/*` 的“已关注”菜单里增加“置顶动态/取消置顶”，与动态页置顶数据共用。

## 开发环境

- Windows 10/11
- Node.js（建议 LTS）

## 本地开发（WXT）

第一次安装依赖：

```bash
npm i
```

生成 WXT 的 TypeScript 配置：

```bash
npm run prepare
```

开发模式：

```bash
npm run dev
```

生产构建：

```bash
npm run build
```

## 在 Chrome 中加载扩展（生产构建）

1. 先运行 `npm run build`
2. 打开 Chrome 扩展管理页：`chrome://extensions`
3. 打开右上角 **开发者模式**
4. 点击 **加载已解压的扩展程序**，选择本项目生成的 `.output/chrome-mv3` 目录

## 需求与规划

- **PRD（主需求文档）**：[`plans/prd.md`](plans/prd.md)
- **Roadmap（版本规划）**：[`plans/roadmap.md`](plans/roadmap.md)
- **任务交接文档**：`plans/HANDOFF.md` - 新会话请先阅读此文档了解当前状态和待办事项

## 协作约定（对人类 & AI）

- **每次完成一个“可验收”的改动后，必须同步更新 `plans/HANDOFF.md`**：写清改动点、涉及文件、如何验证，并删除过时描述，避免文档落后于实现。

## 说明

- 置顶数据会存到本地 `chrome.storage.local`（不会上传到任何服务器）


