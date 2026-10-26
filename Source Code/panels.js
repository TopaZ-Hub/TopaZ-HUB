'use strict';
/* ==========================================================
   Panels: Project, Effects, Effect Controls, Properties,
   Lumetri Color, Graphics, History, Info, Audio Mixer
   ========================================================== */
(() => {
const S = TZ.state, R = TZ.render, h = TZ.h;
const P = TZ.panels = {};
TZ.commitSoon = TZ.debounce((label) => TZ.commit(label), 450);

/* ======================= PROJECT ======================= */
const items = TZ.$('#projItems');
let projView = 'grid';
function mediaIcon(m) { return m.type === 'video' ? 'film' : m.type === 'audio' ? 'music' : 'image'; }
P.renderProject = () => {
  const q = TZ.$('#projSearch').value.trim().toLowerCase();
  const list = S.media.filter(m => !q || m.name.toLowerCase().includes(q));
  items.innerHTML = '';
  items.className = 'proj-items ' + projView;
  TZ.$('#projCount').textContent = (S.selMedia.size ? S.selMedia.size + ' z ' : '') + S.media.length + ' elementów' + (S.selMedia.size ? ' zaznaczonych' : '');
  if (!S.media.length) { items.append(h('div', { class: 'drop-hint', id: 'projDrop', html: 'Importuj multimedia, aby rozpocząć<br><small>Przeciągnij pliki tutaj lub kliknij dwukrotnie</small>' })); return; }
  for (const m of list) {
    const th = h('div', { class: 'thumb', style: m.thumb ? { backgroundImage: `url(${m.thumb})` } : null });
    if (!m.thumb) th.append(TZ.icon(mediaIcon(m)));
    if (m.loading) th.append(h('div', { class: 'badge' }, 'Wczytywanie…'));
    else if (m.missing) th.append(h('div', { class: 'badge', style: { background: '#a22' } }, 'Brak pliku'));
    const bar = h('div', { class: 'bar' }, h('i')); th.append(bar);
    const used = S.seq.clips.some(c => c.mediaId === m.id);
    const it = h('div', { class: 'pi' + (S.selMedia.has(m.id) ? ' sel' : '') + (m.missing ? ' missing' : ''), draggable: true, title: m.path || m.name },
      th,
      h('div', { class: 'meta' }, TZ.icon(mediaIcon(m)), h('span', { class: 'nm' }, m.name), used && projView === 'grid' ? h('span', { title: 'Użyte w sekwencji', style: { color: '#4aa3ff' } }, '●') : '', h('span', { class: 'du' }, m.type === 'image' ? 'Obraz' : TZ.fmtShort(m.duration))),
      projView === 'list' ? h('span', { class: 'fps' }, m.type === 'video' ? 'wideo' : m.type === 'audio' ? 'audio' : 'obraz') : '',
      projView === 'list' ? h('span', { class: 'res' }, m.width ? m.width + '×' + m.height : '') : '');
    // hover scrub
    th.addEventListener('mousemove', e => {
      if (!m.strip || m.strip.length < 2) return;
      const r = th.getBoundingClientRect(); const p = TZ.clamp((e.clientX - r.left) / r.width, 0, 1);
      const f = m.strip[Math.min(m.strip.length - 1, Math.floor(p * m.strip.length))];
      th.style.backgroundImage = `url(${f.c.toDataURL('image/jpeg', 0.7)})`; bar.firstChild.style.width = (p * 100) + '%';
    });
    th.addEventListener('mouseleave', () => { if (m.thumb) th.style.backgroundImage = `url(${m.thumb})`; bar.firstChild.style.width = '0'; });
    it.addEventListener('mousedown', e => {
      TZ.ui.focusPanel('project');
      if (e.button === 2 && S.selMedia.has(m.id)) return;
      if (e.ctrlKey) { S.selMedia.has(m.id) ? S.selMedia.delete(m.id) : S.selMedia.add(m.id); }
      else if (e.shiftKey && S.selMedia.size) { const ids = list.map(x => x.id); const last = [...S.selMedia].pop(); const a = ids.indexOf(last), b = ids.indexOf(m.id); ids.slice(Math.min(a, b), Math.max(a, b) + 1).forEach(i => S.selMedia.add(i)); }
      else if (!S.selMedia.has(m.id)) S.selMedia = new Set([m.id]);
      TZ.$$('.pi', items).forEach(x => x.classList.toggle('sel', false));
      P.renderProject(); P.renderInfo();
    });
    it.addEventListener('dblclick', () => { if (!m.missing && !m.loading) TZ.engine.source.open(m); else if (m.missing) TZ.relinkMedia(m); });
    it.addEventListener('dragstart', e => {
      if (!S.selMedia.has(m.id)) S.selMedia = new Set([m.id]);
      const ids = [...S.selMedia];
      window._tzDragMedia = ids;
      e.dataTransfer.setData('text/tz-media', JSON.stringify(ids)); e.dataTransfer.effectAllowed = 'copy';
    });
    it.addEventListener('dragend', () => { window._tzDragMedia = null; });
    it.addEventListener('contextmenu', e => { e.preventDefault(); projectMenu(e, m); });
    items.append(it);
  }
};
function projectMenu(e, m) {
  const sel = [...S.selMedia].map(TZ.mediaById).filter(Boolean);
  TZ.menu(e.clientX, e.clientY, [
    { label: 'Otwórz w monitorze źródła', disabled: m.missing, action: () => TZ.engine.source.open(m) },
    { label: 'Wstaw w miejscu głowicy', key: ',', disabled: m.missing, action: () => TZ.tl.placeMedia(sel, S.playhead, null, null, 'insert') },
    { label: 'Dodaj na końcu sekwencji', disabled: m.missing, action: () => TZ.tl.appendMedia(sel) },
    { label: 'Nowa sekwencja z klipu', disabled: m.missing || m.type === 'audio', action: () => P.newSeqFromClip(m) },
    '-',
    { label: 'Zmień nazwę…', action: async () => { const n = await TZ.prompt('Nazwa elementu', m.name); if (n) { m.name = n; TZ.markDirty(); P.renderProject(); } } },
    { label: 'Połącz multimedia…', disabled: !TZ.isElectron, action: () => TZ.relinkMedia(m) },
    { label: 'Pokaż w Eksploratorze', disabled: !m.path || !TZ.isElectron, action: () => window.native.showItem(m.path) },
    { label: 'Właściwości', action: () => { TZ.ui.showTab('project', 'info'); P.renderInfo(); } },
    '-',
    { label: 'Usuń z projektu', key: 'Delete', action: () => P.deleteSelectedMedia() }
  ]);
}
P.newSeqFromClip = async (m) => {
  if (S.seq.clips.length && !(await TZ.confirm('Bieżąca sekwencja zostanie zastąpiona nową sekwencją na podstawie klipu. Kontynuować?', 'Kontynuuj'))) return;
  S.seq.clips = []; S.seq.markers = []; S.seq.inPoint = S.seq.outPoint = null;
  S.seq.width = m.width || 1920; S.seq.height = m.height || 1080; S.seq.name = m.name.replace(/\.[^.]+$/, '');
  await TZ.tl.placeMedia([m], 0, null, null, 'overwrite');
  TZ.$('#seqNameTab').textContent = TZ.$('#seqNameTL').textContent = S.seq.name;
  TZ.engine.layoutProgram(); TZ.tl.zoomFit(); TZ.engine.seek(0);
};
P.deleteSelectedMedia = async () => {
  const ids = [...S.selMedia]; if (!ids.length) return;
  const used = S.seq.clips.filter(c => ids.includes(c.mediaId)).length;
  if (used && !(await TZ.confirm(`Zaznaczone elementy są używane w sekwencji (${used} klipów). Usunąć je razem z klipami?`, 'Usuń'))) return;
  TZ.removeMedia(ids);
};
TZ.$('#projSearch').addEventListener('input', P.renderProject);
TZ.$('#projList').onclick = () => { projView = 'list'; TZ.$('#projList').classList.add('on'); TZ.$('#projGrid').classList.remove('on'); P.renderProject(); };
TZ.$('#projGrid').onclick = () => { projView = 'grid'; TZ.$('#projGrid').classList.add('on'); TZ.$('#projList').classList.remove('on'); P.renderProject(); };
TZ.$('#projThumbSize').addEventListener('input', e => items.style.setProperty('--ts', e.target.value + 'px'));
TZ.$('#projImport').onclick = () => TZ.importDialog();
TZ.$('#projDelete').onclick = () => P.deleteSelectedMedia();
TZ.$('#projNewItem').onclick = (e) => P.newItemMenu(e.clientX, e.clientY - 120);
P.newItemMenu = (x, y) => TZ.menu(x, y, [
  { label: 'Tekst / tytuł', action: () => { TZ.tl.addSynthetic('text'); TZ.ui.showTab('right', 'graphics'); } },
  { label: 'Plansza koloru', action: async () => { const c = TZ.tl.addSynthetic('color', { color: '#000000' }); void c; } },
  { label: 'Warstwa korekcyjna', action: () => TZ.tl.addSynthetic('adjust') },
  '-',
  { label: 'Ustawienia sekwencji…', action: () => P.sequenceSettings() }
]);
items.addEventListener('dblclick', e => { if (e.target === items || e.target.closest('.drop-hint')) TZ.importDialog(); });
items.addEventListener('mousedown', e => { if (e.target === items) { S.selMedia.clear(); P.renderProject(); } });
items.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); items.classList.add('dragover'); } });
items.addEventListener('dragleave', () => items.classList.remove('dragover'));
items.addEventListener('drop', async e => { e.preventDefault(); items.classList.remove('dragover'); if (e.dataTransfer.files.length) await TZ.importFiles([...e.dataTransfer.files]); });
items.addEventListener('contextmenu', e => { if (e.target === items || e.target.closest('.drop-hint')) { e.preventDefault(); TZ.menu(e.clientX, e.clientY, [{ label: 'Importuj…', key: 'Ctrl+I', action: () => TZ.importDialog() }, { label: 'Importuj folder…', action: () => TZ.importFolder() }, '-', { label: 'Nowy element', sub: [{ label: 'Tekst', action: () => TZ.tl.addSynthetic('text') }, { label: 'Plansza koloru', action: () => TZ.tl.addSynthetic('color') }, { label: 'Warstwa korekcyjna', action: () => TZ.tl.addSynthetic('adjust') }] }]); } });

P.sequenceSettings = async () => {
  const presets = [['3840x2160', '4K UHD 3840×2160'], ['2560x1440', 'QHD 2560×1440'], ['1920x1080', 'Full HD 1920×1080'], ['1280x720', 'HD 720p 1280×720'], ['1080x1920', 'Pionowy 1080×1920 (TikTok/Reels)'], ['1080x1080', 'Kwadrat 1080×1080'], ['1080x1350', 'Instagram 4:5 1080×1350'], ['custom', 'Niestandardowy']];
  const name = h('input', { type: 'text', value: S.seq.name, style: { width: '100%' } });
  const cur = S.seq.width + 'x' + S.seq.height;
  const pre = h('select', { style: { width: '100%' } }, ...presets.map(([v, n]) => h('option', { value: v, selected: v === cur }, n)));
  if (!presets.some(p => p[0] === cur)) pre.value = 'custom';
  const w = h('input', { type: 'number', value: S.seq.width, min: 16, max: 8192, style: { width: '90px' } });
  const hh = h('input', { type: 'number', value: S.seq.height, min: 16, max: 8192, style: { width: '90px' } });
  const fps = h('select', null, ...[23.976, 24, 25, 29.97, 30, 50, 59.94, 60].map(f => h('option', { value: f, selected: Math.abs(f - S.seq.fps) < 0.01 }, f + ' kl./s')));
  pre.onchange = () => { if (pre.value !== 'custom') { const [a, b] = pre.value.split('x'); w.value = a; hh.value = b; } };
  const body = h('div', { style: { display: 'grid', gridTemplateColumns: '130px 1fr', gap: '10px', alignItems: 'center', width: '440px' } },
    'Nazwa sekwencji', name, 'Ustawienie wstępne', pre, 'Rozmiar klatki', h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, w, '×', hh), 'Podstawa czasu', fps);
  const r = await TZ.modal({ title: 'Ustawienia sekwencji', body, buttons: [{ label: 'Anuluj', value: null }, { label: 'OK', primary: true, value: true }] });
  if (!r) return;
  S.seq.name = name.value || S.seq.name;
  TZ.tl.setSequenceSize(TZ.clamp(+w.value | 0, 16, 8192), TZ.clamp(+hh.value | 0, 16, 8192), +fps.value);
  TZ.$('#seqNameTab').textContent = TZ.$('#seqNameTL').textContent = S.seq.name;
  TZ.commit('Ustawienia sekwencji'); TZ.emit('seq');
};

/* ======================= EFFECTS ======================= */
let favs = (() => { try { return JSON.parse(localStorage.getItem('tz.favs') || '[]'); } catch (e) { return []; } })();
const saveFavs = () => { try { localStorage.setItem('tz.favs', JSON.stringify(favs)); } catch (e) {} };
let fxOpen = (() => { try { return new Set(JSON.parse(localStorage.getItem('tz.fxopen') || '["Efekty wideo"]')); } catch (e) { return new Set(['Efekty wideo']); } })();
const saveOpen = () => { try { localStorage.setItem('tz.fxopen', JSON.stringify([...fxOpen])); } catch (e) {} };
P.applyItem = (kind, id) => {
  const sel = TZ.selectedClips();
  if (!sel.length) { TZ.toast('Najpierw zaznacz klip na osi czasu (albo przeciągnij element na klip)'); return; }
  if (kind === 'effect') { const def = TZ.fxDef(id); let n = 0; for (const c2 of sel) if (!!def.audio === (c2.type === 'audio')) { c2.effects.push(TZ.newEffect(id)); n++; } if (n) { TZ.commit('Zastosuj efekt: ' + def.name); TZ.emit('seq'); TZ.emit('sel'); UI().showTab('lefttop', 'ecp'); } else TZ.toast(def.audio ? 'Zaznacz klip audio' : 'Zaznacz klip wideo'); }
  else if (kind === 'transition') { const def = TZ.trDef(id); for (const c2 of sel) if (!!def.audio === (c2.type === 'audio')) c2.transIn = { type: id, dur: Math.min(1, c2.dur / 2) }; TZ.commit('Przejście: ' + def.name); TZ.emit('seq'); }
  else if (kind === 'preset') { for (const c2 of sel) if (c2.type !== 'audio') TZ.tl.applyPreset(c2, id); }
  else if (kind === 'look') { for (const c2 of sel) if (c2.type !== 'audio') c2.lumetri.look = id; TZ.commit('Wygląd Lumetri'); TZ.emit('seq'); TZ.emit('sel'); }
};
const UI = () => TZ.ui;
function buildEffects() {
  const page = TZ.$('#effectsPage'); page.innerHTML = '';
  const search = h('input', { placeholder: 'Szukaj efektów, przejść i ustawień', style: { flex: 1, minWidth: 0 } });
  let gpuOnly = false;
  const gpuBtn = h('button', { class: 'fx-tool', title: 'Pokaż tylko efekty akcelerowane przez GPU' }, 'GPU');
  const exp = h('button', { class: 'fx-tool', title: 'Zwiń wszystkie foldery' }, '−');
  const tree = h('div', { class: 'fx-tree' });
  page.append(h('div', { class: 'fx-search' }, h('div', { class: 'search', style: { maxWidth: 'none', flex: 1 } }, TZ.icon('search'), search), gpuBtn, exp), tree);
  gpuBtn.onclick = () => { gpuOnly = !gpuOnly; gpuBtn.classList.toggle('on', gpuOnly); render(); };
  exp.onclick = () => { fxOpen.clear(); saveOpen(); render(); };
  const groups = () => [
    { name: 'Ulubione', kind: 'fav', cats: [{ cat: null, items: favs.map(f => Object.assign({ _kind: f.kind }, f.kind === 'effect' ? TZ.fxDef(f.id) : f.kind === 'transition' ? TZ.trDef(f.id) : f.kind === 'preset' ? TZ.presetDef(f.id) : TZ.LOOKS.find(l => l.id === f.id))).filter(x => x && x.id) }] },
    { name: 'Ustawienia wstępne', kind: 'preset', cats: TZ.PRESETS },
    { name: 'Ustawienia Lumetri', kind: 'look', cats: [{ cat: null, items: TZ.LOOKS.filter(l => l.id !== 'none') }] },
    { name: 'Efekty audio', kind: 'effect', cats: TZ.EFFECTS.filter(c => c.audio) },
    { name: 'Przejścia audio', kind: 'transition', cats: TZ.TRANSITIONS.filter(c => c.audio) },
    { name: 'Efekty wideo', kind: 'effect', cats: TZ.EFFECTS.filter(c => !c.audio) },
    { name: 'Przejścia wideo', kind: 'transition', cats: TZ.TRANSITIONS.filter(c => !c.audio) }
  ];
  const itemEl = (kind, it, depth) => {
    const realKind = kind === 'fav' ? it._kind : kind;
    const ic = realKind === 'transition' ? 'transition' : realKind === 'look' ? 'color' : realKind === 'preset' ? 'stopwatch' : 'fx';
    const isFav = favs.some(f => f.id === it.id && f.kind === realKind);
    const el = h('div', { class: 'fx-item', draggable: true, style: { paddingLeft: (14 + depth * 16) + 'px' }, title: realKind === 'look' ? 'Kliknij dwukrotnie, aby zastosować do zaznaczonych klipów' : 'Przeciągnij na klip na osi czasu lub kliknij dwukrotnie' },
      h('span', { class: 'fx-ic ' + realKind }, TZ.icon(ic)), h('span', { class: 'fx-nm' }, it.name),
      isFav ? h('span', { class: 'fx-star' }, '★') : '',
      realKind === 'effect' && it.gpu ? h('span', { class: 'tag' }, 'GPU') : '', realKind === 'effect' && it.gpu ? h('span', { class: 'tag' }, '32') : '');
    el.addEventListener('dragstart', e => {
      const type = realKind === 'effect' ? 'text/tz-effect' : realKind === 'transition' ? 'text/tz-transition' : realKind === 'preset' ? 'text/tz-preset' : 'text/tz-look';
      e.dataTransfer.setData(type, it.id); e.dataTransfer.effectAllowed = 'copy';
    });
    el.addEventListener('dblclick', () => P.applyItem(realKind, it.id));
    el.addEventListener('contextmenu', e => {
      e.preventDefault();
      TZ.menu(e.clientX, e.clientY, [
        { label: 'Zastosuj do zaznaczonych klipów', action: () => P.applyItem(realKind, it.id) },
        isFav ? { label: 'Usuń z ulubionych', action: () => { favs = favs.filter(f => !(f.id === it.id && f.kind === realKind)); saveFavs(); render(); } }
              : { label: 'Dodaj do ulubionych ★', action: () => { favs.push({ kind: realKind, id: it.id }); saveFavs(); fxOpen.add('Ulubione'); saveOpen(); render(); } },
        realKind === 'transition' && !it.audio ? { label: 'Ustaw jako domyślne przejście wideo', action: () => { TZ.settings.defaultTransition = it.id; TZ.saveSettings(); TZ.toast('Domyślne przejście (Ctrl+D): ' + it.name); } } : null
      ]);
    });
    return el;
  };
  const render = () => {
    const q = search.value.trim().toLowerCase(); tree.innerHTML = '';
    for (const g of groups()) {
      const key = g.name;
      const open = q || fxOpen.has(key);
      const folder = h('div', { class: 'fx-folder' + (open ? ' open' : '') });
      let count = 0;
      const head = h('div', { class: 'fx-fh' }, TZ.icon('chev', 'chev'), TZ.icon(g.kind === 'fav' ? 'diamond' : 'folder', 'fold'), g.name);
      head.onclick = () => { if (fxOpen.has(key)) fxOpen.delete(key); else fxOpen.add(key); saveOpen(); render(); };
      const box = h('div', { class: 'fx-items' });
      for (const c of g.cats) {
        const items = c.items.filter(it => (!q || it.name.toLowerCase().includes(q) || (c.cat || '').toLowerCase().includes(q)) && (!gpuOnly || g.kind !== 'effect' || it.gpu));
        if (!items.length) continue;
        count += items.length;
        if (c.cat) {
          const k2 = key + '/' + c.cat;
          const sopen = q || fxOpen.has(k2);
          const sub = h('div', { class: 'fx-folder' + (sopen ? ' open' : '') });
          const sh = h('div', { class: 'fx-fh', style: { paddingLeft: '22px' } }, TZ.icon('chev', 'chev'), TZ.icon('folder', 'fold'), c.cat, h('span', { class: 'fx-cnt' }, String(items.length)));
          sh.onclick = () => { if (fxOpen.has(k2)) fxOpen.delete(k2); else fxOpen.add(k2); saveOpen(); render(); };
          const sb = h('div', { class: 'fx-items' });
          items.forEach(it => sb.append(itemEl(g.kind, it, 2)));
          sub.append(sh, sb); box.append(sub);
        } else items.forEach(it => box.append(itemEl(g.kind, it, 1)));
      }
      if (q && !count) continue;
      head.append(h('span', { class: 'fx-cnt' }, String(count)));
      if (g.kind === 'fav' && !count && !q) box.append(h('div', { class: 'fx-item', style: { paddingLeft: '30px', color: '#777', cursor: 'default' } }, 'Kliknij prawym przyciskiem efekt → „Dodaj do ulubionych”'));
      folder.append(head, box); tree.append(folder);
    }
  };
  search.addEventListener('input', render);
  search.addEventListener('keydown', e => e.stopPropagation());
  render();
  P.refreshEffects = render;
}

/* ======================= PROPERTY EDITOR helpers ======================= */
let refreshers = [];
let interacting = false;
function scrubNum(get, set, o = {}) {
  const span = h('span', { class: 'scrub' });
  const fmt = v => (o.fmt ? o.fmt(v) : (Math.round(v * (o.dec != null ? Math.pow(10, o.dec) : 10)) / (o.dec != null ? Math.pow(10, o.dec) : 10)).toFixed(o.dec != null ? o.dec : 1));
  const upd = () => { span.textContent = fmt(get()); };
  upd(); refreshers.push(upd);
  span.addEventListener('pointerdown', e => {
    e.preventDefault(); const x0 = e.clientX, v0 = get(); let moved = false; interacting = true;
    span.setPointerCapture(e.pointerId);
    span.onpointermove = ev => {
      const dx = ev.clientX - x0; if (Math.abs(dx) > 2) moved = true; if (!moved) return;
      let v = v0 + dx * (o.step || 1) * (ev.shiftKey ? 10 : ev.ctrlKey ? 0.1 : 1);
      if (o.min != null) v = Math.max(o.min, v); if (o.max != null) v = Math.min(o.max, v);
      set(v, false); upd();
    };
    span.onpointerup = () => {
      span.onpointermove = null; interacting = false;
      if (moved) set(get(), true);
      else {
        const inp = h('input', { class: 'scrub-edit', value: fmt(get()) });
        span.replaceWith(inp); inp.focus(); inp.select();
        const done = (ok) => { if (ok) { let v = parseFloat(inp.value.replace(',', '.')); if (!isNaN(v)) { if (o.min != null) v = Math.max(o.min, v); if (o.max != null) v = Math.min(o.max, v); set(v, true); } } inp.replaceWith(span); upd(); };
        inp.addEventListener('keydown', ev => { ev.stopPropagation(); if (ev.key === 'Enter') done(true); if (ev.key === 'Escape') done(false); });
        inp.addEventListener('blur', () => done(true));
      }
    };
  });
  return span;
}
function section(title, opts = {}) {
  const sec = h('div', { class: 'pe-sec' + (opts.closed ? '' : ' open') });
  const act = h('span', { class: 'act' });
  const head = h('div', { class: 'pe-sh' }, TZ.icon('chev', 'chev'), opts.fx ? TZ.icon('fx', 'fxi') : '', h('span', null, title), act);
  head.addEventListener('click', e => { if (e.target.closest('.act')) return; sec.classList.toggle('open'); });
  const body = h('div', { class: 'pe-body' });
  sec.append(head, body);
  sec.body = body; sec.act = act;
  if (opts.toggle) {
    const tg = h('button', { class: 'tgl' + (opts.toggle.get() ? ' on' : ''), title: 'Włącz/wyłącz' });
    tg.onclick = () => { opts.toggle.set(!opts.toggle.get()); tg.classList.toggle('on', opts.toggle.get()); };
    act.append(tg);
  }
  if (opts.reset) act.append(h('button', { title: 'Resetuj', onclick: opts.reset }, TZ.icon('reset')));
  if (opts.remove) act.append(h('button', { title: 'Usuń', onclick: opts.remove }, TZ.icon('trash')));
  if (opts.extra) opts.extra.forEach(b => act.append(b));
  return sec;
}
/* keyframe-aware numeric row bound to clip prop */
/* generic keyframe-aware numeric row: store[valKey][k] + store.kf[k] (times are clip-local) */
function kfRow(c, store, valKey, k, label, o = {}) {
  const lt = () => S.playhead - c.start;
  const hasKf = () => !!(store.kf && store.kf[k] && store.kf[k].length);
  const get = () => hasKf() ? TZ.kfEval(store.kf[k], lt(), store[valKey][k]) : store[valKey][k];
  const set = (v, final) => {
    if (hasKf()) { const kf = store.kf[k], fr = 0.5 / S.seq.fps; const e = kf.find(x => Math.abs(x.t - lt()) < fr); if (e) e.v = v; else { kf.push({ t: lt(), v }); kf.sort((a, b) => a.t - b.t); } }
    else store[valKey][k] = v;
    if (o.onSet) o.onSet(v);
    TZ.emit('props');
    if (final) TZ.commitSoon(label);
  };
  const sw = h('button', { class: 'sw' + (hasKf() ? ' on' : ''), title: 'Przełącz animację (klatki kluczowe)' }, TZ.icon('stopwatch'));
  const kfBox = h('span', { class: 'kf' + (hasKf() ? ' vis' : '') });
  const addBtn = h('button', { class: 'add', title: 'Dodaj/usuń klatkę kluczową (prawy przycisk: interpolacja)' }, TZ.icon('diamond'));
  const prevBtn = h('button', { title: 'Poprzednia klatka kluczowa' }, TZ.icon('chevl'));
  const nextBtn = h('button', { title: 'Następna klatka kluczowa' }, TZ.icon('chev'));
  kfBox.append(prevBtn, addBtn, nextBtn);
  const atKf = () => hasKf() ? store.kf[k].find(q => Math.abs(q.t - lt()) < 0.5 / S.seq.fps) : null;
  const refreshKf = () => { sw.classList.toggle('on', hasKf()); kfBox.classList.toggle('vis', hasKf()); addBtn.classList.toggle('on', !!atKf()); };
  refreshers.push(refreshKf); refreshKf();
  sw.onclick = () => {
    store.kf = store.kf || {};
    if (hasKf()) { store[valKey][k] = get(); delete store.kf[k]; } else store.kf[k] = [{ t: lt(), v: store[valKey][k] }];
    refreshKf(); TZ.commit(hasKf() ? 'Włącz animację' : 'Wyłącz animację'); TZ.emit('props'); TZ.tl.requestDraw();
  };
  addBtn.onclick = () => {
    if (!hasKf()) return;
    const i = store.kf[k].findIndex(q => Math.abs(q.t - lt()) < 0.5 / S.seq.fps);
    if (i >= 0) { store.kf[k].splice(i, 1); if (!store.kf[k].length) delete store.kf[k]; }
    else { store.kf[k].push({ t: lt(), v: get() }); store.kf[k].sort((a, b) => a.t - b.t); }
    refreshKf(); TZ.commit('Klatka kluczowa'); TZ.emit('props'); TZ.tl.requestDraw();
  };
  addBtn.oncontextmenu = (e) => {
    e.preventDefault(); const q = atKf(); if (!q) { TZ.toast('Ustaw głowicę na klatce kluczowej'); return; }
    const setE = (v) => { q.ease = v; TZ.commit('Interpolacja'); TZ.emit('props'); };
    TZ.menu(e.clientX, e.clientY, [{ label: 'Liniowa', checked: !q.ease, action: () => setE(undefined) }, { label: 'Wygładzona (Bezier)', checked: q.ease === 'ease', action: () => setE('ease') }, { label: 'Łagodne wejście', checked: q.ease === 'in', action: () => setE('in') }, { label: 'Łagodne wyjście', checked: q.ease === 'out', action: () => setE('out') }, { label: 'Zatrzymaj', checked: q.ease === 'hold', action: () => setE('hold') }]);
  };
  prevBtn.onclick = () => { if (!hasKf()) return; const p = store.kf[k].filter(q => q.t < lt() - 1e-4).pop(); if (p) TZ.engine.seek(c.start + p.t); };
  nextBtn.onclick = () => { if (!hasKf()) return; const nn = store.kf[k].find(q => q.t > lt() + 1e-4); if (nn) TZ.engine.seek(c.start + nn.t); };
  const ctl = h('span', { class: 'ctl' });
  let num;
  if (o.slider) {
    const rg = h('input', { type: 'range', min: o.min, max: o.max, step: o.rstep || (o.max - o.min > 50 ? 1 : 0.01), value: get() });
    rg.addEventListener('input', () => { set(+rg.value, false); num.textContent = (+rg.value).toFixed(o.dec != null ? o.dec : 1); });
    rg.addEventListener('change', () => set(+rg.value, true));
    rg.addEventListener('dblclick', () => { set(o.def != null ? o.def : 0, true); rg.value = get(); });
    refreshers.push(() => { if (document.activeElement !== rg) rg.value = get(); });
    ctl.append(rg);
  }
  num = scrubNum(get, set, o);
  ctl.append(num);
  if (o.unit) ctl.append(h('span', { class: 'unit' }, o.unit));
  return h('div', { class: 'pe-row' }, o.nokf ? h('span') : sw, h('span', { class: 'lbl', title: label }, label), ctl, o.nokf ? h('span') : kfBox);
}
function propRow(c, k, label, o = {}) {
  return kfRow(c, c, 'props', k, label, Object.assign({}, o, { onSet: () => { if (k === 'volume' || k === 'pan') TZ.engine.sync(S.playhead, S.playing); } }));
}
function plainRow(label, ctl) { return h('div', { class: 'pe-row' }, h('span'), h('span', { class: 'lbl' }, label), h('span', { class: 'ctl' }, ctl), h('span')); }
function sliderRow(label, get, set, o = {}) {
  const rg = h('input', { type: 'range', min: o.min, max: o.max, step: o.step || 1, value: get(), class: o.cls || '' });
  const num = scrubNum(get, (v, f) => { set(v, f); rg.value = v; }, { min: o.min, max: o.max, step: o.sstep || (o.max - o.min) / 200, dec: o.dec != null ? o.dec : 1 });
  rg.addEventListener('input', () => { set(+rg.value, false); num.textContent = (+rg.value).toFixed(o.dec != null ? o.dec : 1); });
  rg.addEventListener('change', () => set(+rg.value, true));
  rg.addEventListener('dblclick', () => { set(o.def != null ? o.def : 0, true); rg.value = get(); num.textContent = (+get()).toFixed(o.dec != null ? o.dec : 1); });
  refreshers.push(() => { if (document.activeElement !== rg) rg.value = get(); });
  return h('div', { class: 'pe-row' }, h('span'), h('span', { class: 'lbl' }, label), h('span', { class: 'ctl' }, rg, num), h('span'));
}
P.refresh = () => { if (interacting) return; refreshers.forEach(f => { try { f(); } catch (e) {} }); };

/* ======================= EFFECT CONTROLS (ECP) ======================= */
function motionSections(c, wrap, compact) {
  if (c.type === 'audio') {
    const s = section('Głośność', { reset: () => { c.props.volume = 0; c.props.pan = 0; if (c.kf) { delete c.kf.volume; delete c.kf.pan; } TZ.commit('Resetuj głośność'); P.renderAll(); } });
    s.body.append(propRow(c, 'volume', 'Poziom', { min: -60, max: 15, step: 0.1, unit: 'dB', slider: true, def: 0 }));
    s.body.append(propRow(c, 'pan', 'Panorama', { min: -100, max: 100, step: 1, slider: true, def: 0, dec: 0 }));
    wrap.append(s);
    return;
  }
  if (c.type !== 'adjust') {
    const s = section(compact ? 'Przekształć' : 'Ruch', { reset: () => { Object.assign(c.props, { posX: S.seq.width / 2, posY: S.seq.height / 2, scale: 100, rotation: 0 }); if (c.kf) ['posX', 'posY', 'scale', 'rotation'].forEach(k => delete c.kf[k]); TZ.commit('Resetuj ruch'); P.renderAll(); TZ.emit('props'); } });
    s.body.append(propRow(c, 'posX', 'Pozycja X', { step: 1, dec: 1 }));
    s.body.append(propRow(c, 'posY', 'Pozycja Y', { step: 1, dec: 1 }));
    s.body.append(propRow(c, 'scale', 'Skala', { min: 0, max: 1000, step: 0.5, unit: '%', slider: compact, def: 100 }));
    s.body.append(propRow(c, 'rotation', 'Obrót', { step: 0.5, unit: '°' }));
    const fit = h('div', { class: 'pe-btnrow' },
      h('button', { class: 'btn small', onclick: () => { c.props.scale = 100; c.props.posX = S.seq.width / 2; c.props.posY = S.seq.height / 2; TZ.commit('Dopasuj'); P.renderAll(); TZ.emit('props'); } }, 'Dopasuj'),
      h('button', { class: 'btn small', onclick: () => { const si = R.sourceFor(c, Math.max(c.start, Math.min(S.playhead, c.start + c.dur - 0.01))); if (si) { const fill = Math.max(S.seq.width / (si.w * si.fit), S.seq.height / (si.h * si.fit)); c.props.scale = Math.round(fill * 1000) / 10; c.props.posX = S.seq.width / 2; c.props.posY = S.seq.height / 2; TZ.commit('Wypełnij'); P.renderAll(); TZ.emit('props'); } } }, 'Wypełnij'),
      h('button', { class: 'btn small', onclick: () => { c.props.posX = S.seq.width / 2; c.props.posY = S.seq.height / 2; TZ.commit('Wyśrodkuj'); P.renderAll(); TZ.emit('props'); } }, 'Wyśrodkuj'));
    s.body.append(fit);
    wrap.append(s);
  }
  const o = section('Krycie', { reset: () => { c.props.opacity = 100; c.props.blend = 'normal'; if (c.kf) delete c.kf.opacity; TZ.commit('Resetuj krycie'); P.renderAll(); TZ.emit('props'); } });
  o.body.append(propRow(c, 'opacity', 'Krycie', { min: 0, max: 100, step: 0.5, unit: '%', slider: true, def: 100 }));
  if (c.type !== 'adjust') {
    const bl = h('select', null, ...Object.entries(R.BLEND_NAMES).map(([v, n]) => h('option', { value: v, selected: c.props.blend === v }, n)));
    bl.onchange = () => { c.props.blend = bl.value; TZ.commit('Tryb mieszania'); TZ.emit('props'); };
    o.body.append(plainRow('Tryb mieszania', bl));
  }
  wrap.append(o);
  if (c.type !== 'adjust' && c.type !== 'color') {
    const cr = section('Przycinanie', { closed: !compact && !(c.props.cropL || c.props.cropR || c.props.cropT || c.props.cropB), reset: () => { Object.assign(c.props, { cropL: 0, cropR: 0, cropT: 0, cropB: 0 }); TZ.commit('Resetuj kadrowanie'); P.renderAll(); TZ.emit('props'); } });
    [['cropL', 'Z lewej'], ['cropT', 'Od góry'], ['cropR', 'Z prawej'], ['cropB', 'Od dołu']].forEach(([k, n]) => cr.body.append(propRow(c, k, n, { min: 0, max: 100, step: 0.2, unit: '%' })));
    wrap.append(cr);
  }
  if (c.type === 'color') {
    const s = section('Plansza koloru');
    const col = h('input', { type: 'color', value: c.color || '#000000' });
    col.oninput = () => { c.color = col.value; TZ.emit('props'); TZ.tl.requestDraw(); }; col.onchange = () => TZ.commit('Kolor planszy');
    s.body.append(plainRow('Kolor', col)); wrap.append(s);
  }
}
function effectSections(c, wrap) {
  (c.effects || []).forEach((fx, idx) => {
    const def = TZ.fxDef(fx.id); if (!def) return;
    fx.kf = fx.kf || {};
    const up = h('button', { title: 'Przesuń w górę', onclick: () => { if (idx > 0) { c.effects.splice(idx - 1, 0, c.effects.splice(idx, 1)[0]); TZ.commit('Kolejność efektów'); P.renderAll(); TZ.emit('props'); } } }, '▲');
    const dup = h('button', { title: 'Duplikuj efekt', onclick: () => { const cp = JSON.parse(JSON.stringify(fx)); cp.uid = TZ.uid('fx'); c.effects.splice(idx + 1, 0, cp); TZ.commit('Duplikuj efekt'); P.renderAll(); TZ.emit('props'); } }, '⧉');
    const s = section(def.name, {
      fx: true, toggle: { get: () => fx.enabled !== false, set: v => { fx.enabled = v; TZ.commit('Przełącz efekt'); TZ.emit('props'); } },
      reset: () => { def.params.forEach(p => fx.p[p.k] = p.def); fx.kf = {}; TZ.commit('Resetuj efekt'); P.renderAll(); TZ.emit('props'); },
      remove: () => { c.effects.splice(idx, 1); TZ.commit('Usuń efekt'); P.renderAll(); TZ.emit('props'); TZ.tl.requestDraw(); },
      extra: [up, dup]
    });
    if (!def.params.length) s.body.append(h('div', { class: 'empty-note', style: { padding: '4px 10px', textAlign: 'left' } }, 'Efekt nie ma parametrów.'));
    const audioRefresh = () => { if (def.audio) TZ.engine.sync(S.playhead, S.playing); };
    for (const p of def.params) {
      if (p.type === 'color') {
        const col = h('input', { type: 'color', value: fx.p[p.k] });
        col.oninput = () => { fx.p[p.k] = col.value; TZ.emit('props'); }; col.onchange = () => TZ.commit(def.name);
        const pick = h('button', { class: 'btn small', title: 'Pobierz kolor z monitora programu', onclick: () => P.pickColor(v => { fx.p[p.k] = v; col.value = v; TZ.commit(def.name); TZ.emit('props'); }) }, TZ.icon('dropper'));
        s.body.append(plainRow(p.n, h('span', { style: { display: 'flex', gap: '6px' } }, col, pick)));
      } else if (p.type === 'select') {
        const se = h('select', null, ...p.options.map((o, i) => h('option', { value: i, selected: (+fx.p[p.k] || 0) === i }, o)));
        se.onchange = () => { fx.p[p.k] = +se.value; TZ.commit(def.name); TZ.emit('props'); audioRefresh(); };
        s.body.append(plainRow(p.n, se));
      } else if (p.type === 'check') {
        const cb = h('input', { type: 'checkbox', checked: !!fx.p[p.k] });
        cb.onchange = () => { fx.p[p.k] = cb.checked; TZ.commit(def.name); TZ.emit('props'); audioRefresh(); };
        s.body.append(plainRow(p.n, cb));
      } else {
        const range = p.max - p.min, dec = p.step && p.step < 1 ? (p.step < 0.05 ? 2 : 1) : (range > 50 ? 0 : 1);
        s.body.append(kfRow(c, fx, 'p', p.k, p.n, { min: p.min, max: p.max, step: Math.max(0.01, range / 300), rstep: p.step || (range > 50 ? 1 : 0.1), slider: true, def: p.def, dec, unit: p.unit, nokf: !!def.audio, onSet: audioRefresh }));
      }
    }
    wrap.append(s);
  });
}
function transitionPanel(wrap) {
  const c = TZ.clipById(S.selTrans.clipId); if (!c) return false;
  const tr = S.selTrans.side === 'in' ? c.transIn : c.transOut; if (!tr) return false;
  const def = TZ.trDef(tr.type) || { name: tr.type };
  wrap.append(h('div', { class: 'pe-clipname' }, TZ.icon('transition'), h('span', { class: 'nm' }, 'Przejście: ' + def.name)));
  const s = section('Ustawienia przejścia');
  const sel = h('select', null, ...TZ.TRANSITIONS.filter(g => !!g.audio === (c.type === 'audio')).flatMap(g => g.items).map(i => h('option', { value: i.id, selected: i.id === tr.type }, i.name)));
  sel.onchange = () => { tr.type = sel.value; TZ.commit('Typ przejścia'); TZ.emit('seq'); P.renderECP(); };
  s.body.append(plainRow('Typ', sel));
  s.body.append(sliderRow('Czas trwania (s)', () => tr.dur, (v, f) => { tr.dur = Math.max(1 / S.seq.fps * 2, Math.min(v, c.dur)); TZ.emit('props'); TZ.tl.requestDraw(); if (f) TZ.commitSoon('Czas przejścia'); }, { min: 0.1, max: Math.max(0.2, Math.min(5, c.dur)), step: 0.01, dec: 2, def: 1 }));
  s.body.append(h('div', { class: 'pe-btnrow' },
    h('button', { class: 'btn small', onclick: () => { tr.dur = 0.5; TZ.commit('Czas przejścia'); TZ.emit('seq'); P.renderECP(); } }, '0,5 s'),
    h('button', { class: 'btn small', onclick: () => { tr.dur = 1; TZ.commit('Czas przejścia'); TZ.emit('seq'); P.renderECP(); } }, '1 s'),
    h('button', { class: 'btn small', onclick: () => { tr.dur = 2; TZ.commit('Czas przejścia'); TZ.emit('seq'); P.renderECP(); } }, '2 s'),
    h('button', { class: 'btn small', onclick: () => TZ.tl.deleteSelection() }, 'Usuń przejście')));
  s.body.append(h('div', { class: 'empty-note', style: { textAlign: 'left', padding: '4px 10px', fontSize: '11px' } }, 'Wskazówka: przeciągnij krawędź przejścia na osi czasu, aby zmienić jego długość.'));
  wrap.append(s);
  return true;
}
P.pickColor = (cb) => {
  const pc = TZ.engine.programCanvas; TZ.toast('Kliknij w monitorze programu, aby pobrać kolor');
  const fn = (e) => {
    e.stopPropagation(); e.preventDefault();
    const r = pc.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width * pc.width, y = (e.clientY - r.top) / r.height * pc.height;
    const d = pc.getContext('2d').getImageData(Math.floor(x), Math.floor(y), 1, 1).data;
    cb('#' + [d[0], d[1], d[2]].map(v => v.toString(16).padStart(2, '0')).join(''));
    pc.style.cursor = '';
  };
  pc.style.cursor = 'crosshair';
  pc.addEventListener('pointerdown', fn, { once: true, capture: true });
};
function clipHeader(c) {
  const m = TZ.mediaById(c.mediaId);
  return h('div', { class: 'pe-clipname' }, TZ.icon(c.type === 'audio' ? 'music' : c.type === 'text' ? 'type' : c.type === 'image' ? 'image' : c.type === 'adjust' ? 'adjust' : c.type === 'color' ? 'color' : 'film'), h('span', { class: 'nm' }, (S.seq.name + ' * ') + c.name), m && m.missing ? h('span', { style: { color: '#e55' } }, 'brak pliku') : '');
}
P.renderECP = () => {
  const page = TZ.$('#ecpPage'); page.innerHTML = '';
  if (S.selTrans) { const w = h('div', { class: 'pe' }); if (transitionPanel(w)) { page.append(w); return; } }
  const c = TZ.primaryClip();
  if (!c) { page.append(h('div', { class: 'empty-note' }, 'Zaznacz klip na osi czasu, aby edytować jego efekty')); return; }
  const wrap = h('div', { class: 'pe' });
  wrap.append(clipHeader(c));
  motionSections(c, wrap, false);
  if (c.type === 'video' || c.type === 'audio') {
    const s = section('Remapowanie czasu', { closed: c.speed === 1 });
    s.body.append(plainRow('Szybkość', h('span', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, h('span', { class: 'scrub' }, Math.round(c.speed * 100) + '%'), h('button', { class: 'btn small', onclick: () => TZ.tl.speedDialog() }, 'Zmień…'))));
    wrap.append(s);
  }
  if (c.type !== 'audio' && c.lumetri && !TZ.lumetriIsDefault(c.lumetri)) {
    const s = section('Kolor Lumetri', { fx: true, toggle: { get: () => c.lumetri.enabled, set: v => { c.lumetri.enabled = v; TZ.commit('Lumetri'); TZ.emit('props'); } }, remove: () => { c.lumetri = TZ.defaultLumetri(); TZ.commit('Usuń Lumetri'); P.renderAll(); TZ.emit('props'); } });
    s.body.append(h('div', { class: 'pe-btnrow' }, h('button', { class: 'btn small', onclick: () => TZ.ui.showTab('right', 'lumetri') }, 'Otwórz panel Kolor Lumetri')));
    wrap.append(s);
  }
  effectSections(c, wrap);
  // linked audio of selection
  const audioSel = TZ.selectedClips().filter(x => x !== c && x.type === 'audio');
  if (audioSel.length && c.type !== 'audio') {
    const a = audioSel[0];
    wrap.append(h('div', { class: 'pe-clipname', style: { marginTop: '8px' } }, TZ.icon('music'), h('span', { class: 'nm' }, 'Audio: ' + a.name)));
    motionSections(a, wrap, false);
    effectSections(a, wrap);
  }
  wrap.append(h('div', { class: 'empty-note', style: { fontSize: '11px' } }, 'Przeciągnij efekty z panelu Efekty na klip, aby je dodać.'));
  page.append(wrap);
};

/* ======================= PROPERTIES ======================= */
P.renderProps = () => {
  const page = TZ.$('#propsPage'); page.innerHTML = '';
  const c = TZ.primaryClip();
  const wrap = h('div', { class: 'pe' });
  if (!c) {
    wrap.append(h('div', { class: 'pe-clipname' }, TZ.icon('film'), h('span', { class: 'nm' }, S.seq.name)));
    const s = section('Sekwencja');
    s.body.append(plainRow('Rozmiar klatki', h('span', null, S.seq.width + ' × ' + S.seq.height)));
    s.body.append(plainRow('Liczba klatek', h('span', null, S.seq.fps + ' kl./s')));
    s.body.append(plainRow('Czas trwania', h('span', null, TZ.fmtTC(TZ.seqDuration(), S.seq.fps))));
    s.body.append(plainRow('Klipy', h('span', null, String(S.seq.clips.length))));
    s.body.append(h('div', { class: 'pe-btnrow' }, h('button', { class: 'btn small', onclick: () => P.sequenceSettings() }, 'Ustawienia sekwencji…')));
    wrap.append(s);
    const a = section('Audio – wyjście główne');
    a.body.append(sliderRow('Głośność główna', () => S.seq.masterVolume || 0, (v, f) => { S.seq.masterVolume = v; TZ.engine.sync(S.playhead, S.playing); if (f) TZ.commitSoon('Głośność główna'); }, { min: -40, max: 12, step: 0.1, dec: 1 }));
    wrap.append(a);
    wrap.append(h('div', { class: 'empty-note' }, 'Zaznacz klip, aby zobaczyć jego właściwości.'));
    page.append(wrap); return;
  }
  wrap.append(clipHeader(c));
  if (c.type === 'text') {
    const s = section('Tekst');
    s.body.append(h('div', { class: 'pe-btnrow' }, h('button', { class: 'btn small primary', onclick: () => TZ.ui.showTab('right', 'graphics') }, 'Edytuj tekst i styl…')));
    wrap.append(s);
  }
  motionSections(c, wrap, true);
  const audio = TZ.selectedClips().find(x => x.type === 'audio' && x !== c);
  if (audio) { const s = section('Audio'); s.body.append(propRow(audio, 'volume', 'Głośność', { min: -60, max: 15, step: 0.1, unit: 'dB', slider: true, def: 0 })); wrap.append(s); }
  if (c.type === 'video' || c.type === 'audio') {
    const s = section('Szybkość', { closed: true });
    s.body.append(plainRow('Szybkość klipu', h('span', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, Math.round(c.speed * 100) + '%', h('button', { class: 'btn small', onclick: () => TZ.tl.speedDialog() }, 'Zmień…'))));
    wrap.append(s);
  }
  page.append(wrap);
};

/* ======================= LUMETRI ======================= */
let lookCache = null;
P.renderLumetri = () => {
  const page = TZ.$('#lumetriPage'); page.innerHTML = '';
  const c = TZ.primaryClip();
  if (!c || c.type === 'audio') { page.append(h('div', { class: 'empty-note' }, 'Zaznacz klip wideo, obraz lub warstwę korekcyjną,\naby korygować kolory.')); return; }
  const L = c.lumetri = c.lumetri || TZ.defaultLumetri();
  const wrap = h('div', { class: 'pe' });
  wrap.append(clipHeader(c));
  const ch = (k, label, o) => sliderRow(label, () => L[k], (v, f) => { L[k] = v; TZ.emit('props'); if (f) { TZ.commitSoon('Lumetri: ' + label); TZ.tl.requestDraw(); } }, o);
  const bc = section('Podstawowa korekcja', {
    toggle: { get: () => L.enabled, set: v => { L.enabled = v; TZ.commit('Lumetri'); TZ.emit('props'); } },
    reset: () => { const look = L.look, la = L.lookAmt; c.lumetri = Object.assign(TZ.defaultLumetri(), { look, lookAmt: la }); TZ.commit('Resetuj korekcję'); P.renderLumetri(); TZ.emit('props'); }
  });
  bc.body.append(h('div', { class: 'pe-btnrow' }, h('button', { class: 'btn small', onclick: () => autoTone(c) }, 'Auto'), h('button', { class: 'btn small', onclick: () => { P.pickColor(hex => { const [r, g, b] = R.hex2rgb(hex); const avg = (r + g + b) / 3 || 0.5; L.temperature = TZ.clamp(Math.round((b - r) / avg * 60), -100, 100); L.tint = TZ.clamp(Math.round((g - (r + b) / 2) / avg * 70), -100, 100); TZ.commit('Balans bieli'); P.renderLumetri(); TZ.emit('props'); }); } }, TZ.icon('dropper'), ' Balans bieli')));
  bc.body.append(h('div', { class: 'pe-row' }, h('span'), h('b', { class: 'lbl', style: { color: '#ddd' } }, 'Kolor'), h('span'), h('span')));
  bc.body.append(ch('temperature', 'Temperatura', { min: -100, max: 100, step: 1, cls: 'slider-temp' }));
  bc.body.append(ch('tint', 'Odcień', { min: -100, max: 100, step: 1, cls: 'slider-tint' }));
  bc.body.append(ch('saturation', 'Nasycenie', { min: 0, max: 200, step: 1, def: 100, cls: 'slider-sat' }));
  bc.body.append(h('div', { class: 'pe-row' }, h('span'), h('b', { class: 'lbl', style: { color: '#ddd' } }, 'Światło'), h('span'), h('span')));
  bc.body.append(ch('exposure', 'Ekspozycja', { min: -5, max: 5, step: 0.05, dec: 2 }));
  bc.body.append(ch('contrast', 'Kontrast', { min: -100, max: 100, step: 1 }));
  bc.body.append(ch('highlights', 'Światła', { min: -100, max: 100, step: 1 }));
  bc.body.append(ch('shadows', 'Cienie', { min: -100, max: 100, step: 1 }));
  bc.body.append(ch('whites', 'Biele', { min: -100, max: 100, step: 1 }));
  bc.body.append(ch('blacks', 'Czernie', { min: -100, max: 100, step: 1 }));
  wrap.append(bc);
  const cr = section('Kreatywne', { reset: () => { L.look = 'none'; L.lookAmt = 100; L.faded = 0; L.vibrance = 0; L.sharpen = 0; TZ.commit('Resetuj kreatywne'); P.renderLumetri(); TZ.emit('props'); } });
  const looks = h('div', { class: 'lum-look' });
  // preview of looks from current program frame
  const src = document.createElement('canvas'); src.width = 156; src.height = 88;
  const previews = [];
  setTimeout(() => {
    try {
      const tmp = TZ.c2 || (TZ.c2 = document.createElement('canvas')); tmp.width = 312; tmp.height = Math.round(312 * S.seq.height / S.seq.width);
      const saved = c.lumetri; c.lumetri = TZ.defaultLumetri();
      const tt = (S.playhead >= c.start && S.playhead < c.start + c.dur) ? S.playhead : c.start + Math.min(c.dur / 2, 1);
      R.renderFrame(tt, tmp.getContext('2d'), tmp.width, tmp.height); c.lumetri = saved;
      src.getContext('2d').drawImage(tmp, 0, 0, 156, 88);
      previews.forEach(([lk, cvs]) => R.lookPreview(src, lk.id, cvs));
    } catch (e) { console.warn(e); }
  }, 120);
  for (const lk of TZ.LOOKS) {
    const cvs = h('canvas', { width: 156, height: 88 });
    previews.push([lk, cvs]);
    const el = h('div', { class: 'lk' + (L.look === lk.id ? ' on' : ''), onclick: () => { L.look = lk.id; TZ.commit('Wygląd: ' + lk.name); P.renderLumetri(); TZ.emit('props'); TZ.tl.requestDraw(); } }, cvs, lk.name);
    looks.append(el);
  }
  void lookCache;
  cr.body.append(looks);
  cr.body.append(ch('lookAmt', 'Intensywność wyglądu', { min: 0, max: 200, step: 1, def: 100 }));
  cr.body.append(ch('faded', 'Wyblakły film', { min: 0, max: 100, step: 1 }));
  cr.body.append(ch('sharpen', 'Wyostrzenie', { min: 0, max: 100, step: 1 }));
  cr.body.append(ch('vibrance', 'Jaskrawość', { min: -100, max: 100, step: 1 }));
  wrap.append(cr);
  const vg = section('Winieta', { closed: !L.vigAmount, reset: () => { L.vigAmount = 0; L.vigMid = 50; L.vigFeather = 50; TZ.commit('Resetuj winietę'); P.renderLumetri(); TZ.emit('props'); } });
  vg.body.append(ch('vigAmount', 'Ilość', { min: -100, max: 100, step: 1 }));
  vg.body.append(ch('vigMid', 'Punkt środkowy', { min: 0, max: 100, step: 1, def: 50 }));
  vg.body.append(ch('vigFeather', 'Wtapianie', { min: 0, max: 100, step: 1, def: 50 }));
  wrap.append(vg);
  if (!R.glOK()) wrap.append(h('div', { class: 'empty-note', style: { color: '#e88' } }, 'Akceleracja GPU (WebGL) niedostępna – korekcja kolorów wyłączona.'));
  page.append(wrap);
};
function autoTone(c) {
  const pc = TZ.engine.programCanvas;
  const t = document.createElement('canvas'); t.width = 160; t.height = 90; const x = t.getContext('2d', { willReadFrequently: true });
  const L = c.lumetri; const saved = JSON.stringify(L);
  c.lumetri = TZ.defaultLumetri(); R.renderFrame(S.playhead, pc.getContext('2d'), pc.width, pc.height);
  x.drawImage(pc, 0, 0, 160, 90); c.lumetri = JSON.parse(saved);
  const d = x.getImageData(0, 0, 160, 90).data; const lum = [];
  let rs = 0, gs = 0, bs = 0;
  for (let i = 0; i < d.length; i += 4) { lum.push(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]); rs += d[i]; gs += d[i + 1]; bs += d[i + 2]; }
  lum.sort((a, b) => a - b);
  const p = q => lum[Math.floor(q * (lum.length - 1))];
  const lo = p(0.01), hi = p(0.99), mid = p(0.5);
  const Lm = c.lumetri;
  Lm.exposure = TZ.clamp(Math.round(Math.log2(118 / Math.max(10, mid)) * 0.6 * 100) / 100, -2, 2);
  Lm.blacks = TZ.clamp(Math.round(-lo / 255 * 400), -60, 30);
  Lm.whites = TZ.clamp(Math.round((255 - hi) / 255 * 300), -30, 60);
  Lm.contrast = TZ.clamp(Math.round((0.8 - (hi - lo) / 255) * 40), -20, 30);
  const n = d.length / 4, avg = (rs + gs + bs) / 3 / n;
  Lm.temperature = TZ.clamp(Math.round(((bs - rs) / n) / avg * 50), -40, 40);
  Lm.tint = TZ.clamp(Math.round(((gs - (rs + bs) / 2) / n) / avg * 50), -30, 30);
  TZ.commit('Auto ton'); P.renderLumetri(); TZ.emit('props');
}

/* ======================= GRAPHICS / TEXT ======================= */
const FONTS = ['Segoe UI', 'Arial', 'Arial Black', 'Bahnschrift', 'Calibri', 'Cambria', 'Candara', 'Comic Sans MS', 'Consolas', 'Constantia', 'Corbel', 'Courier New', 'Franklin Gothic Medium', 'Gabriola', 'Georgia', 'Impact', 'Ink Free', 'Lucida Console', 'Palatino Linotype', 'Segoe Print', 'Segoe Script', 'Sitka Text', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana'];
const GFX_PRESETS = [
  { name: 'Tytuł główny', text: { content: 'TYTUŁ FILMU', size: 150, bold: true, tracking: 12, shadow: true, anim: 'fade' } },
  { name: 'Belka dolna', text: { content: 'Imię Nazwisko\nStanowisko', size: 54, bold: true, bg: true, bgColor: '#2b45d6', bgRadius: 14, bgPad: 22, align: 'left', anim: 'slideup', shadow: true }, posX: 0.24, posY: 0.78 },
  { name: 'Napisy', text: { content: 'Tekst napisów dialogowych', size: 52, bold: false, bg: true, bgColor: '#000000', bgOpacity: 60, bgRadius: 6, bgPad: 12, shadow: false }, posY: 0.88 },
  { name: 'Neon', text: { content: 'NEON', size: 170, bold: true, color: '#ff3df5', shadow: true, shadowColor: '#ff3df5', shadowBlur: 40, stroke: 3, strokeColor: '#ffffff', anim: 'pop' } },
  { name: 'Kinowy', text: { content: 'ROZDZIAŁ PIERWSZY', size: 64, bold: false, font: 'Georgia', tracking: 24, shadow: true, anim: 'fade' } },
  { name: 'Maszyna do pisania', text: { content: 'Dawno, dawno temu…', size: 72, bold: false, font: 'Courier New', anim: 'typewriter', shadow: true } }
];
P.renderGraphics = () => {
  const page = TZ.$('#graphicsPage'); page.innerHTML = '';
  const wrap = h('div', { class: 'pe' });
  const c = TZ.primaryClip();
  const presets = section('Nowa grafika', { closed: c && c.type === 'text' });
  const grid = h('div', { class: 'gfx-presets' });
  for (const p of GFX_PRESETS) {
    const cvs = h('canvas', { width: 240, height: 100, style: { width: '100%', height: '100%' } });
    const fake = { id: 'preview_' + p.name, text: Object.assign(TZ.defaultText(), p.text) };
    try { const tc = R.textCanvas(fake, 99); const x = cvs.getContext('2d'); const f = Math.min(220 / tc.width, 80 / tc.height); x.drawImage(tc, 120 - tc.width * f / 2, 50 - tc.height * f / 2, tc.width * f, tc.height * f); } catch (e) {}
    grid.append(h('div', { class: 'gfx-preset', title: 'Dodaj w miejscu głowicy', onclick: () => {
      const nc = TZ.tl.addSynthetic('text', { text: p.text, posY: p.posY ? S.seq.height * p.posY : null });
      if (p.posX) nc.props.posX = S.seq.width * p.posX;
      TZ.commit('Ustaw pozycję'); TZ.emit('props');
    } }, cvs, h('small', null, p.name)));
  }
  presets.body.append(grid);
  wrap.append(presets);
  if (!c || c.type !== 'text') {
    wrap.append(h('div', { class: 'empty-note' }, 'Kliknij szablon powyżej lub użyj narzędzia Tekst (T),\naby dodać napis. Zaznacz klip tekstowy, aby go edytować.'));
    page.append(wrap); return;
  }
  const T = c.text;
  const upd = (label) => { R.clearTextCache(c.id); c.name = (T.content.split('\n')[0] || 'Tekst').slice(0, 30); TZ.emit('props'); TZ.tl.requestDraw(); TZ.commitSoon(label || 'Tekst'); };
  const ts = section('Tekst');
  const ta = h('textarea', { value: T.content, rows: 3 });
  ta.addEventListener('input', () => { T.content = ta.value; upd('Edytuj tekst'); });
  ta.addEventListener('keydown', e => e.stopPropagation());
  ts.body.append(h('div', { style: { padding: '4px 10px' } }, ta));
  const font = h('select', null, ...FONTS.map(f => h('option', { value: f, selected: T.font === f, style: { fontFamily: f } }, f)));
  font.onchange = () => { T.font = font.value; upd('Czcionka'); };
  ts.body.append(plainRow('Czcionka', font));
  ts.body.append(sliderRow('Rozmiar', () => T.size, (v) => { T.size = v; upd('Rozmiar tekstu'); }, { min: 8, max: 400, step: 1, dec: 0, def: 110 }));
  const col = h('input', { type: 'color', value: T.color }); col.oninput = () => { T.color = col.value; upd('Kolor tekstu'); };
  const bold = h('button', { class: 'btn small' + (T.bold ? ' primary' : ''), style: { fontWeight: 700 }, onclick: () => { T.bold = !T.bold; bold.classList.toggle('primary', T.bold); upd('Pogrubienie'); } }, 'B');
  const ital = h('button', { class: 'btn small' + (T.italic ? ' primary' : ''), style: { fontStyle: 'italic' }, onclick: () => { T.italic = !T.italic; ital.classList.toggle('primary', T.italic); upd('Kursywa'); } }, 'I');
  ts.body.append(plainRow('Styl', h('span', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, col, bold, ital)));
  const al = h('select', null, ...[['left', 'Do lewej'], ['center', 'Wyśrodkuj'], ['right', 'Do prawej']].map(([v, n]) => h('option', { value: v, selected: T.align === v }, n)));
  al.onchange = () => { T.align = al.value; upd('Wyrównanie'); };
  ts.body.append(plainRow('Wyrównanie', al));
  ts.body.append(sliderRow('Odstępy liter', () => T.tracking || 0, v => { T.tracking = v; upd('Odstępy'); }, { min: -20, max: 100, step: 1, dec: 0 }));
  ts.body.append(sliderRow('Interlinia', () => T.lineHeight || 1.15, v => { T.lineHeight = v; upd('Interlinia'); }, { min: 0.7, max: 3, step: 0.05, dec: 2, def: 1.15 }));
  wrap.append(ts);
  const ap = section('Wygląd');
  const strokeCol = h('input', { type: 'color', value: T.strokeColor }); strokeCol.oninput = () => { T.strokeColor = strokeCol.value; upd('Obrys'); };
  ap.body.append(sliderRow('Obrys', () => T.stroke || 0, v => { T.stroke = v; upd('Obrys'); }, { min: 0, max: 30, step: 0.5, dec: 1 }));
  ap.body.append(plainRow('Kolor obrysu', strokeCol));
  const sh = h('input', { type: 'checkbox', checked: T.shadow }); sh.onchange = () => { T.shadow = sh.checked; upd('Cień'); };
  const shc = h('input', { type: 'color', value: T.shadowColor || '#000000' }); shc.oninput = () => { T.shadowColor = shc.value; upd('Cień'); };
  ap.body.append(plainRow('Cień', h('span', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, sh, shc)));
  ap.body.append(sliderRow('Rozmycie cienia', () => T.shadowBlur || 0, v => { T.shadowBlur = v; upd('Cień'); }, { min: 0, max: 80, step: 1, dec: 0 }));
  const bg = h('input', { type: 'checkbox', checked: T.bg }); bg.onchange = () => { T.bg = bg.checked; upd('Tło'); };
  const bgc = h('input', { type: 'color', value: T.bgColor }); bgc.oninput = () => { T.bgColor = bgc.value; upd('Tło'); };
  ap.body.append(plainRow('Tło (ramka)', h('span', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, bg, bgc)));
  ap.body.append(sliderRow('Krycie tła', () => T.bgOpacity == null ? 100 : T.bgOpacity, v => { T.bgOpacity = v; upd('Tło'); }, { min: 0, max: 100, step: 1, dec: 0, def: 100 }));
  ap.body.append(sliderRow('Margines tła', () => T.bgPad || 0, v => { T.bgPad = v; upd('Tło'); }, { min: 0, max: 120, step: 1, dec: 0 }));
  ap.body.append(sliderRow('Zaokrąglenie', () => T.bgRadius || 0, v => { T.bgRadius = v; upd('Tło'); }, { min: 0, max: 100, step: 1, dec: 0 }));
  wrap.append(ap);
  const an = section('Animacja i pozycja');
  const anim = h('select', null, ...[['none', 'Brak'], ['fade', 'Pojawienie (przenikanie)'], ['slideup', 'Wjazd od dołu'], ['pop', 'Wyskoczenie'], ['typewriter', 'Maszyna do pisania']].map(([v, n]) => h('option', { value: v, selected: (T.anim || 'none') === v }, n)));
  anim.onchange = () => { T.anim = anim.value; upd('Animacja tekstu'); };
  an.body.append(plainRow('Animacja wejścia', anim));
  const pos = (x, y) => () => { if (x != null) c.props.posX = S.seq.width * x; if (y != null) c.props.posY = S.seq.height * y; TZ.commit('Pozycja tekstu'); TZ.emit('props'); P.refresh(); };
  an.body.append(h('div', { class: 'pe-btnrow' },
    h('button', { class: 'btn small', onclick: pos(0.5, null) }, 'Środek poziomo'), h('button', { class: 'btn small', onclick: pos(null, 0.5) }, 'Środek pionowo'),
    h('button', { class: 'btn small', onclick: pos(0.5, 0.85) }, 'Dół'), h('button', { class: 'btn small', onclick: pos(0.5, 0.15) }, 'Góra'), h('button', { class: 'btn small', onclick: pos(0.22, 0.8) }, 'Belka dolna')));
  an.body.append(propRow(c, 'posX', 'Pozycja X', { step: 1 }));
  an.body.append(propRow(c, 'posY', 'Pozycja Y', { step: 1 }));
  an.body.append(propRow(c, 'scale', 'Skala', { min: 0, max: 1000, step: 0.5, unit: '%' }));
  an.body.append(propRow(c, 'opacity', 'Krycie', { min: 0, max: 100, step: 0.5, unit: '%' }));
  wrap.append(an);
  page.append(wrap);
};

/* ======================= HISTORY ======================= */
P.renderHistory = () => {
  const page = TZ.$('#historyPage'); page.innerHTML = '';
  const H = TZ.history;
  H.states.forEach((s, i) => {
    page.append(h('div', { class: 'hist-item' + (i === H.ptr ? ' cur' : i > H.ptr ? ' future' : ''), onclick: () => TZ.restoreHistory(i) }, TZ.icon(i === 0 ? 'new' : 'undo'), s.label));
  });
  const cur = page.querySelector('.cur'); if (cur) cur.scrollIntoView({ block: 'nearest' });
};

/* ======================= INFO ======================= */
let appInfo = null;
if (window.native) window.native.info().then(i => { appInfo = i; P.renderInfo(); });
P.renderInfo = () => {
  const page = TZ.$('#infoPage'); page.innerHTML = '';
  const g = h('div', { class: 'info-grid' });
  const add = (k, v) => g.append(h('b', null, k), h('span', null, v == null ? '—' : String(v)));
  const m = TZ.mediaById([...S.selMedia][0]);
  const c = TZ.primaryClip();
  if (m) {
    add('Element', m.name); add('Typ', m.type === 'video' ? 'Wideo' : m.type === 'audio' ? 'Audio' : 'Obraz');
    if (m.width) add('Rozmiar', m.width + ' × ' + m.height);
    if (m.type !== 'image') add('Czas trwania', TZ.fmtTC(m.duration, S.seq.fps));
    add('Audio', m.hasAudio ? 'Tak' : m.hasAudio === false ? 'Nie' : '?'); add('Ścieżka', m.path || '(w pamięci)');
    g.append(h('div', { style: { gridColumn: '1/-1', height: '8px' } }));
  }
  if (c) {
    add('Klip', c.name); add('Ścieżka', c.track); add('Początek', TZ.fmtTC(c.start, S.seq.fps)); add('Koniec', TZ.fmtTC(c.start + c.dur, S.seq.fps)); add('Czas trwania', TZ.fmtTC(c.dur, S.seq.fps));
    if (c.mediaId) add('Punkt wejścia źródła', TZ.fmtTC(c.in, S.seq.fps));
    g.append(h('div', { style: { gridColumn: '1/-1', height: '8px' } }));
  }
  add('Sekwencja', S.seq.name); add('Format', `${S.seq.width}×${S.seq.height} @ ${S.seq.fps} kl./s`); add('Czas trwania', TZ.fmtTC(TZ.seqDuration(), S.seq.fps)); add('Głowica', TZ.fmtTC(S.playhead, S.seq.fps));
  g.append(h('div', { style: { gridColumn: '1/-1', height: '8px' } }));
  add('Program', 'TopaZ Editing Pro 26'); add('Wersja', appInfo ? appInfo.version : '26.1.0'); add('Karta graficzna', (R.gpuName || '?').replace(/^ANGLE \((.*)\)$/, '$1'));
  add('Silnik renderowania', R.glOK() ? 'TopaZ GPU (WebGL 2)' + (TZ.settings.hq16 ? ', 16-bit' : ', 8-bit') : 'niedostępny');
  add('Silnik C++', TZ.exporter && TZ.exporter.engineInfo ? TZ.exporter.engineInfo : 'sprawdzanie…');
  if (appInfo) { add('Chromium', appInfo.chrome); add('Electron', appInfo.electron); }
  page.append(g);
};

/* ======================= AUDIO MIXER ======================= */
P.renderMixer = () => {
  const page = TZ.$('#mixerPage'); page.innerHTML = '';
  const box = h('div', { class: 'mixer' });
  const strip = (name, get, set, extra, cls) => {
    const db = h('span', { class: 'db' }, get().toFixed(1));
    const f = h('input', { type: 'range', class: 'vert', min: -60, max: 12, step: 0.1, value: get() });
    f.addEventListener('input', () => { set(+f.value); db.textContent = (+f.value).toFixed(1); TZ.engine.sync(S.playhead, S.playing); });
    f.addEventListener('change', () => TZ.commitSoon('Mikser'));
    f.addEventListener('dblclick', () => { set(0); f.value = 0; db.textContent = '0.0'; TZ.engine.sync(S.playhead, S.playing); });
    return h('div', { class: 'mix-ch' + (cls ? ' ' + cls : '') }, h('span', { class: 'nm' }, name), extra || '', f, db);
  };
  for (const tr of TZ.audioTracks()) {
    const btns = h('div', { class: 'btns' },
      h('button', { class: tr.muted ? 'on-m' : '', onclick: () => { tr.muted = !tr.muted; P.renderMixer(); TZ.tl.buildHeaders(); TZ.engine.sync(S.playhead, S.playing); } }, 'M'),
      h('button', { class: tr.solo ? 'on-s' : '', onclick: () => { tr.solo = !tr.solo; P.renderMixer(); TZ.tl.buildHeaders(); TZ.engine.sync(S.playhead, S.playing); } }, 'S'));
    box.append(strip(tr.name, () => tr.volume || 0, v => { tr.volume = v; }, btns));
  }
  box.append(strip('Główna', () => S.seq.masterVolume || 0, v => { S.seq.masterVolume = v; }, null, 'master'));
  page.append(box);
};

/* ======================= wiring ======================= */
P.renderAll = () => {
  refreshers = [];
  P.renderECP(); P.renderProps(); P.renderLumetri(); P.renderGraphics(); P.renderInfo();
};
const renderSel = TZ.debounce(() => P.renderAll(), 30);
TZ.on('sel', renderSel);
TZ.on('seq', () => { renderSel(); P.renderProject(); P.renderMixer(); });
TZ.on('media', () => { P.renderProject(); P.renderInfo(); });
TZ.on('mediaThumb', TZ.debounce(() => P.renderProject(), 100));
TZ.on('history', () => P.renderHistory());
TZ.on('mixer', () => P.renderMixer());
let lastRefresh = 0;
TZ.on('time', () => { const n = performance.now(); if (n - lastRefresh > (S.playing ? 150 : 0)) { lastRefresh = n; P.refresh(); } });
TZ.on('props', () => { if (!interacting) P.refresh(); });
buildEffects();
P.renderProject(); P.renderMixer();
setTimeout(P.renderAll, 0);
})();
