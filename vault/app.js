/*
 * app.js — shared script for index.html (login) and dashboard.html.
 * Each page sets <body data-page="..."> so we know which part to run.
 */
(function () {
  'use strict';

  /* ===================== Config ===================== */

  const AUTH_KEY = 'hx_auth';        // sessionStorage flag set after login
  const VAULT_KEY = 'hx_vault_v1';   // localStorage key for snippets

  const VALID_USER = 'Amzar';
  // SHA-256 of the password. The plaintext password is never stored here.
  const PASSWORD_HASH = '541df2ecf2466b3cc4acdecb5b9f7154b1a91176a5b6d673a7d651e4b91c134b';

  // Snippets used the first time the vault is opened (or if storage is empty).
  const DEFAULT_SNIPPETS = [
    { title: 'Start Claude via Headroom', label: 'powershell', code: 'headroom wrap claude' },
    { title: 'Diagnose Headroom setup',   label: 'powershell', code: 'headroom doctor' },
    { title: 'Check token savings',       label: 'powershell', code: 'headroom perf' },
    { title: 'Open visual dashboard',     label: 'powershell', code: 'headroom dashboard' },
    { title: 'Run proxy on port 8787',    label: 'powershell', code: 'headroom proxy --port 8787' }
  ];

  /* ===================== Helpers ===================== */

  /** Returns the hex SHA-256 digest of a string (Web Crypto API). */
  async function sha256Hex(text) {
    const data = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }

  function isLoggedIn() {
    try { return sessionStorage.getItem(AUTH_KEY) === '1'; }
    catch (e) { return false; }
  }

  /** Copies text to the clipboard, with a fallback for older browsers. */
  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (err) { ok = false; }
      ta.remove();
      return ok;
    }
  }

  /** Copies and briefly changes the button label as feedback. */
  async function copyWithFeedback(btn, text) {
    const ok = await copyText(text);
    const original = btn.textContent;
    btn.textContent = ok ? 'Copied!' : 'Copy failed';
    setTimeout(() => { btn.textContent = original; }, 1400);
  }

  function makeId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /* ===================== Login page ===================== */

  function initLogin() {
    // Already logged in this session? Skip straight to the dashboard.
    if (isLoggedIn()) {
      location.replace('dashboard.html');
      return;
    }

    const form = document.getElementById('login-form');
    const errorEl = document.getElementById('login-error');

    function showError(msg) {
      errorEl.textContent = msg;
      errorEl.hidden = false;
    }

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      errorEl.hidden = true;

      const username = form.username.value.trim();
      const password = form.password.value;

      if (!username || !password) {
        showError('Please enter both username and password.');
        return;
      }

      if (!window.crypto || !crypto.subtle) {
        showError('Your browser does not support secure login (Web Crypto). Use HTTPS or a modern browser.');
        return;
      }

      const hash = await sha256Hex(password);

      if (username === VALID_USER && hash === PASSWORD_HASH) {
        try {
          sessionStorage.setItem(AUTH_KEY, '1');
        } catch (e) {
          showError('Could not save your session (storage blocked).');
          return;
        }
        location.href = 'dashboard.html';
      } else {
        showError('Incorrect username or password.');
        form.password.value = '';
        form.password.focus();
      }
    });
  }

  /* ===================== Dashboard page ===================== */

  function initDashboard() {
    // Second guard (the inline <head> script is the first).
    if (!isLoggedIn()) {
      location.replace('index.html');
      return;
    }

    document.getElementById('logout-btn').addEventListener('click', () => {
      try { sessionStorage.removeItem(AUTH_KEY); } catch (e) { /* ignore */ }
      location.replace('index.html');
    });

    // Static copy buttons in the guide (data-copy holds the text).
    document.querySelectorAll('[data-copy]').forEach(btn => {
      btn.addEventListener('click', () => copyWithFeedback(btn, btn.dataset.copy));
    });

    initVault();
  }

  /* ===================== Code Vault ===================== */

  function initVault() {
    const form = document.getElementById('snippet-form');
    const idInput = document.getElementById('snippet-id');
    const titleInput = document.getElementById('snippet-title');
    const labelInput = document.getElementById('snippet-label');
    const codeInput = document.getElementById('snippet-code');
    const saveBtn = document.getElementById('save-btn');
    const cancelBtn = document.getElementById('cancel-edit-btn');
    const searchInput = document.getElementById('search');
    const listEl = document.getElementById('snippet-list');
    const statusEl = document.getElementById('vault-status');
    const exportBtn = document.getElementById('export-btn');
    const importInput = document.getElementById('import-file');

    let snippets = loadSnippets();

    /* ---- Storage ---- */

    function loadSnippets() {
      try {
        const raw = localStorage.getItem(VAULT_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) return parsed.filter(isValidSnippet);
        }
      } catch (e) {
        console.warn('Vault: could not read localStorage', e);
      }
      // First run (or unreadable data): seed with defaults.
      return DEFAULT_SNIPPETS.map(s => ({ ...s, id: makeId(), updated: Date.now() }));
    }

    function saveSnippets() {
      try {
        localStorage.setItem(VAULT_KEY, JSON.stringify(snippets));
        return true;
      } catch (e) {
        setStatus('Warning: could not save to browser storage. Export a backup!');
        return false;
      }
    }

    function isValidSnippet(s) {
      return s && typeof s.title === 'string' && typeof s.code === 'string';
    }

    function setStatus(msg) {
      statusEl.textContent = msg;
    }

    /* ---- Rendering ---- */

    function render() {
      const q = searchInput.value.trim().toLowerCase();
      const visible = snippets.filter(s =>
        !q ||
        s.title.toLowerCase().includes(q) ||
        (s.label || '').toLowerCase().includes(q) ||
        s.code.toLowerCase().includes(q)
      );

      listEl.replaceChildren();

      if (visible.length === 0) {
        const empty = document.createElement('li');
        empty.className = 'muted';
        empty.textContent = q ? 'No snippets match your search.' : 'No snippets yet. Add one above.';
        listEl.appendChild(empty);
        return;
      }

      // Build with textContent only, so saved code is never interpreted as HTML.
      visible.forEach(s => listEl.appendChild(renderSnippet(s)));
    }

    function renderSnippet(s) {
      const li = document.createElement('li');
      li.className = 'snippet';

      const head = document.createElement('div');
      head.className = 'snippet-head';

      const title = document.createElement('span');
      title.className = 'snippet-title';
      title.textContent = s.title;
      head.appendChild(title);

      if (s.label) {
        const tag = document.createElement('span');
        tag.className = 'tag';
        tag.textContent = s.label;
        head.appendChild(tag);
      }

      head.appendChild(makeButton('Copy', '', btn => copyWithFeedback(btn, s.code)));
      head.appendChild(makeButton('Edit', '', () => startEdit(s.id)));
      head.appendChild(makeButton('Delete', 'btn-danger', () => removeSnippet(s.id)));

      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = s.code;
      pre.appendChild(code);

      li.append(head, pre);
      return li;
    }

    function makeButton(text, extraClass, onClick) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = ('btn btn-small btn-ghost ' + extraClass).trim();
      btn.textContent = text;
      btn.addEventListener('click', () => onClick(btn));
      return btn;
    }

    /* ---- Add / edit / delete ---- */

    function resetForm() {
      form.reset();
      idInput.value = '';
      saveBtn.textContent = 'Add snippet';
      cancelBtn.hidden = true;
    }

    function startEdit(id) {
      const s = snippets.find(x => x.id === id);
      if (!s) return;
      idInput.value = s.id;
      titleInput.value = s.title;
      labelInput.value = s.label || '';
      codeInput.value = s.code;
      saveBtn.textContent = 'Save changes';
      cancelBtn.hidden = false;
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      titleInput.focus();
    }

    function removeSnippet(id) {
      const s = snippets.find(x => x.id === id);
      if (!s || !confirm('Delete "' + s.title + '"?')) return;
      snippets = snippets.filter(x => x.id !== id);
      if (idInput.value === id) resetForm();
      saveSnippets();
      setStatus('Snippet deleted.');
      render();
    }

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const title = titleInput.value.trim();
      const label = labelInput.value.trim();
      const code = codeInput.value;

      if (!title || !code.trim()) {
        setStatus('Title and code are required.');
        return;
      }

      const editingId = idInput.value;
      if (editingId) {
        snippets = snippets.map(s =>
          s.id === editingId ? { ...s, title, label, code, updated: Date.now() } : s
        );
        setStatus('Snippet updated.');
      } else {
        snippets.unshift({ id: makeId(), title, label, code, updated: Date.now() });
        setStatus('Snippet added.');
      }

      saveSnippets();
      resetForm();
      render();
    });

    cancelBtn.addEventListener('click', resetForm);
    searchInput.addEventListener('input', render);

    /* ---- Export / import ---- */

    exportBtn.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(snippets, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'code-vault-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStatus('Exported ' + snippets.length + ' snippet(s).');
    });

    importInput.addEventListener('change', () => {
      const file = importInput.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          if (!Array.isArray(data)) throw new Error('Expected a JSON array.');

          // Merge: imported snippets with an existing id replace it; others are added.
          let added = 0, replaced = 0;
          data.filter(isValidSnippet).forEach(item => {
            const clean = {
              id: typeof item.id === 'string' && item.id ? item.id : makeId(),
              title: item.title,
              label: typeof item.label === 'string' ? item.label : '',
              code: item.code,
              updated: Number(item.updated) || Date.now()
            };
            const idx = snippets.findIndex(s => s.id === clean.id);
            if (idx >= 0) { snippets[idx] = clean; replaced++; }
            else { snippets.push(clean); added++; }
          });

          saveSnippets();
          render();
          setStatus('Import done: ' + added + ' added, ' + replaced + ' updated.');
        } catch (e) {
          setStatus('Import failed: ' + e.message);
        } finally {
          importInput.value = ''; // allow re-importing the same file
        }
      };
      reader.onerror = () => setStatus('Could not read the file.');
      reader.readAsText(file);
    });

    /* ---- First paint ---- */
    saveSnippets(); // persists the seeded defaults on first run
    render();
  }

  /* ===================== Boot ===================== */

  const page = document.body.dataset.page;
  if (page === 'login') initLogin();
  else if (page === 'dashboard') initDashboard();
})();
