'use strict';

const llm = require('./llm');
const { getTimeContext } = require('./bubbles');

const running = new Set();

function fmtDate(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function buildSystemPrompt({ persona, memory, now = new Date() }) {
  const ctx = getTimeContext(now);
  const dateStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日 星期${'日一二三四五六'[now.getDay()]}`;
  const episodes = Array.isArray(memory?.episodes) ? memory.episodes.slice(-8) : [];
  const memoryBlock = episodes.length
    ? episodes.map((e) => `- [${fmtDate(e.ts)}] ${e.summary}`).join('\n')
    : '（你们还没有积累太多共同记忆）';

  return [
    `你是「${persona?.name || '桌宠'}」，${persona?.tagline || '住在用户桌面上的小伙伴'}。`,
    '你此刻正以一只小小桌面宠物的身份陪在用户身边，用户会通过点击你打开对话窗口。',
    '',
    '【你的人格】',
    persona?.persona || '温柔、好奇、有点黏人的桌面小伙伴。',
    '',
    '【你的灵魂】',
    persona?.soul || '真诚地关心用户，尊重用户的节奏。',
    '',
    '【表达方式】',
    persona?.style || '自然口语化，简洁，不说教。',
    '',
    '【长期记忆】',
    '以下是你记得的、关于用户的事。自然地使用它们，像老朋友一样提起；',
    '不要逐条复述，不要说"根据我的记忆"或暴露记忆文件的存在。',
    `用户档案：${memory?.profile ? memory.profile : '（还在慢慢了解中）'}`,
    '最近的共同片段：',
    memoryBlock,
    '',
    '【此刻】',
    `现在是 ${dateStr} ${ctx.time}（${ctx.label}）。`,
    '',
    '【能力与规则】',
    '- 你可以陪用户闲聊，也可以认真帮忙分析问题、写代码、整理文档。',
    '- 用户可能发送文件；文本内容会以「【附件 文件名】」标记出现在消息里，其他文件给出路径。',
    '- 输出使用 Markdown。外链写成 [标题](https://...)，用户点击即可用浏览器打开。',
    '- 提到本地文件时给出完整路径（例如 C:\\\\Users\\\\me\\\\a.txt），用户可以直接点击打开。',
    '- 不编造事实；不确定就说不确定。保持角色一致，但用户认真求助时优先清晰可靠。',
    '- 回答长度适中，除非用户要求详细展开。'
  ].join('\n');
}

function buildTranscript(session, persona) {
  const msgs = session.messages.filter((m) => m.role === 'user' || m.role === 'assistant');
  let out = msgs
    .map((m) => `${m.role === 'user' ? '用户' : persona?.name || '桌宠'}：${String(m.content || '').trim()}`)
    .filter((line) => !line.endsWith('：'))
    .join('\n');
  const LIMIT = 9000;
  if (out.length > LIMIT) out = '…（前文省略）\n' + out.slice(out.length - LIMIT);
  return out;
}

async function summarizeSession({ store, sessionId, apiConfig, signal }) {
  if (running.has(sessionId)) return { ok: false, reason: 'busy' };
  const session = store.getSession(sessionId);
  if (!session) return { ok: false, reason: 'missing' };

  const start = Math.max(0, Number(session.summarizedCount) || 0);
  const pending = session.messages.slice(start).filter((m) => (m.role === 'user' || m.role === 'assistant') && String(m.content || '').trim());
  if (pending.length < 1) return { ok: false, reason: 'empty' };

  running.add(sessionId);
  try {
    const persona = store.getActivePersona();
    const memory = store.getMemory();
    const upTo = start + (session.messages.length - start);
    const result = await llm.summarize({
      persona,
      profile: memory.profile,
      episodes: memory.episodes.slice(-6),
      transcript: buildTranscript(session, persona),
      config: apiConfig,
      signal
    });

    if (result.profile && result.profile !== memory.profile) {
      store.setMemoryProfile(result.profile);
    }
    if (result.episode) {
      store.addEpisode({
        sessionId,
        summary: result.episode,
        tags: result.tags || [],
        mood: result.mood || ''
      });
    }
    session.summarizedCount = upTo;
    store.saveSessionsSoon(0);

    return { ok: true, profile: result.profile, episode: result.episode, tags: result.tags, mood: result.mood };
  } catch (err) {
    return { ok: false, reason: llm.friendlyError(err), error: String(err && err.message) };
  } finally {
    running.delete(sessionId);
  }
}

async function summarizeAllPending({ store, apiConfig, minMessages = 3 }) {
  const results = [];
  for (const session of store.getSessions()) {
    const start = Math.max(0, Number(session.summarizedCount) || 0);
    const pending = session.messages.slice(start).filter((m) => (m.role === 'user' || m.role === 'assistant') && String(m.content || '').trim());
    if (pending.length >= minMessages) {
      // eslint-disable-next-line no-await-in-loop
      const r = await summarizeSession({ store, sessionId: session.id, apiConfig });
      results.push({ sessionId: session.id, ...r });
    }
  }
  return results;
}

module.exports = {
  buildSystemPrompt,
  summarizeSession,
  summarizeAllPending,
  buildTranscript
};
