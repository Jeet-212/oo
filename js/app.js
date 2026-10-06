/* MUN Desk: UI controller. */
(() => {
  const $ = (s, root = document) => root.querySelector(s);

  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* storage unavailable */ } },
  };

  const DEFAULT_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro', 'gemini-2.0-flash'];
  const DEFAULT_SETTINGS = { apiKey: '', model: 'gemini-2.5-flash', temperature: 0.7, grounding: true, models: [] };
  const HISTORY_MAX = 40;

  let settings = { ...DEFAULT_SETTINGS, ...LS.get('mundesk.settings', {}) };
  let shared = LS.get('mundesk.shared', {}); // country/committee/agenda shared across modes
  let drafts = LS.get('mundesk.drafts', {}); // other field values, per mode
  let history = LS.get('mundesk.history', []);
  let current = LS.get('mundesk.current', { modeId: 'research', subId: null });

  let thread = null; // { id, key, title, messages: [{role, text, display?, sources?, note?}] }
  let busy = false;
  let controller = null;

  /* ---------- helpers ---------- */
  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of [].concat(children)) if (c != null) node.append(c);
    return node;
  }

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function md(text) {
    if (window.marked && window.DOMPurify) {
      const html = DOMPurify.sanitize(marked.parse(text || ''));
      return html;
    }
    return esc(text || '').replace(/\n/g, '<br>');
  }

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 2200);
  }

  const wordCount = (s) => (s.trim().match(/\S+/g) || []).length;

  function getMode(id = current.modeId) { return MODES.find((m) => m.id === id) || MODES[0]; }
  function getDef() {
    const mode = getMode();
    if (!mode.subs) return mode;
    return mode.subs.find((s) => s.id === current.subId) || mode.subs[0];
  }
  const keyOf = () => (getMode().subs ? `${current.modeId}/${getDef().id}` : current.modeId);
  function defByKey(key) {
    const [mid, sid] = key.split('/');
    const mode = getMode(mid);
    return { mode, def: mode.subs ? mode.subs.find((s) => s.id === sid) || mode.subs[0] : mode };
  }

  /* ---------- navigation ---------- */
  function renderNav() {
    const nav = $('#modeNav');
    nav.innerHTML = '';
    for (const m of MODES) {
      const btn = el('button', {
        type: 'button',
        class: `nav-item${m.id === current.modeId ? ' active' : ''}`,
        onclick: () => selectMode(m.id),
      }, [el('span', { class: 'nav-icon', text: m.icon }), el('span', { text: m.name })]);
      nav.append(btn);
      if (m.subs) {
        const subWrap = el('div', { class: 'nav-subs' });
        for (const s of m.subs) {
          subWrap.append(el('button', {
            type: 'button',
            class: `nav-sub${m.id === current.modeId && getDef().id === s.id ? ' active' : ''}`,
            text: s.name,
            onclick: () => selectMode(m.id, s.id),
          }));
        }
        nav.append(subWrap);
      }
    }
  }

  function selectMode(modeId, subId = null, keepThread = false) {
    if (busy) { toast('Wait for the current response to finish (or press Stop).'); return; }
    const mode = getMode(modeId);
    current = { modeId, subId: mode.subs ? (subId || (current.modeId === modeId && current.subId) || mode.subs[0].id) : null };
    LS.set('mundesk.current', current);
    if (!keepThread) thread = null;
    closeSidebar();
    renderAll();
  }

  function renderAll() {
    renderNav();
    renderHeader();
    renderForm();
    renderThread();
    renderComposer();
    renderHistory();
    renderKeyState();
  }

  function renderHeader() {
    const mode = getMode();
    const def = getDef();
    $('#modeTitle').textContent = `${mode.icon} ${mode.name}${mode.subs ? ` · ${def.name}` : ''}`;
    $('#topbarTitle').textContent = mode.name;
    $('#modeDesc').textContent = mode.subs ? def.desc : mode.desc;
    const tabs = $('#subTabs');
    tabs.innerHTML = '';
    tabs.hidden = !mode.subs;
    if (mode.subs) {
      for (const s of mode.subs) {
        tabs.append(el('button', {
          type: 'button', role: 'tab',
          class: `tab${s.id === def.id ? ' active' : ''}`,
          'aria-selected': s.id === def.id ? 'true' : 'false',
          text: s.name,
          onclick: () => selectMode(mode.id, s.id),
        }));
      }
    }
  }

  /* ---------- form ---------- */
  function fieldValue(f, key) {
    if (f.shared && shared[f.id] != null) return shared[f.id];
    const d = drafts[key] || {};
    if (d[f.id] != null) return d[f.id];
    return f.default || '';
  }

  function renderForm() {
    const def = getDef();
    const card = $('#formCard');
    const form = $('#modeForm');
    form.innerHTML = '';
    if (getMode().chat) { card.hidden = true; return; }
    card.hidden = false;
    card.open = !thread;
    const key = keyOf();

    for (const f of def.fields) {
      const id = `f_${f.id}`;
      let input;
      if (f.type === 'textarea') {
        input = el('textarea', { id, name: f.id, rows: f.rows || 3, placeholder: f.placeholder || '' });
        input.value = fieldValue(f, key);
      } else if (f.type === 'select') {
        input = el('select', { id, name: f.id }, f.options.map((o) => el('option', { value: o, text: /^\d+$/.test(o) && /time/i.test(f.label) ? `${o} seconds` : o })));
        input.value = fieldValue(f, key) || f.default;
      } else {
        input = el('input', { id, name: f.id, type: 'text', placeholder: f.placeholder || '' });
        input.value = fieldValue(f, key);
      }
      input.addEventListener('input', () => saveField(f, key, input.value));
      input.addEventListener('change', () => saveField(f, key, input.value));
      form.append(el('label', { class: `field${f.full ? ' full' : ''}`, for: id }, [
        el('span', {}, [f.label, f.required ? el('b', { class: 'req', text: ' *' }) : null]),
        input,
      ]));
    }

    form.append(el('div', { class: 'form-actions full' }, [
      el('button', { class: 'btn btn-primary', type: 'submit', id: 'generateBtn', text: busy ? 'Generating…' : def.cta }),
      el('span', { class: 'muted small', text: 'Country, committee & agenda are remembered across modes.' }),
    ]));
    updateFormSummary();
  }

  function saveField(f, key, value) {
    if (f.shared) { shared[f.id] = value; LS.set('mundesk.shared', shared); }
    else { drafts[key] = { ...(drafts[key] || {}), [f.id]: value }; LS.set('mundesk.drafts', drafts); }
    updateFormSummary();
  }

  function collectValues() {
    const def = getDef();
    const v = {};
    for (const f of def.fields) v[f.id] = ($(`#f_${f.id}`) || {}).value || '';
    return v;
  }

  function summarize(def, v) {
    return def.fields
      .filter((f) => f.id !== 'extra' && f.type !== 'select' && v[f.id])
      .slice(0, 3)
      .map((f) => v[f.id].trim().replace(/\s+/g, ' '))
      .join(' · ');
  }

  function updateFormSummary() {
    if (getMode().chat) return;
    const s = summarize(getDef(), collectValues());
    $('#formSummary').textContent = s.length > 80 ? `${s.slice(0, 80)}…` : s;
  }

  function onSubmitForm(e) {
    e.preventDefault();
    if (busy) return;
    const def = getDef();
    const v = collectValues();
    const missing = def.fields.filter((f) => f.required && !v[f.id].trim());
    document.querySelectorAll('.field.invalid').forEach((n) => n.classList.remove('invalid'));
    if (missing.length) {
      missing.forEach((f) => $(`#f_${f.id}`).closest('.field').classList.add('invalid'));
      $(`#f_${missing[0].id}`).focus();
      toast(`Please fill in: ${missing.map((f) => f.label).join(', ')}`);
      return;
    }
    if (!requireKey()) return;
    const display = `${def.name} — ${summarize(def, v)}`;
    thread = { id: Date.now().toString(36), key: keyOf(), title: display, createdAt: Date.now(), messages: [] };
    thread.messages.push({ role: 'user', text: def.build(v), display });
    $('#formCard').open = false;
    renderThread();
    renderComposer();
    run();
  }

  /* ---------- thread ---------- */
  function renderThread() {
    const box = $('#thread');
    box.innerHTML = '';
    const mode = getMode();
    if (!thread || !thread.messages.length) {
      if (mode.chat) box.append(welcomeEl(mode));
      return;
    }
    thread.messages.forEach((m, i) => box.append(messageEl(m, i)));
  }

  function welcomeEl(mode) {
    return el('div', { class: 'welcome' }, [
      el('p', { class: 'muted', text: 'Try one of these:' }),
      el('div', { class: 'suggestions' }, mode.suggestions.map((s) => el('button', {
        type: 'button', class: 'suggestion', text: s,
        onclick: () => {
          const input = $('#composerInput');
          input.value = s;
          autoGrow(input);
          input.focus();
          if (!s.endsWith(': ')) $('#composer').requestSubmit();
        },
      }))),
    ]);
  }

  function messageEl(m, i) {
    if (m.role === 'user') {
      return el('div', { class: 'msg user' }, [el('div', { class: 'bubble', text: m.display || m.text })]);
    }
    const body = el('div', { class: 'md' });
    body.innerHTML = md(m.text);
    const wc = wordCount(m.text || '');
    const isLast = i === thread.messages.length - 1;
    const tools = el('div', { class: 'msg-tools' }, [
      el('span', { class: 'muted small stat', text: wc ? `${wc} words · ~${Math.round((wc / WPM) * 60)}s spoken` : '' }),
      el('span', { class: 'spacer' }),
      el('button', { type: 'button', class: 'tool', text: 'Copy', onclick: () => copyText(m.text) }),
      el('button', { type: 'button', class: 'tool', text: 'Download', onclick: () => download(m.text) }),
      isLast ? el('button', { type: 'button', class: 'tool', text: 'Regenerate', onclick: regenerate }) : null,
    ]);
    const parts = [body];
    if (m.note) parts.unshift(el('div', { class: 'note', text: m.note }));
    if (m.error) parts.push(el('div', { class: 'error', text: m.error }));
    if (m.sources && m.sources.length) {
      parts.push(el('details', { class: 'sources' }, [
        el('summary', { text: `Sources (${m.sources.length})` }),
        el('ol', {}, m.sources.map((s) => el('li', {}, el('a', { href: s.uri, target: '_blank', rel: 'noopener', text: s.title })))),
      ]));
    }
    if (m.text) parts.push(tools);
    return el('article', { class: 'msg model card' }, parts);
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); toast('Copied to clipboard'); }
    catch (_) { toast('Copy failed: select the text manually'); }
  }

  function download(text) {
    const name = (thread && thread.title ? thread.title : 'mun-desk').replace(/[^\w\- ]+/g, '').trim().slice(0, 60).replace(/\s+/g, '-') || 'mun-desk';
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
    const a = el('a', { href: url, download: `${name}.md` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function regenerate() {
    if (busy || !thread) return;
    if (thread.messages[thread.messages.length - 1].role === 'model') thread.messages.pop();
    renderThread();
    run();
  }

  /* ---------- model call ---------- */
  function requireKey() {
    if (settings.apiKey) return true;
    openSettings('Add your free Gemini API key first.');
    return false;
  }

  async function run() {
    const { mode, def } = defByKey(thread.key);
    const useSearch = settings.grounding && !!(def.grounding || mode.grounding);
    const contents = thread.messages
      .filter((m) => m.text)
      .map((m) => ({ role: m.role, text: m.text }));
    const msg = { role: 'model', text: '' };
    thread.messages.push(msg);
    renderThread();
    const node = $('#thread').lastElementChild;
    const body = node.querySelector('.md') || node.appendChild(el('div', { class: 'md' }));
    body.innerHTML = '<div class="typing"><span></span><span></span><span></span></div>';
    node.scrollIntoView({ behavior: 'smooth', block: 'start' });

    setBusy(true);
    controller = new AbortController();
    let frame = 0;
    const onText = (t) => {
      msg.text = t;
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; body.innerHTML = md(msg.text); });
    };
    const call = (grounding) => Gemini.stream({
      apiKey: settings.apiKey,
      model: settings.model,
      system: def.system,
      messages: contents,
      grounding,
      temperature: settings.temperature,
      onText,
      signal: controller.signal,
    });

    try {
      let res;
      try {
        res = await call(useSearch);
      } catch (err) {
        // Search grounding isn't available on every model/key; retry without it.
        if (!useSearch || err.name === 'AbortError' || msg.text || /API key/i.test(err.message)) throw err;
        msg.note = 'Live Google Search was unavailable for this request, so this answer comes from the model\'s own knowledge. Verify key facts.';
        res = await call(false);
      }
      msg.text = res.text;
      msg.sources = res.sources;
      if (!res.text) msg.error = `The model returned an empty response${res.finishReason ? ` (${res.finishReason})` : ''}. Try Regenerate or rephrase.`;
      else if (res.finishReason === 'MAX_TOKENS') msg.note = 'The response hit the length limit. Ask "continue" to get the rest.';
    } catch (err) {
      if (err.name === 'AbortError') {
        if (!msg.text) msg.error = 'Stopped.';
      } else {
        msg.error = Gemini.friendly(err);
      }
    } finally {
      if (frame) cancelAnimationFrame(frame);
      controller = null;
      setBusy(false);
      renderThread();
      saveThread();
    }
  }

  function setBusy(b) {
    busy = b;
    const send = $('#sendBtn');
    send.textContent = b ? 'Stop' : 'Send';
    send.classList.toggle('btn-danger', b);
    const gen = $('#generateBtn');
    if (gen) { gen.disabled = b; gen.textContent = b ? 'Generating…' : getDef().cta; }
    document.body.classList.toggle('busy', b);
  }

  /* ---------- composer (follow-ups / quick chat) ---------- */
  function renderComposer() {
    const mode = getMode();
    const def = getDef();
    const composer = $('#composer');
    const show = mode.chat || (thread && thread.messages.length > 0);
    composer.hidden = !show;
    $('#composerInput').placeholder = mode.chat ? 'Ask anything about MUN…' : 'Refine it, e.g. "cut to 45 seconds"';
    const chips = $('#refineChips');
    chips.innerHTML = '';
    const list = mode.chat ? [] : def.refine || [];
    if (thread && thread.messages.length) {
      for (const r of list) {
        chips.append(el('button', { type: 'button', class: 'chip', text: r, onclick: () => sendFollowup(r) }));
      }
    }
    chips.hidden = !chips.childElementCount;
    $('#newBtn').hidden = !(thread && thread.messages.length);
  }

  function sendFollowup(text) {
    text = text.trim();
    if (!text || busy) return;
    if (!requireKey()) return;
    const last = thread && thread.messages[thread.messages.length - 1];
    if (last && last.role === 'model' && !last.text) thread.messages.pop(); // drop a failed reply
    if (!thread) {
      thread = { id: Date.now().toString(36), key: keyOf(), title: text, createdAt: Date.now(), messages: [] };
    }
    thread.messages.push({ role: 'user', text });
    $('#composerInput').value = '';
    autoGrow($('#composerInput'));
    renderThread();
    renderComposer();
    run();
  }

  function autoGrow(t) {
    t.style.height = 'auto';
    t.style.height = `${Math.min(t.scrollHeight, 180)}px`;
  }

  /* ---------- history ---------- */
  function saveThread() {
    if (!thread || !thread.messages.some((m) => m.role === 'model' && m.text)) return;
    history = [{ ...thread, updatedAt: Date.now() }, ...history.filter((h) => h.id !== thread.id)].slice(0, HISTORY_MAX);
    LS.set('mundesk.history', history);
    renderHistory();
  }

  function renderHistory() {
    const list = $('#historyList');
    list.innerHTML = '';
    if (!history.length) {
      list.append(el('li', { class: 'muted small empty', text: 'Your generations will appear here.' }));
    }
    for (const h of history) {
      const { mode } = defByKey(h.key);
      list.append(el('li', { class: `history-item${thread && thread.id === h.id ? ' active' : ''}` }, [
        el('button', {
          type: 'button', class: 'history-open', title: h.title,
          onclick: () => openHistory(h.id),
        }, [el('span', { class: 'nav-icon', text: mode.icon }), el('span', { class: 'history-title', text: h.title })]),
        el('button', {
          type: 'button', class: 'history-del', 'aria-label': 'Delete', text: '×',
          onclick: () => { history = history.filter((x) => x.id !== h.id); LS.set('mundesk.history', history); if (thread && thread.id === h.id) { thread = null; renderAll(); } else renderHistory(); },
        }),
      ]));
    }
  }

  function openHistory(id) {
    if (busy) { toast('Wait for the current response to finish.'); return; }
    const h = history.find((x) => x.id === id);
    if (!h) return;
    const [modeId, subId] = h.key.split('/');
    thread = JSON.parse(JSON.stringify(h));
    selectMode(modeId, subId || null, true);
  }

  /* ---------- settings ---------- */
  function renderKeyState() {
    $('#keyBanner').hidden = !!settings.apiKey;
    $('#modelPill').textContent = settings.model;
  }

  function fillModelList() {
    const dl = $('#modelList');
    dl.innerHTML = '';
    const all = [...new Set([...DEFAULT_MODELS, ...(settings.models || [])])];
    for (const m of all) dl.append(el('option', { value: m }));
  }

  function openSettings(message) {
    $('#setKey').value = settings.apiKey;
    $('#setKey').type = 'password';
    $('#toggleKey').textContent = 'Show';
    $('#setModel').value = settings.model;
    $('#setTemp').value = settings.temperature;
    $('#tempOut').textContent = settings.temperature;
    $('#setGrounding').checked = settings.grounding;
    fillModelList();
    $('#settingsDialog').returnValue = '';
    $('#settingsDialog').showModal();
    if (message) toast(message);
    if (!settings.apiKey) $('#setKey').focus();
  }

  function saveSettings() {
    settings.apiKey = $('#setKey').value.trim();
    settings.model = $('#setModel').value.trim().replace(/^models\//, '') || DEFAULT_SETTINGS.model;
    settings.temperature = parseFloat($('#setTemp').value);
    settings.grounding = $('#setGrounding').checked;
    LS.set('mundesk.settings', settings);
    renderKeyState();
    toast('Settings saved');
  }

  async function loadModels() {
    const key = $('#setKey').value.trim();
    const status = $('#modelStatus');
    if (!key) { status.textContent = 'Paste your API key first.'; return; }
    status.textContent = 'Checking your key…';
    try {
      const models = await Gemini.listModels(key);
      settings.models = models;
      LS.set('mundesk.settings', settings);
      fillModelList();
      status.textContent = `✓ Key works. ${models.length} models available: click the Model box to pick one.`;
    } catch (err) {
      status.textContent = `✗ ${Gemini.friendly(err)}`;
    }
  }

  /* ---------- mobile sidebar ---------- */
  function closeSidebar() { $('#sidebar').classList.remove('open'); $('#scrim').classList.remove('show'); }

  /* ---------- wire up ---------- */
  function init() {
    if (window.marked) marked.setOptions({ gfm: true, breaks: false });

    $('#modeForm').addEventListener('submit', onSubmitForm);
    $('#composer').addEventListener('submit', (e) => {
      e.preventDefault();
      if (busy) { controller && controller.abort(); return; }
      sendFollowup($('#composerInput').value);
    });
    const input = $('#composerInput');
    input.addEventListener('input', () => autoGrow(input));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!busy) $('#composer').requestSubmit(); }
    });
    $('#newBtn').addEventListener('click', () => {
      if (busy) return;
      thread = null;
      renderAll();
      if (!getMode().chat) $('#formCard').open = true;
    });

    $('#openSettings').addEventListener('click', () => openSettings());
    $('#bannerSettings').addEventListener('click', () => openSettings());
    $('#modelPill').addEventListener('click', () => openSettings());
    $('#toggleKey').addEventListener('click', () => {
      const k = $('#setKey');
      k.type = k.type === 'password' ? 'text' : 'password';
      $('#toggleKey').textContent = k.type === 'password' ? 'Show' : 'Hide';
    });
    $('#setTemp').addEventListener('input', (e) => { $('#tempOut').textContent = e.target.value; });
    $('#loadModels').addEventListener('click', loadModels);
    $('#settingsDialog').addEventListener('close', () => {
      if ($('#settingsDialog').returnValue === 'save') saveSettings();
    });

    $('#clearHistory').addEventListener('click', () => {
      if (!history.length || !confirm('Clear all recent generations?')) return;
      history = [];
      LS.set('mundesk.history', history);
      renderHistory();
    });

    $('#menuBtn').addEventListener('click', () => { $('#sidebar').classList.add('open'); $('#scrim').classList.add('show'); });
    $('#scrim').addEventListener('click', closeSidebar);

    renderAll();
  }

  init();
})();
