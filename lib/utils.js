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
