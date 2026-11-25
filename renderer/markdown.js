'use strict';

(() => {
  const TOKEN_START = '\u0001';
  const TOKEN_END = '\u0001';

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => {
      switch (ch) {
        case '&':
          return '&amp;';
        case '<':
          return '&lt;';
        case '>':
          return '&gt;';
        case '"':
          return '&quot;';
        default:
          return '&#39;';
      }
    });
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/\n/g, '&#10;');
  }

  function normalizeUrl(raw) {
    let url = String(raw || '').trim().replace(/^<|>$/g, '');
    if (!url) return '';
    if (/^https?:\/\//i.test(url)) return url;
    if (/^mailto:/i.test(url)) return url;
    if (/^file:\/\//i.test(url)) return url;
    if (/^www\./i.test(url)) return `https://${url}`;
    return '';
  }

  function linkHtml(url, label) {
    return `<a href="#" class="md-link" data-href="${escapeAttr(url)}">${escapeHtml(label)}</a>`;
  }

  function fileHtml(filePath) {
    return `<span class="file-link" data-file-path="${escapeAttr(filePath)}" title="点击用默认程序打开（Alt+点击定位文件）">${escapeHtml(filePath)}</span>`;
  }

  function render(src, options = {}) {
    const collapsible = options.collapsible !== false;
    const store = [];
    function put(html, block = false) {
      store.push({ html, block });
      return `${TOKEN_START}${store.length - 1}${TOKEN_END}`;
    }

    let text = String(src == null ? '' : src).replace(/\r\n/g, '\n');

    // 1. fenced code
    text = text.replace(/```([^\n`]*)\n?([\s\S]*?)(?:```|$)/g, (m, lang, code) => {
      const language = String(lang || '').trim().split(/\s+/)[0];
      const cleanCode = String(code || '').replace(/\n$/, '');
      const lines = cleanCode ? cleanCode.split('\n').length : 0;
      const longCode = lines > 12 || cleanCode.length > 700;
      const collapsed = collapsible && longCode;
      const previewLine = (cleanCode.split('\n').find((line) => line.trim()) || '').trim();
      const preview = previewLine.length > 96 ? `${previewLine.slice(0, 96)}…` : previewLine;
      const langLabel = `${escapeHtml(language || 'code')}${lines ? ` · ${lines} 行` : ''}`;
      const toggle = collapsible
        ? `<button class="code-toggle" type="button" aria-expanded="${collapsed ? 'false' : 'true'}">${
            collapsed ? '展开' : '收起'
          }</button>`
        : '';
      const previewHtml = collapsible && preview ? `<div class="code-preview">${escapeHtml(preview)}</div>` : '';

      return put(
        `<div class="code-block${collapsed ? ' collapsed' : ''}"><div class="code-head"><span class="code-lang">${langLabel}</span><span class="code-actions"><button class="copy-code" data-code="${escapeAttr(
          cleanCode
        )}">复制</button>${toggle}</span></div>${previewHtml}<pre><code>${escapeHtml(
          cleanCode
        )}</code></pre></div>`,
        true
      );
    });

    // 2. inline code
    text = text.replace(/`([^`\n]+)`/g, (m, code) => put(`<code>${escapeHtml(code)}</code>`));

    // 3. markdown links
    text = text.replace(/\[([^\]]*)\]\(([^)\s]+)\)/g, (m, label, url) => {
      const normalized = normalizeUrl(url);
      if (!normalized) return `${label}（${url}）`;
      return put(linkHtml(normalized, label || normalized));
    });

    // 4. bare URLs
    text = text.replace(/\b(https?:\/\/[^\s<>"'）】)，。；、\u0001]+)/g, (m, url) => {
      const clean = url.replace(/[.,;:!?]+$/, '');
      const tail = url.slice(clean.length);
      return put(linkHtml(clean, clean)) + tail;
    });

    // 5. local Windows / UNC paths
    text = text.replace(/(?:[A-Za-z]:\\[^\s<>"|?*\u0001]+|\\\\[^\s<>"|?*\u0001]+)/g, (m) => {
      const clean = m.replace(/[，。；：、,.!?;:)）\]】"'`]+$/, '');
      const tail = m.slice(clean.length);
      if (!clean || clean.length < 4) return m;
      return put(fileHtml(clean)) + tail;
    });

    // 6. escape + emphasis
    text = escapeHtml(text);
    text = text.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
    text = text.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');

    // 7. block structure
    const lines = text.split('\n');
    const out = [];
    let para = [];
    let list = null;

    const flushPara = () => {
      if (para.length) {
        out.push(`<p>${para.join('<br>')}</p>`);
        para = [];
      }
    };
    const flushList = () => {
      if (list) {
        const tag = list.type === 'ol' ? 'ol' : 'ul';
        out.push(`<${tag}>${list.items.map((item) => `<li>${item}</li>`).join('')}</${tag}>`);
        list = null;
      }
    };

    for (const rawLine of lines) {
      const line = rawLine.replace(/\s+$/, '');
      const tokenOnly = line.match(/^\u0001(\d+)\u0001$/);
      if (tokenOnly) {
        const item = store[Number(tokenOnly[1])];
        if (item && item.block) {
          flushPara();
          flushList();
          out.push(item.html);
          continue;
        }
      }

      if (!line.trim()) {
        flushPara();
        flushList();
        continue;
      }

      const heading = line.match(/^(#{1,4})\s+(.*)$/);
      if (heading) {
        flushPara();
        flushList();
        const level = Math.min(3, heading[1].length) + 2;
        out.push(`<h${level}>${heading[2]}</h${level}>`);
        continue;
      }

      if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
        flushPara();
        flushList();
        out.push('<hr>');
        continue;
      }

      if (/^>\s?/.test(line)) {
        flushPara();
        flushList();
        out.push(`<blockquote>${line.replace(/^>\s?/, '')}</blockquote>`);
        continue;
      }

      const ul = line.match(/^[-*•]\s+(.*)$/);
      if (ul) {
        flushPara();
        if (!list || list.type !== 'ul') {
          flushList();
          list = { type: 'ul', items: [] };
        }
        list.items.push(ul[1]);
        continue;
      }

      const ol = line.match(/^\d+[.)]\s+(.*)$/);
      if (ol) {
        flushPara();
        if (!list || list.type !== 'ol') {
          flushList();
          list = { type: 'ol', items: [] };
        }
        list.items.push(ol[1]);
        continue;
      }

      flushList();
      para.push(line);
    }
    flushPara();
    flushList();

    return out.join('').replace(/\u0001(\d+)\u0001/g, (m, idx) => {
      const item = store[Number(idx)];
      return item ? item.html : '';
    });
  }

  window.renderMarkdown = render;
  window.escapeHtml = escapeHtml;
})();
