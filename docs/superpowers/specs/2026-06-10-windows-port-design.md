# Windows Port Design

## Scope

单用户、最小可用级别的 Windows 适配：飞书/TG 消息收发 + 日记生成通过云端 LLM（OpenAI/DeepSeek/Anthropic），跳过语音转录（ffmpeg/whisper-cpp）。本地 Ollama 不做端口适配。

## Architecture

```
bin/echolog          (bash → Node.js 重写, #!/usr/bin/env node)
├── 进程管理命令         → pm2 programmatic API
│   start/stop/restart/status/logs/run
├── 工具命令             → child_process.fork() 或 require()
│   dir/doctor/init/reindex/recall/ratings/...
└── 不变的 Node 源码     → 只修硬编码路径，不动核心逻辑
    feishu.js              WHISPER_BIN/FFMPEG_BIN → PATH 自动发现
    telegram.js            无需改动
    lib/doctor.js          ps/which → 跨平台替代
    lib/init-wizard.js     which → findBin
    lib/recover-missing.js echolog restart → pm2 restart
```

## File Changes

| File | Change |
|---|---|
| `bin/echolog` | bash 重写为 Node.js CLI |
| `lib/utils.js` (new) | `findBin(name)` — 跨平台可执行文件查找 |
| `feishu.js:64-66` | 硬编码 `/opt/homebrew/bin/` → `findBin()` |
| `lib/doctor.js:46,212,227` | `ps -o rss` → pm2 describe / `which` → `findBin` |
| `lib/init-wizard.js:126` | `which` → `findBin` |
| `lib/recover-missing.js:63` | `echolog restart` → pm2.restart |
| `package.json` | 加 `pm2` 依赖 |

## CLI Command Mapping

### Process management (pm2 programmatic API)

| Command | Implementation |
|---|---|
| `echolog start` | `pm2.start({script: 'feishu.js', name: 'echolog-feishu'})` |
| `echolog stop` | `pm2.stop(name)` + `pm2.delete(name)` |
| `echolog restart` | `pm2.restart(name)` |
| `echolog status` | `pm2.describe(name)` → pid/mem/uptime |
| `echolog logs [-f]` | pm2 log buffer query |
| `echolog run` | `child_process.fork('feishu.js')`, inherit stdio |

TG sub-command uses process name `echolog-tg`, entry `telegram.js`.

### Utility commands (require or fork)

| Command | Method |
|---|---|
| `dir` | `console.log(PROJECT_DIR)` |
| `ticktick-auth` | `require('./lib/ticktick').runAuthFlow()` |
| `init` | `fork('./lib/init-wizard.js')` |
| `doctor` | `fork('./lib/doctor.js')` |
| `reindex` | `require('./lib/embeddings').reindexAll()` |
| `self-review` | `fork('./lib/self-review.js')` |
| `recall` | `require('./lib/embeddings').query()` |
| `ratings` | `require('./lib/ratings').summarizeRatings()` |
| `prompt` | `require('./lib/prompts').describePrompt()` |
| `ticktick-status` | `require('./lib/ticktick').isAuthed()` + print info |
| `ingest-test` | HTTP POST via `http.request` |
| `setup-vault` | `fork('./lib/setup-vault.js')` |
| `recover-missing` | `fork('./lib/recover-missing.js')` |

### State directory

`~/.echolog/` unchanged. pm2 process list persists to the same dir.

## findBin(name) spec

```
1. spawnSync('where', [name]) on win32 → first line if exitCode 0
2. spawnSync('which', [name]) on others → stdout if exitCode 0
3. Platform-specific fallback paths:
   - win32: C:\Program Files\...\bin, C:\whisper-cpp\...
   - darwin: /opt/homebrew/bin, /usr/local/bin
   - linux: /usr/bin, /usr/local/bin
4. Return undefined if not found
   → feishu.js transcribeAudio: throw friendly error, don't crash
   → doctor/init-wizard: print "not found" warning
```

## Cross-platform fixes in detail

### feishu.js

```js
// Before
const WHISPER_BIN = '/opt/homebrew/bin/whisper-cli';
const FFMPEG_BIN = '/opt/homebrew/bin/ffmpeg';

// After
const { findBin } = require('./lib/utils');
const WHISPER_BIN = findBin('whisper-cli');
const FFMPEG_BIN = findBin('ffmpeg');
```

transcribeAudio already guards with `fs.existsSync(WHISPER_MODEL)`. Add a guard: if WHISPER_BIN or FFMPEG_BIN is undefined, throw with message "whisper-cli/ffmpeg not found in PATH."

### lib/doctor.js

- Line 46: `ps -o rss= -p ${pid}` → for pm2-managed processes, use `pm2.describe()`; otherwise skip memory reporting and just show pid
- Line 212, 227: `which whisper-cli` / `which ffmpeg` → `findBin(name)` with platform-appropriate install instructions

### lib/init-wizard.js

- Line 126: `execSync('which ${name}')` → `findBin(name) !== undefined`
- Install hint text: emit `brew install` on darwin, `choco install` / `winget install` on win32

### lib/recover-missing.js

- Line 63: `execSync('echolog restart')` → require pm2, connect, restart

## What stays unchanged

- All core business logic (message handling, diary generation, embeddings, TickTick, drafts, ratings)
- Telegram channel (no hardcoded paths)
- Data layout (Daily_Vault/, .feishu_state.json, etc.)
- lib/paths.js (already uses path.join)
- Prompt design, security boundaries

## Error handling

- pm2 connection failure: CLI prints error, suggests `npm install` re-run
- findBin returns undefined: audio messages throw with human-readable message "voice transcription unavailable — install ffmpeg/whisper-cpp"
- pm2 already running on start: prints status, exits 0 (idempotent)
- pm2 not running on stop: prints "not running", exits 0 (idempotent)

## Testing

Manual verification on Windows:
1. `node bin/echolog start` → process starts
2. `node bin/echolog status` → shows pid/uptime
3. `node bin/echolog restart` → process restarts
4. `node bin/echolog logs` → shows recent output
5. `node bin/echolog stop` → process stops
6. `node bin/echolog doctor` → runs health check
7. `node bin/echolog dir` → prints project path
8. Send a text message via Feishu → appears in Daily_Vault
