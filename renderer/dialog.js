'use strict';

(() => {
  let current = null;

  function rootNode() {
    return document.querySelector('.window-shell') || document.body;
  }

  function appConfirm(options = {}) {
    const {
      title = '确认操作',
      message = '',
      confirmText = '确定',
      cancelText = '取消',
      danger = false
    } = options;

    if (current) current.close(false);

    return new Promise((resolve) => {
      const root = rootNode();
      const overlay = document.createElement('div');
      overlay.className = 'app-dialog-overlay';

      const card = document.createElement('div');
      card.className = 'app-dialog-card';
      card.setAttribute('role', 'dialog');
      card.setAttribute('aria-modal', 'true');
      card.setAttribute('aria-labelledby', 'app-dialog-title');

      const head = document.createElement('div');
      head.className = 'app-dialog-head';

      const icon = document.createElement('div');
      icon.className = `app-dialog-icon${danger ? ' danger' : ''}`;
      icon.textContent = danger ? '!' : 'i';

      const textWrap = document.createElement('div');
      textWrap.className = 'app-dialog-text';

      const titleEl = document.createElement('div');
      titleEl.className = 'app-dialog-title';
      titleEl.id = 'app-dialog-title';
      titleEl.textContent = title;

      const messageEl = document.createElement('div');
      messageEl.className = 'app-dialog-message';
      messageEl.textContent = message;

      textWrap.appendChild(titleEl);
      if (message) textWrap.appendChild(messageEl);
      head.appendChild(icon);
      head.appendChild(textWrap);

      const actions = document.createElement('div');
      actions.className = 'app-dialog-actions';

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'app-dialog-btn ghost';
      cancelBtn.textContent = cancelText;

      const confirmBtn = document.createElement('button');
      confirmBtn.type = 'button';
      confirmBtn.className = `app-dialog-btn ${danger ? 'danger' : 'primary'}`;
      confirmBtn.textContent = confirmText;

      actions.appendChild(cancelBtn);
      actions.appendChild(confirmBtn);

      card.appendChild(head);
      card.appendChild(actions);
      overlay.appendChild(card);
      root.appendChild(overlay);

      let closed = false;
      const finish = (value) => {
        if (closed) return;
        closed = true;
        document.removeEventListener('keydown', onKeyDown, true);
        overlay.classList.remove('show');
        current = null;
        setTimeout(() => overlay.remove(), 200);
        resolve(value);
      };

      const onKeyDown = (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          finish(false);
          return;
        }
        if (event.key === 'Tab') {
          const focusables = [cancelBtn, confirmBtn];
          const index = focusables.indexOf(document.activeElement);
          const next = event.shiftKey
            ? (index <= 0 ? focusables.length - 1 : index - 1)
            : (index === focusables.length - 1 ? 0 : index + 1);
          event.preventDefault();
          focusables[next].focus();
        }
      };

      cancelBtn.addEventListener('click', () => finish(false));
      confirmBtn.addEventListener('click', () => finish(true));
      overlay.addEventListener('mousedown', (event) => {
        if (event.target === overlay) finish(false);
      });
      document.addEventListener('keydown', onKeyDown, true);

      current = { close: finish };
      requestAnimationFrame(() => overlay.classList.add('show'));
      // 危险操作默认聚焦“取消”，避免 Enter 误删
      (danger ? cancelBtn : confirmBtn).focus();
    });
  }

  window.appConfirm = appConfirm;
})();
