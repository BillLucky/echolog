// bot 端：lib/paths 路径解析单测
// 跑：node tests/paths.test.js
//
// paths.js 在 require 时读取 ECHOLOG_DATA_DIR / ECHOLOG_PROMPTS_DIR，
// 所以每个用例都清掉 require 缓存后重新加载，验证重定位行为。

const assert = require('node:assert');
const path = require('node:path');

const PATHS_MOD = require.resolve('../lib/paths');

// 在指定 env 下全新加载 lib/paths，跑完恢复 env + 清缓存
function loadPathsWith(envVars, fn) {
  const backup = {};
  for (const k of Object.keys(envVars)) {
    backup[k] = process.env[k];
    if (envVars[k] === undefined) delete process.env[k];
    else process.env[k] = envVars[k];
  }
  delete require.cache[PATHS_MOD];
  try {
    fn(require('../lib/paths'));
  } finally {
    for (const k of Object.keys(envVars)) {
      if (backup[k] === undefined) delete process.env[k];
      else process.env[k] = backup[k];
    }
    delete require.cache[PATHS_MOD];
  }
}

const tests = [];
function t(name, fn) { tests.push({ name, fn }); }

// 默认（不设 ECHOLOG_DATA_DIR）：DATA_DIR === REPO_ROOT，数据落仓库根
t('default: DATA_DIR falls back to REPO_ROOT', () => {
  loadPathsWith({ ECHOLOG_DATA_DIR: undefined, ECHOLOG_PROMPTS_DIR: undefined }, (p) => {
    assert.strictEqual(p.DATA_DIR, p.REPO_ROOT);
    assert.strictEqual(p.VAULT_DIR, path.join(p.REPO_ROOT, 'Daily_Vault'));
    assert.strictEqual(p.ENV_FILE, path.join(p.REPO_ROOT, '.env'));
    assert.strictEqual(p.PROMPTS_DIR, path.join(p.REPO_ROOT, 'prompts'));
  });
});

// 设 ECHOLOG_DATA_DIR：所有可写路径整体重定位到该目录
t('ECHOLOG_DATA_DIR relocates all writable paths', () => {
  const dataDir = path.join(path.sep === '\\' ? 'C:\\' : '/', 'tmp', 'echolog-data-test');
  loadPathsWith({ ECHOLOG_DATA_DIR: dataDir, ECHOLOG_PROMPTS_DIR: undefined }, (p) => {
    const resolved = path.resolve(dataDir);
    assert.strictEqual(p.DATA_DIR, resolved);
    assert.strictEqual(p.VAULT_DIR, path.join(resolved, 'Daily_Vault'));
    assert.strictEqual(p.FEISHU_STATE_FILE, path.join(resolved, '.feishu_state.json'));
    assert.strictEqual(p.TICKTICK_STATE_FILE, path.join(resolved, '.ticktick-state.json'));
    assert.strictEqual(p.RATINGS_FILE, path.join(resolved, '.diary_ratings.jsonl'));
    assert.strictEqual(p.ENV_FILE, path.join(resolved, '.env'));
    // prompts 不跟 DATA_DIR 走，仍默认在代码根
    assert.strictEqual(p.PROMPTS_DIR, path.join(p.REPO_ROOT, 'prompts'));
  });
});

// 设 ECHOLOG_PROMPTS_DIR：仅 prompts 重定位，DATA_DIR 不受影响
t('ECHOLOG_PROMPTS_DIR relocates prompts independently', () => {
  const promptsDir = path.join(path.sep === '\\' ? 'C:\\' : '/', 'tmp', 'echolog-prompts-test');
  loadPathsWith({ ECHOLOG_DATA_DIR: undefined, ECHOLOG_PROMPTS_DIR: promptsDir }, (p) => {
    assert.strictEqual(p.PROMPTS_DIR, path.resolve(promptsDir));
    assert.strictEqual(p.DATA_DIR, p.REPO_ROOT); // DATA_DIR 仍回退
  });
});

// 所有导出的路径都是绝对路径
t('all exported paths are absolute', () => {
  loadPathsWith({ ECHOLOG_DATA_DIR: undefined, ECHOLOG_PROMPTS_DIR: undefined }, (p) => {
    for (const key of ['REPO_ROOT', 'DATA_DIR', 'VAULT_DIR', 'FEISHU_STATE_FILE',
                        'TICKTICK_STATE_FILE', 'RATINGS_FILE', 'ENV_FILE', 'PROMPTS_DIR']) {
      assert.ok(path.isAbsolute(p[key]), `${key} should be absolute: ${p[key]}`);
    }
  });
});

// runner
let pass = 0, fail = 0;
for (const { name, fn } of tests) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    pass++;
  } catch (err) {
    console.error(`  ✗ ${name}: ${err.message}`);
    fail++;
  }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
