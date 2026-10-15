# 合并项目:视频、图片、对话并入同一个工作台(2026-10-15)

这个分支 `merge-workspaces` 收拢了把生图站、聊天站并入工作台的全部改动。
`main` 停在合并之前(`6dba6e0`)。

## 工作台(本仓库 src/)

| 提交 | 内容 |
|---|---|
| `1418708` | 工作台里生图:生图模型、参数、后台生图任务、图片卡片、做成视频 / 作参考图 |
| `412e210` | 去掉画质(实测中转站不生效) |
| `5f4daf3` | 对话挂在 /chat、聊天记录存服务器(/api/chat-store)、提示词优化、切换模型不卡顿 |
| `95a49f9` | 生图价格与中转站同步(阶梯计价表达式)、对话目录跳转修复 |
| `f8d872d` | 分辨率改回 1K / 2K / 4K,价格按档位显示;资产索引并发写入不丢记录 |
| `7c819af` … `b6971f2` | 每日备份到对象存储 backups/(scripts/backup-data.mjs、deploy/) |
| `6e302a8` | 设置里选提示词优化模型;媒体和备份保留 60 天 |

## 聊天程序(chat-workspace/)

来自 `Roins-hub/sub2-ai-workspaces` 的 `tangzhi` 分支 `d2a09e2` 的 chat-workspace 目录,是独立的 Next.js 项目
(自己的 package.json、Dockerfile、docker-compose),不参与工作台的构建、lint 和测试。

- 构建两份:`NEXT_PUBLIC_CHAT_MODE=mote NEXT_PUBLIC_BASE_PATH=/chat` 是挂在 vip.tangzhi.org/chat 的工作台版
  (容器 mote-chat,端口 13003);不带参数是旧站 chat.tangzhi.org(容器 sub2image-chat,端口 13002,带搬家提示)。
- nginx:vip.tangzhi.org 的 `location ~ ^/chat(/|$)` 转发到 127.0.0.1:13003。

`sub2-ai-workspaces-patches/` 是 sub2-ai-workspaces 仓库里这次合并的 4 个原始提交(`git format-patch` 导出),
包括生图旧站 image.tangzhi.org 的搬家提示。需要放回那个仓库时:`git am merge/sub2-ai-workspaces-patches/*.patch`
(基于 `580557c`)。
