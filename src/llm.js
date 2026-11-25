'use strict';

const DEFAULT_TIMEOUT = 120000;

class LLMError extends Error {
  constructor(message, { status = 0, code = '', body = '' } = {}) {
    super(message);
    this.name = 'LLMError';
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

function endpoint(baseURL, suffix) {
  let base = String(baseURL || '').trim().replace(/\/+$/, '');
  if (!base) throw new LLMError('API Base URL 为空', { code: 'NO_BASE_URL' });
  if (/\/chat\/completions$/i.test(base)) {
    if (suffix === '/chat/completions') return base;
    base = base.replace(/\/chat\/completions$/i, '');
  }
  return base + suffix;
}

function headersFor(config) {
  const headers = { 'Content-Type': 'application/json' };
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  if (config.extraHeaders && typeof config.extraHeaders === 'object') {
    for (const [k, v] of Object.entries(config.extraHeaders)) {
      if (typeof v === 'string' && v) headers[k] = v;
    }
  }
  return headers;
}

function friendlyError(err) {
  if (!err) return '未知错误';
  if (err.name === 'AbortError') return '已停止生成';
  if (err.code === 'NO_API_KEY') return '还没有配置 API Key';
  if (err.code === 'NO_BASE_URL') return '还没有配置 API Base URL';
  const status = err.status || 0;
  if (status === 401 || status === 403) return `鉴权失败（${status}），请检查 API Key 是否有权限`;
  if (status === 404) return '接口不存在（404），请检查 Base URL（通常以 /v1 结尾）和模型名';
  if (status === 429) return '请求太频繁或额度用尽（429），稍后再试';
  if (status >= 500) return `模型服务暂时不可用（${status}），稍后再试`;
  if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') return '域名解析失败，请检查网络或 Base URL';
  if (err.code === 'ECONNREFUSED') return '连接被拒绝，本地模型服务可能没有启动';
  if (err.code === 'ETIMEDOUT' || err.code === 'UND_ERR_CONNECT_TIMEOUT') return '连接超时，请检查网络';
  return err.message || String(err);
}

async function request(url, options, timeoutMs, externalSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
  const onAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) onAbort();
    else externalSignal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (process.env.DSKPET_DEBUG) console.log('[llm] fetch error', err.name, err.message);
    throw err;
  } finally {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener('abort', onAbort);
  }
}

async function readError(res) {
  let body = '';
  try {
    body = (await res.text()).slice(0, 2000);
  } catch {
    /* ignore */
  }
  let msg = `HTTP ${res.status}`;
  try {
    const parsed = JSON.parse(body);
    msg = parsed.error?.message || parsed.message || parsed.error || msg;
  } catch {
    if (body) msg = `${msg}: ${body.slice(0, 300)}`;
  }
  return new LLMError(msg, { status: res.status, body });
}

function extractChoice(json) {
  const choice = json?.choices?.[0];
  if (!choice) return '';
  const content = choice.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((p) => (typeof p === 'string' ? p : p?.text || '')).join('');
  }
  if (typeof choice.text === 'string') return choice.text;
  return '';
}

async function chat({ messages, config, signal, timeoutMs = DEFAULT_TIMEOUT }) {
  if (!config.baseURL) throw new LLMError('API Base URL 为空', { code: 'NO_BASE_URL' });
  if (!config.model) throw new LLMError('模型名为空', { code: 'NO_MODEL' });
  const url = endpoint(config.baseURL, '/chat/completions');
  const body = {
    model: config.model,
    messages,
    temperature: typeof config.temperature === 'number' ? config.temperature : 0.8,
    max_tokens: config.maxTokens || 1600,
    stream: false
  };
  let res;
  try {
    res = await request(url, { method: 'POST', headers: headersFor(config), body: JSON.stringify(body) }, timeoutMs, signal);
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new LLMError(friendlyError(err), { code: err.code || err.cause?.code || '' });
  }
  if (!res.ok) throw await readError(res);
  const json = await res.json();
  return {
    content: extractChoice(json),
    usage: json.usage || null,
    finishReason: json.choices?.[0]?.finish_reason || null,
    raw: json
  };
}

async function streamChat({ messages, config, signal, onDelta, timeoutMs = DEFAULT_TIMEOUT }) {
  if (!config.baseURL) throw new LLMError('API Base URL 为空', { code: 'NO_BASE_URL' });
  if (!config.model) throw new LLMError('模型名为空', { code: 'NO_MODEL' });

  const url = endpoint(config.baseURL, '/chat/completions');
  const body = {
    model: config.model,
    messages,
    temperature: typeof config.temperature === 'number' ? config.temperature : 0.8,
    max_tokens: config.maxTokens || 1600,
    stream: true
  };

  let res;
  try {
    if (process.env.DSKPET_DEBUG) console.log('[llm] fetch start', url, 'bodyBytes=', JSON.stringify(body).length);
    res = await request(url, { method: 'POST', headers: headersFor(config), body: JSON.stringify(body) }, timeoutMs, signal);
    if (process.env.DSKPET_DEBUG) console.log('[llm] fetch returned', res.status);
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new LLMError(friendlyError(err), { code: err.code || err.cause?.code || '' });
  }
  if (process.env.DSKPET_DEBUG) console.log('[llm] stream response', res.status, res.headers.get('content-type'));
  if (!res.ok) throw await readError(res);

  const contentType = String(res.headers.get('content-type') || '');
  // 某些本地服务忽略 stream=true，直接返回整段 JSON
  if (!res.body || contentType.includes('application/json')) {
    const json = await res.json();
    const content = extractChoice(json);
    if (content && onDelta) onDelta(content);
    return {
      content,
      usage: json.usage || null,
      finishReason: json.choices?.[0]?.finish_reason || null
    };
  }

  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let full = '';
  let usage = null;
  let finishReason = null;

  const handleLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(':')) return;
    if (!trimmed.startsWith('data:')) return;
    const data = trimmed.slice(5).trim();
    if (!data || data === '[DONE]') return;
    let json;
    try {
      json = JSON.parse(data);
    } catch {
      return;
    }
    if (json.usage) usage = json.usage;
    const choice = json.choices?.[0];
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    const delta = choice?.delta;
    let piece = '';
    if (typeof delta?.content === 'string') piece = delta.content;
    else if (Array.isArray(delta?.content)) piece = delta.content.map((p) => p?.text || '').join('');
    else if (typeof choice?.text === 'string') piece = choice.text;
    if (piece) {
      full += piece;
      if (onDelta) onDelta(piece);
    }
  };

  try {
    for await (const chunk of res.body) {
      if (process.env.DSKPET_DEBUG) console.log('[llm] chunk', chunk.length);
      buffer += decoder.decode(chunk, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        handleLine(line);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) handleLine(buffer);
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new LLMError(friendlyError(err), { code: err.code || '' });
  }

  return { content: full, usage, finishReason };
}
function parseJsonLoose(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const source = fenced ? fenced[1] : text;
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(source.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function summarize({ persona, profile, episodes, transcript, config, signal }) {
  const system = [
    '你是长期记忆整理器，负责把一段桌宠与用户的对话压缩成可复用的记忆。',
    '只输出 JSON，不要输出任何解释、前后缀或代码块标记。',
    'JSON 结构：{"profile": "...", "episode": "...", "tags": ["..."], "mood": "..."}',
    'profile：对用户的长期档案（身份、偏好、习惯、重要关系、长期目标、雷区），≤600字。',
    '  必须合并旧档案中仍然有效的信息；没有新信息就原样保留；不要编造。',
    'episode：本次对话的简短记录，≤120字，写清用户说了什么、情绪如何、有没有约定或待办。',
    'tags：2~5 个短标签；mood：用一个词概括用户当前情绪。',
    '记忆只记录与用户相关的事实，不记录你的角色设定。'
  ].join('\n');

  const recent = (episodes || [])
    .slice(-6)
    .map((e, i) => `${i + 1}. ${e.summary || ''}`)
    .join('\n');

  const user = [
    `【角色】${persona?.name || '桌宠'}（仅用于理解对话语气，不要写进记忆档案）`,
    `【旧档案】\n${profile ? profile : '（空）'}`,
    `【最近记忆】\n${recent || '（空）'}`,
    `【本次对话】\n${transcript}`
  ].join('\n\n');

  const res = await chat({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    config: { ...config, temperature: 0.2, maxTokens: 900 },
    signal,
    timeoutMs: 90000
  });

  const json = parseJsonLoose(res.content);
  if (!json) {
    return {
      profile: profile || '',
      episode: String(res.content || '').slice(0, 120),
      tags: [],
      mood: ''
    };
  }
  return {
    profile: String(json.profile || profile || '').slice(0, 6000),
    episode: String(json.episode || '').slice(0, 300),
    tags: Array.isArray(json.tags) ? json.tags.map(String).slice(0, 8) : [],
    mood: String(json.mood || '').slice(0, 40)
  };
}

async function quickLine({ prompt, config, signal }) {
  const res = await chat({
    messages: [
      {
        role: 'system',
        content: '你是一句日常碎碎念生成器。只输出一句话本身，不加引号、不加解释、不提问。'
      },
      { role: 'user', content: prompt }
    ],
    config: { ...config, temperature: 1.0, maxTokens: 80 },
    signal,
    timeoutMs: 15000
  });
  return String(res.content || '').replace(/^["'“”]+|["'“”]+$/g, '').replace(/\s+/g, ' ').trim().slice(0, 60);
}

async function testConnection({ config, signal }) {
  const started = Date.now();
  const res = await chat({
    messages: [
      { role: 'system', content: '你是一个连通性测试端点。' },
      { role: 'user', content: '请只回复 ok 两个字母。' }
    ],
    config: { ...config, maxTokens: 8, temperature: 0 },
    signal,
    timeoutMs: 30000
  });
  return { ok: true, latency: Date.now() - started, reply: res.content, usage: res.usage };
}

module.exports = {
  LLMError,
  friendlyError,
  chat,
  streamChat,
  summarize,
  quickLine,
  testConnection
};
