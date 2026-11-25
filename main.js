'use strict';

const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, nativeTheme, screen, shell, dialog, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');

const { Store } = require('./src/store');
const defaults = require('./src/defaults');
const llm = require('./src/llm');
const memoryEngine = require('./src/memory');
const bubbleEngine = require('./src/bubbles');

app.setName('DskPet');
app.setAppUserModelId('com.dskpet.app');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
if (process.env.DSKPET_DATA_DIR) {
  app.setPath('userData', path.resolve(process.env.DSKPET_DATA_DIR));
}

const isDev = process.argv.includes('--dev');
const isSmoke = process.argv.includes('--smoke');
const PET_BASE_W = 390;
const PET_BASE_H = 360;

let store = null;
let petWin = null;
let chatWin = null;
let settingsWin = null;
let tray = null;
let isQuitting = false;
let petVisible = true;
let bubbleTimer = null;
let topTimer = null;
let trayMenu = null;

const activeStreams = new Map();
const recentBubbles = [];
const dragState = { active: false, startScreen: null, startWin: null };

const gotLock = app.requestSingleInstanceLock();
let pendingShow = false;

if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!app.isReady() || !store) {
      pendingShow = true;
      return;
    }
    revealApp();
  });
}

function logLine(message) {
  try {
    const dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'app.log'), `[${new Date().toISOString()}] ${message}\n`, 'utf8');
  } catch {
    /* ignore */
  }
}

process.on('uncaughtException', (err) => {
  logLine(`uncaughtException: ${err && (err.stack || err.message || err)}`);
  console.error(err);
});

process.on('unhandledRejection', (err) => {
  logLine(`unhandledRejection: ${err && (err.stack || err.message || err)}`);
  console.error(err);
});

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function isLocalBase(url) {
  return /^https?:\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\])(:|\/|$)/i.test(String(url || ''));
}

function fmtSize(bytes) {
  if (!Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function safeStat(p) {
  try {
    const stat = fs.statSync(p);
    if (!stat.isFile()) return null;
    const ext = path.extname(p).toLowerCase();
    return {
      path: p,
      name: path.basename(p),
      size: stat.size,
      sizeLabel: fmtSize(stat.size),
      ext,
      isImage: ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes(ext)
    };
  } catch {
    return null;
  }
}

function isTextBuffer(buf) {
  if (!buf || !buf.length) return true;
  const sample = Math.min(buf.length, 8192);
  for (let i = 0; i < sample; i += 1) {
    if (buf[i] === 0) return false;
  }
  const text = buf.toString('utf8');
  const bad = (text.match(/\uFFFD/g) || []).length;
  return bad / Math.max(1, text.length) < 0.01;
}

function mimeFor(ext) {
  return (
    {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
      '.bmp': 'image/bmp'
    }[ext] || 'application/octet-stream'
  );
}

function sessionMeta(s) {
  return {
    id: s.id,
    title: s.title,
    updatedAt: s.updatedAt,
    messageCount: s.messages.length
  };
}

function sessionsSorted() {
  return [...store.getSessions()]
    .filter((s) => Array.isArray(s.messages) && s.messages.length > 0)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(sessionMeta);
}

function broadcast(channel, payload) {
  for (const win of [petWin, chatWin, settingsWin]) {
    if (win && !win.isDestroyed()) {
      try {
        win.webContents.send(channel, payload);
      } catch {
        /* ignore */
      }
    }
  }
}

function chatWindowAlive() {
  return chatWin && !chatWin.isDestroyed();
}

function clampPosition(x, y, w, h) {
  const display = screen.getDisplayNearestPoint({ x: Math.round(x + w / 2), y: Math.round(y + h / 2) });
  const area = display.workArea;
  return [
    Math.min(Math.max(Math.round(x), area.x), area.x + area.width - w),
    Math.min(Math.max(Math.round(y), area.y), area.y + area.height - h)
  ];
}

function attachDiagnostics(win, name) {
  if (!win || (!isDev && !isSmoke)) return;
  win.webContents.on('console-message', (event, ...args) => {
    let level = 0;
    let message = '';
    let line = 0;
    let sourceId = '';
    if (args[0] && typeof args[0] === 'object') {
      const details = args[0];
      level = details.level === 'error' ? 3 : details.level === 'warning' ? 2 : 0;
      message = details.message;
      line = details.lineNumber;
      sourceId = details.sourceId;
    } else {
      [level, message, line, sourceId] = args;
    }
    if (level >= 2) console.log(`[renderer:${name}] ${message} (${sourceId}:${line})`);
  });
  win.webContents.on('render-process-gone', (event, details) => {
    console.error(`[renderer:${name}] gone:`, details.reason);
  });
  win.webContents.on('did-fail-load', (event, code, desc, url) => {
    console.error(`[renderer:${name}] load failed: ${code} ${desc} ${url}`);
  });
}

/* ------------------------------------------------------------------ */
/* windows                                                             */
/* ------------------------------------------------------------------ */

function createPetWindow() {
  const cfg = store.getConfig();
  petVisible = true;
  const scale = Math.min(1.45, Math.max(0.75, Number(cfg.pet.scale) || 1));
  const width = Math.round(PET_BASE_W * Math.min(1.2, Math.max(0.85, scale)));
  const height = Math.round(PET_BASE_H * Math.min(1.2, Math.max(0.85, scale)));

  const display = screen.getPrimaryDisplay();
  const area = display.workArea;
  let [x, y] = cfg.pet.position
    ? [cfg.pet.position.x, cfg.pet.position.y]
    : [area.x + area.width - width - 28, area.y + area.height - height - 16];
  [x, y] = clampPosition(x, y, width, height);

  petWin = new BrowserWindow({
    width,
    height,
    x,
    y,
    transparent: true,
    frame: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      spellcheck: false
    }
  });

  petWin.loadFile(path.join(__dirname, 'renderer', 'pet.html'));
  attachDiagnostics(petWin, 'pet');

  petWin.once('ready-to-show', () => {
    petWin.showInactive();
    if (cfg.pet.alwaysOnTop) petWin.setAlwaysOnTop(true, 'screen-saver', 1);
    else petWin.setAlwaysOnTop(false);
    petWin.setSkipTaskbar(true);
    petWin.setIgnoreMouseEvents(true, { forward: true });
  });

  petWin.webContents.on('did-finish-load', () => {
    petWin.setIgnoreMouseEvents(true, { forward: true });
    syncPetConfig();
  });

  let moveTimer = null;
  petWin.on('moved', () => {
    if (moveTimer) clearTimeout(moveTimer);
    moveTimer = setTimeout(() => {
      if (!petWin || petWin.isDestroyed()) return;
      const [px, py] = petWin.getPosition();
      store.updateConfig({ pet: { position: { x: px, y: py } } });
    }, 500);
  });

  petWin.on('closed', () => {
    petWin = null;
  });

  if (isDev) petWin.webContents.openDevTools({ mode: 'detach' });

  // 定时把宠物顶回最上层，避免被后来的置顶窗口压住
  if (topTimer) clearInterval(topTimer);
  topTimer = setInterval(() => {
    if (!petWin || petWin.isDestroyed() || !petVisible) return;
    const conf = store.getConfig();
    if (!conf.pet.alwaysOnTop) return;
    try {
      petWin.setAlwaysOnTop(true, 'screen-saver', 1);
    } catch {
      /* ignore */
    }
  }, 4000);
}

function createChatWindow() {
  if (chatWindowAlive()) return chatWin;

  chatWin = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 820,
    minHeight: 560,
    frame: false,
    show: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    maximizable: false,
    fullscreenable: false,
    thickFrame: true,
    title: '绒绒',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      spellcheck: false
    }
  });

  chatWin.loadFile(path.join(__dirname, 'renderer', 'chat.html'));
  attachDiagnostics(chatWin, 'chat');

  chatWin.once('ready-to-show', () => {
    chatWin.show();
    chatWin.focus();
  });

  chatWin.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      chatWin.hide();
      petWin?.webContents.send('pet:mood', 'idle');
      maybeSummarizeAll();
    }
  });

  chatWin.on('closed', () => {
    chatWin = null;
  });

  if (isDev) chatWin.webContents.openDevTools({ mode: 'detach' });
  return chatWin;
}

function createSettingsWindow() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.show();
    settingsWin.focus();
    return settingsWin;
  }

  settingsWin = new BrowserWindow({
    width: 840,
    height: 680,
    minWidth: 760,
    minHeight: 560,
    frame: false,
    show: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    maximizable: false,
    fullscreenable: false,
    thickFrame: true,
    title: '设置',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  });

  settingsWin.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
  attachDiagnostics(settingsWin, 'settings');

  settingsWin.once('ready-to-show', () => {
    settingsWin.show();
    settingsWin.focus();
  });

  settingsWin.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      settingsWin.hide();
    }
  });

  settingsWin.on('closed', () => {
    settingsWin = null;
  });

  if (isDev) settingsWin.webContents.openDevTools({ mode: 'detach' });
  return settingsWin;
}

function ensurePetOnScreen() {
  if (!petWin || petWin.isDestroyed() || !store) return;
  const [w, h] = petWin.getSize();
  const [x, y] = petWin.getPosition();
  const [cx, cy] = clampPosition(x, y, w, h);
  if (cx !== x || cy !== y) petWin.setPosition(cx, cy);
  store.updateConfig({ pet: { position: { x: cx, y: cy } } });
}

function revealApp() {
  if (!store) {
    pendingShow = true;
    return;
  }
  if (!petWin || petWin.isDestroyed()) {
    createPetWindow();
  } else {
    petVisible = true;
    ensurePetOnScreen();
    petWin.showInactive();
  }
  petVisible = true;
  showChat();
  buildTrayMenu();
  logLine('second instance: revealed pet + chat');
}

function showChat() {
  const existed = chatWindowAlive();
  const wasOpen = existed && (chatWin.isVisible() || chatWin.isMinimized());

  createChatWindow();
  if (chatWin.isMinimized()) chatWin.restore();
  chatWin.show();
  chatWin.focus();

  // 从隐藏状态重新打开：开一段全新的草稿对话（未发消息不会保存）
  if (existed && !wasOpen && !chatWin.webContents.isLoading()) {
    const session = store.createSession();
    chatWin.webContents.send('chat:new-draft', { session, sessions: sessionsSorted() });
  }

  petWin?.webContents.send('pet:mood', 'happy');
}

function showSettings() {
  createSettingsWindow();
}

function togglePet(force) {
  if (!petWin || petWin.isDestroyed()) {
    createPetWindow();
    petVisible = true;
    buildTrayMenu();
    return;
  }
  petVisible = typeof force === 'boolean' ? force : !petVisible;
  if (petVisible) petWin.showInactive();
  else petWin.hide();
  buildTrayMenu();
}

function syncPetConfig() {
  if (!petWin || petWin.isDestroyed() || !store) return;
  const cfg = store.getConfig();
  const persona = store.getActivePersona();
  petWin.webContents.send('pet:config', {
    scale: cfg.pet.scale,
    name: persona.name,
    color: persona.color,
    greeting: persona.greeting
  });
  buildTrayMenu();
}

function applyPetScale() {
  if (!petWin || petWin.isDestroyed() || !store) return;
  const cfg = store.getConfig();
  const scale = Math.min(1.45, Math.max(0.75, Number(cfg.pet.scale) || 1));
  const width = Math.round(PET_BASE_W * Math.min(1.2, Math.max(0.85, scale)));
  const height = Math.round(PET_BASE_H * Math.min(1.2, Math.max(0.85, scale)));
  const [oldW, oldH] = petWin.getSize();
  const [x, y] = petWin.getPosition();
  if (oldW === width && oldH === height) return;
  petWin.setSize(width, height, false);
  // 以底边中点为锚点缩放，避免宠物突然跑出屏幕
  let nx = x + Math.round((oldW - width) / 2);
  let ny = y + (oldH - height);
  [nx, ny] = clampPosition(nx, ny, width, height);
  petWin.setPosition(nx, ny);
  store.updateConfig({ pet: { position: { x: nx, y: ny } } });
}

/* ------------------------------------------------------------------ */
/* tray                                                                */
/* ------------------------------------------------------------------ */

function createTray() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  let image;
  if (fs.existsSync(iconPath)) {
    image = nativeImage.createFromPath(iconPath);
    image = image.resize({ width: 32, height: 32 });
  } else {
    image = nativeImage.createEmpty();
  }
  tray = new Tray(image);
  tray.setToolTip('绒绒 · 桌面宠物');
  buildTrayMenu();
  tray.on('double-click', () => showChat());
}

function buildTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
  const persona = store ? store.getActivePersona() : { name: '绒绒' };
  const cfg = store ? store.getConfig() : defaults.DEFAULT_CONFIG;
  trayMenu = Menu.buildFromTemplate([
    { label: `和${persona.name}说说话`, click: () => showChat() },
    { label: '让她说句话', click: () => emitBubble({ manual: true }) },
    { type: 'separator' },
    { label: petVisible ? `隐藏${persona.name}` : `显示${persona.name}`, click: () => togglePet() },
    { label: '设置…', click: () => showSettings() },
    {
      label: '开机自启',
      type: 'checkbox',
      checked: !!cfg.pet.launchAtLogin,
      click: (item) => {
        store.updateConfig({ pet: { launchAtLogin: item.checked } });
        applyLoginItem(item.checked);
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);
  tray.setContextMenu(trayMenu);
}

function applyTheme() {
  const theme = store?.getConfig()?.ui?.theme;
  nativeTheme.themeSource = ['system', 'light', 'dark'].includes(theme) ? theme : 'system';
}

function applyLoginItem(enabled) {  try {
    app.setLoginItemSettings({
      openAtLogin: !!enabled,
      path: process.execPath,
      args: app.isPackaged ? [] : [path.resolve(__dirname)]
    });
  } catch (err) {
    console.error('[login item]', err);
  }
}

/* ------------------------------------------------------------------ */
/* bubbles                                                             */
/* ------------------------------------------------------------------ */

function currentMoodGuess(now = new Date()) {
  const hour = now.getHours();
  if (hour < 7) return 'sleepy';
  if (hour < 12) return 'curious';
  if (hour < 18) return 'idle';
  if (hour < 23) return 'curious';
  return 'sleepy';
}

function bubbleIntervalMs() {
  const cfg = store.getConfig();
  const minutes = Math.min(240, Math.max(1, Number(cfg.pet.bubbleIntervalMin) || 10));
  return minutes * 60 * 1000;
}

function scheduleBubble(delayMs) {
  if (bubbleTimer) clearTimeout(bubbleTimer);
  const wait = typeof delayMs === 'number' ? delayMs : bubbleIntervalMs();
  bubbleTimer = setTimeout(async () => {
    await emitBubble();
    scheduleBubble();
  }, Math.max(5000, wait));
}

async function emitBubble({ manual = false } = {}) {
  if (!petWin || petWin.isDestroyed()) return null;
  const cfg = store.getConfig();
  const persona = store.getActivePersona();
  const now = new Date();

  let text = bubbleEngine.pickBubble({
    persona,
    now,
    recent: recentBubbles.map((b) => b.text)
  });

  const api = store.getEffectiveApiConfig();
  const apiReady = api.baseURL && api.model && (api.apiKey || isLocalBase(api.baseURL));
  if (cfg.pet.smartBubble && apiReady && Math.random() < (manual ? 0.2 : 0.5)) {
    try {
      const smart = await llm.quickLine({
        prompt: bubbleEngine.buildSmartBubblePrompt({ persona, now, mood: currentMoodGuess(now) }),
        config: api
      });
      if (smart && smart.length >= 4) text = smart.slice(0, 40);
    } catch {
      /* fall back to local pool */
    }
  }

  if (!petWin || petWin.isDestroyed()) return null;
  petWin.webContents.send('pet:bubble', { text, ts: Date.now() });
  recentBubbles.push({ text, ts: Date.now() });
  if (recentBubbles.length > 10) recentBubbles.shift();
  return text;
}

/* ------------------------------------------------------------------ */
/* chat / model                                                        */
/* ------------------------------------------------------------------ */

function buildContextHistory(session, persona) {
  const source = session.messages.slice(-18);
  const mapped = [];
  for (const m of source) {
    if (m.role !== 'user' && m.role !== 'assistant') continue;
    let content = String(m.content || '').trim();
    if (m.role === 'assistant' && m.error) continue;
    if (!content) continue;
    if (m.role === 'user' && Array.isArray(m.attachments) && m.attachments.length) {
      content += `\n（当时发送的附件：${m.attachments.map((a) => a.name).join('、')}）`;
    }
    mapped.push({ role: m.role, content });
  }
  // 从后往前控制字符预算，避免上下文过长
  const budget = 20000;
  const kept = [];
  let chars = 0;
  for (let i = mapped.length - 1; i >= 0; i -= 1) {
    const item = mapped[i];
    chars += item.content.length;
    if (chars > budget && kept.length >= 2) break;
    kept.unshift(item);
  }
  return kept;
}

async function collectAttachmentContent(attachments, config) {
  const textBlocks = [];
  const imageParts = [];
  const metas = [];

  for (const raw of attachments || []) {
    const rawPath = typeof raw === 'string' ? raw : raw?.path;
    const info = safeStat(rawPath);
    if (!info) {
      textBlocks.push(`【附件 ${(raw && raw.name) || rawPath || '未知文件'}】读取失败或文件不存在。`);
      continue;
    }
    metas.push(info);
    try {
      if (info.isImage && config.vision && info.size <= 5 * 1024 * 1024) {
        const b64 = fs.readFileSync(info.path).toString('base64');
        imageParts.push({ type: 'image_url', image_url: { url: `data:${mimeFor(info.ext)};base64,${b64}` } });
        textBlocks.push(`【附件 ${info.name}（图片，${info.sizeLabel}）】路径：${info.path}`);
      } else if (info.size <= 2 * 1024 * 1024) {
        const buf = fs.readFileSync(info.path);
        if (isTextBuffer(buf)) {
          const lang = info.ext.replace('.', '') || '';
          textBlocks.push(`【附件 ${info.name}】\n\`\`\`${lang}\n${buf.toString('utf8')}\n\`\`\``);
        } else {
          textBlocks.push(`【附件 ${info.name}（${info.sizeLabel}，二进制）】路径：${info.path}`);
        }
      } else {
        textBlocks.push(`【附件 ${info.name}（${info.sizeLabel}）】文件较大，未内联。路径：${info.path}`);
      }
    } catch (err) {
      textBlocks.push(`【附件 ${info.name}】读取失败：${err.message}`);
    }
  }

  return { textBlocks, imageParts, metas };
}

async function handleSend(event, payload) {
  const { sessionId, text, attachments } = payload || {};
  const session = store.getSession(sessionId);
  if (!session) return { ok: false, error: '会话不存在' };
  if (activeStreams.has(sessionId)) return { ok: false, error: '正在回复中' };

  const config = store.getEffectiveApiConfig();
  const persona = store.getActivePersona();

  const { textBlocks, imageParts, metas } = await collectAttachmentContent(attachments, config);
  const typed = String(text || '').trim();
  if (!typed && !metas.length && !imageParts.length) return { ok: false, error: '内容为空' };

  const history = buildContextHistory(session, persona);

  let displayContent = typed;
  if (!displayContent && metas.length) displayContent = '';
  const storedMsg = store.appendMessage(sessionId, {
    role: 'user',
    content: displayContent,
    attachments: metas
  });

  if (session.title === '新的对话') {
    const base = typed || `发来了 ${metas.map((m) => m.name).join('、')}`.slice(0, 30);
    session.title = base.slice(0, 18) + (base.length > 18 ? '…' : '');
    store.saveSessionsSoon();
  }

  // 第一条消息发出后会话才真正存在，立刻刷新一次侧栏
  if (chatWindowAlive()) chatWin.webContents.send('chat:sessions-updated', { sessions: sessionsSorted() });

  let currentContent = [typed, ...textBlocks].filter(Boolean).join('\n\n');
  if (!currentContent) currentContent = imageParts.length ? '（发来了一张图片）' : '（发来了文件）';

  const systemPrompt = memoryEngine.buildSystemPrompt({
    persona,
    memory: store.getMemory(),
    now: new Date()
  });

  let userMessage;
  if (imageParts.length) {
    userMessage = {
      role: 'user',
      content: [{ type: 'text', text: currentContent }, ...imageParts]
    };
  } else {
    userMessage = { role: 'user', content: currentContent };
  }

  const messages = [{ role: 'system', content: systemPrompt }, ...history, userMessage];

  const wc = chatWindowAlive() ? chatWin.webContents : null;
  wc?.send('chat:start', { sessionId, userMessageId: storedMsg.id });
  petWin?.webContents.send('pet:mood', 'think');

  const controller = new AbortController();
  activeStreams.set(sessionId, controller);
  let full = '';
  let failed = null;
  let stopped = false;
  let finishReason = null;
  let continuationRounds = 0;
  const MAX_CONTINUATIONS = 3;
  if (process.env.DSKPET_DEBUG) console.log('[chat] send start', sessionId, 'api=', config.baseURL, 'model=', config.model);

  try {
    const apiReady = config.baseURL && config.model && (config.apiKey || isLocalBase(config.baseURL));
    if (!apiReady) {
      const err = new llm.LLMError('还没有配置模型 API', { code: config.baseURL ? 'NO_API_KEY' : 'NO_BASE_URL' });
      throw err;
    }

    let requestMessages = messages;
    for (;;) {
      const result = await llm.streamChat({
        messages: requestMessages,
        config,
        signal: controller.signal,
        onDelta: (delta) => {
          full += delta;
          wc?.send('chat:delta', { sessionId, delta });
        }
      });
      finishReason = result.finishReason || finishReason;

      // 模型因为 max_tokens 被截断：带着已生成内容自动续写，避免半截代码
      const hitLimit = ['length', 'max_tokens'].includes(String(finishReason || '').toLowerCase());
      if (!hitLimit || stopped || !full.trim()) break;
      if (continuationRounds >= MAX_CONTINUATIONS) break;
      continuationRounds += 1;
      if (process.env.DSKPET_DEBUG) {
        console.log('[chat] continuation', continuationRounds, 'for', sessionId, 'chars=', full.length);
      }
      wc?.send('chat:continuing', { sessionId, round: continuationRounds });
      requestMessages = [
        ...messages,
        { role: 'assistant', content: full },
        {
          role: 'user',
          content:
            '继续。请严格从中断的字符处往下写：不要重复任何已输出的内容，不要重新开头，不要解释，直接续写。'
        }
      ];
    }
    if (process.env.DSKPET_DEBUG) console.log('[chat] stream done chars=', full.length);
  } catch (err) {
    if (err.name === 'AbortError') {
      stopped = true;
    } else {
      failed = err;
    }
  } finally {
    activeStreams.delete(sessionId);
  }

  let finalContent = full.trim();
  if (failed) {
    const friendly = llm.friendlyError(failed);
    const isNoKey = failed.code === 'NO_API_KEY' || failed.code === 'NO_BASE_URL';
    if (finalContent) {
      // 已经生成了一部分，保留内容，只在末尾说明中断原因
      finalContent += `\n\n> （生成中断：${friendly}）`;
    } else {
      finalContent = isNoKey
        ? [
            '还没配置模型呢。点右上角 ⚙ →「模型」，填好 Base URL、API Key 和模型名就能聊天啦。',
            '',
            '本地模型（Ollama / LM Studio）不需要 Key，Base URL 指向 `127.0.0.1` 即可。'
          ].join('\n')
        : `唔，出了点问题：${friendly}\n\n可以去「设置 → 模型」检查一下配置，或者稍后再试。`;
    }
  } else if (stopped) {
    finalContent = finalContent ? `${finalContent}\n\n_(停在这里了)_` : '（停下来了）';
  } else if (!finalContent) {
    finalContent = '（这次没说出话来……要不再试一次？）';
  } else if (['length', 'max_tokens'].includes(String(finishReason || '').toLowerCase())) {
    finalContent +=
      '\n\n> （输出达到长度上限，已自动续写若干次，可能仍未完整。可在「设置 → 模型」调高最大回复长度。）';
  }

  const assistantMsg = store.appendMessage(sessionId, {
    role: 'assistant',
    content: finalContent,
    error: !!failed,
    stopped,
    finishReason,
    personaId: persona.id
  });

  wc?.send('chat:done', {
    sessionId,
    message: assistantMsg,
    error: failed ? llm.friendlyError(failed) : null,
    stopped,
    finishReason
  });
  petWin?.webContents.send('pet:mood', failed ? 'curious' : 'happy');

  if (!failed && !stopped) {
    const pending = session.messages.slice(session.summarizedCount || 0).filter((m) => m.role === 'user' || m.role === 'assistant');
    if (store.getConfig().memory.autoSummarize && pending.length >= 4) {
      maybeSummarize(sessionId);
    }
  }

  return { ok: true };
}

async function maybeSummarize(sessionId) {
  const api = store.getEffectiveApiConfig();
  if (!api.baseURL || !api.model || (!api.apiKey && !isLocalBase(api.baseURL))) {
    return { ok: false, reason: 'no-api' };
  }
  const result = await memoryEngine.summarizeSession({ store, sessionId, apiConfig: api });
  if (result.ok) {
    chatWindowAlive() && chatWin.webContents.send('chat:memory', result);
    settingsWin && !settingsWin.isDestroyed() && settingsWin.webContents.send('chat:memory', result);
  }
  return result;
}

function maybeSummarizeAll() {
  const api = store.getEffectiveApiConfig();
  if (!api.baseURL || !api.model || (!api.apiKey && !isLocalBase(api.baseURL))) return;
  memoryEngine
    .summarizeAllPending({ store, apiConfig: api, minMessages: 2 })
    .catch((err) => console.error('[memory] summarize all failed:', err));
}

function createNewSession() {
  // 新对话前，把当前会话里剩下的内容整理成记忆
  maybeSummarizeAll();
  const session = store.createSession();
  return session;
}

/* ------------------------------------------------------------------ */
/* IPC                                                                 */
/* ------------------------------------------------------------------ */

function registerIpc() {
  // ---- window controls ----
  ipcMain.on('win:minimize', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    win?.minimize();
  });
  ipcMain.on('win:close', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    win?.close();
  });
  ipcMain.handle('win:toggle-maximize', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return false;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return win.isMaximized();
  });

  // ---- pet ----
  ipcMain.on('pet:set-ignore', (e, ignore) => {
    if (!petWin || petWin.isDestroyed()) return;
    petWin.setIgnoreMouseEvents(!!ignore, { forward: true });
  });

  ipcMain.on('pet:drag', (e, payload) => {
    if (!petWin || petWin.isDestroyed() || !payload) return;
    const { phase, screenX, screenY } = payload;
    if (phase === 'start') {
      dragState.active = true;
      dragState.startScreen = { x: screenX, y: screenY };
      dragState.startWin = petWin.getPosition();
    } else if (phase === 'move' && dragState.active) {
      const [wx, wy] = dragState.startWin;
      const nx = wx + (screenX - dragState.startScreen.x);
      const ny = wy + (screenY - dragState.startScreen.y);
      petWin.setPosition(Math.round(nx), Math.round(ny));
    } else if (phase === 'end') {
      dragState.active = false;
      const [wx, wy] = petWin.getPosition();
      const [w, h] = petWin.getSize();
      const [cx, cy] = clampPosition(wx, wy, w, h);
      if (cx !== wx || cy !== wy) petWin.setPosition(cx, cy);
      store.updateConfig({ pet: { position: { x: cx, y: cy } } });
    }
  });

  ipcMain.on('pet:open-chat', () => showChat());
  ipcMain.handle('pet:context-menu', () => {
    buildTrayMenu();
    trayMenu?.popup({ window: petWin });
    return true;
  });
  ipcMain.handle('pet:bootstrap', () => {
    const cfg = store.getConfig();
    const persona = store.getActivePersona();
    return {
      name: persona.name,
      color: persona.color,
      scale: cfg.pet.scale,
      greeting: persona.greeting,
      bubbleIntervalMin: cfg.pet.bubbleIntervalMin
    };
  });
  ipcMain.handle('pet:request-bubble', async () => {
    const text = await emitBubble({ manual: true });
    scheduleBubble();
    return text;
  });

  // ---- chat ----
  ipcMain.handle('chat:bootstrap', (e, opts = {}) => {
    // 打开对话窗 = 新建一段草稿对话；刷新元信息时不创建
    const session = opts && opts.createDraft === false ? null : store.createSession();
    const persona = store.getActivePersona();
    return {
      session,
      sessions: sessionsSorted(),
      personas: store.getPersonas().map((p) => ({ id: p.id, name: p.name, color: p.color, tagline: p.tagline })),
      persona,
      memory: {
        profile: store.getMemory().profile,
        episodeCount: store.getMemory().episodes.length,
        recent: store.getMemory().episodes.slice(-5).reverse()
      },
      config: {
        vision: store.getConfig().api.vision,
        apiKeySet: store.hasApiKey(),
        model: store.getConfig().api.model,
        baseURL: store.getConfig().api.baseURL
      },
      providers: defaults.PROVIDER_PRESETS,
      version: app.getVersion()
    };
  });

  ipcMain.handle('chat:new-session', () => {
    const session = createNewSession();
    return { session, sessions: sessionsSorted() };
  });

  ipcMain.handle('chat:load-session', (e, id) => {
    const session = store.getSession(id);
    if (!session) return { ok: false, error: '会话不存在' };
    return { ok: true, session };
  });

  ipcMain.handle('chat:delete-session', (e, id) => {
    store.deleteSession(id);
    return { ok: true, sessions: sessionsSorted() };
  });

  ipcMain.handle('chat:list-sessions', () => ({ sessions: sessionsSorted() }));

  ipcMain.handle('chat:send', async (e, payload) => {
    try {
      return await handleSend(e, payload);
    } catch (err) {
      console.error('[chat:send]', err);
      return { ok: false, error: err.message || String(err) };
    }
  });

  ipcMain.on('chat:abort', (e, sessionId) => {
    const controller = activeStreams.get(sessionId);
    if (controller) controller.abort();
  });

  ipcMain.handle('chat:pick-files', async () => {
    const win = chatWindowAlive() ? chatWin : undefined;
    const result = await dialog.showOpenDialog(win, {
      title: '选择要发送给小宠的文件',
      properties: ['openFile', 'multiSelections']
    });
    if (result.canceled) return [];
    return result.filePaths.map(safeStat).filter(Boolean);
  });

  ipcMain.on('chat:files-dropped', (e, paths) => {
    const metas = (Array.isArray(paths) ? paths : []).map(safeStat).filter(Boolean);
    if (metas.length && chatWindowAlive()) chatWin.webContents.send('chat:attachments-added', metas);
  });

  ipcMain.handle('chat:open-external', (e, url) => {
    const value = String(url || '').trim();
    if (/^https?:\/\//i.test(value) || /^mailto:/i.test(value)) {
      shell.openExternal(value).catch(() => {});
      return { ok: true };
    }
    if (/^file:\/\//i.test(value)) {
      try {
        const filePath = decodeURIComponent(new URL(value).pathname.replace(/^\//, ''));
        return openPathChecked(filePath.replace(/\//g, path.sep));
      } catch {
        return { ok: false, error: '无法解析文件链接' };
      }
    }
    return { ok: false, error: '不支持该链接类型' };
  });

  ipcMain.handle('chat:open-path', (e, p) => openPathChecked(p));

  ipcMain.handle('chat:reveal-path', (e, p) => {
    const target = String(p || '');
    if (!target || !fs.existsSync(target)) return { ok: false, error: '文件不存在' };
    shell.showItemInFolder(target);
    return { ok: true };
  });

  ipcMain.handle('chat:copy', (e, text) => {
    clipboard.writeText(String(text || ''));
    return { ok: true };
  });

  ipcMain.handle('chat:get-memory', () => {
    const mem = store.getMemory();
    return {
      profile: mem.profile,
      episodes: mem.episodes.slice(-40).reverse(),
      episodeCount: mem.episodes.length,
      updatedAt: mem.updatedAt
    };
  });

  ipcMain.handle('chat:summarize-now', async (e, sessionId) => {
    const id = sessionId || store.getLatestSession()?.id;
    if (!id) return { ok: false, error: '没有可整理的对话' };
    return maybeSummarize(id);
  });

  // ---- settings ----
  ipcMain.handle('settings:get', () => ({
    config: store.getPublicConfig(),
    personas: store.getPersonas(),
    activePersonaId: store.getConfig().activePersonaId,
    memory: {
      profile: store.getMemory().profile,
      episodes: store.getMemory().episodes.slice(-40).reverse(),
      episodeCount: store.getMemory().episodes.length,
      updatedAt: store.getMemory().updatedAt
    },
    providers: defaults.PROVIDER_PRESETS,
    version: app.getVersion(),
    isPackaged: app.isPackaged
  }));

  ipcMain.handle('settings:save', (e, payload) => {
    const patch = {};
    if (payload?.api) {
      patch.api = { ...payload.api };
      delete patch.api.apiKey;
      delete patch.api.clearKey;
    }
    if (payload?.pet) patch.pet = { ...payload.pet };
    if (payload?.ui) {
      const theme = payload.ui.theme;
      if (['system', 'light', 'dark'].includes(theme)) patch.ui = { theme };
    }
    if (payload?.memory) patch.memory = { ...payload.memory };

    store.updateConfig(patch);
    applyTheme();

    if (payload?.api?.clearKey) store.clearApiKey();
    else if (typeof payload?.api?.apiKey === 'string' && payload.api.apiKey.trim()) {
      store.setApiKey(payload.api.apiKey.trim());
    }

    const cfg = store.getConfig();
    applyLoginItem(!!cfg.pet.launchAtLogin);
    if (petWin && !petWin.isDestroyed()) {
      petWin.setAlwaysOnTop(!!cfg.pet.alwaysOnTop, cfg.pet.alwaysOnTop ? 'screen-saver' : 'normal', 1);
    }
    scheduleBubble();
    applyPetScale();
    syncPetConfig();
    broadcast('chat:refresh', {});
    return { ok: true, config: store.getPublicConfig() };
  });

  ipcMain.handle('settings:test-api', async (e, payload) => {
    try {
      const base = { ...store.getEffectiveApiConfig() };
      if (payload?.baseURL) base.baseURL = payload.baseURL;
      if (payload?.model) base.model = payload.model;
      if (payload?.apiKey) base.apiKey = payload.apiKey;
      if (typeof payload?.temperature === 'number') base.temperature = payload.temperature;
      const result = await llm.testConnection({ config: base });
      return { ok: true, ...result };
    } catch (err) {
      return { ok: false, error: llm.friendlyError(err) };
    }
  });

  ipcMain.handle('settings:save-persona', (e, persona) => {
    try {
      const saved = store.savePersona(persona);
      syncPetConfig();
      broadcast('chat:persona-changed', { persona: saved });
      return { ok: true, persona: saved, personas: store.getPersonas(), activePersonaId: store.getConfig().activePersonaId };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('settings:delete-persona', (e, id) => {
    try {
      store.deletePersona(id);
      syncPetConfig();
      broadcast('chat:persona-changed', { persona: store.getActivePersona() });
      return { ok: true, personas: store.getPersonas(), activePersonaId: store.getConfig().activePersonaId };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('settings:set-active-persona', (e, id) => {
    try {
      const persona = store.setActivePersona(id);
      syncPetConfig();
      broadcast('chat:persona-changed', { persona });
      return { ok: true, persona, personas: store.getPersonas() };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('settings:save-profile', (e, text) => {
    store.setMemoryProfile(text);
    return { ok: true };
  });

  ipcMain.handle('settings:clear-memory', () => {
    store.clearMemory();
    return { ok: true };
  });

  ipcMain.handle('settings:summarize-now', async () => {
    const latest = store.getLatestSession();
    if (!latest) return { ok: false, error: '还没有对话' };
    return maybeSummarize(latest.id);
  });

  ipcMain.on('settings:show-pet', () => togglePet(true));
  ipcMain.on('app:open-settings', () => showSettings());
  ipcMain.on('app:open-chat', () => showChat());
  ipcMain.handle('app:quit', () => {
    isQuitting = true;
    app.quit();
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function startFakeApi() {
  const content = [
    '收到啦，这是一条冒烟测试回复。',
    '',
    '链接：https://example.com/docs',
    '',
    '文件：C:\\Windows\\win.ini',
    '',
    '```js',
    'console.log("hi");',
    '```',
    '',
    '- 第一点',
    '- 第二点'
  ].join('\n');

  const summary = JSON.stringify({
    profile: '用户正在测试桌宠，喜欢简短、有陪伴感的回复。',
    episode: '用户向桌宠打了招呼，桌宠回应了链接、文件和代码示例。',
    tags: ['测试', '打招呼'],
    mood: '轻松'
  });

  const server = http.createServer((req, res) => {
    server.requestCount = (server.requestCount || 0) + 1;
    if (req.method !== 'POST' || !req.url.includes('/chat/completions')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end('{"error":"not found"}');
      return;
    }
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      let parsed = {};
      try {
        parsed = JSON.parse(body || '{}');
      } catch {
        /* ignore */
      }
      const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
      const systemText = messages.map((m) => String(m.content || '')).join('\n');
      const lastUser = [...messages].reverse().find((m) => m.role === 'user');
      const isContinuation = !!lastUser && String(lastUser.content || '').includes('请严格从中断的字符处往下写');
      const isSummary = systemText.includes('长期记忆整理器');

      let reply = content;
      let finish = 'stop';
      if (server.mode === 'truncate' && !isSummary) {
        if (isContinuation) {
          reply = '  <b>续写完成</b>\n</div>\n```\n\n到这里就完整啦。';
        } else {
          reply = '好的，代码在下面：\n\n```html\n<div class="pelican">\n  <span>半截';
          finish = 'length';
        }
      }

      server.lastRequest = {
        stream: !!parsed.stream,
        summary: isSummary,
        continuation: isContinuation,
        attachment: systemText.includes('【附件'),
        secret: systemText.includes('hello-attachment-42')
      };
      if (process.env.DSKPET_DEBUG) console.log('[smoke-api] request stream=', !!parsed.stream, 'summary=', isSummary);

      if (isSummary) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ choices: [{ message: { content: summary } }], usage: {} }));
        return;
      }

      if (parsed.stream) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive'
        });
        if (process.env.DSKPET_DEBUG) console.log('[smoke-api] headers sent');
        res.flushHeaders();
        const pieces = reply.match(/[\s\S]{1,18}/g) || [reply];
        let i = 0;
        const timer = setInterval(() => {
          if (res.writableEnded) {
            clearInterval(timer);
            return;
          }
          if (i < pieces.length) {
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: pieces[i] } }] })}\n\n`);
            if (process.env.DSKPET_DEBUG) console.log('[smoke-api] chunk', i);
            i += 1;
          } else {
            clearInterval(timer);
            res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }] })}\n\n`);
            res.write('data: [DONE]\n\n');
            res.end();
            if (process.env.DSKPET_DEBUG) console.log('[smoke-api] done');
          }
        }, 35);
        res.on('close', () => clearInterval(timer));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: reply }, finish_reason: finish }], usage: {} }));
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}
async function runSmoke() {
  console.log('[smoke] pet window created');
  let fake;
  try {
    fake = await startFakeApi();
    const port = fake.address().port;
    store.updateConfig({
      api: {
        baseURL: `http://127.0.0.1:${port}/v1`,
        model: 'smoke-model',
        temperature: 0.7,
        maxTokens: 300,
        vision: false
      },
      pet: { smartBubble: false }
    });
    store.setApiKey('smoke-key');

    await sleep(700);
    showChat();
    await sleep(1400);
    showSettings();
    await sleep(1200);

    const outDir = path.join(__dirname, '.smoke');
    fs.mkdirSync(outDir, { recursive: true });

    const targets = [
      ['pet', petWin],
      ['chat-empty', chatWin],
      ['settings', settingsWin]
    ];
    for (const [name, win] of targets) {
      if (!win || win.isDestroyed()) {
        console.log(`[smoke] ${name}: window missing`);
        continue;
      }
      if (name === 'settings') {
        win.show();
        win.focus();
        await sleep(600);
      }
      let image = await win.webContents.capturePage();
      if (image.isEmpty()) {
        console.log(`[smoke] ${name}: empty capture, retrying`);
        await sleep(800);
        win.show();
        image = await win.webContents.capturePage();
      }
      fs.writeFileSync(path.join(outDir, `${name}.png`), image.toPNG());
      console.log(
        `[smoke] ${name}: visible=${win.isVisible()} empty=${image.isEmpty()} pngBytes=${image.toPNG().length}`
      );
      const shellInfo = await win.webContents.executeJavaScript(
        `(() => {
          const shell = document.querySelector('.window-shell');
          if (!shell) return { shell: false };
          const cs = getComputedStyle(shell);
          return {
            shell: true,
            radius: cs.borderRadius,
            cornerShape: cs.getPropertyValue('corner-shape'),
            background: cs.backgroundColor
          };
        })()`
      );
      console.log(`[smoke] ${name} shell:`, JSON.stringify(shellInfo));
    }

    // 主题：设置页切 深色 / 浅色 / 跟随系统，检查 CSS 变量与系统偏好
    const themeSelect = await settingsWin.webContents.executeJavaScript(
      `(() => { const sel = document.querySelector('#set-theme'); return sel ? { value: sel.value } : null; })()`
    );
    const probeTheme = (win) =>
      win.webContents.executeJavaScript(
        `(() => ({
          dark: matchMedia('(prefers-color-scheme: dark)').matches,
          bg: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
        }))()`
      );
    const applyThemeViaUI = async (theme) => {
      await settingsWin.webContents.executeJavaScript(
        `(() => {
          const sel = document.querySelector('#set-theme');
          sel.value = ${JSON.stringify(theme)};
          document.querySelector('#btn-save').click();
          return sel.value;
        })()`
      );
      await sleep(700);
    };

    await applyThemeViaUI('dark');
    const darkChat = await probeTheme(chatWin);
    const darkSettings = await probeTheme(settingsWin);
    fs.writeFileSync(path.join(outDir, 'chat-dark.png'), (await chatWin.webContents.capturePage()).toPNG());
    fs.writeFileSync(path.join(outDir, 'settings-dark.png'), (await settingsWin.webContents.capturePage()).toPNG());

    await applyThemeViaUI('light');
    const lightChat = await probeTheme(chatWin);

    await applyThemeViaUI('system');
    const systemChat = await probeTheme(chatWin);
    const finalTheme = store.getConfig().ui.theme;
    console.log(
      '[smoke] theme:',
      JSON.stringify({ themeSelect, darkChat, darkSettings, lightChat, systemChat, finalTheme })
    );

    const petInfo = await petWin.webContents.executeJavaScript(
      `(() => {
        const svg = document.querySelector('#pet');
        const box = svg.getBBox();
        return {
          preload: !!window.dsk,
          mood: svg.getAttribute('class'),
          eyes: [...document.querySelectorAll('.eyes')].filter((e) => getComputedStyle(e).display !== 'none').length,
          mouths: [...document.querySelectorAll('.mouth')].filter((e) => getComputedStyle(e).display !== 'none').length,
          paths: svg.querySelectorAll('path').length,
          bbox: { w: Math.round(box.width), h: Math.round(box.height) },
          bubbleHidden: document.querySelector('#bubble').hidden
        };
      })()`
    );
    console.log('[smoke] pet:', JSON.stringify(petInfo));

    const moodMatrix = await petWin.webContents.executeJavaScript(
      `(() => {
        const pet = document.querySelector('#pet');
        const original = pet.getAttribute('class');
        const moods = ['idle', 'happy', 'curious', 'sleepy', 'love', 'think', 'talk', 'wink', 'excited', 'shy', 'yawn', 'dance'];
        const out = {};
        for (const mood of moods) {
          pet.setAttribute('class', 'mood-' + mood);
          const visible = [...document.querySelectorAll('.eyes, .mouth')]
            .filter((el) => getComputedStyle(el).display !== 'none')
            .map((el) => el.getAttribute('class'));
          out[mood] = visible;
        }
        pet.setAttribute('class', original);
        return out;
      })()`
    );
    console.log('[smoke] moods:', JSON.stringify(moodMatrix));

    // 气泡显示
    petWin.webContents.send('pet:bubble', { text: '现在 14:32 啦，记得眨眨眼呀。', ts: Date.now() });
    await sleep(1300);
    const bubbleInfo = await petWin.webContents.executeJavaScript(
      `(() => {
        const b = document.querySelector('#bubble');
        const r = b.getBoundingClientRect();
        return { show: b.classList.contains('show'), text: document.querySelector('#bubble-text').textContent, w: Math.round(r.width), h: Math.round(r.height) };
      })()`
    );
    console.log('[smoke] bubble:', JSON.stringify(bubbleInfo));
    const bubbleImage = await petWin.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, 'pet-bubble.png'), bubbleImage.toPNG());

    // 通过界面发送两轮对话，验证流式、Markdown、链接、文件路径、代码块
    const sendViaUi = async (text) => {
      await chatWin.webContents.executeJavaScript(
        `(() => {
          const input = document.querySelector('#input');
          input.value = ${JSON.stringify(text)};
          input.dispatchEvent(new Event('input', { bubbles: true }));
          document.querySelector('#btn-send').click();
          return true;
        })()`
      );
    };

    const readChat = () =>
      chatWin.webContents.executeJavaScript(
        `(() => ({
          assistant: document.querySelectorAll('.msg.assistant:not(.streaming)').length,
          streaming: !!document.querySelector('#stream-msg'),
          busy: !document.querySelector('#btn-stop').hidden,
          errors: document.querySelectorAll('.msg.error').length,
          links: document.querySelectorAll('.md-link').length,
          files: document.querySelectorAll('.file-link').length,
          codes: document.querySelectorAll('.code-block').length,
          lists: document.querySelectorAll('.bubble ul').length,
          bubbles: document.querySelectorAll('.bubble').length
        }))()`
      );

    const waitAssistant = async (expected, timeout = 15000) => {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const info = await readChat();
        if (info.assistant >= expected && !info.streaming) return info;
        await sleep(300);
      }
      return await readChat();
    };

    await sendViaUi('你好呀，第一次见面');
    const first = await waitAssistant(1);
    console.log('[smoke] chat after #1:', JSON.stringify(first));

    await sendViaUi('再说一句，顺便给我一个文件路径');
    const second = await waitAssistant(2);
    console.log('[smoke] chat after #2:', JSON.stringify(second));

    await sleep(2600);
    const memory = store.getMemory();
    console.log(
      '[smoke] memory:',
      JSON.stringify({ episodes: memory.episodes.length, profile: (memory.profile || '').slice(0, 24) })
    );

    // 附件内联：直接走 IPC，验证文本文件内容进入模型请求
    const notePath = path.join(outDir, '附件-测试.txt');
    fs.writeFileSync(notePath, '这是附件里的秘密内容：hello-attachment-42', 'utf8');
    const beforeAttach = (await readChat()).assistant;
    const currentSessionId = await chatWin.webContents.executeJavaScript('document.body.dataset.sessionId');
    const attachSend = await chatWin.webContents.executeJavaScript(
      `window.dsk.send({
        sessionId: ${JSON.stringify(currentSessionId)},
        text: '看一下这个附件',
        attachments: [${JSON.stringify(notePath)}]
      })`
    );
    const attachInfo = await waitAssistant(beforeAttach + 1);
    console.log('[smoke] attachment send:', JSON.stringify({ result: attachSend, assistant: attachInfo.assistant }));
    console.log('[smoke] attachment request:', JSON.stringify(fake.lastRequest));

    // 安全边界：不存在的文件、非 http 链接
    const badPath = await chatWin.webContents.executeJavaScript(
      `window.dsk.openPath('C:\\\\__definitely_missing__\\\\nope.txt')`
    );
    const badUrl = await chatWin.webContents.executeJavaScript(
      `window.dsk.openExternal('javascript:alert(1)')`
    );
    console.log('[smoke] guards:', JSON.stringify({ badPath, badUrl }));

    const markdownCheck = await chatWin.webContents.executeJavaScript(
      `(() => {
        const d = document.createElement('div');
        d.innerHTML = window.renderMarkdown('**粗体** https://a.com/x C:\\\\Windows\\\\win.ini \\n\\n\`\`\`js\\nvar a = 1;\\n\`\`\`');
        return { strong: !!d.querySelector('strong'), links: d.querySelectorAll('a.md-link').length, files: d.querySelectorAll('.file-link').length, code: d.querySelectorAll('.code-block').length };
      })()`
    );
    console.log('[smoke] markdown:', JSON.stringify(markdownCheck));

    // 代码块收起/展开
    const codeCollapse = await chatWin.webContents.executeJavaScript(
      `(() => {
        const lines = Array.from({ length: 20 }, (_, i) => 'const v' + i + ' = ' + i + ';').join('\\n');
        const d = document.createElement('div');
        d.innerHTML = window.renderMarkdown('\\u0060\\u0060\\u0060js\\n' + lines + '\\n\\u0060\\u0060\\u0060');
        const block = d.querySelector('.code-block');
        const toggle = block.querySelector('.code-toggle');
        const messages = document.querySelector('#messages');
        messages.appendChild(d);
        const before = {
          collapsed: block.classList.contains('collapsed'),
          toggle: toggle ? toggle.textContent : '',
          pre: getComputedStyle(block.querySelector('pre')).display,
          preview: !!block.querySelector('.code-preview')
        };
        toggle.click();
        const after = {
          collapsed: block.classList.contains('collapsed'),
          toggle: toggle.textContent,
          pre: getComputedStyle(block.querySelector('pre')).display
        };
        d.remove();
        return { before, after };
      })()`
    );
    console.log('[smoke] code collapse:', JSON.stringify(codeCollapse));

    const filledImage = await chatWin.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, 'chat-filled.png'), filledImage.toPNG());

    // 关掉再打开：应是一段全新的空草稿，旧会话仍在侧栏，且磁盘上没有空会话
    const persistedBefore = store._persistedSessions().length;
    chatWin.hide();
    await sleep(300);
    showChat();
    await sleep(600);
    const draftInfo = await chatWin.webContents.executeJavaScript(
      `(() => ({
        welcome: !!document.querySelector('.welcome'),
        messages: document.querySelectorAll('.msg').length,
        sessionItems: document.querySelectorAll('.session-item').length,
        draftId: document.body.dataset.sessionId || ''
      }))()`
    );
    console.log(
      '[smoke] reopen draft:',
      JSON.stringify({
        draftInfo,
        persistedBefore,
        persistedAfter: store._persistedSessions().length,
        emptyDraftsInMemory: store.getSessions().filter((s) => s.messages.length === 0).length
      })
    );

    // 删除会话：自定义主题弹窗，取消不应删除，确认才删除
    await chatWin.webContents.executeJavaScript(`document.querySelector('.session-item .s-del').click()`);
    await sleep(450);
    const dialogInfo = await chatWin.webContents.executeJavaScript(
      `(() => {
        const card = document.querySelector('.app-dialog-overlay.show .app-dialog-card');
        return {
          visible: !!card,
          title: card ? card.querySelector('.app-dialog-title').textContent : '',
          message: card ? card.querySelector('.app-dialog-message').textContent : '',
          buttons: card ? [...card.querySelectorAll('.app-dialog-btn')].map((b) => b.textContent) : []
        };
      })()`
    );
    const dialogImage = await chatWin.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, 'chat-dialog.png'), dialogImage.toPNG());

    await chatWin.webContents.executeJavaScript(`document.querySelector('.app-dialog-btn.ghost').click()`);
    await sleep(350);
    const afterCancel = await chatWin.webContents.executeJavaScript(
      `(() => ({
        overlay: !!document.querySelector('.app-dialog-overlay'),
        sessionItems: document.querySelectorAll('.session-item').length,
        persisted: ${store._persistedSessions().length}
      }))()`
    );

    await chatWin.webContents.executeJavaScript(`document.querySelector('.session-item .s-del').click()`);
    await sleep(350);
    await chatWin.webContents.executeJavaScript(`document.querySelector('.app-dialog-btn.danger').click()`);
    await sleep(700);
    const afterDelete = await chatWin.webContents.executeJavaScript(
      `(() => ({
        overlay: !!document.querySelector('.app-dialog-overlay'),
        emptyText: document.querySelector('.session-item .s-title')?.textContent || ''
      }))()`
    );
    console.log(
      '[smoke] delete dialog:',
      JSON.stringify({ dialogInfo, afterCancel, afterDelete, persistedFinal: store._persistedSessions().length })
    );

    // 长度截断 → 自动续写：第一次返回 finish_reason=length，第二次接着写完
    fake.mode = 'truncate';
    const requestsBefore = fake.requestCount;
    await sendViaUi('写一个很长的 HTML 页面');
    const truncated = await waitAssistant(1, 20000);
    const latest = store
      ._persistedSessions()
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    const lastMsg = latest ? latest.messages[latest.messages.length - 1] : null;
    console.log(
      '[smoke] continuation:',
      JSON.stringify({
        requests: fake.requestCount - requestsBefore,
        assistant: truncated.assistant,
        finishReason: lastMsg ? lastMsg.finishReason : null,
        hasPart2: !!(lastMsg && String(lastMsg.content).includes('续写完成')),
        fences: lastMsg ? (String(lastMsg.content).match(/```/g) || []).length : 0,
        length: lastMsg ? String(lastMsg.content).length : 0
      })
    );
    fake.mode = 'normal';

    console.log('[smoke] window state:', JSON.stringify({ petOnTop: petWin.isAlwaysOnTop(), chatVisible: chatWin.isVisible() }));
    console.log('[smoke] startup ok');
  } catch (err) {
    console.error('[smoke] failed:', err);
  } finally {
    if (fake) {
      try {
        fake.close();
      } catch {
        /* ignore */
      }
    }
  }
  isQuitting = true;
  app.quit();
}

function openPathChecked(p) {
  const target = String(p || '').trim();
  if (!target) return Promise.resolve({ ok: false, error: '路径为空' });
  if (!fs.existsSync(target)) return Promise.resolve({ ok: false, error: '文件不存在或已被移动' });
  return shell.openPath(target).then((errMsg) => {
    if (errMsg) {
      console.error('[openPath]', errMsg);
      return { ok: false, error: errMsg };
    }
    return { ok: true };
  });
}

/* ------------------------------------------------------------------ */
/* app lifecycle                                                       */
/* ------------------------------------------------------------------ */

app.whenReady().then(async () => {
  if (!gotLock) {
    // 没能拿到单实例锁：交给已有实例处理，本进程直接退出，避免闪出第二个宠物
    isQuitting = true;
    app.quit();
    return;
  }
  logLine('app ready, starting');
  store = new Store(app.getPath('userData')).init();
  applyTheme();

  Menu.setApplicationMenu(null);
  registerIpc();
  createPetWindow();
  createTray();
  scheduleBubble(35000);
  logLine('pet window + tray created');

  if (pendingShow) {
    pendingShow = false;
    revealApp();
  }

  if (isSmoke) {
    setTimeout(() => runSmoke(), 1500);
  }

  applyLoginItem(!!store.getConfig().pet.launchAtLogin);

  screen.on('display-metrics-changed', () => {
    if (!petWin || petWin.isDestroyed()) return;
    const [w, h] = petWin.getSize();
    const [x, y] = petWin.getPosition();
    const [cx, cy] = clampPosition(x, y, w, h);
    if (cx !== x || cy !== y) petWin.setPosition(cx, cy);
  });
  screen.on('display-removed', () => {
    if (!petWin || petWin.isDestroyed()) return;
    const [w, h] = petWin.getSize();
    const [x, y] = petWin.getPosition();
    const [cx, cy] = clampPosition(x, y, w, h);
    petWin.setPosition(cx, cy);
  });

  // 启动后主动冒个泡，既可爱也方便确认宠物在哪
  setTimeout(() => {
    if (!petWin || petWin.isDestroyed()) return;
    const persona = store.getActivePersona();
    const text = store.getSessions().length ? '我回来啦。' : persona.greeting || '我回来啦。';
    petWin.webContents.send('pet:bubble', { text, ts: Date.now() });
  }, 2600);

  app.on('activate', () => {
    if (!petWin) createPetWindow();
  });
}).catch((err) => {
  logLine(`startup failed: ${err && (err.stack || err.message || err)}`);
  console.error(err);
  try {
    dialog.showErrorBox('绒绒桌宠启动失败', `${err && (err.message || err)}\n\n日志：${path.join(app.getPath('userData'), 'logs', 'app.log')}`);
  } catch {
    /* ignore */
  }
  isQuitting = true;
  app.quit();
});

app.on('before-quit', () => {
  isQuitting = true;
  try {
    store?.flushSync();
  } catch {
    /* ignore */
  }
});

app.on('will-quit', () => {
  if (bubbleTimer) clearTimeout(bubbleTimer);
  if (topTimer) clearInterval(topTimer);
});

app.on('window-all-closed', () => {
  // 桌宠应用常驻，不随窗口关闭退出
});
