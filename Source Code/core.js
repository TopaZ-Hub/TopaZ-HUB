'use strict';
/* ==========================================================
   TopaZ Editing Pro 26 — core: state, utils, media, history
   ========================================================== */
const TZ = window.TZ = {};
const N = window.native || null;
TZ.isElectron = !!(N && N.isElectron);

/* ---------- utils ---------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  let val;
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'value') { val = v; if (tag === 'input') e.setAttribute('value', v); continue; }
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else if (k in e && typeof v !== 'string') e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
  if (val !== undefined) e.value = val;
  return e;
}
const icon = (id, cls) => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('class', 'ic' + (cls ? ' ' + cls : '')); const u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', '#i-' + id); s.append(u); return s; };
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
let _uidc = 0;
const uid = (p = 'c') => p + Date.now().toString(36).slice(-5) + (++_uidc).toString(36) + Math.random().toString(36).slice(2, 5);
const pad2 = n => (n < 10 ? '0' : '') + n;
function fmtTC(t, fps) {
  fps = Math.round(fps || 30);
  if (!isFinite(t)) t = 0;
  const neg = t < -1e-9; t = Math.abs(t);
  const fr = Math.round(t * fps + 1e-6), f = fr % fps, s = Math.floor(fr / fps);
  return (neg ? '-' : '') + pad2(Math.floor(s / 3600)) + ':' + pad2(Math.floor(s / 60) % 60) + ':' + pad2(s % 60) + ':' + pad2(f);
}
function fmtShort(t) { t = Math.max(0, t || 0); const s = Math.floor(t); return (s >= 3600 ? Math.floor(s / 3600) + ':' + pad2(Math.floor(s / 60) % 60) : Math.floor(s / 60)) + ':' + pad2(s % 60); }
function parseTC(str, fps, rel) {
  fps = Math.round(fps || 30);
  str = String(str).trim();
  if (!str) return null;
  let sign = 0;
  if (str[0] === '+' || str[0] === '-') { sign = str[0] === '+' ? 1 : -1; str = str.slice(1); }
  let t;
  if (/^\d+$/.test(str) && str.length <= 2 && sign) t = parseInt(str, 10) / fps; // +10 -> 10 frames
  else if (/^\d+$/.test(str)) { // digits like 1000 -> 00:00:10:00
    const d = str.padStart(8, '0');
    t = (+d.slice(0, 2)) * 3600 + (+d.slice(2, 4)) * 60 + (+d.slice(4, 6)) + (+d.slice(6, 8)) / fps;
  } else {
    const p = str.split(/[:;.,]/).map(Number);
    if (p.some(isNaN)) return null;
    while (p.length < 4) p.unshift(0);
    t = p[0] * 3600 + p[1] * 60 + p[2] + p[3] / fps;
  }
  return sign ? (rel || 0) + sign * t : t;
}
const dbToGain = db => db <= -60 ? 0 : Math.pow(10, db / 20);
const gainToDb = g => g <= 0.001 ? -60 : 20 * Math.log10(g);
const basename = p => String(p).split(/[\\/]/).pop();
const extOf = p => (String(p).split('.').pop() || '').toLowerCase();
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
Object.assign(TZ, { $, $$, h, icon, clamp, lerp, uid, fmtTC, fmtShort, parseTC, dbToGain, gainToDb, basename, extOf, debounce, sleep });

/* ---------- events ---------- */
const _ev = {};
TZ.on = (e, fn) => { (_ev[e] = _ev[e] || []).push(fn); };
TZ.emit = (e, d) => { (_ev[e] || []).forEach(fn => { try { fn(d); } catch (er) { console.error(er); } }); };

/* ---------- catalogs ---------- */
/* effect / transition catalogs live in effects.js */
TZ.LOOKS = [
  { id: 'none', name: 'Brak' },
  { id: 'teal', name: 'Teal & Orange', l: { contrast: 15, saturation: 112, temperature: 4, sh: [-0.02, 0.03, 0.06], hi: [0.07, 0.03, -0.04] } },
  { id: 'warm', name: 'Ciepły zachód', l: { temperature: 28, tint: 6, saturation: 108, highlights: -8, sh: [0.02, 0, -0.02], hi: [0.05, 0.02, -0.03] } },
  { id: 'cold', name: 'Zimny poranek', l: { temperature: -30, saturation: 90, contrast: 8, sh: [-0.02, 0, 0.05], hi: [0, 0.01, 0.04] } },
  { id: 'bwfilm', name: 'Film CZ-B', l: { saturation: 0, contrast: 28, blacks: -10, faded: 8 } },
  { id: 'vintage', name: 'Vintage', l: { faded: 35, saturation: 78, temperature: 18, contrast: -6, sh: [0.03, 0.02, 0.05], hi: [0.05, 0.04, -0.02] } },
  { id: 'bleach', name: 'Bleach Bypass', l: { saturation: 45, contrast: 38, highlights: 10, blacks: -12 } },
  { id: 'cine', name: 'Kinowy', l: { contrast: 20, saturation: 92, shadows: -10, highlights: -12, sh: [0, 0.02, 0.05], hi: [0.04, 0.02, 0] } },
  { id: 'vivid', name: 'Żywe kolory', l: { saturation: 135, vibrance: 30, contrast: 12 } },
  { id: 'night', name: 'Noc', l: { exposure: -1.2, temperature: -40, saturation: 70, contrast: 10, sh: [-0.03, 0, 0.06] } }
];

/* ---------- defaults ---------- */
TZ.defaultLumetri = () => ({ enabled: true, look: 'none', lookAmt: 100, temperature: 0, tint: 0, exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, saturation: 100, vibrance: 0, faded: 0, sharpen: 0, vigAmount: 0, vigMid: 50, vigFeather: 50 });
TZ.lumetriIsDefault = l => {
  if (!l || !l.enabled) return true;
  const d = TZ.defaultLumetri();
  for (const k in d) if (k !== 'enabled' && k !== 'lookAmt' && l[k] !== d[k]) return false;
  return true;
};
TZ.defaultText = () => ({ content: 'Nowy tytuł', font: 'Segoe UI', size: 110, color: '#ffffff', bold: true, italic: false, align: 'center', lineHeight: 1.15, tracking: 0, stroke: 0, strokeColor: '#000000', shadow: true, shadowColor: '#000000', shadowBlur: 18, bg: false, bgColor: '#2b45d6', bgPad: 26, bgRadius: 14, bgOpacity: 100, anim: 'none' });
TZ.defaultProps = (seq) => ({ posX: seq.width / 2, posY: seq.height / 2, scale: 100, rotation: 0, opacity: 100, blend: 'normal', cropL: 0, cropT: 0, cropR: 0, cropB: 0, volume: 0, pan: 0 });
TZ.CLIP_COLORS = { video: '#5d61c9', audio: '#2b9b74', image: '#8158c9', text: '#c4458e', color: '#c47a26', adjust: '#a85d1e' };
TZ.LABELS = [['Fioletowy', '#5d61c9'], ['Iris', '#7a5bd1'], ['Karaibski', '#22a39a'], ['Lawendowy', '#b18be3'], ['Cerulean', '#3d8ccf'], ['Leśny', '#4f9c3e'], ['Różowy', '#c4458e'], ['Mango', '#d88a2a'], ['Brązowy', '#8a5a33'], ['Mandarynka', '#e26a2c'], ['Morski', '#2b9b74'], ['Żółty', '#c9b52a']];

function newSequence(o = {}) {
  const t = (id, kind, name, extra = {}) => Object.assign({ id, kind, name, hidden: false, locked: false, muted: false, solo: false, target: false, volume: 0, h: kind === 'v' ? 46 : 44 }, extra);
  return Object.assign({
    id: uid('s'), name: 'Sekwencja 01', width: 1920, height: 1080, fps: 30,
    tracks: [t('V3', 'v', 'Wideo 3'), t('V2', 'v', 'Wideo 2'), t('V1', 'v', 'Wideo 1', { target: true }), t('A1', 'a', 'Audio 1', { target: true }), t('A2', 'a', 'Audio 2'), t('A3', 'a', 'Audio 3')],
    clips: [], markers: [], inPoint: null, outPoint: null, masterVolume: 0
  }, o);
}
TZ.newSequence = newSequence;

/* ---------- settings (Preferencje) ---------- */
TZ.defaultSettings = () => ({
  gpu: true, highPerfGPU: true, ignoreBlocklist: true, hwDecode: true, hwEncode: 'prefer-hardware',
  hq16: false, hqScale: true, previewQuality: '1', dropFrames: true, ramGB: 0, decoders: 0, prerollSec: 2,
  autosaveMin: 3, undoLevels: 200, exportEngine: 'gpu', exportFolder: '', engineThreads: 0, showStart: true, lowPowerGPU: false
});
TZ.settings = Object.assign(TZ.defaultSettings(), (N && N.settings) ? N.settings : (() => { try { return JSON.parse(localStorage.getItem('tz.settings') || '{}'); } catch (e) { return {}; } })());
TZ.saveSettings = () => { try { if (N && N.saveSettings) N.saveSettings(TZ.settings); else localStorage.setItem('tz.settings', JSON.stringify(TZ.settings)); } catch (e) {} };

/* ---------- state ---------- */
const S = TZ.state = {
  project: { name: 'Bez tytułu', path: null, dirty: false },
  media: [],
  seq: newSequence(),
  playhead: 0, playing: false,
  selection: new Set(), selMedia: new Set(),
  tool: 'select', snap: true, linked: true, loop: false,
  zoom: 60, scrollX: 0, scrollY: 0,
  clipboard: null, focus: 'timeline'
};
TZ.mediaById = id => S.media.find(m => m.id === id);
TZ.clipById = id => S.seq.clips.find(c => c.id === id);
TZ.trackById = id => S.seq.tracks.find(t => t.id === id);
TZ.clipEnd = c => c.start + c.dur;
TZ.seqDuration = () => S.seq.clips.reduce((m, c) => Math.max(m, c.start + c.dur), 0);
TZ.fps = () => S.seq.fps;
TZ.frame = () => 1 / S.seq.fps;
TZ.snapFrame = t => Math.round(t * S.seq.fps) / S.seq.fps;
TZ.selectedClips = () => S.seq.clips.filter(c => S.selection.has(c.id));
TZ.primaryClip = () => { const a = TZ.selectedClips(); return a.find(c => c.type !== 'audio') || a[0] || null; };
TZ.videoTracks = () => S.seq.tracks.filter(t => t.kind === 'v');
TZ.audioTracks = () => S.seq.tracks.filter(t => t.kind === 'a');
TZ.isVisualClip = c => c.type !== 'audio';

/* ---------- toast / status ---------- */
let _toastT;
TZ.toast = (msg, ms = 2200) => { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(_toastT); _toastT = setTimeout(() => t.classList.remove('show'), ms); };
TZ.status = (msg) => { const s = $('#statusText'); if (s) s.textContent = msg; };

/* ---------- modal ---------- */
TZ.modal = ({ title, body, buttons = [{ label: 'OK', value: true, primary: true }], width, onOpen, closable = true }) => new Promise(res => {
  const bg = h('div', { class: 'modal-bg' });
  const m = h('div', { class: 'modal', style: width ? { width: width + 'px' } : null });
  const bodyEl = h('div', { class: 'mbody' });
  if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.append(body);
  const foot = h('div', { class: 'mfoot' });
  const close = (v) => { bg.remove(); document.removeEventListener('keydown', key, true); res(v); };
  buttons.forEach(b => foot.append(h('button', { class: 'btn' + (b.primary ? ' primary' : ''), onclick: () => { if (b.validate && !b.validate()) return; close(typeof b.value === 'function' ? b.value() : b.value); } }, b.label)));
  const key = (e) => {
    if (e.key === 'Escape' && closable) { e.stopPropagation(); close(null); }
    else if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') { const p = buttons.find(b => b.primary); if (p) { e.preventDefault(); e.stopPropagation(); if (p.validate && !p.validate()) return; close(typeof p.value === 'function' ? p.value() : p.value); } }
    e.stopPropagation();
  };
  document.addEventListener('keydown', key, true);
  m.append(title ? h('h3', null, title) : '', bodyEl, buttons.length ? foot : '');
  bg.append(m);
  $('#modalRoot').append(bg);
  m.closeModal = close;
  if (onOpen) onOpen(m, close);
  const f = m.querySelector('input,select,textarea'); if (f) setTimeout(() => { f.focus(); if (f.select) f.select(); }, 30);
});
TZ.confirm = (msg, ok = 'OK', cancel = 'Anuluj', title = 'TopaZ Editing Pro 26') => TZ.modal({ title, body: h('div', { style: { maxWidth: '440px' } }, msg), buttons: [{ label: cancel, value: false }, { label: ok, value: true, primary: true }] });
TZ.alert = (msg, title = 'TopaZ Editing Pro 26') => TZ.modal({ title, body: h('div', { style: { maxWidth: '480px', whiteSpace: 'pre-wrap' } }, msg) });
TZ.prompt = (title, value = '', label = '') => {
  const inp = h('input', { type: 'text', value, style: { width: '100%' } });
  return TZ.modal({ title, body: h('div', null, label ? h('div', { style: { marginBottom: '6px' } }, label) : '', inp), buttons: [{ label: 'Anuluj', value: null }, { label: 'OK', primary: true, value: () => inp.value }] });
};

/* ---------- dropdown menus ---------- */
let _openDrop = null;
TZ.closeMenus = () => { $$('.dropdown').forEach(d => d.remove()); _openDrop = null; $$('#menubar .mi.open').forEach(m => m.classList.remove('open')); };
TZ.menu = (x, y, items, opts = {}) => {
  if (!opts.sub) TZ.closeMenus();
  const d = h('div', { class: 'dropdown' });
  for (const it of items) {
    if (!it) continue;
    if (it === '-') { d.append(h('div', { class: 'sep' })); continue; }
    const row = h('div', { class: 'it' + (it.disabled ? ' dis' : '') + (it.checked ? ' chk' : '') + (it.sub ? ' sub' : '') }, h('span', null, it.label), it.key ? h('span', { class: 'k' }, it.key) : '');
    if (it.sub) {
      row.addEventListener('mouseenter', () => {
        $$('.dropdown.sublevel').forEach(s => { if (s.parentOwner === d) s.remove(); });
        const r = row.getBoundingClientRect();
        const sd = TZ.menu(r.right - 2, r.top - 4, it.sub, { sub: true });
        sd.classList.add('sublevel'); sd.parentOwner = d;
      });
    } else {
      row.addEventListener('mouseenter', () => $$('.dropdown.sublevel').forEach(s => { if (s.parentOwner === d) s.remove(); }));
      row.addEventListener('mousedown', e => e.stopPropagation());
      row.addEventListener('click', e => { e.stopPropagation(); TZ.closeMenus(); if (it.action) setTimeout(() => it.action(), 0); });
    }
    d.append(row);
  }
  d.addEventListener('mousedown', e => e.stopPropagation());
  document.body.append(d);
  const r = d.getBoundingClientRect();
  d.style.left = Math.min(x, innerWidth - r.width - 4) + 'px';
  d.style.top = Math.min(y, innerHeight - r.height - 4) + 'px';
  if (!opts.sub) _openDrop = d;
  return d;
};
document.addEventListener('mousedown', () => { if (_openDrop) TZ.closeMenus(); });

/* ---------- history (undo/redo) ---------- */
const H = TZ.history = { states: [], ptr: -1, max: Math.max(20, TZ.settings.undoLevels || 200) };
const snap = () => JSON.stringify({ seq: S.seq });
TZ.resetHistory = (label = 'Nowy projekt') => { H.states = [{ label, snap: snap() }]; H.ptr = 0; TZ.emit('history'); };
TZ.commit = (label) => {
  H.states.length = H.ptr + 1;
  H.states.push({ label, snap: snap() });
  if (H.states.length > H.max) H.states.shift();
  H.ptr = H.states.length - 1;
  TZ.markDirty();
  TZ.emit('history');
};
TZ.restoreHistory = (i) => {
  if (i < 0 || i >= H.states.length) return;
  H.ptr = i;
  const d = JSON.parse(H.states[i].snap);
  S.seq = d.seq;
  for (const id of [...S.selection]) if (!TZ.clipById(id)) S.selection.delete(id);
  TZ.markDirty();
  TZ.emit('seq'); TZ.emit('sel'); TZ.emit('history');
};
TZ.undo = () => { if (H.ptr > 0) { const l = H.states[H.ptr].label; TZ.restoreHistory(H.ptr - 1); TZ.status('Cofnięto: ' + l); } };
TZ.redo = () => { if (H.ptr < H.states.length - 1) { TZ.restoreHistory(H.ptr + 1); TZ.status('Ponowiono: ' + H.states[H.ptr].label); } };

TZ.markDirty = () => { if (!S.project.dirty) { S.project.dirty = true; TZ.updateTitle(); } };
TZ.updateTitle = () => {
  const t = S.project.name + (S.project.dirty ? ' – edytowano' : '');
  const pt = $('#projTitle'); if (pt) pt.textContent = t;
  const pn = $('#projTabName'); if (pn) pn.textContent = S.project.name;
  document.title = t + ' – TopaZ Editing Pro 26';
  if (N) N.setTitle(document.title);
};

/* ---------- media ---------- */
const VIDEO_EXT = ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'ogv', 'avi'];
const AUDIO_EXT = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac', 'weba'];
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'];
TZ.mediaTypeOf = (name, mime) => {
  const e = extOf(name);
  if (VIDEO_EXT.includes(e)) return 'video';
  if (AUDIO_EXT.includes(e)) return 'audio';
  if (IMAGE_EXT.includes(e)) return 'image';
  if (mime) { if (mime.startsWith('video')) return 'video'; if (mime.startsWith('audio')) return 'audio'; if (mime.startsWith('image')) return 'image'; }
  return null;
};
let _actx = null;
TZ.audioCtx = () => { if (!_actx) _actx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' }); return _actx; };

function waitEvent(el, ok, bad = 'error', ms = 20000) {
  return new Promise((res, rej) => {
    const t = setTimeout(() => { cleanup(); rej(new Error('timeout')); }, ms);
    const a = () => { cleanup(); res(); }, b = () => { cleanup(); rej(new Error('media error')); };
    const cleanup = () => { clearTimeout(t); el.removeEventListener(ok, a); el.removeEventListener(bad, b); };
    el.addEventListener(ok, a); el.addEventListener(bad, b);
  });
}
TZ.waitEvent = waitEvent;

async function probeMedia(m) {
  if (m.type === 'image') {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = m.url;
    await img.decode();
    m.img = img; m.width = img.naturalWidth || 1920; m.height = img.naturalHeight || 1080; m.duration = 5; m.hasAudio = false;
    const c = document.createElement('canvas'); const r = Math.min(320 / m.width, 180 / m.height);
    c.width = Math.max(1, Math.round(m.width * r)); c.height = Math.max(1, Math.round(m.height * r));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    m.thumb = c.toDataURL('image/jpeg', 0.8); m.strip = [{ t: 0, c }];
  } else if (m.type === 'audio') {
    const a = new Audio(); a.preload = 'metadata'; a.src = m.url;
    await waitEvent(a, 'loadedmetadata');
    m.duration = isFinite(a.duration) ? a.duration : 0; m.hasAudio = true; m.width = 0; m.height = 0;
    a.removeAttribute('src'); a.load();
  } else {
    const v = document.createElement('video'); v.preload = 'auto'; v.muted = true; v.crossOrigin = 'anonymous'; v.src = m.url;
    await waitEvent(v, 'loadedmetadata');
    m.duration = isFinite(v.duration) ? v.duration : 0; m.width = v.videoWidth; m.height = v.videoHeight;
    if (v.audioTracks) m.hasAudio = v.audioTracks.length > 0; else m.hasAudio = null;
    if (!m.width) { m.type = 'audio'; m.hasAudio = true; }
    m._probe = v;
  }
}

async function makeThumbs(m) {
  if (m.type !== 'video' || !m._probe) return;
  const v = m._probe;
  try {
    const ar = m.width / m.height || 16 / 9, th = 72, tw = Math.round(th * ar);
    const n = clamp(Math.ceil(m.duration / 2), 1, 60);
    const grab = async (t) => {
      v.currentTime = Math.min(Math.max(0, t), Math.max(0, m.duration - 0.05));
      await waitEvent(v, 'seeked', 'error', 8000);
      const c = document.createElement('canvas'); c.width = tw; c.height = th;
      c.getContext('2d').drawImage(v, 0, 0, tw, th);
      return c;
    };
    const first = await grab(Math.min(m.duration * 0.1, 1));
    const big = document.createElement('canvas'); big.width = 320; big.height = Math.round(320 / ar);
    big.getContext('2d').drawImage(v, 0, 0, big.width, big.height);
    m.thumb = big.toDataURL('image/jpeg', 0.8);
    TZ.emit('mediaThumb', m);
    m.strip = [];
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) * m.duration / n;
      m.strip.push({ t, c: await grab(t) });
      if (i % 6 === 5) TZ.emit('strip', m);
    }
    void first;
    TZ.emit('strip', m);
  } catch (e) { console.warn('thumbs', e); }
  finally { v.removeAttribute('src'); v.load(); m._probe = null; }
}

async function makePeaks(m) {
  if (m.type === 'image' || m.hasAudio === false) return;
  try {
    const r = await fetch(m.url);
    const len = +r.headers.get('content-length') || 0;
    if (len > 900 * 1024 * 1024) { if (m.hasAudio == null) m.hasAudio = true; return; }
    const buf = await r.arrayBuffer();
    const ab = await TZ.audioCtx().decodeAudioData(buf);
    const pps = 100, ch = ab.numberOfChannels, n = Math.ceil(ab.duration * pps);
    const peaks = new Float32Array(n);
    const spp = ab.sampleRate / pps;
    for (let c = 0; c < ch; c++) {
      const d = ab.getChannelData(c);
      for (let i = 0; i < n; i++) {
        let mx = 0; const s = Math.floor(i * spp), e = Math.min(d.length, Math.floor((i + 1) * spp));
        for (let j = s; j < e; j += 4) { const v = d[j] < 0 ? -d[j] : d[j]; if (v > mx) mx = v; }
        if (mx > peaks[i]) peaks[i] = mx;
      }
    }
    m.peaks = peaks; m.pps = pps; m.hasAudio = true;
    if (!m.duration) m.duration = ab.duration;
  } catch (e) {
    if (m.type === 'video' && m.hasAudio == null) m.hasAudio = false;
  }
  TZ.emit('peaks', m);
}

TZ.addMedia = async (src) => {
  // src: {path} or {file}
  const name = src.name || (src.path ? basename(src.path) : src.file.name);
  const type = TZ.mediaTypeOf(name, src.file && src.file.type);
  if (!type) { TZ.toast('Nieobsługiwany format: ' + name); return null; }
  if (src.path) { const ex = S.media.find(x => x.path === src.path); if (ex) return ex; }
  const m = {
    id: src.id || uid('m'), name, path: src.path || null, type, duration: 0, width: 0, height: 0, hasAudio: null,
    url: src.path ? (N ? N.mediaURL(src.path) : src.path) : URL.createObjectURL(src.file),
    loading: true, missing: false, label: null, imported: Date.now()
  };
  S.media.push(m);
  TZ.emit('media');
  try {
    if (src.path && N && !(await N.exists(src.path))) throw new Error('missing');
    await probeMedia(m);
    m.loading = false;
    TZ.emit('media');
    makeThumbs(m).then(() => TZ.emit('mediaThumb', m));
    makePeaks(m);
  } catch (e) {
    console.warn('probe failed', name, e);
    m.loading = false; m.missing = true;
    if (e.message !== 'missing') {
      S.media.splice(S.media.indexOf(m), 1);
      TZ.toast('Nie można odczytać pliku: ' + name + ' (nieobsługiwany kodek)', 4000);
      TZ.emit('media');
      return null;
    }
    TZ.emit('media');
  }
  return m;
};
TZ.importPaths = async (paths) => {
  const out = [];
  TZ.status('Importowanie ' + paths.length + ' plików…');
  for (const p of paths) { const m = await TZ.addMedia({ path: p }); if (m) out.push(m); }
  TZ.status('Zaimportowano ' + out.length + ' plików');
  if (out.length) TZ.markDirty();
  return out;
};
TZ.importFiles = async (files) => {
  const out = [];
  for (const f of files) {
    const p = N ? N.pathForFile(f) : null;
    const m = p ? await TZ.addMedia({ path: p }) : await TZ.addMedia({ file: f });
    if (m) out.push(m);
  }
  if (out.length) { TZ.markDirty(); TZ.status('Zaimportowano ' + out.length + ' plików'); }
  return out;
};
TZ.importDialog = async () => {
  if (N) { const p = await N.openMedia(); if (p.length) return TZ.importPaths(p); return []; }
  return new Promise(res => {
    const i = h('input', { type: 'file', multiple: true, accept: 'video/*,audio/*,image/*' });
    i.onchange = async () => res(await TZ.importFiles([...i.files]));
    i.click();
  });
};
TZ.importFolder = async () => { if (!N) return TZ.importDialog(); const p = await N.openFolder(); return p.length ? TZ.importPaths(p) : []; };
TZ.removeMedia = (ids) => {
  const used = S.seq.clips.filter(c => ids.includes(c.mediaId));
  S.seq.clips = S.seq.clips.filter(c => !ids.includes(c.mediaId));
  S.media = S.media.filter(m => !ids.includes(m.id));
  ids.forEach(i => S.selMedia.delete(i));
  if (used.length) TZ.commit('Usuń multimedia');
  TZ.markDirty();
  TZ.emit('media'); TZ.emit('seq');
};

/* ---------- clips ---------- */
TZ.makeClip = (o) => {
  const seq = S.seq;
  const c = Object.assign({
    id: uid('c'), mediaId: null, type: 'video', track: 'V1', start: 0, in: 0, dur: 5, speed: 1, name: 'Klip', label: null,
    enabled: true, props: TZ.defaultProps(seq), kf: {}, lumetri: TZ.defaultLumetri(), effects: [], transIn: null, transOut: null, linkId: null, reverse: false
  }, o);
  if (!c.label) c.label = TZ.CLIP_COLORS[c.type] || '#5d61c9';
  return c;
};
TZ.mediaSourceDuration = (c) => { const m = TZ.mediaById(c.mediaId); return m && (m.type === 'video' || m.type === 'audio') ? m.duration : Infinity; };

/* keyframes */
TZ.propAt = (c, k, lt) => {
  const kf = c.kf && c.kf[k];
  if (!kf || !kf.length) return c.props[k];
  return TZ.kfEval(kf, lt, c.props[k]);
};
TZ.setProp = (c, k, v, lt) => {
  if (c.kf && c.kf[k] && c.kf[k].length) {
    const kf = c.kf[k], fr = 0.5 / S.seq.fps;
    let e = kf.find(x => Math.abs(x.t - lt) < fr);
    if (e) e.v = v; else { kf.push({ t: lt, v }); kf.sort((a, b) => a.t - b.t); }
  } else c.props[k] = v;
};
TZ.toggleKeyframing = (c, k, lt) => {
  c.kf = c.kf || {};
  if (c.kf[k] && c.kf[k].length) { c.props[k] = TZ.propAt(c, k, lt); delete c.kf[k]; }
  else c.kf[k] = [{ t: lt, v: c.props[k] }];
};

/* ---------- project save / load ---------- */
TZ.serialize = () => JSON.stringify({
  app: 'TopaZ Editing Pro', version: 26, name: S.project.name, saved: new Date().toISOString(),
  media: S.media.filter(m => m.path).map(m => ({ id: m.id, name: m.name, path: m.path, type: m.type, duration: m.duration, width: m.width, height: m.height, hasAudio: m.hasAudio })),
  seq: S.seq, view: { zoom: S.zoom, playhead: S.playhead }
}, null, 1);

TZ.addRecent = (name, path) => {
  try {
    let r = JSON.parse(localStorage.getItem('tz.recent') || '[]').filter(x => x.path !== path);
    r.unshift({ name, path, time: Date.now() }); r = r.slice(0, 12);
    localStorage.setItem('tz.recent', JSON.stringify(r));
  } catch (e) {}
};
TZ.getRecent = () => { try { return JSON.parse(localStorage.getItem('tz.recent') || '[]'); } catch (e) { return []; } };

TZ.saveProject = async (as) => {
  let p = S.project.path;
  if (!N) {
    const blob = new Blob([TZ.serialize()], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: S.project.name + '.tzproj' }); a.click();
    S.project.dirty = false; TZ.updateTitle(); return true;
  }
  if (!p || as) {
    p = await N.saveDialog({ title: 'Zapisz projekt', defaultPath: S.project.name + '.tzproj', filters: [{ name: 'Projekt TopaZ', extensions: ['tzproj'] }] });
    if (!p) return false;
    S.project.path = p; S.project.name = basename(p).replace(/\.tzproj$/i, '');
  }
  await N.writeText(p, TZ.serialize());
  S.project.dirty = false; TZ.updateTitle(); TZ.addRecent(S.project.name, p);
  TZ.status('Zapisano projekt: ' + p); TZ.toast('Projekt zapisany');
  return true;
};
TZ.askSaveChanges = async () => {
  if (!S.project.dirty || (!S.seq.clips.length && !S.media.length)) return true;
  const r = await TZ.modal({ title: 'Niezapisane zmiany', body: 'Czy zapisać zmiany w projekcie „' + S.project.name + '”?', buttons: [{ label: 'Anuluj', value: 'cancel' }, { label: 'Nie zapisuj', value: 'no' }, { label: 'Zapisz', value: 'yes', primary: true }] });
  if (r === 'yes') return await TZ.saveProject();
  return r === 'no';
};
TZ.clearProject = () => {
  TZ.engine && TZ.engine.stop();
  S.media.forEach(m => { if (m.url && m.url.startsWith('blob:')) URL.revokeObjectURL(m.url); });
  S.media = []; S.seq = newSequence(); S.selection.clear(); S.selMedia.clear(); S.playhead = 0; S.scrollX = 0;
  S.project = { name: 'Bez tytułu', path: null, dirty: false };
  TZ.engine && TZ.engine.resetPool();
};
TZ.newProject = async () => {
  if (!(await TZ.askSaveChanges())) return;
  TZ.clearProject(); TZ.resetHistory(); TZ.updateTitle();
  TZ.emit('media'); TZ.emit('seq'); TZ.emit('sel'); TZ.emit('time');
};
TZ.openProject = async (path) => {
  if (!N) {
    const i = h('input', { type: 'file', accept: '.tzproj,application/json' });
    i.onchange = async () => { const txt = await i.files[0].text(); await TZ.loadProjectData(JSON.parse(txt), null, i.files[0].name); };
    i.click(); return;
  }
  if (!(await TZ.askSaveChanges())) return;
  if (!path) path = await N.openProject();
  if (!path) return;
  try {
    const data = JSON.parse(await N.readText(path));
    await TZ.loadProjectData(data, path);
  } catch (e) { TZ.alert('Nie można otworzyć projektu:\n' + e.message); }
};
TZ.loadProjectData = async (data, path, fname) => {
  if (!data || !data.seq) throw new Error('Nieprawidłowy plik projektu');
  TZ.clearProject();
  S.project.path = path || null;
  S.project.name = data.name || (path ? basename(path).replace(/\.tzproj$/i, '') : (fname || 'Projekt'));
  S.seq = Object.assign(newSequence(), data.seq);
  if (data.view) { S.zoom = data.view.zoom || S.zoom; S.playhead = data.view.playhead || 0; }
  TZ.updateTitle(); TZ.emit('seq');
  const missing = [];
  for (const md of data.media || []) {
    const m = await TZ.addMedia({ path: md.path, id: md.id, name: md.name });
    if (!m) { missing.push(md.name); continue; }
    if (m.missing) { m.duration = md.duration; m.width = md.width; m.height = md.height; m.type = md.type; missing.push(md.name); }
  }
  S.project.dirty = false;
  if (path) TZ.addRecent(S.project.name, path);
  TZ.resetHistory('Otwórz projekt');
  TZ.updateTitle();
  TZ.emit('media'); TZ.emit('seq'); TZ.emit('sel'); TZ.emit('time');
  if (missing.length) TZ.alert('Nie znaleziono ' + missing.length + ' plików multimedialnych:\n\n' + missing.slice(0, 12).join('\n') + (missing.length > 12 ? '\n…' : '') + '\n\nKliknij prawym przyciskiem element w panelu Projekt i wybierz „Połącz multimedia…”.', 'Brakujące multimedia');
  TZ.status('Otwarto projekt ' + S.project.name);
};
TZ.relinkMedia = async (m) => {
  if (!N) return;
  const p = await N.openMedia(); if (!p || !p[0]) return;
  m.path = p[0]; m.url = N.mediaURL(p[0]); m.missing = false; m.loading = true; m.name = basename(p[0]);
  TZ.emit('media');
  try { await probeMedia(m); m.loading = false; makeThumbs(m).then(() => TZ.emit('mediaThumb', m)); makePeaks(m); TZ.engine.resetPool(); }
  catch (e) { m.missing = true; m.loading = false; TZ.toast('Nie można odczytać pliku'); }
  TZ.markDirty(); TZ.emit('media'); TZ.emit('seq');
};
