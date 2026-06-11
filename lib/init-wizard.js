// echolog init —— 首跑配置向导
//
// 流程：
//   1. 探测硬件 (内存 / 芯片) → 推荐 provider/model 组合
//   2. 检测本地依赖 (node / ollama / whisper-cpp / ffmpeg) → 缺什么给安装命令
//   3. 选 LLM provider (ollama / openai 兼容)
//      - 选 openai 时填 base_url + api_key + model；当场测试调一次
//      - 选 ollama 时检查模型是否拉过；没拉提示命令
//   4. 填飞书 app_id / secret；当场换 token 验证
//   5. 填用户身份 (USER_NAME / USER_IDENTITY / USER_PROJECTS ...)
//   6. 写 .env（已存在则备份成 .env.backup-<ts>）
//   7. 提示下一步: echolog start
//
// 不引入 inquirer / prompts 等依赖；用 node 原生 readline。

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const { execSync } = require('child_process');
const { fetch: undiciFetch, Agent } = require('undici');
const { findBin } = require('./utils');

const PROJECT_DIR = path.join(__dirname, '..');
const ENV_FILE = path.join(PROJECT_DIR, '.env');

const C = {
  RED: '\x1b[31m', GREEN: '\x1b[32m', YELLOW: '\x1b[33m', CYAN: '\x1b[36m',
  BOLD: '\x1b[1m', DIM: '\x1b[2m', RESET: '\x1b[0m',
};
const ok = (s) => console.log(`${C.GREEN}✓${C.RESET} ${s}`);
const warn = (s) => console.log(`${C.YELLOW}⚠${C.RESET} ${s}`);
const fail = (s) => console.log(`${C.RED}✗${C.RESET} ${s}`);
const info = (s) => console.log(s);
const dim = (s) => console.log(`${C.DIM}${s}${C.RESET}`);
const section = (s) => console.log(`\n${C.BOLD}${C.CYAN}━━━ ${s} ━━━${C.RESET}`);

// ============================================================================
// 交互助手
// ============================================================================

function makeRl() {
  return readline.createInterface({ input: process.stdin, output: process.stdout });
}

function ask(rl, question, defaultVal = '') {
  return new Promise(resolve => {
    const prefix = defaultVal ? ` ${C.DIM}[默认: ${defaultVal}]${C.RESET}` : '';
    rl.question(`${question}${prefix} > `, (answer) => {
      resolve(answer.trim() || defaultVal);
    });
  });
}

async function askChoice(rl, question, choices) {
  console.log(`\n${question}`);
  choices.forEach((c, i) => console.log(`  ${i + 1}) ${c.label}${c.note ? `  ${C.DIM}${c.note}${C.RESET}` : ''}`));
  while (true) {
    const ans = await ask(rl, '选哪个？输数字', '1');
    const n = parseInt(ans, 10);
    if (n >= 1 && n <= choices.length) return choices[n - 1].value;
    warn(`请输 1-${choices.length}`);
  }
}

async function askYesNo(rl, question, defaultYes = true) {
  const def = defaultYes ? 'Y/n' : 'y/N';
  while (true) {
    const ans = (await ask(rl, `${question} (${def})`, defaultYes ? 'y' : 'n')).toLowerCase();
    if (ans === 'y' || ans === 'yes') return true;
    if (ans === 'n' || ans === 'no') return false;
  }
}

// ============================================================================
// 硬件 / 依赖探测
// ============================================================================

function detectHardware() {
  const totalGB = (os.totalmem() / 1024 / 1024 / 1024).toFixed(1);
  const arch = os.arch();         // arm64 (Apple Silicon) / x64 (Intel)
  const cpu = os.cpus()[0]?.model || 'unknown';
  const platform = os.platform(); // darwin / linux / win32
  return { totalGB: parseFloat(totalGB), arch, cpu, platform };
}

function recommendForHardware(hw) {
  // 决策矩阵（默认走本地，让数据完全不出本机；云端是「跑不动」时的兜底）
  if (hw.platform !== 'darwin') {
    return {
      mode: 'local-small',
      models: { text: 'qwen2.5:3b', vision: null, embed: 'bge-small:567m' },
      reason: '非 macOS：本地推理也行（CPU），但建议用小模型 qwen2.5:3b（约 2GB）。视觉先跳过',
    };
  }
  if (hw.arch === 'x64') {
    return {
      mode: 'local-small',
      models: { text: 'qwen2.5:3b', vision: null, embed: 'bge-small:567m' },
      reason: `Intel ${hw.totalGB}GB：无 Metal 加速，跑小模型 qwen2.5:3b（约 2GB，CPU 上 5-10 tok/s 可接受）；视觉建议跳过`,
    };
  }
  // Apple Silicon
  if (hw.totalGB < 12) {
    return {
      mode: 'local-small',
      models: { text: 'qwen2.5:3b', vision: null, embed: 'bge-small:567m' },
      reason: `${hw.totalGB}GB Apple Silicon：内存有限，用小模型组合 qwen2.5:3b（约 2GB），跳过视觉避免 swap；体验依然顺畅`,
    };
  }
  if (hw.totalGB < 24) {
    return {
      mode: 'local-medium',
      models: { text: 'qwen2.5:7b', vision: 'openbmb/minicpm-o2.6:latest', embed: 'bge-large:335m' },
      reason: `${hw.totalGB}GB Apple Silicon：可跑 7B 文本 + 视觉模型，内存比较紧张但可行；若想稳一点跑 qwen2.5:3b`,
    };
  }
  return {
    mode: 'local-full',
    models: { text: 'qwen3.5:9b', vision: 'openbmb/minicpm-o2.6:latest', embed: 'qwen3-embedding:4b' },
    reason: `${hw.totalGB}GB Apple Silicon —— 本地推理充裕，跑满配 qwen3.5:9b + minicpm-o2.6 + qwen3-embedding 都没问题`,
  };
}

function checkBin(name) {
  return findBin(name) !== undefined;
}

function checkOllamaRunning() {
  try {
    execSync("curl -s --noproxy '*' --max-time 2 http://localhost:11434/api/tags", { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// 连通性测试
// ============================================================================

async function testOpenAICompat(base, key, model) {
  const url = base.replace(/\/+$/, '') + '/chat/completions';
  const agent = new Agent({ headersTimeout: 30_000, bodyTimeout: 30_000 });
  try {
    const resp = await undiciFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: '你好，请只回复"pong"两个字' }],
        max_tokens: 10,
      }),
      dispatcher: agent,
    });
    const text = await resp.text();
    if (!resp.ok) return { ok: false, error: `HTTP ${resp.status} — ${text.slice(0, 150)}` };
    const j = JSON.parse(text);
    const reply = j?.choices?.[0]?.message?.content || '';
    return { ok: true, reply };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function testFeishuToken(appId, appSecret) {
  try {
    const resp = await undiciFetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    });
    const j = await resp.json();
    if (j.code === 0) return { ok: true, expires: j.expire };
    return { ok: false, error: `${j.code}: ${j.msg}` };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ============================================================================
// 写 .env
// ============================================================================

function readExistingEnv() {
  if (!fs.existsSync(ENV_FILE)) return {};
  const txt = fs.readFileSync(ENV_FILE, 'utf8');
  const out = {};
  for (const line of txt.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function backupAndWriteEnv(values) {
  if (fs.existsSync(ENV_FILE)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const bak = `${ENV_FILE}.backup-${stamp}`;
    fs.copyFileSync(ENV_FILE, bak);
    info(`旧 .env 已备份到 ${path.basename(bak)}`);
  }
  // 简单 KV 文件 —— 用户改 .env 时 dotenv 自动处理引号；这里给出含 # 的值就加引号
  const lines = [];
  lines.push(`# 由 echolog init 生成于 ${new Date().toISOString()}`);
  lines.push('');
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined || v === null) continue;
    const needQuote = /[#"\s]/.test(v);
    lines.push(`${k}=${needQuote ? JSON.stringify(v) : v}`);
  }
  lines.push('');
  fs.writeFileSync(ENV_FILE, lines.join('\n'));
}

// ============================================================================
// 主流程
// ============================================================================

async function run() {
  console.log(`\n${C.BOLD}🚀 echolog init —— 首跑配置向导${C.RESET}`);
  console.log(`${C.DIM}做完这一步你就能 echolog start 跑起来了${C.RESET}`);

  const rl = makeRl();
  const existing = readExistingEnv();
  if (Object.keys(existing).length > 0) {
    warn(`检测到已有 .env（${Object.keys(existing).length} 项配置）`);
    const cont = await askYesNo(rl, '继续会备份并覆盖。要继续吗？', false);
    if (!cont) { rl.close(); info('已取消。'); return; }
  }
  const out = {};

  // ============================================================
  // 1. 硬件 + 依赖
  // ============================================================
  section('1. 检测硬件 + 本地依赖');
  const hw = detectHardware();
  info(`平台：${hw.platform} / 芯片：${hw.arch} / 内存：${hw.totalGB} GB / CPU：${hw.cpu}`);
  const rec = recommendForHardware(hw);
  ok(`推荐配置：${rec.reason}`);
  info(`  → 文本：${rec.models.text || '（云端）'}`);
  info(`  → 视觉：${rec.models.vision || '（跳过）'}`);
  info(`  → embed：${rec.models.embed || '（跳过）'}`);

  info('');
  const deps = {
    node: process.version,
    brew: checkBin('brew'),
    ollama_bin: checkBin('ollama'),
    ollama_running: checkOllamaRunning(),
    ffmpeg: checkBin('ffmpeg'),
    whisper: checkBin('whisper-cli'),
  };
  ok(`node ${deps.node}`);
  if (hw.platform === 'darwin') {
    deps.brew ? ok('brew 已装') : warn('brew 缺失 —— /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"');
  }
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

  // ============================================================
  // 2. LLM Provider —— 默认本地 Ollama（数据完全不离开本机）
  // ============================================================
  section('2. 选 LLM Provider（默认：本地 Ollama）');
  info('日记 / 选题 / 周报用哪个模型？');
  info('  ★ 推荐：本地 Ollama —— 数据完全不出本机，免费跑');
  info('  ⚠ 云端：方便但内容会发给 provider；机器实在跑不动再考虑');
  const provider = await askChoice(rl, '选哪个？', [
    { value: 'ollama', label: '本地 Ollama (推荐)', note: '完全离线 / 数据私密 / 免费' },
    { value: 'openai', label: '云端 OpenAI 兼容', note: 'DeepSeek / Moonshot / OpenAI / OpenRouter / 智谱' },
  ]);
  out.LLM_PROVIDER = provider;

  if (provider === 'ollama') {
    info('\n基于你的硬件，推荐这些模型：');
    info(`  文本：${rec.models.text || '（无推荐）'}`);
    info(`  视觉：${rec.models.vision || '（跳过 —— 内存有限，建议不跑视觉）'}`);
    info(`  embed：${rec.models.embed || '（跳过）'}`);
    const accept = await askYesNo(rl, '用这个推荐配置吗？', true);
    if (accept) {
      if (rec.models.text) out.LLM_TEXT_MODEL = rec.models.text;
      if (rec.models.vision) out.LLM_VISION_MODEL = rec.models.vision;
      if (rec.models.embed) out.LLM_EMBED_MODEL = rec.models.embed;
      // 视觉跳过 → 自动把 ENABLE_ASR 也建议保留，但 LLM_VISION_MODEL 不设
    } else {
      info('\n手动配置：');
      out.LLM_TEXT_MODEL = await ask(rl, 'LLM_TEXT_MODEL', rec.models.text || 'qwen3.5:9b');
      const v = await ask(rl, 'LLM_VISION_MODEL（留空跳过视觉解析）', rec.models.vision || '');
      if (v) out.LLM_VISION_MODEL = v;
      const e = await ask(rl, 'LLM_EMBED_MODEL（留空跳过跨日 /recall）', rec.models.embed || '');
      if (e) out.LLM_EMBED_MODEL = e;
    }

    // 自动 ollama pull 提示
    const toPull = [out.LLM_TEXT_MODEL, out.LLM_VISION_MODEL, out.LLM_EMBED_MODEL].filter(Boolean);
    if (toPull.length && deps.ollama_running) {
      info('\n现在帮你拉模型？（可能耗时 1-10 分钟，依模型大小）');
      const doPull = await askYesNo(rl, '现在 ollama pull 这些模型？', true);
      if (doPull) {
        for (const m of toPull) {
          info(`\n→ ollama pull ${m}`);
          try {
            execSync(`ollama pull ${m}`, { stdio: 'inherit', timeout: 600_000 });
            ok(`${m} 已拉取`);
          } catch (err) {
            warn(`拉取 ${m} 失败：${err.message}。可以稍后手动跑 ollama pull ${m}`);
          }
        }
      } else {
        info('\n之后自己跑：');
        for (const m of toPull) dim(`  ollama pull ${m}`);
      }
    } else if (toPull.length) {
      info('\n请确认这些模型已 pull：');
      for (const m of toPull) dim(`  ollama pull ${m}`);
    }
  } else {
    // openai 路径
    info('\n常见 base_url：');
    dim('  DeepSeek    https://api.deepseek.com/v1     (推荐中国用户，¥0.001/1K token)');
    dim('  Moonshot    https://api.moonshot.cn/v1');
    dim('  OpenAI      https://api.openai.com/v1');
    dim('  OpenRouter  https://openrouter.ai/api/v1    (可调 Claude / Gemini / 各种模型)');
    dim('  智谱 GLM     https://open.bigmodel.cn/api/paas/v4');
    out.LLM_API_BASE = await ask(rl, 'LLM_API_BASE', 'https://api.deepseek.com/v1');
    out.LLM_API_KEY = await ask(rl, 'LLM_API_KEY (sk-xxx)');
    out.LLM_TEXT_MODEL = await ask(rl, 'LLM_TEXT_MODEL', 'deepseek-chat');

    info('\n视觉模型（解析图片）—— DeepSeek 不支持，OpenAI/Moonshot/OpenRouter 支持');
    const wantVision = await askYesNo(rl, '现在配视觉模型吗？（不配也能跑，只是 /diary 不会解析图片）', false);
    if (wantVision) {
      out.LLM_VISION_MODEL = await ask(rl, 'LLM_VISION_MODEL', 'gpt-4o-mini');
    }
    out.LLM_EMBED_MODEL = await ask(rl, 'LLM_EMBED_MODEL（embedding 用，可留空跳过）', '');

    info('\n正在测试连通...');
    const t = await testOpenAICompat(out.LLM_API_BASE, out.LLM_API_KEY, out.LLM_TEXT_MODEL);
    if (t.ok) ok(`连通 OK，模型回复："${t.reply.slice(0, 80)}"`);
    else fail(`测试失败：${t.error}`);
    if (!t.ok) {
      const cont = await askYesNo(rl, '继续向导吗？（之后改 .env 再 echolog doctor 验证）', true);
      if (!cont) { rl.close(); return; }
    }
  }

  // ============================================================
  // 3. 飞书 App
  // ============================================================
  section('3. 飞书机器人凭证');
  info('在 https://open.feishu.cn/app 创建自建应用 → 凭证与基础信息 拿 App ID + App Secret');
  info('权限要开：im:message / im:message:send_as_bot / im:resource / im:chat');
  info('事件订阅：使用「长连接接收」，订阅 im.message.receive_v1');
  out.FEISHU_APP_ID = await ask(rl, 'FEISHU_APP_ID (cli_xxx)');
  out.FEISHU_APP_SECRET = await ask(rl, 'FEISHU_APP_SECRET');
  if (out.FEISHU_APP_ID && out.FEISHU_APP_SECRET) {
    info('正在测试 tenant_access_token...');
    const t = await testFeishuToken(out.FEISHU_APP_ID, out.FEISHU_APP_SECRET);
    if (t.ok) ok(`token 签发成功（有效期 ${t.expires}s）`);
    else fail(`换 token 失败：${t.error}`);
  }

  // ============================================================
  // 4. 用户身份
  // ============================================================
  section('4. 你是谁（让 diary / 选题贴你的真实身份）');
  info('这几个变量会注入 prompt 模板，影响 /diary 和 /draft 的生成风格');
  out.USER_NAME = await ask(rl, '你叫啥（名字 / 昵称）', '我');
  out.USER_IDENTITY = await ask(rl, '一句话身份描述（例：独立开发者 / 产品经理 / 工程师 / 学生）', '独立开发者 / 知识工作者');
  out.USER_PROJECTS = await ask(rl, '你在做的项目名（多个用顿号分隔，例：[[ProjectA]]、[[ProjectB]]）', '（暂未填写）');
  out.USER_CONTENT_FOCUS = await ask(rl, '想沉淀什么内容主题（例：工作复盘 + 技术沉淀 + 生活观察）', '工作复盘 + 学习沉淀 + 生活观察');
  out.USER_TONE_HINT = await ask(rl, 'diary 语气偏好', '克制理性、有距离感、重证据、不鸡汤');

  // ============================================================
  // 5. 写入
  // ============================================================
  section('5. 写入 .env');
  // 合并 existing：保留用户原有的 TG_* / TICKTICK_* / INGEST_* 等高级配置
  const merged = { ...existing, ...out };
  backupAndWriteEnv(merged);
  ok(`已写入 ${ENV_FILE}（${Object.keys(merged).length} 项）`);

  // ============================================================
  // 6. 下一步
  // ============================================================
  section('6. 下一步');
  info('1) 启动后台进程：');
  console.log(`     ${C.CYAN}echolog start${C.RESET}`);
  info('2) 跟踪日志：');
  console.log(`     ${C.CYAN}echolog logs -f${C.RESET}`);
  info('3) 验证全链路：');
  console.log(`     ${C.CYAN}echolog doctor${C.RESET}`);
  info('4) 飞书私聊给你的 bot 发条 "你好"，看是否回 OK 表情 + 落档到 Daily_Vault/<今天>/01_raw_logs.md');
  info('5) 发几条素材后试：');
  console.log(`     ${C.CYAN}/diary${C.RESET}     生成日记`);
  console.log(`     ${C.CYAN}/help${C.RESET}      所有命令`);

  rl.close();
  console.log('');
}

if (require.main === module) {
  run().catch(err => { console.error('init 异常:', err); process.exit(1); });
}

module.exports = { run, detectHardware, recommendForHardware };
