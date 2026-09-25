<div align="center">

<img src="./assets/readme/mote-hero.png" alt="Mote：从一次输入延伸到对话、图片与视频，并保存到本地" width="100%" />

<img src="./assets/readme/mote-wordmark.svg" alt="openCreator Mote — Local Creative Workspace" width="460" />

### Create with any model. Keep everything local.

一个为连续对话、图片与视频生成而生的本地 AI 工作台。<br />
把原本散落在代码里的模型调用，收进一个安静、顺手的界面。

[![Next.js](https://img.shields.io/badge/Next.js-16-171716?style=flat-square&logo=nextdotjs&logoColor=white)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-171716?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Local first](https://img.shields.io/badge/storage-local%20first-6f7651?style=flat-square)](#本地优先)
[![Tests](https://img.shields.io/badge/tests-100%20passing-6f7651?style=flat-square)](#开发与检查)

</div>

---

## 一处输入，三种创作

| CHAT | IMAGE | VIDEO |
| :--- | :--- | :--- |
| 保留上下文的连续对话，在多个历史会话之间自由切换。 | 文生图、图生图、多参考图、尺寸比例与批量生成。 | 文生视频、首帧、首尾帧和多参考图模式，支持异步任务状态。 |

Mote 不是云端平台，也不准备替你管理账号。它只是一个运行在自己电脑上的轻量外壳：连接你已经拥有的模型接口，把配置、对话、上传内容和生成结果留在项目目录里。

你可以将这个项目在本地部署，在里面配置 `seedance-1.5pro` 等等 的 `apikey` ，然后自由的使用。

<p align="center">
  <img src="./assets/readme/mote-workspace.png" alt="Mote 主界面：历史对话、图片生成与创作输入框" width="100%" />
</p>

<p align="center"><sub>在同一处完成对话、加入参考图片，并生成和保存创作结果。</sub></p>

## 现在已经能做什么

- **多供应商与多模型**：同一供应商可以配置多个聊天、图片或视频模型。
- **连续对话**：保留上下文，支持多会话、重命名、搜索和删除确认。
- **灵活加入图片**：点击选择、复制粘贴或直接拖入输入框。
- **图片生成参数**：智能/自定义比例、2K/4K、1–4 张生成数量。
- **视频生成参数**：参考模式、比例、分辨率、3–60 秒模型上限、数量、声音与水印。
- **友好的等待过程**：生成状态轮播、任务轮询和运行中停止。
- **本地资产库**：统一查看图片与视频，支持回收站和永久删除。
- **真实连通性测试**：验证凭证与接口，不用一次付费生成冒充“测试成功”。
- **模型能力约束**：可为不同模型设置最大参考图数量和最长视频时长。

## 把模型带进来

供应商、接口类型与模型能力都集中在一个页面。你可以为每个模型分别声明用途、参考图上限和视频时长，再通过真实连通性测试确认配置。

<p align="center">
  <img src="./assets/readme/mote-settings.png" alt="Mote 模型设置页面：供应商、接口类型与模型能力配置" width="100%" />
</p>

<p align="center"><sub>凭证仅保存在本机；截图中的 API Key 已遮罩。</sub></p>

## 支持的接口类型

| 接口类型 | 鉴权方式 | 对话 | 图片 | 视频 |
| :--- | :--- | :---: | :---: | :---: |
| 火山方舟 | Bearer API Key | ✓ | ✓ | ✓ |
| OpenAI Compatible | Bearer API Key | ✓ | 取决于上游 | 取决于上游 |
| Dola Pool 视频 | Bearer API Key | — | — | ✓ |
| 即梦视觉 | Volcengine AK / SK | — | ✓ | ✓ |
| 可灵 API 2.0 | Bearer API Key | — | ✓ | ✓ |

> 模型能力最终以上游官方文档为准。Mote 会尽量在请求发出前拦截不支持的参考图数量、时长和生成模式，避免无效调用。

## 快速开始

### 1. 启动

```bash
git clone git@github.com:hughedward/openCreator.git
cd openCreator
npm install
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000)。

### 分享给没有 Node.js 的朋友

项目可以生成内置 Node.js 的便携包。对方解压后双击 **Start Mote** 即可，
不需要安装 Node.js，也不需要使用命令行。

```bash
# 当前 Apple Silicon Mac（默认也会自动识别当前 Mac 架构）
npm run dist:portable -- mac-arm64

# Intel Mac
npm run dist:portable -- mac-x64

# Windows 64 位
npm run dist:portable -- win-x64
```

生成的压缩包位于 `dist/`。macOS 使用 `Start Mote.command`，Windows 使用
`Start Mote.cmd`；对应的 Stop 文件用于停止后台服务。配置、API Key、会话和生成内容
保存在解压目录下的 `data/`、`out/` 中，因此升级或转发软件时不要把自己的 `data/`
目录分享给别人。

macOS 首次运行未签名的启动文件时，可能需要在 Finder 中右键选择 **打开**。

### 2. 配置供应商

进入右下角的 **设置**，添加供应商并选择对应的接口类型：

```text
供应商名称   方便自己识别即可
接口类型     火山方舟 / OpenAI Compatible / Dola Pool 视频 / 即梦视觉 / 可灵 API 2.0
Base URL     上游服务地址
凭证         API Key，或即梦视觉所需的 AK / SK
Model ID     上游模型 ID；即梦视觉填写官方 req_key
模型类型     对话 / 图像 / 视频
```

保存前可以点击模型右侧的 **测试**，检查地址、凭证和模型配置。

<details>
<summary><strong>常用 Base URL 示例</strong></summary>

| 服务 | Base URL |
| :--- | :--- |
| 火山方舟 | `https://ark.cn-beijing.volces.com/api/v3` |
| DeepSeek | `https://api.deepseek.com` |
| 即梦视觉 | `https://visual.volcengineapi.com` |
| 可灵 API 2.0 | `https://api-singapore.klingai.com` |

</details>

### Dola Pool 配置

在设置页添加供应商，选择 `Dola Pool 视频`，填写：

```text
Base URL: https://dola.tangzhi.org/v1
API Key:  管理面板“API 密钥”中创建的客户 Key
模型类型: 视频
Model ID: 留空，点击“同步上游模型”自动获取
```

保存供应商后直接点击“同步上游模型”即可，不需要手动填写 Model ID。Mote 会调用 Dola Pool 的 `/models`、`/videos/generations`、`/videos/{id}`
和 `/videos/{id}/content` 接口。参考图片会以 `reference_images` 传递。

## 本地优先

Mote 没有用户系统、远程数据库或遥测服务。你的工作内容保存在本机：

```text
data/
├── config.json             # 供应商、模型与密钥配置
└── conversations/          # 历史会话

out/
├── uploads/                # 上传的参考图片
├── images/                 # 生成的图片
└── videos/                 # 生成的视频
```

- 密钥不会写入浏览器 `localStorage`。
- 设置页面显示的是遮罩值，只有主动点击眼睛按钮才从本机读取。
- `data/`、`out/`、`.env*` 已加入 `.gitignore`，不会被提交到仓库。
- 上游返回临时媒体地址后，Mote 会尽快下载到 `out/`。

## 项目结构

```text
src/
├── app/
│   ├── api/                # 配置、会话、生成、任务与资产接口
│   ├── assets/             # 本地资产页面
│   └── settings/           # 模型设置页面
├── components/             # 聊天、参数面板、侧栏与资产组件
└── lib/
    ├── providers/          # 方舟、OpenAI、Dola、即梦与可灵适配器
    ├── *-store.ts          # JSON 与媒体存储
    └── schemas.ts          # 配置和请求校验
```

技术栈保持得很轻：**Next.js 16 · React 19 · TypeScript · Zod · Vitest**。

## 开发与检查

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

## 当前边界

- 这是单用户、本机使用的工具，不包含登录、权限和多设备同步。
- 不同厂商的图片、视频参数并不完全一致；适配器只发送官方支持的字段。
- 即梦视觉和可灵目前不提供通用的远端任务取消能力。点击停止会结束本机等待，但云端任务可能继续执行。
- 连通性测试不会发起付费生成；最终模型效果仍需要使用自己的凭证实际验证。

---

<div align="center">

**Mote** — quiet tools for noisy ideas.

</div>
