'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

function subscribe(channel, cb) {
  const handler = (_event, payload) => {
    try {
      cb(payload);
    } catch (err) {
      console.error(`[preload] listener error on ${channel}`, err);
    }
  };
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

const api = {
  platform: process.platform,

  // ---------- pet ----------
  petBootstrap: () => ipcRenderer.invoke('pet:bootstrap'),
  petSetIgnore: (ignore) => ipcRenderer.send('pet:set-ignore', !!ignore),
  petDrag: (phase, screenX, screenY) => ipcRenderer.send('pet:drag', { phase, screenX, screenY }),
  petOpenChat: () => ipcRenderer.send('pet:open-chat'),
  petContextMenu: () => ipcRenderer.invoke('pet:context-menu'),
  petRequestBubble: () => ipcRenderer.invoke('pet:request-bubble'),
  onBubble: (cb) => subscribe('pet:bubble', cb),
  onMood: (cb) => subscribe('pet:mood', cb),
  onPetConfig: (cb) => subscribe('pet:config', cb),

  // ---------- chat ----------
  chatBootstrap: (opts) => ipcRenderer.invoke('chat:bootstrap', opts),
  newSession: () => ipcRenderer.invoke('chat:new-session'),
  loadSession: (id) => ipcRenderer.invoke('chat:load-session', id),
  deleteSession: (id) => ipcRenderer.invoke('chat:delete-session', id),
  listSessions: () => ipcRenderer.invoke('chat:list-sessions'),
  send: (payload) => ipcRenderer.invoke('chat:send', payload),
  abort: (sessionId) => ipcRenderer.send('chat:abort', sessionId),
  pickFiles: () => ipcRenderer.invoke('chat:pick-files'),
  getMemory: () => ipcRenderer.invoke('chat:get-memory'),
  summarizeNow: (sessionId) => ipcRenderer.invoke('chat:summarize-now', sessionId),
  onChatStart: (cb) => subscribe('chat:start', cb),
  onChatDelta: (cb) => subscribe('chat:delta', cb),
  onChatContinuing: (cb) => subscribe('chat:continuing', cb),
  onChatDone: (cb) => subscribe('chat:done', cb),
  onChatMemory: (cb) => subscribe('chat:memory', cb),
  onNewDraft: (cb) => subscribe('chat:new-draft', cb),
  onSessionsUpdated: (cb) => subscribe('chat:sessions-updated', cb),
  onAttachmentsAdded: (cb) => subscribe('chat:attachments-added', cb),
  onRefresh: (cb) => subscribe('chat:refresh', cb),
  onPersonaChanged: (cb) => subscribe('chat:persona-changed', cb),

  // ---------- settings ----------
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (payload) => ipcRenderer.invoke('settings:save', payload),
  testApi: (payload) => ipcRenderer.invoke('settings:test-api', payload),
  savePersona: (persona) => ipcRenderer.invoke('settings:save-persona', persona),
  deletePersona: (id) => ipcRenderer.invoke('settings:delete-persona', id),
  setActivePersona: (id) => ipcRenderer.invoke('settings:set-active-persona', id),
  saveProfile: (text) => ipcRenderer.invoke('settings:save-profile', text),
  clearMemory: () => ipcRenderer.invoke('settings:clear-memory'),
  summarizeSettingsNow: () => ipcRenderer.invoke('settings:summarize-now'),
  showPet: () => ipcRenderer.send('settings:show-pet'),
  openSettings: () => ipcRenderer.send('app:open-settings'),
  openChat: () => ipcRenderer.send('app:open-chat'),
  quit: () => ipcRenderer.invoke('app:quit'),

  // ---------- window ----------
  minimize: () => ipcRenderer.send('win:minimize'),
  closeWindow: () => ipcRenderer.send('win:close'),
  toggleMaximize: () => ipcRenderer.invoke('win:toggle-maximize'),

  // ---------- shell / utils ----------
  openExternal: (url) => ipcRenderer.invoke('chat:open-external', url),
  openPath: (p) => ipcRenderer.invoke('chat:open-path', p),
  revealPath: (p) => ipcRenderer.invoke('chat:reveal-path', p),
  copyText: (text) => ipcRenderer.invoke('chat:copy', text),
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return '';
    }
  }
};

contextBridge.exposeInMainWorld('dsk', api);

/* 拖拽文件：在 preload 里取真实路径，再交给主进程转给对话窗口 */
if (location.pathname.replace(/\\/g, '/').endsWith('/chat.html')) {
  window.addEventListener(
    'dragover',
    (e) => {
      e.preventDefault();
      e.stopPropagation();
    },
    true
  );
  window.addEventListener(
    'drop',
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      const files = Array.from(e.dataTransfer?.files || []);
      const paths = [];
      for (const file of files) {
        const p = api.getPathForFile(file);
        if (p) paths.push(p);
      }
      if (paths.length) ipcRenderer.send('chat:files-dropped', paths);
    },
    true
  );
}
