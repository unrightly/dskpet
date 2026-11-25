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
  let lastAction = '';

  const EYES_OPEN_MOODS = ['idle', 'curious', 'talk', 'think'];

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

    if (bubbleHideTimer) clearTimeout(bubbleHideTimer);
    if (typeTimer) clearInterval(typeTimer);

    bubble.hidden = false;
    bubble.classList.remove('done', 'typing');
    bubbleText.textContent = '';
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

  /* ---------------- helper animations ---------------- */

  function addTemporaryClass(cls, ms) {
    wrap.classList.add(cls);
    setTimeout(() => wrap.classList.remove(cls), ms);
  }

  function setTilt(direction) {
    wrap.classList.remove('tilt-left', 'tilt-right');
    if (direction === 'left') wrap.classList.add('tilt-left');
    if (direction === 'right') wrap.classList.add('tilt-right');
  }

  function doBlink() {
    if (!EYES_OPEN_MOODS.includes(mood)) return;
    wrap.classList.add('blinking');
    setTimeout(() => wrap.classList.remove('blinking'), 130);
  }

  /* ---------------- particles ---------------- */

  function spawnParticles(className, glyphs, count) {
    for (let i = 0; i < count; i += 1) {
      const el = document.createElement('span');
      el.className = className;
      el.textContent = glyphs[Math.floor(Math.random() * glyphs.length)];
      el.style.left = `${30 + Math.random() * 40}%`;
      el.style.bottom = `${50 + Math.random() * 20}%`;
      el.style.setProperty('--dx', `${(Math.random() - 0.5) * 54}px`);
      el.style.animationDelay = `${Math.random() * 0.28}s`;
      el.style.fontSize = `${11 + Math.random() * 8}px`;
      fx.appendChild(el);
      setTimeout(() => el.remove(), 1800);
    }
  }

  const burstHearts = (n = 6) => spawnParticles('fx-heart', ['♥', '♡'], n);
  const burstSparkles = (n = 5) => spawnParticles('fx-star', ['✦', '✧', '★'], n);
  const burstNotes = (n = 4) => spawnParticles('fx-note', ['♪', '♫'], n);

  /* ---------------- actions ---------------- */

  const actions = {
    blink() {
      doBlink();
    },
    doubleBlink() {
      doBlink();
      setTimeout(doBlink, 240);
    },
    ears() {
      addTemporaryClass(Math.random() > 0.5 ? 'twitch-l' : 'twitch-r', 560);
    },
    hop() {
      addTemporaryClass('hop', 570);
    },
    bounce() {
      addTemporaryClass('bounce', 940);
    },
    look() {
      const dir = Math.random() > 0.5 ? 'right' : 'left';
      setTilt(dir);
      pet.style.setProperty('--look-x', dir === 'right' ? '3px' : '-3px');
      pet.style.setProperty('--look-y', `${(Math.random() - 0.5) * 2}px`);
      setTimeout(() => {
        setTilt(null);
        pet.style.setProperty('--look-x', '0px');
        pet.style.setProperty('--look-y', '0px');
      }, 1000);
    },
    stretch() {
      addTemporaryClass('stretching', 980);
    },
    tail() {
      addTemporaryClass('tail-flick', 820);
    },
    shine() {
      addTemporaryClass('shine', 950);
      burstSparkles(4);
    },
    yawn() {
      setMood('yawn', 2600);
    },
    sleepy() {
      setMood('sleepy', 3000);
    },
    sneeze() {
      addTemporaryClass('sneezing', 640);
      setTimeout(() => setMood('curious', 1000), 700);
    },
    shake() {
      addTemporaryClass('shaking', 580);
    },
    dance() {
      setMood('dance', 2450);
      addTemporaryClass('dancing', 2450);
      burstNotes(4);
    },
    spin() {
      addTemporaryClass('spin', 840);
      burstSparkles(5);
      setTimeout(() => setMood('excited', 1200), 420);
    },
    love() {
      setMood('love', 2200);
      burstHearts(7);
    },
    shy() {
      setMood('shy', 2000);
    },
    excited() {
      setMood('excited', 2100);
      burstSparkles(6);
      burstNotes(2);
    },
    think() {
      setMood('think', 2300);
    },
    wink() {
      setMood('wink', 1300);
    }
  };

  const actionPool = [
    'blink',
    'doubleBlink',
    'ears',
    'ears',
    'hop',
    'bounce',
    'look',
    'look',
    'tail',
    'shine',
    'stretch',
    'yawn',
    'sneeze',
    'shake',
    'dance',
    'spin',
    'love',
    'shy',
    'excited',
    'think',
    'wink',
    'sleepy'
  ];

  function doMicroAction() {
    if (dragging) return;
    let pick = actionPool[Math.floor(Math.random() * actionPool.length)];
    if (pick === lastAction && Math.random() < 0.7) {
      pick = actionPool[Math.floor(Math.random() * actionPool.length)];
    }
    lastAction = pick;
    const fn = actions[pick];
    if (fn) fn();
  }

  function scheduleBlink() {
    setTimeout(() => {
      doBlink();
      scheduleBlink();
    }, 2800 + Math.random() * 3800);
  }

  function scheduleMicro() {
    setTimeout(() => {
      doMicroAction();
      scheduleMicro();
    }, 3200 + Math.random() * 4200);
  }

  function scheduleAmbient() {
    setTimeout(() => {
      if (!bubbleVisible && !moodHold && !dragging) setMood(ambientMood());
      scheduleAmbient();
    }, 24000);
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

    if (EYES_OPEN_MOODS.includes(mood)) {
      const rect = wrap.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height * 0.44;
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
    const dx = e.screenX - press.sx;
    const dist = Math.hypot(dx, e.screenY - press.sy);
    if (dist > 4) {
      if (!press.moved) {
        dragging = true;
        setMood('curious', 700);
      }
      press.moved = true;
    }
    if (press.moved) {
      window.dsk.petDrag('move', e.screenX, e.screenY);
      setTilt(dx > 3 ? 'right' : dx < -3 ? 'left' : null);
    }
  });

  function endPress(openIfClick) {
    if (!press) return;
    window.dsk.petDrag('end', 0, 0);
    const wasClick = !press.moved && Date.now() - press.time < 700;
    press = null;
    dragging = false;
    setTilt(null);
    if (openIfClick && wasClick) openChat();
    else setMood(ambientMood());
  }

  wrap.addEventListener('pointerup', () => endPress(true));
  wrap.addEventListener('pointercancel', () => endPress(false));

  function openChat() {
    burstHearts(8);
    burstSparkles(4);
    setMood('excited', 1700);
    addTemporaryClass('hop', 560);
    window.dsk.petOpenChat();
  }

  wrap.addEventListener('pointerenter', () => {
    setIgnore(false);
    wrap.classList.add('hovering');
    if (mood === 'sleepy') setMood('curious', 1600);
  });

  wrap.addEventListener('pointerleave', () => {
    wrap.classList.remove('hovering');
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
    if (cfg.name) wrap.title = `${cfg.name} · 单击聊天，拖动移动`;
  }

  window.dsk.petBootstrap().then(applyConfig).catch((err) => console.error(err));
  window.dsk.onPetConfig(applyConfig);
  window.dsk.onBubble((payload) => {
    if (payload && payload.text) showBubble(payload.text);
  });
  window.dsk.onMood((m) => {
    if (typeof m === 'string') setMood(m, 2400);
  });

  /* ---------------- boot ---------------- */

  setIgnore(true);
  setMood(ambientMood());
  scheduleBlink();
  scheduleMicro();
  scheduleAmbient();
})();
