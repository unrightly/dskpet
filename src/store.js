'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { safeStorage } = require('electron');
const defaults = require('./defaults');

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function deepMerge(base, patch) {
  if (Array.isArray(base) || Array.isArray(patch)) return patch === undefined ? base : patch;
  if (typeof base !== 'object' || base === null) return patch === undefined ? base : patch;
  const out = { ...base };
  for (const [k, v] of Object.entries(patch || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof out[k] === 'object' && out[k] !== null) {
      out[k] = deepMerge(out[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function readJson(file, fallback) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    if (!raw.trim()) return clone(fallback);
    return JSON.parse(raw);
  } catch {
    return clone(fallback);
  }
}

function writeJson(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}

class Store {
  constructor(userDataDir) {
    this.dir = path.join(userDataDir, 'data');
    this.files = {
      config: path.join(this.dir, 'config.json'),
      sessions: path.join(this.dir, 'sessions.json'),
      memory: path.join(this.dir, 'memory.json')
    };
    this.config = null;
    this.sessions = null;
    this.memory = null;
    this._sessionsTimer = null;
  }

  init() {
    fs.mkdirSync(this.dir, { recursive: true });
    this.config = deepMerge(clone(defaults.DEFAULT_CONFIG), readJson(this.files.config, {}));
    this.sessions = readJson(this.files.sessions, defaults.DEFAULT_SESSIONS);
    if (!Array.isArray(this.sessions.sessions)) this.sessions.sessions = [];
    this.memory = deepMerge(clone(defaults.DEFAULT_MEMORY), readJson(this.files.memory, {}));
    // 旧版本可能留下空会话：启动时清理，不再写回
    const beforePrune = this.sessions.sessions.length;
    this.sessions.sessions = this.sessions.sessions.filter(
      (s) => Array.isArray(s.messages) && s.messages.length > 0
    );
    if (this.sessions.sessions.length !== beforePrune) this.saveSessions();
    // 旧版本明文 key 迁移到 safeStorage
    if (this.config.api.apiKey && !this.config.api.apiKeyEnc) {
      this.setApiKey(this.config.api.apiKey);
      this.config.api.apiKey = '';
    }
    this._normalizePersonas();
    return this;
  }

  _normalizePersonas() {
    const list = Array.isArray(this.config.personas) ? this.config.personas : [];
    const clean = list.filter((p) => p && p.id && p.name);
    if (!clean.length) clean.push(clone(defaults.PERSONA_RONG));
    for (const p of clean) {
      p.bubbles = Array.isArray(p.bubbles) ? p.bubbles : [];
      p.persona = p.persona || '';
      p.soul = p.soul || '';
      p.style = p.style || '';
      p.greeting = p.greeting || '';
      p.color = p.color || '#F2A65A';
      p.tagline = p.tagline || '';
    }
    this.config.personas = clean;
    if (!clean.find((p) => p.id === this.config.activePersonaId)) {
      this.config.activePersonaId = clean[0].id;
    }
  }

  saveConfig() {
    writeJson(this.files.config, this.config);
  }

  getConfig() {
    return this.config;
  }

  getPublicConfig() {
    const c = this.config;
    return {
      api: {
        baseURL: c.api.baseURL,
        model: c.api.model,
        temperature: c.api.temperature,
        maxTokens: c.api.maxTokens,
        vision: c.api.vision,
        extraHeaders: c.api.extraHeaders || '',
        apiKeySet: this.hasApiKey(),
        apiKeyMasked: this.maskedKey()
      },
      pet: clone(c.pet),
      ui: clone(c.ui),
      memory: clone(c.memory),
      activePersonaId: c.activePersonaId
    };
  }

  updateConfig(patch) {
    this.config = deepMerge(this.config, patch || {});
    this._normalizePersonas();
    this.saveConfig();
    return this.config;
  }

  // ---- API key (encrypted at rest when possible) ----
  setApiKey(key) {
    const value = String(key || '').trim();
    if (!value) {
      this.clearApiKey();
      return;
    }
    let enc = '';
    try {
      if (safeStorage.isEncryptionAvailable()) {
        enc = safeStorage.encryptString(value).toString('base64');
      }
    } catch {
      enc = '';
    }
    if (enc) {
      this.config.api.apiKeyEnc = enc;
      this.config.api.apiKey = '';
    } else {
      this.config.api.apiKeyEnc = '';
      this.config.api.apiKey = value;
    }
    this.saveConfig();
  }

  clearApiKey() {
    this.config.api.apiKeyEnc = '';
    this.config.api.apiKey = '';
    this.saveConfig();
  }

  getApiKey() {
    const cfg = this.config.api;
    if (cfg.apiKeyEnc) {
      try {
        return safeStorage.decryptString(Buffer.from(cfg.apiKeyEnc, 'base64'));
      } catch {
        return '';
      }
    }
    return cfg.apiKey || '';
  }

  hasApiKey() {
    return !!this.getApiKey();
  }

  maskedKey() {
    const key = this.getApiKey();
    if (!key) return '';
    if (key.length <= 8) return '****';
    return `${key.slice(0, 4)}****${key.slice(-4)}`;
  }

  getEffectiveApiConfig() {
    const cfg = this.config.api;
    let extraHeaders = {};
    const raw = String(cfg.extraHeaders || '').trim();
    if (raw) {
      try {
        extraHeaders = JSON.parse(raw);
      } catch {
        for (const line of raw.split(/\r?\n/)) {
          const idx = line.indexOf(':');
          if (idx > 0) extraHeaders[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
        }
      }
    }
    return {
      baseURL: cfg.baseURL,
      apiKey: this.getApiKey(),
      model: cfg.model,
      temperature: cfg.temperature,
      maxTokens: cfg.maxTokens,
      vision: cfg.vision,
      extraHeaders
    };
  }

  // ---- personas ----
  getPersonas() {
    return this.config.personas;
  }

  getActivePersona() {
    return (
      this.config.personas.find((p) => p.id === this.config.activePersonaId) ||
      this.config.personas[0]
    );
  }

  getPersona(id) {
    return this.config.personas.find((p) => p.id === id) || null;
  }

  savePersona(persona) {
    if (!persona || !persona.name) throw new Error('人格名称不能为空');
    const list = this.config.personas;
    if (persona.id && list.some((p) => p.id === persona.id)) {
      const idx = list.findIndex((p) => p.id === persona.id);
      list[idx] = { ...list[idx], ...persona, bubbles: Array.isArray(persona.bubbles) ? persona.bubbles : list[idx].bubbles };
    } else {
      const id = persona.id || `p_${crypto.randomUUID().slice(0, 8)}`;
      list.push({ ...persona, id, bubbles: Array.isArray(persona.bubbles) ? persona.bubbles : [] });
      this.config.activePersonaId = id;
    }
    this._normalizePersonas();
    this.saveConfig();
    return this.getActivePersona();
  }

  deletePersona(id) {
    if (this.config.personas.length <= 1) throw new Error('至少保留一个人格预设');
    this.config.personas = this.config.personas.filter((p) => p.id !== id);
    if (this.config.activePersonaId === id) this.config.activePersonaId = this.config.personas[0].id;
    this.saveConfig();
    return this.getActivePersona();
  }

  setActivePersona(id) {
    if (!this.getPersona(id)) throw new Error('人格不存在');
    this.config.activePersonaId = id;
    this.saveConfig();
    return this.getActivePersona();
  }

  // ---- sessions ----
  getSessions() {
    return this.sessions.sessions;
  }

  getSession(id) {
    return this.sessions.sessions.find((s) => s.id === id) || null;
  }

  getLatestSession() {
    const list = this.getSessions().filter((s) => Array.isArray(s.messages) && s.messages.length > 0);
    return list.length ? list[list.length - 1] : null;
  }

  createSession() {
    // 每次打开只保留一个空草稿；空对话不落盘
    this.sessions.sessions = this.sessions.sessions.filter(
      (s) => Array.isArray(s.messages) && s.messages.length > 0
    );
    const session = {
      id: `s_${crypto.randomUUID()}`,
      title: '新的对话',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      summarizedCount: 0,
      draft: true,
      messages: []
    };
    this.sessions.sessions.push(session);
    if (this.sessions.sessions.length > 200) {
      this.sessions.sessions = this.sessions.sessions.slice(-200);
    }
    return session;
  }

  appendMessage(sessionId, message) {
    const session = this.getSession(sessionId);
    if (!session) throw new Error('会话不存在');
    const wasDraft = !!session.draft;
    const msg = {
      id: `m_${crypto.randomUUID()}`,
      ts: Date.now(),
      ...message
    };
    session.messages.push(msg);
    session.updatedAt = Date.now();
    session.draft = false;
    if (session.title === '新的对话' && msg.role === 'user') {
      const text = String(msg.content || '').replace(/\s+/g, ' ').trim();
      if (text) session.title = text.slice(0, 18) + (text.length > 18 ? '…' : '');
    }
    if (wasDraft) this.saveSessionsSoon(0);
    else this.saveSessionsSoon();
    return msg;
  }

  updateSession(id, patch) {
    const session = this.getSession(id);
    if (!session) return null;
    Object.assign(session, patch);
    this.saveSessionsSoon();
    return session;
  }

  deleteSession(id) {
    this.sessions.sessions = this.sessions.sessions.filter((s) => s.id !== id);
    this.saveSessions();
  }

  _persistedSessions() {
    return this.sessions.sessions.filter((s) => Array.isArray(s.messages) && s.messages.length > 0);
  }

  saveSessions() {
    if (this._sessionsTimer) {
      clearTimeout(this._sessionsTimer);
      this._sessionsTimer = null;
    }
    writeJson(this.files.sessions, { sessions: this._persistedSessions() });
  }

  saveSessionsSoon(delay = 250) {
    if (this._sessionsTimer) return;
    this._sessionsTimer = setTimeout(() => {
      this._sessionsTimer = null;
      try {
        writeJson(this.files.sessions, { sessions: this._persistedSessions() });
      } catch (err) {
        console.error('[store] save sessions failed:', err);
      }
    }, delay);
  }

  // ---- memory ----
  getMemory() {
    return this.memory;
  }

  saveMemory() {
    this.memory.updatedAt = Date.now();
    writeJson(this.files.memory, this.memory);
  }

  setMemoryProfile(profile) {
    this.memory.profile = String(profile || '').slice(0, 8000);
    this.saveMemory();
  }

  addEpisode(episode) {
    const cfg = this.config.memory;
    this.memory.episodes.push({
      id: `e_${crypto.randomUUID().slice(0, 8)}`,
      ts: Date.now(),
      ...episode
    });
    const keep = Math.max(20, Number(cfg.keepEpisodes) || 120);
    if (this.memory.episodes.length > keep) {
      this.memory.episodes = this.memory.episodes.slice(-keep);
    }
    this.saveMemory();
  }

  clearMemory() {
    this.memory = clone(defaults.DEFAULT_MEMORY);
    this.saveMemory();
    // 旧对话全部视为“已整理”，避免清空后又被历史记录重新喂回来
    for (const s of this.sessions.sessions) s.summarizedCount = s.messages.length;
    this.saveSessions();
  }

  flushSync() {
    try {
      this.saveSessions();
      this.saveConfig();
      this.saveMemory();
    } catch (err) {
      console.error('[store] flush failed:', err);
    }
  }
}

module.exports = { Store, deepMerge };
