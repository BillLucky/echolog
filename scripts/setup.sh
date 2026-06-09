#!/usr/bin/env bash
# echolog 一键上手 —— clone 之后跑这一条命令即可。
#   bash scripts/setup.sh
# 做的事：检查 Node 22 → npm install → npm link（装 echolog 命令）→ 准备 .env → 自检。
set -euo pipefail

cd "$(dirname "$0")/.."
echo "🪶 echolog setup"
echo "────────────────────────────────────────"

# 1. Node ≥ 22
NODE_MAJOR=$(node -v 2>/dev/null | sed -E 's/^v([0-9]+)\..*/\1/' || echo 0)
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "❌ 需要 Node.js ≥ 22（当前: $(node -v 2>/dev/null || echo '未安装')）。"
  echo "   装 Node 22+：https://nodejs.org  或  brew install node"
  exit 1
fi
echo "✅ Node $(node -v)"

# 2. 依赖
echo "→ npm install ..."
npm install --no-audit --no-fund

# 3. 全局命令 echolog（用户级 node 前缀无需 sudo；失败不致命）
echo "→ npm link（装全局 echolog 命令）..."
if npm link >/dev/null 2>&1; then
  echo "✅ 已装 echolog 命令（也可直接 npm run feishu / node index-7-feishu.js）"
else
  echo "⚠️  npm link 没成功（权限？）。不影响使用，直接用：npm run feishu"
fi

# 4. .env
if [ ! -f .env ]; then
  cp .env.example .env
  echo "✅ 已生成 .env（从 .env.example 复制）"
else
  echo "✅ .env 已存在，保留不动"
fi

# 5. 自检
if [ -f lib/doctor.js ]; then
  echo "→ 环境自检（echolog doctor）..."
  node lib/doctor.js || true
fi

echo "────────────────────────────────────────"
echo "下一步："
echo "  1) 编辑 .env：① 选一个 LLM（本地 Ollama / OpenAI 兼容 / Anthropic）"
echo "                ② 填 FEISHU_APP_ID / FEISHU_APP_SECRET"
echo "  2) 飞书配置照抄 docs/FEISHU_SETUP.md（权限/事件/菜单可直接粘贴）"
echo "  3) echolog start   然后私聊机器人发条消息配对，再发 /diary"
echo "🪶 完成。"
