<div align="center">

# echolog

**把你的每一天，原样回放给你。**

在飞书或 Telegram 里跟一个 bot 对话 —— 文字、照片、语音、视频。
它把一切都以 Markdown 落到本地，再给你写一篇诚实的、
有证据支撑的日记。100% 本地优先 (local-first)；模型自带 (bring your own LLM)。

[English](README.md) | 简体中文

[![CI](https://github.com/BillLucky/echolog/actions/workflows/ci.yml/badge.svg)](https://github.com/BillLucky/echolog/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](https://nodejs.org)
[![Platforms](https://img.shields.io/badge/platforms-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey.svg)](#-快速上手)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

</div>

---

## echolog 是什么？

echolog 把你本来就会发给自己的那些消息，变成一份结构化的个人日记。
你一整天给一个私有 bot 发私信；echolog 把每条消息连同媒体一起，
按它**发送**的那一天归档，然后在你执行 `/diary` 时把一整天的内容回读一遍，
合成一篇**结构化、证据驱动的日记**：事实先行，不堆空洞形容词，
Action Items 用真正的 checkbox。

它是**本地优先 (local-first)** 的：你的原始记录、图片、语音和生成的日记，
都存在你机器上一个朴素的 `Daily_Vault/YYYY-MM-DD/` 文件夹里（对 Obsidian 友好）。
唯一会离开你机器的，只有你发给*你自己*配置的那个 LLM 的文本 ——
而用 Ollama 你连这部分都能留在本地。

```
you ─DM─▶  Feishu / Telegram bot  ──▶  Daily_Vault/2026-06-09/
  text / photo / voice / video         ├── 01_raw_logs.md        (every message, timestamped)
                                        ├── assets/…              (your media)
                         /diary  ──────▶├── 02_diary_v1.md        (LLM-synthesized diary)
                                        └── 00_image_cache.json   (vision descriptions, cached)
```

## ✨ 功能

| | |
|---|---|
| 💬 **对话即采集** | 通过 **飞书**（推荐 —— 无需代理，支持图片/视频/语音）或 **Telegram** 发私信。一切都归档到本地的 Markdown vault。 |
| 🗓️ **按发送时间归档** | 消息按它*发送*的那一天归档，而非接收时间 —— 离线写、之后再同步，依然落到正确的那一天。 |
| 📓 **证据驱动的日记** | `/diary` 读取当天的 logs + 经视觉模型描述的图片，写出一篇结构化日记。硬规则禁止套话；每条结论都要有 log 支撑。 |
| 🖼️ **视觉 (Vision)** | 图片由视觉模型描述，并按文件名缓存 —— 永不重复解析。 |
| 🎙️ **语音 → 文字** | 语音通过 whisper.cpp 在本地转录，折叠进当天的 log（可被搜索、喂给日记）。 |
| 🔎 **搜索与回忆** | `/find` 跨天全文 grep；`/recall` 在本地 embedding 索引上做语义检索。 |
| 🧠 **模型自带 (Bring your own LLM)** | 本地 **Ollama**、任意 **OpenAI 兼容**端点（DeepSeek / Moonshot / OpenAI / MiniMax / OpenRouter / vLLM），或原生 **Anthropic Claude**。 |
| ✍️ **草稿流水线** | `/draft` 把一条采集到的灵感变成推特串 / 长文 / 短视频脚本，并从 recall 索引里拉跨天素材。 |
| 📅 **周报** | `/week` 把过去 7 天卷成一份周度回顾。 |
| 🖥️ **桌面 GUI** | 可选的 Electron 应用，用来浏览 vault、搜索、编辑 prompt、控制 bot —— 不用碰终端。 |
| 🪟 **跨平台** | 支持 **macOS、Linux、Windows**。CLI 是零依赖 Node 脚本；ffmpeg/whisper/ollama 等二进制自动从 `PATH` 探测。CI 在三大系统上各跑一遍完整测试。 |
| 🔒 **本地优先且私密** | Vault、`.env`、状态文件全部 gitignored。用 Ollama 可完全离线运行，或只把日记文本发给你选定的云端 LLM。 |

## 🚀 快速上手

### 1. 前置条件

| 需要 | 为什么 | 安装 |
|---|---|---|
| **Node.js ≥ 22** | 运行时（undici 8 要求 Node 22） | https://nodejs.org |
| **一个 LLM** | 写日记 | 本地 [Ollama](https://ollama.com)，**或**一个云端 API key（见第 3 步） |
| 一个 **飞书** 应用 | 对话通道 | https://open.feishu.cn （或一个 Telegram bot token） |
| *（可选）* `whisper-cpp` + `ffmpeg` | 语音转录 | macOS: `brew install whisper-cpp ffmpeg`；Windows: 暂不支持语音转录 |

### 2. 安装

```bash
git clone https://github.com/BillLucky/echolog.git
cd echolog
npm install
npm link           # installs the `echolog` CLI (no sudo needed with a user node prefix)
cp .env.example .env
```

### 3. 选择你的 LLM（编辑 `.env`）

**本地且私密（Ollama）：**
```bash
LLM_PROVIDER=ollama
OLLAMA_TEXT_MODEL=qwen3.5:9b
OLLAMA_VISION_MODEL=openbmb/minicpm-o2.6:latest
```

**OpenAI 兼容云端**（DeepSeek / Moonshot / OpenAI / MiniMax / OpenRouter / vLLM）：
```bash
LLM_PROVIDER=openai
LLM_API_BASE=https://api.deepseek.com/v1
LLM_API_KEY=sk-xxxx
LLM_TEXT_MODEL=deepseek-chat
```

**Anthropic Claude**（原生 —— 文本 + 视觉同一个模型）：
```bash
LLM_PROVIDER=anthropic
LLM_API_KEY=sk-ant-xxxx
LLM_TEXT_MODEL=claude-sonnet-4-6
LLM_VISION_MODEL=claude-sonnet-4-6
```

### 4. 接入通道并运行

创建一个自建飞书应用，在 `.env` 里填好 `FEISHU_APP_ID` / `FEISHU_APP_SECRET`，
为 `im.message.receive_v1` 开启**长连接**事件订阅，然后：

```bash
echolog start        # 后台启动飞书通道
echolog logs -f      # 实时跟踪日志
echolog tg start     # （可选）Telegram 通道
```

> **Windows 用户**：如未 `npm link`，用 `node bin/echolog start` 替代 `echolog start`。
> `npm link` 需要在管理员终端里跑。详见 [`docs/FEISHU_SETUP.md`](docs/FEISHU_SETUP.md) 第 6 节。

给你的 bot 发几条消息，再发 `/diary`。第一条 p2p 消息会把 bot 跟你配对；
其他任何人都会被静默忽略。

> 完整配置、Telegram 路径，以及每一个 `.env` 选项，都在 [`docs/`](docs/) 和 [`.env.example`](.env.example) 里。

## 🧰 命令

在聊天里发给 bot：

| 命令 | 作用 |
|---|---|
| `/today` · `/yesterday` · `/show YYYY-MM-DD` | 回发那一天的原始 log |
| `/list [N]` | 列出最近 N 天（大小 / 资产数 / 日记版本数） |
| `/find <kw>` | 跨天全文搜索 |
| `/recall <topic>` | 在 embedding 索引上做语义检索 |
| `/diary [YYYY-MM-DD]` | 生成结构化、证据驱动的日记 |
| `/draft <id> [--long\|--video\|--all]` | 把采集到的灵感变成可发布的草稿 |
| `/week` | 过去 7 天的周报 |
| `/rate <1-5>` | 给最近一份日记打分（喂给 prompt 自审） |
| `/help` | 命令帮助 |

## 🖥️ 桌面 GUI（可选）

`desktop/` 是一个 Electron + React 应用，用来浏览 vault、搜索、编辑/管理 prompt 版本，
以及启停 bot —— 给不想常驻终端的人用。

```bash
cd desktop && npm install && npm run dev    # develop
npm run package                              # build a macOS app
```

## 🔒 隐私

- 你的 vault（`Daily_Vault*/`）、`.env` 和通道状态文件都已 **gitignored**，永不离开你的机器。
- 用 Ollama 可**完全离线**运行；或配置一个云端 LLM —— 这种情况下只有日记/周报的*文本*会发给你选定的服务商，受其条款约束（见 [NOTICE](NOTICE)）。
- Telegram 通道硬性白名单只放行你自己的 user id；飞书通道锁定第一个给它发私信的人。

## 📚 更多

- **配置与定制 prompt** —— [`docs/`](docs/) · [`.env.example`](.env.example)
- **贡献与开发环境** —— [CONTRIBUTING.md](CONTRIBUTING.md) · **路线图** —— [ROADMAP.md](ROADMAP.md)
- **AI 编码指南** —— [CLAUDE.md](CLAUDE.md) · **更新日志** —— [CHANGELOG.md](CHANGELOG.md) · **安全** —— [SECURITY.md](SECURITY.md)
- **English** —— [English](README.md)

## 🙌 贡献者

echolog 在开放中构建。感谢每一位让它变得更好的人：

- [@BillLucky](https://github.com/BillLucky) —— 创建者与维护者
- [@ShengVP](https://github.com/ShengVP) —— Windows 跨平台支持：零依赖 Node CLI、跨平台二进制探测、去硬编码路径（[#3](https://github.com/BillLucky/echolog/pull/3)）

我们真心欢迎新贡献者 —— 从 [CONTRIBUTING.md](CONTRIBUTING.md) 和 [good first issues](https://github.com/BillLucky/echolog/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) 开始。你的第一个 PR 就能出现在这份名单里。🚀

## 许可证

[Apache-2.0](LICENSE) © echolog contributors。第三方组件见 [NOTICE](NOTICE)。
