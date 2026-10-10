/**
 * Control de Ingreso — sincronización con Google Sheets (v1)
 *
 * CÓMO INSTALARLO (una sola vez, ver también apps-script/LEEME.md):
 *   1. Abrí la hoja de cálculo de Google con la lista de asistentes.
 *   2. Extensiones → Apps Script. Borrá lo que haya y pegá TODO este archivo.
 *   3. Cambiá la CLAVE de abajo por una propia (la misma que vas a escribir en la app).
 *   4. Implementar → Nueva implementación → tipo «Aplicación web».
 *        Ejecutar como: Yo        Quién tiene acceso: Cualquier persona
 *   5. Autorizá los permisos y copiá la URL que termina en /exec: es la que va en la app.
 *
 * Qué hace: agrega (si no existen) las columnas INGRESADO, HORA INGRESO y REGISTRADO POR,
 * y deja que los teléfonos lean y escriban quién ingresó. No toca ninguna otra columna.
 * Los QR que no figuran en la lista se anotan en una pestaña aparte, «No listados»,
 * con su estado (Por verificar / Válido / Rechazado); la lista original no se toca.
 */

const CLAVE = 'cambiar-esta-clave';   // ← poné una clave propia, de 6 caracteres o más
const HOJA = '';                       // nombre de la pestaña con la lista; vacío = la primera
const FILA_TITULOS = 0;                // 0 = detectarla sola; o el número de la fila de títulos
const COL_INGRESADO = 'INGRESADO';
const COL_HORA = 'HORA INGRESO';
const COL_POR = 'REGISTRADO POR';
const FORMATO_HORA = 'dd/mm/yyyy hh:mm:ss';
const HOJA_NO_LISTADOS = 'No listados';   // pestaña donde se anotan los QR que no están en la lista

const PROTO = 2;
const X_LECTURA = 'LECTURA', X_HORA = 'HORA LECTURA', X_ESTADO = 'ESTADO', X_HDEC = 'HORA DECISIÓN', X_POR = 'REGISTRADO POR', X_DEC = 'DECIDIDO POR', X_ID = 'ID';
const X_COLS = [X_LECTURA, X_HORA, X_ESTADO, X_HDEC, X_POR, X_DEC, X_ID];
const ESTADO_TXT = { pending: 'Por verificar', valid: 'Válido', rejected: 'Rechazado' };
const MARCAS = ['si', 'sí', 'x', '1', 'true', 'verdadero', 'yes', 'ok', 'ingresado', 'presente', '✔', '✓'];

/* ------------------------------------------------------------------ entrada */

function doGet() {
  return ContentService.createTextOutput('Control de Ingreso: el script está publicado y activo (protocolo ' + PROTO + ').');
}

function doPost(e) {
  let req;
  try { req = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return salida_({ ok: false, err: 'formato' }); }
  if (CLAVE === 'cambiar-esta-clave' || String(CLAVE).length < 6) return salida_({ ok: false, err: 'config' });
  if (req.key !== CLAVE) return salida_({ ok: false, err: 'clave' });
  try {
    if (req.action === 'ping') return salida_(ping_());
    if (req.action === 'pull') return salida_(pull_());
    if (req.action === 'sync') return salida_(sync_(req));
    return salida_({ ok: false, err: 'accion' });
  } catch (err) {
    return salida_({ ok: false, err: err && err.code ? err.code : 'script', msg: String((err && err.message) || err) });
  }
}

function salida_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* --------------------------------------------------------------- acciones */

function ping_() {
  const m = modelo_(true, false);
  const x = extras_(true, false);
  return { ok: true, proto: PROTO, hoja: m.sh.getName(), libro: SpreadsheetApp.getActiveSpreadsheet().getName(), filas: m.filas.length, ingresados: m.marks.length, noListados: x.list.length };
}

function pull_() {
  const m = modelo_(true, false);
  const x = extras_(true, false);
  return {
    ok: true, proto: PROTO, hoja: m.sh.getName(), libro: SpreadsheetApp.getActiveSpreadsheet().getName(),
    headers: m.headers, rows: m.filas.map(function (f) { return { r: f.r, s: f.s, c: f.c }; }),
    marks: m.marks, lh: m.lh, mh: m.mh, extras: x.list, xh: x.xh
  };
}

/** Aplica los cambios pendientes de un teléfono (si trae) y devuelve el estado actual de la hoja. */
function sync_(req) {
  const ops = Array.isArray(req.ops) ? req.ops : [];
  let results = [];
  let m, x;
  if (ops.length) {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(15000)) return { ok: false, err: 'ocupado' };
    try {
      m = modelo_(true, true);
      results = aplicar_(m, ops.filter(function (o) { return o.k !== 'x'; }));
      x = extras_(true, true);
      results = results.concat(aplicarX_(x, ops.filter(function (o) { return o.k === 'x'; })));
      m = modelo_(false, true);
      x = extras_(false, true);
    } finally { lock.releaseLock(); }
  } else {
    m = modelo_(true, false);
    x = extras_(false, false);
  }
  const out = { ok: true, proto: PROTO, lh: m.lh, mh: m.mh, xh: x.xh, results: results };
  if (req.mh !== m.mh || req.lh !== m.lh) out.marks = m.marks;
  if (req.xh !== x.xh) out.extras = x.list;
  return out;
}

/* ------------------------------------------------------------------ modelo */

/**
 * Lee la hoja y arma: títulos, filas con su firma, y quién ingresó.
 * crear: agrega las columnas de ingreso si faltan.  bloqueado: el que llama ya tiene el candado.
 */
function modelo_(crear, bloqueado) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = HOJA ? ss.getSheetByName(HOJA) : ss.getSheets().filter(function (h) { return h.getName() !== HOJA_NO_LISTADOS; })[0];
  if (!sh) { const er = new Error('No encuentro la pestaña «' + HOJA + '».'); er.code = 'hoja'; throw er; }
  const ultCol = Math.max(sh.getLastColumn(), 1);
  const ultFila = Math.max(sh.getLastRow(), 1);
  const todo = sh.getRange(1, 1, ultFila, ultCol).getDisplayValues();
  const hr = FILA_TITULOS > 0 ? FILA_TITULOS : detectar_(todo);        // 1-based
  const tit = (todo[hr - 1] || []).map(function (v) { return String(v).trim(); });

  let cE = pos_(tit, COL_INGRESADO), cH = pos_(tit, COL_HORA), cP = pos_(tit, COL_POR);   // 1-based; 0 = no existe
  if (crear && (!cE || !cH || !cP)) {
    const lock = bloqueado ? null : LockService.getScriptLock();
    if (lock && !lock.tryLock(15000)) { const er = new Error('ocupado'); er.code = 'ocupado'; throw er; }
    try {
      let c = ultCol;
      if (!cE) { c++; sh.getRange(hr, c).setValue(COL_INGRESADO); cE = c; }
      if (!cH) { c++; sh.getRange(hr, c).setValue(COL_HORA); cH = c; }
      if (!cP) { c++; sh.getRange(hr, c).setValue(COL_POR); cP = c; }
    } finally { if (lock) lock.releaseLock(); }
    return modelo_(false, bloqueado);
  }

  const nDatos = Math.max(ultFila - hr, 0);
  const horas = (cH && nDatos) ? sh.getRange(hr + 1, cH, nDatos, 1).getValues() : [];
  const estado = [cE, cH, cP];

  // columnas con contenido: las que tienen título o algún dato, menos las tres nuestras
  const cols = [];
  for (let j = 1; j <= ultCol; j++) {
    if (estado.indexOf(j) >= 0) continue;
    let uso = tit[j - 1] !== '';
    for (let i = hr; i < ultFila && !uso; i++) if (String(todo[i][j - 1]).trim() !== '') uso = true;
    if (uso) cols.push(j);
  }
  const headers = cols.map(function (j) { return tit[j - 1] || ('Columna ' + j); });

  const filas = []; const marks = []; const vistas = {};
  for (let i = hr; i < ultFila; i++) {
    const fila = todo[i];
    const c = cols.map(function (j) { return String(fila[j - 1]).trim(); });
    if (!c.some(function (v) { return v !== ''; })) continue;
    let s = hash_(c.map(norm_).join('|'));
    vistas[s] = (vistas[s] || 0) + 1;
    if (vistas[s] > 1) s += '~' + vistas[s];
    const marca = cE ? esMarca_(fila[cE - 1]) : false;
    let t = null;
    if (marca && cH) { const hv = horas[i - hr] ? horas[i - hr][0] : ''; t = aMs_(hv); }
    const b = (marca && cP) ? String(fila[cP - 1]).trim() : '';
    filas.push({ r: i + 1, s: s, c: c, marca: marca, t: t, b: b });
    if (marca) marks.push({ s: s, t: t, b: b });
  }
  return {
    sh: sh, hr: hr, ultFila: ultFila, cE: cE, cH: cH, cP: cP, headers: headers, filas: filas, marks: marks,
    lh: hash_(filas.map(function (f) { return f.s; }).join(',')),
    mh: hash_(marks.map(function (k) { return k.s + ':' + k.t + ':' + k.b; }).join(','))
  };
}

function aplicar_(m, ops) {
  if (!m.cE || !m.cH || !m.cP) { const er = new Error('Faltan las columnas de ingreso'); er.code = 'script'; throw er; }
  const porSig = {}; m.filas.forEach(function (f) { porSig[f.s] = f; });
  const res = []; const cambios = [];
  ops.forEach(function (op) {
    const f = porSig[op.sig];
    if (!f) { res.push({ q: op.q, ok: false, err: 'nofila' }); return; }
    const por = String(op.b || '').slice(0, 60);
    if (op.v) {
      if (f.marca) { res.push({ q: op.q, ok: true, already: true, same: f.b === por, t: f.t, b: f.b }); return; }
      f.marca = true; f.t = Number(op.t) || Date.now(); f.b = por;
    } else { f.marca = false; f.t = null; f.b = ''; }
    cambios.push(f);
    res.push({ q: op.q, ok: true });
  });
  if (cambios.length) escribir_(m, cambios);
  return res;
}

function escribir_(m, cambios) {
  const sh = m.sh;
  if (cambios.length <= 10) {
    cambios.forEach(function (f) {
      sh.getRange(f.r, m.cE).setValue(f.marca ? 'SÍ' : '');
      const h = sh.getRange(f.r, m.cH);
      if (f.marca) { h.setNumberFormat(FORMATO_HORA); h.setValue(new Date(f.t)); } else h.setValue('');
      const p = sh.getRange(f.r, m.cP);
      p.setNumberFormat('@'); p.setValue(f.marca ? f.b : '');   // texto plano: nunca se interpreta como fórmula
    });
    return;
  }
  // muchos cambios (p. ej. un teléfono que volvió a tener señal): se escriben las tres columnas de una vez
  const n = m.ultFila - m.hr;
  const rE = sh.getRange(m.hr + 1, m.cE, n, 1), rH = sh.getRange(m.hr + 1, m.cH, n, 1), rP = sh.getRange(m.hr + 1, m.cP, n, 1);
  const vE = rE.getValues(), vH = rH.getValues(), vP = rP.getValues();
  cambios.forEach(function (f) {
    const k = f.r - m.hr - 1;
    vE[k][0] = f.marca ? 'SÍ' : ''; vH[k][0] = f.marca ? new Date(f.t) : ''; vP[k][0] = f.marca ? f.b : '';
  });
  rH.setNumberFormat(FORMATO_HORA); rP.setNumberFormat('@');
  rE.setValues(vE); rH.setValues(vH); rP.setValues(vP);
}

/* ------------------------------------------------------ pestaña «No listados» */

/**
 * Lee (y si hace falta crea) la pestaña donde se anotan los QR que no estaban en la lista.
 * Una fila por lectura, identificada por una ID que genera la app. Se puede cambiar ESTADO a mano en la hoja.
 */
function extras_(crear, bloqueado) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(HOJA_NO_LISTADOS);
  const vacio = { sh: null, c: null, filas: [], list: [], ult: 1, xh: hash_('') };
  if (!sh && !crear) return vacio;
  if (crear) {
    const lock = bloqueado ? null : LockService.getScriptLock();
    if (lock && !lock.tryLock(15000)) { const er = new Error('ocupado'); er.code = 'ocupado'; throw er; }
    try {
      if (!sh) { sh = ss.insertSheet(HOJA_NO_LISTADOS, ss.getSheets().length); sh.setFrozenRows(1); }
      let ult = sh.getLastColumn();
      const tit0 = ult ? sh.getRange(1, 1, 1, ult).getDisplayValues()[0].map(function (v) { return String(v).trim(); }) : [];
      X_COLS.forEach(function (nombre) {
        if (pos_(tit0, nombre) === 0) { ult++; sh.getRange(1, ult).setValue(nombre).setFontWeight('bold'); tit0[ult - 1] = nombre; }
      });
    } finally { if (lock) lock.releaseLock(); }
  }
  const ultCol = Math.max(sh.getLastColumn(), 1), ultFila = Math.max(sh.getLastRow(), 1);
  const tit = sh.getRange(1, 1, 1, ultCol).getDisplayValues()[0].map(function (v) { return String(v).trim(); });
  const c = {};
  for (let i = 0; i < X_COLS.length; i++) { c[X_COLS[i]] = pos_(tit, X_COLS[i]); if (!c[X_COLS[i]]) return vacio; }
  const vals = ultFila > 1 ? sh.getRange(2, 1, ultFila - 1, ultCol).getValues() : [];
  const filas = [];
  vals.forEach(function (v, i) {
    const raw = String(v[c[X_LECTURA] - 1] == null ? '' : v[c[X_LECTURA] - 1]).trim();
    const idc = String(v[c[X_ID] - 1] == null ? '' : v[c[X_ID] - 1]).trim();
    if (!raw && !idc) return;
    filas.push({
      r: i + 2, id: idc || ('f' + hash_(norm_(raw))), sinId: !idc, raw: raw,
      at: aMs_(v[c[X_HORA] - 1]), st: estadoDe_(v[c[X_ESTADO] - 1]), dat: aMs_(v[c[X_HDEC] - 1]),
      b: String(v[c[X_POR] - 1] || '').trim(), db: String(v[c[X_DEC] - 1] || '').trim()
    });
  });
  return {
    sh: sh, c: c, filas: filas, ult: ultFila,
    list: filas.map(function (f) { return { id: f.id, raw: f.raw, at: f.at, st: f.st, dat: f.dat, b: f.b, db: f.db }; }),
    xh: hash_(filas.map(function (f) { return f.id + ':' + f.st + ':' + f.dat + ':' + f.raw; }).join(','))
  };
}

/** Altas, cambios de estado y bajas de lecturas no listadas. Si la misma lectura ya existe (otro teléfono), se une a esa fila. */
function aplicarX_(x, ops) {
  const res = [];
  if (!ops.length) return res;
  const sh = x.sh, c = x.c, filas = x.filas;
  let proxima = x.ult + 1;
  const poner = function (r, col, valor, formato) {
    const rg = sh.getRange(r, c[col]);
    if (formato) rg.setNumberFormat(formato);
    rg.setValue(valor);
  };
  ops.forEach(function (op) {
    const kraw = norm_(op.raw);
    let f = null;
    for (let i = 0; i < filas.length && !f; i++) if (filas[i].id === op.id) f = filas[i];
    for (let i = 0; i < filas.length && !f && kraw; i++) if (norm_(filas[i].raw) === kraw) f = filas[i];
    if (op.del) {
      if (f) {
        sh.deleteRow(f.r); filas.splice(filas.indexOf(f), 1);
        filas.forEach(function (g) { if (g.r > f.r) g.r--; });
        proxima--;
      }
      res.push({ q: op.q, ok: true, id: f ? f.id : op.id });
      return;
    }
    const st = (op.st === 'valid' || op.st === 'rejected') ? op.st : 'pending';
    const por = String(op.b || '').slice(0, 60);
    const dat = st === 'pending' ? null : (Number(op.dat) || Date.now());
    if (!f) {
      const r = proxima++;
      f = { r: r, id: String(op.id), sinId: false, raw: String(op.raw == null ? '' : op.raw).trim().slice(0, 500), at: Number(op.at) || Date.now(), st: st, dat: dat, b: por, db: dat ? por : '' };
      poner(r, X_LECTURA, f.raw, '@');                       // texto plano: un QR que empiece con "=" no se ejecuta como fórmula
      poner(r, X_HORA, new Date(f.at), FORMATO_HORA);
      poner(r, X_ESTADO, ESTADO_TXT[st]);
      if (dat) poner(r, X_HDEC, new Date(dat), FORMATO_HORA);
      poner(r, X_POR, por, '@');
      if (dat) poner(r, X_DEC, por, '@');
      poner(r, X_ID, f.id, '@');
      filas.push(f);
    } else {
      if (f.sinId) { poner(f.r, X_ID, String(op.id), '@'); f.id = String(op.id); f.sinId = false; }
      if (f.st !== st) {
        poner(f.r, X_ESTADO, ESTADO_TXT[st]);
        if (dat) { poner(f.r, X_HDEC, new Date(dat), FORMATO_HORA); poner(f.r, X_DEC, por, '@'); f.dat = dat; f.db = por; }
        else { poner(f.r, X_HDEC, ''); poner(f.r, X_DEC, ''); f.dat = null; f.db = ''; }
        f.st = st;
      }
    }
    res.push({ q: op.q, ok: true, id: f.id });
  });
  return res;
}

/* ---------------------------------------------------------------- auxiliares */

function detectar_(todo) {
  let mejor = 0, fila = 1;
  for (let i = 0; i < Math.min(todo.length, 10); i++) {
    const n = todo[i].filter(function (v) { return String(v).trim() !== ''; }).length;
    if (n > mejor) { mejor = n; fila = i + 1; }
  }
  return fila;
}
function pos_(tit, nombre) {
  const buscado = norm_(nombre);
  for (let i = 0; i < tit.length; i++) if (norm_(tit[i]) === buscado) return i + 1;
  return 0;
}
function norm_(v) { return String(v == null ? '' : v).trim().replace(/\s+/g, ' ').toLowerCase(); }
function estadoDe_(v) {
  const n = norm_(v);
  if (n === 'válido' || n === 'valido' || n === 'si' || n === 'sí') return 'valid';
  if (n === 'rechazado' || n === 'no') return 'rejected';
  return 'pending';
}
function esMarca_(v) { return MARCAS.indexOf(norm_(v)) >= 0; }
function aMs_(v) {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'string' && v.trim()) { const p = Date.parse(v); return isNaN(p) ? null : p; }
  return null;
}
function hash_(texto) {
  const d = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, texto, Utilities.Charset.UTF_8);
  return d.slice(0, 5).map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}
