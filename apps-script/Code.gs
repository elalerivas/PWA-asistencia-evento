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
 */

const CLAVE = 'cambiar-esta-clave';   // ← poné una clave propia, de 6 caracteres o más
const HOJA = '';                       // nombre de la pestaña con la lista; vacío = la primera
const FILA_TITULOS = 0;                // 0 = detectarla sola; o el número de la fila de títulos
const COL_INGRESADO = 'INGRESADO';
const COL_HORA = 'HORA INGRESO';
const COL_POR = 'REGISTRADO POR';
const FORMATO_HORA = 'dd/mm/yyyy hh:mm:ss';

const PROTO = 1;
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
  return { ok: true, proto: PROTO, hoja: m.sh.getName(), libro: SpreadsheetApp.getActiveSpreadsheet().getName(), filas: m.filas.length, ingresados: m.marks.length };
}

function pull_() {
  const m = modelo_(true, false);
  return {
    ok: true, proto: PROTO, hoja: m.sh.getName(), libro: SpreadsheetApp.getActiveSpreadsheet().getName(),
    headers: m.headers, rows: m.filas.map(function (f) { return { r: f.r, s: f.s, c: f.c }; }),
    marks: m.marks, lh: m.lh, mh: m.mh
  };
}

/** Aplica los ingresos pendientes de un teléfono (si trae) y devuelve el estado actual de la hoja. */
function sync_(req) {
  const ops = Array.isArray(req.ops) ? req.ops : [];
  let results = [];
  let m;
  if (ops.length) {
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(15000)) return { ok: false, err: 'ocupado' };
    try {
      m = modelo_(true, true);
      results = aplicar_(m, ops);
      m = modelo_(false, true);
    } finally { lock.releaseLock(); }
  } else {
    m = modelo_(true, false);
  }
  const out = { ok: true, proto: PROTO, lh: m.lh, mh: m.mh, results: results };
  if (req.mh !== m.mh || req.lh !== m.lh) out.marks = m.marks;
  return out;
}

/* ------------------------------------------------------------------ modelo */

/**
 * Lee la hoja y arma: títulos, filas con su firma, y quién ingresó.
 * crear: agrega las columnas de ingreso si faltan.  bloqueado: el que llama ya tiene el candado.
 */
function modelo_(crear, bloqueado) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = HOJA ? ss.getSheetByName(HOJA) : ss.getSheets()[0];
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
      sh.getRange(f.r, m.cP).setValue(f.marca ? f.b : '');
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
  rH.setNumberFormat(FORMATO_HORA);
  rE.setValues(vE); rH.setValues(vH); rP.setValues(vP);
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
