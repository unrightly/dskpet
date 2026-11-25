'use strict';

(() => {
  const pet = document.getElementById('pet');
  const wrap = document.getElementById('pet-wrap');
  const bubble = document.getElementById('bubble');
  const bubbleText = document.getElementById('bubble-text');
  const fx = document.getElementById('fx');

  let mood = 'idle';
  let moodHold = null;
  let bubbleHideTimer = null;
  let typeTimer = null;
  let bubbleVisible = false;
  let press = null;
  let dragging = false;
  let ignoring = null;
  let lastBubbleText = '';

  /* ---------------- moods ---------------- */

  function ambientMood() {
    const hour = new Date().getHours();
    if (hour < 6) return 'sleepy';
    if (hour < 9) return 'happy';
    if (hour < 12) return 'idle';
    if (hour < 14) return 'curious';
    if (hour < 18) return 'idle';
    if (hour < 20) return 'happy';
    if (hour < 23) return 'curious';
    return 'sleepy';
  }

  function setMood(name, holdMs) {
    if (moodHold) {
      clearTimeout(moodHold);
      moodHold = null;
    }
    mood = name;
    pet.setAttribute('class', `mood-${name}`);
    if (holdMs) {
      moodHold = setTimeout(() => {
        moodHold = null;
        setMood(ambientMood());
      }, holdMs);
    }
  }

  /* ---------------- bubble ---------------- */

  function hideBubble() {
    bubble.classList.remove('show', 'typing', 'done');
    bubbleVisible = false;
    setTimeout(() => {
      if (!bubble.classList.contains('show')) bubble.hidden = true;
    }, 300);
    setMood(ambientMood());
  }

  function showBubble(text) {
    const value = String(text || '').trim();
    if (!value) return;
    lastBubbleText = value;

    if (bubbleHideTimer) clearTimeout(bubbleHideTimer);
    if (typeTimer) clearInterval(typeTimer);

    bubble.hidden = false;
    bubble.classList.remove('done', 'typing');
    bubbleText.textContent = '';
    // 先让浏览器应用 display，再加过渡类
    requestAnimationFrame(() => {
      bubble.classList.add('show', 'typing');
    });
    bubbleVisible = true;
    setMood('talk');

    const step = value.length > 42 ? 22 : 34;
    let index = 0;
    typeTimer = setInterval(() => {
      index += 1;
      bubbleText.textContent = value.slice(0, index);
      if (index >= value.length) {
        clearInterval(typeTimer);
        typeTimer = null;
        bubble.classList.remove('typing');
        bubble.classList.add('done');
        setMood('happy', 1400);
        const hold = Math.min(15000, Math.max(5200, 3600 + value.length * 150));
        bubbleHideTimer = setTimeout(hideBubble, hold);
      }
    }, step);
  }

  /* ---------------- micro behaviours ---------------- */

  function addTemporaryClass(cls, ms) {
    wrap.classList.add(cls);
    setTimeout(() => wrap.classList.remove(cls), ms);
  }

  function doBlink() {
    if (!['idle', 'curious', 'talk'].includes(mood)) return;
    wrap.classList.add('blinking');
    setTimeout(() => wrap.classList.remove('blinking'), 130);
  }

  function scheduleBlink() {
    const wait = 3200 + Math.random() * 4200;
    setTimeout(() => {
      doBlink();
      scheduleBlink();
    }, wait);
  }

  function doMicroAction() {
    if (dragging) return;
    const actions = ['twitch', 'twitch', 'hop', 'look', 'stretch', 'tail', 'shine', 'yawn'];
    const pick = actions[Math.floor(Math.random() * actions.length)];
    switch (pick) {
      case 'twitch':
        addTemporaryClass(Math.random() > 0.5 ? 'twitch-l' : 'twitch-r', 520);
        break;
      case 'hop':
        addTemporaryClass('hop', 540);
        break;
      case 'look': {
        const x = (Math.random() > 0.5 ? 1 : -1) * (2 + Math.random() * 2);
        const y = (Math.random() - 0.5) * 3;
        pet.style.setProperty('--look-x', `${x.toFixed(1)}px`);
        pet.style.setProperty('--look-y', `${y.toFixed(1)}px`);
        setTimeout(() => {
          pet.style.setProperty('--look-x', '0px');
          pet.style.setProperty('--look-y', '0px');
        }, 900);
        break;
      }
      case 'stretch':
        addTemporaryClass('stretching', 920);
        break;
      case 'tail':
        addTemporaryClass('tail-flick', 780);
        break;
      case 'shine':
        addTemporaryClass('shine', 900);
        break;
      case 'yawn':
        setMood('sleepy', 2300);
        break;
      default:
        break;
    }
  }

  function scheduleMicro() {
    const wait = 5200 + Math.random() * 7000;
    setTimeout(() => {
      doMicroAction();
      scheduleMicro();
    }, wait);
  }

  function scheduleAmbient() {
    setTimeout(() => {
      if (!bubbleVisible && !moodHold) setMood(ambientMood());
      scheduleAmbient();
    }, 28000);
  }

  /* ---------------- fx ---------------- */

  function burstHearts(count = 6) {
    for (let i = 0; i < count; i += 1) {
      const el = document.createElement('span');
      el.className = 'fx-heart';
      el.textContent = i % 2 ? '♥' : '♡';
      el.style.left = `${34 + Math.random() * 32}%`;
      el.style.bottom = `${52 + Math.random() * 16}%`;
      el.style.setProperty('--dx', `${(Math.random() - 0.5) * 46}px`);
      el.style.animationDelay = `${Math.random() * 0.25}s`;
      el.style.fontSize = `${12 + Math.random() * 8}px`;
      fx.appendChild(el);
      setTimeout(() => el.remove(), 1700);
    }
  }

  /* ---------------- click-through ---------------- */

  function setIgnore(value) {
    if (ignoring === value) return;
    ignoring = value;
    window.dsk.petSetIgnore(value);
  }

  function updateHover(clientX, clientY) {
    if (dragging) {
      setIgnore(false);
      return;
    }
    const el = document.elementFromPoint(clientX, clientY);
    const overInteractive = !!(el && el.closest && el.closest('.interactive'));
    setIgnore(!overInteractive);
  }

  document.addEventListener('mousemove', (e) => {
    updateHover(e.clientX, e.clientY);

    if (mood === 'idle' || mood === 'curious') {
      const rect = wrap.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height * 0.42;
      const dx = Math.max(-1, Math.min(1, (e.clientX - cx) / (rect.width * 0.55)));
      const dy = Math.max(-1, Math.min(1, (e.clientY - cy) / (rect.height * 0.55)));
      if (!press) {
        pet.style.setProperty('--look-x', `${(dx * 3).toFixed(1)}px`);
        pet.style.setProperty('--look-y', `${(dy * 2.4).toFixed(1)}px`);
      }
    }
  });

  document.addEventListener('mouseleave', () => setIgnore(true));

  /* ---------------- drag & click ---------------- */

  wrap.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    setIgnore(false);
    press = {
      sx: e.screenX,
      sy: e.screenY,
      time: Date.now(),
      moved: false,
      pointerId: e.pointerId
    };
    dragging = false;
    try {
      wrap.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    window.dsk.petDrag('start', e.screenX, e.screenY);
  });

  wrap.addEventListener('pointermove', (e) => {
    if (!press) return;
    const dist = Math.hypot(e.screenX - press.sx, e.screenY - press.sy);
    if (dist > 4) {
      if (!press.moved) dragging = true;
      press.moved = true;
    }
    if (press.moved) {
      window.dsk.petDrag('move', e.screenX, e.screenY);
      setMood('curious', 600);
    }
  });

  function endPress(openIfClick) {
    if (!press) return;
    window.dsk.petDrag('end', 0, 0);
    const wasClick = !press.moved && Date.now() - press.time < 700;
    press = null;
    dragging = false;
    if (openIfClick && wasClick) openChat();
    else setMood(ambientMood());
  }

  wrap.addEventListener('pointerup', () => endPress(true));
  wrap.addEventListener('pointercancel', () => endPress(false));

  function openChat() {
    burstHearts(7);
    setMood('happy', 1800);
    window.dsk.petOpenChat();
  }

  wrap.addEventListener('pointerenter', () => {
    setIgnore(false);
    if (mood === 'sleepy') setMood('curious', 1500);
  });

  wrap.addEventListener('pointerleave', () => {
    if (!dragging) setIgnore(true);
  });

  /* ---------------- bubble / context menu ---------------- */

  bubble.addEventListener('click', () => openChat());
  bubble.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    window.dsk.petContextMenu();
  });
  wrap.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    window.dsk.petContextMenu();
  });

  /* ---------------- config & events ---------------- */

  function applyConfig(cfg) {
    if (!cfg) return;
    if (cfg.scale) document.documentElement.style.setProperty('--scale', String(cfg.scale));
    if (cfg.color) {
      document.documentElement.style.setProperty('--accent', cfg.color);
      bubble.style.borderColor = cfg.color + '55';
    }
    if (cfg.name) {
      wrap.title = `${cfg.name} · 单击聊天，拖动移动`;
    }
  }

  window.dsk.petBootstrap().then(applyConfig).catch((err) => console.error(err));
  window.dsk.onPetConfig(applyConfig);
  window.dsk.onBubble((payload) => {
    if (payload && payload.text) showBubble(payload.text);
  });
  window.dsk.onMood((m) => {
    if (typeof m === 'string') setMood(m, 2600);
  });

  /* ---------------- boot ---------------- */

  setIgnore(true);
  setMood(ambientMood());
  scheduleBlink();
  scheduleMicro();
  scheduleAmbient();
})();
