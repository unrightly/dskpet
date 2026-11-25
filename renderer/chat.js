'use strict';

(() => {
  const $ = (sel) => document.querySelector(sel);
  const els = {
    messages: $('#messages'),
    input: $('#input'),
    send: $('#btn-send'),
    stop: $('#btn-stop'),
    attach: $('#btn-attach'),
    attachBar: $('#attachment-bar'),
    sessionList: $('#session-list'),
    newChat: $('#new-chat'),
    chatTitle: $('#chat-title'),
    chatSub: $('#chat-sub'),
    brandName: $('#brand-name'),
    brandSub: $('#brand-sub'),
    brandFace: $('#brand-face'),
    titleFace: $('#title-face'),
    dropOverlay: $('#drop-overlay'),
    toast: $('#toast'),
    drawer: $('#memory-drawer'),
    drawerBody: $('#drawer-body')
  };

  const state = {
    session: null,
    sessions: [],
    persona: null,
    personas: [],
    memory: { profile: '', episodeCount: 0, recent: [] },
    config: { vision: false },
    attachments: [],
    busy: false,
    streaming: null
  };

  /* ---------------- utils ---------------- */

  let toastTimer = null;
  function toast(text) {
    if (!els.toast) return;
    els.toast.textContent = text;
    els.toast.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('show'), 2600);
  }

  function timeLabel(ts) {
    const d = new Date(ts);
    const now = new Date();
    const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return hm;
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return `昨天 ${hm}`;
    return `${d.getMonth() + 1}-${d.getDate()}`;
  }

  function initials(name) {
    return String(name || '绒').trim().slice(0, 1) || '绒';
  }

  function extIcon(ext) {
    if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes(ext)) return '🖼';
    if (ext === '.pdf') return '📄';
    if (['.zip', '.rar', '.7z', '.tar', '.gz'].includes(ext)) return '🗜';
    if (['.js', '.ts', '.py', '.java', '.c', '.cpp', '.cs', '.go', '.rs', '.json', '.html', '.css', '.sh', '.ps1'].includes(ext))
      return '⌨';
    if (['.md', '.txt', '.log', '.csv'].includes(ext)) return '📝';
    return '📎';
  }

  function isNearBottom() {
    const el = els.messages;
    return el.scrollHeight - el.scrollTop - el.clientHeight < 150;
  }

  function scrollToBottom(force = false) {
    if (!force && !isNearBottom()) return;
    requestAnimationFrame(() => {
      els.messages.scrollTop = els.messages.scrollHeight;
    });
  }

  function autosize() {
    const el = els.input;
    el.style.height = 'auto';
    el.style.height = `${Math.min(150, el.scrollHeight)}px`;
  }

  /* ---------------- persona / header ---------------- */

  function applyPersona(persona) {
    if (!persona) return;
    state.persona = persona;
    const root = document.documentElement;
    root.style.setProperty('--accent', persona.color || '#F2A65A');
    root.style.setProperty('--accent-soft', (persona.color || '#F2A65A') + '33');
    els.brandName.textContent = persona.name;
    els.brandSub.textContent = persona.tagline || '桌面小伙伴';
    els.brandFace.textContent = initials(persona.name);
    els.titleFace.textContent = initials(persona.name);
    document.title = persona.name;
    els.input.placeholder = `和${persona.name}说点什么…（Enter 发送，Shift+Enter 换行）`;
    document.querySelectorAll('[data-avatar]').forEach((el) => {
      el.textContent = initials(persona.name);
    });
    updateHeader();
  }

  function updateHeader() {
    const name = state.persona?.name || '桌宠';
    const count = state.memory?.episodeCount || 0;
    const model = state.config?.model ? String(state.config.model).slice(0, 26) : '未配置模型';
    els.chatSub.textContent = `${name} · 记忆 ${count} 段 · ${model}`;
    if (state.session) {
      els.chatTitle.textContent = state.session.title || '新的对话';
    }
    document.body.dataset.sessionId = state.session ? state.session.id : '';
  }

  /* ---------------- sessions ---------------- */

  function renderSessions() {
    els.sessionList.innerHTML = '';
    if (!state.sessions.length) {
      const empty = document.createElement('div');
      empty.className = 'session-item';
      empty.style.cursor = 'default';
      empty.innerHTML = '<div class="s-title" style="color:#B4A28E">还没有对话</div>';
      els.sessionList.appendChild(empty);
      return;
    }
    for (const s of state.sessions) {
      const item = document.createElement('div');
      item.className = 'session-item' + (state.session && s.id === state.session.id ? ' active' : '');
      item.dataset.id = s.id;

      const title = document.createElement('div');
      title.className = 's-title';
      title.textContent = s.title || '新的对话';
      const time = document.createElement('div');
      time.className = 's-time';
      time.textContent = `${timeLabel(s.updatedAt)} · ${s.messageCount} 条`;
      const del = document.createElement('button');
      del.className = 's-del';
      del.textContent = '✕';
      del.title = '删除会话';

      item.appendChild(title);
      item.appendChild(time);
      item.appendChild(del);
      els.sessionList.appendChild(item);
    }
  }

  async function refreshSessions() {
    try {
      const res = await window.dsk.listSessions();
      state.sessions = res.sessions || [];
      const current = state.sessions.find((s) => s.id === state.session?.id);
      if (current && state.session) state.session.title = current.title;
      renderSessions();
      updateHeader();
    } catch (err) {
      console.error(err);
    }
  }

  function renderMessages() {
    els.messages.innerHTML = '';
    if (!state.session) return;
    if (!state.session.messages.length) {
      renderWelcome();
      return;
    }
    for (const msg of state.session.messages) {
      els.messages.appendChild(buildMessage(msg));
    }
    scrollToBottom(true);
  }

  function renderWelcome() {
    const persona = state.persona || { name: '绒绒', greeting: '我在呢。' };
    const wrap = document.createElement('div');
    wrap.className = 'welcome';

    const face = document.createElement('div');
    face.className = 'welcome-face';
    face.textContent = initials(persona.name);

    const title = document.createElement('h2');
    title.textContent = `我是${persona.name}`;

    const greet = document.createElement('p');
    greet.textContent = persona.greeting || '我在呢。';

    const suggestions = document.createElement('div');
    suggestions.className = 'suggestions';
    const chips = ['今天有点累', '陪我聊两句', '帮我理一下今天的待办', '给我讲个冷笑话'];
    for (const text of chips) {
      const btn = document.createElement('button');
      btn.className = 'suggestion';
      btn.textContent = text;
      btn.addEventListener('click', () => {
        els.input.value = text;
        autosize();
        sendMessage();
      });
      suggestions.appendChild(btn);
    }

    wrap.appendChild(face);
    wrap.appendChild(title);
    wrap.appendChild(greet);
    wrap.appendChild(suggestions);
    els.messages.appendChild(wrap);
  }

  /* ---------------- message rendering ---------------- */

  function attachmentChip(meta, removable) {
    const chip = document.createElement('span');
    chip.className = 'attach-chip';
    chip.dataset.path = meta.path;
    chip.title = `${meta.path}\n点击打开（Alt+点击定位文件）`;

    const icon = document.createElement('span');
    icon.className = 'chip-icon';
    icon.textContent = extIcon(meta.ext || '');

    const name = document.createElement('span');
    name.className = 'chip-name';
    name.textContent = meta.name || meta.path;

    const size = document.createElement('span');
    size.className = 'chip-size';
    size.textContent = meta.sizeLabel || '';

    chip.appendChild(icon);
    chip.appendChild(name);
    chip.appendChild(size);

    if (removable) {
      const del = document.createElement('button');
      del.className = 'chip-del';
      del.textContent = '✕';
      del.title = '移除';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        state.attachments = state.attachments.filter((a) => a.path !== meta.path);
        renderAttachments();
      });
      chip.appendChild(del);
    }
    return chip;
  }

  function buildMessage(msg) {
    const isUser = msg.role === 'user';
    const row = document.createElement('div');
    row.className =
      'msg ' + (isUser ? 'user' : 'assistant') + (msg.error ? ' error' : '') + (msg.stopped ? ' stopped' : '');
    row.dataset.msgId = msg.id || '';

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    if (isUser) {
      avatar.textContent = '我';
    } else {
      avatar.dataset.avatar = '1';
      avatar.textContent = initials(state.persona?.name);
    }

    const bubbleWrap = document.createElement('div');
    bubbleWrap.className = 'bubble-wrap';

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    if (msg.content) {
      bubble.innerHTML = window.renderMarkdown(msg.content);
    }

    if (Array.isArray(msg.attachments) && msg.attachments.length) {
      const atts = document.createElement('div');
      atts.className = 'msg-attachments';
      for (const meta of msg.attachments) atts.appendChild(attachmentChip(meta, false));
      bubble.appendChild(atts);
    }

    if (!msg.content && (!msg.attachments || !msg.attachments.length)) {
      bubble.textContent = '（空消息）';
    }

    const meta = document.createElement('div');
    meta.className = 'msg-meta';
    const time = document.createElement('span');
    time.textContent = timeLabel(msg.ts || Date.now());
    meta.appendChild(time);

    if (!isUser && msg.error) {
      const flag = document.createElement('span');
      flag.textContent = '· 出错了';
      meta.appendChild(flag);
    }

    if (msg.content) {
      const copy = document.createElement('button');
      copy.textContent = '复制';
      copy.dataset.copyId = msg.id;
      meta.appendChild(copy);
    }

    bubbleWrap.appendChild(bubble);
    bubbleWrap.appendChild(meta);
    row.appendChild(avatar);
    row.appendChild(bubbleWrap);
    return row;
  }

  function appendMessage(msg) {
    const welcome = els.messages.querySelector('.welcome');
    if (welcome) welcome.remove();
    const node = buildMessage(msg);
    els.messages.appendChild(node);
    return node;
  }

  /* ---------------- attachments ---------------- */

  function renderAttachments() {
    els.attachBar.innerHTML = '';
    for (const meta of state.attachments) {
      els.attachBar.appendChild(attachmentChip(meta, true));
    }
  }

  function addAttachments(metas) {
    if (!Array.isArray(metas) || !metas.length) return;
    for (const meta of metas) {
      if (!meta || !meta.path) continue;
      if (state.attachments.some((a) => a.path === meta.path)) continue;
      state.attachments.push(meta);
    }
    renderAttachments();
    if (state.attachments.some((a) => a.isImage) && !state.config.vision) {
      toast('图片会以文件形式提供；开启视觉输入后可让模型直接看图');
    }
  }

  /* ---------------- streaming ---------------- */

  function createStreamingNode() {
    const row = document.createElement('div');
    row.className = 'msg assistant streaming';
    row.id = 'stream-msg';

    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.dataset.avatar = '1';
    avatar.textContent = initials(state.persona?.name);

    const wrap = document.createElement('div');
    wrap.className = 'bubble-wrap';

    const bubble = document.createElement('div');
    bubble.className = 'bubble';

    const content = document.createElement('div');
    content.className = 'stream-content';
    content.innerHTML = '<span class="typing-dots"><i></i><i></i><i></i></span>';

    const caret = document.createElement('span');
    caret.className = 'stream-caret';

    bubble.appendChild(content);
    bubble.appendChild(caret);
    wrap.appendChild(bubble);
    row.appendChild(avatar);
    row.appendChild(wrap);
    return row;
  }

  function beginStreaming() {
    if (!state.streaming) {
      state.streaming = { buffer: '', node: null, timer: null, content: null, hadDelta: false };
    }
    if (!state.streaming.node) {
      const node = createStreamingNode();
      els.messages.appendChild(node);
      state.streaming.node = node;
      state.streaming.content = node.querySelector('.stream-content');
      scrollToBottom(true);
    }
    state.busy = true;
    updateBusyUI();
  }

  function scheduleStreamRender() {
    if (!state.streaming || state.streaming.timer) return;
    state.streaming.timer = setTimeout(() => {
      if (!state.streaming) return;
      state.streaming.timer = null;
      const { content, buffer, hadDelta } = state.streaming;
      if (!content) return;
      if (hadDelta) {
        content.innerHTML = window.renderMarkdown(buffer, { collapsible: false });
        scrollToBottom();
      }
    }, 70);
  }

  function endStreaming(finalMessage) {
    if (state.streaming) {
      if (state.streaming.timer) clearTimeout(state.streaming.timer);
      state.streaming.node?.remove();
      state.streaming = null;
    }
    state.busy = false;
    updateBusyUI();
    if (finalMessage) {
      if (state.session && finalMessage.sessionId && finalMessage.sessionId !== state.session.id) return;
      appendMessage(finalMessage.message);
      scrollToBottom(true);
    }
    refreshSessions();
  }

  function updateBusyUI() {
    els.send.disabled = state.busy;
    els.stop.hidden = !state.busy;
    els.send.hidden = state.busy;
    els.input.disabled = false;
  }

  /* ---------------- send ---------------- */

  async function sendMessage() {
    if (state.busy) {
      toast('还在回复中，稍等一下～');
      return;
    }
    const text = els.input.value.trim();
    const metas = state.attachments.slice();
    if (!text && !metas.length) return;
    if (!state.session) {
      toast('会话还没准备好');
      return;
    }

    const optimistic = {
      id: `local_${Date.now()}`,
      role: 'user',
      content: text,
      attachments: metas,
      ts: Date.now()
    };
    state.session.messages.push(optimistic);
    appendMessage(optimistic);
    scrollToBottom(true);

    els.input.value = '';
    autosize();
    state.attachments = [];
    renderAttachments();
    state.busy = true;
    updateBusyUI();
    beginStreaming();

    if (state.session.title === '新的对话') {
      const base = text || `发来了 ${metas.map((m) => m.name).join('、')}`;
      state.session.title = base.slice(0, 18) + (base.length > 18 ? '…' : '');
      updateHeader();
    }

    try {
      const res = await window.dsk.send({
        sessionId: state.session.id,
        text,
        attachments: metas.map((m) => m.path)
      });
      if (!res || !res.ok) {
        // 回滚乐观消息
        state.session.messages = state.session.messages.filter((m) => m.id !== optimistic.id);
        renderMessages();
        state.busy = false;
        if (state.streaming) {
          state.streaming.node?.remove();
          state.streaming = null;
        }
        updateBusyUI();
        toast((res && res.error) || '发送失败');
      }
    } catch (err) {
      state.busy = false;
      updateBusyUI();
      toast(err.message || '发送失败');
    }
  }

  /* ---------------- memory drawer ---------------- */

  async function renderMemoryDrawer() {
    const mem = await window.dsk.getMemory();
    els.drawerBody.innerHTML = '';

    const label1 = document.createElement('div');
    label1.className = 'mem-label';
    label1.textContent = '长期档案';
    const profile = document.createElement('div');
    profile.className = 'mem-profile';
    profile.textContent = mem.profile ? mem.profile : '还在慢慢了解你。多聊几次，我就记住啦。';

    const label2 = document.createElement('div');
    label2.className = 'mem-label';
    label2.style.marginTop = '14px';
    label2.textContent = `最近片段 · ${mem.episodeCount || 0} 段`;

    els.drawerBody.appendChild(label1);
    els.drawerBody.appendChild(profile);
    els.drawerBody.appendChild(label2);

    if (!mem.episodes || !mem.episodes.length) {
      const empty = document.createElement('div');
      empty.className = 'mem-episode';
      empty.innerHTML = '<div class="ep-text" style="color:#B4A28E">还没有记忆片段</div>';
      els.drawerBody.appendChild(empty);
      return;
    }

    for (const ep of mem.episodes) {
      const box = document.createElement('div');
      box.className = 'mem-episode';
      const t = document.createElement('div');
      t.className = 'ep-time';
      t.textContent = timeLabel(ep.ts);
      const s = document.createElement('div');
      s.className = 'ep-text';
      s.textContent = ep.summary || '';
      box.appendChild(t);
      box.appendChild(s);
      if (Array.isArray(ep.tags) && ep.tags.length) {
        const tags = document.createElement('div');
        tags.className = 'mem-tags';
        for (const tag of ep.tags.slice(0, 6)) {
          const span = document.createElement('span');
          span.className = 'mem-tag';
          span.textContent = tag;
          tags.appendChild(span);
        }
        box.appendChild(tags);
      }
      els.drawerBody.appendChild(box);
    }
  }

  async function openMemory() {
    els.drawer.hidden = false;
    try {
      await renderMemoryDrawer();
    } catch (err) {
      toast('记忆读取失败');
    }
  }

  /* ---------------- session actions ---------------- */

  async function loadSession(id) {
    if (state.busy && state.streaming) {
      window.dsk.abort(state.session.id);
    }
    const res = await window.dsk.loadSession(id);
    if (!res.ok) {
      toast(res.error || '加载失败');
      return;
    }
    state.session = res.session;
    state.busy = false;
    if (state.streaming) {
      state.streaming.node?.remove();
      state.streaming = null;
    }
    updateBusyUI();
    renderMessages();
    updateHeader();
    renderSessions();
    els.input.focus();
  }

  async function newSession() {
    if (state.busy && state.session) window.dsk.abort(state.session.id);
    state.busy = false;
    if (state.streaming) {
      state.streaming.node?.remove();
      state.streaming = null;
    }
    updateBusyUI();
    const res = await window.dsk.newSession();
    state.session = res.session;
    state.sessions = res.sessions || [];
    state.attachments = [];
    renderAttachments();
    renderSessions();
    updateHeader();
    renderMessages();
    els.input.focus();
    toast('新对话开始，我带着记忆来了');
  }

  async function deleteSession(id) {
    const confirmed = await window.appConfirm({
      title: '删除这段对话？',
      message: '对话记录会从列表移除，记忆库里的内容不会删除。',
      confirmText: '删除',
      danger: true
    });
    if (!confirmed) return;
    const res = await window.dsk.deleteSession(id);
    state.sessions = res.sessions || [];
    if (state.session?.id === id) {
      if (state.sessions.length) {
        await loadSession(state.sessions[0].id);
      } else {
        await newSession();
      }
    } else {
      renderSessions();
    }
  }

  /* ---------------- events ---------------- */

  function bindEvents() {
    els.send.addEventListener('click', sendMessage);
    els.stop.addEventListener('click', () => {
      if (state.session) window.dsk.abort(state.session.id);
      toast('已发送停止指令');
    });
    els.newChat.addEventListener('click', newSession);
    $('#btn-attach').addEventListener('click', async () => {
      const metas = await window.dsk.pickFiles();
      addAttachments(metas);
    });
    $('#foot-settings').addEventListener('click', () => window.dsk.openSettings());
    $('#btn-settings').addEventListener('click', () => window.dsk.openSettings());
    $('#btn-memory').addEventListener('click', openMemory);
    $('#foot-memory').addEventListener('click', openMemory);
    $('#drawer-close').addEventListener('click', () => {
      els.drawer.hidden = true;
    });
    $('#drawer-settings').addEventListener('click', () => window.dsk.openSettings());
    $('#drawer-summarize').addEventListener('click', async () => {
      const btn = $('#drawer-summarize');
      btn.disabled = true;
      btn.textContent = '整理中…';
      try {
        const res = await window.dsk.summarizeNow(state.session?.id);
        if (res.ok) {
          toast('记忆整理完成');
          await renderMemoryDrawer();
        } else {
          toast(res.reason ? `没整理成：${res.reason}` : '暂时没有可整理的内容');
        }
      } catch (err) {
        toast('整理失败');
      } finally {
        btn.disabled = false;
        btn.textContent = '现在整理一次';
      }
    });

    $('#btn-min').addEventListener('click', () => window.dsk.minimize());
    $('#btn-close').addEventListener('click', () => window.dsk.closeWindow());

    els.input.addEventListener('input', autosize);
    els.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && e.keyCode !== 229) {
        e.preventDefault();
        sendMessage();
      }
    });

    els.sessionList.addEventListener('click', (e) => {
      const item = e.target.closest('.session-item');
      if (!item || !item.dataset.id) return;
      if (e.target.closest('.s-del')) {
        deleteSession(item.dataset.id);
        return;
      }
      if (item.dataset.id === state.session?.id) return;
      loadSession(item.dataset.id);
    });

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        newSession();
      }
    });

    // 链接 / 文件 / 复制
    els.messages.addEventListener('click', async (e) => {
      const link = e.target.closest('.md-link');
      if (link) {
        e.preventDefault();
        const url = link.dataset.href;
        const res = await window.dsk.openExternal(url);
        if (!res.ok) toast(res.error || '无法打开链接');
        return;
      }

      const file = e.target.closest('.file-link, .attach-chip[data-path]');
      if (file) {
        e.preventDefault();
        const p = file.dataset.filePath || file.dataset.path;
        if (e.altKey) {
          const res = await window.dsk.revealPath(p);
          if (!res.ok) toast(res.error || '无法定位文件');
          return;
        }
        const res = await window.dsk.openPath(p);
        if (!res.ok) toast(res.error || '无法打开文件');
        return;
      }

      const codeCopy = e.target.closest('.copy-code');
      if (codeCopy) {
        await window.dsk.copyText(codeCopy.dataset.code || '');
        toast('代码已复制');
        return;
      }

      const codeToggle = e.target.closest('.code-toggle');
      if (codeToggle) {
        const block = codeToggle.closest('.code-block');
        if (block) {
          const collapsed = block.classList.toggle('collapsed');
          codeToggle.textContent = collapsed ? '展开' : '收起';
          codeToggle.setAttribute('aria-expanded', String(!collapsed));
        }
        return;
      }

      const copyBtn = e.target.closest('[data-copy-id]');
      if (copyBtn) {
        const id = copyBtn.dataset.copyId;
        let content = '';
        for (const m of state.session?.messages || []) {
          if (m.id === id) {
            content = m.content || '';
            break;
          }
        }
        if (content) {
          await window.dsk.copyText(content);
          toast('已复制');
        }
      }
    });

    // 拖入文件
    let dragTimer = null;
    const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
    window.addEventListener('dragenter', (e) => {
      if (!hasFiles(e)) return;
      els.dropOverlay.classList.add('show');
      if (dragTimer) clearTimeout(dragTimer);
    });
    window.addEventListener('dragover', (e) => {
      if (!hasFiles(e)) return;
      if (dragTimer) clearTimeout(dragTimer);
      dragTimer = setTimeout(() => els.dropOverlay.classList.remove('show'), 260);
    });
    window.addEventListener('dragleave', (e) => {
      if (!e.relatedTarget) els.dropOverlay.classList.remove('show');
    });

    window.dsk.onAttachmentsAdded((metas) => {
      els.dropOverlay.classList.remove('show');
      addAttachments(metas);
    });

    window.dsk.onChatStart(({ sessionId }) => {
      if (!state.session || sessionId !== state.session.id) return;
      beginStreaming();
    });

    window.dsk.onChatDelta(({ sessionId, delta }) => {
      if (!state.session || sessionId !== state.session.id) return;
      if (!state.streaming) beginStreaming();
      state.streaming.buffer += delta;
      state.streaming.hadDelta = true;
      scheduleStreamRender();
    });

    window.dsk.onChatDone((payload) => {      if (!payload || !payload.sessionId) return;
      if (!state.session || payload.sessionId !== state.session.id) {
        refreshSessions();
        return;
      }
      endStreaming(payload);
      if (payload.error) toast(`回复出错：${payload.error}`);
      else if (payload.stopped) toast('已停止');
    });

    window.dsk.onChatContinuing(({ sessionId, round }) => {
      if (!state.session || sessionId !== state.session.id) return;
      toast(`输出比较长，正在自动续写（${round}）…`);
    });

    window.dsk.onChatMemory((res) => {      if (!res || !res.ok) return;
      state.memory.episodeCount = (state.memory.episodeCount || 0) + 1;
      if (res.episode) state.memory.recent.unshift({ summary: res.episode, ts: Date.now(), tags: res.tags || [] });
      updateHeader();
      toast('记住了一点新东西');
      if (!els.drawer.hidden) renderMemoryDrawer();
    });

    window.dsk.onPersonaChanged(({ persona }) => {
      if (persona) applyPersona(persona);
    });

    // 从隐藏状态重新打开窗口时，主进程会发来一段新的空草稿
    window.dsk.onNewDraft(({ session, sessions }) => {
      if (!session) return;
      if (state.busy && state.session) window.dsk.abort(state.session.id);
      if (state.streaming) {
        if (state.streaming.timer) clearTimeout(state.streaming.timer);
        state.streaming.node?.remove();
        state.streaming = null;
      }
      state.busy = false;
      state.session = session;
      state.sessions = sessions || [];
      state.attachments = [];
      els.input.value = '';
      autosize();
      renderAttachments();
      renderSessions();
      renderMessages();
      updateHeader();
      updateBusyUI();
      els.drawer.hidden = true;
      els.input.focus();
      toast('新对话');
    });

    window.dsk.onSessionsUpdated(({ sessions }) => {
      state.sessions = sessions || [];
      const meta = state.sessions.find((s) => s.id === state.session?.id);
      if (meta && state.session) state.session.title = meta.title;
      renderSessions();
      updateHeader();
    });

    window.dsk.onRefresh(async () => {
      try {
        const data = await window.dsk.chatBootstrap({ createDraft: false });
        state.persona = data.persona;
        state.personas = data.personas || state.personas;
        state.memory = data.memory || state.memory;
        state.config = data.config || state.config;
        applyPersona(data.persona);
        updateHeader();
      } catch (err) {
        console.error(err);
      }
    });

    document.addEventListener('contextmenu', (e) => {
      // 输入区保留系统菜单，其余区域允许右键
      if (e.target.closest('input, textarea')) return;
    });

    // 页面隐藏时不要把未完成状态丢掉
    window.addEventListener('beforeunload', () => {
      if (state.busy && state.session) window.dsk.abort(state.session.id);
    });
  }

  /* ---------------- boot ---------------- */

  async function boot() {
    bindEvents();
    try {
      const data = await window.dsk.chatBootstrap();
      state.session = data.session;
      state.sessions = data.sessions || [];
      state.persona = data.persona;
      state.personas = data.personas || [];
      state.memory = data.memory || state.memory;
      state.config = data.config || state.config;
      applyPersona(data.persona);
      renderSessions();
      renderMessages();
      updateHeader();
      els.input.focus();
    } catch (err) {
      console.error(err);
      els.messages.innerHTML =
        '<div class="welcome"><h2>加载失败</h2><p>桌宠主进程可能没有正常运行。可以关掉应用重新打开试试。</p></div>';
    }
  }

  boot();
})();
