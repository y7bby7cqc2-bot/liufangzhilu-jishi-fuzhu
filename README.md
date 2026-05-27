# POE2 集市提醒器

本工具用于本地监控你手动创建的 POE2 市集搜索页面。它会定时打开搜索 URL 检查页面结果，发现新的可见结果后弹窗和系统通知，并打开对应搜索页面供你手动确认。

它不会自动点击购买、传送到仓库、提交交易、绕过登录或规避风控。

## 运行

```bash
npm install
npm run dev
```

## Windows 打包

```bash
npm install
npm run dist:win
```

打包产物会生成在 `dist/` 目录。

## 一键更新

软件已接入 `electron-updater`。普通用户不需要 Git 权限，也不需要安装 Git；只要安装包来自公开的 GitHub Releases，点击软件里的“检查更新”即可下载新版本，下载完成后点击“安装并重启”。

发布配置已经指向 `y7bby7cqc2-bot/liufangzhilu-jishi-fuzhu`。之后用下面命令发布 Windows 安装包：

```bash
GH_TOKEN=你的_GitHub_Token npm run publish:win
```

如果仓库或 Release 设为私有，发给其他人的软件检查更新时会遇到权限问题。建议用于分发更新的 Release 保持公开；源码仓库可以按需要单独管理。

## 使用流程

1. 点击“打开登录窗口”，在打开的市集页面里手动登录。
2. 在官方市集里手动设置筛选条件，并搜索一次。
3. 复制生成的搜索 URL，回到工具里添加搜索。
4. 设置检查间隔，建议不低于 60 秒。
5. 点击“开始监控”。

## 结果选择器

默认选择器是：

```css
.row, .resultset .row, [data-id]
```

如果市集页面结构变化，可以根据页面里真实的结果行元素调整这个选择器。
