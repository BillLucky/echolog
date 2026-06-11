// 统一 LLM provider 抽象 —— ollama 本地 / OpenAI 兼容云端 / Anthropic 原生
//
// 设计目标：调用方 require('./llm') 后用法跟 ./ollama-client 完全一致。
//   const r = await llm.chat({ model, messages, options, stream, think })
//   r.message.content
//
// 路由：
//   LLM_PROVIDER=ollama (默认) → 走 ./ollama-client，本地 :11434
//   LLM_PROVIDER=openai        → 走 OpenAI Chat Completions 协议（/chat/completions）
//   LLM_PROVIDER=anthropic     → 走 Anthropic 原生 Messages API（/v1/messages）
//
// OpenAI 协议下覆盖 base_url 就能接：
//   DeepSeek    LLM_API_BASE=https://api.deepseek.com/v1     LLM_TEXT_MODEL=deepseek-chat
//   Moonshot    LLM_API_BASE=https://api.moonshot.cn/v1      LLM_TEXT_MODEL=moonshot-v1-8k
//   智谱 GLM     LLM_API_BASE=https://open.bigmodel.cn/api/paas/v4  LLM_TEXT_MODEL=glm-4-flash
//   OpenAI      LLM_API_BASE=https://api.openai.com/v1       LLM_TEXT_MODEL=gpt-4o-mini
//   OpenRouter  LLM_API_BASE=https://openrouter.ai/api/v1    LLM_TEXT_MODEL=anthropic/claude-3.5-sonnet
//   自建 vLLM   LLM_API_BASE=http://localhost:8000/v1        LLM_TEXT_MODEL=...
//
// Anthropic 原生（LLM_PROVIDER=anthropic）—— 跟 OpenAI 协议不同，单独一条路径：
//   LLM_API_KEY=sk-ant-...    LLM_TEXT_MODEL=claude-sonnet-4-6（文+图共用）
//   鉴权走 x-api-key + anthropic-version 头；system 抽到顶层；max_tokens 必填；
//   思考默认就是关的（不发 thinking 字段即可），无需 LLM_DISABLE_THINKING。
//   LLM_API_BASE 可省（默认 https://api.anthropic.com），仅在走代理/网关时填。
//   注意：Anthropic 没有 embedding API —— /recall 跨日检索请用 ollama 或 openai 兼容服务。
//
// 不引入任何官方 SDK —— 直接 fetch 调对应 endpoint，少一堆依赖。

const ollama = require('./ollama-client');
const { fetch: undiciFetch, Agent } = require('undici');

const PROVIDER = (process.env.LLM_PROVIDER || 'ollama').toLowerCase();
const API_BASE = process.env.LLM_API_BASE || '';
const API_KEY = process.env.LLM_API_KEY || '';

// Anthropic 原生
const ANTHROPIC_VERSION = process.env.LLM_ANTHROPIC_VERSION || '2023-06-01';
const ANTHROPIC_DEFAULT_BASE = 'https://api.anthropic.com';

// 云端调用复用一个 long-timeout agent（同 ollama-client 思路）
const cloudAgent = new Agent({
  headersTimeout: parseInt(process.env.LLM_HEADERS_TIMEOUT_MS || `${10 * 60 * 1000}`, 10),
  bodyTimeout: parseInt(process.env.LLM_BODY_TIMEOUT_MS || `${10 * 60 * 1000}`, 10),
  connectTimeout: 30_000,
});

function humanizeCloudError(err, status, body) {
  if (status === 401) return `LLM API 鉴权失败（401）—— 检查 LLM_API_KEY`;
  if (status === 402) return `LLM API 余额不足（402）`;
  if (status === 404) return `LLM API 模型不存在（404）—— 检查 model 名字`;
  if (status === 429) return `LLM API 限速（429）—— 稍后再试`;
  if (status >= 500) return `LLM API 服务端错误（${status}）`;
  const code = err?.cause?.code || err?.code;
  if (code === 'UND_ERR_HEADERS_TIMEOUT') return `LLM 云端响应超时（headers timeout）`;
  if (code === 'UND_ERR_BODY_TIMEOUT') return `LLM 云端响应中断（body timeout）`;
  if (code === 'ECONNREFUSED') return `LLM API 拒绝连接 ${API_BASE}`;
  if (code === 'ENOTFOUND') return `LLM API host 无法解析 ${API_BASE}`;
  if (body) return `LLM API 错误（${status}）：${typeof body === 'string' ? body.slice(0, 200) : JSON.stringify(body).slice(0, 200)}`;
  return err?.message || String(err);
}

// 把 ollama 风格的 messages（含 images base64 数组）转成 OpenAI Vision 的多模态 content
function toOpenAIMessages(messages) {
  return messages.map(m => {
    if (!m.images || !m.images.length) {
      return { role: m.role, content: m.content };
    }
    const parts = [{ type: 'text', text: m.content || '' }];
    for (const b64 of m.images) {
      // 已经是 data url 就原样传，否则补 jpeg 头
      const url = b64.startsWith('data:') ? b64 : `data:image/jpeg;base64,${b64}`;
      parts.push({ type: 'image_url', image_url: { url } });
    }
    return { role: m.role, content: parts };
  });
}

async function cloudChat(req) {
  if (!API_BASE) throw new Error('LLM_PROVIDER=openai 但 LLM_API_BASE 未设置');
  if (!API_KEY) throw new Error('LLM_PROVIDER=openai 但 LLM_API_KEY 未设置');

  const body = {
    model: req.model,
    messages: toOpenAIMessages(req.messages || []),
    stream: false,
  };
  // 把 ollama 的 options.temperature / num_ctx 映射到 OpenAI 字段
  // num_ctx 在 OpenAI 协议下没有等价物（上下文长度由 model 决定），直接丢弃
  if (req.options) {
    if (typeof req.options.temperature === 'number') body.temperature = req.options.temperature;
    if (typeof req.options.num_predict === 'number') body.max_tokens = req.options.num_predict;
    if (typeof req.options.top_p === 'number') body.top_p = req.options.top_p;
  }

  // 关闭推理模型的思考过程（MiniMax-M3 等）—— 设 LLM_DISABLE_THINKING=true
  // 直接走官方参数，不在 content 里正则剥 <think>；非推理模型忽略此字段
  const noThink = ['true', '1', 'yes', 'on'].includes((process.env.LLM_DISABLE_THINKING || '').toLowerCase().trim());
  if (noThink) body.thinking = { type: 'disabled' };

  const url = API_BASE.replace(/\/+$/, '') + '/chat/completions';
  const t0 = Date.now();
  let resp, text;
  try {
    resp = await undiciFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(body),
      dispatcher: cloudAgent,
    });
    text = await resp.text();
  } catch (err) {
    err.friendlyMessage = humanizeCloudError(err, 0, null);
    console.error(`[llm cloud] ${req.model} ❌ ${((Date.now() - t0) / 1000).toFixed(1)}s — ${err.friendlyMessage}`);
    throw err;
  }

  if (!resp.ok) {
    const err = new Error(`HTTP ${resp.status}`);
    let parsedBody = text;
    try { parsedBody = JSON.parse(text); } catch {}
    err.friendlyMessage = humanizeCloudError(err, resp.status, parsedBody);
    console.error(`[llm cloud] ${req.model} ❌ ${((Date.now() - t0) / 1000).toFixed(1)}s — ${err.friendlyMessage}`);
    throw err;
  }

  let j;
  try { j = JSON.parse(text); }
  catch (e) {
    const err = new Error(`非 JSON 响应：${text.slice(0, 200)}`);
    err.friendlyMessage = err.message;
    throw err;
  }
  const content = j?.choices?.[0]?.message?.content || '';
  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  if (req.tag) console.log(`[llm cloud ${req.tag}] ${req.model} ${dur}s`);
  // 返回 ollama 兼容的 shape
  return { message: { role: 'assistant', content }, _raw: j };
}

async function cloudEmbed(req) {
  if (!API_BASE) throw new Error('LLM_PROVIDER=openai 但 LLM_API_BASE 未设置');
  if (!API_KEY) throw new Error('LLM_PROVIDER=openai 但 LLM_API_KEY 未设置');
  const url = API_BASE.replace(/\/+$/, '') + '/embeddings';
  const body = {
    model: req.model,
    input: Array.isArray(req.input) ? req.input : [req.input],
  };
  const t0 = Date.now();
  let resp, text;
  try {
    resp = await undiciFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: JSON.stringify(body),
      dispatcher: cloudAgent,
    });
    text = await resp.text();
  } catch (err) {
    err.friendlyMessage = humanizeCloudError(err, 0, null);
    throw err;
  }
  if (!resp.ok) {
    let parsedBody = text;
    try { parsedBody = JSON.parse(text); } catch {}
    const err = new Error(`HTTP ${resp.status}`);
    err.friendlyMessage = humanizeCloudError(err, resp.status, parsedBody);
    throw err;
  }
  const j = JSON.parse(text);
  const embeddings = (j.data || []).map(d => d.embedding);
  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  if (req.tag) console.log(`[llm cloud embed ${req.tag}] ${req.model} ${dur}s`);
  return { embeddings };
}

// ============================================================================
// Anthropic 原生 Messages API（跟 OpenAI 协议结构不同，单独一套）
// ============================================================================

function anthropicUrl(suffix) {
  const base = (API_BASE || ANTHROPIC_DEFAULT_BASE).replace(/\/+$/, '');
  return /\/v1$/.test(base) ? base + suffix : base + '/v1' + suffix;
}

// 从 base64（可能带 data: 前缀）判断 media_type
function detectMediaType(b64) {
  if (b64.startsWith('data:')) {
    const m = b64.match(/^data:([^;]+);base64,/);
    if (m) return m[1];
  }
  if (b64.startsWith('/9j/')) return 'image/jpeg';
  if (b64.startsWith('iVBOR')) return 'image/png';
  if (b64.startsWith('R0lGOD')) return 'image/gif';
  if (b64.startsWith('UklGR')) return 'image/webp';
  return 'image/jpeg';
}

// 把 ollama 风格 messages（system 角色 + images base64 数组）转成 Anthropic Messages 格式。
// system 角色抽到顶层 system 字段；图片转 image source block（base64）。
function toAnthropicMessages(messages) {
  let system = '';
  const out = [];
  for (const m of messages || []) {
    if (m.role === 'system') {
      system += (system ? '\n\n' : '') + (m.content || '');
      continue;
    }
    if (!m.images || !m.images.length) {
      out.push({ role: m.role, content: m.content || '' });
      continue;
    }
    const parts = [];
    for (const b64 of m.images) {
      const raw = b64.startsWith('data:') ? b64.replace(/^data:[^;]+;base64,/, '') : b64;
      parts.push({ type: 'image', source: { type: 'base64', media_type: detectMediaType(b64), data: raw } });
    }
    if (m.content) parts.push({ type: 'text', text: m.content });
    out.push({ role: m.role, content: parts });
  }
  return { system, messages: out };
}

// Opus 4.7 / 4.8 移除了 temperature / top_p / top_k，传了会 400；其余模型仍接受
function anthropicSamplingAllowed(model) {
  const m = (model || '').toLowerCase();
  return !(m.includes('opus-4-7') || m.includes('opus-4-8'));
}

async function anthropicChat(req) {
  if (!API_KEY) throw new Error('LLM_PROVIDER=anthropic 但 LLM_API_KEY 未设置');

  const { system, messages } = toAnthropicMessages(req.messages || []);
  const body = {
    model: req.model,
    // Anthropic max_tokens 必填；映射 ollama 的 num_predict，缺省给足空间（长日记/周报）
    max_tokens: (req.options && req.options.num_predict) || parseInt(process.env.LLM_MAX_TOKENS || '8192', 10),
    messages,
    stream: false,
  };
  if (system) body.system = system;
  // 思考默认就是关的（不发 thinking 字段）；保持 diary 输出克制、确定
  if (req.options && anthropicSamplingAllowed(req.model)) {
    if (typeof req.options.temperature === 'number') body.temperature = req.options.temperature;
    if (typeof req.options.top_p === 'number') body.top_p = req.options.top_p;
  }

  const url = anthropicUrl('/messages');
  const t0 = Date.now();
  let resp, text;
  try {
    resp = await undiciFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': API_KEY,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
      dispatcher: cloudAgent,
    });
    text = await resp.text();
  } catch (err) {
    err.friendlyMessage = humanizeCloudError(err, 0, null);
    console.error(`[llm anthropic] ${req.model} ❌ ${((Date.now() - t0) / 1000).toFixed(1)}s — ${err.friendlyMessage}`);
    throw err;
  }

  if (!resp.ok) {
    const err = new Error(`HTTP ${resp.status}`);
    let parsedBody = text;
    try { parsedBody = JSON.parse(text); } catch {}
    err.friendlyMessage = humanizeCloudError(err, resp.status, parsedBody);
    console.error(`[llm anthropic] ${req.model} ❌ ${((Date.now() - t0) / 1000).toFixed(1)}s — ${err.friendlyMessage}`);
    throw err;
  }

  let j;
  try { j = JSON.parse(text); }
  catch (e) {
    const err = new Error(`非 JSON 响应：${text.slice(0, 200)}`);
    err.friendlyMessage = err.message;
    throw err;
  }
  // Anthropic content 是 block 数组，取所有 text block 拼起来
  const content = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  const dur = ((Date.now() - t0) / 1000).toFixed(1);
  if (req.tag) console.log(`[llm anthropic ${req.tag}] ${req.model} ${dur}s`);
  // 返回 ollama 兼容的 shape
  return { message: { role: 'assistant', content }, _raw: j };
}

// ============================================================================
// 公共 API —— signature 跟 ollama-client 兼容
// ============================================================================

async function chat(req) {
  if (PROVIDER === 'ollama') return ollama.chat(req);
  if (PROVIDER === 'openai') return cloudChat(req);
  if (PROVIDER === 'anthropic') return anthropicChat(req);
  throw new Error(`未知 LLM_PROVIDER: ${PROVIDER}（支持 ollama / openai / anthropic）`);
}

async function embed(req) {
  if (PROVIDER === 'ollama') return ollama.embed(req);
  if (PROVIDER === 'openai') return cloudEmbed(req);
  if (PROVIDER === 'anthropic') {
    const err = new Error('Anthropic 没有 embedding API —— 跨日检索 /recall 请把 EMBEDDINGS 走 ollama 或 openai 兼容服务（如 voyage / openai），或关掉 ENABLE_EMBEDDINGS。');
    err.friendlyMessage = err.message;
    throw err;
  }
  throw new Error(`未知 LLM_PROVIDER: ${PROVIDER}`);
}

async function warmup(models = []) {
  // 云端 provider 不需要 warmup，模型一直在
  if (PROVIDER === 'ollama') return ollama.warmup(models);
}

async function ping() {
  if (PROVIDER === 'ollama') return ollama.ping();
  if (PROVIDER === 'openai') {
    if (!API_BASE || !API_KEY) return false;
    try {
      const url = API_BASE.replace(/\/+$/, '') + '/models';
      const resp = await undiciFetch(url, {
        headers: { 'Authorization': `Bearer ${API_KEY}` },
        dispatcher: cloudAgent,
      });
      return resp.ok;
    } catch {
      return false;
    }
  }
  if (PROVIDER === 'anthropic') {
    if (!API_KEY) return false;
    try {
      const resp = await undiciFetch(anthropicUrl('/models'), {
        headers: { 'x-api-key': API_KEY, 'anthropic-version': ANTHROPIC_VERSION },
        dispatcher: cloudAgent,
      });
      return resp.ok;
    } catch {
      return false;
    }
  }
  return false;
}

// ==========================================================================
// 上下文容量估算（仅 ollama 生效；云端 provider 的 context 由模型决定、忽略 num_ctx）
//
// 病因复盘（2026-06-10）：一天的 raw_logs + 视觉描述可达 2~3 万字，固定
// num_ctx=16384 会让 prompt 从头被截断（system 指令先被丢掉）→ 模型直接吐空
// → /diary 生成空卡片。修法：按输入字符数估 token、留出生成余量，分桶取 num_ctx
// （分桶减少 Ollama 因 ctx 频繁变化反复重载模型），并封顶防 9B 模型 KV cache OOM。
// ==========================================================================
const CTX_BUCKETS = [16384, 24576, 32768, 49152, 65536, 98304, 131072];
const CTX_DEFAULT_MAX = 98304;       // 9B 级模型在个人机上的安全上限
const CTX_OUTPUT_BUDGET = 4096;      // 给生成留的 token 余量
const CTX_OVERHEAD = 1500;           // system prompt / 模板等固定开销
const CTX_TOKENS_PER_CHAR = 1.2;     // 中英混合 + markdown 的保守系数

// 估算容纳 `text` 所需的 num_ctx，分桶 + 封顶返回。
function estimateNumCtx(text, opts = {}) {
  const {
    outputBudget = CTX_OUTPUT_BUDGET,
    overhead = CTX_OVERHEAD,
    min = 16384,
    max = CTX_DEFAULT_MAX,
    tokensPerChar = CTX_TOKENS_PER_CHAR,
  } = opts;
  const chars = (text || '').length;
  const need = Math.ceil(chars * tokensPerChar) + outputBudget + overhead;
  for (const b of CTX_BUCKETS) {
    if (b < min) continue;
    if (b >= need) return Math.min(b, max);
  }
  return max;
}

// 给定 num_ctx，返回输入文本允许的最大字符数（兜底截断用：保证极端长的一天也不溢出）。
function capCharsForCtx(numCtx, opts = {}) {
  const {
    outputBudget = CTX_OUTPUT_BUDGET,
    overhead = CTX_OVERHEAD,
    tokensPerChar = CTX_TOKENS_PER_CHAR,
  } = opts;
  const inputTokens = Math.max(0, numCtx - outputBudget - overhead);
  return Math.floor(inputTokens / tokensPerChar);
}

function describe() {
  const cloud = PROVIDER === 'openai' || PROVIDER === 'anthropic';
  return {
    provider: PROVIDER,
    api_base: PROVIDER === 'anthropic' ? (API_BASE || ANTHROPIC_DEFAULT_BASE)
            : PROVIDER === 'openai' ? API_BASE
            : 'http://127.0.0.1:11434',
    has_key: cloud ? !!API_KEY : true,
  };
}

module.exports = {
  chat,
  embed,
  warmup,
  ping,
  describe,
  PROVIDER,
  // 上下文容量估算（ollama）
  estimateNumCtx,
  capCharsForCtx,
  // 导出供单测（纯函数，无副作用）
  toAnthropicMessages,
  anthropicSamplingAllowed,
};
