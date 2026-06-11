# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 仓库定位

私人「极客日记 bot」：通过 Telegram **或** 飞书私聊收发图文/语音/视频/文件，落地到本地 `Daily_Vault/YYYY-MM-DD/`，再用本地 Ollama 模型（视觉 + 文本）合成结构化日记。整个数据链路必须保持本地、私密 —— `Daily_*` / `.env` / `.feishu_state.json` 都已被 `.gitignore`，永远不要把 vault 内容、token、user ID、open_id 提交到仓库。

## 运行 / 开发命令

```bash
npm install

# 全局 CLI（推荐，已通过 npm link 挂到 /opt/homebrew/bin/echolog）
echolog start          # 后台启动飞书通道
echolog logs -f        # 实时跟踪日志
echolog restart        # 改完代码重启
echolog run            # 前台调试

echolog tg start       # Telegram 通道（独立 PID + 日志）

# 不用 CLI 时直接跑（前台）
npm run feishu           # = node feishu.js
npm run tg               # = node telegram.js
```

CLI 实现：`bin/echolog` (Node.js 脚本)，用 `child_process.spawn(detached)` + PID 文件（`~/.echolog/<channel>.pid`）做跨平台进程管理，日志按天写到 `~/.echolog/logs/<channel>-YYYY-MM-DD.log`。Windows 上不支持 bash，用 `node bin/echolog <command>` 替代 `echolog <command>`，或 `npm link` 注册全局命令。

两个通道可同时运行，写到同一个 `Daily_Vault/`，互不干扰（`fs.appendFileSync` append-only）。没有测试、lint、build 流程；改完 `echolog restart` 验证。

依赖本地 Ollama 服务，且这两个 model 必须已 `ollama pull`：
- `qwen3.5:4b` —— 文本模型（写日记）
- `openbmb/minicpm-o2.6:latest` —— 视觉模型（解图片）

飞书通道还需要（语音转文字，可选）：
- macOS：`brew install whisper-cpp ffmpeg`
- Windows：whisper-cpp → https://github.com/ggerganov/whisper.cpp/releases；ffmpeg → `winget install ffmpeg`（目前 Windows 暂不支持语音转录）
- 下载 whisper 模型：`curl -L -o ~/.whisper-models/ggml-large-v3-turbo-q5_0.bin https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin`

飞书通道还需要 `.env`（参考 `.env.example`）：
```
FEISHU_APP_ID=cli_xxxxxxxxxxxxxxxx
FEISHU_APP_SECRET=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```
开放平台侧需打开：事件订阅 → 推送方式 = **使用长连接接收**；订阅 `im.message.receive_v1` 事件；权限至少 `im:message`、`im:message:send_as_bot`、`im:resource`、`im:chat`、`im:message.reaction:write`（reaction 失败不阻塞主流程）。

## 入口文件

只有两个入口，互不依赖：
- `feishu.js` —— 飞书通道（主推，无需代理，支持图片/视频/语音/ASR/markdown 卡片渲染/离线追写）
- `telegram.js` —— Telegram 通道（备用，需要本地代理 127.0.0.1:7897）

两个文件公共逻辑（`getDateContext` / `getOrProcessImageDesc` / diary prompt）目前复制粘贴存在两份。重构成共享模块的成本不高，但飞书侧还在演进，先不抽。早期版本（`index.js`、`index-1..5.js`、`index-6.js`）已删，git 历史里能找回。

所有 secret 走 `.env`（dotenv 加载）：
- `FEISHU_APP_ID` / `FEISHU_APP_SECRET` —— 必填，飞书侧
- `TG_BOT_TOKEN` / `TG_OWNER_ID` / `TG_PROXY_URL` —— 跑 TG 才填
- `OLLAMA_TEXT_MODEL` / `OLLAMA_VISION_MODEL` —— 改默认模型时填

不要把任何 secret 写回源码（`telegram.js` 早期版本写过，已迁移）。

## 近期架构补充（开源化沉淀）

- **`lib/paths.js` —— 统一可写路径（关键）**：`Daily_Vault` / `.feishu_state.json` / `.ticktick-state.json` / `.diary_ratings.jsonl` / `.env` / `prompts` 全部从 `lib/paths.js` 出。设 `ECHOLOG_DATA_DIR`（+ `ECHOLOG_PROMPTS_DIR`）可把数据整体重定位到任意可写目录（打包成 app / 多实例用）；不设则回退仓库根，行为完全不变、已部署实例零迁移。**新增任何可写路径一律走 paths.js，别再 `path.join(__dirname, ...)` 硬编码。**
- **`lib/llm.js` —— 三 provider 抽象**：`LLM_PROVIDER` 选路 `ollama`（默认/本地）/ `openai`（OpenAI 兼容：DeepSeek/Moonshot/MiniMax/OpenRouter/自建 vLLM）/ `anthropic`（Claude 原生 Messages API：`x-api-key` 头、`system` 抽顶层、`max_tokens` 必填、思考默认关、Opus 4.7/4.8 自动不传 sampling）。Anthropic 无 embedding API → `/recall` 的 EMBEDDINGS 走 ollama/openai。调用方统一 `llm.chat()` / `llm.embed()`，返回 shape 跟 ollama-client 兼容。
- **飞书 bot 菜单**：`handleBotMenu` 处理 `application.bot.menu_v6` —— 菜单项 `event_key`（纯命令名如 `diary`）映射成 `/命令` 复用 `tryDispatchCommand`，回信用 `state.paired_chat_id`（菜单事件不带 chat_id，故在收到配对用户 p2p 消息时顺手记下）。可粘贴的权限/事件/菜单配置模板见 `docs/FEISHU_SETUP.md`。

## 数据布局（每天一个目录）

```
Daily_Vault/<YYYY-MM-DD>/
├── 01_raw_logs.md       # 收到的每条消息按时间戳追加（文本 / 图片 markdown 链接）
├── 00_image_cache.json  # 文件名 → 视觉模型描述的 KV 缓存
├── 02_diary_v{N}.md     # 每次 /diary 生成一版，N 自增不覆盖
└── assets/<HHmmss>_*.jpg
```

`getTodayContext()` 是所有路径的唯一来源 —— 任何新增路径都要走它，避免目录散落。

## 核心控制流

**接收阶段（两个通道都遵守）**：消息进来 → 用 **发送时间戳** 解析出归档日期（`Asia/Shanghai`）→ 写入对应日期目录的 `01_raw_logs.md` 并把媒体下到当天的 `assets/`。**绝不能用接收时间归档** —— 用户可能离线写、电脑开机才同步，必须落到当时发送的那一天。

**/diary 指令**（飞书侧的 `generateDiary`，目前 7 段证据驱动模板）：
1. 读对应日期 raw_logs → 正则抽图片 → 对每张图调 `getOrProcessImageDesc()`（缓存到 `00_image_cache.json`）
2. **如果 TickTick 已授权**：调 `ticktick.getTodayContext(dateStr)` 拉今日任务上下文（逾期 / 今天 due / 今天已完成）
3. 用 `DIARY_SYSTEM_PROMPT`（硬规则：禁空洞形容词、必须有证据支撑、Action Items 用 GitHub checkbox 格式）+ `DIARY_TEMPLATE`（7 段：事实清单 / 完成 vs 未完成 / 状态自审 / 模式识别 / 一句话洞察 / Action Items / 隐性观察）+ 注入的 logs + ticktick 上下文
4. ollama options: `temperature: 0.3`（克制）、`num_ctx: 16384`（容纳长上下文）
5. **后置同步**：调 `ticktick.syncActionItems(dateStr, diaryContent)` —— 解析所有 `- [ ] xxx` 行 → SHA256 hash 去重（per-date keyed by normalized text）→ 创建到滴答清单 → 写回 `.ticktick-state.json` 的 `synced[date]`
6. 输出落 `02_diary_v{N}.md`（带丰富 frontmatter：`action_items` / `ticktick_synced` / `ticktick_skipped_dup`）+ 卡片回发

**Prompt 设计原则**（改 prompt 时务必保留）：
- 禁空洞抽象词："充满了""感受到""美好""丰富多彩""力量""收获满满""治愈""惬意"等
- 凡事实必须有 logs 证据，没素材宁可写"（今日无明显信号）"也别编造
- Action Items **必须**用 `- [ ] 动词开头的可执行动作（≤20字）` 格式 —— 这是 `extractActionItems` 正则匹配的硬约束
- temperature ≤ 0.3，避免 LLM "发挥"

视觉缓存是关键设计：图片解析慢且确定性强，缓存以文件名为 key，永远不重跑同一张图。

TG 侧 `/diary` 还是老的三段式 prompt（"高光 / 时间轨迹 / 反思"）+ qwen3.5:9b。如果要升级 TG，把飞书的 prompt + 字符串照搬即可（无 TickTick 集成那部分跳过）。

## 飞书命令体系（`tryDispatchCommand`）

| 命令 | 行为 | 调模型 |
|---|---|---|
| `/today` `/yesterday` `/show YYYY-MM-DD` | 回发该日 `01_raw_logs.md` 原文（剥离 frontmatter，自动分段 5000 字） | 否 |
| `/list [N]` | 列最近 N 天（默认 14）每天的 logs 大小 / asset 数 / diary 版本数 | 否 |
| `/find <关键词>` | 跨日全文 grep，按日期倒序返回最多 20 条 ±100 字上下文（命中词加粗） | 否 |
| `/recall <主题> [N]` (`/ask` 别名) | 跨日**语义**检索（向量索引），返回 top-N 引述 + 相似度 | 是（embedding） |
| `/tasks` (`/todo`、`/dida` 别名) | 拉滴答清单今日上下文（逾期 / 今天 due / 今天已完成）—— 直接显示 | 否 |
| `/diary [YYYY-MM-DD]` | 深度日记 —— 视觉解图 + ticktick 上下文注入 + 10 段证据驱动 prompt + 后置 sync action items + 异步索引该日 logs 到向量库 | 是（vision + text + embedding） |
| `/draft list` / `/draft <id\|标题>` | 选题→写作流水线。默认推特串；`--long` 长文；`--video` 短视频；`--all` 一选三发并发 | 是（text） |
| `/rate <1-5> [评语]` | 给最近一份 diary 打分；不传参数显示历史评分概览 | 否 |
| `/week` | 过去 7 天周报 → 落到 `Daily_Vault/_weekly/<YYYY>-W<NN>.md`（ISO 周）| 是（text） |
| `/help` | 命令帮助 | 否 |

新命令在 `tryDispatchCommand(text, chatId, sendDt)` 里加分支即可，命令处理完都会用 `reactOk(messageId)` 给原消息打 **OK** 表情作为已读标记（早期版本曾用 `THUMBSUP`，已废弃）。

## Obsidian 友好的输出

`01_raw_logs.md` 和 `02_diary_v{N}.md` 都带 YAML frontmatter（date / type / tags / version / generated_at / model / image_count），周报 `_weekly/<YYYY>-W<NN>.md` 同理。这是给 Obsidian Dataview 检索 + 日历视图用的，所以新增的产物文件都应该走相同 frontmatter 格式。

## 飞书通道：离线追写 + 持久化状态

`.feishu_state.json`（gitignored）持有三块状态：
- `paired_open_id` —— 首条 p2p 私聊消息把发送者锁死，从此非该 open_id 全部静默丢弃。删掉这个字段 = 重新进入配对模式。
- `chats[chat_id].last_processed_ts` —— 每个 chat 已处理的最大消息时间戳（毫秒），catchup 的高水位线。
- `processed_message_ids` —— 滚动保留 2000 条已处理 message_id，给 catchup + WS 双通道做幂等去重。

**关键约束**：飞书 bot 的 `im.chat.list` / `im.chat.search` **不返回 p2p 私聊**（已实测，文档未明示）。所以无法从平台主动列出 bot 跟谁有过私聊。我们的策略是双轨拉历史：

1. **启动 catchup（`catchupKnownChats`）**：只对 `state.chats` 里**已知**的 chat_id 做增量拉取，从 `last_processed_ts+1` 到 `now`，按 `ByCreateTimeAsc` 翻页过 `handleMessage`。
2. **新 chat 实时回拉（`backfillNewChat`）**：WS 第一次见到一个不在 state 里的 chat_id 时，先处理这条触发消息，然后**异步**调 `pullChatMessages(chatId, 30天前, 触发消息时间-1)` 把这个 chat 历史 30 天的全部消息都拉回来归档。这是**唯一**能补回「事件订阅生效之前」遗漏消息的路径。

两条路径都把消息按 `create_time` 写到对应日期目录 —— 离线几天 / 平台配置生效晚都能恢复。`pullChatMessages` 里有 `m.sender?.sender_type === 'app'` 跳过自己，避免把 bot 自己发的消息也归档了。

## 飞书媒体下载

二进制走原生 HTTP（`fetch` + `tenant_access_token` Bearer），不走 SDK 包装。**所有 msg_type 都用 messageResource endpoint**：

| msg_type | endpoint | type 参数 |
|---|---|---|
| `image` | `GET /open-apis/im/v1/messages/{message_id}/resources/{image_key}` | `?type=image` |
| `file` / `audio` / `media` | `GET /open-apis/im/v1/messages/{message_id}/resources/{file_key}` | `?type=file` |

⚠️ **不要**用 `/open-apis/im/v1/images/{key}` —— 这个 endpoint 只能下 bot 自己上传的图，下用户发来的图直接 HTTP 400。早期版本踩过坑，已修。

`tenant_access_token` 进程内缓存，提前 60s 续期。文件名格式 `<HHmmss>_<safeName>.<ext>`，与该消息的发送时间一致，方便后续按时间排序回查。

## 失败重试机制（隐式）

`handleMessage` 在 `try` 里跑全部下载/落档逻辑，**只在最后 `markProcessed`**。一旦中间任何步骤抛异常，整个 try 块退出 → catch 仅 console.error，**绝不**回吐错误消息给用户、**绝不**调 markProcessed。所以失败的消息既不进 `processed_message_ids` 去重表、也不更新 chat 的 `last_processed_ts` 高水位线。

下次启动时 catchup 会重新跑 `pullChatMessages(start_time = last_processed_ts+1)`，把这些"漏网的"消息重新拉一遍 → 用修好的代码再处理一次。这是免费的故障恢复 —— 修 bug、重启进程，就能自动追回失败消息，不需要手动 replay，也不会在聊天里堆积过期的「保存失败」错误回复（早期版本回吐过，UX 噪音大，已删）。

## 滴答清单 / TickTick 集成

代码全部在 `lib/ticktick.js`，主进程通过 `require('./lib/ticktick')` 引入。**核心约束**：所有 LLM 输出和 API 写入都必须经过 SHA256 去重，避免 `/diary` 多次跑或并发跑导致重复创建任务。

**OAuth 流（一次性）**：
- 用户在 [开发者后台](https://developer.dida365.com/manage) 创建 app，redirect_uri **必须填** `http://127.0.0.1:8765/callback`
- 用户终端执行 `echolog ticktick-auth` → 进程在 127.0.0.1:8765 起 HTTP 服务器 + 打印 auth URL → 用户浏览器授权 → callback 拿 code → 换 token → 写入 `.ticktick-state.json` → 服务器关闭进程退出
- access_token 默认 180 天有效，到期重跑授权命令即可（API 不返回 refresh_token）

**Token 存储**：`.ticktick-state.json`（gitignored）：
```json
{
  "tokens": { "access_token": "...", "expires_at": <ms epoch>, "obtained_at": "ISO" },
  "synced": {
    "2026-05-01": [
      { "hash": "abc123def456", "task_id": "tt_xxx", "title": "写设计文档", "created_at": "ISO" }
    ]
  }
}
```

**API 端点**（`API_BASE = https://api.dida365.com/open/v1`）：
- `GET /project` 列项目
- `GET /project/{id}/data` 项目内任务（包含 columns、tasks）
- `POST /task` 创建任务

**今日上下文** `getTodayContext(dateStr)` 流程：列所有项目 → 各项目里所有任务平展 → 按 dueDate / completedTime / status 分类 overdue / dueToday / completedToday → `formatContextForPrompt` 转 markdown 注入 prompt。

**Action Items 同步去重 + 路由策略**（重点 —— 早期版本踩坑后才稳定下来）：

- `extractActionItems(diaryText)` —— 返回 `{ tasks: [], notes: [] }` 两个桶。
  - `tasks` 来自 `^\s*[-*]\s*\[\s\]\s*xxx$`（真任务）
  - `notes` 来自 `^\s*[-*]\s*\[\s*📝\s*\]\s*xxx$`（自媒体选题），后跟缩进的 7 字段
- `hashAction(text)` —— normalize（lowercase + collapse whitespace + trim）→ sha256 → 取前 16 hex
- **跨天 dedup**（不是 per-day）：扫整个 `state.synced` 所有日期的条目找匹配 hash。这样 5 月 1 日和 5 月 2 日都跑 `/diary` 时，"修复飞书机器人被杀问题"只创建一次。
- **路由策略**：
  - 默认（无 env）：tasks 和 notes 都进 **Notes 项目（kind: NOTE）** —— 不进 Today 视图、无 dueDate、不制造时间压力
  - 设 `TICKTICK_TASKS_PROJECT_ID=inbox` → tasks 进默认 Inbox
  - 设 `TICKTICK_TASKS_PROJECT_ID=<具体 project_id>` → tasks 进指定项目
- **绝不设置 dueDate**：bot 生成的内容是建议而非承诺，加 dueDate 会污染 Today 视图、累积焦虑。早期版本曾设 `${date}T23:59:59+0800`，导致每天 /diary 都堆积一批"今天 due"任务，已修
- 每条创建后**立即** `saveState`，避免中途崩溃丢同步状态
- 选题创建时 `title.replace(/^标题：\s*/, '')` 剥离 prompt 模板留下的"标题："前缀，让 TickTick 列表更清爽

**新加 TickTick API 调用时**：所有 throw 都会被 `generateDiary` 的 try/catch 兜住，不会让一次 token 过期导致整个 `/diary` 失败。错误只 log 到 stdout，diary 会继续生成 + 把 ticktickBlock 写成"读取失败"。

## 语音转文字（ASR）

收到 `audio` 消息时同步处理：下载 opus → ffmpeg 转 16kHz 单声道 wav → `whisper-cli` 转录 → 把结果作为 `> 🗣️ **[语音转录]** ...` 引用块追加到 raw_logs 同一时间点之后，再回发原文给用户。这样 `/find` 全文搜能命中语音内容，`/diary` 的 PKM 上下文也包含语音原话。

依赖（`lib/utils.js` 的 `findBin` 自动探测，跨平台）：
- `whisper-cli`：macOS `brew install whisper-cpp`；Windows 下载 whisper.cpp releases
- 模型：`~/.whisper-models/ggml-large-v3-turbo-q5_0.bin`（547MB，对中文 WER ~5%，量化版在 M 系列上速度接近 small 模型）
- `ffmpeg`：macOS `brew install ffmpeg`；Windows `winget install ffmpeg`

缓存机制：转录结果写到音频文件同名 `.txt` sidecar（如 `185432_voice.opus.txt`）。`transcribeAudio` 先查 sidecar，命中跳过 whisper 调用。这样 catchup 重跑时不会重复 ASR。

代码位置：`transcribeAudio(audioPath)` —— 在 audio 分支里调用，超时 60s（ffmpeg）+ 180s（whisper）。Apple Silicon M4 Pro 上 30s 语音 ~3-5s 转录完。

`msg_type` 路由：`text` / `image` / `file` / `audio`（opus）/ `media`（mp4 视频）/ `post`（富文本拍平为纯文本）/ `sticker`（忽略）。新增 msg_type 在 `handleMessage` 的 if/else 链里加分支即可。

## 飞书卡片消息（markdown 渲染）

命令输出（`/help`、`/today`、`/list`、`/find`、`/diary`、`/week`）走 `sendMarkdown` / `sendMarkdownChunked` —— 实际发送的是 `msg_type: 'interactive'` + 一个 `{tag: 'markdown', content: ...}` 元素的卡片。这能渲染标题、加粗、列表、quote、表格、inline code、链接，但**不能直接显示本地图片路径**：飞书看到 `![alt](assets/xxx.jpg)` 会因为没有 `image_key` 报错 `11310 - card contains images but no imagekey is passed in`。

`sanitizeMarkdownForFeishu(md)` 会把所有 `![alt](path)` 替换成 `📷 alt \`filename\``，绕过这个限制。所有走 `sendMarkdown` 的内容都自动过这一层 —— 加新输出时不需要手动 strip。

要真显示图片得先把图片上传到飞书的 image API 拿 `image_key`，再放进卡片，本仓库目前没做这一步（个人查看图片直接打开 `Daily_Vault/.../assets/` 即可）。

短状态（"📭 没有记录" / "🧠 正在读取..." / 语音转录回声）继续走 `sendText` —— 不需要排版的纯文本场景。

## 事件订阅噪声处理

bot 自己加的 OK 表情会回声成 `im.message.reaction.created_v1` 事件，已读、撤回、bot 静音等也都会推送。如果不注册 handler，SDK 会给每个未处理事件打 `[warn]: no <event_type> handle`。`main()` 里给这些事件挂了 `noop` 处理函数（reaction.created/deleted、message_read、recalled、bot_muted、user_status_change），保持 stdout 干净。新增订阅事件时同步加进去，否则会噪音。

## 安全边界

- **TG 白名单**：`telegram.js` 的 `bot.use` 里 `ctx.from?.id !== MY_TELEGRAM_ID` 直接 return，连 `next()` 都不调，所有非本人消息静默丢弃。改动这个 middleware 等于打开后门。
- **飞书首次配对锁**：`feishu.js` 第一次收到 p2p 消息把 `sender.open_id` 写进 `.feishu_state.json`；之后任何不匹配的 sender 在 `handleMessage` 顶部就被丢弃。bot 是私有应用、只有你自己能 DM，所以「首条消息 = 配对」这个语义是安全的。要重置就删掉 state 文件里的 `paired_open_id`。
- **TG 硬编码 secret**：`TOKEN` 和 `MY_TELEGRAM_ID` 直接写在 `telegram.js` 头部，是已知代码味道；仓库私有不公开推送，trade-off 接受。如果改 env 变量，先 `git log -p telegram.js` 核对历史。
- **飞书 secret 走 .env**：`FEISHU_APP_SECRET` 永远不要进代码，`.env` 已 gitignored。
- 所有用户内容（图片、视频、文件、原始 log、生成的日记、状态文件）都落 `Daily_Vault*/` 或 `.feishu_state.json`，全部 gitignored。新增任何持久化路径前，先确认 gitignore 覆盖到。

## 跨日记忆 / 语义索引（v1.1）

`lib/embeddings.js`：基于 Ollama embedding（默认 `bge-large:335m`，可换 `qwen3-embedding:4b`）+ 本地 jsonl 索引。

- 索引文件：`Daily_Vault/_index/embeddings.jsonl`（一行一 chunk）+ `meta.json`（已索引日期 + 模型）
- 切分粒度：raw_logs 里每个 `**HH:MM:SS**` 时间块一个 chunk；超过 500 char 自动按段落切；纯媒体链接（`![](assets/...)`）chunk 被过滤掉避免污染检索
- 查询用 cosine + top-K + minScore 阈值。规模小于 10000 chunks 时纯 JS 完全够用
- `/diary` 完成后**异步**索引当天 logs（不阻塞主流程）；首次接入跑 `echolog reindex` 全量重建
- 飞书 `/recall <主题> [N]` 返回 top-N 引述带相似度；终端 `echolog recall` 同效果
- `/draft` 生成草稿时调 `embeddings.query(选题标题, excludeDate=选题创建日)` 注入跨日相关素材

bge-large ctx 是 512 token，所以单 chunk 必须 ≤ 500 字符（中文 BPE 1 char ≈ 1.5 token）。如果有长 chunk 在 indexDate 时被 ollama 拒绝，看日志的 `[embed ... exceeds context length]`。

## 选题 → 写作流水线（v1.1）

`lib/drafts.js`：

- `listNotes()` 扫 `Daily_Vault/Notes/*.md`，按成熟度（🌳 > 🌿 > 🌱）→ created 倒序
- `findNote(idOrFragment)` 数字 id 精确匹配 / 标题片段 fuzzy
- 三套独立 system prompt（共享Example User voice）：
  - `TWITTER_PROMPT` —— 5-7 推、第 1 推≤200 字、最后一推必互动钩子
  - `LONGFORM_PROMPT` —— 800-1500 字公众号、开场必具体场景/数据/引述、至少 1 句金句
  - `VIDEO_PROMPT` —— 90s 短视频、4-5 beat 分时段标口播+镜头
- `generateOne(note, format)` 调 `embeddings.query(标题)` 拉跨日素材池 + `readSourceLogs(created)` 读灵感来源当天 logs，灌进 user prompt
- `generateAll(note)` 三 format 并发跑（`Promise.all`）—— 一选三发
- 输出落到 `Daily_Vault/Drafts/<date>_<format>_<slug>.md`，frontmatter 带 source_note 链回选题

加新 format（如小红书 / B 站）：在 `PROMPT_BY_FORMAT` 加一条，dispatcher 加 flag。

## HTTP /ingest 端点 + 输入桥（v1.1）

`lib/ingest-server.js` —— 让 Android 端（Tasker / HTTP Shortcuts）直接灌内容到 raw_logs：

- 监听 `127.0.0.1:8766`（不暴露 LAN/公网）
- 鉴权：HTTP header `X-Echolog-Token` 跟 `.env` 的 `INGEST_TOKEN`（≥16 char）比对
- Body JSON：`{ text, image_path, audio_path, ts, source, tags }`
- 走 `handleIngest()` 复用 `appendLogAt`，按 sendDt（默认现在，可传 ts ISO 8601）归档
- `INGEST_TOKEN` 未设则 server 不启动；跨设备走 Tailscale，不开公网

详见 `docs/XIAOMI_INTEGRATION.md`：HTTP Shortcuts 配置 / Tailscale 跨设备 / 小米手环数据走截屏 OCR 路径（不直连 Zepp Life API，反爬太严）。

## 飞书消息 URL 抽取（v1.1）

`lib/url-enrich.js` —— 用户在飞书发链接时，bot 后台异步抓 title + description 追加到 raw_logs：

- 用 og:title / og:description / `<title>` / `<meta name="description">` 多级 fallback
- timeout 8s，UA 伪装 Chrome，仅读前 256KB
- 失败 graceful（不影响主流程）
- text 分支处理：appendLogAt 立即落档原文 → fire-and-forget enrich → 抓到后 appendLogAt 追加 quote 块

## 反馈环（v1.1）

`lib/ratings.js` + `lib/self-review.js`：

- `/rate <1-5> [评语]` 给最近一份 diary 打分（mtime 最新的 `02_diary_v*.md`），写到 `.diary_ratings.jsonl`
- `/diary` 完成后追加打分引导
- `echolog self-review [N]` 拉过去 N 天 diary（默认 7），让 LLM 标 🟢真洞察 / 🟡可保留 / 🔴水分，并给 prompt 调优建议；输出到 `Daily_Vault/_weekly/<W>_self_review.md`；自审时把人工 ratings 注入作为额外信号
- `echolog ratings` / doctor 第 7 段都能看评分概览

`.diary_ratings.jsonl` 已 gitignored。

## 改代码时的注意点

- 时区硬性 `Asia/Shanghai`。归档日期一律用 **消息发送时间** `dayjs(create_time_ms).tz('Asia/Shanghai')`，不要 `new Date()` 拿"现在"。catchup 写历史消息时这一点尤其关键。
- TG 单条消息上限 ~4096 字符，飞书 ~30k；长日记 TG 切 4000、飞书切 5000，新增长文本回复要保持切片。
- Ollama 调用统一 `think: false, stream: false`。改 streaming 要同步改两侧的 progress 反馈（TG 是 `editMessageText`、飞书是连发多条）。
- `appendLog*` 是同步 `fs.appendFileSync`，量大时会阻塞事件循环；个人量级 OK，扩成多人 / 高频前再换异步。
- 飞书 `handleMessage` 是 catchup + 实时事件共用入口，所有去重 / 配对 / 落档逻辑只能写在这一个函数里，避免两边逻辑漂移。
- 增加新 `msg_type` 支持：在 `handleMessage` 的 if/else 链里加分支 + 在 `02_diary` 用的图片正则之外想清楚这种 asset 怎么进 PKM prompt（视频、语音目前只是落档不进 prompt，因为 Ollama 视觉模型只吃图）。
