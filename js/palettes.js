/* Paletas de color, tema y nivel de contraste.
   Se carga en <head> para pintar con la paleta elegida antes del primer cuadro (sin parpadeo).
   contraste "soft" (por defecto): fondos y textos con tonos más cálidos y menos extremos.
   contraste "normal": negro/blanco más marcados. */
(function () {
  var PALETTES = [
    { id: 'vino',    name: 'Vino tinto',     light: { brand: '#5A1627', accent: '#7A1F36', soft: '#F4E8EB', bg: '#F8F3F4', surface: '#FFFFFF' }, dark: { brand: '#1D0C12', accent: '#D8829A', soft: '#3B1D28', bg: '#150A0E', surface: '#22131A' } },
    { id: 'negro-oro', name: 'Negro y oro',  keepBrand: true, light: { brand: '#17140F', accent: '#86671A', soft: '#F2EBD6', bg: '#F7F3E9', surface: '#FFFFFF' }, dark: { brand: '#0A0907', accent: '#D8B450', soft: '#2A2412', bg: '#0F0E0B', surface: '#1A1812' } },
    { id: 'cerulo',  name: 'Azul cerúleo',   light: { brand: '#0B4F6C', accent: '#08759A', soft: '#E3F1F6', bg: '#F1F6F9', surface: '#FFFFFF' }, dark: { brand: '#07202C', accent: '#5CBBDD', soft: '#143646', bg: '#0A141A', surface: '#112028' } },
    { id: 'carmin',  name: 'Laca carminada', light: { brand: '#8A1327', accent: '#B8203A', soft: '#FBE7EA', bg: '#FAF4F4', surface: '#FFFFFF' }, dark: { brand: '#2A0A11', accent: '#F07A8E', soft: '#451A24', bg: '#190B0F', surface: '#271318' } },
    { id: 'botella', name: 'Verde botella',  light: { brand: '#143A2C', accent: '#2C6B50', soft: '#E4F0EA', bg: '#F2F6F4', surface: '#FFFFFF' }, dark: { brand: '#0A1C15', accent: '#6CC49E', soft: '#18382B', bg: '#0A1310', surface: '#111E19' } },
    { id: 'ciruela', name: 'Ciruela',        light: { brand: '#3F2049', accent: '#6C3B7C', soft: '#F0E8F3', bg: '#F6F3F7', surface: '#FFFFFF' }, dark: { brand: '#1B0E21', accent: '#C393D3', soft: '#352040', bg: '#130B17', surface: '#1E1325' } },
    { id: 'prusia',  name: 'Azul de Prusia', light: { brand: '#13264A', accent: '#2D4F8E', soft: '#E6ECF6', bg: '#F3F5F9', surface: '#FFFFFF' }, dark: { brand: '#0A1226', accent: '#86A8E8', soft: '#1A2B4D', bg: '#0B1019', surface: '#121A29' } },
    { id: 'siena',   name: 'Siena tostada',  light: { brand: '#58341A', accent: '#A25B2A', soft: '#F6EBE1', bg: '#F9F5F1', surface: '#FFFFFF' }, dark: { brand: '#24150A', accent: '#E1A06C', soft: '#43291A', bg: '#17100B', surface: '#231910' } },
    { id: 'grafito', name: 'Grafito',        light: { brand: '#24282F', accent: '#4B5565', soft: '#E9ECF0', bg: '#F4F5F7', surface: '#FFFFFF' }, dark: { brand: '#0E1013', accent: '#A9B3C4', soft: '#262B33', bg: '#0E1013', surface: '#171A1F' } },
    { id: 'salvia',  name: 'Salvia',         light: { brand: '#3C5547', accent: '#587A67', soft: '#E4EDE7', bg: '#F2F5F2', surface: '#FFFFFF' }, dark: { brand: '#16231C', accent: '#8DBBA2', soft: '#22362B', bg: '#0F1612', surface: '#18221C' } },
    { id: 'rosa',    name: 'Rosa antiguo',   light: { brand: '#6E4350', accent: '#A0586A', soft: '#F4E5E9', bg: '#FAF4F5', surface: '#FFFFFF' }, dark: { brand: '#241418', accent: '#E4A3B2', soft: '#3A2229', bg: '#170E11', surface: '#22161A' } },
    { id: 'niebla',  name: 'Azul niebla',    light: { brand: '#38526B', accent: '#52759A', soft: '#E3EBF3', bg: '#F2F5F9', surface: '#FFFFFF' }, dark: { brand: '#121C27', accent: '#8FB0D3', soft: '#1E2E40', bg: '#0D141C', surface: '#151E29' } },
    { id: 'lino',    name: 'Lino y arena',   light: { brand: '#665641', accent: '#80653A', soft: '#EFE7D8', bg: '#F8F5EE', surface: '#FFFFFF' }, dark: { brand: '#231C12', accent: '#D2B27D', soft: '#382E1D', bg: '#15110B', surface: '#201A12' } }
  ];
  var KEY = 'controlIngreso.v1';

  function read() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}').settings || {}; } catch (e) { return {}; }
  }
  function isDark(theme) {
    if (theme === 'dark') return true;
    if (theme === 'light') return false;
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }
  function find(id) {
    for (var i = 0; i < PALETTES.length; i++) if (PALETTES[i].id === id) return PALETTES[i];
    return PALETTES[0];
  }
  function h2r(h) { var n = parseInt(String(h).replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function r2h(r) { return '#' + r.map(function (v) { v = Math.max(0, Math.min(255, Math.round(v))); return (v < 16 ? '0' : '') + v.toString(16); }).join(''); }
  /** Mezcla a con b; t = proporción de b (0..1) */
  function mix(a, b, t) { var x = h2r(a), y = h2r(b); return r2h([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]); }
  function lum(h) { var c = h2r(h).map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }
  function ratio(a, b) { var l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); }

  /** Calcula todos los colores de una paleta para un modo y un nivel de contraste */
  function compute(paletteId, dark, contrast) {
    var p = find(paletteId); var c = dark ? p.dark : p.light; var soft = contrast !== 'normal';
    var brand = c.brand; var bg = c.bg; var surface = c.surface; var text; var muted;
    if (!dark) {
      text = soft ? mix('#463D41', c.brand, 0.14) : '#1E1A1C';
      if (soft) { bg = mix(c.bg, c.accent, 0.08); surface = mix(c.surface, c.bg, 0.45); if (!p.keepBrand) brand = mix(c.brand, c.accent, 0.36); }
    } else {
      text = soft ? mix('#E3DBDD', c.accent, 0.06) : '#F2EAEC';
      if (soft) { bg = mix(c.bg, c.accent, 0.05); surface = mix(c.surface, c.accent, 0.04); }
    }
    muted = dark ? mix(text, surface, soft ? 0.3 : 0.38) : mix(text, surface, soft ? 0.14 : 0.26);
    var onAccent = ratio('#FFFFFF', c.accent) >= ratio('#17110F', c.accent) ? '#FFFFFF' : '#17110F';
    return { brand: brand, accent: c.accent, accentSoft: c.soft, bg: bg, surface: surface, text: text, muted: muted, onAccent: onAccent };
  }
  function apply(paletteId, theme, contrast) {
    var dark = isDark(theme); var k = compute(paletteId, dark, contrast);
    var r = document.documentElement;
    r.dataset.mode = dark ? 'dark' : 'light';
    r.dataset.contrast = contrast === 'normal' ? 'normal' : 'soft';
    r.style.colorScheme = dark ? 'dark' : 'light';
    r.style.setProperty('--brand', k.brand);
    r.style.setProperty('--accent', k.accent);
    r.style.setProperty('--accent-soft', k.accentSoft);
    r.style.setProperty('--bg', k.bg);
    r.style.setProperty('--surface', k.surface);
    r.style.setProperty('--text', k.text);
    r.style.setProperty('--muted', k.muted);
    r.style.setProperty('--on-accent', k.onAccent);
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', k.brand);
  }

  window.PALETTES = PALETTES;
  window.Palettes = { find: find, apply: apply, compute: compute, ratio: ratio, isDark: isDark };

  var s = read();
  apply(s.palette || 'vino', s.theme || 'auto', s.contrast || 'soft');
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var onChange = function () { var st = read(); if ((st.theme || 'auto') === 'auto') apply(st.palette || 'vino', 'auto', st.contrast || 'soft'); };
    if (mq.addEventListener) mq.addEventListener('change', onChange); else if (mq.addListener) mq.addListener(onChange);
  }
})();
