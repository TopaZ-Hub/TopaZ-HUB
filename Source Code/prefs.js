'use strict';
/* ==========================================================
   Preferencje: Ogólne, Wydajność i GPU, Pamięć, Odtwarzanie, Eksport
   ========================================================== */
(() => {
const S = TZ.state, h = TZ.h, N = window.native || null;
let sys = null;
TZ.sysInfo = async () => {
  if (sys) return sys;
  if (N && N.sysInfo) { try { sys = await N.sysInfo(); } catch (e) { sys = {}; } }
  else sys = { cpu: navigator.platform, threads: navigator.hardwareConcurrency || 4, totalMem: (navigator.deviceMemory || 8) * 1073741824 };
  return sys;
};
TZ.sysInfo();

const RESTART_KEYS = ['gpu', 'highPerfGPU', 'ignoreBlocklist', 'hwDecode', 'ramGB', 'lowPowerGPU'];

TZ.preferences = async (tab = 'perf') => {
  const info = await TZ.sysInfo();
  const st = TZ.settings;
  const orig = JSON.stringify(RESTART_KEYS.map(k => st[k]));
  const draft = JSON.parse(JSON.stringify(st));
  const totalGB = Math.max(2, Math.round((info.totalMem || 8 * 1073741824) / 1073741824));
  if (!draft.ramGB) draft.ramGB = Math.max(2, Math.min(totalGB - 3, Math.round(totalGB * 0.7)));
  const tabs = [['general', 'Ogólne'], ['perf', 'Wydajność i GPU'], ['memory', 'Pamięć'], ['playback', 'Odtwarzanie'], ['export', 'Eksport']];
  const nav = h('div', { class: 'pref-nav' });
  const body = h('div', { class: 'pref-body' });
  const row = (label, ctl, hint, restart) => h('div', { class: 'pref-row' }, h('div', { class: 'pref-l' }, label, restart ? h('span', { class: 'pref-rs', title: 'Wymaga ponownego uruchomienia' }, '⟳') : ''), h('div', { class: 'pref-c' }, ctl, hint ? h('div', { class: 'pref-hint' }, hint) : ''));
  const selectFor = (key, opts) => { const s = h('select', null, ...opts.map(([v, n]) => h('option', { value: String(v), selected: String(draft[key]) === String(v) }, n))); s.onchange = () => { const v = s.value; draft[key] = v === 'true' ? true : v === 'false' ? false : (isNaN(+v) || v === '' ? v : +v); if (key === 'previewQuality') draft[key] = v; }; return s; };
  const check = (key, label) => { const c = h('input', { type: 'checkbox', checked: !!draft[key] }); c.onchange = () => draft[key] = c.checked; return h('label', { class: 'chk', style: { marginTop: 0 } }, c, label); };
  const pages = {
    general: () => [
      h('h4', null, 'Ogólne'),
      row('Ekran startowy', check('showStart', 'Pokazuj ekran startowy przy uruchomieniu')),
      row('Autozapis', selectFor('autosaveMin', [[1, 'co 1 minutę'], [3, 'co 3 minuty'], [5, 'co 5 minut'], [10, 'co 10 minut'], [0, 'wyłączony']])),
      row('Poziomy cofania', selectFor('undoLevels', [[50, '50'], [100, '100'], [200, '200'], [500, '500']]), 'Więcej poziomów = więcej pamięci RAM.')
    ],
    perf: () => [
      h('h4', null, 'Silnik renderowania'),
      h('div', { class: 'pref-card' },
        h('div', null, h('b', null, 'Karta graficzna: '), (TZ.render.gpuName || 'nieznana').replace(/^ANGLE \((.*)\)$/, '$1')),
        h('div', null, h('b', null, 'Procesor: '), (info.cpu || '?') + (info.threads ? ` (${info.threads} wątków)` : '')),
        h('div', null, h('b', null, 'Pamięć RAM: '), totalGB + ' GB'),
        h('div', null, h('b', null, 'Silnik GPU: '), TZ.render.glOK() ? 'WebGL 2 – aktywny' + (TZ.render.info().float ? ', 16-bit float dostępny' : '') : 'niedostępny – ' + (TZ.render.info().error || ''))),
      row('Renderowanie podglądu i efektów', selectFor('gpu', [[true, 'GPU – akceleracja sprzętowa (zalecane)'], [false, 'CPU – renderowanie programowe']]), 'Tryb CPU działa wolniej, ale omija problemy ze sterownikami karty graficznej.', true),
      row('Używana karta graficzna', selectFor('highPerfGPU', [[true, 'Wysoka wydajność (karta dedykowana, np. Radeon / GeForce)'], [false, 'Domyślna systemu']]), null, true),
      row('Sterowniki', check('ignoreBlocklist', 'Wymuś akcelerację GPU nawet dla nieobsługiwanych sterowników'), null, true),
      row('Dekodowanie wideo', selectFor('hwDecode', [[true, 'Sprzętowe (GPU) – zalecane'], [false, 'Programowe (CPU)']]), 'Sprzętowe dekodowanie H.264 / H.265 / VP9 / AV1 odciąża procesor.', true),
      row('Kodowanie przy eksporcie', selectFor('hwEncode', [['prefer-hardware', 'Sprzętowe (GPU) – AMD AMF / NVIDIA NVENC / Intel Quick Sync'], ['no-preference', 'Automatycznie'], ['prefer-software', 'Programowe (CPU) – najwyższa zgodność']])),
      row('Głębia kolorów renderowania', selectFor('hq16', [[false, '8 bitów na kanał (najszybciej)'], [true, '16 bitów float – maksymalna jakość (gradienty bez pasów)']])),
      row('Skalowanie', check('hqScale', 'Wysokiej jakości skalowanie (mipmapy) przy zmniejszaniu 4K → 1080p'))
    ],
    memory: () => {
      const val = h('b', null, draft.ramGB + ' GB');
      const rest = h('span', null, Math.max(0, totalGB - draft.ramGB) + ' GB');
      const rg = h('input', { type: 'range', min: 2, max: Math.max(3, totalGB - 1), step: 1, value: draft.ramGB, style: { width: '100%' } });
      rg.oninput = () => { draft.ramGB = +rg.value; val.textContent = draft.ramGB + ' GB'; rest.textContent = Math.max(0, totalGB - draft.ramGB) + ' GB'; };
      return [
        h('h4', null, 'Przydział pamięci RAM'),
        h('div', { class: 'pref-card' }, h('div', null, 'Zainstalowana pamięć RAM: ', h('b', null, totalGB + ' GB')), h('div', null, 'Pamięć RAM dla TopaZ Editing Pro: ', val), h('div', null, 'Pamięć pozostawiona dla innych aplikacji: ', rest)),
        row('Pamięć dla TopaZ', rg, 'Więcej pamięci = więcej jednocześnie otwartych dekoderów wideo, większa pamięć klatek i większe projekty.', true),
        row('Liczba dekoderów w pamięci', selectFor('decoders', [[0, 'Automatycznie (na podstawie RAM)'], [4, '4'], [8, '8'], [12, '12'], [16, '16'], [24, '24']]), 'Dekodery trzymane w pamięci przyspieszają przewijanie między klipami.')
      ];
    },
    playback: () => [
      h('h4', null, 'Odtwarzanie'),
      row('Domyślna jakość podglądu', selectFor('previewQuality', [['auto', 'Automatyczna (dopasuj do wydajności)'], ['1', 'Pełna'], ['0.5', '1/2'], ['0.25', '1/4']])),
      row('Buforowanie wstępne', selectFor('prerollSec', [[1, '1 s'], [2, '2 s (zalecane)'], [3, '3 s'], [5, '5 s']]), 'Ile sekund przed kolejnym klipem przygotować dekoder.'),
      row('Synchronizacja', check('dropFrames', 'Pomijaj klatki, aby zachować synchronizację z dźwiękiem'))
    ],
    export: () => [
      h('h4', null, 'Eksport'),
      row('Domyślny silnik', selectFor('exportEngine', [['gpu', 'TopaZ GPU (dekodowanie i kodowanie sprzętowe) – najszybszy'], ['native', 'Silnik C++ (Media Foundation)'], ['realtime', 'W czasie rzeczywistym']])),
      row('Wątki CPU (silnik C++)', selectFor('engineThreads', [[0, 'Automatycznie (' + (info.threads || '?') + ')'], [2, '2'], [4, '4'], [6, '6'], [8, '8'], [12, '12'], [16, '16']])),
      row('Domyślny folder', (() => { const i = h('input', { type: 'text', value: draft.exportFolder || '', placeholder: 'Folder Wideo użytkownika', style: { width: '100%' } }); i.oninput = () => draft.exportFolder = i.value; i.onkeydown = e => e.stopPropagation(); return i; })())
    ]
  };
  let cur = tab;
  const show = (t) => { cur = t; TZ.$$('button', nav).forEach(b => b.classList.toggle('on', b.dataset.t === t)); body.innerHTML = ''; pages[t]().forEach(x => body.append(x)); };
  tabs.forEach(([id, name]) => nav.append(h('button', { 'data-t': id, onclick: () => show(id) }, name)));
  show(cur);
  const r = await TZ.modal({ title: 'Preferencje – TopaZ Editing Pro 26', body: h('div', { class: 'pref' }, nav, body), width: 820, buttons: [{ label: 'Przywróć domyślne', value: 'reset' }, { label: 'Anuluj', value: null }, { label: 'OK', value: 'ok', primary: true }] });
  if (r === 'reset') { const keep = { exportFolder: st.exportFolder }; TZ.settings = Object.assign(TZ.defaultSettings(), keep); TZ.saveSettings(); TZ.toast('Przywrócono ustawienia domyślne'); applyLive(); return; }
  if (r !== 'ok') return;
  Object.assign(TZ.settings, draft);
  TZ.saveSettings();
  applyLive();
  if (JSON.stringify(RESTART_KEYS.map(k => TZ.settings[k])) !== orig) {
    const ok = await TZ.confirm('Niektóre zmiany (GPU, dekodowanie, pamięć RAM) zaczną działać po ponownym uruchomieniu programu. Uruchomić ponownie teraz?', 'Uruchom ponownie', 'Później');
    if (ok && N && N.relaunch) { if (await TZ.askSaveChanges()) N.relaunch(); }
  } else TZ.toast('Zapisano preferencje');
};
function applyLive() {
  const E = TZ.engine;
  const q = TZ.settings.previewQuality;
  E.quality = q === 'auto' ? 1 : (+q || 1);
  const sel = TZ.$('#progQuality'); if (sel) sel.value = q === 'auto' ? 'auto' : String(E.quality);
  E.layoutProgram(); E.requestRender();
  TZ.history.max = Math.max(20, TZ.settings.undoLevels || 200);
}
})();
