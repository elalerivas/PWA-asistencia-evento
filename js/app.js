/* Control de Ingreso — PWA para registrar ingresos a un evento leyendo QR.
   Todo se guarda en el dispositivo (localStorage + IndexedDB para la imagen de fondo).
   Las librerías pesadas (SheetJS, jsPDF, html2canvas, jsQR) se cargan a demanda desde /lib. */
(() => {
  'use strict';

  const APP_VERSION = '1.0.0';
  const STORAGE_KEY = 'controlIngreso.v1';
  const LIBS = {
    xlsx: { src: 'lib/xlsx.full.min.js', ready: () => window.XLSX },
    jspdf: { src: 'lib/jspdf.umd.min.js', ready: () => window.jspdf && window.jspdf.jsPDF },
    html2canvas: { src: 'lib/html2canvas.min.js', ready: () => window.html2canvas },
    jsqr: { src: 'lib/jsQR.js', ready: () => window.jsQR }
  };

  /* ---------- Utilidades ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
  const pad = (n) => String(n).padStart(2, '0');
  const norm = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const slug = (s) => (norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'evento').slice(0, 40);
  const hexToRgb = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(h) || [0, '000000']; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

  const fmtHM = (iso) => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const fmtHMS = (iso) => { const d = new Date(iso); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
  const fmtStamp = (iso) => { const d = new Date(iso); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${fmtHMS(iso)}`; };
  function fmtDay(ymd, long) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
    if (!m) return '';
    const d = new Date(+m[1], +m[2] - 1, +m[3]);
    const s = d.toLocaleDateString('es-AR', long ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' } : { day: 'numeric', month: 'long', year: 'numeric' });
    return long ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }
  const nowStamp = () => fmtStamp(new Date().toISOString());

  /* ---------- Estado ---------- */
  function defaultState() {
    return {
      v: 1,
      event: { name: '', date: '', place: '' },
      settings: { palette: 'vino', theme: 'auto', sound: true, volume: 0.7, vibrate: true, veil: 0.76, blur: 0, facing: 'environment' },
      headers: [], keyCol: -1, nameCols: [], fileName: '', importedAt: null,
      att: [], extras: [], log: [], iosHintClosed: false
    };
  }
  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw); const d = defaultState();
        return { ...d, ...s, event: { ...d.event, ...s.event }, settings: { ...d.settings, ...s.settings } };
      }
    } catch (e) { /* noop */ }
    return defaultState();
  }
  let state = loadState();
  let quotaWarned = false;
  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {
      if (!quotaWarned) { quotaWarned = true; toast('No hay espacio para guardar los datos. Exportá lo registrado ahora.'); }
    }
  }
  const ui = { tab: 'lista', filter: 'all', q: '', limit: 150, exFilter: 'pending' };
  let idx = null; let sIdx = null; // índices de búsqueda y de coincidencia (se reconstruyen al cambiar la lista)

  const findAtt = (id) => state.att.find((a) => a.id === id);
  const findExtra = (id) => state.extras.find((e) => e.id === id);

  function displayName(a) {
    const cols = state.nameCols.filter((c) => c < a.cells.length);
    const s = cols.map((c) => a.cells[c] || '').filter(Boolean).join(' ').trim();
    return s || a.cells.find(Boolean) || '(sin nombre)';
  }
  function subline(a) {
    const skip = new Set(state.nameCols); const parts = [];
    a.cells.forEach((c, i) => { if (c && !skip.has(i) && parts.length < 3) parts.push(c); });
    return parts.join(' · ');
  }
  function stats() {
    const total = state.att.length;
    const present = state.att.filter((a) => a.inAt).length;
    return {
      total, present, missing: total - present,
      pending: state.extras.filter((e) => e.status === 'pending').length,
      valid: state.extras.filter((e) => e.status === 'valid').length,
      rejected: state.extras.filter((e) => e.status === 'rejected').length
    };
  }
  function addLog(type, o) {
    const entry = { t: new Date().toISOString(), type, ...o };
    state.log.push(entry);
    return entry;
  }
  function removeLog(entry) { const i = state.log.indexOf(entry); if (i >= 0) state.log.splice(i, 1); }

  /* ---------- Coincidencia QR ↔ lista ---------- */
  function variants(v) {
    const n = norm(v); if (!n) return [];
    const out = new Set([n]);
    const alnum = n.replace(/[^a-z0-9]/g, '');
    if (alnum && alnum !== n && /\d/.test(alnum) && alnum.length >= 4) out.add(alnum);
    const digits = alnum || n;
    if (/^\d+$/.test(digits)) { const s = digits.replace(/^0+/, ''); if (s) out.add(s); }
    return [...out];
  }
  function buildIndex() {
    const map = new Map();
    const cols = state.keyCol >= 0 ? [state.keyCol] : state.headers.map((_, i) => i);
    state.att.forEach((a, i) => {
      const seen = new Set();
      cols.forEach((c) => variants(a.cells[c]).forEach((v) => {
        if (v.length < 2 || seen.has(v)) return;
        seen.add(v);
        if (!map.has(v)) map.set(v, []);
        map.get(v).push(i);
      }));
    });
    idx = { map, nameWords: state.att.map((a) => new Set(words(norm(displayName(a))))), keyed: state.keyCol >= 0 };
  }
  function payloadCandidates(raw) {
    const vals = new Set();
    const add = (v) => variants(v).forEach((x) => { if (x.length >= 2) vals.add(x); });
    const strs = [raw];
    if (/^[[{]/.test(raw)) {
      try { const walk = (o) => { if (o == null) return; if (typeof o === 'object') Object.values(o).forEach(walk); else strs.push(String(o)); }; walk(JSON.parse(raw)); } catch (e) { /* noop */ }
    }
    if (/^https?:\/\//i.test(raw)) {
      try {
        const u = new URL(raw);
        u.searchParams.forEach((v) => strs.push(v));
        u.pathname.split('/').filter(Boolean).forEach((p) => { try { strs.push(decodeURIComponent(p)); } catch (e) { strs.push(p); } });
        if (u.hash) strs.push(u.hash.replace(/^#/, ''));
      } catch (e) { /* noop */ }
    }
    strs.slice().forEach((s) => String(s).split(/[\r\n|;,\t]+/).forEach((p) => { strs.push(p); p.split(/[:=]/).forEach((q) => strs.push(q)); }));
    strs.forEach(add);
    String(raw).split(/[^\p{L}\p{N}_\-.]+/u).forEach((t) => { if (t.length >= 3 && /\d/.test(t)) add(t); });
    return { vals: [...vals], nraw: norm(raw) };
  }
  const words = (n) => n.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2);
  /** Devuelve { status: 'found'|'ambiguous'|'none', i, cands }.
      Criterio conservador: un dato suelto y común (un nombre de pila, "Socio", "Mesa 2") nunca alcanza para dar por válido a alguien. */
  function matchAttendee(raw) {
    if (!state.att.length) return { status: 'none' };
    if (!idx) buildIndex();
    const { vals, nraw } = payloadCandidates(raw);
    const score = new Map();
    const bump = (i, p) => score.set(i, (score.get(i) || 0) + p);
    vals.forEach((v) => {
      const hit = idx.map.get(v); if (!hit) return;
      if (idx.keyed) { hit.forEach((i) => bump(i, 10)); return; }
      if (hit.length === 1) bump(hit[0], /\d/.test(v) ? 10 : v.includes(' ') ? 6 : 4); // un código/DNI único vale; un nombre suelto, no
      else if (hit.length <= 60) hit.forEach((i) => bump(i, 1));
    });
    if (!idx.keyed) { // nombre y apellido escritos en cualquier orden
      const pw = new Set(words(nraw));
      if (pw.size >= 2) {
        idx.nameWords.forEach((nw, i) => {
          if (nw.size < 2) return;
          let all = true; nw.forEach((w) => { if (!pw.has(w)) all = false; });
          let sub = true; pw.forEach((w) => { if (!nw.has(w)) sub = false; });
          if (all || sub) bump(i, 8);
        });
      }
    }
    let best = 0; score.forEach((sc2) => { if (sc2 > best) best = sc2; });
    if (best < 8) return { status: 'none' };
    const top = [...score.entries()].filter(([, sc2]) => sc2 === best).map(([i]) => i);
    if (top.length === 1) return { status: 'found', i: top[0] };
    return { status: 'ambiguous', cands: top.slice(0, 8) };
  }

  /* ---------- Registro de ingresos ---------- */
  function markPresent(a, via) {
    a.inAt = new Date().toISOString(); a.via = via;
    const entry = addLog('in', { attId: a.id, label: displayName(a), via });
    saveState();
    return () => { a.inAt = null; a.via = null; removeLog(entry); saveState(); renderAll(); };
  }
  function unmarkPresent(a) {
    const prev = { inAt: a.inAt, via: a.via };
    a.inAt = null; a.via = null;
    const entry = addLog('mout', { attId: a.id, label: displayName(a) });
    saveState();
    return () => { a.inAt = prev.inAt; a.via = prev.via; removeLog(entry); saveState(); renderAll(); };
  }
  /** Procesa un código leído. No toca la interfaz. */
  function processScan(raw, via) {
    raw = String(raw == null ? '' : raw).trim();
    if (!raw) return null;
    const m = matchAttendee(raw);
    if (m.status === 'found') {
      const a = state.att[m.i];
      if (a.inAt) {
        const last = state.log[state.log.length - 1];
        const spam = last && last.type === 'dup' && last.attId === a.id && Date.now() - new Date(last.t).getTime() < 15000;
        if (!spam) { addLog('dup', { attId: a.id, label: displayName(a), firstAt: a.inAt, via }); saveState(); }
        return { kind: 'dup', att: a };
      }
      const undo = markPresent(a, via);
      return { kind: 'in', att: a, undo };
    }
    if (m.status === 'ambiguous') return { kind: 'ambiguous', raw, cands: m.cands.map((i) => state.att[i]), via };
    return registerUnlisted(raw, via);
  }
  function registerUnlisted(raw, via) {
    const key = norm(raw);
    const prev = state.extras.find((e) => norm(e.raw) === key);
    if (prev) { addLog('unl', { exId: prev.id, label: 'Lectura repetida de un código no listado', raw, again: true }); saveState(); return { kind: 'again', extra: prev }; }
    const ex = { id: uid(), raw, at: new Date().toISOString(), status: 'pending', via };
    state.extras.push(ex);
    const entry = addLog('unl', { exId: ex.id, label: 'No figura en la lista', raw });
    saveState();
    return { kind: 'unlisted', extra: ex, undo: () => { state.extras = state.extras.filter((e) => e !== ex); removeLog(entry); saveState(); renderAll(); } };
  }
  function setExtraStatus(ex, status) {
    const before = ex.status;
    if (before === status) return () => {};
    ex.status = status; ex.decidedAt = status === 'pending' ? null : new Date().toISOString();
    const entry = addLog(status === 'valid' ? 'val' : status === 'rejected' ? 'rej' : 'unl', { exId: ex.id, raw: ex.raw, label: status === 'valid' ? 'Ingreso válido (no listado)' : status === 'rejected' ? 'Ingreso rechazado (no listado)' : 'Vuelto a pendiente' });
    saveState();
    return () => { ex.status = before; removeLog(entry); saveState(); renderAll(); };
  }

  /* ---------- Sonido y vibración ---------- */
  let ac = null;
  function audio() {
    if (!ac) { const C = window.AudioContext || window.webkitAudioContext; if (C) { try { ac = new C(); } catch (e) { ac = null; } } }
    if (ac && ac.state === 'suspended') ac.resume().catch(() => {});
    return ac;
  }
  function tone(freq, t0, dur, type, vol) {
    const now = ac.currentTime + t0;
    const o = ac.createOscillator(); const g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, now);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), now + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    o.connect(g); g.connect(ac.destination);
    o.start(now); o.stop(now + dur + 0.03);
  }
  /** kind: ok | dup | bad | rej */
  function feedback(kind) {
    const s = state.settings;
    if (s.vibrate && navigator.vibrate) { try { navigator.vibrate({ ok: [40], dup: [70, 60, 70], bad: [220], rej: [320] }[kind]); } catch (e) { /* noop */ } }
    if (!s.sound) return;
    if (!audio()) return;
    const v = 0.55 * s.volume;
    if (kind === 'ok') { tone(784, 0, 0.12, 'sine', v); tone(1175, 0.11, 0.22, 'sine', v); }
    else if (kind === 'dup') { tone(523, 0, 0.12, 'triangle', v); tone(523, 0.18, 0.12, 'triangle', v); }
    else if (kind === 'bad') { tone(311, 0, 0.14, 'sawtooth', v * 0.55); tone(233, 0.15, 0.3, 'sawtooth', v * 0.55); }
    else if (kind === 'rej') { tone(165, 0, 0.45, 'square', v * 0.4); }
  }

  /* ---------- Imagen de fondo (IndexedDB) ---------- */
  function idbOpen() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('controlIngreso', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  async function idb(mode, fn) {
    const db = await idbOpen();
    return new Promise((res, rej) => {
      const tx = db.transaction('kv', mode); const req = fn(tx.objectStore('kv'));
      tx.oncomplete = () => { db.close(); res(req && req.result); }; tx.onerror = () => { db.close(); rej(tx.error); };
    });
  }
  const bgGet = () => idb('readonly', (s) => s.get('bg')).catch(() => null);
  const bgSet = (v) => idb('readwrite', (s) => s.put(v, 'bg'));
  const bgDel = () => idb('readwrite', (s) => s.delete('bg')).catch(() => {});
  function applyBg(dataUrl) {
    const layer = $('#bgLayer');
    if (dataUrl) { layer.style.backgroundImage = `url("${dataUrl}")`; document.body.classList.add('has-bg'); } else { layer.style.backgroundImage = ''; document.body.classList.remove('has-bg'); }
    applyBgLook();
  }
  function applyBgLook() {
    const r = document.documentElement.style;
    r.setProperty('--veil', String(state.settings.veil));
    r.setProperty('--bg-blur', `${state.settings.blur}px`);
  }
  async function shrinkImage(file) {
    let src; let revoke = null;
    try { src = await createImageBitmap(file); } catch (e) {
      src = await new Promise((res, rej) => { const u = URL.createObjectURL(file); revoke = u; const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error('No se pudo leer la imagen')); im.src = u; });
    }
    const w = src.width || src.naturalWidth; const h = src.height || src.naturalHeight;
    const k = Math.min(1, 1600 / Math.max(w, h));
    const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    if (revoke) URL.revokeObjectURL(revoke);
    return c.toDataURL('image/jpeg', 0.8);
  }

  /* ---------- Toast y hojas ---------- */
  let toastTimer;
  function toast(msg, action) {
    const t = $('#toast'); const b = $('#toastBtn');
    $('#toastMsg').textContent = msg;
    if (action) { b.hidden = false; b.textContent = action.label; b.onclick = () => { hideToast(); action.fn(); }; } else { b.hidden = true; b.onclick = null; }
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, action ? 6000 : 2800);
  }
  function hideToast() { $('#toast').hidden = true; }

  let sheetOnClose = null;
  function openSheet(html, onMount, onClose) {
    hideToast();
    const prev = $('#sheetBody'); const body = prev.cloneNode(false);
    prev.replaceWith(body);
    body.innerHTML = html;
    $('#sheet').hidden = false; $('#sheetBackdrop').hidden = false;
    $('#sheet').scrollTop = 0;
    document.body.style.overflow = 'hidden';
    sheetOnClose = onClose || null;
    if (onMount) onMount($('#sheetBody'));
  }
  function closeSheet() {
    if ($('#sheet').hidden) return;
    $('#sheet').hidden = true; $('#sheetBackdrop').hidden = true;
    document.body.style.overflow = $('#scanner').hidden ? '' : 'hidden';
    const cb = sheetOnClose; sheetOnClose = null;
    if (cb) cb();
  }
  function confirmSheet(title, text, okLabel = 'Aceptar', danger = false) {
    return new Promise((resolve) => {
      let answered = false;
      openSheet(`<h2>${esc(title)}</h2><p class="muted">${text}</p>
        <div class="sheet-actions"><button class="btn ghost" data-c="0">Cancelar</button><button class="btn ${danger ? 'danger' : 'primary'}" data-c="1">${esc(okLabel)}</button></div>`,
      (root) => root.addEventListener('click', (e) => {
        const b = e.target.closest('[data-c]'); if (!b) return;
        answered = true; closeSheet(); resolve(b.dataset.c === '1');
      }), () => { if (!answered) resolve(false); });
    });
  }

  /* ---------- Carga de librerías a demanda ---------- */
  const loading = {};
  function loadLib(key) {
    const lib = LIBS[key];
    if (lib.ready()) return Promise.resolve(lib.ready());
    if (!loading[key]) {
      loading[key] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = lib.src; s.async = true;
        s.onload = () => (lib.ready() ? resolve(lib.ready()) : reject(new Error('No se pudo iniciar ' + key)));
        s.onerror = () => { delete loading[key]; s.remove(); reject(new Error('No se pudo cargar un componente de la app. Probá con conexión.')); };
        document.head.appendChild(s);
      });
    }
    return loading[key];
  }

  /* ---------- Interfaz principal ---------- */
  const evSub = () => [fmtDay(state.event.date), state.event.place].filter(Boolean).join(' · ');

  function renderHeader() {
    $('#evName').textContent = state.event.name || 'Nuevo evento';
    const sub = evSub();
    $('#evSub').textContent = sub || 'Tocá para configurar fecha y lugar';
    document.title = state.event.name ? `${state.event.name} — Control de Ingreso` : 'Control de Ingreso';
  }
  function renderStats() {
    const s = stats();
    $('#stTotal').textContent = s.total; $('#stPresent').textContent = s.present;
    $('#stMissing').textContent = s.missing; $('#stPending').textContent = s.pending;
    $('#stPending').parentElement.classList.toggle('on', s.pending > 0);
    const pct = s.total ? Math.round((s.present / s.total) * 100) : 0;
    $('#progFill').style.width = pct + '%';
    $('#progress').setAttribute('aria-valuenow', pct);
    const extra = s.valid ? ` · <b>+${s.valid}</b> ${s.valid === 1 ? 'ingreso válido' : 'ingresos válidos'} fuera de lista` : '';
    $('#progTxt').innerHTML = s.total ? `<b>${pct} %</b> de la lista ya ingresó${extra}` : 'Todavía no hay lista de asistentes';
    const b = $('#tabBadge'); b.hidden = !s.pending; b.textContent = s.pending;
    const sc = $('#scCount');
    if (sc) sc.innerHTML = `${s.present} / ${s.total}<small>${s.pending ? plural(s.pending, 'por verificar', 'por verificar') : 'presentes'}</small>`;
  }
  function renderTabs() {
    $$('.tabs [data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === ui.tab)));
  }
  const searchIdx = () => { if (!sIdx) sIdx = state.att.map((a) => norm(a.cells.join(' '))); return sIdx; };

  function attRow(a) {
    const inn = !!a.inAt;
    return `<li><button class="item ${inn ? 'in' : 'out'}" data-att="${a.id}"><svg class="ic" width="26" height="26"><use href="#${inn ? 'i-check' : 'i-circle'}"/></svg>
      <span class="tx"><b>${esc(displayName(a))}</b><small>${esc(subline(a))}</small></span><span class="tm">${inn ? fmtHM(a.inAt) : ''}</span></button></li>`;
  }
  function listRows() {
    const q = norm(ui.q);
    let rows = state.att.map((a, i) => ({ a, i }));
    if (ui.filter === 'in') rows = rows.filter((r) => r.a.inAt).sort((x, y) => y.a.inAt.localeCompare(x.a.inAt));
    else if (ui.filter === 'out') rows = rows.filter((r) => !r.a.inAt);
    if (q) { const si = searchIdx(); rows = rows.filter((r) => si[r.i].includes(q)); }
    return rows;
  }
  function renderListBody() {
    const box = $('#listBody'); if (!box) return;
    const rows = listRows(); const shown = rows.slice(0, ui.limit);
    if (!rows.length) { box.innerHTML = `<div class="card empty"><p>${ui.q ? 'Nadie coincide con la búsqueda.' : ui.filter === 'in' ? 'Todavía no ingresó nadie.' : 'No falta nadie. ¡Todos ingresaron!'}</p></div>`; return; }
    box.innerHTML = `<ul class="card items">${shown.map((r) => attRow(r.a)).join('')}</ul>
      ${rows.length > shown.length ? `<button class="btn full more" data-more="1">Ver más (${rows.length - shown.length} restantes)</button>` : ''}`;
  }
  function listPanel() {
    if (!state.att.length) {
      return `<div class="card empty"><h3>Empecemos por la lista</h3>
        <p>Importá el archivo Excel (.xlsx) o CSV con los asistentes. Después escaneá los QR y cada persona se marca sola como ingresada.</p>
        <button class="btn primary" data-act="import">Importar lista de asistentes</button>
        ${state.event.name ? '' : '<br><button class="btn ghost" data-act="event">Configurar nombre, fecha y lugar</button>'}</div>`;
    }
    const s = stats();
    const f = (k, label, n) => `<button class="fchip" data-fil="${k}" aria-pressed="${ui.filter === k}">${label} (${n})</button>`;
    return `<div class="searchbox"><svg width="18" height="18"><use href="#i-search"/></svg>
      <input type="search" id="search" placeholder="Buscar en la lista…" autocomplete="off" value="${esc(ui.q)}" aria-label="Buscar en la lista"></div>
      <div class="filters">${f('all', 'Todos', s.total)}${f('in', 'Presentes', s.present)}${f('out', 'Faltan', s.missing)}</div>
      <div id="listBody"></div>`;
  }
  const STATUS_TXT = { pending: 'Por verificar', valid: 'Válido', rejected: 'Rechazado' };
  function verifPanel() {
    const s = stats();
    const f = (k, label, n) => `<button class="fchip" data-exf="${k}" aria-pressed="${ui.exFilter === k}">${label} (${n})</button>`;
    let rows = state.extras.slice().reverse();
    if (ui.exFilter !== 'all') rows = rows.filter((e) => e.status === (ui.exFilter === 'pending' ? 'pending' : ui.exFilter === 'valid' ? 'valid' : 'rejected'));
    const head = `<div class="filters">${f('pending', 'Pendientes', s.pending)}${f('valid', 'Válidos', s.valid)}${f('rejected', 'Rechazados', s.rejected)}${f('all', 'Todos', state.extras.length)}</div>`;
    if (!rows.length) return head + `<div class="card empty"><p>${state.extras.length ? 'No hay lecturas en esta categoría.' : 'Acá aparecen los QR que no figuran en la lista, para que decidas si dejás pasar a la persona o no.'}</p></div>`;
    return head + `<ul class="card items">${rows.map((e) => `<li class="vitem">
      <div class="top"><span><span class="badge ${e.status}">${STATUS_TXT[e.status]}</span> &nbsp;${fmtHMS(e.at)}</span><span>${e.decidedAt ? 'decidido ' + fmtHM(e.decidedAt) : ''}</span></div>
      <div class="raw">${esc(e.raw)}</div>
      <div class="acts">
        ${e.status !== 'valid' ? `<button class="btn ok sm" data-ex="${e.id}" data-set="valid">✔ Dar por válido</button>` : ''}
        ${e.status !== 'rejected' ? `<button class="btn bad sm" data-ex="${e.id}" data-set="rejected">✖ Rechazar</button>` : ''}
      </div></li>`).join('')}</ul>`;
  }
  const LOG_DOT = { in: 'in', mout: 'dup', dup: 'dup', unl: 'unl', val: 'val', rej: 'rej', import: '' };
  function logPanel() {
    if (!state.log.length) return '<div class="card empty"><p>Todavía no hay movimientos. Cada lectura queda anotada acá con su hora.</p></div>';
    const rows = state.log.slice().reverse().slice(0, ui.limit);
    const text = (l) => {
      const via = l.via === 'texto' ? ' · código escrito' : l.via === 'foto' ? ' · desde foto' : l.via === 'manual' ? ' · manual' : '';
      if (l.type === 'in') return `<b>Ingreso:</b> ${esc(l.label)}<small>${via.replace(' · ', '')}</small>`;
      if (l.type === 'dup') return `<b>Repetido:</b> ${esc(l.label)}<small>Ya había ingresado a las ${fmtHM(l.firstAt)}</small>`;
      if (l.type === 'mout') return `<b>Ingreso quitado:</b> ${esc(l.label)}`;
      if (l.type === 'import') return `<b>${esc(l.label)}</b>`;
      return `<b>${esc(l.label)}</b><small>${esc(String(l.raw || '').slice(0, 120))}</small>`;
    };
    return `<ul class="card items">${rows.map((l) => `<li class="logrow"><span class="lt">${fmtHMS(l.t)}</span><span class="ld"><span class="dot ${LOG_DOT[l.type] || ''}"></span>${text(l)}</span></li>`).join('')}</ul>
      ${state.log.length > rows.length ? `<button class="btn full more" data-more="1">Ver más</button>` : ''}`;
  }
  function renderPanel() {
    const p = $('#panel');
    p.innerHTML = ui.tab === 'lista' ? listPanel() : ui.tab === 'verif' ? verifPanel() : logPanel();
    if (ui.tab === 'lista') renderListBody();
  }
  function renderAll() { renderHeader(); renderStats(); renderTabs(); renderPanel(); }

  /* ---------- Hoja: datos del evento ---------- */
  function openEventSheet() {
    openSheet(`<h2>Datos del evento</h2>
      <label class="field"><span>Nombre del evento</span><input type="text" id="evN" value="${esc(state.event.name)}" placeholder="Ej.: Cata de vinos de primavera" autocomplete="off"></label>
      <label class="field"><span>Fecha</span><input type="date" id="evD" value="${esc(state.event.date)}"></label>
      <label class="field"><span>Lugar</span><input type="text" id="evP" value="${esc(state.event.place)}" placeholder="Ej.: Salón principal" autocomplete="off"></label>
      <div class="sheet-actions"><button class="btn ghost" id="evC">Cancelar</button><button class="btn primary" id="evS">Guardar</button></div>`,
    (root) => {
      $('#evC', root).onclick = closeSheet;
      $('#evS', root).onclick = () => {
        state.event = { name: $('#evN', root).value.trim(), date: $('#evD', root).value, place: $('#evP', root).value.trim() };
        saveState(); closeSheet(); renderAll();
      };
    });
  }

  /* ---------- Importación de la lista ---------- */
  function sheetRows(XLSX, ws) {
    if (!ws || !ws['!ref']) return [];
    const rg = XLSX.utils.decode_range(ws['!ref']); const rows = [];
    for (let r = rg.s.r; r <= rg.e.r; r++) {
      const row = [];
      for (let c = rg.s.c; c <= rg.e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })]; let v = '';
        if (cell) {
          v = cell.w != null ? cell.w : (cell.v != null ? String(cell.v) : '');
          if (cell.t === 'n' && typeof cell.v === 'number' && /e\+/i.test(v)) v = Number(cell.v).toLocaleString('fullwide', { useGrouping: false });
        }
        row.push(String(v).replace(/\s+/g, ' ').trim());
      }
      rows.push(row);
    }
    return rows;
  }
  async function readWorkbook(file) {
    const XLSX = await loadLib('xlsx'); let wb;
    try {
      const buf = await file.arrayBuffer();
      if (/\.csv$/i.test(file.name) || file.type === 'text/csv') {
        let text = new TextDecoder('utf-8').decode(buf);
        if (text.includes('�')) text = new TextDecoder('windows-1252').decode(buf);
        text = text.replace(/^﻿/, '');
        const first = text.split(/\r?\n/)[0] || '';
        wb = XLSX.read(text, { type: 'string', FS: first.includes(';') ? ';' : first.includes('\t') ? '\t' : ',' });
      } else wb = XLSX.read(buf, { type: 'array' });
    } catch (e) { throw new Error('No se pudo abrir el archivo. Guardalo como .xlsx e intentá de nuevo.'); }
    const sheets = wb.SheetNames.map((n) => ({ name: n, raw: sheetRows(XLSX, wb.Sheets[n]).filter((r) => r.some(Boolean)) })).filter((s) => s.raw.length);
    if (!sheets.length) throw new Error('El archivo no tiene datos.');
    return sheets;
  }
  function buildTable(raw, hasHeader) {
    const width = Math.max(...raw.map((r) => r.length));
    let hi = 0; let rows;
    let headers;
    if (hasHeader) {
      let best = -1; raw.slice(0, 10).forEach((r, i) => { const n = r.filter(Boolean).length; if (n > best) { best = n; hi = i; } });
      headers = Array.from({ length: width }, (_, j) => raw[hi][j] || '');
      rows = raw.slice(hi + 1);
    } else { headers = Array.from({ length: width }, () => ''); rows = raw; }
    rows = rows.map((r) => Array.from({ length: width }, (_, j) => r[j] || '')).filter((r) => r.some(Boolean));
    const keep = headers.map((h, j) => !!h || rows.some((r) => r[j]));
    headers = headers.map((h, j) => h || `Columna ${j + 1}`).filter((_, j) => keep[j]);
    rows = rows.map((r) => r.filter((_, j) => keep[j]));
    return { headers, rows };
  }
  function guessNameCols(t) {
    const H = t.headers.map(norm);
    const full = H.findIndex((h) => /^(nombre y apellido|apellido y nombre|apellidos y nombres|nombres y apellidos|nombre completo|asistente|invitado|participante|socio|alumno|persona|huesped)/.test(h));
    if (full >= 0) return [full];
    const ap = H.findIndex((h) => /^apellido/.test(h)); const no = H.findIndex((h, i) => /^nombre/.test(h) && i !== ap);
    if (ap >= 0 && no >= 0) return [ap, no];
    if (no >= 0) return [no];
    if (ap >= 0) return [ap];
    const looks = t.headers.findIndex((_, j) => t.rows.slice(0, 30).filter((r) => /\p{L}{2,}\s+\p{L}{2,}/u.test(r[j] || '') && !/\d{4,}/.test(r[j] || '')).length >= 3);
    return [looks >= 0 ? looks : 0];
  }
  function openImportSheet(sheets, fileName) {
    let si = Math.max(0, sheets.findIndex((s) => s.raw.length > 1)); let hasHdr = true; let keyCol = -1; let nameCols = []; let mode = 'replace';
    let table = null;
    const rebuild = () => { table = buildTable(sheets[si].raw, hasHdr); keyCol = -1; nameCols = guessNameCols(table); };
    rebuild();
    const sameHeaders = () => state.att.length && state.headers.map(norm).join('|') === table.headers.map(norm).join('|');

    openSheet('<div id="imBody"></div>', (root) => {
      const paint = () => {
        if (mode === 'merge' && !sameHeaders()) mode = 'replace';
        const nm = (cells) => { const s = nameCols.map((c) => cells[c] || '').filter(Boolean).join(' '); return s || cells.find(Boolean) || ''; };
        const sample = (j) => { const v = (table.rows.find((r) => r[j]) || [])[j]; return v ? ` — ej.: ${String(v).slice(0, 24)}` : ''; };
        $('#imBody', root).innerHTML = `<h2>Importar lista</h2>
          <p><b>${plural(table.rows.length, 'asistente encontrado', 'asistentes encontrados')}</b> <span class="muted">en “${esc(fileName)}”.</span></p>
          ${sheets.length > 1 ? `<label class="field"><span>Hoja</span><select id="imSheet">${sheets.map((s, i) => `<option value="${i}" ${i === si ? 'selected' : ''}>${esc(s.name)} (${s.raw.length} filas)</option>`).join('')}</select></label>` : ''}
          <label class="check"><input type="checkbox" id="imHdr" ${hasHdr ? 'checked' : ''}><span>La primera fila trae los títulos de las columnas</span></label>
          <div class="scroll-x"><table class="prev"><thead><tr>${table.headers.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
            <tbody>${table.rows.slice(0, 4).map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
          <label class="field"><span>¿Qué dato trae el QR?</span><select id="imKey"><option value="-1" ${keyCol < 0 ? 'selected' : ''}>Automático (todas las columnas)</option>
            ${table.headers.map((h, j) => `<option value="${j}" ${keyCol === j ? 'selected' : ''}>${esc(h)}${esc(sample(j))}</option>`).join('')}</select></label>
          <p class="muted" style="margin-top:-6px">Si no estás seguro, dejalo en Automático. Si sabés que el QR trae, por ejemplo, el código o el DNI, elegilo acá: es más preciso.</p>
          <h3>Cómo se muestra el nombre</h3>
          <div class="checks">${table.headers.map((h, j) => `<label class="check"><input type="checkbox" class="imName" value="${j}" ${nameCols.includes(j) ? 'checked' : ''}><span>${esc(h)}</span></label>`).join('')}</div>
          <p class="muted">Se verá así: <b>${esc(nm(table.rows[0] || []))}</b></p>
          ${state.att.length ? `<h3>Ya hay una lista cargada</h3>
            <div class="checks"><label class="check"><input type="radio" name="imMode" value="replace" ${mode === 'replace' ? 'checked' : ''}><span>Reemplazar todo <span class="muted">(se borran ingresos y registros)</span></span></label>
            <label class="check" style="${sameHeaders() ? '' : 'opacity:.45'}"><input type="radio" name="imMode" value="merge" ${mode === 'merge' ? 'checked' : ''} ${sameHeaders() ? '' : 'disabled'}><span>Actualizar conservando los ingresos <span class="muted">${sameHeaders() ? '(suma los nuevos; los ya ingresados siguen presentes)' : '(solo si las columnas son las mismas)'}</span></span></label></div>` : ''}
          <div class="sheet-actions"><button class="btn ghost" id="imC">Cancelar</button><button class="btn primary" id="imOk">Importar</button></div>`;
      };
      paint();
      root.addEventListener('change', (e) => {
        const t = e.target;
        if (t.id === 'imSheet') { si = +t.value; rebuild(); }
        else if (t.id === 'imHdr') { hasHdr = t.checked; rebuild(); }
        else if (t.id === 'imKey') { keyCol = +t.value; }
        else if (t.classList.contains('imName')) { nameCols = $$('.imName', root).filter((c) => c.checked).map((c) => +c.value); }
        else if (t.name === 'imMode') { mode = t.value; }
        paint();
      });
      root.addEventListener('click', async (e) => {
        if (e.target.closest('#imC')) { closeSheet(); return; }
        if (!e.target.closest('#imOk')) return;
        if (!table.rows.length) { toast('No hay filas para importar'); return; }
        if (!nameCols.length) nameCols = [0];
        const hasProgress = state.att.some((a) => a.inAt) || state.extras.length;
        if (mode === 'replace' && hasProgress) {
          closeSheet();
          const ok = await confirmSheet('¿Reemplazar la lista?', 'Se van a borrar los ingresos y los registros que ya hiciste. Si querés conservarlos, elegí “Actualizar conservando los ingresos” o exportá antes.', 'Reemplazar', true);
          if (!ok) return;
        } else closeSheet();
        commitImport(table, keyCol, nameCols, mode, fileName);
      });
    });
  }
  function commitImport(table, keyCol, nameCols, mode, fileName) {
    const sigOf = (cells) => (keyCol >= 0 && norm(cells[keyCol])) || norm(cells.join('|'));
    let att = table.rows.map((cells) => ({ id: uid(), cells, inAt: null, via: null }));
    let kept = 0; let added = att.length;
    if (mode === 'merge' && state.att.length) {
      const oldMap = new Map(); state.att.forEach((a) => oldMap.set(sigOf(a.cells), a));
      const used = new Set();
      att = att.map((a) => { const o = oldMap.get(sigOf(a.cells)); if (o && !used.has(o)) { used.add(o); return { ...a, id: o.id, inAt: o.inAt, via: o.via }; } return a; });
      added = att.filter((a) => !state.att.some((o) => o.id === a.id)).length;
      const lost = state.att.filter((o) => o.inAt && !used.has(o));
      att = att.concat(lost); kept = lost.length;
    } else { state.extras = []; state.log = []; }
    state.att = att; state.headers = table.headers; state.keyCol = keyCol; state.nameCols = nameCols;
    state.fileName = fileName; state.importedAt = new Date().toISOString();
    idx = null; sIdx = null; ui.filter = 'all'; ui.q = ''; ui.limit = 150; ui.tab = 'lista';
    addLog('import', { label: `Lista importada: ${plural(table.rows.length, 'asistente', 'asistentes')} (${fileName})` });
    saveState(); renderAll();
    toast(mode === 'merge' ? `Lista actualizada: ${added} nuevos${kept ? `, ${kept} ingresados fuera del archivo se conservaron` : ''}` : `Lista cargada: ${plural(table.rows.length, 'asistente', 'asistentes')}`);
  }
  async function onXlsxChosen(file) {
    toast('Leyendo planilla…');
    try { const sheets = await readWorkbook(file); hideToast(); openImportSheet(sheets, file.name); } catch (e) { toast(e.message || 'No se pudo leer el archivo'); }
  }

  /* ---------- Hoja: columnas y coincidencia ---------- */
  function openColumnsSheet() {
    if (!state.att.length) { toast('Primero importá la lista'); return; }
    openSheet(`<h2>Columnas y coincidencia</h2>
      <label class="field"><span>¿Qué dato trae el QR?</span><select id="coKey"><option value="-1" ${state.keyCol < 0 ? 'selected' : ''}>Automático (todas las columnas)</option>
        ${state.headers.map((h, j) => `<option value="${j}" ${state.keyCol === j ? 'selected' : ''}>${esc(h)}</option>`).join('')}</select></label>
      <h3>Cómo se muestra el nombre</h3>
      <div class="checks">${state.headers.map((h, j) => `<label class="check"><input type="checkbox" class="coName" value="${j}" ${state.nameCols.includes(j) ? 'checked' : ''}><span>${esc(h)}</span></label>`).join('')}</div>
      <h3>Probar un código</h3>
      <p class="muted">Pegá o escribí lo que trae un QR para ver a quién corresponde. No registra ingreso.</p>
      <label class="field"><input type="text" id="coTest" placeholder="Contenido del QR" autocomplete="off"></label>
      <div id="coRes" class="muted"></div>
      <div class="sheet-actions"><button class="btn ghost" id="coC">Cerrar</button><button class="btn primary" id="coS">Guardar</button></div>`,
    (root) => {
      const test = () => {
        const v = $('#coTest', root).value.trim(); const out = $('#coRes', root);
        if (!v) { out.textContent = ''; return; }
        const keyBackup = state.keyCol; state.keyCol = +$('#coKey', root).value; const idxBackup = idx; idx = null;
        const m = matchAttendee(v); const res = m.status === 'found' ? `✔ Coincide con: <b>${esc(displayName(state.att[m.i]))}</b>` : m.status === 'ambiguous' ? `Hay varias coincidencias: ${m.cands.map((i) => esc(displayName(state.att[i]))).join(', ')}` : '✖ No coincide con nadie de la lista';
        state.keyCol = keyBackup; idx = idxBackup; out.innerHTML = res;
      };
      $('#coTest', root).addEventListener('input', test);
      $('#coKey', root).addEventListener('change', test);
      $('#coC', root).onclick = closeSheet;
      $('#coS', root).onclick = () => {
        state.keyCol = +$('#coKey', root).value;
        const nc = $$('.coName', root).filter((c) => c.checked).map((c) => +c.value);
        state.nameCols = nc.length ? nc : [0];
        idx = null; saveState(); closeSheet(); renderAll(); toast('Columnas guardadas');
      };
    });
  }

  /* ---------- Hoja: detalle de un asistente ---------- */
  function openAttendee(id) {
    const a = findAtt(id); if (!a) return;
    openSheet(`<h2>${esc(displayName(a))}</h2>
      <p>${a.inAt ? `<span class="badge valid">Presente</span> &nbsp;Ingresó a las <b>${fmtHMS(a.inAt)}</b>${a.via ? ` <span class="muted">(${{ qr: 'QR', texto: 'código escrito', foto: 'foto', manual: 'manual' }[a.via] || a.via})</span>` : ''}` : '<span class="badge pending">Falta</span> &nbsp;Todavía no ingresó'}</p>
      <div class="detail">${state.headers.map((h, j) => (a.cells[j] ? `<div><span class="k">${esc(h)}</span><span class="v">${esc(a.cells[j])}</span></div>` : '')).join('')}</div>
      <div class="sheet-actions"><button class="btn ghost" id="atC">Cerrar</button>
        ${a.inAt ? '<button class="btn bad" id="atOut">Quitar ingreso</button>' : '<button class="btn ok" id="atIn">Registrar ingreso a mano</button>'}</div>`,
    (root) => {
      $('#atC', root).onclick = closeSheet;
      const inB = $('#atIn', root); const outB = $('#atOut', root);
      if (inB) inB.onclick = () => { closeSheet(); const undo = markPresent(a, 'manual'); feedback('ok'); renderAll(); toast(`Ingreso registrado: ${displayName(a)}`, { label: 'Deshacer', fn: undo }); };
      if (outB) outB.onclick = () => { closeSheet(); const undo = unmarkPresent(a); renderAll(); toast(`Ingreso quitado: ${displayName(a)}`, { label: 'Deshacer', fn: undo }); };
    });
  }

  /* ---------- Hoja: apariencia ---------- */
  function openAppearance() {
    const paint = (root) => {
      const s = state.settings;
      root.innerHTML = `<h2>Apariencia</h2>
        <h3>Paleta de color</h3>
        <div class="palettes">${window.PALETTES.map((p) => `<button class="pal" data-pal="${p.id}" aria-pressed="${s.palette === p.id}" style="--c1:${p.light.brand};--c2:${p.light.accent}"><span class="sw"></span>${esc(p.name)}</button>`).join('')}</div>
        <h3>Tema</h3>
        <div class="seg">${[['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Oscuro']].map(([k, l]) => `<button data-theme="${k}" aria-pressed="${s.theme === k}">${l}</button>`).join('')}</div>
        <h3>Imagen de fondo</h3>
        <p class="muted">Opcional. Se suaviza para que el texto se lea siempre bien; elegí una foto sobria (una textura, un salón, una copa…).</p>
        <div class="sheet-actions" style="margin-top:6px"><button class="btn" id="bgPick"><svg width="18" height="18"><use href="#i-img"/></svg> Elegir imagen</button>
          <button class="btn ghost" id="bgDel" ${document.body.classList.contains('has-bg') ? '' : 'disabled'}>Quitar</button></div>
        <label class="field" style="margin-top:12px"><span>Intensidad del fondo</span><input type="range" id="bgVeil" min="0.45" max="0.97" step="0.01" value="${s.veil}" style="direction:rtl"></label>
        <label class="field"><span>Desenfoque</span><input type="range" id="bgBlur" min="0" max="14" step="1" value="${s.blur}"></label>
        <div class="sheet-actions"><button class="btn primary" id="apOk">Listo</button></div>`;
    };
    openSheet('<div id="apBody"></div>', (root) => {
      const body = $('#apBody', root); paint(body);
      body.addEventListener('click', (e) => {
        const pal = e.target.closest('[data-pal]'); const th = e.target.closest('[data-theme]');
        if (pal) { state.settings.palette = pal.dataset.pal; window.Palettes.apply(state.settings.palette, state.settings.theme); saveState(); paint(body); }
        else if (th) { state.settings.theme = th.dataset.theme; window.Palettes.apply(state.settings.palette, state.settings.theme); saveState(); paint(body); }
        else if (e.target.closest('#bgPick')) $('#fileBg').click();
        else if (e.target.closest('#bgDel')) { bgDel().then(() => { applyBg(null); paint(body); }); }
        else if (e.target.closest('#apOk')) closeSheet();
      });
      body.addEventListener('input', (e) => {
        if (e.target.id === 'bgVeil') { state.settings.veil = +e.target.value; applyBgLook(); }
        if (e.target.id === 'bgBlur') { state.settings.blur = +e.target.value; applyBgLook(); }
      });
      body.addEventListener('change', () => saveState());
      window.__repaintAppearance = () => paint(body);
    }, () => { window.__repaintAppearance = null; });
  }
  async function onBgChosen(file) {
    try {
      const url = await shrinkImage(file);
      await bgSet(url); applyBg(url); toast('Fondo aplicado');
      if (window.__repaintAppearance) window.__repaintAppearance();
    } catch (e) { toast('No se pudo usar esa imagen'); }
  }

  /* ---------- Hoja: sonido ---------- */
  function openSoundSheet() {
    const paint = (root) => {
      const s = state.settings;
      root.innerHTML = `<h2>Sonido y vibración</h2>
        <div class="checks"><label class="check"><input type="checkbox" id="soSound" ${s.sound ? 'checked' : ''}><span>Sonidos al leer (ingreso correcto / error)</span></label>
        <label class="check"><input type="checkbox" id="soVib" ${s.vibrate ? 'checked' : ''}><span>Vibrar <span class="muted">(solo en celulares Android)</span></span></label></div>
        <label class="field"><span>Volumen</span><input type="range" id="soVol" min="0.1" max="1" step="0.05" value="${s.volume}"></label>
        <h3>Probar</h3>
        <div class="menu-list" style="grid-template-columns:1fr 1fr;display:grid">
          <button class="btn ok" data-snd="ok">✔ Ingreso válido</button><button class="btn" data-snd="dup">↺ Ya ingresó</button>
          <button class="btn bad" data-snd="bad">⚠ No figura</button><button class="btn bad" data-snd="rej">✖ Rechazado</button></div>
        <div class="sheet-actions"><button class="btn primary" id="soOk">Listo</button></div>`;
    };
    openSheet('<div id="soBody"></div>', (root) => {
      const body = $('#soBody', root); paint(body);
      body.addEventListener('change', (e) => {
        if (e.target.id === 'soSound') state.settings.sound = e.target.checked;
        if (e.target.id === 'soVib') state.settings.vibrate = e.target.checked;
        saveState(); syncSoundBtn();
      });
      body.addEventListener('input', (e) => { if (e.target.id === 'soVol') { state.settings.volume = +e.target.value; } });
      body.addEventListener('click', (e) => {
        const b = e.target.closest('[data-snd]');
        if (b) { const was = state.settings.sound; state.settings.sound = true; audio(); feedback(b.dataset.snd); state.settings.sound = was; }
        if (e.target.closest('#soOk')) { saveState(); closeSheet(); }
      });
    });
  }
  function syncSoundBtn() {
    const on = state.settings.sound;
    $('#scSound').innerHTML = `<svg width="22" height="22"><use href="#${on ? 'i-volume' : 'i-mute'}"/></svg>`;
  }

  /* ---------- Menú ---------- */
  function openMenu() {
    openSheet(`<h2>Opciones</h2>
      <div class="menu-list">
        <button class="btn" data-m="event">Datos del evento<small>Nombre, fecha y lugar</small></button>
        <button class="btn" data-m="import">Importar lista de asistentes<small>${state.att.length ? `${plural(state.att.length, 'persona', 'personas')} · ${esc(state.fileName || '')}` : 'Excel (.xlsx) o CSV'}</small></button>
        ${state.att.length ? '<button class="btn" data-m="cols">Columnas y coincidencia<small>Qué dato trae el QR, cómo se muestra el nombre y probar un código</small></button>' : ''}
        <button class="btn" data-m="look">Colores y fondo<small>Paletas, tema claro u oscuro e imagen de fondo</small></button>
        <button class="btn" data-m="sound">Sonido y vibración</button>
        <button class="btn" data-m="export">Exportar resultados<small>PDF, imagen, Excel o CSV</small></button>
        <button class="btn" data-m="backup">Copia de seguridad<small>Guardar o recuperar todo en un archivo</small></button>
      </div>
      <h3>Zona delicada</h3>
      <div class="menu-list">
        <button class="btn" data-m="reset">Reiniciar ingresos<small>Deja la lista y borra quién ingresó</small></button>
        <button class="btn" data-m="wipe" style="color:var(--bad)">Borrar todo el evento<small>Lista, ingresos y registros</small></button>
      </div>
      <h3>Aplicación</h3>
      <div class="menu-list">
        <button class="btn" data-m="update">Buscar actualización<small>Versión instalada: v${APP_VERSION}</small></button>
        <button class="btn" data-m="force">Forzar actualización<small>Vuelve a descargar la app sin tocar tus datos</small></button>
      </div>`,
    (root) => root.addEventListener('click', (e) => {
      const b = e.target.closest('[data-m]'); if (!b) return;
      closeSheet(); handleMenu(b.dataset.m);
    }));
  }
  async function handleMenu(m) {
    if (m === 'event') openEventSheet();
    else if (m === 'import') $('#fileXlsx').click();
    else if (m === 'cols') openColumnsSheet();
    else if (m === 'look') openAppearance();
    else if (m === 'sound') openSoundSheet();
    else if (m === 'export') openExport();
    else if (m === 'backup') openBackup();
    else if (m === 'update') checkForUpdate(true);
    else if (m === 'force') forceUpdate();
    else if (m === 'reset') {
      if (await confirmSheet('¿Reiniciar los ingresos?', 'Todos vuelven a figurar como “Faltan” y se borran los registros y las lecturas por verificar. La lista de asistentes se conserva.', 'Reiniciar', true)) {
        state.att.forEach((a) => { a.inAt = null; a.via = null; }); state.extras = []; state.log = [];
        saveState(); renderAll(); toast('Ingresos reiniciados');
      }
    } else if (m === 'wipe') {
      if (await confirmSheet('¿Borrar todo el evento?', 'Se borran la lista, los ingresos y los registros. Los datos del evento y la apariencia se conservan. Esto no se puede deshacer.', 'Borrar todo', true)) {
        state.att = []; state.extras = []; state.log = []; state.headers = []; state.keyCol = -1; state.nameCols = []; state.fileName = ''; state.importedAt = null;
        idx = null; sIdx = null; saveState(); renderAll(); toast('Evento vaciado');
      }
    }
  }

  /* ---------- Copia de seguridad ---------- */
  function openBackup() {
    openSheet(`<h2>Copia de seguridad</h2>
      <p class="muted">Guarda la lista, los ingresos y los registros en un archivo (no incluye la imagen de fondo). Sirve para pasar el evento a otro dispositivo.</p>
      <div class="sheet-actions"><button class="btn" id="bkSave">Guardar copia</button><button class="btn" id="bkLoad">Recuperar copia</button></div>`,
    (root) => {
      $('#bkSave', root).onclick = () => {
        closeSheet();
        const blob = new Blob([JSON.stringify({ app: 'control-ingreso', exportedAt: new Date().toISOString(), state }, null, 1)], { type: 'application/json' });
        download(blob, `${slug(state.event.name)}-copia.json`);
      };
      $('#bkLoad', root).onclick = () => { closeSheet(); $('#fileJson').click(); };
    });
  }
  async function onJsonChosen(file) {
    try {
      const data = JSON.parse(await file.text());
      if (!data || data.app !== 'control-ingreso' || !data.state || !Array.isArray(data.state.att)) throw new Error('bad');
      if (!(await confirmSheet('¿Recuperar esta copia?', `Reemplaza todo lo que hay ahora en este dispositivo por la copia (${plural(data.state.att.length, 'asistente', 'asistentes')}).`, 'Recuperar', true))) return;
      const d = defaultState();
      state = { ...d, ...data.state, event: { ...d.event, ...data.state.event }, settings: { ...d.settings, ...data.state.settings } };
      idx = null; sIdx = null; saveState();
      window.Palettes.apply(state.settings.palette, state.settings.theme); applyBgLook(); renderAll(); toast('Copia recuperada');
    } catch (e) { toast('Ese archivo no es una copia válida'); }
  }

  /* ---------- Descargas y compartir ---------- */
  function download(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast(`Descargado: ${filename}`);
  }
  async function shareFile(blob, filename) {
    const file = new File([blob], filename, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: state.event.name || 'Control de ingreso' }); } catch (e) { if (e && e.name !== 'AbortError') download(blob, filename); }
    } else { download(blob, filename); toast('Tu navegador no comparte archivos: se descargó el archivo'); }
  }
  const fileBase = () => `${slug(state.event.name)}-ingresos-${new Date().toISOString().slice(0, 10)}`;

  /* ---------- Exportaciones ---------- */
  const STATE_LABEL = { pending: 'Por verificar', valid: 'Válido (no listado)', rejected: 'Rechazado' };
  function sortedPresent() { return state.att.filter((a) => a.inAt).sort((x, y) => x.inAt.localeCompare(y.inAt)); }

  function buildCSV() {
    const q = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const rows = [['Tipo', ...state.headers, 'Estado', 'Hora de ingreso', 'Dato leído (no listados)']];
    state.att.forEach((a) => rows.push(['Lista', ...state.headers.map((_, j) => a.cells[j] || ''), a.inAt ? 'Presente' : 'Falta', a.inAt ? fmtHMS(a.inAt) : '', '']));
    state.extras.forEach((e) => rows.push(['No listado', ...state.headers.map(() => ''), STATE_LABEL[e.status], fmtHMS(e.at), e.raw]));
    const csv = '﻿' + rows.map((r) => r.map(q).join(';')).join('\r\n');
    return new Blob([csv], { type: 'text/csv;charset=utf-8' });
  }

  async function buildXLSX() {
    toast('Generando Excel…');
    const XLSX = await loadLib('xlsx'); const s = stats(); const wb = XLSX.utils.book_new();
    const res = [[state.event.name || 'Evento'], ['Fecha', fmtDay(state.event.date, true)], ['Lugar', state.event.place], ['Informe generado', nowStamp()], [],
      ['En lista', s.total], ['Presentes', s.present], ['Faltan', s.missing], ['% de ingreso', s.total ? Math.round((s.present / s.total) * 1000) / 10 : 0],
      ['No listados: por verificar', s.pending], ['No listados: válidos', s.valid], ['No listados: rechazados', s.rejected]];
    const w1 = XLSX.utils.aoa_to_sheet(res); w1['!cols'] = [{ wch: 28 }, { wch: 36 }]; XLSX.utils.book_append_sheet(wb, w1, 'Resumen');

    const lista = [[...state.headers, 'Estado', 'Hora de ingreso']];
    state.att.forEach((a) => lista.push([...state.headers.map((_, j) => a.cells[j] || ''), a.inAt ? 'Presente' : 'Falta', a.inAt ? fmtHMS(a.inAt) : '']));
    const w2 = XLSX.utils.aoa_to_sheet(lista);
    w2['!cols'] = [...state.headers.map((h, j) => ({ wch: Math.min(40, Math.max(10, h.length + 2, ...state.att.slice(0, 80).map((a) => (a.cells[j] || '').length + 2))) })), { wch: 11 }, { wch: 15 }];
    w2['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(1, lista.length - 1), c: state.headers.length + 1 } }) };
    XLSX.utils.book_append_sheet(wb, w2, 'Lista');

    const ver = [['Dato leído', 'Hora de lectura', 'Estado', 'Decidido a las']];
    state.extras.forEach((e) => ver.push([e.raw, fmtHMS(e.at), STATE_LABEL[e.status], e.decidedAt ? fmtHMS(e.decidedAt) : '']));
    const w3 = XLSX.utils.aoa_to_sheet(ver); w3['!cols'] = [{ wch: 52 }, { wch: 16 }, { wch: 22 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, w3, 'No listados');

    const names = { in: 'Ingreso', dup: 'Repetido', mout: 'Ingreso quitado', unl: 'No listado', val: 'Válido', rej: 'Rechazado', import: 'Lista importada' };
    const reg = [['Fecha y hora', 'Movimiento', 'Detalle']];
    state.log.forEach((l) => reg.push([fmtStamp(l.t), names[l.type] || l.type, l.type === 'unl' || l.type === 'val' || l.type === 'rej' ? `${l.label}: ${l.raw || ''}` : l.label]));
    const w4 = XLSX.utils.aoa_to_sheet(reg); w4['!cols'] = [{ wch: 20 }, { wch: 18 }, { wch: 70 }];
    XLSX.utils.book_append_sheet(wb, w4, 'Registro');
    return new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  async function buildPDF() {
    toast('Generando PDF…');
    const jsPDF = await loadLib('jspdf'); const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const W = 210; const H = 297; const M = 14; const CW = W - 2 * M;
    const pal = window.Palettes.find(state.settings.palette).light;
    const B = hexToRgb(pal.brand); const A = hexToRgb(pal.accent); const S = hexToRgb(pal.soft);
    const s = stats(); let y = 0;
    const fit = (txt, w) => { const l = doc.splitTextToSize(String(txt || ''), w - 2); return l.length > 1 ? l[0].replace(/\s+\S*$/, '') + '…' : (l[0] || ''); };

    doc.setFillColor(...B); doc.rect(0, 0, W, 36, 'F');
    doc.setTextColor(255, 255, 255); doc.setFont('times', 'bold'); doc.setFontSize(22);
    doc.text(fit(state.event.name || 'Evento', CW), M, 15);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5);
    doc.text(fit([fmtDay(state.event.date, true), state.event.place].filter(Boolean).join('  ·  ') || 'Informe de ingreso', CW), M, 23.5);
    doc.setFontSize(8.5); doc.text(`Informe generado el ${nowStamp()}`, M, 30);
    y = 46;

    const tiles = [['En lista', s.total], ['Presentes', s.present], ['Faltan', s.missing], ['Válidos fuera de lista', s.valid], ['Por verificar', s.pending], ['Rechazados', s.rejected]];
    const tw = (CW - 5 * 3) / 6;
    tiles.forEach(([l, v], i) => {
      const x = M + i * (tw + 3);
      doc.setFillColor(...S); doc.roundedRect(x, y, tw, 20, 2, 2, 'F');
      doc.setTextColor(...B); doc.setFont('times', 'bold'); doc.setFontSize(18); doc.text(String(v), x + tw / 2, y + 9.5, { align: 'center' });
      doc.setTextColor(90, 82, 86); doc.setFont('helvetica', 'normal'); doc.setFontSize(6.8);
      doc.text(doc.splitTextToSize(l, tw - 2), x + tw / 2, y + 14.2, { align: 'center' });
    });
    y += 27;
    const pct = s.total ? s.present / s.total : 0;
    doc.setFillColor(...S); doc.roundedRect(M, y, CW, 4, 2, 2, 'F');
    if (pct > 0) { doc.setFillColor(...A); doc.roundedRect(M, y, Math.max(4, CW * pct), 4, 2, 2, 'F'); }
    doc.setTextColor(90, 82, 86); doc.setFontSize(8.5); doc.text(`${Math.round(pct * 100)} % de la lista ya ingresó`, M, y + 9);
    y += 16;

    const ROW = 5.9;
    const newPage = () => { doc.addPage(); y = M + 2; };
    const table = (title, cols, rows) => {
      if (y + 24 > H - 16) newPage();
      doc.setFillColor(...A); doc.rect(M, y, 1.8, 6, 'F');
      doc.setTextColor(30, 26, 28); doc.setFont('times', 'bold'); doc.setFontSize(13.5); doc.text(title, M + 4.5, y + 4.8);
      const tW = doc.getTextWidth(title);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(120, 110, 114); doc.text(`(${rows.length})`, M + 4.5 + tW + 2, y + 4.8);
      y += 9;
      const head = () => {
        doc.setFillColor(...S); doc.rect(M, y, CW, ROW, 'F'); doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...B);
        let x = M; cols.forEach((c) => { doc.text(c.h, x + 1.5, y + 4.1); x += c.w; }); y += ROW;
      };
      head();
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
      if (!rows.length) { doc.setTextColor(140, 130, 134); doc.text('Sin registros', M + 1.5, y + 4.1); y += ROW; }
      rows.forEach((r, i) => {
        if (y + ROW > H - 16) { newPage(); head(); doc.setFont('helvetica', 'normal'); doc.setFontSize(9); }
        if (i % 2) { doc.setFillColor(250, 247, 248); doc.rect(M, y, CW, ROW, 'F'); }
        doc.setTextColor(30, 26, 28); let x = M;
        cols.forEach((c, k) => { if (r.color && k === r.colorCol) doc.setTextColor(...r.color); else doc.setTextColor(30, 26, 28); doc.text(fit(r.v[k], c.w), x + 1.5, y + 4.1); x += c.w; });
        y += ROW;
      });
      y += 7;
    };

    table('Presentes', [{ h: 'N°', w: 10 }, { h: 'Nombre', w: 72 }, { h: 'Detalle', w: 76 }, { h: 'Ingreso', w: 24 }],
      sortedPresent().map((a, i) => ({ v: [i + 1, displayName(a), subline(a), fmtHMS(a.inAt)] })));
    table('Faltan', [{ h: 'N°', w: 10 }, { h: 'Nombre', w: 84 }, { h: 'Detalle', w: 88 }],
      state.att.filter((a) => !a.inAt).map((a, i) => ({ v: [i + 1, displayName(a), subline(a)] })));
    table('No listados', [{ h: 'N°', w: 10 }, { h: 'Dato leído', w: 112 }, { h: 'Estado', w: 36 }, { h: 'Lectura', w: 24 }],
      state.extras.map((e, i) => ({ v: [i + 1, e.raw, STATE_LABEL[e.status], fmtHMS(e.at)], colorCol: 2, color: e.status === 'valid' ? [20, 120, 70] : e.status === 'rejected' ? [185, 50, 40] : [160, 110, 20] })));

    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(150, 140, 144);
      doc.text(`${state.event.name || 'Evento'} — Página ${i} de ${pages}`, W / 2, H - 7, { align: 'center' });
    }
    return doc.output('blob');
  }

  async function buildPNG() {
    toast('Generando imagen…');
    const html2canvas = await loadLib('html2canvas');
    const pal = window.Palettes.find(state.settings.palette).light; const s = stats();
    const pct = s.total ? Math.round((s.present / s.total) * 100) : 0;
    const cap = (arr, n, fn, tag) => { const shown = arr.slice(0, n).map(fn).join(''); return `<${tag}>${shown || '<li style="list-style:none">Sin registros</li>'}</${tag}>${arr.length > n ? `<div class="note">… y ${arr.length - n} más. El listado completo está en el PDF o el Excel.</div>` : ''}`; };
    const present = sortedPresent(); const miss = state.att.filter((a) => !a.inAt);
    $('#exportArea').innerHTML = `<div class="exp" id="expNode">
      <div class="hd" style="background:${pal.brand}"><h1>${esc(state.event.name || 'Evento')}</h1><p>${esc([fmtDay(state.event.date, true), state.event.place].filter(Boolean).join('  ·  '))}</p></div>
      <div class="bd">
        <div class="tiles"><div class="tile"><b>${s.total}</b><span>En lista</span></div><div class="tile"><b style="color:#1E8E4E">${s.present}</b><span>Presentes</span></div><div class="tile"><b>${s.missing}</b><span>Faltan</span></div><div class="tile"><b style="color:#B7791F">${s.pending}</b><span>Por verificar</span></div></div>
        <div class="bar"><i style="width:${pct}%;background:${pal.accent}"></i></div>
        <div class="pc">${pct} % de la lista ya ingresó · ${plural(s.valid, 'válido', 'válidos')} fuera de lista · ${plural(s.rejected, 'rechazado', 'rechazados')}</div>
        <h2>Faltan (${miss.length})</h2>${cap(miss, 100, (a) => `<li>${esc(displayName(a))}</li>`, 'ul')}
        <h2>Presentes (${present.length})</h2>${cap(present, 100, (a) => `<li>${esc(displayName(a))} <small>${fmtHM(a.inAt)}</small></li>`, 'ol')}
        ${state.extras.length ? `<h2>No listados (${state.extras.length})</h2>${cap(state.extras, 40, (e) => `<li>${esc(String(e.raw).slice(0, 60))} <small>— ${STATE_LABEL[e.status]}</small></li>`, 'ul')}` : ''}
      </div><div class="ft">Informe generado el ${nowStamp()}</div></div>`;
    try {
      const canvas = await html2canvas($('#expNode'), { backgroundColor: '#FFFFFF', scale: 1.4, logging: false, useCORS: false });
      return await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('No se pudo crear la imagen'))), 'image/png'));
    } finally { $('#exportArea').innerHTML = ''; }
  }

  function openExport() {
    const s = stats(); const canShare = !!navigator.share;
    const row = (k, label, desc) => `<div class="menu-list" style="grid-template-columns:1fr ${canShare ? '52px' : ''};display:grid;margin-bottom:6px">
      <button class="btn" data-ex="${k}" style="justify-content:flex-start;text-align:left">${label}<small>${desc}</small></button>
      ${canShare ? `<button class="btn" data-sh="${k}" aria-label="Compartir ${label}"><svg width="20" height="20"><use href="#i-share"/></svg></button>` : ''}</div>`;
    openSheet(`<h2>Exportar resultados</h2>
      <p class="muted">${plural(s.present, 'presente', 'presentes')} de ${s.total} · ${plural(s.pending + s.valid + s.rejected, 'lectura no listada', 'lecturas no listadas')}. Incluye hora de ingreso y estado de cada persona.</p>
      ${row('pdf', 'PDF', 'Informe prolijo: presentes, faltantes y no listados')}
      ${row('png', 'Imagen (PNG)', 'Resumen para compartir; listas largas se acortan')}
      ${row('xlsx', 'Excel (.xlsx)', 'Resumen, lista completa, no listados y registro')}
      ${row('csv', 'CSV', 'Tabla simple para otros sistemas')}
      <div class="sheet-actions"><button class="btn ghost" id="exC">Cerrar</button></div>`,
    (root) => root.addEventListener('click', async (e) => {
      if (e.target.closest('#exC')) { closeSheet(); return; }
      const d = e.target.closest('[data-ex]'); const sh = e.target.closest('[data-sh]');
      const k = d ? d.dataset.ex : sh ? sh.dataset.sh : null; if (!k) return;
      closeSheet();
      try {
        const blob = await ({ pdf: buildPDF, png: buildPNG, xlsx: buildXLSX, csv: async () => buildCSV() })[k]();
        const name = `${fileBase()}.${k}`;
        if (sh) await shareFile(blob, name); else download(blob, name);
      } catch (err) { toast(err.message || 'No se pudo generar el archivo'); }
    }));
  }

  /* ---------- Escáner ---------- */
  const sc = { on: false, stream: null, busy: false, timer: null, native: null, lastRaw: '', lastAt: 0, n: 0, facing: 'environment', torch: false, msgTimer: null };

  function showMsg(kind, label, name, detail, undo) {
    const m = $('#scMsg'); clearTimeout(sc.msgTimer);
    m.className = `sc-msg ${kind}`;
    m.innerHTML = `<div class="k">${esc(label)}</div><div class="n">${esc(name)}</div>${detail ? `<div class="d">${esc(detail)}</div>` : ''}${undo ? '<button class="u" id="scUndo">Deshacer</button>' : ''}`;
    m.hidden = false;
    if (undo) $('#scUndo', m).onclick = () => { undo(); hideMsg(); toast('Deshecho'); };
    const scn = $('#scanner'); scn.classList.remove('flash-ok', 'flash-warn', 'flash-bad');
    scn.classList.add(kind === 'ok' ? 'flash-ok' : kind === 'warn' ? 'flash-warn' : 'flash-bad');
    sc.msgTimer = setTimeout(hideMsg, 5000);
  }
  function hideMsg() { $('#scMsg').hidden = true; $('#scanner').classList.remove('flash-ok', 'flash-warn', 'flash-bad'); }

  function unlistedSheet(ex) {
    sc.busy = true;
    let decided = false;
    openSheet(`<h2>No figura en la lista</h2>
      <p>Este código no coincide con ningún asistente. Quedó guardado para verificación.</p>
      <div class="vitem" style="padding:0"><div class="raw">${esc(ex.raw)}</div></div>
      <p class="muted">Leído a las ${fmtHMS(ex.at)}. ¿Lo dejás pasar?</p>
      <div class="sheet-actions"><button class="btn bad" id="unR">✖ Rechazar</button><button class="btn ok" id="unV">✔ Dar por válido</button></div>
      <div class="sheet-actions" style="margin-top:6px"><button class="btn ghost" id="unL">Decidir después</button></div>`,
    (root) => {
      const decide = (st) => { decided = true; closeSheet(); setExtraStatus(ex, st); feedback(st === 'valid' ? 'ok' : 'rej'); renderAll(); showMsg(st === 'valid' ? 'ok' : 'bad', st === 'valid' ? 'Ingreso válido (no listado)' : 'Ingreso rechazado', String(ex.raw).slice(0, 60), ''); };
      $('#unV', root).onclick = () => decide('valid');
      $('#unR', root).onclick = () => decide('rejected');
      $('#unL', root).onclick = () => { closeSheet(); };
    }, () => { sc.busy = false; if (!decided) { renderAll(); } });
  }
  function ambiguousSheet(res) {
    sc.busy = true; let chosen = false;
    openSheet(`<h2>Varias coincidencias</h2><p class="muted">El código coincide con más de una persona. Elegí a quién corresponde.</p>
      <div class="pick">${res.cands.map((a) => `<button class="btn" data-pick="${a.id}">${esc(displayName(a))}${a.inAt ? ` <span class="badge valid">ya ingresó ${fmtHM(a.inAt)}</span>` : ''}</button>`).join('')}</div>
      <div class="sheet-actions"><button class="btn ghost" id="amN">Ninguna: registrar como no listado</button></div>`,
    (root) => root.addEventListener('click', (e) => {
      const p = e.target.closest('[data-pick]');
      if (p) {
        chosen = true; closeSheet(); const a = findAtt(p.dataset.pick);
        if (a.inAt) { feedback('dup'); showMsg('warn', 'Ya había ingresado', displayName(a), `Primer ingreso a las ${fmtHMS(a.inAt)}`); } else { const undo = markPresent(a, res.via); feedback('ok'); renderAll(); showMsg('ok', 'Ingreso registrado', displayName(a), subline(a), undo); }
      } else if (e.target.closest('#amN')) { chosen = true; closeSheet(); const r = registerUnlisted(res.raw, res.via); renderAll(); feedback('bad'); if (r.kind === 'unlisted') unlistedSheet(r.extra); }
    }), () => { sc.busy = false; if (!chosen) renderAll(); });
  }

  /** Punto de entrada de toda lectura (cámara, texto o foto) */
  function handleScanned(raw, via) {
    raw = String(raw || '').trim(); if (!raw) return;
    const now = Date.now();
    if (via === 'qr' && raw === sc.lastRaw && now - sc.lastAt < 3500) { sc.lastAt = now; return; }
    sc.lastRaw = raw; sc.lastAt = now;
    const r = processScan(raw, via); if (!r) return;
    hideToast();
    if (r.kind === 'in') {
      feedback('ok'); showMsg('ok', 'Ingreso registrado', displayName(r.att), [subline(r.att), fmtHM(r.att.inAt)].filter(Boolean).join(' · '), r.undo);
    } else if (r.kind === 'dup') {
      feedback('dup'); showMsg('warn', 'Ya había ingresado', displayName(r.att), `Primer ingreso a las ${fmtHMS(r.att.inAt)}`);
    } else if (r.kind === 'ambiguous') {
      feedback('bad'); ambiguousSheet(r);
    } else if (r.kind === 'unlisted') {
      feedback('bad'); renderAll(); unlistedSheet(r.extra); return;
    } else if (r.kind === 'again') {
      const ex = r.extra;
      if (ex.status === 'pending') { feedback('bad'); unlistedSheet(ex); } else { feedback(ex.status === 'valid' ? 'dup' : 'rej'); showMsg(ex.status === 'valid' ? 'warn' : 'bad', `Ya leído: ${STATUS_TXT[ex.status].toLowerCase()}`, String(ex.raw).slice(0, 60), `Primera lectura a las ${fmtHMS(ex.at)}`); }
    }
    renderAll();
  }

  async function startCamera() {
    $('#scError').hidden = true;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showScError('Este navegador no permite usar la cámara (hace falta abrir la app desde una dirección https). Podés escribir el código o leerlo desde una foto.'); return;
    }
    try {
      sc.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: sc.facing }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    } catch (e) {
      const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
      showScError(denied ? 'No hay permiso para usar la cámara. Habilitala en los ajustes del navegador o de la app y volvé a intentar.' : 'No se pudo abrir la cámara de este dispositivo.'); return;
    }
    const v = $('#scVideo'); v.srcObject = sc.stream;
    try { await v.play(); } catch (e) { /* el navegador reintenta al tener datos */ }
    const track = sc.stream.getVideoTracks()[0]; const caps = track && track.getCapabilities ? track.getCapabilities() : {};
    $('#scTorch').hidden = !caps.torch; sc.torch = false; $('#scTorch').classList.remove('on');
    if (!sc.native && 'BarcodeDetector' in window) {
      try { const f = await window.BarcodeDetector.getSupportedFormats(); if (f.includes('qr_code')) sc.native = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch (e) { sc.native = null; }
    }
    if (!sc.native) { try { await loadLib('jsqr'); } catch (e) { showScError('No se pudo cargar el lector de QR. Probá con conexión una vez.'); return; } }
    sc.on = true; tick();
  }
  function showScError(msg) {
    const el = $('#scError'); el.hidden = false;
    el.innerHTML = `<p>${esc(msg)}</p><button class="btn primary" id="scRetry">Reintentar</button>`;
    $('#scRetry', el).onclick = () => startCamera();
  }
  function stopCamera() {
    sc.on = false; clearTimeout(sc.timer);
    if (sc.stream) { sc.stream.getTracks().forEach((t) => t.stop()); sc.stream = null; }
    $('#scVideo').srcObject = null;
  }
  async function tick() {
    if (!sc.on) return;
    const v = $('#scVideo'); let next = 90;
    if (v.readyState >= 2 && v.videoWidth && !sc.busy) {
      try {
        let text = null;
        if (sc.native) { const r = await sc.native.detect(v); if (r.length) text = r[0].rawValue; }
        else if (window.jsQR) {
          const k = Math.min(1, 640 / Math.max(v.videoWidth, v.videoHeight));
          const w = Math.round(v.videoWidth * k); const h = Math.round(v.videoHeight * k);
          const c = $('#scCanvas'); c.width = w; c.height = h;
          const cx = c.getContext('2d', { willReadFrequently: true }); cx.drawImage(v, 0, 0, w, h);
          const data = cx.getImageData(0, 0, w, h);
          const r = window.jsQR(data.data, w, h, { inversionAttempts: (++sc.n % 4 === 0) ? 'attemptBoth' : 'dontInvert' });
          if (r && r.data) text = r.data;
          next = 60;
        }
        if (text) handleScanned(text, 'qr');
      } catch (e) { if (sc.native) sc.native = null; }
    }
    if (sc.on) sc.timer = setTimeout(tick, next);
  }
  async function openScanner() {
    if (!state.att.length && !state.extras.length && !(await confirmSheet('Todavía no hay lista', 'Podés escanear igual: todo lo leído quedará “por verificar”. Para comparar con los asistentes, primero importá la lista.', 'Escanear igual'))) return;
    audio(); // desbloquea el sonido con un gesto del usuario
    $('#scanner').hidden = false; document.body.style.overflow = 'hidden'; hideMsg(); syncSoundBtn(); renderStats();
    sc.facing = state.settings.facing || 'environment'; sc.busy = false;
    startCamera();
  }
  function closeScanner() {
    stopCamera(); $('#scanner').hidden = true; document.body.style.overflow = ''; hideMsg(); renderAll();
  }
  async function decodePhoto(file) {
    try {
      await loadLib('jsqr');
      let bmp; try { bmp = await createImageBitmap(file); } catch (e) { bmp = await new Promise((res, rej) => { const u = URL.createObjectURL(file); const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = u; }); }
      const w0 = bmp.width || bmp.naturalWidth; const h0 = bmp.height || bmp.naturalHeight; const k = Math.min(1, 1400 / Math.max(w0, h0));
      const c = document.createElement('canvas'); c.width = Math.round(w0 * k); c.height = Math.round(h0 * k);
      const cx = c.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0, c.width, c.height);
      const d = cx.getImageData(0, 0, c.width, c.height);
      const r = window.jsQR(d.data, c.width, c.height, { inversionAttempts: 'attemptBoth' });
      if (!r || !r.data) { toast('No encontré un QR en esa imagen'); return; }
      handleScanned(r.data, 'foto');
    } catch (e) { toast('No se pudo leer la imagen'); }
  }
  function typeCodeSheet() {
    const was = sc.busy; sc.busy = true;
    openSheet(`<h2>Escribir código</h2><p class="muted">Escribí o pegá lo que dice el QR (código, DNI, nombre…).</p>
      <label class="field"><input type="text" id="tcV" placeholder="Código o dato del asistente" autocomplete="off" autocapitalize="off"></label>
      <div class="sheet-actions"><button class="btn ghost" id="tcC">Cancelar</button><button class="btn primary" id="tcOk">Registrar</button></div>`,
    (root) => {
      const go = () => { const v = $('#tcV', root).value.trim(); if (!v) return; sc.busy = was; closeSheet(); handleScanned(v, 'texto'); };
      $('#tcC', root).onclick = closeSheet; $('#tcOk', root).onclick = go;
      $('#tcV', root).addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
      setTimeout(() => $('#tcV', root).focus(), 60);
    }, () => { if (sc.busy && $('#sheet').hidden) sc.busy = was; });
  }

  /* ---------- Eventos ---------- */
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('#sheetClose') || t.id === 'sheetBackdrop') { closeSheet(); return; }
    if (t.closest('#btnEvent')) { openEventSheet(); return; }
    if (t.closest('#btnMenu')) { openMenu(); return; }
    if (t.closest('#btnExport')) { openExport(); return; }
    if (t.closest('#btnScan')) { openScanner(); return; }
    const tab = t.closest('[data-tab]');
    if (tab) { ui.tab = tab.dataset.tab; ui.limit = 150; renderAll(); return; }
    // dentro del panel
    const act = t.closest('[data-act]');
    if (act) { if (act.dataset.act === 'import') $('#fileXlsx').click(); else if (act.dataset.act === 'event') openEventSheet(); return; }
    const fil = t.closest('[data-fil]'); if (fil) { ui.filter = fil.dataset.fil; ui.limit = 150; renderPanel(); return; }
    const exf = t.closest('[data-exf]'); if (exf) { ui.exFilter = exf.dataset.exf; renderPanel(); return; }
    if (t.closest('[data-more]')) { ui.limit += 150; renderPanel(); return; }
    const att = t.closest('[data-att]'); if (att) { openAttendee(att.dataset.att); return; }
    const exs = t.closest('#panel [data-ex][data-set]');
    if (exs) {
      const ex = findExtra(exs.dataset.ex); if (!ex) return;
      const undo = setExtraStatus(ex, exs.dataset.set); renderAll();
      toast(exs.dataset.set === 'valid' ? 'Ingreso dado por válido' : 'Ingreso rechazado', { label: 'Deshacer', fn: undo });
    }
  });
  document.addEventListener('input', (e) => {
    if (e.target.id === 'search') { ui.q = e.target.value; ui.limit = 150; renderListBody(); }
  });
  $('#scClose').onclick = closeScanner;
  $('#scFlip').onclick = () => { sc.facing = sc.facing === 'environment' ? 'user' : 'environment'; state.settings.facing = sc.facing; saveState(); stopCamera(); startCamera(); };
  $('#scSound').onclick = () => { state.settings.sound = !state.settings.sound; saveState(); syncSoundBtn(); if (state.settings.sound) feedback('ok'); };
  $('#scTorch').onclick = async () => {
    const track = sc.stream && sc.stream.getVideoTracks()[0]; if (!track) return;
    try { sc.torch = !sc.torch; await track.applyConstraints({ advanced: [{ torch: sc.torch }] }); $('#scTorch').classList.toggle('on', sc.torch); } catch (e) { sc.torch = false; toast('Esta cámara no tiene linterna'); }
  };
  $('#scType').onclick = typeCodeSheet;
  $('#scPhoto').onclick = () => $('#filePhoto').click();
  $('#fileXlsx').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) onXlsxChosen(f); });
  $('#fileJson').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) onJsonChosen(f); });
  $('#fileBg').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) onBgChosen(f); });
  $('#filePhoto').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) decodePhoto(f); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (!$('#sheet').hidden) closeSheet(); else if (!$('#scanner').hidden) closeScanner(); } });
  document.addEventListener('visibilitychange', () => {
    if ($('#scanner').hidden) return;
    if (document.visibilityState === 'hidden') stopCamera(); else if (!sc.stream) startCamera();
  });
  window.addEventListener('storage', (e) => { if (e.key === STORAGE_KEY && e.newValue) { state = loadState(); idx = null; sIdx = null; window.Palettes.apply(state.settings.palette, state.settings.theme); applyBgLook(); renderAll(); } });

  /* ---------- Conexión, instalación y actualizaciones ---------- */
  function updateOnline() { $('#offlinePill').hidden = navigator.onLine; }
  window.addEventListener('online', updateOnline); window.addEventListener('offline', updateOnline);
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  if (isIOS() && !isStandalone() && !state.iosHintClosed) $('#iosHint').hidden = false;
  $('#iosHintClose').addEventListener('click', () => { $('#iosHint').hidden = true; state.iosHintClosed = true; saveState(); });

  let swReg = null;
  async function checkForUpdate(verbose) {
    if (!swReg) { if (verbose) toast('Las actualizaciones automáticas no están disponibles en este navegador'); return; }
    if (!navigator.onLine) { if (verbose) toast('Sin conexión: probá cuando tengas señal'); return; }
    try { await swReg.update(); if (verbose && !swReg.installing && !swReg.waiting) toast(`Ya tenés la última versión (v${APP_VERSION})`); } catch (e) { if (verbose) toast('No se pudo buscar la actualización'); }
  }
  async function forceUpdate() {
    if (!navigator.onLine) { toast('Sin conexión: probá cuando tengas señal'); return; }
    saveState();
    try {
      if ('serviceWorker' in navigator) { const regs = await navigator.serviceWorker.getRegistrations(); await Promise.all(regs.map((r) => r.unregister())); }
      if (window.caches) { const keys = await caches.keys(); await Promise.all(keys.map((k) => caches.delete(k))); }
      await Promise.all(['./', './index.html', './js/app.js', './js/palettes.js', './css/styles.css', './sw.js', './manifest.webmanifest'].map((u) => fetch(u, { cache: 'reload' }).catch(() => null)));
    } catch (e) { /* noop */ }
    location.replace(location.pathname + '?v=' + Date.now());
  }
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then((reg) => {
        swReg = reg; reg.update().catch(() => {});
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForUpdate(false); });
        const promptUpdate = (worker) => toast('Hay una nueva versión disponible', { label: 'Actualizar', fn: () => worker.postMessage({ type: 'SKIP_WAITING' }) });
        if (reg.waiting && navigator.serviceWorker.controller) promptUpdate(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing; if (!nw) return;
          nw.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) promptUpdate(nw); });
        });
      }).catch((err) => console.warn('SW no registrado', err));
      let reloaded = false; const hadController = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloaded) { reloaded = true; location.reload(); } });
    });
  }

  /* ---------- Inicio ---------- */
  window.ControlIngreso = { processScan, matchAttendee, getState: () => state }; // útil para pruebas
  if (/[?&]v=\d+/.test(location.search)) { try { window.history.replaceState(null, '', location.pathname); toast(`App actualizada a v${APP_VERSION}`); } catch (e) { /* noop */ } }
  window.Palettes.apply(state.settings.palette, state.settings.theme);
  applyBgLook();
  bgGet().then((u) => { if (u) applyBg(u); });
  updateOnline(); syncSoundBtn(); saveState(); renderAll();
})();
