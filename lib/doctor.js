// echolog doctor —— 体检脚本，用于确认所有依赖都正常 + 估算消息漏拉风险
// 调用方式：echolog doctor

require('dotenv').config({ path: require('./paths').ENV_FILE });
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const fetch = require('node-fetch');
const { detectHardware, recommendForHardware } = require('./init-wizard');
const { findBin } = require('./utils');
const { REPO_ROOT: PROJECT_DIR, VAULT_DIR } = require('./paths');
const FEISHU_STATE = path.join(PROJECT_DIR, '.feishu_state.json');
const TICKTICK_STATE = path.join(PROJECT_DIR, '.ticktick-state.json');

const RED = '\x1b[31m', GREEN = '\x1b[32m', YELLOW = '\x1b[33m', CYAN = '\x1b[36m', RESET = '\x1b[0m', BOLD = '\x1b[1m';
const ok = (s) => `${GREEN}✓${RESET} ${s}`;
const warn = (s) => `${YELLOW}⚠${RESET} ${s}`;
const fail = (s) => `${RED}✗${RESET} ${s}`;
const dim = (s) => `\x1b[2m${s}${RESET}`;

function fmtAge(ms) {
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}min`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`;
  return `${Math.floor(ms / 86_400_000)}d ${Math.floor((ms % 86_400_000) / 3_600_000)}h`;
}

function header(title) {
  console.log(`\n${BOLD}${CYAN}━━━ ${title} ━━━${RESET}`);
}

// ---------- 1. 进程 ----------

function checkDaemon() {
  header('1. echolog 守护进程');
  const pidFile = path.join(os.homedir(), '.echolog', 'feishu.pid');
  if (!fs.existsSync(pidFile)) {
    console.log(fail('未运行'));
    console.log(dim('  → 运行 echolog start 启动'));
    return false;
  }
  try {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
    process.kill(pid, 0); // 信号 0 只探活，不杀进程（Windows 也支持）
    console.log(ok(`运行中 pid=${pid}`));
    return true;
  } catch {
    console.log(fail('PID 文件存在但进程已不在（可能异常退出）'));
    console.log(dim('  → 运行 echolog start 启动'));
    return false;
  }
}

// ---------- 2. 飞书凭证 ----------

async function checkFeishu() {
  header('2. 飞书 / Feishu API');
  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;
  if (!appId || !appSecret) {
    console.log(fail('缺 FEISHU_APP_ID / FEISHU_APP_SECRET（.env）'));
    return null;
  }
  console.log(ok(`AppID: ${appId}`));
  try {
    const r = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    });
    const j = await r.json();
    if (j.code === 0) {
      console.log(ok(`tenant_access_token 已签发（有效期 ${j.expire}s）`));
      return j.tenant_access_token;
    }
    console.log(fail(`换 token 失败: ${j.msg}`));
    return null;
  } catch (err) {
    console.log(fail(`换 token 异常: ${err.message}`));
    return null;
  }
}

// ---------- 3. 飞书消息漏拉风险 ----------

async function checkFeishuMessages(token) {
  header('3. 飞书消息漏拉风险评估');
  if (!fs.existsSync(FEISHU_STATE)) {
    console.log(warn('.feishu_state.json 不存在（bot 还没收到过任何消息）'));
    return;
  }
  const state = JSON.parse(fs.readFileSync(FEISHU_STATE, 'utf8'));
  console.log(ok(`paired_open_id: ${state.paired_open_id || '（未配对）'}`));
  console.log(ok(`processed_message_ids: ${state.processed_message_ids?.length || 0} 条（dedup 表）`));
  console.log('');
  const chatIds = Object.keys(state.chats || {});
  if (!chatIds.length) {
    console.log(warn('没有已知 chat_id —— bot 还没接到第一条 WS 事件'));
    return;
  }
  if (!token) {
    console.log(warn('飞书 token 不可用，跳过 API 对比'));
    return;
  }

  for (const chatId of chatIds) {
    const lastTs = state.chats[chatId].last_processed_ts || 0;
    const ageMs = Date.now() - lastTs;
    console.log(`  ${BOLD}${chatId}${RESET}`);
    console.log(`    last_processed_ts: ${new Date(lastTs).toISOString()}（${fmtAge(ageMs)}前）`);

    // 拉过去 30 天扫一遍，对比 dedup 表看遗漏
    const now = Math.floor(Date.now() / 1000);
    const start = now - 30 * 86400;
    const seen = new Set(state.processed_message_ids || []);
    let total = 0, missed = 0;
    let token2 = null;
    try {
      do {
        const r = await fetch(`https://open.feishu.cn/open-apis/im/v1/messages?container_id_type=chat&container_id=${chatId}&start_time=${start}&end_time=${now}&sort_type=ByCreateTimeAsc&page_size=50${token2 ? '&page_token=' + token2 : ''}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const j = await r.json();
        if (j.code !== 0) throw new Error(j.msg);
        for (const m of (j.data?.items || [])) {
          total++;
          if (m.sender?.sender_type === 'app') continue;
          if (!seen.has(m.message_id)) missed++;
        }
        token2 = j.data?.has_more ? j.data.page_token : null;
      } while (token2);
      const sym = missed === 0 ? ok : (missed < 5 ? warn : fail);
      console.log(`    ${sym(`30 天内 API 共 ${total} 条 / 用户消息漏处理 ${missed} 条`)}`);
      if (missed > 0) {
        console.log(dim(`    → 1 小时内的漏网会被定期 catchup 自动追上`));
        console.log(dim(`    → 更老的漏网需要 echolog recover-missing 主动恢复`));
      }
    } catch (err) {
      console.log(fail(`    API 扫描失败: ${err.message}`));
    }
  }
}

// ---------- 4. TickTick ----------

function checkTickTick() {
  header('4. 滴答清单 / TickTick');
  if (!fs.existsSync(TICKTICK_STATE)) {
    console.log(warn('未授权 —— 运行 echolog ticktick-auth'));
    return;
  }
  const s = JSON.parse(fs.readFileSync(TICKTICK_STATE, 'utf8'));
  if (!s.tokens?.access_token) {
    console.log(warn('未授权 —— 运行 echolog ticktick-auth'));
    return;
  }
  const expiresIn = s.tokens.expires_at - Date.now();
  if (expiresIn <= 0) {
    console.log(fail('Token 已过期 —— 重新运行 echolog ticktick-auth'));
  } else {
    const days = Math.floor(expiresIn / 86_400_000);
    const sign = days < 7 ? warn : ok;
    console.log(sign(`Token 有效，约剩 ${days} 天`));
  }
  const synced = s.synced || {};
  const totalSynced = Object.values(synced).reduce((sum, arr) => sum + arr.length, 0);
  console.log(ok(`已同步 ${totalSynced} 条（覆盖 ${Object.keys(synced).length} 天）`));
  if (s.notes_project_id) {
    console.log(ok(`Notes 项目 ID 已缓存: ${s.notes_project_id}`));
  } else {
    console.log(warn('Notes 项目 ID 未缓存（首次同步选题时会自动查找）'));
  }
}

// ---------- 0. 硬件 + provider 适配性 ----------

function checkHardware() {
  header('0. 硬件 + LLM Provider 适配性');
  const hw = detectHardware();
  console.log(`${BOLD}平台${RESET}：${hw.platform} / ${BOLD}芯片${RESET}：${hw.arch} / ${BOLD}内存${RESET}：${hw.totalGB} GB`);
  console.log(`${BOLD}CPU${RESET}：${hw.cpu}`);
  const rec = recommendForHardware(hw);
  const provider = (process.env.LLM_PROVIDER || 'ollama').toLowerCase();
  console.log(`${BOLD}当前 LLM_PROVIDER${RESET}：${provider}`);
  console.log('');
  // 对比当前配置 vs 推荐
  if (rec.mode === 'local' && provider === 'ollama') {
    console.log(ok(`配置匹配硬件：${rec.reason}`));
  } else if (rec.mode === 'cloud' && provider === 'openai') {
    console.log(ok(`配置匹配硬件：${rec.reason}`));
  } else if (rec.mode === 'hybrid') {
    console.log(warn(`混合配置可选：${rec.reason}`));
  } else if (rec.mode === 'cloud' && provider === 'ollama') {
    console.log(fail(`配置可能跑不动！${rec.reason}`));
    console.log(dim('  → 跑 echolog init 切换到云端 provider'));
  } else if (rec.mode === 'local' && provider === 'openai') {
    console.log(warn(`本机其实能跑本地，正在白付云端钱。${rec.reason}`));
    console.log(dim('  → 想省钱可以 echolog init 切回 ollama'));
  }
}

// ---------- 5. 本地依赖 ----------

function checkLocalDeps() {
  const provider = (process.env.LLM_PROVIDER || 'ollama').toLowerCase();
  header(`5. 本地依赖（whisper / ffmpeg${provider === 'ollama' ? ' / ollama' : ''}）`);
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
  // whisper model
  const modelPath = path.join(process.env.HOME || process.env.USERPROFILE || '', '.whisper-models', 'ggml-large-v3-turbo-q5_0.bin');
  if (fs.existsSync(modelPath)) {
    const size = (fs.statSync(modelPath).size / 1024 / 1024).toFixed(0);
    console.log(ok(`whisper 模型: ${size} MB`));
  } else {
    console.log(warn(`whisper 模型缺失 —— curl -L -o ${modelPath} https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin`));
  }
  // ffmpeg
  const ffmpegBin = findBin('ffmpeg');
  if (ffmpegBin) {
    console.log(ok(`ffmpeg 已安装 (${ffmpegBin})`));
  } else {
    const hint = process.platform === 'win32' ? 'winget install ffmpeg' : 'brew install ffmpeg';
    console.log(fail(`ffmpeg 缺失 —— ${hint}`));
  }
  // ollama (仅 provider=ollama 时检查)
  if (provider !== 'ollama') {
    console.log(dim('  (LLM_PROVIDER=openai，跳过 ollama 检查)'));
    return;
  }
  try {
    const out = execSync("curl -s --noproxy '*' http://localhost:11434/api/tags", { stdio: 'pipe' }).toString();
    const j = JSON.parse(out);
    const text = process.env.LLM_TEXT_MODEL || process.env.OLLAMA_TEXT_MODEL || 'qwen3.5:9b';
    const vis = process.env.LLM_VISION_MODEL || process.env.OLLAMA_VISION_MODEL || 'openbmb/minicpm-o2.6:latest';
    const haveText = j.models?.some(m => m.name === text);
    const haveVis = j.models?.some(m => m.name === vis);
    console.log(haveText ? ok(`Ollama 文本模型 ${text}`) : warn(`Ollama 缺 ${text} —— ollama pull ${text}`));
    console.log(haveVis ? ok(`Ollama 视觉模型 ${vis}`) : warn(`Ollama 缺 ${vis} —— ollama pull ${vis}`));
  } catch {
    console.log(fail('Ollama 服务未运行 —— ollama serve'));
  }
}

// ---------- 6.5 跨日记忆索引 ----------

async function checkEmbeddingIndex() {
  header('6.5 跨日记忆索引（embeddings）');
  let embeddings;
  try {
    embeddings = require('./embeddings');
  } catch (err) {
    console.log(fail(`加载 lib/embeddings.js 失败：${err.message}`));
    return;
  }
  // ollama embedding 模型可达？
  try {
    const r = await embeddings.healthCheck();
    if (r.ok) {
      console.log(ok(`Ollama embedding model: ${r.model} (${r.dim} 维)`));
    } else {
      console.log(warn(`Ollama embedding 不可达 (${r.model}) — 跑：ollama pull ${r.model}`));
    }
  } catch (err) {
    console.log(warn(`embedding 健康检查异常: ${err.message}`));
  }
  // 索引规模
  const stats = embeddings.indexStats();
  if (!stats.totalChunks) {
    console.log(warn('索引为空 —— 运行 echolog reindex 全量建库'));
  } else {
    console.log(ok(`索引：${stats.totalChunks} chunks / ${stats.days} 天（${stats.earliest} ~ ${stats.latest}）`));
  }
}

// ---------- 6.7 Prompt 版本 ----------

function checkPromptVersion() {
  header('6.7 Prompt 版本（DIARY）');
  let prompts;
  try {
    prompts = require('./prompts');
  } catch (err) {
    console.log(fail(`加载 lib/prompts.js 失败：${err.message}`));
    return;
  }
  const cur = prompts.describePrompt('diary');
  if (!cur.exists) {
    console.log(fail(`prompt 文件缺失：${cur.file}`));
    return;
  }
  console.log(ok(`当前版本：${cur.version}（${path.basename(cur.file)}）`));
  console.log(dim(`     已有版本：${cur.available.join(', ')}`));
  console.log(dim(`     切换：改 .env 的 DIARY_PROMPT_VERSION + echolog restart`));
}

// ---------- 7. /rate 反馈累计 ----------

function checkRatings() {
  header('7. /rate 反馈累计');
  let ratings;
  try {
    ratings = require('./ratings');
  } catch (err) {
    console.log(fail(`加载 lib/ratings.js 失败：${err.message}`));
    return;
  }
  const sum = ratings.summarizeRatings();
  if (!sum.total) {
    console.log(warn('暂无 /rate 评分（飞书发 `/rate <1-5> [评语]` 累积）'));
    return;
  }
  console.log(ok(`${sum.total} 条评分 · 平均 ${sum.avg} / 5`));
  [5, 4, 3, 2, 1].forEach(s => {
    if (sum.byScore[s]) console.log(dim(`     ${s} 星：${sum.byScore[s]}`));
  });
}

// ---------- 6. Vault ----------

function checkVault() {
  header('6. Daily_Vault 结构');
  if (!fs.existsSync(VAULT_DIR)) {
    console.log(fail('Daily_Vault/ 不存在 —— 运行 echolog setup-vault'));
    return;
  }
  const dirs = ['_MOCs', '_Templates', '_Dataview', '_weekly', '100_Projects', '200_Areas', '300_Resources', '400_Archive', 'Notes'];
  for (const d of dirs) {
    const p = path.join(VAULT_DIR, d);
    console.log(fs.existsSync(p) ? ok(d) : warn(`${d} 缺失 —— 运行 echolog setup-vault`));
  }

  // 统计已落档的天数
  const dateDirs = fs.readdirSync(VAULT_DIR).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));
  console.log(ok(`已归档 ${dateDirs.length} 天`));

  // .obsidian 插件
  const pluginsDir = path.join(VAULT_DIR, '.obsidian', 'plugins');
  if (fs.existsSync(pluginsDir)) {
    const installed = fs.readdirSync(pluginsDir);
    console.log(ok(`已安装 ${installed.length} 个 Obsidian 插件: ${installed.join(', ')}`));
  } else {
    console.log(warn('.obsidian/plugins/ 不存在 —— 运行 echolog setup-vault'));
  }
}

// ---------- 主流程 ----------

async function run() {
  console.log(`${BOLD}🩺 echolog 体检${RESET}`);
  console.log(`时间：${new Date().toISOString()}`);

  checkHardware();
  const daemonOk = await checkDaemon();
  const ttoken = await checkFeishu();
  await checkFeishuMessages(ttoken);
  checkTickTick();
  checkLocalDeps();
  await checkEmbeddingIndex();
  checkPromptVersion();
  checkVault();
  checkRatings();

  console.log(`\n${dim('体检结束。一切正常时所有项都是绿色 ✓。⚠ 警告通常是「可选的没装」，✗ 失败需要处理。')}\n`);
}

if (require.main === module) {
  run().catch(err => { console.error('doctor 异常:', err); process.exit(1); });
}

module.exports = { run };
