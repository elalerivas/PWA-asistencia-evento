/* Paletas de color y tema.
   Se carga en <head> para pintar con la paleta elegida antes del primer cuadro (sin parpadeo). */
(function () {
  var PALETTES = [
    { id: 'vino',     name: 'Vino tinto',        light: { brand: '#5A1627', accent: '#7A1F36', soft: '#F4E8EB', bg: '#F8F3F4', surface: '#FFFFFF' }, dark: { brand: '#1D0C12', accent: '#D8829A', soft: '#3B1D28', bg: '#150A0E', surface: '#22131A' } },
    { id: 'cerulo',   name: 'Azul cerúleo',      light: { brand: '#0B4F6C', accent: '#0A7EA4', soft: '#E3F1F6', bg: '#F1F6F9', surface: '#FFFFFF' }, dark: { brand: '#07202C', accent: '#5CBBDD', soft: '#143646', bg: '#0A141A', surface: '#112028' } },
    { id: 'carmin',   name: 'Laca carminada',    light: { brand: '#8A1327', accent: '#B8203A', soft: '#FBE7EA', bg: '#FAF4F4', surface: '#FFFFFF' }, dark: { brand: '#2A0A11', accent: '#F07A8E', soft: '#451A24', bg: '#190B0F', surface: '#271318' } },
    { id: 'botella',  name: 'Verde botella',     light: { brand: '#143A2C', accent: '#2C6B50', soft: '#E4F0EA', bg: '#F2F6F4', surface: '#FFFFFF' }, dark: { brand: '#0A1C15', accent: '#6CC49E', soft: '#18382B', bg: '#0A1310', surface: '#111E19' } },
    { id: 'ciruela',  name: 'Ciruela',           light: { brand: '#3F2049', accent: '#6C3B7C', soft: '#F0E8F3', bg: '#F6F3F7', surface: '#FFFFFF' }, dark: { brand: '#1B0E21', accent: '#C393D3', soft: '#352040', bg: '#130B17', surface: '#1E1325' } },
    { id: 'prusia',   name: 'Azul de Prusia',    light: { brand: '#13264A', accent: '#2D4F8E', soft: '#E6ECF6', bg: '#F3F5F9', surface: '#FFFFFF' }, dark: { brand: '#0A1226', accent: '#86A8E8', soft: '#1A2B4D', bg: '#0B1019', surface: '#121A29' } },
    { id: 'siena',    name: 'Siena tostada',     light: { brand: '#58341A', accent: '#A25B2A', soft: '#F6EBE1', bg: '#F9F5F1', surface: '#FFFFFF' }, dark: { brand: '#24150A', accent: '#E1A06C', soft: '#43291A', bg: '#17100B', surface: '#231910' } },
    { id: 'grafito',  name: 'Grafito',           light: { brand: '#24282F', accent: '#4B5565', soft: '#E9ECF0', bg: '#F4F5F7', surface: '#FFFFFF' }, dark: { brand: '#0E1013', accent: '#A9B3C4', soft: '#262B33', bg: '#0E1013', surface: '#171A1F' } }
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
  function apply(paletteId, theme) {
    var p = find(paletteId);
    var dark = isDark(theme);
    var c = dark ? p.dark : p.light;
    var r = document.documentElement;
    r.dataset.mode = dark ? 'dark' : 'light';
    r.style.colorScheme = dark ? 'dark' : 'light';
    r.style.setProperty('--brand', c.brand);
    r.style.setProperty('--accent', c.accent);
    r.style.setProperty('--accent-soft', c.soft);
    r.style.setProperty('--bg', c.bg);
    r.style.setProperty('--surface', c.surface);
    var m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', c.brand);
  }

  window.PALETTES = PALETTES;
  window.Palettes = { find: find, apply: apply, isDark: isDark };

  var s = read();
  apply(s.palette || 'vino', s.theme || 'auto');
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var onChange = function () { var st = read(); if ((st.theme || 'auto') === 'auto') apply(st.palette || 'vino', 'auto'); };
    if (mq.addEventListener) mq.addEventListener('change', onChange); else if (mq.addListener) mq.addListener(onChange);
  }
})();
