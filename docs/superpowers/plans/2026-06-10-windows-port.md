# Windows Port Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make echolog run on Windows by replacing the bash CLI with a cross-platform Node.js CLI (pm2-backed process management) and fixing hardcoded macOS paths in 4 source files.

**Architecture:** Single `bin/echolog` Node.js script replaces the bash CLI, using pm2 programmatic API for process management (start/stop/restart/status/logs) and `child_process.fork()` / `require()` for utility commands. A new `lib/utils.js` provides `findBin()` for cross-platform binary discovery, consumed by `feishu.js`, `lib/doctor.js`, and `lib/init-wizard.js`. Core business logic remains unchanged.

**Tech Stack:** Node.js >=22, pm2 (programmatic API), existing dependencies (undici for LLM calls, etc.)

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `lib/utils.js` | **Create** | `findBin(name)` — cross-platform binary discovery |
| `bin/echolog` | **Rewrite** | Node.js CLI — pm2 process management + command dispatch |
| `feishu.js:64-66` | **Modify** | Hardcoded `/opt/homebrew/bin/` → `findBin()` |
| `lib/doctor.js:46,210-230` | **Modify** | `ps -o rss` → pm2 describe; `which` → `findBin` |
| `lib/init-wizard.js:124-130` | **Modify** | `which` → `findBin` |
| `lib/recover-missing.js:59-67` | **Modify** | `execSync('echolog restart')` → pm2 API |
| `package.json` | **Modify** | Add `pm2` to dependencies |

---

### Task 1: Create lib/utils.js — cross-platform findBin

**Files:**
- Create: `lib/utils.js`

- [ ] **Step 1: Write lib/utils.js**

```js
// Cross-platform utilities shared across the echolog codebase.
'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const IS_WIN = process.platform === 'win32';

/**
 * Find a binary in PATH (or common install locations).
 * Returns the full path string on success, or undefined if not found.
 * Does NOT throw — callers decide what "not found" means.
 */
function findBin(name) {
  // 1. Try OS-specific PATH lookup first
  if (IS_WIN) {
    const r = spawnSync('where', [name], { stdio: 'pipe', encoding: 'utf8' });
    if (r.status === 0) {
      const first = r.stdout.trim().split(/[\r\n]+/)[0];
      if (first) return first;
    }
  } else {
    const r = spawnSync('which', [name], { stdio: 'pipe', encoding: 'utf8' });
    if (r.status === 0) {
      const out = r.stdout.trim();
      if (out) return out;
    }
  }

  // 2. Fallback: check common install locations
  const fallbacks = IS_WIN
    ? [
        path.join(process.env.ProgramFiles || 'C:\\Program Files', name, 'bin', `${name}.exe`),
        path.join(process.env.ProgramFiles || 'C:\\Program Files', name, `${name}.exe`),
        path.join(process.env.LOCALAPPDATA || '', 'Programs', name, `${name}.exe`),
      ]
    : [
        `/opt/homebrew/bin/${name}`,
        `/usr/local/bin/${name}`,
        `/usr/bin/${name}`,
      ];

  for (const p of fallbacks) {
    if (fs.existsSync(p)) return p;
  }

  return undefined;
}

module.exports = { findBin, IS_WIN };
```

- [ ] **Step 2: Commit**

```bash
git add lib/utils.js
git commit -m "feat: add lib/utils.js with cross-platform findBin"
```

---

### Task 2: Fix feishu.js — hardcoded macOS paths → findBin

**Files:**
- Modify: `feishu.js:64-66`

- [ ] **Step 1: Replace the hardcoded path constants**

Read `feishu.js` lines 64-66. Replace:

```js
const WHISPER_BIN = '/opt/homebrew/bin/whisper-cli';
const WHISPER_MODEL = path.join(process.env.HOME, '.whisper-models/ggml-large-v3-turbo-q5_0.bin');
const FFMPEG_BIN = '/opt/homebrew/bin/ffmpeg';
```

With:

```js
const { findBin } = require('./lib/utils');
const WHISPER_BIN = findBin('whisper-cli');
const WHISPER_MODEL = path.join(process.env.HOME || process.env.USERPROFILE || '', '.whisper-models', 'ggml-large-v3-turbo-q5_0.bin');
const FFMPEG_BIN = findBin('ffmpeg');
```

- [ ] **Step 2: Add guard in transcribeAudio for missing binaries**

In `feishu.js`, inside `transcribeAudio(audioPath)`, after the sidecar cache check and before the model check, add:

```js
if (!FFMPEG_BIN || !WHISPER_BIN) {
  throw new Error(
    'Voice transcription unavailable — ' +
    (!FFMPEG_BIN ? 'ffmpeg not found in PATH. ' : '') +
    (!WHISPER_BIN ? 'whisper-cli not found in PATH. ' : '') +
    'Install ffmpeg and whisper-cpp to enable audio transcription.'
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add feishu.js
git commit -m "fix: use findBin for ffmpeg/whisper paths instead of hardcoded /opt/homebrew"
```

---

### Task 3: Fix lib/init-wizard.js — which → findBin

**Files:**
- Modify: `lib/init-wizard.js:1-10 (add require), 124-130 (replace checkBin)**

- [ ] **Step 1: Add require for utils**

At the top of `lib/init-wizard.js`, after the existing `require` lines (after line 21 which is `const { fetch: undiciFetch, Agent } = require('undici');`), add:

```js
const { findBin } = require('./utils');
```

- [ ] **Step 2: Replace checkBin function**

Replace lines 124-130:

```js
function checkBin(name) {
  try {
    execSync(`which ${name}`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}
```

With:

```js
function checkBin(name) {
  return findBin(name) !== undefined;
}
```

- [ ] **Step 3: Update install hints for non-macOS platforms**

In the dependency display section (around lines 258-265), replace the hardcoded brew instructions with platform-appropriate ones. Replace:

```js
deps.ffmpeg ? ok('ffmpeg 已装') : warn('ffmpeg 缺失（语音转录需要）—— brew install ffmpeg');
deps.whisper ? ok('whisper-cli 已装') : warn('whisper-cli 缺失（语音转录需要）—— brew install whisper-cpp');
deps.ollama_bin ? ok('ollama 已装') : warn('ollama 缺失 —— brew install ollama');
deps.ollama_running ? ok('ollama 服务运行中') : warn('ollama 没起 —— 运行 ollama serve（开机自启：brew services start ollama）');
```

With:

```js
if (deps.ffmpeg) {
  ok('ffmpeg 已装');
} else {
  const hint = hw.platform === 'win32' ? 'winget install ffmpeg' : 'brew install ffmpeg';
  warn(`ffmpeg 缺失（语音转录需要）—— ${hint}`);
}
if (deps.whisper) {
  ok('whisper-cli 已装');
} else {
  const hint = hw.platform === 'win32'
    ? '下载 whisper.cpp release: https://github.com/ggerganov/whisper.cpp/releases'
    : 'brew install whisper-cpp';
  warn(`whisper-cli 缺失（语音转录需要）—— ${hint}`);
}
if (deps.ollama_bin) {
  ok('ollama 已装');
} else {
  const hint = hw.platform === 'win32' ? '从 https://ollama.com/download 下载' : 'brew install ollama';
  warn(`ollama 缺失 —— ${hint}`);
}
if (deps.ollama_running) {
  ok('ollama 服务运行中');
} else {
  const hint = hw.platform === 'win32' ? '启动 Ollama 应用' : '运行 ollama serve（开机自启：brew services start ollama）';
  warn(`ollama 没起 —— ${hint}`);
}
```

- [ ] **Step 4: Commit**

```bash
git add lib/init-wizard.js
git commit -m "fix: replace which with findBin in init-wizard, add Windows install hints"
```

---

### Task 4: Fix lib/doctor.js — cross-platform process check + findBin

**Files:**
- Modify: `lib/doctor.js:1-10 (add requires), 35-55 (checkDaemon), 207-248 (checkLocalDeps)`

- [ ] **Step 1: Add require for pm2 and utils**

At the top of `lib/doctor.js`, after the existing `require` lines (after line 11), add:

```js
const { findBin } = require('./utils');
const pm2 = require('pm2');
```

- [ ] **Step 2: Rewrite checkDaemon to use pm2.describe**

Replace lines 35-55 (`checkDaemon` function) with:

```js
function checkDaemon() {
  header('1. echolog 守护进程');
  return new Promise((resolve) => {
    pm2.connect(err => {
      if (err) {
        console.log(fail(`pm2 连接失败: ${err.message}`));
        console.log(dim('  → 运行 echolog start 启动'));
        resolve(false);
        return;
      }
      pm2.describe('echolog-feishu', (descErr, list) => {
        if (descErr || !list.length) {
          console.log(fail('未运行'));
          console.log(dim('  → 运行 echolog start 启动'));
          pm2.disconnect();
          resolve(false);
          return;
        }
        const p = list[0];
        if (p.pm2_env.status === 'online') {
          const mem = p.monit ? `${(p.monit.memory / 1024 / 1024).toFixed(1)} MB` : 'N/A';
          const uptime = p.pm2_env.pm_uptime
            ? fmtAge(Date.now() - p.pm2_env.pm_uptime)
            : 'N/A';
          console.log(ok(`运行中 pid=${p.pid}, mem=${mem}, uptime=${uptime}`));
          pm2.disconnect();
          resolve(true);
        } else {
          console.log(fail(`状态: ${p.pm2_env.status}`));
          pm2.disconnect();
          resolve(false);
        }
      });
    });
  });
}
```

- [ ] **Step 3: Rewrite checkLocalDeps to use findBin**

In `checkLocalDeps()` (lines 207-248), replace the `execSync('which ...')` calls with `findBin()`:

Replace lines 210-216 (whisper-cli check):

```js
  // whisper-cli
  const whisperBin = findBin('whisper-cli');
  if (whisperBin) {
    console.log(ok(`whisper-cli 已安装 (${whisperBin})`));
  } else {
    const hint = process.platform === 'win32'
      ? '下载 whisper.cpp: https://github.com/ggerganov/whisper.cpp/releases'
      : 'brew install whisper-cpp';
    console.log(warn(`whisper-cli 未安装（语音转录需要）—— ${hint}`));
  }
```

Replace lines 225-230 (ffmpeg check):

```js
  // ffmpeg
  const ffmpegBin = findBin('ffmpeg');
  if (ffmpegBin) {
    console.log(ok(`ffmpeg 已安装 (${ffmpegBin})`));
  } else {
    const hint = process.platform === 'win32' ? 'winget install ffmpeg' : 'brew install ffmpeg';
    console.log(fail(`ffmpeg 缺失 —— ${hint}`));
  }
```

- [ ] **Step 4: Make checkDaemon call async in run()**

In the `run()` function (line 355), change `checkDaemon()` from a sync call to await:

```js
checkHardware();
const daemonOk = await checkDaemon();
```

- [ ] **Step 5: Commit**

```bash
git add lib/doctor.js
git commit -m "fix: cross-platform daemon check (pm2) and binary detection in doctor"
```

---

### Task 5: Fix lib/recover-missing.js — echolog restart → pm2 restart

**Files:**
- Modify: `lib/recover-missing.js:1-10 (add require), 59-67 (restart logic)`

- [ ] **Step 1: Add pm2 require and rewrite restart logic**

At the top of `lib/recover-missing.js`, after line 14, add:

```js
const pm2 = require('pm2');
```

Replace lines 58-67:

```js
  const pid = isDaemonRunning();
  if (pid) {
    console.log(`🔁 检测到 bot 正在运行 (pid=${pid})，自动重启以触发 catchup...`);
    try {
      execSync('echolog restart', { stdio: 'inherit' });
    } catch (err) {
      console.error('重启失败，请手动跑 echolog restart');
      process.exit(1);
    }
    console.log('');
    console.log('看 catchup 进度: echolog logs -f');
  } else {
    console.log('⚠️  bot 当前未运行，下次 echolog start 时会自动 catchup');
  }
```

With:

```js
  const pid = isDaemonRunning();
  if (pid) {
    console.log(`🔁 检测到 bot 正在运行 (pid=${pid})，自动重启以触发 catchup...`);
    try {
      await new Promise((resolve, reject) => {
        pm2.connect(err => {
          if (err) return reject(err);
          pm2.restart('echolog-feishu', restartErr => {
            pm2.disconnect();
            if (restartErr) reject(restartErr);
            else resolve();
          });
        });
      });
      console.log('');
      console.log('看 catchup 进度: echolog logs -f');
    } catch (err) {
      console.error(`重启失败: ${err.message}，请手动跑 echolog restart`);
      process.exit(1);
    }
  } else {
    console.log('⚠️  bot 当前未运行，下次 echolog start 时会自动 catchup');
  }
```

Note: `isDaemonRunning()` still checks the PID file. This is fine as a heuristic — pm2-managed processes also have a PID. The `pm2.restart` call is the authoritative action.

- [ ] **Step 2: Commit**

```bash
git add lib/recover-missing.js
git commit -m "fix: use pm2.restart instead of execSync echolog restart in recover-missing"
```

---

### Task 6: Add pm2 to package.json dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add pm2 dependency**

Read `package.json`. In the `dependencies` block, add:

```json
"pm2": "^5.4.0"
```

After `"node-fetch"` and before `"ollama"`, keeping alphabetical order:

```json
"dependencies": {
  "@larksuiteoapi/node-sdk": "^1.40.0",
  "dayjs": "^1.11.19",
  "dotenv": "^16.4.5",
  "grammy": "^1.41.1",
  "https-proxy-agent": "^7.0.6",
  "node-fetch": "^2.7.0",
  "ollama": "^0.6.3",
  "pm2": "^5.4.0",
  "undici": "^8.2.0"
}
```

- [ ] **Step 2: Install**

```bash
npm install
```

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add pm2 dependency for cross-platform process management"
```

---

### Task 7: Rewrite bin/echolog as Node.js CLI

**Files:**
- Modify: `bin/echolog` (complete rewrite)

This is the largest task. The bash CLI (~360 lines) becomes a Node.js CLI (~500 lines) with pm2 for process management and `fork()`/`require()` for utility commands.

- [ ] **Step 1: Write the new bin/echolog**

Replace the entire content of `bin/echolog` with:

```js
#!/usr/bin/env node
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const { fork, spawn } = require('child_process');

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
const PROJECT_DIR = path.resolve(path.join(__dirname, '..'));
const STATE_DIR = path.join(os.homedir(), '.echolog');
const LOG_DIR = path.join(STATE_DIR, 'logs');

// Parse channel sub-command
const args = process.argv.slice(2);
let channel = 'feishu';
let entryFile = 'feishu.js';

if (args[0] === 'tg') {
  channel = 'tg';
  entryFile = 'telegram.js';
  args.shift();
}

const command = args[0] || 'help';
const cmdArgs = args.slice(1);
const PROCESS_NAME = `echolog-${channel}`;

function todayLog() {
  const yyyymmdd = new Date().toISOString().slice(0, 10);
  return path.join(LOG_DIR, `${channel}-${yyyymmdd}.log`);
}

// Ensure state dirs
fs.mkdirSync(LOG_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// pm2 helpers
// -------------------------------------------------------------------
function pm2Connect() {
  const pm2 = require('pm2');
  return new Promise((resolve, reject) => {
    pm2.connect(err => (err ? reject(err) : resolve(pm2)));
  });
}

function pm2Describe(pm2, name) {
  return new Promise((resolve) => {
    pm2.describe(name, (_err, list) => resolve(list || []));
  });
}

function pm2Stop(pm2, name) {
  return new Promise((resolve) => {
    pm2.stop(name, () => pm2.delete(name, () => resolve()));
  });
}

// ---------------------------------------------------------------------------
// Process management commands
// ---------------------------------------------------------------------------

async function cmdStart() {
  let pm2;
  try { pm2 = await pm2Connect(); }
  catch { console.error('❌ pm2 daemon not running. Run: npx pm2 resurrect'); process.exit(1); }

  const list = await pm2Describe(pm2, PROCESS_NAME);
  const running = list.find(p => p.pm2_env.status === 'online');
  if (running) {
    console.log(`✅ ${channel} bot already running (pid ${running.pid})`);
    pm2.disconnect();
    return;
  }

  // If stopped but still in pm2 list, delete first
  if (list.length) {
    await new Promise(r => pm2.delete(PROCESS_NAME, r));
  }

  const logFile = todayLog();
  pm2.start({
    script: path.join(PROJECT_DIR, entryFile),
    name: PROCESS_NAME,
    output: logFile,
    error: logFile,
    merge_logs: true,
    autorestart: true,
    max_restarts: 10,
    restart_delay: 5000,
  }, (err) => {
    pm2.disconnect();
    if (err) { console.error(`❌ Start failed: ${err.message}`); process.exit(1); }
    // Wait a tick for the process to come up
    setTimeout(() => {
      const pm2b = require('pm2');
      pm2b.connect(() => {
        pm2b.describe(PROCESS_NAME, (_e, l) => {
          pm2b.disconnect();
          const p = (l || [])[0];
          if (p && p.pm2_env.status === 'online') {
            console.log(`🚀 ${channel} bot started (pid ${p.pid})`);
            console.log(`   log: ${logFile}`);
          } else if (p) {
            console.log(`⚠️  ${channel} bot status: ${p.pm2_env.status}`);
            console.log(`   log: ${logFile}`);
          } else {
            console.log(`🚀 ${channel} bot started`);
            console.log(`   log: ${logFile}`);
          }
        });
      });
    }, 1500);
  });
}

async function cmdStop() {
  let pm2;
  try { pm2 = await pm2Connect(); }
  catch { console.log(`ℹ️  ${channel} bot not running (pm2 unreachable)`); process.exit(0); }

  const list = await pm2Describe(pm2, PROCESS_NAME);
  if (!list.length) {
    console.log(`ℹ️  ${channel} bot not running`);
    pm2.disconnect();
    return;
  }
  const pid = list[0].pid;
  await pm2Stop(pm2, PROCESS_NAME);
  pm2.disconnect();
  console.log(`🛑 ${channel} bot stopped (pid ${pid})`);
}

async function cmdRestart() {
  let pm2;
  try { pm2 = await pm2Connect(); }
  catch { console.error('❌ pm2 not running'); process.exit(1); }

  pm2.restart(PROCESS_NAME, (err) => {
    pm2.disconnect();
    if (err) { console.error(`❌ Restart failed: ${err.message}`); process.exit(1); }
    console.log(`🔄 ${channel} bot restarted`);
    console.log(`   log: ${todayLog()}`);
  });
}

async function cmdStatus() {
  let pm2;
  try { pm2 = await pm2Connect(); }
  catch { console.log(`🔴 ${channel} bot not running (pm2 unreachable)`); process.exit(0); }

  const list = await pm2Describe(pm2, PROCESS_NAME);
  pm2.disconnect();

  if (!list.length || list[0].pm2_env.status !== 'online') {
    console.log(`🔴 ${channel} bot not running`);
    return;
  }
  const p = list[0];
  const mem = p.monit ? `${(p.monit.memory / 1024 / 1024).toFixed(1)} MB` : 'N/A';
  const uptime = p.pm2_env.pm_uptime
    ? `${Math.floor((Date.now() - p.pm2_env.pm_uptime) / 1000)}s`
    : 'N/A';
  console.log(`🟢 ${channel} bot running`);
  console.log(`   pid: ${p.pid}`);
  console.log(`   mem: ${mem}`);
  console.log(`   uptime: ${uptime}`);
  console.log(`   log: ${todayLog()}`);
}

async function cmdLogs() {
  const logFile = todayLog();
  if (cmdArgs[0] === '-f' || cmdArgs[0] === '--follow') {
    // Use pm2 log bus for cross-platform real-time tail
    let pm2;
    try { pm2 = await pm2Connect(); }
    catch { console.error('❌ pm2 not running'); process.exit(1); }

    pm2.launchBus((busErr, bus) => {
      if (busErr) { console.error('❌', busErr.message); pm2.disconnect(); process.exit(1); }
      console.log(`📋 Following ${channel} bot logs (Ctrl+C to stop)...`);
      bus.on('log:out', packet => {
        if (packet.process.name === PROCESS_NAME) process.stdout.write(packet.data);
      });
      bus.on('log:err', packet => {
        if (packet.process.name === PROCESS_NAME) process.stderr.write(packet.data);
      });
    });
  } else {
    if (!fs.existsSync(logFile)) {
      console.log(`No log file today: ${logFile}`);
      // Fallback: try pm2 describe for log path
      let pm2;
      try { pm2 = await pm2Connect(); }
      catch { return; }
      const list = await pm2Describe(pm2, PROCESS_NAME);
      pm2.disconnect();
      if (list.length) {
        const lp = list[0].pm2_env.pm_out_log_path;
        if (lp && fs.existsSync(lp)) {
          const content = fs.readFileSync(lp, 'utf8');
          const lines = content.split('\n');
          process.stdout.write(lines.slice(-80).join('\n'));
          return;
        }
      }
      return;
    }
    const content = fs.readFileSync(logFile, 'utf8');
    const lines = content.split('\n');
    process.stdout.write(lines.slice(-80).join('\n'));
  }
}

function cmdRun() {
  // Foreground mode — no pm2, just fork, inherit stdio
  const child = fork(path.join(PROJECT_DIR, entryFile), [], {
    cwd: PROJECT_DIR,
    stdio: 'inherit',
  });
  child.on('exit', code => process.exit(code || 0));
}

// ---------------------------------------------------------------------------
// Utility commands — short inline operations
// ---------------------------------------------------------------------------

function cmdDir() {
  console.log(PROJECT_DIR);
}

function cmdHelp() {
  const s = STATE_DIR;
  console.log(`echolog — private journal bot CLI

Usage:
  echolog init               Setup wizard (deps / LLM / Feishu / identity)
  echolog start              Start Feishu channel (daemon via pm2)
  echolog stop               Stop
  echolog restart            Restart
  echolog status             Status (pid / mem / uptime)
  echolog logs               Last 80 log lines
  echolog logs -f            Follow logs in real-time
  echolog run                Foreground (debug)
  echolog dir                Print project directory path

  echolog tg <command>       Same commands for Telegram channel

TickTick:
  echolog ticktick-auth      Browser OAuth authorize TickTick
  echolog ticktick-status    Token validity + synced task count

Vault:
  echolog setup-vault        Scaffold Obsidian vault skeleton

Semantic index:
  echolog reindex            Full rebuild of Daily_Vault vector index
  echolog recall <主题> [N]  Cross-date semantic search top-N

External ingest:
  echolog ingest-test [text] Test HTTP /ingest endpoint

Feedback:
  echolog ratings            /rate score summary
  echolog self-review [N]    Bot self-review last N days diaries (default 7)

Prompt version management:
  echolog prompt             Current diary prompt version + available versions

Health:
  echolog doctor             Full health check
  echolog recover-missing    Reset watermarks, recover missed messages (30 days)

File locations:
  state:   ${s}/
  logs:    ${LOG_DIR}/
  vault:   ${PROJECT_DIR}/Daily_Vault/`);
}

// ---------------------------------------------------------------------------
// Utility commands — fork standalone scripts
// ---------------------------------------------------------------------------

function forkScript(scriptPath, extraArgs = []) {
  const child = fork(scriptPath, extraArgs, { cwd: PROJECT_DIR, stdio: 'inherit' });
  child.on('exit', code => process.exit(code || 0));
}

function cmdInit()        { forkScript(path.join(PROJECT_DIR, 'lib', 'init-wizard.js')); }
function cmdDoctor()      { forkScript(path.join(PROJECT_DIR, 'lib', 'doctor.js')); }
function cmdSetupVault()  { forkScript(path.join(PROJECT_DIR, 'lib', 'setup-vault.js')); }
function cmdSelfReview()  { forkScript(path.join(PROJECT_DIR, 'lib', 'self-review.js'), cmdArgs); }
function cmdRecoverMissing() { forkScript(path.join(PROJECT_DIR, 'lib', 'recover-missing.js')); }

// ---------------------------------------------------------------------------
// Utility commands — require (run in this process)
// ---------------------------------------------------------------------------

function cmdReindex() {
  const e = require(path.join(PROJECT_DIR, 'lib', 'embeddings'));
  console.log(`🔎 Rebuilding semantic index (model=${process.env.OLLAMA_EMBED_MODEL || 'bge-m3'})`);
  e.reindexAll(({ date, indexed, totalSoFar }) => {
    console.log(`  ${date} → ${indexed} chunks (total ${totalSoFar})`);
  }).then(r => {
    console.log(`✅ Done: ${r.dates} days / ${r.total} chunks`);
  }).catch(err => { console.error('❌', err.message); process.exit(1); });
}

function cmdRecall() {
  if (!cmdArgs[0]) { console.log('Usage: echolog recall <主题> [N]'); process.exit(1); }
  const query = cmdArgs[0];
  const topK = parseInt(cmdArgs[1], 10) || 6;
  const e = require(path.join(PROJECT_DIR, 'lib', 'embeddings'));
  e.query(query, { topK }).then(hits => {
    if (!hits.length) { console.log('🤷 No matches (run reindex first)'); return; }
    for (const h of hits) {
      console.log(`📅 ${h.date} ${h.time}  · ${(h.score * 100).toFixed(0)}%`);
      console.log(`  ${h.text.replace(/\n/g, '\n  ')}`);
      console.log('');
    }
  }).catch(err => { console.error('❌', err.message); process.exit(1); });
}

function cmdRatings() {
  const r = require(path.join(PROJECT_DIR, 'lib', 'ratings'));
  const sum = r.summarizeRatings();
  if (!sum.total) { console.log('No ratings yet (use /rate 1-5 in Feishu)'); return; }
  console.log(`Total ${sum.total} · Average ${sum.avg} / 5`);
  [5, 4, 3, 2, 1].forEach(s => { if (sum.byScore[s]) console.log(`  ${s}★: ${sum.byScore[s]}`); });
  console.log('');
  console.log('Recent 10:');
  sum.recent.forEach(entry => {
    console.log(`  ${entry.date} v${entry.version} · ${entry.score}/5${entry.comment ? ' — ' + entry.comment : ''}`);
  });
}

function cmdPrompt() {
  const p = require(path.join(PROJECT_DIR, 'lib', 'prompts'));
  const cur = p.describePrompt('diary');
  console.log(`Current prompt (diary): ${cur.version}`);
  console.log(`File: ${cur.file}`);
  console.log(`Exists: ${cur.exists ? '✓' : '✗ missing'}`);
  console.log('');
  console.log(`Available: ${cur.available.length ? cur.available.join(', ') : '(none)'}`);
  console.log('');
  console.log('Switch: set DIARY_PROMPT_VERSION in .env + echolog restart');
  console.log('Rollback: set DIARY_PROMPT_VERSION back — each version file is preserved');
}

function cmdTickTickStatus() {
  const tt = require(path.join(PROJECT_DIR, 'lib', 'ticktick'));
  if (!tt.isAuthed()) { console.log('🔴 TickTick not authorized (run echolog ticktick-auth)'); process.exit(1); }
  const s = tt.loadState();
  const expiresIn = s.tokens.expires_at - Date.now();
  const days = Math.floor(expiresIn / 86400000);
  console.log('🟢 TickTick authorized');
  console.log(`  obtained: ${s.tokens.obtained_at}`);
  console.log(`  expires:  ~${days} days`);
  console.log(`  scope:    ${s.tokens.scope}`);
  const synced = s.synced || {};
  const totalSynced = Object.values(synced).reduce((sum, arr) => sum + arr.length, 0);
  console.log(`  synced:   ${totalSynced} items (${Object.keys(synced).length} days)`);
}

function cmdTickTickAuth() {
  const tt = require(path.join(PROJECT_DIR, 'lib', 'ticktick'));
  tt.runAuthFlow()
    .then(() => { console.log('✅ TickTick authorized, token saved to .ticktick-state.json'); process.exit(0); })
    .catch(err => { console.error('❌ Authorization failed:', err.message); process.exit(1); });
}

function cmdIngestTest() {
  // Load INGEST_TOKEN from .env
  const envFile = require(path.join(PROJECT_DIR, 'lib', 'paths')).ENV_FILE;
  const dotenv = require('dotenv');
  dotenv.config({ path: envFile });
  const token = process.env.INGEST_TOKEN;
  if (!token) {
    console.error('❌ INGEST_TOKEN not set in .env (generate: openssl rand -hex 24)');
    process.exit(1);
  }
  const port = process.env.INGEST_PORT || '8766';
  const msg = cmdArgs[0] || 'Test message from echolog ingest-test';
  const http = require('http');
  const data = JSON.stringify({ text: msg, source: 'cli-test' });
  const req = http.request({
    hostname: '127.0.0.1', port: parseInt(port, 10),
    path: '/ingest', method: 'POST',
    headers: {
      'X-Echolog-Token': token,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
    },
    family: 4,
  }, res => {
    let body = '';
    res.on('data', c => body += c);
    res.on('end', () => {
      if (res.statusCode === 200) {
        console.log('✅ Sent! Check today raw_logs:');
        const yyyymmdd = new Date().toISOString().slice(0, 10);
        console.log(`   tail -5 "${path.join(PROJECT_DIR, 'Daily_Vault', yyyymmdd, '01_raw_logs.md')}"`);
      } else {
        console.error(`❌ Server returned ${res.statusCode}: ${body}`);
      }
    });
  });
  req.on('error', () => {
    console.error('❌ Cannot connect — bot not running or INGEST_TOKEN not set. echolog restart and retry.');
    process.exit(1);
  });
  req.write(data);
  req.end();
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const ROUTER = {
  start:              cmdStart,
  stop:               cmdStop,
  restart:            cmdRestart,
  status:             cmdStatus,
  logs:               cmdLogs,
  run:                cmdRun,
  dir:                cmdDir,
  'ticktick-auth':    cmdTickTickAuth,
  'ticktick-status':  cmdTickTickStatus,
  'setup-vault':      cmdSetupVault,
  init:               cmdInit,
  doctor:             cmdDoctor,
  'recover-missing':  cmdRecoverMissing,
  reindex:            cmdReindex,
  recall:             cmdRecall,
  'ingest-test':      cmdIngestTest,
  'self-review':      cmdSelfReview,
  ratings:            cmdRatings,
  prompt:             cmdPrompt,
  '-h':               cmdHelp,
  '--help':           cmdHelp,
  help:               cmdHelp,
};

const handler = ROUTER[command];
if (!handler) {
  console.log(`Unknown command: ${command}`);
  console.log('');
  cmdHelp();
  process.exit(1);
}

handler();
```

- [ ] **Step 2: Verify the shebang line works**

The first line `#!/usr/bin/env node` is critical. Verify it's present and is the first line of the file (no BOM, no blank lines before it).

- [ ] **Step 3: Make executable on Unix**

```bash
chmod +x bin/echolog
```

(Not strictly needed for Windows, but keeps it working on macOS/Linux.)

- [ ] **Step 4: Test CLI commands**

```bash
# On Windows (Git Bash or PowerShell with node in PATH):
node bin/echolog help
node bin/echolog dir
node bin/echolog start
node bin/echolog status
node bin/echolog stop
```

- [ ] **Step 5: Commit**

```bash
git add bin/echolog
git commit -m "feat: rewrite CLI as cross-platform Node.js script with pm2 process management"
```

---

## Self-Review Checklist

After implementing all tasks, verify:

1. `node bin/echolog help` prints all commands
2. `node bin/echolog dir` prints project path
3. `node bin/echolog start` starts the Feishu bot via pm2
4. `node bin/echolog status` shows running process info
5. `node bin/echolog logs` shows recent log output
6. `node bin/echolog restart` restarts the process
7. `node bin/echolog stop` stops and removes the process
8. `node bin/echolog tg start` does the same for Telegram channel
9. `node bin/echolog doctor` runs full health check
10. `npm link` → `echolog start` works globally
