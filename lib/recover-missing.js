// echolog recover-missing —— 一次性主动恢复历史漏网消息
//
// 流程：
//   1. 临时把每个 chat 的 last_processed_ts 重置为 0（强制 catchup 扫 30 天）
//   2. 通知正在跑的 bot 重启，让它在启动时跑 catchup
//   3. processed_message_ids 保留，dedup 兜底已处理的消息
//   4. 漏网的会按原 create_time 写入对应日期文件
//
// 这是个安全幂等操作 —— 多次运行无副作用（已处理的有 dedup 保护）。

require('dotenv').config({ path: require('./paths').ENV_FILE });
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const { FEISHU_STATE_FILE: STATE_FILE } = require('./paths');

function isDaemonRunning() {
  const pidFile = path.join(os.homedir(), '.echolog', 'feishu.pid');
  if (!fs.existsSync(pidFile)) return false;
  try {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
    process.kill(pid, 0); // 信号 0：只探活，不杀进程
    return pid;
  } catch {
    return false;
  }
}

async function run() {
  if (!fs.existsSync(STATE_FILE)) {
    console.error('❌ 找不到 .feishu_state.json，bot 还没运行过');
    process.exit(1);
  }
  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  const chatIds = Object.keys(state.chats || {});
  if (!chatIds.length) {
    console.error('❌ state 里没有任何 chat');
    process.exit(1);
  }

  console.log('🔄 echolog recover-missing');
  console.log(`📂 state: ${STATE_FILE}`);
  console.log('');
  console.log(`保留 ${state.processed_message_ids?.length || 0} 条已处理 message_id（dedup 表）`);
  console.log('重置 last_processed_ts → 0，让下次启动 catchup 扫满 30 天');
  console.log('');

  for (const chatId of chatIds) {
    const old = state.chats[chatId].last_processed_ts;
    state.chats[chatId].last_processed_ts = 0;
    console.log(`  ${chatId}: ${new Date(old).toISOString()} → 0`);
  }
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  console.log('');
  console.log('✅ state 已重置');
  console.log('');

  const pid = isDaemonRunning();
  if (pid) {
    console.log(`🔁 检测到 bot 正在运行 (pid=${pid})，自动重启以触发 catchup...`);
    try {
      const binPath = path.join(__dirname, '..', 'bin', 'echolog');
      execSync(`node "${binPath}" restart`, { stdio: 'inherit' });
      console.log('');
      console.log('看 catchup 进度: echolog logs -f');
    } catch (err) {
      console.error(`重启失败: ${err.message}，请手动跑 echolog restart`);
      process.exit(1);
    }
  } else {
    console.log('⚠️  bot 当前未运行，下次 echolog start 时会自动 catchup');
  }
}

if (require.main === module) {
  run().catch(err => { console.error('❌', err); process.exit(1); });
}

module.exports = { run };
