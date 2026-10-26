'use strict';
/* ==========================================================
   App shell: menus, shortcuts, layout, workspaces, start screen
   ========================================================== */
(() => {
const S = TZ.state, E = TZ.engine, TL = TZ.tl, P = TZ.panels, X = TZ.exporter, h = TZ.h, N = window.native || null;
const UI = TZ.ui = {};

/* ---------- tabs ---------- */
UI.showTab = (group, tab) => {
  const bar = TZ.$(`.ptabs[data-group="${group}"]`); if (!bar) return;
  const panel = bar.closest('.panel');
  TZ.$$('button', bar).forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  TZ.$$('.tabpage', panel).forEach(p => p.classList.toggle('active', p.dataset.page === tab));
  if (tab === 'scopes') setTimeout(() => E.scopesTick(true), 30);
  if (tab === 'mixer') P.renderMixer();
};
TZ.$$('.ptabs[data-group]').forEach(bar => TZ.$$('button', bar).forEach(b => b.addEventListener('click', () => UI.showTab(bar.dataset.group, b.dataset.tab))));
UI.focusPanel = (name) => { S.focus = name; TZ.$$('.panel').forEach(p => p.classList.remove('focused')); const el = { timeline: '#pTimeline', project: '#pProject', program: '#pProgram', source: '#pLeftTop' }[name]; if (el) TZ.$(el).classList.add('focused'); };
TZ.$('#pProgram').addEventListener('pointerdown', () => UI.focusPanel('program'));
TZ.$('#pLeftTop').addEventListener('pointerdown', () => UI.focusPanel('source'));
TZ.$('#pProject').addEventListener('pointerdown', () => UI.focusPanel('project'));
TZ.$('#pTimeline').addEventListener('pointerdown', () => UI.focusPanel('timeline'));

/* ---------- workspaces ---------- */
UI.workspace = (ws) => {
  TZ.$$('.ws-tabs button').forEach(b => b.classList.toggle('active', b.dataset.ws === ws));
  TZ.$$('.workspace').forEach(w => w.classList.toggle('active', w.id === 'ws-' + ws));
  if (ws === 'export') { E.stop(); X.buildWorkspace(); }
  if (ws === 'import') renderImport();
  if (ws === 'edit') { setTimeout(() => { E.layoutProgram(); TL.draw(); E.requestRender(); }, 20); }
};
TZ.$$('.ws-tabs button').forEach(b => b.addEventListener('click', () => UI.workspace(b.dataset.ws)));
TZ.$('#btnHome').onclick = () => showStart(true);
TZ.$('#btnQuickExport').onclick = () => X.quickExport();

/* ---------- tools ---------- */
TZ.setTool = (t) => { S.tool = t; TZ.$$('#tools button').forEach(b => b.classList.toggle('on', b.dataset.tool === t)); TL.requestDraw(); const n = { select: 'Zaznaczanie', track: 'Zaznacz ścieżkę w przód', ripple: 'Edycja z przesunięciem', razor: 'Żyletka', slip: 'Poślizg', pen: 'Pióro', hand: 'Rączka', zoom: 'Lupa', type: 'Tekst' }[t]; TZ.status('Narzędzie: ' + n); };
TZ.$$('#tools button').forEach(b => b.addEventListener('click', () => TZ.setTool(b.dataset.tool)));
const toggleSnap = () => { S.snap = !S.snap; TZ.$('#tglSnap').classList.toggle('on', S.snap); TZ.status('Przyciąganie: ' + (S.snap ? 'wł.' : 'wył.')); };
TZ.$('#tglSnap').onclick = toggleSnap;
TZ.$('#tglLink').onclick = () => { S.linked = !S.linked; TZ.$('#tglLink').classList.toggle('on', S.linked); };
TZ.$('#tglMarker').onclick = () => TL.addMarker();
TZ.$('#tglNest').onclick = () => TZ.toast('Zagnieżdżanie sekwencji będzie dostępne w kolejnej aktualizacji');
TZ.$('#tglSettings').onclick = (e) => TZ.menu(e.clientX, e.clientY + 10, [
  { label: 'Pokaż miniatury wideo', checked: true, disabled: true },
  { label: 'Powiększ do sekwencji', key: '\\', action: () => TL.zoomFit() },
  { label: 'Ustawienia sekwencji…', action: () => P.sequenceSettings() },
  '-',
  { label: 'Dodaj ścieżkę wideo', action: () => TL.addTrack('v') },
  { label: 'Dodaj ścieżkę audio', action: () => TL.addTrack('a') }
]);
TZ.$('#tlAddV').onclick = () => TL.addTrack('v');
TZ.$('#tlAddA').onclick = () => TL.addTrack('a');

/* ---------- program transport ---------- */
const progAction = (a) => {
  switch (a) {
    case 'play': E.toggle(); break;
    case 'marker': TL.addMarker(); break;
    case 'mark-in': TL.setIn(); break;
    case 'mark-out': TL.setOut(); break;
    case 'go-in': E.seek(S.seq.inPoint || 0); break;
    case 'go-out': E.seek(S.seq.outPoint != null ? S.seq.outPoint : TZ.seqDuration()); break;
    case 'step-b': E.step(-1); break;
    case 'step-f': E.step(1); break;
    case 'lift': TL.lift(false); break;
    case 'extract': TL.lift(true); break;
    case 'frame': X.exportFrameQuick(); break;
    case 'loop': S.loop = !S.loop; TZ.$('[data-prog="loop"]').classList.toggle('on', S.loop); TZ.status('Pętla: ' + (S.loop ? 'wł.' : 'wył.')); break;
    case 'fullscreen': toggleFull(); break;
  }
};
TZ.$$('[data-prog]').forEach(b => b.addEventListener('click', () => progAction(b.dataset.prog)));
function toggleFull() {
  const p = TZ.$('#pProgram');
  if (p.classList.contains('fullscreen-prog')) { p.classList.remove('fullscreen-prog'); if (document.fullscreenElement) document.exitFullscreen(); }
  else { p.classList.add('fullscreen-prog'); document.documentElement.requestFullscreen().catch(() => {}); }
  setTimeout(() => E.layoutProgram(), 100);
}
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) { TZ.$('#pProgram').classList.remove('fullscreen-prog'); setTimeout(() => E.layoutProgram(), 50); } });
// timecode entry
['#progTC', '#tlTC'].forEach(sel => TZ.$(sel).addEventListener('click', () => {
  const span = TZ.$(sel);
  const inp = h('input', { class: 'tc-input', value: span.textContent });
  span.style.display = 'none'; span.after(inp); inp.focus(); inp.select();
  const done = (ok) => { if (ok) { const t = TZ.parseTC(inp.value, S.seq.fps, S.playhead); if (t != null) E.seek(Math.max(0, t)); } inp.remove(); span.style.display = ''; };
  inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); });
  inp.addEventListener('blur', () => done(false));
}));
TZ.$('#progSettings').onclick = (e) => TZ.menu(e.clientX, e.clientY, [
  { label: 'Jakość odtwarzania: Pełna', checked: E.quality === 1, action: () => setQuality(1) },
  { label: 'Jakość odtwarzania: 1/2', checked: E.quality === 0.5, action: () => setQuality(0.5) },
  { label: 'Jakość odtwarzania: 1/4', checked: E.quality === 0.25, action: () => setQuality(0.25) },
  '-',
  { label: 'Pętla', checked: S.loop, action: () => progAction('loop') },
  { label: 'Eksportuj klatkę…', action: () => X.exportFrameQuick() },
  { label: 'Pełny ekran', key: '`', action: toggleFull }
]);
function setQuality(q) { E.quality = q; TZ.$('#progQuality').value = String(q); TZ.settings.previewQuality = String(q); TZ.saveSettings(); E.layoutProgram(); E.requestRender(); }
let hudOn = false;
setInterval(() => { if (!hudOn) return; const i = TZ.render.info(); TZ.$('#perfHud').textContent = (S.playing ? (E.fps || 0).toFixed(0) + ' kl./s · ' : '') + 'podgląd ' + (E.quality === 1 ? 'pełny' : E.quality === 0.5 ? '1/2' : '1/4') + ' · dekodery ' + E.poolSize() + (i.ok ? ' · GPU' : ' · CPU'); }, 300);
{ const pq = TZ.$('#progQuality'); pq.value = TZ.settings.previewQuality === 'auto' ? 'auto' : String(+TZ.settings.previewQuality || 1);
  pq.onchange = (e) => { const v = e.target.value; TZ.settings.previewQuality = v; TZ.saveSettings(); E.quality = v === 'auto' ? 1 : +v; E.layoutProgram(); E.requestRender(); }; }
TZ.$('#btnPrefs').onclick = () => TZ.preferences('perf');
TZ.$('#wsSelect').onchange = (e) => layoutPreset(e.target.value);

/* ---------- menus ---------- */
const recentSub = () => { const r = TZ.getRecent(); return r.length ? r.map(x => ({ label: x.name, action: () => TZ.openProject(x.path) })) : [{ label: '(brak)', disabled: true }]; };
const MENUS = {
  'Plik': () => [
    { label: 'Nowy projekt', key: 'Ctrl+Alt+N', action: () => TZ.newProject() },
    { label: 'Otwórz projekt…', key: 'Ctrl+O', action: () => TZ.openProject() },
    { label: 'Otwórz ostatni projekt', sub: recentSub() },
    '-',
    { label: 'Zapisz', key: 'Ctrl+S', action: () => TZ.saveProject() },
    { label: 'Zapisz jako…', key: 'Ctrl+Shift+S', action: () => TZ.saveProject(true) },
    '-',
    { label: 'Importuj…', key: 'Ctrl+I', action: () => TZ.importDialog() },
    { label: 'Importuj folder…', action: () => TZ.importFolder() },
    '-',
    { label: 'Eksportuj', sub: [
      { label: 'Multimedia…', key: 'Ctrl+M', action: () => UI.workspace('export') },
      { label: 'Szybki eksport…', action: () => X.quickExport() },
      { label: 'Klatka (PNG)…', key: 'Ctrl+Shift+E', action: () => X.exportFrameQuick() },
      { label: 'Audio (WAV)…', action: () => { X.cfg.format = 'wav'; X.run({}); } }
    ] },
    '-',
    { label: 'Zakończ', key: 'Ctrl+Q', action: () => { if (N) window.close(); } }
  ],
  'Edycja': () => [
    { label: 'Cofnij' + (TZ.history.ptr > 0 ? ' ' + TZ.history.states[TZ.history.ptr].label : ''), key: 'Ctrl+Z', disabled: TZ.history.ptr <= 0, action: TZ.undo },
    { label: 'Ponów', key: 'Ctrl+Shift+Z', disabled: TZ.history.ptr >= TZ.history.states.length - 1, action: TZ.redo },
    '-',
    { label: 'Wytnij', key: 'Ctrl+X', action: () => TL.copy(true) },
    { label: 'Kopiuj', key: 'Ctrl+C', action: () => TL.copy(false) },
    { label: 'Wklej', key: 'Ctrl+V', action: () => TL.paste(false) },
    { label: 'Wklej i wstaw', key: 'Ctrl+Shift+V', action: () => TL.paste(true) },
    { label: 'Wklej atrybuty', key: 'Ctrl+Alt+V', action: () => TL.pasteAttributes() },
    { label: 'Wyczyść', key: 'Delete', action: () => TL.deleteSelection(false) },
    { label: 'Usuń z przesunięciem', key: 'Shift+Delete', action: () => TL.deleteSelection(true) },
    { label: 'Duplikuj', key: 'Ctrl+Shift+/', action: () => TL.duplicate() },
    '-',
    { label: 'Zaznacz wszystko', key: 'Ctrl+A', action: () => TL.selectAll() },
    { label: 'Odznacz wszystko', key: 'Ctrl+Shift+A', action: () => TL.deselect() },
    '-',
    { label: 'Skróty klawiaturowe…', key: 'Ctrl+Alt+K', action: showShortcuts },
    { label: 'Preferencje…', key: 'Ctrl+,', action: () => TZ.preferences('general') },
    { label: 'Wydajność, GPU i pamięć RAM…', action: () => TZ.preferences('perf') }
  ],
  'Klip': () => [
    { label: 'Szybkość/czas trwania…', key: 'Ctrl+R', action: () => TL.speedDialog() },
    { label: 'Czas trwania…', action: () => TL.durationDialog() },
    { label: 'Włącz', key: 'Shift+E', action: () => TL.toggleEnable() },
    { label: 'Połącz', key: 'Ctrl+L', action: () => TL.link(true) },
    { label: 'Rozłącz', action: () => TL.link(false) },
    '-',
    { label: 'Zastosuj domyślne przejście wideo', key: 'Ctrl+D', action: () => TL.applyDefaultTransition(false) },
    { label: 'Zastosuj domyślne przejście audio', key: 'Ctrl+Shift+D', action: () => TL.applyDefaultTransition(true) },
    '-',
    { label: 'Wstaw (z monitora źródła)', key: ',', action: () => E.source.media && TL.sourceEdit(E.source.media, 'insert') },
    { label: 'Nadpisz (z monitora źródła)', key: '.', action: () => E.source.media && TL.sourceEdit(E.source.media, 'overwrite') },
    '-',
    { label: 'Usuń efekty', action: () => { TZ.selectedClips().forEach(c => { c.effects = []; c.lumetri = TZ.defaultLumetri(); }); TZ.commit('Usuń efekty'); TZ.emit('seq'); TZ.emit('sel'); } }
  ],
  'Sekwencja': () => [
    { label: 'Ustawienia sekwencji…', action: () => P.sequenceSettings() },
    '-',
    { label: 'Dodaj edycję', key: 'Ctrl+K', action: () => TL.splitAtPlayhead(false) },
    { label: 'Dodaj edycję do wszystkich ścieżek', key: 'Ctrl+Shift+K', action: () => TL.splitAtPlayhead(true) },
    { label: 'Podnieś', key: ';', action: () => TL.lift(false) },
    { label: 'Wyodrębnij', key: "'", action: () => TL.lift(true) },
    '-',
    { label: 'Przejdź do następnej edycji', key: '↓', action: () => TL.goToEdit(1) },
    { label: 'Przejdź do poprzedniej edycji', key: '↑', action: () => TL.goToEdit(-1) },
    '-',
    { label: 'Przyciąganie na osi czasu', key: 'S', checked: S.snap, action: toggleSnap },
    { label: 'Zaznaczanie połączone', checked: S.linked, action: () => TZ.$('#tglLink').click() },
    { label: 'Powiększ do sekwencji', key: '\\', action: () => TL.zoomFit() },
    '-',
    { label: 'Dodaj ścieżkę wideo', action: () => TL.addTrack('v') },
    { label: 'Dodaj ścieżkę audio', action: () => TL.addTrack('a') }
  ],
  'Znaczniki': () => [
    { label: 'Zaznacz wejście', key: 'I', action: () => TL.setIn() },
    { label: 'Zaznacz wyjście', key: 'O', action: () => TL.setOut() },
    { label: 'Zaznacz klip', key: 'X', action: () => TL.markClip() },
    { label: 'Przejdź do wejścia', key: 'Shift+I', action: () => E.seek(S.seq.inPoint || 0) },
    { label: 'Przejdź do wyjścia', key: 'Shift+O', action: () => E.seek(S.seq.outPoint || TZ.seqDuration()) },
    { label: 'Wyczyść wejście i wyjście', key: 'Ctrl+Shift+X', action: () => TL.clearInOut() },
    '-',
    { label: 'Dodaj znacznik', key: 'M', action: () => TL.addMarker() },
    { label: 'Przejdź do następnego znacznika', key: 'Shift+M', action: () => TL.gotoMarker(1) },
    { label: 'Przejdź do poprzedniego znacznika', key: 'Ctrl+Shift+M', action: () => TL.gotoMarker(-1) },
    { label: 'Usuń wszystkie znaczniki', action: () => { S.seq.markers = []; TZ.commit('Usuń znaczniki'); TL.draw(); } }
  ],
  'Grafika': () => [
    { label: 'Nowa warstwa – Tekst', key: 'Ctrl+T', action: () => { TL.addSynthetic('text'); UI.showTab('right', 'graphics'); } },
    { label: 'Nowa warstwa – Plansza koloru', action: () => TL.addSynthetic('color') },
    { label: 'Nowa warstwa – Warstwa korekcyjna', action: () => TL.addSynthetic('adjust') },
    '-',
    { label: 'Panel Grafika i tekst', action: () => UI.showTab('right', 'graphics') }
  ],
  'Widok': () => [
    { label: 'Jakość odtwarzania', sub: [1, 0.5, 0.25].map(q => ({ label: q === 1 ? 'Pełna' : q === 0.5 ? '1/2' : '1/4', checked: E.quality === q, action: () => setQuality(q) })) },
    { label: 'Pełny ekran monitora programu', key: '`', action: toggleFull },
    '-',
    { label: 'Powiększ oś czasu', key: '=', action: () => TL.zoomAround(1.5) },
    { label: 'Pomniejsz oś czasu', key: '-', action: () => TL.zoomAround(1 / 1.5) },
    { label: 'Powiększ do sekwencji', key: '\\', action: () => TL.zoomFit() }
  ],
  'Okno': () => [
    { label: 'Pokaż wskaźnik wydajności (kl./s)', checked: hudOn, action: () => { hudOn = !hudOn; TZ.$('#perfHud').style.display = hudOn ? 'block' : 'none'; } },
    { label: 'Obszary robocze', sub: [
      { label: 'Edycja', action: () => layoutPreset('edit') },
      { label: 'Kolor', action: () => layoutPreset('color') },
      { label: 'Audio', action: () => layoutPreset('audio') },
      { label: 'Grafika', action: () => layoutPreset('graphics') },
      { label: 'Efekty', action: () => layoutPreset('effects') }
    ] },
    { label: 'Resetuj układ', action: () => layoutPreset('edit') },
    '-',
    { label: 'Projekt', action: () => UI.showTab('project', 'project') },
    { label: 'Efekty', key: 'Shift+7', action: () => UI.showTab('project', 'effects') },
    { label: 'Historia', action: () => UI.showTab('project', 'history') },
    { label: 'Informacje', action: () => UI.showTab('project', 'info') },
    { label: 'Monitor źródła', key: 'Shift+2', action: () => UI.showTab('lefttop', 'source') },
    { label: 'Elementy sterujące efektami', key: 'Shift+5', action: () => UI.showTab('lefttop', 'ecp') },
    { label: 'Zakresy Lumetri', action: () => UI.showTab('lefttop', 'scopes') },
    { label: 'Mikser ścieżek audio', key: 'Shift+6', action: () => UI.showTab('lefttop', 'mixer') },
    { label: 'Właściwości', action: () => UI.showTab('right', 'props') },
    { label: 'Kolor Lumetri', action: () => UI.showTab('right', 'lumetri') },
    { label: 'Grafika i tekst', action: () => UI.showTab('right', 'graphics') }
  ],
  'Pomoc': () => [
    { label: 'Skróty klawiaturowe', action: showShortcuts },
    { label: 'Ekran startowy', action: () => showStart(true) },
    '-',
    { label: 'O programie TopaZ Editing Pro 26', action: showAbout }
  ]
};
const mb = TZ.$('#menubar');
for (const name of Object.keys(MENUS)) {
  const mi = h('div', { class: 'mi' }, name);
  const open = () => { const r = mi.getBoundingClientRect(); TZ.menu(r.left, r.bottom + 2, MENUS[name]()); mi.classList.add('open'); };
  mi.addEventListener('mousedown', e => { e.stopPropagation(); if (mi.classList.contains('open')) TZ.closeMenus(); else open(); });
  mi.addEventListener('mouseenter', () => { if (TZ.$('#menubar .mi.open') && !mi.classList.contains('open')) { TZ.closeMenus(); open(); } });
  mb.append(mi);
}

/* ---------- layout (gutters) ---------- */
const root = document.documentElement, ws = TZ.$('#ws-edit');
function loadLayout() { try { const l = JSON.parse(localStorage.getItem('tz.layout') || 'null'); if (l) { root.style.setProperty('--lw', l.lw); root.style.setProperty('--rw', l.rw); root.style.setProperty('--th', l.th); } } catch (e) {} }
function saveLayout() { try { localStorage.setItem('tz.layout', JSON.stringify({ lw: getComputedStyle(root).getPropertyValue('--lw'), rw: getComputedStyle(root).getPropertyValue('--rw'), th: getComputedStyle(root).getPropertyValue('--th') })); } catch (e) {} }
function gutter(id, fn) {
  const g = TZ.$(id);
  g.addEventListener('pointerdown', e => {
    e.preventDefault(); g.classList.add('drag'); g.setPointerCapture(e.pointerId);
    const r = ws.getBoundingClientRect();
    g.onpointermove = ev => { fn(ev, r); E.layoutProgram(); };
    g.onpointerup = () => { g.onpointermove = null; g.classList.remove('drag'); saveLayout(); E.layoutProgram(); TL.draw(); };
  });
}
gutter('#gutterL', (e, r) => root.style.setProperty('--lw', TZ.clamp(e.clientX - r.left, 220, r.width * 0.5) + 'px'));
gutter('#gutterB', (e, r) => root.style.setProperty('--lw', TZ.clamp(e.clientX - r.left, 220, r.width * 0.5) + 'px'));
gutter('#gutterR', (e, r) => root.style.setProperty('--rw', TZ.clamp(r.right - e.clientX, 240, r.width * 0.45) + 'px'));
gutter('#gutterH', (e, r) => root.style.setProperty('--th', TZ.clamp(e.clientY - r.top, 200, r.height - 180) + 'px'));
function layoutPreset(p) {
  root.style.setProperty('--lw', '360px'); root.style.setProperty('--rw', '330px'); root.style.setProperty('--th', '56%');
  if (p === 'color') { root.style.setProperty('--rw', '360px'); UI.showTab('right', 'lumetri'); UI.showTab('lefttop', 'scopes'); }
  if (p === 'audio') { UI.showTab('lefttop', 'mixer'); UI.showTab('project', 'effects'); }
  if (p === 'graphics') { UI.showTab('right', 'graphics'); UI.showTab('lefttop', 'ecp'); }
  if (p === 'effects') { UI.showTab('project', 'effects'); UI.showTab('lefttop', 'ecp'); }
  if (p === 'edit') { UI.showTab('right', 'props'); UI.showTab('lefttop', 'source'); UI.showTab('project', 'project'); }
  saveLayout(); setTimeout(() => { E.layoutProgram(); TL.draw(); }, 30);
}
loadLayout();

/* ---------- keyboard ---------- */
const isTyping = (e) => { const t = e.target; return t && (t.tagName === 'INPUT' && !['range', 'checkbox', 'color'].includes(t.type) || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); };
document.addEventListener('keydown', e => {
  if (isTyping(e) || TZ.$('.modal-bg')) return;
  const k = e.key, ctrl = e.ctrlKey || e.metaKey, sh = e.shiftKey, alt = e.altKey;
  const lower = k.length === 1 ? k.toLowerCase() : k;
  const run = (fn) => { e.preventDefault(); fn(); };
  if (TZ.$('#startScreen').classList.contains('show')) { if (k === 'Escape') run(() => hideStart()); return; }
  const srcFocus = S.focus === 'source' && E.source.media;
  // ctrl combos
  if (ctrl) {
    if (lower === 'z' && !sh) return run(TZ.undo);
    if ((lower === 'z' && sh) || lower === 'y') return run(TZ.redo);
    if (lower === 's') return run(() => TZ.saveProject(sh));
    if (lower === 'o') return run(() => TZ.openProject());
    if (lower === 'n' && alt) return run(() => TZ.newProject());
    if (lower === 'i') return run(() => TZ.importDialog());
    if (lower === 'm') return run(() => UI.workspace('export'));
    if (lower === 'e' && sh) return run(() => X.exportFrameQuick());
    if (lower === 'c') return run(() => TL.copy(false));
    if (lower === 'x' && sh) return run(() => TL.clearInOut());
    if (lower === 'x') return run(() => TL.copy(true));
    if (lower === 'v' && alt) return run(() => TL.pasteAttributes());
    if (lower === 'v') return run(() => TL.paste(sh));
    if (lower === 'a' && sh) return run(() => TL.deselect());
    if (lower === 'a') return run(() => TL.selectAll());
    if (lower === 'k' && alt) return run(showShortcuts);
    if (k === ',') return run(() => TZ.preferences('general'));
    if (lower === 'k') return run(() => TL.splitAtPlayhead(sh));
    if (lower === 'd') return run(() => TL.applyDefaultTransition(sh ? true : false));
    if (lower === 'r') return run(() => TL.speedDialog());
    if (lower === 'l') return run(() => TL.link(!TZ.selectedClips().some(c => c.linkId)));
    if (lower === 't') return run(() => { TL.addSynthetic('text'); UI.showTab('right', 'graphics'); });
    if (lower === 'm' && sh) return run(() => TL.gotoMarker(-1));
    if (lower === '/' && sh || k === '?') return run(() => TL.duplicate());
    if (lower === 'q') return run(() => window.close());
    return;
  }
  switch (k) {
    case ' ': return run(() => srcFocus ? E.source.toggle() : E.toggle());
    case 'Enter': return;
    case 'ArrowLeft': return run(() => srcFocus ? E.source.step(sh ? -5 : -1) : (alt ? TL.nudge(-1) : E.step(sh ? -5 : -1)));
    case 'ArrowRight': return run(() => srcFocus ? E.source.step(sh ? 5 : 1) : (alt ? TL.nudge(1) : E.step(sh ? 5 : 1)));
    case 'ArrowUp': return run(() => TL.goToEdit(-1));
    case 'ArrowDown': return run(() => TL.goToEdit(1));
    case 'Home': return run(() => { E.seek(0); TL.ensureVisible(0); TL.draw(); });
    case 'End': return run(() => { E.seek(TZ.seqDuration()); TL.ensureVisible(TZ.seqDuration()); TL.draw(); });
    case 'Delete': case 'Backspace':
      if (S.focus === 'project' && S.selMedia.size) return run(() => P.deleteSelectedMedia());
      return run(() => TL.deleteSelection(sh || k === 'Backspace' && alt));
    case 'Escape': return run(() => { TZ.closeMenus(); TL.deselect(); });
    case '`': return run(toggleFull);
    case '\\': return run(() => TL.zoomFit());
    case '=': case '+': return run(() => TL.zoomAround(1.5));
    case '-': return run(() => TL.zoomAround(1 / 1.5));
    case ',': return run(() => E.source.media && TL.sourceEdit(E.source.media, 'insert'));
    case '.': return run(() => E.source.media && TL.sourceEdit(E.source.media, 'overwrite'));
    case ';': return run(() => TL.lift(false));
    case "'": return run(() => TL.lift(true));
  }
  if (sh && /^[1-9]$/.test(k) === false && k === '&') return; // shift+7 on PL layout
  if (sh) {
    if (lower === 'i') return run(() => E.seek(S.seq.inPoint || 0));
    if (lower === 'o') return run(() => E.seek(S.seq.outPoint != null ? S.seq.outPoint : TZ.seqDuration()));
    if (lower === 'm') return run(() => TL.gotoMarker(1));
    if (lower === 'e') return run(() => TL.toggleEnable());
  }
  switch (lower) {
    case 'v': return run(() => TZ.setTool('select'));
    case 'a': return run(() => TZ.setTool('track'));
    case 'b': return run(() => TZ.setTool('ripple'));
    case 'c': return run(() => TZ.setTool('razor'));
    case 'y': return run(() => TZ.setTool('slip'));
    case 'p': return run(() => TZ.setTool('pen'));
    case 'h': return run(() => TZ.setTool('hand'));
    case 'z': return run(() => TZ.setTool('zoom'));
    case 't': return run(() => TZ.setTool('type'));
    case 's': return run(toggleSnap);
    case 'm': return run(() => TL.addMarker());
    case 'x': return run(() => TL.markClip());
    case 'i': return run(() => { if (srcFocus) TZ.$('[data-src="mark-in"]').click(); else TL.setIn(); });
    case 'o': return run(() => { if (srcFocus) TZ.$('[data-src="mark-out"]').click(); else TL.setOut(); });
    case 'j': return run(() => E.shuttle(-1));
    case 'k': return run(() => E.shuttle(0));
    case 'l': return run(() => E.shuttle(1));
    case 'q': return run(() => rippleToPlayhead('start'));
    case 'w': return run(() => rippleToPlayhead('end'));
  }
});
function rippleToPlayhead(which) {
  const t = S.playhead;
  const clips = S.seq.clips.filter(c => t > c.start && t < c.start + c.dur && !TZ.trackById(c.track).locked);
  if (!clips.length) return;
  for (const c of clips) {
    if (which === 'start') { const d = t - c.start; c.in += d * c.speed; c.dur -= d; for (const k in c.kf) c.kf[k] = c.kf[k].map(x => ({ ...x, t: x.t - d })); }
    else c.dur = t - c.start;
  }
  if (which === 'start') { const d = t - Math.min(...clips.map(c => c.start)); const st = Math.min(...clips.map(c => c.start)); for (const c of S.seq.clips) if (c.start >= st - 1e-6) c.start -= (clips.includes(c) ? 0 : d); for (const c of clips) c.start = st; E.seek(st); }
  else { const end = t; const nextShift = Math.max(...clips.map(c => c.start + c.dur)); void nextShift; void end; }
  TZ.commit(which === 'start' ? 'Przytnij początek z przesunięciem' : 'Przytnij koniec'); TZ.emit('seq');
}

/* ---------- dialogs ---------- */
function showShortcuts() {
  const rows = [
    ['Spacja', 'Odtwórz / zatrzymaj'], ['J / K / L', 'Wstecz / stop / naprzód (wielokrotnie = szybciej)'], ['← / →', 'Klatka wstecz / naprzód (Shift = 5 klatek)'], ['↑ / ↓', 'Poprzednia / następna edycja'], ['Home / End', 'Początek / koniec sekwencji'],
    ['I / O', 'Punkt wejścia / wyjścia'], ['X', 'Zaznacz klip (wejście–wyjście)'], ['M', 'Dodaj znacznik'], [', / .', 'Wstaw / nadpisz z monitora źródła'], ['; / \'', 'Podnieś / wyodrębnij'],
    ['Ctrl+klik', 'Zaznacz tylko jeden klip (np. samo audio bez wideo)'], ['Shift+klik', 'Dodaj do zaznaczenia'], ['V', 'Zaznaczanie'], ['A', 'Zaznacz ścieżkę w przód'], ['B', 'Edycja z przesunięciem'], ['C', 'Żyletka'], ['Y', 'Poślizg'], ['P', 'Pióro (klatki kluczowe)'], ['H', 'Rączka'], ['Z', 'Lupa'], ['T', 'Tekst'],
    ['S', 'Przyciąganie'], ['Q / W', 'Przytnij początek / koniec do głowicy'], ['Ctrl+K', 'Dodaj edycję (przetnij)'], ['Ctrl+D', 'Domyślne przejście wideo'], ['Ctrl+Shift+D', 'Domyślne przejście audio'], ['Ctrl+R', 'Szybkość/czas trwania'],
    ['Delete', 'Wyczyść'], ['Shift+Delete', 'Usuń z przesunięciem'], ['Alt+przeciągnij', 'Duplikuj klip'], ['Alt+←/→', 'Przesuń zaznaczenie o klatkę'], ['Shift+E', 'Włącz/wyłącz klip'],
    ['Ctrl+,', 'Preferencje (GPU, RAM, wydajność)'], ['Ctrl+Z / Ctrl+Shift+Z', 'Cofnij / ponów'], ['Ctrl+C / X / V', 'Kopiuj / wytnij / wklej'], ['Ctrl+Alt+V', 'Wklej atrybuty'], ['Ctrl+S', 'Zapisz projekt'], ['Ctrl+I', 'Importuj'], ['Ctrl+M', 'Eksport'], ['Ctrl+Shift+E', 'Eksportuj klatkę'], ['Ctrl+T', 'Nowy tekst'],
    ['= / - / \\', 'Powiększ / pomniejsz / dopasuj oś czasu'], ['Alt+kółko', 'Powiększanie osi czasu'], ['`', 'Pełny ekran monitora'], ['F12', 'Narzędzia deweloperskie']
  ];
  const g = h('div', { class: 'shortcut-grid', style: { gridTemplateColumns: '170px 1fr', maxHeight: '60vh', overflow: 'auto', width: '560px' } });
  rows.forEach(([a, b]) => g.append(h('span', null, a), h('span', null, b)));
  TZ.modal({ title: 'Skróty klawiaturowe', body: g });
}
function showAbout() {
  const logo = h('img', { src: 'logo.png', style: { width: '96px', height: '96px', display: 'block', margin: '0 auto 10px' } });
  TZ.modal({ title: '', body: h('div', { style: { textAlign: 'center', width: '420px' } }, logo,
    h('div', { style: { fontSize: '20px', color: '#fff', fontWeight: 600 } }, 'TopaZ Editing Pro 26'),
    h('div', { style: { margin: '6px 0 14px', color: '#999' } }, 'Wersja ' + (TZ.appVersion || '26.1.0')),
    h('div', { style: { fontSize: '12px', lineHeight: 1.6 } }, 'Nieliniowy edytor wideo.', h('br'), 'Silnik GPU: WebGL 2 + WebCodecs (sprzętowe dekodowanie/kodowanie)', h('br'), 'Silnik C++: Windows Media Foundation', h('br'), 'Interfejs: JavaScript', h('br'), h('br'), '© 2026 TopaZ. Wszelkie prawa zastrzeżone.')) });
}

/* ---------- start screen ---------- */
function renderRecent(box) {
  box.innerHTML = '';
  const r = TZ.getRecent();
  if (!r.length) { box.append(h('div', { class: 'muted', style: { fontSize: '12px' } }, 'Brak ostatnich projektów')); return; }
  for (const x of r.slice(0, 8)) box.append(h('div', { class: 'recent-item', onclick: () => { hideStart(); TZ.openProject(x.path); } }, x.name, h('small', null, x.path)));
}
function showStart(force) { renderRecent(TZ.$('#startRecent')); TZ.$('#startScreen').classList.add('show'); void force; }
function hideStart() { TZ.$('#startScreen').classList.remove('show'); setTimeout(() => { E.layoutProgram(); TL.draw(); }, 20); }
TZ.$('#stNew').onclick = async () => { hideStart(); if (S.seq.clips.length || S.media.length) await TZ.newProject(); };
TZ.$('#stOpen').onclick = () => { hideStart(); TZ.openProject(); };
TZ.$('#stImport').onclick = async () => { hideStart(); const ms = await TZ.importDialog(); if (ms && ms.length) { await TZ.sleep(100); TL.appendMedia(ms); } };
TZ.$('#startScreen').addEventListener('mousedown', e => { if (e.target.id === 'startScreen') hideStart(); });

/* ---------- import workspace ---------- */
function renderImport() {
  renderRecent(TZ.$('#recentList'));
  const list = TZ.$('#impMediaList'); list.innerHTML = '';
  for (const m of S.media) list.append(h('div', { class: 'pi' }, h('div', { class: 'thumb', style: m.thumb ? { backgroundImage: `url(${m.thumb})` } : null }, m.thumb ? '' : TZ.icon(m.type === 'audio' ? 'music' : 'film')), h('div', { class: 'meta' }, h('span', { class: 'nm' }, m.name), h('span', { class: 'du' }, m.type === 'image' ? '' : TZ.fmtShort(m.duration)))));
}
async function importAndMaybeSequence(ms) {
  if (!ms || !ms.length) return;
  if (TZ.$('#impAutoSeq').checked) { await TZ.sleep(120); await TL.appendMedia(ms.filter(m => !m.missing)); UI.workspace('edit'); }
  else renderImport();
}
TZ.$('#impBrowse').onclick = async () => importAndMaybeSequence(await TZ.importDialog());
TZ.$('#impFiles').onclick = async () => importAndMaybeSequence(await TZ.importDialog());
TZ.$('#impFolder').onclick = async () => importAndMaybeSequence(await TZ.importFolder());
TZ.$('#impProject').onclick = () => { TZ.openProject(); UI.workspace('edit'); };
const impDrop = TZ.$('#impDrop');
impDrop.addEventListener('dragover', e => { e.preventDefault(); impDrop.classList.add('dragover'); });
impDrop.addEventListener('dragleave', () => impDrop.classList.remove('dragover'));
impDrop.addEventListener('drop', async e => { e.preventDefault(); impDrop.classList.remove('dragover'); importAndMaybeSequence(await TZ.importFiles([...e.dataTransfer.files])); });
TZ.on('media', () => { if (TZ.$('#ws-import').classList.contains('active')) renderImport(); });

/* ---------- global drop (files anywhere) ---------- */
document.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
document.addEventListener('drop', async e => {
  if (e.defaultPrevented) return;
  e.preventDefault();
  const files = [...e.dataTransfer.files];
  const proj = files.find(f => /\.tzproj$/i.test(f.name));
  if (proj && N) { const p = N.pathForFile(proj); if (p) { hideStart(); TZ.openProject(p); return; } }
  if (files.length) { hideStart(); await TZ.importFiles(files); }
});

/* ---------- close / autosave ---------- */
if (N) {
  N.onCloseRequest(async () => { E.stop(); if (await TZ.askSaveChanges()) N.confirmClose(); });
  N.onOpenProjectFile(f => { hideStart(); TZ.openProject(f); });
  let lastAuto = Date.now();
  setInterval(async () => {
    const mins = TZ.settings.autosaveMin == null ? 3 : TZ.settings.autosaveMin;
    if (!mins || Date.now() - lastAuto < mins * 60000) return;
    lastAuto = Date.now();
    if (!S.project.dirty || (!S.seq.clips.length && !S.media.length)) return;
    try {
      const ud = await N.userData(); const sep = ud.includes('\\') ? '\\' : '/';
      await N.writeText(ud + sep + 'autosave.tzproj', TZ.serialize());
      TZ.status('Autozapis: ' + new Date().toLocaleTimeString());
    } catch (e) {}
  }, 15000);
}
window.addEventListener('beforeunload', e => { if (!N && S.project.dirty && S.seq.clips.length) { e.preventDefault(); e.returnValue = ''; } });

/* ---------- status info ---------- */
setInterval(() => {
  const dur = TZ.seqDuration();
  TZ.$('#statusInfo').textContent = `${S.seq.width}×${S.seq.height} · ${S.seq.fps} kl./s · ${S.seq.clips.length} klipów · ${TZ.fmtTC(dur, S.seq.fps)}` + (E.poolSize ? ` · dekodery: ${E.poolSize()}` : '');
}, 1000);

/* ---------- init ---------- */
TZ.resetHistory();
TZ.updateTitle();
UI.focusPanel('timeline');
TZ.emit('seq'); TZ.emit('time'); TZ.emit('media');
(async () => {
  let file = null;
  if (N) { try { file = await N.startupFile(); } catch (e) {} }
  if (file) TZ.openProject(file);
  else if (!/[?&]nostart/.test(location.search) && TZ.settings.showStart !== false) showStart();
})();
window.addEventListener('error', e => { console.error(e.error || e.message); TZ.status('Błąd: ' + (e.message || '')); });
})();
