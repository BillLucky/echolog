<div align="center">

# echolog

**Your days, echoed back.**

Talk to a bot in Feishu or Telegram — text, photos, voice, video.
It archives everything locally as Markdown, then writes you an honest,
evidence-based diary. 100% local-first; bring your own LLM.

English | [简体中文](README.zh-CN.md)

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22-brightgreen.svg)](https://nodejs.org)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

</div>

---

## What is echolog?

echolog turns the messages you already send yourself into a structured personal
journal. You DM a private bot throughout the day; echolog files each message —
with media — under the day it was sent, then on `/diary` it reads the whole day
back and synthesizes a **structured, evidence-driven diary**: facts first, no
empty adjectives, action items as real checkboxes.

It's **local-first**: your raw logs, images, voice, and generated diaries live in
a plain `Daily_Vault/YYYY-MM-DD/` folder on your machine (Obsidian-friendly). The
only thing that ever leaves your machine is the text you send to whichever LLM
*you* configure — and you can keep even that local with Ollama.

```
you ─DM─▶  Feishu / Telegram bot  ──▶  Daily_Vault/2026-06-09/
  text / photo / voice / video         ├── 01_raw_logs.md        (every message, timestamped)
                                        ├── assets/…              (your media)
                         /diary  ──────▶├── 02_diary_v1.md        (LLM-synthesized diary)
                                        └── 00_image_cache.json   (vision descriptions, cached)
```

## ✨ Features

| | |
|---|---|
| 💬 **Chat to capture** | DM via **Feishu** (recommended — no proxy, images/video/voice) or **Telegram**. Everything archived to a local Markdown vault. |
| 🗓️ **Archived by send-time** | Messages file under the day they were *sent*, not received — write offline, sync later, it still lands on the right day. |
| 📓 **Evidence-driven diaries** | `/diary` reads the day's logs + vision-described images and writes a structured diary. Hard rules ban fluff; every claim needs a log to back it. |
| 🖼️ **Vision** | Images are described by a vision model and cached by filename — never re-analyzed. |
| 🎙️ **Voice → text** | Voice notes transcribed locally via whisper.cpp and folded into the day's log (searchable, feeds the diary). |
| 🔎 **Search & recall** | `/find` full-text grep across days; `/recall` semantic search over a local embedding index. |
| 🧠 **Bring your own LLM** | Local **Ollama**, any **OpenAI-compatible** endpoint (DeepSeek / Moonshot / OpenAI / MiniMax / OpenRouter / vLLM), or **Anthropic Claude** natively. |
| ✍️ **Draft pipeline** | `/draft` turns a captured idea into a Twitter thread / long-form post / short-video script, pulling cross-day material from the recall index. |
| 📅 **Weekly reports** | `/week` rolls the past 7 days into a weekly review. |
| 🖥️ **Desktop GUI** | Optional Electron app to browse the vault, search, edit prompts, and control the bot — no terminal needed. |
| 🔒 **Local-first & private** | Vault, `.env`, and state files are all gitignored. Run fully offline with Ollama, or send only diary text to a cloud LLM you choose. |

## 🚀 Quickstart

### 1. Prerequisites

| Need | Why | Install |
|---|---|---|
| **Node.js ≥ 22** | runtime (undici 8 requires Node 22) | https://nodejs.org |
| **An LLM** | writes the diaries | local [Ollama](https://ollama.com), **or** a cloud API key (see step 3) |
| A **Feishu** app | the chat channel | https://open.feishu.cn (or a Telegram bot token) |
| *(optional)* `whisper-cpp` + `ffmpeg` | voice transcription | macOS: `brew install whisper-cpp ffmpeg`; Windows: 暂不支持语音转录 |

### 2. Install

```bash
git clone https://github.com/BillLucky/echolog.git
cd echolog
bash scripts/setup.sh      # one command: checks Node, npm install, installs the `echolog` CLI, prepares .env, runs a doctor check
```

> **Windows users**: the bash setup script won't run natively. Do the manual steps below instead.
> `npm link` requires an admin terminal on Windows. Or skip it entirely and use `node bin/echolog <command>`.

<details><summary>…or do it manually (also: Windows)</summary>

```bash
npm install
npm link            # installs the `echolog` CLI (macOS/Linux: no sudo needed with a user node prefix; Windows: admin terminal)
cp .env.example .env
```
</details>

### 3. Pick your LLM (edit `.env`)

**Local & private (Ollama):**
```bash
LLM_PROVIDER=ollama
OLLAMA_TEXT_MODEL=qwen3.5:9b
OLLAMA_VISION_MODEL=openbmb/minicpm-o2.6:latest
```

**OpenAI-compatible cloud** (DeepSeek / Moonshot / OpenAI / MiniMax / OpenRouter / vLLM):
```bash
LLM_PROVIDER=openai
LLM_API_BASE=https://api.deepseek.com/v1
LLM_API_KEY=sk-xxxx
LLM_TEXT_MODEL=deepseek-chat
```

**Anthropic Claude** (native — text + vision in one model):
```bash
LLM_PROVIDER=anthropic
LLM_API_KEY=sk-ant-xxxx
LLM_TEXT_MODEL=claude-sonnet-4-6
LLM_VISION_MODEL=claude-sonnet-4-6
```

### 4. Connect a channel & run

Create a self-built Feishu app and fill `FEISHU_APP_ID` / `FEISHU_APP_SECRET` in `.env`.
**[`docs/FEISHU_SETUP.md`](docs/FEISHU_SETUP.md) is paste-ready** — copy the permission list,
event subscriptions, and the bot-menu `event_key` table straight into the console. Then:

```bash
echolog start        # run the Feishu channel in the background
echolog logs -f      # follow logs
echolog tg start     # (optional) Telegram channel
```

> **Windows**: if you skipped `npm link`, use `node bin/echolog start` (and likewise for
> `stop`, `restart`, `status`, `logs`). See [`docs/FEISHU_SETUP.md`](docs/FEISHU_SETUP.md) section 6.

DM your bot a few messages, then send `/diary`. The first p2p message pairs the
bot to you; everyone else is silently ignored.

> Full setup, the Telegram path, and every `.env` option are in [`docs/`](docs/) and [`.env.example`](.env.example).

## 🧰 Commands

Sent to the bot in chat:

| Command | What it does |
|---|---|
| `/today` · `/yesterday` · `/show YYYY-MM-DD` | echo back that day's raw log |
| `/list [N]` | list the last N days (size / assets / diary versions) |
| `/find <kw>` | full-text search across all days |
| `/recall <topic>` | semantic search over the embedding index |
| `/diary [YYYY-MM-DD]` | generate the structured, evidence-driven diary |
| `/draft <id> [--long\|--video\|--all]` | turn a captured idea into publishable drafts |
| `/week` | weekly report over the past 7 days |
| `/rate <1-5>` | rate the latest diary (feeds prompt self-review) |
| `/help` | command help |

## 🖥️ Desktop GUI (optional)

`desktop/` is an Electron + React app to browse the vault, search, edit/version
prompts, and start/stop the bot — for people who'd rather not live in a terminal.

```bash
cd desktop && npm install && npm run dev    # develop
npm run package                              # build a macOS app
```

## 🔒 Privacy

- Your vault (`Daily_Vault*/`), `.env`, and channel state files are **gitignored** and never leave your machine.
- Run **fully offline** with Ollama, or configure a cloud LLM — in which case only the diary/weekly *text* is sent to the provider you chose, under their terms (see [NOTICE](NOTICE)).
- The Telegram channel hard-allowlists your own user id; the Feishu channel locks to the first person who DMs it.

## 📚 More

- **Configure & customize prompts** — [`docs/`](docs/) · [`.env.example`](.env.example)
- **Contributing & dev setup** — [CONTRIBUTING.md](CONTRIBUTING.md) · **Roadmap** — [ROADMAP.md](ROADMAP.md)
- **AI coding guide** — [CLAUDE.md](CLAUDE.md) · **Changelog** — [CHANGELOG.md](CHANGELOG.md) · **Security** — [SECURITY.md](SECURITY.md)
- **简体中文** — [README.zh-CN.md](README.zh-CN.md)

## License

[Apache-2.0](LICENSE) © echolog contributors. See [NOTICE](NOTICE) for third-party components.
