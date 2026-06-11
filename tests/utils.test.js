// bot 端：lib/utils 跨平台工具单测
// 跑：node tests/utils.test.js
//
// 不引 vitest/jest，纯 node assert —— 跟其它 bot 端测试保持一致

const assert = require('node:assert');
const fs = require('node:fs');
const { findBin, IS_WIN } = require('../lib/utils');

const tests = [];
function t(name, fn) { tests.push({ name, fn }); }

// IS_WIN 必须是布尔且与当前平台一致
t('IS_WIN is a boolean matching process.platform', () => {
  assert.strictEqual(typeof IS_WIN, 'boolean');
  assert.strictEqual(IS_WIN, process.platform === 'win32');
});

// node 自己一定在 PATH 里（CI / 本机都装了），findBin 应当返回一个真实存在的路径
t('findBin locates node (guaranteed in PATH)', () => {
  const p = findBin('node');
  assert.strictEqual(typeof p, 'string', 'should return a string path for node');
  assert.ok(p.length > 0, 'path should be non-empty');
  assert.ok(fs.existsSync(p), `returned path should exist on disk: ${p}`);
});

// 不存在的二进制：返回 undefined，绝不抛错
t('findBin returns undefined for a non-existent binary', () => {
  const p = findBin('definitely-not-a-real-binary-xyz123');
  assert.strictEqual(p, undefined);
});

// findBin 永不抛异常（调用方靠返回值判断，不靠 try/catch）
t('findBin never throws on odd input', () => {
  assert.doesNotThrow(() => findBin(''));
  assert.doesNotThrow(() => findBin('name with spaces'));
});

// Windows 上只返回第一行（where 可能输出多行）
t('findBin returns a single-line path (no embedded newlines)', () => {
  const p = findBin('node');
  if (typeof p === 'string') {
    assert.ok(!/[\r\n]/.test(p), 'path must not contain CR/LF');
  }
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
