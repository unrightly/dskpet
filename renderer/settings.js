'use strict';

(() => {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const state = {
    config: null,
    personas: [],
    activePersonaId: '',
    memory: { profile: '', episodes: [], episodeCount: 0, updatedAt: 0 },
    providers: [],
    editingId: '',
    saving: false
  };

  function setStatus(el, text, ok = true) {
    el.textContent = text;
    el.style.color = ok ? '#4C8A5B' : '#C4574C';
    if (ok && text) {
      setTimeout(() => {
        if (el.textContent === text) el.textContent = '';
      }, 2400);
    }
  }

  /* ---------------- tabs ---------------- */

  function initTabs() {
    $$('.tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        $$('.tab').forEach((t) => t.classList.toggle('active', t === tab));
        const name = tab.dataset.tab;
        $$('.panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === name));
        $('.s-body').scrollTop = 0;
      });
    });
  }

  /* ---------------- general + model ---------------- */

  function fillGeneral(cfg) {
    $('#set-theme').value = cfg.ui?.theme || 'system';
    $('#set-interval').value = cfg.pet.bubbleIntervalMin;
    $('#set-smart').checked = !!cfg.pet.smartBubble;
    $('#set-scale').value = cfg.pet.scale;
    $('#scale-val').textContent = `${Number(cfg.pet.scale).toFixed(2)}×`;
    $('#set-ontop').checked = !!cfg.pet.alwaysOnTop;
    $('#set-login').checked = !!cfg.pet.launchAtLogin;
  }

  function fillModel(cfg, providers) {
    const sel = $('#set-provider');
    sel.innerHTML = '';
    for (const p of providers) {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.label;
      sel.appendChild(opt);
    }
    const matched = providers.find((p) => p.baseURL && p.baseURL.replace(/\/+$/, '') === String(cfg.api.baseURL || '').replace(/\/+$/, ''));
    sel.value = matched ? matched.id : 'custom';
    $('#provider-note').textContent = matched ? matched.note || '' : '手动填写任意 OpenAI 兼容服务的地址';

    $('#set-baseurl').value = cfg.api.baseURL || '';
    $('#set-model').value = cfg.api.model || '';
    $('#set-temp').value = cfg.api.temperature;
    $('#temp-val').textContent = Number(cfg.api.temperature).toFixed(2);
    $('#set-maxtokens').value = cfg.api.maxTokens;
    $('#set-vision').checked = !!cfg.api.vision;
    $('#set-headers').value = cfg.api.extraHeaders || '';
    $('#set-apikey').value = '';
    $('#set-clearkey').checked = false;

    if (cfg.api.apiKeySet) {
      $('#set-apikey').placeholder = `已保存 ${cfg.api.apiKeyMasked}，留空则不修改`;
      $('#key-hint').textContent = 'Key 会以系统加密（safeStorage）形式保存在本机配置里。';
    } else {
      $('#set-apikey').placeholder = '粘贴 API Key（本地模型可留空）';
      $('#key-hint').textContent = '还没有保存 Key。Ollama / LM Studio 这类本地服务不需要 Key。';
    }
  }

  function collectSettings() {
    const interval = Math.min(240, Math.max(1, parseInt($('#set-interval').value, 10) || 10));
    const scale = Math.min(1.4, Math.max(0.8, parseFloat($('#set-scale').value) || 1));
    const temperature = Math.min(1.5, Math.max(0, parseFloat($('#set-temp').value) || 0));
    const maxTokens = Math.min(8000, Math.max(80, parseInt($('#set-maxtokens').value, 10) || 900));

    const payload = {
      api: {
        baseURL: $('#set-baseurl').value.trim(),
        model: $('#set-model').value.trim(),
        temperature,
        maxTokens,
        vision: $('#set-vision').checked,
        extraHeaders: $('#set-headers').value.trim(),
        clearKey: $('#set-clearkey').checked
      },
      pet: {
        bubbleIntervalMin: interval,
        smartBubble: $('#set-smart').checked,
        scale,
        alwaysOnTop: $('#set-ontop').checked,
        launchAtLogin: $('#set-login').checked
      },
      ui: {
        theme: $('#set-theme').value
      }
    };

    const key = $('#set-apikey').value.trim();
    if (key) payload.api.apiKey = key;
    return payload;
  }

  async function saveSettings() {
    if (state.saving) return;
    state.saving = true;
    const btn = $('#btn-save');
    btn.disabled = true;
    btn.textContent = '保存中…';
    try {
      const payload = collectSettings();
      const res = await window.dsk.saveSettings(payload);
      if (res.ok) {
        state.config = res.config;
        fillModel(res.config, state.providers);
        setStatus($('#save-status'), '设置已保存 ✓');
      } else {
        setStatus($('#save-status'), res.error || '保存失败', false);
      }
    } catch (err) {
      setStatus($('#save-status'), err.message || '保存失败', false);
    } finally {
      state.saving = false;
      btn.disabled = false;
      btn.textContent = '保存设置';
    }
  }

  async function testApi() {
    const btn = $('#btn-test');
    const status = $('#test-status');
    btn.disabled = true;
    btn.textContent = '测试中…';
    status.className = 'test-status';
    status.textContent = '正在发送一个很小的测试请求…';
    try {
      const res = await window.dsk.testApi({
        baseURL: $('#set-baseurl').value.trim(),
        model: $('#set-model').value.trim(),
        apiKey: $('#set-apikey').value.trim(),
        temperature: parseFloat($('#set-temp').value) || 0
      });
      if (res.ok) {
        status.className = 'test-status ok';
        status.textContent = `连接成功 · ${res.latency} ms · 模型回复：${String(res.reply || '').slice(0, 40) || '(空)'}`;
      } else {
        status.className = 'test-status err';
        status.textContent = `连接失败：${res.error}`;
      }
    } catch (err) {
      status.className = 'test-status err';
      status.textContent = `连接失败：${err.message}`;
    } finally {
      btn.disabled = false;
      btn.textContent = '测试';
    }
  }

  function initGeneralModel() {
    $('#set-scale').addEventListener('input', (e) => {
      $('#scale-val').textContent = `${Number(e.target.value).toFixed(2)}×`;
    });
    $('#set-temp').addEventListener('input', (e) => {
      $('#temp-val').textContent = Number(e.target.value).toFixed(2);
    });
    $('#pe-color').addEventListener('input', (e) => {
      $('#pe-color-text').value = e.target.value;
    });
    $('#pe-color-text').addEventListener('input', (e) => {
      const v = e.target.value.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(v)) $('#pe-color').value = v;
    });

    $('#set-provider').addEventListener('change', (e) => {
      const preset = state.providers.find((p) => p.id === e.target.value);
      if (!preset) return;
      if (preset.baseURL) $('#set-baseurl').value = preset.baseURL;
      if (preset.model) $('#set-model').value = preset.model;
      $('#provider-note').textContent = preset.note || '';
    });

    $('#btn-save').addEventListener('click', saveSettings);
    $('#btn-test').addEventListener('click', testApi);
    $('#btn-show-pet').addEventListener('click', () => window.dsk.showPet());
    $('#btn-open-chat').addEventListener('click', () => window.dsk.openChat());

    $('#set-clearkey').addEventListener('change', (e) => {
      if (e.target.checked) $('#set-apikey').value = '';
    });
  }

  /* ---------------- persona ---------------- */

  function renderPersonaList() {
    const list = $('#persona-list');
    list.innerHTML = '';
    $('#persona-count').textContent = `${state.personas.length} 个`;
    for (const p of state.personas) {
      const item = document.createElement('div');
      item.className = 'persona-item' + (p.id === state.editingId ? ' active' : '');
      item.dataset.id = p.id;

      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = p.color || '#F2A65A';

      const name = document.createElement('span');
      name.className = 'pname';
      name.textContent = p.name;

      item.appendChild(dot);
      item.appendChild(name);

      if (p.id === state.activePersonaId) {
        const badge = document.createElement('span');
        badge.className = 'badge';
        badge.textContent = '当前';
        item.appendChild(badge);
      }

      item.addEventListener('click', () => selectPersona(p.id));
      list.appendChild(item);
    }
  }

  function selectPersona(id) {
    const p = state.personas.find((x) => x.id === id);
    if (!p) return;
    state.editingId = p.id;
    $('#pe-name').value = p.name || '';
    $('#pe-color').value = /^#[0-9a-fA-F]{6}$/.test(p.color || '') ? p.color : '#F2A65A';
    $('#pe-color-text').value = p.color || '#F2A65A';
    $('#pe-tagline').value = p.tagline || '';
    $('#pe-greeting').value = p.greeting || '';
    $('#pe-persona').value = p.persona || '';
    $('#pe-soul').value = p.soul || '';
    $('#pe-style').value = p.style || '';
    $('#pe-bubbles').value = Array.isArray(p.bubbles) ? p.bubbles.join('\n') : '';
    $('#persona-status').textContent = '';
    renderPersonaList();
  }

  function newPersonaDraft() {
    state.editingId = '';
    $('#pe-name').value = '新朋友';
    $('#pe-color').value = '#7FA6D9';
    $('#pe-color-text').value = '#7FA6D9';
    $('#pe-tagline').value = '刚刚来到桌面上的小家伙';
    $('#pe-greeting').value = '你好呀，我以后就住这里了。';
    $('#pe-persona').value = '';
    $('#pe-soul').value = '';
    $('#pe-style').value = '';
    $('#pe-bubbles').value = '';
    $('#persona-status').textContent = '还没保存';
    renderPersonaList();
    $('#pe-name').focus();
  }

  function duplicatePersona() {
    const current = state.personas.find((p) => p.id === state.editingId);
    if (!current) {
      newPersonaDraft();
      return;
    }
    state.editingId = '';
    $('#pe-name').value = `${current.name} 副本`;
    $('#pe-color').value = current.color || '#F2A65A';
    $('#pe-color-text').value = current.color || '#F2A65A';
    $('#pe-tagline').value = current.tagline || '';
    $('#pe-greeting').value = current.greeting || '';
    $('#pe-persona').value = current.persona || '';
    $('#pe-soul').value = current.soul || '';
    $('#pe-style').value = current.style || '';
    $('#pe-bubbles').value = Array.isArray(current.bubbles) ? current.bubbles.join('\n') : '';
    $('#persona-status').textContent = '副本未保存';
    renderPersonaList();
  }

  async function savePersona() {
    const name = $('#pe-name').value.trim();
    if (!name) {
      setStatus($('#persona-status'), '名字不能为空', false);
      return;
    }
    const payload = {
      id: state.editingId || undefined,
      name,
      color: $('#pe-color').value,
      tagline: $('#pe-tagline').value.trim(),
      greeting: $('#pe-greeting').value.trim(),
      persona: $('#pe-persona').value.trim(),
      soul: $('#pe-soul').value.trim(),
      style: $('#pe-style').value.trim(),
      bubbles: $('#pe-bubbles')
        .value.split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
    };
    const btn = $('#btn-persona-save');
    btn.disabled = true;
    btn.textContent = '保存中…';
    try {
      const res = await window.dsk.savePersona(payload);
      if (res.ok) {
        state.personas = res.personas;
        state.activePersonaId = res.activePersonaId;
        state.editingId = res.persona.id;
        renderPersonaList();
        setStatus($('#persona-status'), '人格已保存 ✓');
      } else {
        setStatus($('#persona-status'), res.error || '保存失败', false);
      }
    } catch (err) {
      setStatus($('#persona-status'), err.message || '保存失败', false);
    } finally {
      btn.disabled = false;
      btn.textContent = '保存人格';
    }
  }

  async function deletePersona() {
    if (!state.editingId) {
      setStatus($('#persona-status'), '先选中一个已保存的人格', false);
      return;
    }
    if (state.personas.length <= 1) {
      setStatus($('#persona-status'), '至少保留一个人格', false);
      return;
    }
    if (!(await window.appConfirm({
      title: '删除这个人物预设？',
      message: '对话记录与记忆会保留，删除后不可恢复。',
      confirmText: '删除',
      danger: true
    }))) return;
    const res = await window.dsk.deletePersona(state.editingId);
    if (res.ok) {
      state.personas = res.personas;
      state.activePersonaId = res.activePersonaId;
      const next = state.personas.find((p) => p.id === state.activePersonaId) || state.personas[0];
      selectPersona(next.id);
      renderPersonaList();
    } else {
      setStatus($('#persona-status'), res.error || '删除失败', false);
    }
  }

  async function setActivePersona() {
    if (!state.editingId) {
      setStatus($('#persona-status'), '先保存人格，再设为当前', false);
      return;
    }
    const res = await window.dsk.setActivePersona(state.editingId);
    if (res.ok) {
      state.activePersonaId = res.persona.id;
      renderPersonaList();
      setStatus($('#persona-status'), `已切换为「${res.persona.name}」✓`);
    } else {
      setStatus($('#persona-status'), res.error || '切换失败', false);
    }
  }

  function initPersona() {
    $('#btn-persona-new').addEventListener('click', newPersonaDraft);
    $('#btn-persona-dup').addEventListener('click', duplicatePersona);
    $('#btn-persona-del').addEventListener('click', deletePersona);
    $('#btn-persona-save').addEventListener('click', savePersona);
    $('#btn-persona-active').addEventListener('click', setActivePersona);
  }

  /* ---------------- memory ---------------- */

  function fmtDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }

  function fillMemory(mem) {
    $('#mem-stats').textContent = mem.updatedAt
      ? `${mem.episodeCount || 0} 段记忆 · 更新于 ${fmtDate(mem.updatedAt)}`
      : `${mem.episodeCount || 0} 段记忆`;
    $('#mem-profile').value = mem.profile || '';

    const list = $('#mem-list');
    list.innerHTML = '';
    if (!mem.episodes || !mem.episodes.length) {
      const empty = document.createElement('div');
      empty.className = 'mem-empty';
      empty.textContent = '还没有记忆片段。聊几轮之后，她会自己整理。';
      list.appendChild(empty);
      return;
    }
    for (const ep of mem.episodes) {
      const item = document.createElement('div');
      item.className = 'mem-item';
      const time = document.createElement('div');
      time.className = 'm-time';
      time.textContent = fmtDate(ep.ts);
      const text = document.createElement('div');
      text.className = 'm-text';
      text.textContent = ep.summary || '';
      item.appendChild(time);
      item.appendChild(text);
      list.appendChild(item);
    }
  }

  async function reloadAll() {
    const data = await window.dsk.getSettings();
    state.config = data.config;
    state.personas = data.personas;
    state.activePersonaId = data.activePersonaId;
    state.memory = data.memory;
    state.providers = data.providers;
    fillMemory(data.memory);
    renderPersonaList();
  }

  function initMemory() {
    $('#btn-profile-save').addEventListener('click', async () => {
      try {
        await window.dsk.saveProfile($('#mem-profile').value);
        setStatus($('#mem-status'), '档案已保存 ✓');
      } catch (err) {
        setStatus($('#mem-status'), '保存失败', false);
      }
    });

    $('#btn-mem-summarize').addEventListener('click', async () => {
      const btn = $('#btn-mem-summarize');
      btn.disabled = true;
      btn.textContent = '整理中…';
      try {
        const res = await window.dsk.summarizeSettingsNow();
        if (res.ok) {
          setStatus($('#mem-status'), '整理完成 ✓');
          await reloadAll();
        } else {
          setStatus($('#mem-status'), res.reason ? `没整理成：${res.reason}` : '没有可整理的内容', false);
        }
      } catch (err) {
        setStatus($('#mem-status'), '整理失败', false);
      } finally {
        btn.disabled = false;
        btn.textContent = '现在整理一次';
      }
    });

    $('#btn-mem-clear').addEventListener('click', async () => {
      if (!(await window.appConfirm({
        title: '清空所有长期记忆？',
        message: '对话记录会保留，但她会重新认识你。此操作不可撤销。',
        confirmText: '清空',
        danger: true
      }))) return;
      await window.dsk.clearMemory();
      await reloadAll();
      setStatus($('#mem-status'), '记忆已清空');
    });
  }

  /* ---------------- window ---------------- */

  function initWindow() {
    $('#s-min').addEventListener('click', () => window.dsk.minimize());
    $('#s-close').addEventListener('click', () => window.dsk.closeWindow());
    $('#btn-close').addEventListener('click', () => window.dsk.closeWindow());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') window.dsk.closeWindow();
    });
  }

  /* ---------------- boot ---------------- */

  async function boot() {
    initTabs();
    initGeneralModel();
    initPersona();
    initMemory();
    initWindow();

    try {
      const data = await window.dsk.getSettings();
      state.config = data.config;
      state.personas = data.personas;
      state.activePersonaId = data.activePersonaId;
      state.memory = data.memory;
      state.providers = data.providers;

      $('#version').textContent = `v${data.version}${data.isPackaged ? '' : ' · dev'}`;
      fillGeneral(data.config);
      fillModel(data.config, data.providers);
      fillMemory(data.memory);

      const active = state.personas.find((p) => p.id === state.activePersonaId) || state.personas[0];
      if (active) selectPersona(active.id);
      else renderPersonaList();
    } catch (err) {
      console.error(err);
      $('#save-status').textContent = '读取设置失败';
    }
  }

  boot();
})();
