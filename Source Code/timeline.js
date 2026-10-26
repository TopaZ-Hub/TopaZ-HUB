'use strict';
/* ==========================================================
   Timeline: drawing, interaction, editing operations
   ========================================================== */
(() => {
const S = TZ.state, R = TZ.render;
const TL = TZ.tl = {};
const cv = TZ.$('#tlCanvas'), cx = cv.getContext('2d');
const rc = TZ.$('#tlRuler'), rx = rc.getContext('2d');
const wrap = TZ.$('#tlCanvasWrap'), headers = TZ.$('#tlHeaders');
const SEP = 6, HEADER_W = 190;
let W = 100, Hh = 100, dpr = 1;
let drag = null, hover = null, dropGhost = null, snapLine = null, marquee = null;
S.selTrans = null; S.gap = null;

/* ---------- geometry ---------- */
const xOf = t => t * S.zoom - S.scrollX;
const tOf = x => (x + S.scrollX) / S.zoom;
function layoutTracks() {
  const out = []; let y = 0, prevKind = null;
  for (const tr of S.seq.tracks) {
    if (prevKind === 'v' && tr.kind === 'a') y += SEP;
    out.push({ tr, y: y - S.scrollY, h: tr.h || 44 });
    y += tr.h || 44; prevKind = tr.kind;
  }
  TL.totalH = y;
  return out;
}
TL.layout = layoutTracks;
const trackAtY = (y) => { const L = layoutTracks(); return L.find(l => y >= l.y && y < l.y + l.h) || null; };
const trackRow = (id) => layoutTracks().find(l => l.tr.id === id);
const clipsOn = (id) => S.seq.clips.filter(c => c.track === id).sort((a, b) => a.start - b.start);
TL.clipsOn = clipsOn;
const fr = () => 1 / S.seq.fps;
const viewEnd = () => Math.max(TZ.seqDuration() + 30, tOf(W) + 5);

/* ---------- drawing ---------- */
let drawReq = 0;
TL.requestDraw = (full) => { if (full !== false && !S.playing) staticDirty = true; if (!drawReq) drawReq = requestAnimationFrame(() => { drawReq = 0; draw(); }); };
function resize() {
  const r = wrap.getBoundingClientRect(); dpr = window.devicePixelRatio || 1;
  W = Math.max(10, r.width); Hh = Math.max(10, r.height);
  cv.width = Math.round(W * dpr); cv.height = Math.round(Hh * dpr); cv.style.width = W + 'px'; cv.style.height = Hh + 'px';
  const rr = rc.getBoundingClientRect();
  rc.width = Math.round(rr.width * dpr); rc.height = Math.round(rr.height * dpr);
  draw(); buildHeaders();
}
new ResizeObserver(resize).observe(wrap);

function niceStep(pxPerSec) {
  const steps = [1 / S.seq.fps, 2 / S.seq.fps, 5 / S.seq.fps, 10 / S.seq.fps, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
  for (const s of steps) if (s * pxPerSec >= 90) return s;
  return 3600;
}
function drawRuler() {
  const w = rc.width / dpr, hh = rc.height / dpr;
  rx.setTransform(dpr, 0, 0, dpr, 0, 0);
  rx.fillStyle = '#1e1e1e'; rx.fillRect(0, 0, w, hh);
  const step = niceStep(S.zoom), sub = step / (step >= 1 ? 5 : 4);
  const t0 = Math.max(0, Math.floor(tOf(0) / step) * step);
  rx.font = '10px Segoe UI'; rx.textBaseline = 'top';
  // in/out
  if (S.seq.inPoint != null || S.seq.outPoint != null) {
    const a = xOf(S.seq.inPoint || 0), b = xOf(S.seq.outPoint != null ? S.seq.outPoint : TZ.seqDuration());
    rx.fillStyle = 'rgba(160,160,160,.28)'; rx.fillRect(a, hh - 14, b - a, 8);
  }
  // work area bar (yellow like Premiere)
  const de = xOf(TZ.seqDuration());
  rx.fillStyle = '#c9b52a'; rx.fillRect(xOf(0), hh - 4, Math.max(0, de - xOf(0)), 2);
  for (let t = t0; xOf(t) < w; t += sub) {
    const x = Math.round(xOf(t)) + 0.5;
    const major = Math.abs(t / step - Math.round(t / step)) < 1e-6;
    rx.fillStyle = major ? '#8a8a8a' : '#4d4d4d';
    rx.fillRect(x, major ? hh - 22 : hh - 12, 1, major ? 18 : 8);
    if (major) { rx.fillStyle = '#9d9d9d'; rx.fillText(TZ.fmtTC(t, S.seq.fps), x + 3, hh - 34 + 4); }
  }
  // markers
  for (const m of S.seq.markers) {
    const x = xOf(m.t); if (x < -10 || x > w + 10) continue;
    rx.fillStyle = m.color || '#2fb36c';
    rx.beginPath(); rx.moveTo(x - 5, hh - 30); rx.lineTo(x + 5, hh - 30); rx.lineTo(x + 5, hh - 22); rx.lineTo(x, hh - 17); rx.lineTo(x - 5, hh - 22); rx.fill();
  }
  // playhead head
  const px = xOf(S.playhead);
  rx.fillStyle = '#4aa3ff';
  rx.beginPath(); rx.moveTo(px - 6, hh - 16); rx.lineTo(px + 6, hh - 16); rx.lineTo(px + 6, hh - 8); rx.lineTo(px, hh - 2); rx.lineTo(px - 6, hh - 8); rx.fill();
  rx.fillRect(px - 0.5, hh - 4, 1, 4);
}

function clipColor(c, sel) {
  const base = c.label || TZ.CLIP_COLORS[c.type];
  return sel ? lighten(base, 0.25) : base;
}
function lighten(hex, a) { const [r, g, b] = R.hex2rgb(hex); const f = v => Math.round((v + (1 - v) * a) * 255); return `rgb(${f(r)},${f(g)},${f(b)})`; }
function darken(hex, a) { const [r, g, b] = R.hex2rgb(hex); const f = v => Math.round(v * (1 - a) * 255); return `rgb(${f(r)},${f(g)},${f(b)})`; }

function drawClip(c, row) {
  const x0 = xOf(c.start), x1 = xOf(c.start + c.dur);
  if (x1 < -2 || x0 > W + 2) return;
  const y = row.y + 1, hh = row.h - 2;
  const sel = S.selection.has(c.id);
  const w = Math.max(1, x1 - x0);
  const base = c.label || TZ.CLIP_COLORS[c.type];
  cx.save();
  cx.beginPath(); cx.rect(Math.max(-2, x0), y, Math.min(W + 4, x1) - Math.max(-2, x0), hh); cx.clip();
  // body
  cx.fillStyle = darken(base, 0.45); cx.fillRect(x0, y, w, hh);
  const m = TZ.mediaById(c.mediaId);
  const headH = Math.min(15, hh * 0.35);
  if (c.type === 'video' && m && m.strip && m.strip.length && hh > 24) {
    const fh = hh - headH, fw = fh * (m.width / m.height || 16 / 9);
    const startX = Math.max(x0, -fw), endX = Math.min(x1, W);
    let i0 = Math.floor((startX - x0) / fw);
    for (let i = i0; x0 + i * fw < endX; i++) {
      const fx = x0 + i * fw;
      const st = c.in + ((fx - x0 + fw / 2) / S.zoom) * c.speed;
      let best = m.strip[0]; let bd = 1e9;
      for (const s of m.strip) { const d = Math.abs(s.t - st); if (d < bd) { bd = d; best = s; } }
      cx.drawImage(best.c, fx, y + headH, fw, fh);
    }
    cx.fillStyle = 'rgba(0,0,0,.18)'; cx.fillRect(x0, y + headH, w, hh - headH);
  } else if (c.type === 'image' && m && m.strip && m.strip[0] && hh > 24) {
    const fh = hh - headH, fw = fh * (m.width / m.height || 16 / 9);
    for (let fx = x0; fx < Math.min(x1, W); fx += fw) if (fx + fw > 0) cx.drawImage(m.strip[0].c, fx, y + headH, fw, fh);
    cx.fillStyle = 'rgba(0,0,0,.15)'; cx.fillRect(x0, y + headH, w, hh - headH);
  } else if (c.type === 'audio') {
    cx.fillStyle = darken(base, 0.15); cx.fillRect(x0, y, w, hh);
    const mid = y + headH + (hh - headH) / 2, amp = (hh - headH) / 2 - 2;
    if (m && m.peaks) {
      cx.fillStyle = lighten(base, 0.45);
      const vol = TZ.dbToGain(c.props.volume || 0);
      const a0 = Math.max(0, Math.floor(-x0)), a1 = Math.min(w, W - x0);
      for (let px = a0; px < a1; px++) {
        const s0 = c.in + (px / S.zoom) * c.speed, s1 = c.in + ((px + 1) / S.zoom) * c.speed;
        let i0 = Math.floor(s0 * m.pps), i1 = Math.max(i0 + 1, Math.ceil(s1 * m.pps)), mx = 0;
        for (let i = i0; i < i1 && i < m.peaks.length; i++) if (m.peaks[i] > mx) mx = m.peaks[i];
        const a = Math.min(1, mx * vol) * amp;
        cx.fillRect(x0 + px, mid - a, 1, a * 2 + 0.5);
      }
    } else { cx.fillStyle = lighten(base, 0.3); cx.fillRect(x0, mid, w, 1); }
  } else if (c.type === 'text') {
    cx.fillStyle = darken(base, 0.1); cx.fillRect(x0, y, w, hh);
  } else if (c.type === 'color' || c.type === 'adjust') {
    cx.fillStyle = darken(base, 0.1); cx.fillRect(x0, y, w, hh);
    if (c.type === 'color') { cx.fillStyle = c.color || '#000'; cx.fillRect(x0 + 2, y + headH + 3, Math.min(30, w - 4), hh - headH - 6); }
  }
  // header bar
  cx.fillStyle = sel ? lighten(base, 0.2) : base;
  cx.fillRect(x0, y, w, headH);
  // fx badge
  let tx = x0 + 4;
  const hasFx = (c.effects && c.effects.length) || (c.lumetri && !TZ.lumetriIsDefault(c.lumetri));
  if (w > 26) {
    cx.fillStyle = hasFx ? '#e1c541' : 'rgba(255,255,255,.18)';
    cx.fillRect(x0 + 3, y + 2, 15, headH - 4);
    cx.fillStyle = hasFx ? '#3a2b00' : 'rgba(255,255,255,.55)'; cx.font = 'italic 700 9px Georgia';
    cx.fillText('fx', x0 + 5, y + headH / 2 + 3); tx = x0 + 22;
  }
  if (w > 40) {
    cx.fillStyle = sel ? '#111' : '#f2f2f2'; cx.font = '11px Segoe UI'; cx.textBaseline = 'middle';
    let name = c.name; if (c.speed !== 1) name += ` [${Math.round(c.speed * 100)}%]`;
    if (c.enabled === false) name += ' (wyłączony)';
    cx.fillText(name, Math.max(tx, 4), y + headH / 2 + 0.5);
    cx.textBaseline = 'alphabetic';
  }
  // keyframe line (opacity for visual, volume for audio)
  const kk = c.type === 'audio' ? 'volume' : 'opacity';
  const kf = c.kf && c.kf[kk];
  if ((kf && kf.length) || S.tool === 'pen') {
    const valY = v => c.type === 'audio' ? y + headH + (1 - (TZ.clamp(v, -40, 6) + 40) / 46) * (hh - headH - 4) + 2 : y + headH + (1 - v / 100) * (hh - headH - 4) + 2;
    cx.strokeStyle = '#ffd84a'; cx.lineWidth = 1; cx.beginPath();
    const steps = Math.min(400, Math.ceil(w / 3));
    for (let i = 0; i <= steps; i++) { const lt = i / steps * c.dur; const px = x0 + lt * S.zoom; const py = valY(TZ.propAt(c, kk, lt)); if (i) cx.lineTo(px, py); else cx.moveTo(px, py); }
    cx.stroke();
    if (kf) for (const k of kf) { const px = x0 + k.t * S.zoom, py = valY(k.v); cx.fillStyle = '#ffd84a'; cx.beginPath(); cx.moveTo(px, py - 4); cx.lineTo(px + 4, py); cx.lineTo(px, py + 4); cx.lineTo(px - 4, py); cx.fill(); }
  }
  if (c.enabled === false) { cx.fillStyle = 'rgba(20,20,20,.55)'; cx.fillRect(x0, y, w, hh); }
  cx.restore();
  // border
  cx.strokeStyle = sel ? '#fff' : 'rgba(0,0,0,.55)'; cx.lineWidth = sel ? 1.5 : 1;
  cx.strokeRect(Math.round(x0) + 0.5, y + 0.5, Math.max(0, Math.round(w) - 1), hh - 1);
  // transitions
  const clips = clipsOn(c.track);
  const drawTr = (tr, a, b, side) => {
    const ta = a; const sx = xOf(ta), ex = xOf(b);
    const isSel = S.selTrans && S.selTrans.clipId === c.id && S.selTrans.side === side;
    cx.fillStyle = isSel ? 'rgba(120,170,255,.85)' : 'rgba(200,200,220,.55)';
    const th = Math.min(hh - 2, Math.max(14, hh * 0.55));
    cx.fillRect(sx, y + 1, ex - sx, th);
    cx.strokeStyle = 'rgba(30,30,40,.7)'; cx.beginPath(); cx.moveTo(sx, y + 1 + th); cx.lineTo(ex, y + 1); cx.stroke();
    cx.strokeRect(sx + 0.5, y + 1.5, ex - sx - 1, th - 1);
    if (ex - sx > 50) { cx.fillStyle = '#111'; cx.font = '10px Segoe UI'; const d = TZ.trDef(tr.type); cx.fillText(d ? d.name : tr.type, sx + 4, y + 12); }
  };
  if (c.transIn) {
    const prev = clips.find(x => x !== c && Math.abs(x.start + x.dur - c.start) < 1e-3);
    if (prev) drawTr(c.transIn, c.start - c.transIn.dur / 2, c.start + c.transIn.dur / 2, 'in');
    else drawTr(c.transIn, c.start, c.start + c.transIn.dur, 'in');
  }
  if (c.transOut) drawTr(c.transOut, c.start + c.dur - c.transOut.dur, c.start + c.dur, 'out');
}

const cache = document.createElement('canvas'); const cacheX = cache.getContext('2d');
let cacheKey = '', staticDirty = true;
TL.dirty = () => { staticDirty = true; };
function draw() {
  cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const key = S.scrollX + '|' + S.scrollY + '|' + S.zoom + '|' + W + '|' + Hh + '|' + dpr;
  if (S.playing && !staticDirty && key === cacheKey && !drag) {
    cx.setTransform(1, 0, 0, 1, 0, 0); cx.drawImage(cache, 0, 0); cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const px = Math.round(xOf(S.playhead)); cx.fillStyle = '#4aa3ff'; cx.fillRect(px, 0, 1, Hh);
    drawRuler(); updateScrollbar(); return;
  }
  cx.fillStyle = '#191919'; cx.fillRect(0, 0, W, Hh);
  const rows = layoutTracks();
  for (const r of rows) {
    cx.fillStyle = r.tr.kind === 'v' ? '#1f1f1f' : '#1c1c1c';
    cx.fillRect(0, r.y, W, r.h);
    cx.fillStyle = '#141414'; cx.fillRect(0, r.y + r.h - 1, W, 1);
    if (r.tr.locked) { cx.fillStyle = 'rgba(255,255,255,.025)'; for (let x = -r.h; x < W; x += 10) { cx.fillRect(x, r.y, 1, r.h); } }
  }
  // separator
  const fa = rows.find(r => r.tr.kind === 'a');
  if (fa) { cx.fillStyle = '#0d0d0d'; cx.fillRect(0, fa.y - SEP, W, SEP); }
  // in/out shading
  if (S.seq.inPoint != null || S.seq.outPoint != null) {
    const a = xOf(S.seq.inPoint || 0), b = xOf(S.seq.outPoint != null ? S.seq.outPoint : TZ.seqDuration());
    cx.fillStyle = 'rgba(255,255,255,.035)'; cx.fillRect(a, 0, b - a, Hh);
  }
  // gap selection
  if (S.gap) { const r = trackRow(S.gap.track); if (r) { cx.fillStyle = 'rgba(80,150,255,.25)'; cx.fillRect(xOf(S.gap.s), r.y, (S.gap.e - S.gap.s) * S.zoom, r.h); } }
  for (const r of rows) for (const c of S.seq.clips) if (c.track === r.tr.id) drawClip(c, r);
  // drop ghost
  if (dropGhost) {
    for (const g of dropGhost) {
      const r = trackRow(g.track); if (!r) continue;
      cx.fillStyle = 'rgba(80,150,255,.35)'; cx.strokeStyle = '#7fb6ff';
      cx.fillRect(xOf(g.start), r.y + 1, g.dur * S.zoom, r.h - 2); cx.strokeRect(xOf(g.start) + .5, r.y + 1.5, g.dur * S.zoom - 1, r.h - 3);
    }
  }
  if (snapLine != null) { cx.fillStyle = '#fff'; cx.fillRect(Math.round(xOf(snapLine)), 0, 1, Hh); }
  if (marquee) { cx.fillStyle = 'rgba(120,160,255,.12)'; cx.strokeStyle = 'rgba(160,190,255,.8)'; const x = Math.min(marquee.x0, marquee.x1), y = Math.min(marquee.y0, marquee.y1); cx.fillRect(x, y, Math.abs(marquee.x1 - marquee.x0), Math.abs(marquee.y1 - marquee.y0)); cx.strokeRect(x + .5, y + .5, Math.abs(marquee.x1 - marquee.x0), Math.abs(marquee.y1 - marquee.y0)); }
  // markers lines
  for (const m of S.seq.markers) { const x = xOf(m.t); if (x >= 0 && x <= W) { cx.fillStyle = 'rgba(47,179,108,.35)'; cx.fillRect(Math.round(x), 0, 1, Hh); } }
  // razor hover line
  if (hover && S.tool === 'razor' && hover.t != null) { cx.fillStyle = '#ff5050'; cx.fillRect(Math.round(xOf(hover.t)), hover.y0 != null ? hover.y0 : 0, 1, hover.h || Hh); }
  // snapshot static layer (for cheap redraws during playback)
  if (cache.width !== cv.width || cache.height !== cv.height) { cache.width = cv.width; cache.height = cv.height; }
  cacheX.clearRect(0, 0, cache.width, cache.height); cacheX.drawImage(cv, 0, 0);
  cacheKey = key; staticDirty = false;
  // playhead
  const px = Math.round(xOf(S.playhead));
  cx.fillStyle = '#4aa3ff'; cx.fillRect(px, 0, 1, Hh);
  drawRuler();
  updateScrollbar();
}
TL.draw = draw;

/* ---------- headers ---------- */
function buildHeaders() {
  headers.innerHTML = '';
  const rows = layoutTracks();
  const anySolo = TZ.audioTracks().some(t => t.solo);
  for (const r of rows) {
    const tr = r.tr;
    const row = TZ.h('div', { class: 'trk ' + tr.kind, style: { top: r.y + 'px', height: r.h + 'px' } });
    row.append(TZ.h('button', { class: 'tgt' + (tr.target ? ' on' : ''), title: 'Kierowanie ścieżki źródła', onclick: () => { TZ.seqTracksOfKind(tr.kind).forEach(t => t.target = false); tr.target = true; buildHeaders(); } }, tr.kind === 'v' ? 'V' : 'A'));
    row.append(TZ.h('button', { class: 't' + (tr.locked ? ' on-l' : ''), title: 'Zablokuj ścieżkę', onclick: () => { tr.locked = !tr.locked; TZ.commit(tr.locked ? 'Zablokuj ścieżkę' : 'Odblokuj ścieżkę'); buildHeaders(); draw(); } }, TZ.icon(tr.locked ? 'lock' : 'unlock')));
    row.append(TZ.h('div', { class: 'nm', title: tr.name }, tr.id));
    if (tr.kind === 'v') {
      row.append(TZ.h('button', { class: 't' + (tr.hidden ? ' off-e' : ''), title: 'Przełącz wyjście ścieżki', onclick: () => { tr.hidden = !tr.hidden; TZ.commit('Widoczność ścieżki'); buildHeaders(); TZ.engine.requestRender(); } }, TZ.icon(tr.hidden ? 'eyeoff' : 'eye')));
    } else {
      row.append(TZ.h('button', { class: 't' + (tr.muted ? ' on-m' : ''), title: 'Wycisz ścieżkę', onclick: () => { tr.muted = !tr.muted; buildHeaders(); TZ.emit('mixer'); TZ.markDirty(); } }, 'M'));
      row.append(TZ.h('button', { class: 't' + (tr.solo ? ' on-s' : ''), title: 'Solo', onclick: () => { tr.solo = !tr.solo; buildHeaders(); TZ.emit('mixer'); TZ.markDirty(); } }, 'S'));
      if (anySolo && !tr.solo) row.style.opacity = '.6';
    }
    if (r.h >= 40) row.append(TZ.h('span', { class: 'tname' }, tr.name));
    row.addEventListener('contextmenu', e => {
      e.preventDefault();
      TZ.menu(e.clientX, e.clientY, [
        { label: 'Zmień nazwę…', action: async () => { const n = await TZ.prompt('Nazwa ścieżki', tr.name); if (n) { tr.name = n; TZ.commit('Zmień nazwę ścieżki'); buildHeaders(); } } },
        '-',
        { label: 'Dodaj ścieżkę wideo', action: () => TL.addTrack('v') },
        { label: 'Dodaj ścieżkę audio', action: () => TL.addTrack('a') },
        { label: 'Usuń tę ścieżkę', disabled: TZ.seqTracksOfKind(tr.kind).length <= 1, action: () => TL.removeTrack(tr.id) },
        '-',
        { label: 'Zwiększ wysokość', action: () => { tr.h = Math.min(160, (tr.h || 44) + 20); buildHeaders(); draw(); } },
        { label: 'Zmniejsz wysokość', action: () => { tr.h = Math.max(26, (tr.h || 44) - 14); buildHeaders(); draw(); } }
      ]);
    });
    headers.append(row);
    const rz = TZ.h('div', { class: 'trk-resize', style: { top: (r.y + r.h - 3) + 'px' } });
    rz.addEventListener('pointerdown', e => {
      e.preventDefault(); const y0 = e.clientY, h0 = tr.h || 44; rz.setPointerCapture(e.pointerId);
      rz.onpointermove = ev => { tr.h = TZ.clamp(h0 + ev.clientY - y0, 26, 200); buildHeaders(); draw(); };
      rz.onpointerup = () => { rz.onpointermove = null; };
    });
    headers.append(rz);
  }
  const fa = rows.find(r => r.tr.kind === 'a');
  if (fa) headers.append(TZ.h('div', { class: 'tl-sep', style: { top: (fa.y - SEP + 1) + 'px' } }));
}
TL.buildHeaders = buildHeaders;
TZ.seqTracksOfKind = (k) => S.seq.tracks.filter(t => t.kind === k);

TL.addTrack = (kind) => {
  const n = TZ.seqTracksOfKind(kind).length + 1;
  let id = (kind === 'v' ? 'V' : 'A') + n; let i = n; while (TZ.trackById(id)) id = (kind === 'v' ? 'V' : 'A') + (++i);
  const tr = { id, kind, name: (kind === 'v' ? 'Wideo ' : 'Audio ') + i, hidden: false, locked: false, muted: false, solo: false, target: false, volume: 0, h: kind === 'v' ? 46 : 44 };
  if (kind === 'v') S.seq.tracks.unshift(tr); else S.seq.tracks.push(tr);
  TZ.commit('Dodaj ścieżkę'); buildHeaders(); draw(); TZ.emit('mixer');
};
TL.removeTrack = async (id) => {
  const has = S.seq.clips.some(c => c.track === id);
  if (has && !(await TZ.confirm('Ścieżka zawiera klipy. Usunąć ścieżkę razem z klipami?', 'Usuń'))) return;
  S.seq.clips = S.seq.clips.filter(c => c.track !== id);
  S.seq.tracks = S.seq.tracks.filter(t => t.id !== id);
  TZ.commit('Usuń ścieżkę'); TZ.emit('seq');
};

/* ---------- scrollbar ---------- */
const hs = TZ.$('#tlHScroll'), thumb = TZ.$('#tlHThumb');
function updateScrollbar() {
  const total = viewEnd() * S.zoom, sw = hs.clientWidth;
  const tw = Math.max(30, sw * W / total), tl = (S.scrollX / total) * sw;
  thumb.style.width = tw + 'px'; thumb.style.left = TZ.clamp(tl, 0, sw - tw) + 'px';
}
thumb.addEventListener('pointerdown', e => {
  e.preventDefault(); e.stopPropagation();
  const mode = e.target.classList.contains('l') ? 'l' : e.target.classList.contains('r') ? 'r' : 'm';
  const x0 = e.clientX, s0 = S.scrollX, z0 = S.zoom, sw = hs.clientWidth, total0 = viewEnd() * S.zoom;
  const tStart = tOf(0), tEnd = tOf(W);
  thumb.setPointerCapture(e.pointerId);
  thumb.onpointermove = ev => {
    const dx = ev.clientX - x0;
    if (mode === 'm') S.scrollX = Math.max(0, s0 + dx / sw * total0);
    else {
      const totalT = total0 / z0, secPerPx = totalT / sw;
      let a = tStart, b = tEnd;
      if (mode === 'l') a = Math.min(b - 0.2, tStart + dx * secPerPx); else b = Math.max(a + 0.2, tEnd + dx * secPerPx);
      S.zoom = TZ.clamp(W / (b - a), 0.05, 3000); S.scrollX = Math.max(0, a * S.zoom);
    }
    draw();
  };
  thumb.onpointerup = () => { thumb.onpointermove = null; };
});

/* ---------- zoom ---------- */
TL.zoomAround = (factor, t) => {
  if (t == null) t = S.playhead;
  const x = xOf(t);
  S.zoom = TZ.clamp(S.zoom * factor, 0.05, 3000);
  S.scrollX = Math.max(0, t * S.zoom - x);
  draw();
};
TL.zoomFit = () => { const d = Math.max(TZ.seqDuration(), 5); S.zoom = TZ.clamp((W - 40) / d, 0.05, 3000); S.scrollX = 0; draw(); };
TL.ensureVisible = (t) => { const x = xOf(t); if (x > W - 20) { S.scrollX = Math.max(0, t * S.zoom - 40); } else if (x < 0) S.scrollX = Math.max(0, t * S.zoom - W / 3); };

/* ---------- snapping ---------- */
function snapPoints(exclude) {
  const pts = [0, S.playhead];
  for (const c of S.seq.clips) if (!exclude || !exclude.has(c.id)) pts.push(c.start, c.start + c.dur);
  for (const m of S.seq.markers) pts.push(m.t);
  if (S.seq.inPoint != null) pts.push(S.seq.inPoint);
  if (S.seq.outPoint != null) pts.push(S.seq.outPoint);
  return pts;
}
function snapT(t, exclude, force) {
  if (!S.snap && !force) return { t, snapped: null };
  const th = 8 / S.zoom; let best = null, bd = th;
  for (const p of snapPoints(exclude)) { const d = Math.abs(p - t); if (d < bd) { bd = d; best = p; } }
  return best != null ? { t: best, snapped: best } : { t, snapped: null };
}

/* ---------- hit testing ---------- */
function hitAt(x, y) {
  const row = trackAtY(y); if (!row) return null;
  const t = tOf(x);
  const clips = clipsOn(row.tr.id);
  // transitions first
  for (const c of clips) {
    const th = Math.max(14, row.h * 0.55);
    if (y > row.y + 1 + th) break;
    if (c.transIn) {
      const prev = clips.find(p => p !== c && Math.abs(p.start + p.dur - c.start) < 1e-3);
      const a = prev ? c.start - c.transIn.dur / 2 : c.start, b = a + c.transIn.dur;
      if (t >= a && t <= b) return { kind: 'trans', clip: c, side: 'in', row };
    }
    if (c.transOut) { const b = c.start + c.dur, a = b - c.transOut.dur; if (t >= a && t <= b) return { kind: 'trans', clip: c, side: 'out', row }; }
  }
  const edge = Math.min(7, 0);
  void edge;
  for (const c of clips) {
    const x0 = xOf(c.start), x1 = xOf(c.start + c.dur);
    const ez = Math.min(7, (x1 - x0) / 4);
    if (x >= x0 - 1 && x <= x1 + 1) {
      if (x - x0 <= ez) return { kind: 'clip', clip: c, edge: 'l', row, t };
      if (x1 - x <= ez) return { kind: 'clip', clip: c, edge: 'r', row, t };
      return { kind: 'clip', clip: c, edge: null, row, t };
    }
  }
  return { kind: 'empty', row, t };
}

/* ---------- selection helpers ---------- */
const partners = (c) => c.linkId ? S.seq.clips.filter(x => x.linkId === c.linkId && x !== c) : [];
TL.partners = partners;
function selectClip(c, add, single) {
  S.selTrans = null; S.gap = null;
  const withLinked = S.linked && !single;
  if (!add) S.selection.clear();
  if (add && S.selection.has(c.id)) { S.selection.delete(c.id); if (withLinked) partners(c).forEach(p => S.selection.delete(p.id)); }
  else { S.selection.add(c.id); if (withLinked) partners(c).forEach(p => S.selection.add(p.id)); }
  TZ.emit('sel'); draw();
}
TL.selectClip = selectClip;
TL.selectAll = () => { S.selection = new Set(S.seq.clips.map(c => c.id)); TZ.emit('sel'); draw(); };
TL.deselect = () => { S.selection.clear(); S.selTrans = null; S.gap = null; TZ.emit('sel'); draw(); };

/* ---------- core edit ops ---------- */
function cloneClip(c) { const n = JSON.parse(JSON.stringify(c)); n.id = TZ.uid('c'); return n; }
TL.cloneClip = cloneClip;
function splitClip(c, t) {
  if (t <= c.start + fr() / 2 || t >= c.start + c.dur - fr() / 2) return null;
  const b = cloneClip(c);
  const lt = t - c.start;
  b.start = t; b.in = c.in + lt * c.speed; b.dur = c.start + c.dur - t;
  for (const k in b.kf) { b.kf[k] = b.kf[k].map(x => ({ ...x, t: x.t - lt })); }
  b.transIn = null; b.transOut = c.transOut; c.transOut = null;
  c.dur = lt;
  S.seq.clips.push(b);
  return b;
}
TL.splitClip = splitClip;
// remove material in [s,e) on track (overwrite)
function clearRange(trackId, s, e, except) {
  for (const c of [...S.seq.clips]) {
    if (c.track !== trackId || (except && except.has(c.id))) continue;
    const cs = c.start, ce = c.start + c.dur;
    if (ce <= s + 1e-6 || cs >= e - 1e-6) continue;
    if (cs >= s - 1e-6 && ce <= e + 1e-6) { S.seq.clips.splice(S.seq.clips.indexOf(c), 1); continue; }
    if (cs < s && ce > e) { const b = splitClip(c, e); c.dur = s - cs; c.transOut = null; if (b) b.transIn = null; continue; }
    if (cs < s) { c.dur = s - cs; c.transOut = null; continue; }
    if (ce > e) { const d = e - cs; c.in += d * c.speed; c.start = e; c.dur -= d; c.transIn = null; for (const k in c.kf) c.kf[k] = c.kf[k].map(x => ({ ...x, t: x.t - d })); }
  }
}
TL.clearRange = clearRange;
function shiftAfter(t, delta, tracks) {
  for (const c of S.seq.clips) {
    const tr = TZ.trackById(c.track);
    if (tr && tr.locked) continue;
    if (tracks && !tracks.includes(c.track)) continue;
    if (c.start >= t - 1e-6) c.start = Math.max(0, c.start + delta);
  }
  for (const m of S.seq.markers) if (m.t >= t) m.t += delta;
}
TL.shiftAfter = shiftAfter;
const unlocked = id => { const t = TZ.trackById(id); return t && !t.locked; };

TL.splitAtPlayhead = (allTracks) => {
  const t = S.playhead; let n = 0;
  let targets = S.seq.clips.filter(c => t > c.start && t < c.start + c.dur && unlocked(c.track));
  if (!allTracks && S.selection.size) targets = targets.filter(c => S.selection.has(c.id));
  const linkMap = {};
  for (const c of targets) { const b = splitClip(c, t); if (b) { n++; if (c.linkId) { linkMap[c.linkId] = linkMap[c.linkId] || TZ.uid('l'); b.linkId = linkMap[c.linkId]; } } }
  if (n) { TZ.commit('Dodaj edycję'); TZ.emit('seq'); }
};
TL.razorAt = (c, t, all) => {
  const targets = all ? S.seq.clips.filter(x => t > x.start && t < x.start + x.dur && unlocked(x.track)) : [c, ...(S.linked ? partners(c) : [])];
  const linkMap = {}; let n = 0;
  for (const x of targets) { const b = splitClip(x, t); if (b) { n++; if (x.linkId) { linkMap[x.linkId] = linkMap[x.linkId] || TZ.uid('l'); b.linkId = linkMap[x.linkId]; } } }
  if (n) { TZ.commit('Żyletka'); TZ.emit('seq'); }
};
TL.deleteSelection = (ripple) => {
  if (S.selTrans) { const c = TZ.clipById(S.selTrans.clipId); if (c) { if (S.selTrans.side === 'in') c.transIn = null; else c.transOut = null; } S.selTrans = null; TZ.commit('Usuń przejście'); TZ.emit('seq'); return; }
  if (S.gap) { const g = S.gap; S.gap = null; shiftAfter(g.e, -(g.e - g.s)); TZ.commit('Usuń przerwę'); TZ.emit('seq'); return; }
  const sel = TZ.selectedClips().filter(c => unlocked(c.track));
  if (!sel.length) return;
  S.seq.clips = S.seq.clips.filter(c => !sel.includes(c));
  if (ripple) {
    // per track close gaps, from right to left
    const byTrack = {};
    sel.forEach(c => (byTrack[c.track] = byTrack[c.track] || []).push(c));
    const ranges = sel.map(c => [c.start, c.start + c.dur]).sort((a, b) => b[0] - a[0]);
    const merged = [];
    for (const r of ranges.sort((a, b) => a[0] - b[0])) { const l = merged[merged.length - 1]; if (l && r[0] <= l[1] + 1e-6) l[1] = Math.max(l[1], r[1]); else merged.push([...r]); }
    const tracks = Object.keys(byTrack);
    for (const r of merged.reverse()) {
      // only ripple if no other clips occupy the range on affected tracks
      const conflict = S.seq.clips.some(c => tracks.includes(c.track) && c.start < r[1] - 1e-6 && c.start + c.dur > r[0] + 1e-6);
      if (!conflict) shiftAfter(r[1], -(r[1] - r[0]), tracks.concat(S.linked ? [] : []));
    }
  }
  S.selection.clear();
  TZ.commit(ripple ? 'Usuń z przesunięciem' : 'Wyczyść');
  TZ.emit('seq'); TZ.emit('sel');
};
TL.copy = (cut) => {
  const sel = TZ.selectedClips(); if (!sel.length) return;
  const t0 = Math.min(...sel.map(c => c.start));
  S.clipboard = sel.map(c => ({ ...JSON.parse(JSON.stringify(c)), _off: c.start - t0 }));
  TZ.status('Skopiowano ' + sel.length + ' klipów');
  if (cut) TL.deleteSelection(false);
};
TL.paste = (insert) => {
  if (!S.clipboard || !S.clipboard.length) return;
  const t = S.playhead; const linkMap = {};
  const dur = Math.max(...S.clipboard.map(c => c._off + c.dur));
  if (insert) { splitAllAt(t); shiftAfter(t, dur); }
  S.selection.clear();
  for (const src of S.clipboard) {
    const c = JSON.parse(JSON.stringify(src)); delete c._off;
    c.id = TZ.uid('c'); c.start = t + src._off;
    if (c.linkId) { linkMap[c.linkId] = linkMap[c.linkId] || TZ.uid('l'); c.linkId = linkMap[c.linkId]; }
    if (!TZ.trackById(c.track)) c.track = c.type === 'audio' ? 'A1' : 'V1';
    if (!insert) clearRange(c.track, c.start, c.start + c.dur);
    S.seq.clips.push(c); S.selection.add(c.id);
  }
  TZ.engine.seek(t + dur);
  TZ.commit(insert ? 'Wklej i wstaw' : 'Wklej'); TZ.emit('seq'); TZ.emit('sel');
};
TL.pasteAttributes = () => {
  if (!S.clipboard || !S.clipboard.length) return;
  const src = S.clipboard.find(c => c.type !== 'audio') || S.clipboard[0];
  for (const c of TZ.selectedClips()) {
    if (c.type === 'audio' && src.type === 'audio') { c.effects = JSON.parse(JSON.stringify(src.effects)); c.props.volume = src.props.volume; }
    else if (c.type !== 'audio' && src.type !== 'audio') { c.effects = JSON.parse(JSON.stringify(src.effects)); c.lumetri = JSON.parse(JSON.stringify(src.lumetri)); Object.assign(c.props, { scale: src.props.scale, rotation: src.props.rotation, opacity: src.props.opacity, posX: src.props.posX, posY: src.props.posY, blend: src.props.blend }); }
  }
  TZ.commit('Wklej atrybuty'); TZ.emit('seq'); TZ.emit('sel');
};
function splitAllAt(t) {
  const linkMap = {};
  for (const c of S.seq.clips.filter(c => t > c.start + 1e-6 && t < c.start + c.dur - 1e-6 && unlocked(c.track))) {
    const b = splitClip(c, t); if (b && c.linkId) { linkMap[c.linkId] = linkMap[c.linkId] || TZ.uid('l'); b.linkId = linkMap[c.linkId]; }
  }
}
TL.splitAllAt = splitAllAt;
TL.duplicate = () => { TL.copy(); const t = S.playhead; const end = Math.max(...TZ.selectedClips().map(c => c.start + c.dur)); S.playhead = end; TL.paste(false); S.playhead = t; };
TL.toggleEnable = () => { const sel = TZ.selectedClips(); if (!sel.length) return; const v = !sel.every(c => c.enabled !== false); sel.forEach(c => c.enabled = v); TZ.commit(v ? 'Włącz klip' : 'Wyłącz klip'); TZ.emit('seq'); };
TL.link = (on) => {
  const sel = TZ.selectedClips(); if (!sel.length) return;
  if (on) { const id = TZ.uid('l'); sel.forEach(c => c.linkId = id); } else sel.forEach(c => c.linkId = null);
  TZ.commit(on ? 'Połącz' : 'Rozłącz'); draw();
};
TL.nudge = (frames, trackDelta) => {
  const sel = TZ.selectedClips().filter(c => unlocked(c.track)); if (!sel.length) return;
  const d = frames / S.seq.fps; const ids = new Set(sel.map(c => c.id));
  const minStart = Math.min(...sel.map(c => c.start));
  const dd = Math.max(-minStart, d);
  for (const c of sel) c.start += dd;
  for (const c of sel) clearRange(c.track, c.start, c.start + c.dur, ids);
  TZ.commit('Przesuń'); TZ.emit('seq');
  void trackDelta;
};

/* ---------- markers & in/out ---------- */
TL.addMarker = (name) => {
  const t = TZ.snapFrame(S.playhead);
  const ex = S.seq.markers.find(m => Math.abs(m.t - t) < 1e-6);
  if (ex) { TL.editMarker(ex); return; }
  S.seq.markers.push({ id: TZ.uid('mk'), t, name: name || '', color: '#2fb36c' });
  S.seq.markers.sort((a, b) => a.t - b.t);
  TZ.commit('Dodaj znacznik'); draw();
};
TL.editMarker = async (m) => {
  const name = h => h;
  void name;
  const inp = TZ.h('input', { type: 'text', value: m.name || '', style: { width: '100%' } });
  const col = TZ.h('select', null, ...[['#2fb36c', 'Zielony'], ['#d64545', 'Czerwony'], ['#c849c8', 'Fioletowy'], ['#e0a630', 'Pomarańczowy'], ['#e0d630', 'Żółty'], ['#3b82f6', 'Niebieski'], ['#3fc9c9', 'Turkusowy']].map(([v, n]) => TZ.h('option', { value: v, selected: m.color === v }, n)));
  const r = await TZ.modal({ title: 'Znacznik – ' + TZ.fmtTC(m.t, S.seq.fps), body: TZ.h('div', { style: { display: 'grid', gap: '8px', width: '320px' } }, TZ.h('label', null, 'Nazwa'), inp, TZ.h('label', null, 'Kolor'), col), buttons: [{ label: 'Usuń', value: 'del' }, { label: 'Anuluj', value: null }, { label: 'OK', primary: true, value: 'ok' }] });
  if (r === 'del') S.seq.markers = S.seq.markers.filter(x => x !== m);
  else if (r === 'ok') { m.name = inp.value; m.color = col.value; }
  else return;
  TZ.commit('Edytuj znacznik'); draw();
};
TL.gotoMarker = (dir) => {
  const t = S.playhead, ms = S.seq.markers.map(m => m.t);
  const n = dir > 0 ? ms.filter(x => x > t + 1e-6).sort((a, b) => a - b)[0] : ms.filter(x => x < t - 1e-6).sort((a, b) => b - a)[0];
  if (n != null) TZ.engine.seek(n);
};
TL.setIn = (t) => { S.seq.inPoint = t == null ? TZ.snapFrame(S.playhead) : t; if (S.seq.outPoint != null && S.seq.outPoint <= S.seq.inPoint) S.seq.outPoint = null; TZ.markDirty(); TZ.emit('time'); draw(); };
TL.setOut = (t) => { S.seq.outPoint = t == null ? TZ.snapFrame(S.playhead) : t; if (S.seq.inPoint != null && S.seq.inPoint >= S.seq.outPoint) S.seq.inPoint = null; TZ.markDirty(); TZ.emit('time'); draw(); };
TL.clearInOut = () => { S.seq.inPoint = S.seq.outPoint = null; TZ.markDirty(); TZ.emit('time'); draw(); };
TL.markClip = () => { const c = TZ.primaryClip() || S.seq.clips.find(c => S.playhead >= c.start && S.playhead < c.start + c.dur); if (c) { S.seq.inPoint = c.start; S.seq.outPoint = c.start + c.dur; TZ.markDirty(); TZ.emit('time'); draw(); } };
TL.lift = (extract) => {
  const a = S.seq.inPoint, b = S.seq.outPoint;
  if (a == null || b == null) { TZ.toast('Ustaw punkty wejścia i wyjścia (I / O)'); return; }
  for (const tr of S.seq.tracks) if (!tr.locked) clearRange(tr.id, a, b);
  if (extract) shiftAfter(b, -(b - a));
  S.seq.inPoint = S.seq.outPoint = null;
  TZ.commit(extract ? 'Wyodrębnij' : 'Podnieś'); TZ.emit('seq');
};
TL.goToEdit = (dir) => {
  const pts = new Set([0]); for (const c of S.seq.clips) { pts.add(c.start); pts.add(c.start + c.dur); }
  const arr = [...pts].sort((a, b) => a - b), t = S.playhead;
  const n = dir > 0 ? arr.find(x => x > t + 1e-6) : arr.reverse().find(x => x < t - 1e-6);
  if (n != null) { TZ.engine.seek(n); TL.ensureVisible(n); }
};

/* ---------- adding media ---------- */
async function maybeMatchSequence(m) {
  if (S.seq.clips.length || m.type !== 'video' || !m.width) return;
  if (m.width === S.seq.width && m.height === S.seq.height) return;
  const ok = await TZ.modal({ title: 'Ostrzeżenie o niezgodności klipu', body: `Ten klip (${m.width}×${m.height}) nie pasuje do ustawień sekwencji (${S.seq.width}×${S.seq.height}).<br><br>Zmienić ustawienia sekwencji, aby pasowały do klipu?`, buttons: [{ label: 'Zachowaj ustawienia', value: false }, { label: 'Zmień ustawienia sekwencji', value: true, primary: true }] });
  if (ok) { TL.setSequenceSize(m.width, m.height); }
}
TL.setSequenceSize = (w, hh, fps) => {
  const ow = S.seq.width, oh = S.seq.height;
  S.seq.width = w; S.seq.height = hh; if (fps) S.seq.fps = fps;
  for (const c of S.seq.clips) {
    c.props.posX = c.props.posX / ow * w; c.props.posY = c.props.posY / oh * hh;
    for (const k of ['posX', 'posY']) if (c.kf && c.kf[k]) c.kf[k].forEach(x => x.v = x.v / (k === 'posX' ? ow : oh) * (k === 'posX' ? w : hh));
  }
  TZ.engine.layoutProgram();
};
function targetTracks(vHint, aHint) {
  const v = vHint || (TZ.seqTracksOfKind('v').find(t => t.target) || TZ.seqTracksOfKind('v').slice(-1)[0]).id;
  let a = aHint;
  if (!a) {
    const vt = TZ.seqTracksOfKind('v').slice().reverse(); const at = TZ.seqTracksOfKind('a');
    const idx = vt.findIndex(t => t.id === v);
    const tgt = at.find(t => t.target);
    a = (vHint ? (at[idx] || at[at.length - 1]) : (tgt || at[0])).id;
  }
  return { v, a };
}
function clipsForMedia(m, start, inP, outP, vTrack, aTrack) {
  const out = [];
  const dur = m.type === 'image' ? 5 : Math.max(fr(), (outP != null ? outP : m.duration) - (inP || 0));
  const linkId = (m.type === 'video' && m.hasAudio !== false) ? TZ.uid('l') : null;
  if (m.type === 'video' || m.type === 'image') out.push(TZ.makeClip({ mediaId: m.id, type: m.type, track: vTrack, start, in: inP || 0, dur, name: m.name, linkId }));
  if (m.type === 'audio' || (m.type === 'video' && m.hasAudio !== false)) out.push(TZ.makeClip({ mediaId: m.id, type: 'audio', track: aTrack, start, in: inP || 0, dur, name: m.name, linkId }));
  return out;
}
TL.placeMedia = async (medias, t, vTrack, aTrack, mode = 'overwrite') => {
  medias = medias.filter(m => m && !m.loading && !m.missing);
  if (!medias.length) return;
  await maybeMatchSequence(medias[0]);
  const tt = targetTracks(vTrack, aTrack);
  let at = t; const added = [];
  for (const m of medias) {
    const cl = clipsForMedia(m, at, m.srcIn, m.srcOut, tt.v, tt.a);
    const d = cl[0].dur;
    if (mode === 'insert') { splitAllAt(at); shiftAfter(at, d); }
    else for (const c of cl) clearRange(c.track, c.start, c.start + c.dur);
    S.seq.clips.push(...cl); added.push(...cl);
    at += d;
  }
  S.selection = new Set(added.map(c => c.id));
  TZ.commit(mode === 'insert' ? 'Wstaw' : 'Nadpisz');
  TZ.emit('seq'); TZ.emit('sel');
  return at;
};
TL.sourceEdit = (m, mode) => TL.placeMedia([m], S.playhead, null, null, mode).then(end => { if (end != null) TZ.engine.seek(end); });
TL.appendMedia = async (medias) => {
  const end = TZ.seqDuration();
  await TL.placeMedia(medias, end, null, null, 'overwrite');
  TL.zoomFit();
};
TL.addSynthetic = (type, opts = {}) => {
  const vt = TZ.seqTracksOfKind('v');
  let track = opts.track;
  const t = opts.start != null ? opts.start : S.playhead;
  const dur = opts.dur || 5;
  if (!track) {
    // first video track (bottom-up) free at range, starting from V2 for titles
    const order = vt.slice().reverse();
    const pref = type === 'text' || type === 'adjust' ? order.slice(1).concat(order.slice(0, 1)) : order;
    const free = pref.find(tr => !tr.locked && !S.seq.clips.some(c => c.track === tr.id && c.start < t + dur && c.start + c.dur > t));
    if (free) track = free.id; else { TL.addTrack('v'); track = S.seq.tracks[0].id; }
  }
  const names = { text: 'Tekst', color: 'Plansza koloru', adjust: 'Warstwa korekcyjna' };
  const c = TZ.makeClip({ type, track, start: t, dur, name: opts.name || names[type] });
  if (type === 'text') { c.text = Object.assign(TZ.defaultText(), opts.text || {}); c.name = (c.text.content.split('\n')[0] || 'Tekst').slice(0, 30); if (opts.posY) c.props.posY = opts.posY; }
  if (type === 'color') c.color = opts.color || '#000000';
  clearRange(track, t, t + dur);
  S.seq.clips.push(c);
  S.selection = new Set([c.id]);
  TZ.commit('Dodaj: ' + names[type]); TZ.emit('seq'); TZ.emit('sel');
  return c;
};

/* ---------- transitions & effects ---------- */
TL.applyTransition = (c, side, type, dur) => {
  dur = dur || Math.min(1, c.dur / 2);
  const clips = clipsOn(c.track);
  if (side === 'out') {
    const next = clips.find(x => x !== c && Math.abs(c.start + c.dur - x.start) < 1e-3);
    if (next) { next.transIn = { type, dur: Math.min(dur, next.dur, c.dur) }; }
    else c.transOut = { type, dur: Math.min(dur, c.dur) };
  } else c.transIn = { type, dur: Math.min(dur, c.dur) };
  TZ.commit('Przejście: ' + (TZ.trDef(type) || {}).name); TZ.emit('seq');
};
TL.applyDefaultTransition = (audio) => {
  let sel = TZ.selectedClips();
  if (!sel.length) {
    // edit point nearest playhead on target tracks
    const t = S.playhead;
    sel = S.seq.clips.filter(c => Math.abs(c.start - t) < 0.5 || Math.abs(c.start + c.dur - t) < 0.5);
    for (const c of sel) {
      const isA = c.type === 'audio'; if (audio != null && isA !== audio) continue;
      if (Math.abs(c.start - t) < Math.abs(c.start + c.dur - t)) c.transIn = { type: isA ? 'constpower' : 'cross', dur: Math.min(1, c.dur / 2) };
    }
    if (sel.length) { TZ.commit('Domyślne przejście'); TZ.emit('seq'); }
    return;
  }
  for (const c of sel) {
    const isA = c.type === 'audio'; if (audio != null && isA !== audio) continue;
    const type = isA ? 'constpower' : (TZ.settings.defaultTransition || 'cross');
    const d = Math.min(1, c.dur / 2);
    if (!c.transIn) c.transIn = { type, dur: d };
    const next = clipsOn(c.track).find(x => x !== c && Math.abs(c.start + c.dur - x.start) < 1e-3);
    if (next) { if (!next.transIn) next.transIn = { type, dur: Math.min(d, next.dur / 2) }; } else if (!c.transOut) c.transOut = { type, dur: d };
  }
  TZ.commit('Domyślne przejście'); TZ.emit('seq');
};
TL.applyPreset = (c, id) => {
  const def = TZ.presetDef(id); if (!def) return;
  if (c.type === 'audio') { TZ.toast('Ustawienia wstępne działają na klipach wideo'); return; }
  c.kf = c.kf || {};
  def.apply(c);
  TZ.commit('Ustawienie wstępne: ' + def.name);
  S.selection = new Set([c.id]); TZ.emit('seq'); TZ.emit('sel'); TZ.emit('props');
  TZ.ui && TZ.ui.showTab('lefttop', 'ecp');
};
TL.removeLinked = (kind) => {
  const sel = TZ.selectedClips(); const ids = new Set();
  for (const c of sel) { [c, ...partners(c)].forEach(x => { if ((kind === 'audio') === (x.type === 'audio')) ids.add(x.id); }); }
  if (!ids.size) return;
  S.seq.clips = S.seq.clips.filter(c => !ids.has(c.id));
  S.seq.clips.forEach(c => { if (c.linkId && !S.seq.clips.some(o => o !== c && o.linkId === c.linkId)) c.linkId = null; });
  S.selection = new Set([...S.selection].filter(id => !ids.has(id)));
  TZ.commit(kind === 'audio' ? 'Usuń audio' : 'Usuń wideo'); TZ.emit('seq'); TZ.emit('sel');
};
TL.applyEffect = (c, id) => {
  const def = TZ.fxDef(id); if (!def) return false;
  if (!!def.audio !== (c.type === 'audio')) { TZ.toast(def.audio ? 'Efekt audio można zastosować tylko do klipu audio' : 'Efekt wideo można zastosować tylko do klipu wideo'); return false; }
  const p = {}; def.params.forEach(x => p[x.k] = x.def);
  c.effects.push({ uid: TZ.uid('fx'), id, p, enabled: true, kf: {} });
  TZ.commit('Zastosuj efekt: ' + def.name);
  S.selection = new Set([c.id]); TZ.emit('seq'); TZ.emit('sel');
  TZ.ui && TZ.ui.showTab('lefttop', 'ecp');
  return true;
};

/* ---------- speed ---------- */
TL.speedDialog = async () => {
  const sel = TZ.selectedClips().filter(c => c.type === 'video' || c.type === 'audio');
  if (!sel.length) { TZ.toast('Zaznacz klip wideo lub audio'); return; }
  const c0 = sel[0];
  const sp = TZ.h('input', { type: 'number', value: Math.round(c0.speed * 100), min: 5, max: 1000, step: 1, style: { width: '90px' } });
  const ripple = TZ.h('input', { type: 'checkbox', checked: true });
  const r = await TZ.modal({ title: 'Szybkość/czas trwania klipu', body: TZ.h('div', { style: { display: 'grid', gridTemplateColumns: 'auto auto', gap: '10px', alignItems: 'center' } }, 'Szybkość (%)', sp, TZ.h('span', null, 'Edycja z przesunięciem'), ripple), buttons: [{ label: 'Anuluj', value: null }, { label: 'OK', primary: true, value: () => +sp.value }] });
  if (!r) return;
  const ns = TZ.clamp(r / 100, 0.05, 10);
  for (const c of sel) {
    const srcLen = c.dur * c.speed;
    const nd = srcLen / ns, delta = nd - c.dur;
    const end = c.start + c.dur;
    if (ripple.checked && delta !== 0 && !sel.some(o => o !== c && o.track !== c.track && o.linkId === c.linkId && o.start + o.dur > end)) {
      for (const o of S.seq.clips) if (o !== c && o.track === c.track && o.start >= end - 1e-6) o.start += delta;
    }
    const ratio = c.speed / ns;
    c.speed = ns; c.dur = nd;
    for (const k in c.kf) c.kf[k].forEach(x => x.t = x.t * ratio);
  }
  TZ.commit('Szybkość klipu'); TZ.emit('seq');
};

/* ---------- pointer interaction ---------- */
function setCursor(hit) {
  let cur = 'default';
  if (S.tool === 'razor') cur = 'crosshair';
  else if (S.tool === 'hand') cur = drag ? 'grabbing' : 'grab';
  else if (S.tool === 'zoom') cur = 'zoom-in';
  else if (S.tool === 'type') cur = 'text';
  else if (S.tool === 'slip') cur = 'ew-resize';
  else if (S.tool === 'pen') cur = 'copy';
  else if (hit && hit.kind === 'clip' && hit.edge) cur = S.tool === 'ripple' ? 'col-resize' : 'ew-resize';
  cv.style.cursor = cur;
}
function localXY(e) { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

cv.addEventListener('pointermove', e => {
  if (drag) return;
  const [x, y] = localXY(e);
  const hit = hitAt(x, y);
  hover = { t: null };
  if (S.tool === 'razor' && hit && hit.kind === 'clip') {
    let t = tOf(x); if (S.snap) t = snapT(t, new Set([hit.clip.id])).t;
    hover = { t, y0: hit.row.y, h: hit.row.h };
    TL.requestDraw();
  } else if (S.tool === 'razor') TL.requestDraw();
  setCursor(hit);
});
cv.addEventListener('pointerleave', () => { if (hover) { hover = null; TL.requestDraw(); } });

cv.addEventListener('pointerdown', e => {
  TZ.ui && TZ.ui.focusPanel('timeline');
  const [x, y] = localXY(e);
  if (e.button === 1 || (e.button === 0 && S.tool === 'hand')) { startPan(e); return; }
  if (e.button === 2) return;
  const hit = hitAt(x, y);
  if (!hit) { if (!e.shiftKey) TL.deselect(); return; }
  const tool = S.tool;
  if (tool === 'zoom') { TL.zoomAround(e.altKey ? 0.5 : 2, tOf(x)); return; }
  if (tool === 'type') {
    const tr = hit.row.tr.kind === 'v' ? hit.row.tr.id : null;
    const c = TL.addSynthetic('text', { track: tr && !hit.row.tr.locked ? tr : null, start: TZ.snapFrame(tOf(x)) });
    TZ.ui && TZ.ui.showTab('right', 'graphics'); void c;
    TZ.setTool('select'); return;
  }
  if (hit.kind === 'trans') { S.selTrans = { clipId: hit.clip.id, side: hit.side }; S.selection.clear(); S.gap = null; TZ.emit('sel'); draw(); startTransDrag(e, hit); return; }
  if (hit.kind === 'empty') {
    if (!e.shiftKey && !e.ctrlKey) { S.selection.clear(); S.selTrans = null; }
    // gap select
    const clips = clipsOn(hit.row.tr.id); const t = hit.t;
    const prev = clips.filter(c => c.start + c.dur <= t).pop(), next = clips.find(c => c.start >= t);
    S.gap = null;
    if (next && tool === 'select') S.gap = { track: hit.row.tr.id, s: prev ? prev.start + prev.dur : 0, e: next.start };
    TZ.emit('sel'); draw();
    if (tool === 'track') { selectForward(hit.t, e.shiftKey ? null : hit.row.tr.id); return; }
    startMarquee(e, x, y); return;
  }
  const c = hit.clip;
  const locked = TZ.trackById(c.track).locked;
  if (tool === 'razor') { if (locked) return; let t = tOf(x); if (S.snap) t = snapT(t, new Set([c.id])).t; TL.razorAt(c, TZ.snapFrame(t), e.shiftKey); return; }
  if (tool === 'track') { selectForward(c.start, e.shiftKey ? null : c.track); return; }
  if (tool === 'pen') { penAdd(c, hit, x, y, e.altKey); return; }
  // Shift = dodaj/usuń z zaznaczenia, Ctrl/Alt = zaznacz TYLKO ten klip (bez połączonego audio/wideo)
  const single = e.ctrlKey || e.altKey;
  if (e.shiftKey) selectClip(c, true, single);
  else if (single) { if (!(S.selection.size === 1 && S.selection.has(c.id))) selectClip(c, false, true); }
  else if (!S.selection.has(c.id)) selectClip(c, false);
  else { S.selTrans = null; S.gap = null; }
  if (single && !e.shiftKey) TZ.status('Zaznaczono tylko: ' + c.name + (c.type === 'audio' ? ' (audio)' : ' (wideo)') + ' – Delete usunie tylko ten element');
  if (locked) return;
  if (tool === 'slip' && (c.type === 'video' || c.type === 'audio')) { startSlip(e, c, x); return; }
  if (hit.edge) startTrim(e, c, hit.edge, x, tool === 'ripple' || e.ctrlKey);
  else startMove(e, x, y, e.altKey);
});

cv.addEventListener('dblclick', e => {
  const [x, y] = localXY(e); const hit = hitAt(x, y);
  if (!hit) return;
  if (hit.kind === 'trans') { transitionDurationDialog(hit.clip, hit.side); return; }
  if (hit.kind !== 'clip') return;
  const c = hit.clip;
  if (c.type === 'text') TZ.ui.showTab('right', 'graphics');
  else if (c.mediaId) { const m = TZ.mediaById(c.mediaId); if (m) { TZ.engine.source.open(m); setTimeout(() => TZ.engine.source.seek(c.in), 100); } }
  else TZ.ui.showTab('lefttop', 'ecp');
});

async function transitionDurationDialog(c, side) {
  const tr = side === 'in' ? c.transIn : c.transOut; if (!tr) return;
  const inp = TZ.h('input', { type: 'text', value: TZ.fmtTC(tr.dur, S.seq.fps), style: { width: '130px' } });
  const sel = TZ.h('select', null, ...TZ.TRANSITIONS.filter(g => !!g.audio === (c.type === 'audio')).flatMap(g => g.items).map(i => TZ.h('option', { value: i.id, selected: i.id === tr.type }, i.name)));
  const r = await TZ.modal({ title: 'Ustawienia przejścia', body: TZ.h('div', { style: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '10px', alignItems: 'center' } }, 'Typ', sel, 'Czas trwania', inp), buttons: [{ label: 'Usuń', value: 'del' }, { label: 'Anuluj', value: null }, { label: 'OK', primary: true, value: 'ok' }] });
  if (r === 'del') { if (side === 'in') c.transIn = null; else c.transOut = null; }
  else if (r === 'ok') { const d = TZ.parseTC(inp.value, S.seq.fps); if (d && d > 0) tr.dur = Math.min(d, c.dur); tr.type = sel.value; }
  else return;
  TZ.commit('Ustawienia przejścia'); TZ.emit('seq');
}
TL.transitionDurationDialog = transitionDurationDialog;

function selectForward(t, track) {
  S.selection = new Set(S.seq.clips.filter(c => c.start >= t - 1e-6 && (!track || c.track === track)).map(c => c.id));
  TZ.emit('sel'); draw();
}
function penAdd(c, hit, x, y, remove) {
  const k = c.type === 'audio' ? 'volume' : 'opacity';
  const lt = TZ.snapFrame(tOf(x)) - c.start;
  c.kf = c.kf || {};
  if (remove) { if (c.kf[k]) { const fr2 = 4 / S.zoom; c.kf[k] = c.kf[k].filter(q => Math.abs(q.t - lt) > fr2); if (!c.kf[k].length) delete c.kf[k]; } }
  else {
    const row = hit.row; const headH = Math.min(15, (row.h - 2) * 0.35);
    const p = TZ.clamp(1 - (y - row.y - 1 - headH - 2) / (row.h - 2 - headH - 4), 0, 1);
    const v = k === 'opacity' ? Math.round(p * 100) : Math.round((p * 46 - 40) * 10) / 10;
    if (!c.kf[k]) c.kf[k] = [];
    if (!c.kf[k].length) c.kf[k].push({ t: 0, v: c.props[k] });
    c.kf[k].push({ t: lt, v }); c.kf[k].sort((a, b) => a.t - b.t);
  }
  selectClip(c, false);
  TZ.commit('Klatka kluczowa'); TZ.emit('seq'); TZ.emit('props');
}

function startPan(e) {
  e.preventDefault();
  const x0 = e.clientX, y0 = e.clientY, s0 = S.scrollX, sy0 = S.scrollY;
  drag = { kind: 'pan' }; setCursor(null);
  cv.setPointerCapture(e.pointerId);
  const mv = ev => { S.scrollX = Math.max(0, s0 - (ev.clientX - x0)); S.scrollY = TZ.clamp(sy0 - (ev.clientY - y0), 0, Math.max(0, TL.totalH - Hh + 20)); draw(); buildHeaders(); };
  const up = () => { drag = null; cv.removeEventListener('pointermove', mv); cv.removeEventListener('pointerup', up); setCursor(null); };
  cv.addEventListener('pointermove', mv); cv.addEventListener('pointerup', up);
}
function startMarquee(e, x, y) {
  marquee = { x0: x, y0: y, x1: x, y1: y };
  const base = new Set(S.selection);
  cv.setPointerCapture(e.pointerId);
  const mv = ev => {
    const [nx, ny] = localXY(ev); marquee.x1 = nx; marquee.y1 = ny;
    const ta = tOf(Math.min(marquee.x0, nx)), tb = tOf(Math.max(marquee.x0, nx)), ya = Math.min(marquee.y0, ny), yb = Math.max(marquee.y0, ny);
    const rows = layoutTracks().filter(r => r.y + r.h > ya && r.y < yb).map(r => r.tr.id);
    S.selection = new Set(base);
    if (Math.abs(nx - marquee.x0) > 3 || Math.abs(ny - marquee.y0) > 3) { S.gap = null; for (const c of S.seq.clips) if (rows.includes(c.track) && c.start < tb && c.start + c.dur > ta) { S.selection.add(c.id); if (S.linked) partners(c).forEach(p => S.selection.add(p.id)); } }
    draw();
  };
  const up = () => { marquee = null; cv.removeEventListener('pointermove', mv); cv.removeEventListener('pointerup', up); TZ.emit('sel'); draw(); };
  cv.addEventListener('pointermove', mv); cv.addEventListener('pointerup', up);
}
function startMove(e, x, y, duplicate) {
  const sel = TZ.selectedClips().filter(c => unlocked(c.track));
  if (!sel.length) return;
  const orig = sel.map(c => ({ c, start: c.start, track: c.track }));
  const ids = new Set(sel.map(c => c.id));
  const grabbed = hitAt(x, y).clip;
  const grabKind = TZ.trackById(grabbed.track).kind;
  const vts = TZ.seqTracksOfKind('v'), ats = TZ.seqTracksOfKind('a');
  const startRow = trackAtY(y);
  let moved = false, dup = duplicate;
  drag = { kind: 'move' };
  cv.setPointerCapture(e.pointerId);
  const mv = ev => {
    const [nx, ny] = localXY(ev);
    if (!moved && Math.abs(nx - x) < 3 && Math.abs(ny - y) < 3) return;
    moved = true;
    let dt = (nx - x) / S.zoom;
    // snap
    snapLine = null;
    if (S.snap !== ev.ctrlKey || false) {
      const th = 8 / S.zoom; let best = null;
      const pts = snapPoints(ids);
      for (const o of orig) for (const edge of [o.start, o.start + o.c.dur]) for (const p of pts) { const d = p - (edge + dt); if (Math.abs(d) < th && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, p }; }
      if (best) { dt += best.d; snapLine = best.p; }
    }
    const minStart = Math.min(...orig.map(o => o.start));
    dt = Math.max(dt, -minStart);
    dt = Math.round(dt * S.seq.fps) / S.seq.fps;
    // track delta
    const row = trackAtY(ny);
    let dti = 0;
    if (row && startRow && row.tr.kind === startRow.tr.kind) {
      const list = grabKind === 'v' ? vts : ats;
      dti = list.indexOf(row.tr) - list.indexOf(startRow.tr);
    }
    for (const o of orig) {
      o.c.start = o.start + dt;
      const kind = TZ.trackById(o.track).kind;
      if (kind === grabKind && dti) {
        const list = kind === 'v' ? vts : ats; const i = TZ.clamp(list.findIndex(t => t.id === o.track) + dti, 0, list.length - 1);
        o.c.track = list[i].id;
      } else o.c.track = o.track;
    }
    TZ.status('Przesunięcie: ' + (dt >= 0 ? '+' : '-') + TZ.fmtTC(Math.abs(dt), S.seq.fps));
    draw();
  };
  const up = (ev) => {
    drag = null; snapLine = null;
    cv.removeEventListener('pointermove', mv); cv.removeEventListener('pointerup', up);
    if (!moved) { draw(); return; }
    if (dup || ev.altKey) {
      // alt-drag duplicates: restore originals and add copies
      const copies = [];
      const linkMap = {};
      for (const o of orig) { const n = cloneClip(o.c); if (n.linkId) { linkMap[n.linkId] = linkMap[n.linkId] || TZ.uid('l'); n.linkId = linkMap[n.linkId]; } copies.push(n); o.c.start = o.start; o.c.track = o.track; }
      for (const n of copies) clearRange(n.track, n.start, n.start + n.dur);
      S.seq.clips.push(...copies);
      S.selection = new Set(copies.map(c => c.id));
      TZ.commit('Duplikuj');
    } else if (ev.ctrlKey && false) {
      TZ.commit('Przesuń');
    } else {
      for (const o of orig) clearRange(o.c.track, o.c.start, o.c.start + o.c.dur, ids);
      TZ.commit('Przesuń');
    }
    TZ.emit('seq'); TZ.emit('sel');
  };
  cv.addEventListener('pointermove', mv); cv.addEventListener('pointerup', up);
}
function startTrim(e, c, edge, x, ripple) {
  const group = [c, ...(S.linked ? partners(c) : [])].filter(g => unlocked(g.track));
  const orig = group.map(g => ({ g, start: g.start, dur: g.dur, in: g.in, kf: JSON.parse(JSON.stringify(g.kf || {})) }));
  const others = S.seq.clips.filter(o => !group.includes(o));
  const origOthers = others.map(o => ({ o, start: o.start }));
  const end0 = c.start + c.dur;
  drag = { kind: 'trim' };
  cv.setPointerCapture(e.pointerId);
  let moved = false;
  const mv = ev => {
    const [nx] = localXY(ev);
    if (!moved && Math.abs(nx - x) < 2) return;
    moved = true;
    let d = (nx - x) / S.zoom;
    snapLine = null;
    const edgeT = edge === 'l' ? orig[0].start : orig[0].start + orig[0].dur;
    if (S.snap) { const s = snapT(edgeT + d, new Set(group.map(g => g.id))); if (s.snapped != null) { d = s.t - edgeT; snapLine = s.snapped; } }
    d = Math.round(d * S.seq.fps) / S.seq.fps;
    // limits
    for (const o of orig) {
      const g = o.g, srcDur = TZ.mediaSourceDuration(g);
      if (edge === 'l') {
        let lo = ripple ? -o.in / g.speed : Math.max(-o.in / g.speed, -o.start);
        if (srcDur === Infinity) lo = ripple ? -1e6 : -o.start;
        if (!ripple) { const prev = clipsOn(g.track).filter(p => p !== g && !group.includes(p) && p.start + p.dur <= o.start + 1e-6).pop(); if (prev) lo = Math.max(lo, prev.start + prev.dur - o.start); }
        d = TZ.clamp(d, lo, o.dur - fr());
      } else {
        let hi = srcDur === Infinity ? 1e6 : (srcDur - o.in) / g.speed - o.dur;
        if (!ripple) { const next = clipsOn(g.track).find(p => p !== g && !group.includes(p) && p.start >= o.start + o.dur - 1e-6); if (next) hi = Math.min(hi, next.start - (o.start + o.dur)); }
        d = TZ.clamp(d, -(o.dur - fr()), hi);
      }
    }
    for (const o of orig) {
      const g = o.g;
      if (edge === 'l') {
        if (ripple) { g.start = o.start; g.in = o.in + d * g.speed; g.dur = o.dur - d; }
        else { g.start = o.start + d; g.in = o.in + d * g.speed; g.dur = o.dur - d; }
        g.kf = {}; for (const k in o.kf) g.kf[k] = o.kf[k].map(q => ({ ...q, t: q.t - d }));
      } else g.dur = o.dur + d;
    }
    if (ripple) {
      const shift = edge === 'l' ? -d : d;
      for (const oo of origOthers) { const tr = TZ.trackById(oo.o.track); if (!tr.locked && oo.start >= end0 - 1e-6) oo.o.start = oo.start + shift; else oo.o.start = oo.start; }
    }
    TZ.status((edge === 'l' ? 'Przycięcie początku: ' : 'Przycięcie końca: ') + TZ.fmtTC(c.dur, S.seq.fps));
    draw();
    if (edge === 'l') TZ.engine.seek(c.start, false); else TZ.engine.seek(c.start + c.dur - fr(), false);
  };
  const up = () => {
    drag = null; snapLine = null;
    cv.removeEventListener('pointermove', mv); cv.removeEventListener('pointerup', up);
    if (moved) { TZ.commit(ripple ? 'Przycięcie z przesunięciem' : 'Przytnij'); TZ.emit('seq'); }
  };
  cv.addEventListener('pointermove', mv); cv.addEventListener('pointerup', up);
}
function startSlip(e, c, x) {
  const group = [c, ...(S.linked ? partners(c) : [])];
  const orig = group.map(g => ({ g, in: g.in }));
  const srcDur = TZ.mediaSourceDuration(c);
  cv.setPointerCapture(e.pointerId); drag = { kind: 'slip' };
  const mv = ev => {
    const [nx] = localXY(ev);
    let d = -(nx - x) / S.zoom * c.speed;
    for (const o of orig) { const nin = TZ.clamp(o.in + d, 0, srcDur - o.g.dur * o.g.speed); o.g.in = nin; }
    TZ.status('Poślizg: punkt wejścia ' + TZ.fmtTC(c.in, S.seq.fps));
    draw(); TZ.engine.requestRender();
  };
  const up = () => { drag = null; cv.removeEventListener('pointermove', mv); cv.removeEventListener('pointerup', up); TZ.commit('Poślizg'); TZ.emit('seq'); };
  cv.addEventListener('pointermove', mv); cv.addEventListener('pointerup', up);
}
function startTransDrag(e, hit) {
  const c = hit.clip, tr = hit.side === 'in' ? c.transIn : c.transOut;
  const x0 = e.clientX, d0 = tr.dur; let moved = false;
  cv.setPointerCapture(e.pointerId);
  const mv = ev => { const dx = ev.clientX - x0; if (Math.abs(dx) < 3 && !moved) return; moved = true; tr.dur = TZ.clamp(d0 + dx / S.zoom * (hit.side === 'in' ? 1 : -1) * 2, fr() * 2, c.dur); draw(); };
  const up = () => { cv.removeEventListener('pointermove', mv); cv.removeEventListener('pointerup', up); if (moved) { TZ.commit('Czas przejścia'); TZ.emit('seq'); } };
  cv.addEventListener('pointermove', mv); cv.addEventListener('pointerup', up);
}

/* ruler scrub */
rc.addEventListener('pointerdown', e => {
  const r = rc.getBoundingClientRect();
  const go = ev => { let t = Math.max(0, tOf(ev.clientX - r.left)); if (S.snap && !ev.shiftKey) { const s = snapT(t, null); t = s.t; } TZ.engine.seek(t, false); };
  // marker click
  const t = tOf(e.clientX - r.left);
  const mk = S.seq.markers.find(m => Math.abs(xOf(m.t) - (e.clientX - r.left)) < 6 && e.clientY - r.top < 30);
  if (mk && e.detail === 2) { TL.editMarker(mk); return; }
  void t;
  go(e); rc.setPointerCapture(e.pointerId);
  rc.onpointermove = go; rc.onpointerup = () => { rc.onpointermove = null; };
});
rc.addEventListener('wheel', e => { e.preventDefault(); TL.zoomAround(e.deltaY < 0 ? 1.25 : 0.8, tOf(e.clientX - rc.getBoundingClientRect().left)); }, { passive: false });

/* wheel */
wrap.addEventListener('wheel', e => {
  e.preventDefault();
  const [x] = localXY(e);
  if (e.altKey || e.ctrlKey) TL.zoomAround(e.deltaY < 0 ? 1.2 : 1 / 1.2, tOf(x));
  else if (e.shiftKey) { S.scrollY = TZ.clamp(S.scrollY + e.deltaY, 0, Math.max(0, TL.totalH - Hh + 20)); buildHeaders(); draw(); }
  else { S.scrollX = Math.max(0, S.scrollX + (e.deltaY || e.deltaX)); draw(); }
}, { passive: false });
headers.addEventListener('wheel', e => { e.preventDefault(); S.scrollY = TZ.clamp(S.scrollY + e.deltaY, 0, Math.max(0, TL.totalH - Hh + 20)); buildHeaders(); draw(); }, { passive: false });

/* context menu */
cv.addEventListener('contextmenu', e => {
  e.preventDefault();
  const [x, y] = localXY(e); const hit = hitAt(x, y);
  if (!hit) return;
  if (hit.kind === 'trans') {
    S.selTrans = { clipId: hit.clip.id, side: hit.side }; draw();
    TZ.menu(e.clientX, e.clientY, [
      { label: 'Ustaw czas trwania przejścia…', action: () => transitionDurationDialog(hit.clip, hit.side) },
      { label: 'Wyczyść', key: 'Delete', action: () => TL.deleteSelection() }
    ]);
    return;
  }
  if (hit.kind === 'empty') {
    TZ.menu(e.clientX, e.clientY, [
      { label: 'Wklej', key: 'Ctrl+V', disabled: !S.clipboard, action: () => { S.playhead = TZ.snapFrame(hit.t); TL.paste(false); } },
      { label: 'Usuń przerwę z przesunięciem', disabled: !S.gap, action: () => TL.deleteSelection(true) },
      '-',
      { label: 'Dodaj tekst tutaj', action: () => TL.addSynthetic('text', { start: TZ.snapFrame(hit.t), track: hit.row.tr.kind === 'v' ? hit.row.tr.id : null }) },
      { label: 'Dodaj warstwę korekcyjną', action: () => TL.addSynthetic('adjust', { start: TZ.snapFrame(hit.t) }) },
      { label: 'Dodaj planszę koloru', action: () => TL.addSynthetic('color', { start: TZ.snapFrame(hit.t) }) }
    ]);
    return;
  }
  const c = hit.clip;
  if (!S.selection.has(c.id)) selectClip(c, false);
  TZ.menu(e.clientX, e.clientY, [
    { label: 'Wytnij', key: 'Ctrl+X', action: () => TL.copy(true) },
    { label: 'Kopiuj', key: 'Ctrl+C', action: () => TL.copy(false) },
    { label: 'Wklej atrybuty', disabled: !S.clipboard, action: () => TL.pasteAttributes() },
    { label: 'Duplikuj', key: 'Ctrl+Shift+/', action: () => TL.duplicate() },
    '-',
    { label: 'Wyczyść', key: 'Delete', action: () => TL.deleteSelection(false) },
    { label: 'Usuń z przesunięciem', key: 'Shift+Delete', action: () => TL.deleteSelection(true) },
    '-',
    { label: 'Włącz', checked: c.enabled !== false, action: () => TL.toggleEnable() },
    { label: c.linkId ? 'Rozłącz audio i wideo' : 'Połącz', action: () => TL.link(!c.linkId) },
    { label: 'Usuń tylko audio', disabled: !(c.type === 'audio' || partners(c).some(x => x.type === 'audio')), action: () => TL.removeLinked('audio') },
    { label: 'Usuń tylko wideo', disabled: !(c.type !== 'audio' || partners(c).some(x => x.type !== 'audio')), action: () => TL.removeLinked('video') },
    { label: 'Zaznacz tylko ten klip', key: 'Ctrl+klik', action: () => selectClip(c, false, true) },
    { label: 'Szybkość/czas trwania…', key: 'Ctrl+R', disabled: !(c.type === 'video' || c.type === 'audio'), action: () => TL.speedDialog() },
    { label: 'Czas trwania…', disabled: c.type === 'video' || c.type === 'audio', action: () => TL.durationDialog() },
    { label: 'Zastosuj domyślne przejścia', key: 'Ctrl+D', action: () => TL.applyDefaultTransition() },
    { label: 'Usuń efekty', action: () => { TZ.selectedClips().forEach(x => { x.effects = []; x.lumetri = TZ.defaultLumetri(); }); TZ.commit('Usuń efekty'); TZ.emit('seq'); TZ.emit('sel'); } },
    '-',
    { label: 'Etykieta', sub: TZ.LABELS.map(([n, col]) => ({ label: n, action: () => { TZ.selectedClips().forEach(x => x.label = col); TZ.commit('Etykieta'); draw(); } })) },
    { label: 'Zmień nazwę…', action: async () => { const n = await TZ.prompt('Nazwa klipu', c.name); if (n) { c.name = n; TZ.commit('Zmień nazwę'); draw(); } } },
    { label: 'Pokaż w projekcie', disabled: !c.mediaId, action: () => { S.selMedia = new Set([c.mediaId]); TZ.ui.showTab('project', 'project'); TZ.emit('media'); } },
    { label: 'Właściwości', action: () => TZ.ui.showTab('right', 'props') }
  ]);
});
TL.durationDialog = async () => {
  const sel = TZ.selectedClips(); if (!sel.length) return;
  const inp = TZ.h('input', { type: 'text', value: TZ.fmtTC(sel[0].dur, S.seq.fps) });
  const r = await TZ.prompt('Czas trwania klipu (hh:mm:ss:kk)', TZ.fmtTC(sel[0].dur, S.seq.fps));
  void inp;
  if (!r) return; const d = TZ.parseTC(r, S.seq.fps); if (!d || d <= 0) return;
  for (const c of sel) { const lim = TZ.mediaSourceDuration(c); c.dur = lim === Infinity ? d : Math.min(d, (lim - c.in) / c.speed); }
  TZ.commit('Czas trwania'); TZ.emit('seq');
};

/* ---------- drag & drop from project / effects / OS ---------- */
function dropInfo(e) {
  const [x, y] = localXY(e);
  let row = trackAtY(y);
  let t = Math.max(0, tOf(x));
  return { x, y, row, t };
}
wrap.addEventListener('dragover', e => {
  const types = [...e.dataTransfer.types];
  if (!types.some(t => t.startsWith('text/tz-') || t === 'Files')) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  const { row, t, x, y } = dropInfo(e);
  dropGhost = null; snapLine = null;
  if (types.includes('text/tz-media') && window._tzDragMedia) {
    const medias = window._tzDragMedia.map(TZ.mediaById).filter(Boolean);
    let st = t; const s = snapT(st, null); if (s.snapped != null) { st = s.t; snapLine = s.snapped; }
    st = TZ.snapFrame(st);
    let vTrack = null, aTrack = null;
    if (row) { if (row.tr.kind === 'v') vTrack = row.tr.id; else aTrack = row.tr.id; }
    const tt = targetTracks(vTrack, aTrack);
    dropGhost = []; let at = st;
    for (const m of medias) {
      const d = m.type === 'image' ? 5 : (m.srcOut != null ? m.srcOut : m.duration) - (m.srcIn || 0);
      if (m.type !== 'audio') dropGhost.push({ track: tt.v, start: at, dur: d });
      if (m.type === 'audio' || m.hasAudio !== false) dropGhost.push({ track: m.type === 'audio' && row && row.tr.kind === 'a' ? row.tr.id : tt.a, start: at, dur: d });
      at += d;
    }
  } else if (types.includes('text/tz-effect') || types.includes('text/tz-transition') || types.includes('text/tz-preset') || types.includes('text/tz-look')) {
    const hit = hitAt(x, y);
    hover = null;
    if (hit && hit.kind === 'clip') { S.dropHover = hit.clip.id; }
  }
  draw();
});
wrap.addEventListener('dragleave', () => { dropGhost = null; snapLine = null; draw(); });
wrap.addEventListener('drop', async e => {
  e.preventDefault();
  const ghost = dropGhost; dropGhost = null; snapLine = null;
  const { row, t, x, y } = dropInfo(e);
  const dt = e.dataTransfer;
  if (dt.getData('text/tz-media')) {
    const ids = JSON.parse(dt.getData('text/tz-media'));
    const medias = ids.map(TZ.mediaById).filter(Boolean);
    let st = t; const s = snapT(st, null); if (s.snapped != null) st = s.t; st = TZ.snapFrame(st);
    let vTrack = null, aTrack = null;
    if (row) { if (row.tr.kind === 'v') vTrack = row.tr.id; else aTrack = row.tr.id; }
    if (row && row.tr.locked) { TZ.toast('Ścieżka jest zablokowana'); draw(); return; }
    await TL.placeMedia(medias, st, vTrack, aTrack, e.ctrlKey ? 'insert' : 'overwrite');
    void ghost;
    return;
  }
  const fxId = dt.getData('text/tz-effect'), trId = dt.getData('text/tz-transition'), prId = dt.getData('text/tz-preset');
  const lkId = dt.getData('text/tz-look');
  if (lkId) { const hit = hitAt(x, y); if (!hit || hit.kind !== 'clip' || hit.clip.type === 'audio') { TZ.toast('Upuść wygląd Lumetri na klipie wideo'); draw(); return; } hit.clip.lumetri.look = lkId; S.selection = new Set([hit.clip.id]); TZ.commit('Wygląd Lumetri'); TZ.emit('seq'); TZ.emit('sel'); return; }
  if (prId) { const hit = hitAt(x, y); if (!hit || hit.kind !== 'clip') { TZ.toast('Upuść ustawienie wstępne na klipie'); draw(); return; } TL.applyPreset(hit.clip, prId); return; }
  if (fxId || trId) {
    const hit = hitAt(x, y);
    if (!hit || hit.kind !== 'clip') { TZ.toast('Upuść efekt na klipie na osi czasu'); draw(); return; }
    if (fxId) TL.applyEffect(hit.clip, fxId);
    else {
      const def = TZ.trDef(trId);
      if (!!def.audio !== (hit.clip.type === 'audio')) { TZ.toast(def.audio ? 'Przejście audio – upuść na klipie audio' : 'Przejście wideo – upuść na klipie wideo'); draw(); return; }
      const mid = hit.clip.start + hit.clip.dur / 2;
      TL.applyTransition(hit.clip, hit.t < mid ? 'in' : 'out', trId, 1);
    }
    return;
  }
  if (dt.files && dt.files.length) {
    const ms = await TZ.importFiles([...dt.files]);
    await TZ.sleep(50);
    if (ms.length) { const st = TZ.snapFrame(t); await TL.placeMedia(ms, st, row && row.tr.kind === 'v' ? row.tr.id : null, row && row.tr.kind === 'a' ? row.tr.id : null); }
  }
  draw();
});

/* ---------- events ---------- */
TZ.on('seq', () => { staticDirty = true; buildHeaders(); draw(); });
TZ.on('sel', () => { staticDirty = true; TL.requestDraw(); });
['strip', 'peaks', 'mediaThumb', 'props', 'media', 'playstate'].forEach(ev => TZ.on(ev, () => { staticDirty = true; }));
TZ.on('time', () => { if (S.playing) { const x = xOf(S.playhead); if (x > W - 30 || x < 0) S.scrollX = Math.max(0, S.playhead * S.zoom - 60); } TL.requestDraw(false); });
TZ.on('strip', () => TL.requestDraw());
TZ.on('peaks', () => TL.requestDraw());
TZ.on('mediaThumb', () => TL.requestDraw());
TZ.on('props', () => TL.requestDraw());
setTimeout(resize, 0);
})();
