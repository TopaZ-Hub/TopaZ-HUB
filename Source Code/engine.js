'use strict';
/* ==========================================================
   Playback engine: media element pool, audio graph, meters,
   program monitor & source monitor
   ========================================================== */
(() => {
const S = TZ.state, R = TZ.render;
const E = TZ.engine = { rate: 1, frameHook: null, quality: TZ.settings.previewQuality === 'auto' ? 1 : (+TZ.settings.previewQuality || 1), zoom: 'fit' };
const holder = TZ.h('div', { style: { position: 'fixed', left: '-10px', top: '-10px', width: '1px', height: '1px', overflow: 'hidden', opacity: '0', pointerEvents: 'none' } });
document.body.append(holder);

/* ---------- audio graph ---------- */
const actx = TZ.audioCtx();
const master = actx.createGain();
const split = actx.createChannelSplitter(2);
const anL = actx.createAnalyser(), anR = actx.createAnalyser();
anL.fftSize = anR.fftSize = 1024;
master.connect(actx.destination); master.connect(split); split.connect(anL, 0); split.connect(anR, 1);
const exportDest = actx.createMediaStreamDestination();
master.connect(exportDest);
E.exportStream = () => exportDest.stream;
E.audioContext = actx;
const trackNodes = {};
function trackNode(id) {
  if (!trackNodes[id]) { const g = actx.createGain(); g.connect(master); trackNodes[id] = g; }
  return trackNodes[id];
}
const resumeAudio = () => { if (actx.state !== 'running') actx.resume().catch(() => {}); };
document.addEventListener('pointerdown', resumeAudio, true);
document.addEventListener('keydown', resumeAudio, true);

const _irCache = new Map();
function impulse(ctx, size, decay) {
  const key = (ctx === actx ? 'rt' : 'off') + size.toFixed(2) + '_' + decay.toFixed(2) + '_' + ctx.sampleRate;
  if (ctx === actx && _irCache.has(key)) return _irCache.get(key);
  const len = Math.max(1, Math.floor(ctx.sampleRate * size)), b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); }
  if (ctx === actx) _irCache.set(key, b);
  return b;
}
function shaperCurve(fn, n = 4096) { const c = new Float32Array(n); for (let i = 0; i < n; i++) c[i] = fn(i / (n - 1) * 2 - 1); return c; }
function buildChain(effects, ctx = actx) {
  const input = ctx.createGain(); let cur = input; const nodes = [input]; const lfos = [];
  const add = (node) => { cur.connect(node); cur = node; nodes.push(node); return node; };
  const wetDry = (build, mix) => { // parallel dry/wet
    const out = ctx.createGain(), dry = ctx.createGain(), wet = ctx.createGain();
    dry.gain.value = 1 - mix * 0.5; wet.gain.value = mix;
    cur.connect(dry); dry.connect(out);
    const end = build(cur); end.connect(wet); wet.connect(out);
    nodes.push(out, dry, wet); cur = out;
  };
  const bq = (type, f, g, q) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; if (g != null) b.gain.value = g; if (q != null) b.Q.value = q; nodes.push(b); return b; };
  for (const fx of effects || []) {
    if (fx.enabled === false) continue;
    const p = fx.p || {};
    switch (fx.id) {
      case 'bass': add(bq('lowshelf', 220, p.gain)); break;
      case 'treble': add(bq('highshelf', 3200, p.gain)); break;
      case 'eq3': add(bq('lowshelf', 200, p.lo)); add(bq('peaking', p.mf || 1000, p.mid, 1)); add(bq('highshelf', 4000, p.hi)); break;
      case 'highpass': add(bq('highpass', p.freq)); break;
      case 'lowpass': add(bq('lowpass', p.freq)); break;
      case 'bandpass': add(bq('bandpass', p.freq, null, p.q)); break;
      case 'notch': add(bq('notch', p.freq, null, p.q)); break;
      case 'telephone': wetDry((src) => { const a = bq('highpass', 400, null, 0.9), b = bq('lowpass', 3400, null, 0.9), g = ctx.createGain(); g.gain.value = 1.6; nodes.push(g); src.connect(a); a.connect(b); b.connect(g); return g; }, p.mix / 100); break;
      case 'gainfx': { const g = ctx.createGain(); g.gain.value = TZ.dbToGain(p.gain); add(g); break; }
      case 'invertpol': { const g = ctx.createGain(); g.gain.value = -1; add(g); break; }
      case 'compressor': { const c = ctx.createDynamicsCompressor(); c.threshold.value = p.th; c.ratio.value = p.ratio; c.attack.value = p.att / 1000; c.release.value = p.rel / 1000; c.knee.value = 6; add(c); const g = ctx.createGain(); g.gain.value = TZ.dbToGain(p.makeup); add(g); break; }
      case 'limiter': { const g = ctx.createGain(); g.gain.value = TZ.dbToGain(p.boost); add(g); const c = ctx.createDynamicsCompressor(); c.threshold.value = p.ceil; c.ratio.value = 20; c.attack.value = 0.001; c.release.value = 0.06; c.knee.value = 0; add(c); break; }
      case 'echo': {
        const out = ctx.createGain(), dry = ctx.createGain(), wet = ctx.createGain(), d = ctx.createDelay(2), fb = ctx.createGain();
        d.delayTime.value = p.time / 1000; fb.gain.value = p.feedback / 100; wet.gain.value = p.mix / 100; dry.gain.value = 1;
        cur.connect(dry); dry.connect(out); cur.connect(d); d.connect(fb); fb.connect(d); d.connect(wet); wet.connect(out);
        cur = out; nodes.push(out, dry, wet, d, fb); break;
      }
      case 'reverb': wetDry((src) => { const cv = ctx.createConvolver(); cv.buffer = impulse(ctx, p.size, p.decay); nodes.push(cv); src.connect(cv); return cv; }, p.mix / 100); break;
      case 'chorus': case 'flanger': wetDry((src) => {
        const d = ctx.createDelay(0.1); d.delayTime.value = fx.id === 'chorus' ? 0.022 : 0.004;
        const osc = ctx.createOscillator(), og = ctx.createGain(); osc.frequency.value = p.rate; og.gain.value = p.depth / 1000 / 2;
        osc.connect(og); og.connect(d.delayTime); osc.start(); lfos.push(osc); nodes.push(d, og, osc);
        src.connect(d);
        if (fx.id === 'flanger') { const fb = ctx.createGain(); fb.gain.value = p.fb / 100; d.connect(fb); fb.connect(d); nodes.push(fb); }
        return d;
      }, p.mix / 100); break;
      case 'tremolo': {
        const g = ctx.createGain(); g.gain.value = 1 - p.depth / 200; add(g);
        const osc = ctx.createOscillator(), og = ctx.createGain(); osc.frequency.value = p.rate; og.gain.value = p.depth / 200; osc.connect(og); og.connect(g.gain); osc.start(); lfos.push(osc); nodes.push(osc, og); break;
      }
      case 'distortion': wetDry((src) => { const w = ctx.createWaveShaper(); const k = p.amount * 1.5; w.curve = shaperCurve(x => (1 + k) * x / (1 + k * Math.abs(x))); w.oversample = '4x'; nodes.push(w); src.connect(w); return w; }, p.mix / 100); break;
      case 'bitcrush': { const w = ctx.createWaveShaper(); const lv = Math.pow(2, p.bits) / 2; w.curve = shaperCurve(x => Math.round(x * lv) / lv, 65536); add(w); break; }
      case 'swapch': case 'fillleft': case 'fillright': case 'mono': {
        const sp = ctx.createChannelSplitter(2), mg = ctx.createChannelMerger(2); cur.connect(sp); nodes.push(sp, mg);
        if (fx.id === 'swapch') { sp.connect(mg, 0, 1); sp.connect(mg, 1, 0); }
        else if (fx.id === 'fillleft') { sp.connect(mg, 0, 0); sp.connect(mg, 0, 1); }
        else if (fx.id === 'fillright') { sp.connect(mg, 1, 0); sp.connect(mg, 1, 1); }
        else { const a = ctx.createGain(); a.gain.value = 0.5; nodes.push(a); sp.connect(a, 0); sp.connect(a, 1); a.connect(mg, 0, 0); a.connect(mg, 0, 1); }
        cur = mg; break;
      }
    }
  }
  return { input, output: cur, nodes, lfos };
}
E.buildChain = buildChain;
const killChain = (ch) => { try { ch.lfos && ch.lfos.forEach(o => { try { o.stop(); } catch (e) {} }); ch.nodes.forEach(nd => nd.disconnect()); } catch (e) {} };

/* ---------- media element pool (reuses decoders per media) ---------- */
const byClip = new Map();     // clipId -> entry
let idle = [];                // entries without clip
const maxIdle = () => TZ.settings.decoders > 0 ? TZ.settings.decoders : Math.max(4, Math.min(16, Math.round((TZ.settings.ramGB || 8) / 1.5)));
function createEntry(m, kind) {
  const el = kind === 'v' ? document.createElement('video') : new Audio();
  const e = { el, kind, mediaId: m.id, clipId: null, lastUsed: performance.now() };
  el.preload = 'auto'; el.crossOrigin = 'anonymous';
  if (kind === 'v') {
    el.muted = true; el.playsInline = true; el.disablePictureInPicture = true;
    const onReady = () => { const c = e.clipId && TZ.clipById(e.clipId); if (c && R.primeClip) R.primeClip(c, el); E.requestRender(); };
    el.addEventListener('seeked', onReady); el.addEventListener('loadeddata', onReady);
  }
  el.src = m.url;
  holder.append(el);
  if (kind === 'a') { e.src = actx.createMediaElementSource(el); e.gain = actx.createGain(); e.gain.gain.value = 0; e.pan = actx.createStereoPanner(); e.gain.connect(e.pan); e.sig = null; e.chain = null; e.track = null; }
  return e;
}
function destroyEntry(e) {
  try { e.el.pause(); } catch (er) {}
  if (e.kind === 'a') { try { e.src.disconnect(); if (e.chain) killChain(e.chain); e.gain.disconnect(); e.pan.disconnect(); } catch (er) {} }
  e.el.removeAttribute('src'); try { e.el.load(); } catch (er) {}
  e.el.remove();
}
function acquire(clip, kind) {
  let e = byClip.get(clip.id);
  if (e && (e.mediaId !== clip.mediaId || e.kind !== kind)) { E.release(clip.id); e = null; }
  if (!e) {
    const m = TZ.mediaById(clip.mediaId);
    if (!m || m.missing || (kind === 'v' && m.type !== 'video') || (kind === 'a' && m.type === 'image')) return null;
    const want = E.srcTime(clip, Math.max(clip.start, Math.min(S.playhead, clip.start + clip.dur)));
    let best = -1, bd = 1e9;
    idle.forEach((x, i) => { if (x.mediaId === m.id && x.kind === kind) { const d = Math.abs(x.el.currentTime - want); if (d < bd) { bd = d; best = i; } } });
    if (best >= 0) { e = idle.splice(best, 1)[0]; } else e = createEntry(m, kind);
    e.clipId = clip.id; byClip.set(clip.id, e);
  }
  e.lastUsed = performance.now();
  if (kind === 'a') {
    const sig = JSON.stringify(clip.effects || []);
    if (e.sig !== sig) {
      try { e.src.disconnect(); } catch (er) {}
      if (e.chain) killChain(e.chain);
      e.chain = buildChain(clip.effects); e.src.connect(e.chain.input); e.chain.output.connect(e.gain); e.sig = sig;
    }
    if (e.track !== clip.track) { try { e.pan.disconnect(); } catch (er) {} e.pan.connect(trackNode(clip.track)); e.track = clip.track; }
  }
  return e.el;
}
E.videoEl = (clip) => acquire(clip, 'v');
E.audioEl = (clip) => acquire(clip, 'a');
E.release = (id) => {
  const e = byClip.get(id); if (!e) return;
  byClip.delete(id); e.clipId = null;
  try { e.el.pause(); } catch (er) {}
  if (e.kind === 'a') e.gain.gain.setTargetAtTime(0, actx.currentTime, 0.01);
  idle.push(e);
  while (idle.length > maxIdle()) destroyEntry(idle.shift());
};
E.resetPool = () => { for (const id of [...byClip.keys()]) E.release(id); idle.forEach(destroyEntry); idle = []; };
E.lastFrame = () => null;
E.poolSize = () => byClip.size + idle.length;
E.activeElements = () => [...byClip.values()];

const srcTime = (c, t) => {
  const m = TZ.mediaById(c.mediaId);
  const dur = m && m.duration ? m.duration : 1e9;
  return TZ.clamp(c.in + (t - c.start) * c.speed, 0, Math.max(0, dur - 0.02));
};
E.srcTime = srcTime;
const curve = (type, p) => { p = TZ.clamp(p, 0, 1); return type === 'constgain' ? p : type === 'expfade' ? p * p : Math.sin(p * Math.PI / 2); };
function fadeFactor(c, t, clips) {
  let g = 1;
  const end = c.start + c.dur;
  if (c.transIn) {
    const d = c.transIn.dur;
    const prev = clips.find(x => x !== c && Math.abs(x.start + x.dur - c.start) < 1e-3);
    const s = prev ? c.start - d / 2 : c.start;
    if (t < s + d) g *= curve(c.transIn.type, (t - s) / d);
  }
  const next = clips.find(x => x !== c && Math.abs(end - x.start) < 1e-3);
  if (next && next.transIn) { const d = next.transIn.dur, s = end - d / 2; if (t >= s) g *= curve(next.transIn.type, 1 - (t - s) / d); }
  else if (c.transOut) { const d = c.transOut.dur, s = end - d; if (t >= s) g *= curve(c.transOut.type, 1 - (t - s) / d); }
  return g;
}
E.clipGainAt = (c, t, clips) => TZ.dbToGain(TZ.propAt(c, 'volume', t - c.start)) * fadeFactor(c, t, clips || S.seq.clips.filter(x => x.track === c.track));

let lastSync = 0;
E.sync = (t, playing) => {
  let stalled = false;
  const anySolo = TZ.audioTracks().some(tr => tr.solo);
  for (const tr of S.seq.tracks) {
    if (tr.kind !== 'a') continue;
    const v = (tr.muted || (anySolo && !tr.solo)) ? 0 : TZ.dbToGain(tr.volume || 0);
    trackNode(tr.id).gain.setTargetAtTime(v, actx.currentTime, 0.015);
  }
  master.gain.setTargetAtTime(TZ.dbToGain(S.seq.masterVolume || 0), actx.currentTime, 0.015);
  const byTrack = {};
  for (const c of S.seq.clips) (byTrack[c.track] = byTrack[c.track] || []).push(c);
  const lead = playing ? Math.max(0.5, TZ.settings.prerollSec || 2) : 0;
  let warmBudget = playing ? 0 : 3;
  for (const c of S.seq.clips) {
    if (c.type !== 'video' && c.type !== 'audio') continue;
    const m = TZ.mediaById(c.mediaId);
    if (!m || m.missing) continue;
    const tclips = byTrack[c.track].filter(x => x.enabled !== false);
    const [ws, we] = R.clipWindow(c, tclips);
    const tr = TZ.trackById(c.track);
    const active = c.enabled !== false && t >= ws && t < we && !(c.type === 'video' && tr && tr.hidden);
    const near = playing && !active && c.enabled !== false && t < ws && ws - t < lead;
    const dist = t < ws ? ws - t : t - we;
    const warm = !playing && !active && c.type === 'video' && c.enabled !== false && dist < 4 && warmBudget > 0;
    const has = byClip.get(c.id);
    if (!active && !near && !warm) {
      if (has) { if (!has.el.paused) has.el.pause(); if (has.kind === 'a') has.gain.gain.setTargetAtTime(0, actx.currentTime, 0.01); if (dist > 6) E.release(c.id); }
      continue;
    }
    const el = c.type === 'video' ? E.videoEl(c) : E.audioEl(c);
    if (!el) continue;
    if (near || warm) {
      if (warm) warmBudget--;
      const edgeT = t < ws ? ws : Math.min(we, c.start + c.dur) - 0.01;
      const desired = srcTime(c, edgeT);
      if (!el.paused) el.pause();
      if (Math.abs(el.currentTime - desired) > 0.08 && !el.seeking) el.currentTime = desired;
      else if (c.type === 'video' && R.primeClip) R.primeClip(c, el);
      if (c.type === 'audio') byClip.get(c.id).gain.gain.setTargetAtTime(0, actx.currentTime, 0.01);
      continue;
    }
    const desired = srcTime(c, t);
    const rate = TZ.clamp(c.speed * E.rate, 0.0625, 16);
    if (playing) {
      const drift = el.currentTime - desired;
      if (el.seeking || el.readyState < 3) { stalled = true; if (!el.paused && el.seeking) {} }
      else if (el.paused) {
        if (Math.abs(drift) > 0.05) { el.currentTime = desired; stalled = true; }
        el.playbackRate = rate;
        const pr = el.play(); if (pr) pr.catch(() => {});
      } else if (Math.abs(drift) > 1.0 + 0.1 * rate) { el.currentTime = desired; el.playbackRate = rate; stalled = true; }
      else if (Math.abs(drift) > 0.035) el.playbackRate = rate * TZ.clamp(1 - drift * 1.5, 0.75, 1.3);
      else if (Math.abs(el.playbackRate - rate) > 1e-3) el.playbackRate = rate;
    } else {
      if (!el.paused) el.pause();
      if (Math.abs(el.currentTime - desired) > 0.45 / S.seq.fps) el.currentTime = desired;
    }
    if (c.type === 'audio') {
      const pp = byClip.get(c.id);
      const g = playing ? E.clipGainAt(c, t, tclips) : 0;
      pp.gain.gain.setTargetAtTime(g, actx.currentTime, 0.012);
      pp.pan.pan.value = TZ.clamp((TZ.propAt(c, 'pan', t - c.start) || 0) / 100, -1, 1);
    }
  }
  if (performance.now() - lastSync > 1000) {
    lastSync = performance.now();
    for (const id of [...byClip.keys()]) if (!TZ.clipById(id)) E.release(id);
  }
  return { stalled };
};

/* ---------- program monitor ---------- */
const pc = TZ.$('#progCanvas'), pctx = pc.getContext('2d');
const view = TZ.$('#progView'), overlay = TZ.$('#progOverlay');
E.programCanvas = pc;
E.layoutProgram = () => {
  const q = E.quality;
  const W = Math.max(2, Math.round(S.seq.width * q)), Hh = Math.max(2, Math.round(S.seq.height * q));
  if (pc.width !== W || pc.height !== Hh) { pc.width = W; pc.height = Hh; }
  const r = view.getBoundingClientRect();
  const ar = S.seq.width / S.seq.height;
  let cw, ch;
  if (E.zoom === 'fit') { cw = Math.min(r.width - 8, (r.height - 8) * ar); ch = cw / ar; }
  else { cw = S.seq.width * +E.zoom; ch = S.seq.height * +E.zoom; }
  cw = Math.max(10, cw); ch = Math.max(10, ch);
  pc.style.width = cw + 'px'; pc.style.height = ch + 'px';
  pc.style.maxWidth = E.zoom === 'fit' ? '100%' : 'none'; pc.style.maxHeight = E.zoom === 'fit' ? '100%' : 'none';
  E.updateOverlay();
};
E.renderProgram = () => {
  R.renderFrame(S.playhead, pctx, pc.width, pc.height);
  E.updateOverlay();
  scopesTick();
};
let rr = 0;
E.requestRender = () => {
  if (rr || S.playing) return;
  rr = requestAnimationFrame(() => { rr = 0; if (S.playing) return; E.sync(S.playhead, false); E.renderProgram(); });
};

E.updateOverlay = () => {
  overlay.innerHTML = '';
  const c = TZ.primaryClip();
  if (!c || c.type === 'audio' || c.type === 'adjust' || S.playing) return;
  if (S.playhead < c.start || S.playhead >= c.start + c.dur) return;
  const g = R.clipGeom(c, S.playhead); if (!g) return;
  const cr = pc.getBoundingClientRect(), vr = view.getBoundingClientRect();
  const sc = cr.width / S.seq.width;
  overlay.style.left = (cr.left - vr.left) + 'px'; overlay.style.top = (cr.top - vr.top) + 'px';
  overlay.style.width = cr.width + 'px'; overlay.style.height = cr.height + 'px';
  const box = TZ.h('div', { class: 'bbox' });
  Object.assign(box.style, { left: ((g.cx + g.x0) * sc) + 'px', top: ((g.cy + g.y0) * sc) + 'px', width: (g.w * sc) + 'px', height: (g.h * sc) + 'px', transformOrigin: (-g.x0 * sc) + 'px ' + (-g.y0 * sc) + 'px', transform: `rotate(${g.rot}rad)` });
  [[0, 0], [50, 0], [100, 0], [0, 50], [100, 50], [0, 100], [50, 100], [100, 100]].forEach(([x, y]) => box.append(TZ.h('i', { style: { left: x + '%', top: y + '%' } })));
  overlay.append(box);
};

// direct manipulation in program monitor
pc.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || S.playing) return;
  const r = pc.getBoundingClientRect();
  const sx = (e.clientX - r.left) / r.width * S.seq.width, sy = (e.clientY - r.top) / r.height * S.seq.height;
  let c = TZ.primaryClip();
  const inClip = c && c.type !== 'audio' && S.playhead >= c.start && S.playhead < c.start + c.dur;
  let g = inClip ? R.clipGeom(c, S.playhead) : null;
  // corner handle -> scale
  let mode = 'move';
  if (g) {
    const dx = sx - g.cx, dy = sy - g.cy, cs = Math.cos(-g.rot), sn = Math.sin(-g.rot);
    const lx = dx * cs - dy * sn, ly = dx * sn + dy * cs;
    const hs = 14 / (r.width / S.seq.width);
    const corners = [[g.x0, g.y0], [g.x0 + g.w, g.y0], [g.x0, g.y0 + g.h], [g.x0 + g.w, g.y0 + g.h]];
    if (corners.some(([x, y]) => Math.abs(lx - x) < hs && Math.abs(ly - y) < hs)) mode = 'scale';
    else if (!(lx >= g.x0 && lx <= g.x0 + g.w && ly >= g.y0 && ly <= g.y0 + g.h)) g = null;
  }
  if (!g) {
    const hit = R.hitTest(S.playhead, sx, sy);
    if (!hit) { return; }
    c = hit; S.selection.clear(); S.selection.add(c.id); TZ.emit('sel');
    g = R.clipGeom(c, S.playhead);
  }
  const lt = S.playhead - c.start;
  const ox = TZ.propAt(c, 'posX', lt), oy = TZ.propAt(c, 'posY', lt), os = TZ.propAt(c, 'scale', lt);
  const d0 = Math.hypot(sx - ox, sy - oy) || 1;
  pc.setPointerCapture(e.pointerId);
  let moved = false;
  const mv = (ev) => {
    const nx = (ev.clientX - r.left) / r.width * S.seq.width, ny = (ev.clientY - r.top) / r.height * S.seq.height;
    if (mode === 'move') {
      let px = ox + (nx - sx), py = oy + (ny - sy);
      if (!ev.shiftKey) { // snap to centre
        if (Math.abs(px - S.seq.width / 2) < 12) px = S.seq.width / 2;
        if (Math.abs(py - S.seq.height / 2) < 12) py = S.seq.height / 2;
      }
      TZ.setProp(c, 'posX', Math.round(px * 10) / 10, lt); TZ.setProp(c, 'posY', Math.round(py * 10) / 10, lt);
    } else {
      const d = Math.hypot(nx - ox, ny - oy);
      TZ.setProp(c, 'scale', Math.max(1, Math.round(os * d / d0 * 10) / 10), lt);
    }
    moved = true;
    E.requestRender(); TZ.emit('props');
  };
  const up = () => { pc.removeEventListener('pointermove', mv); pc.removeEventListener('pointerup', up); if (moved) TZ.commit(mode === 'move' ? 'Pozycja' : 'Skala'); };
  pc.addEventListener('pointermove', mv); pc.addEventListener('pointerup', up);
});
pc.addEventListener('dblclick', () => { TZ.ui && TZ.ui.showTab('right', 'props'); });

/* ---------- transport ---------- */
let startT = 0, startPerf = 0, raf = 0, playToken = 0;
E.play = async (rate = 1) => {
  resumeAudio();
  const end = TZ.seqDuration();
  if (!S.playing && rate > 0 && S.playhead >= end - 1e-3) S.playhead = S.loop && S.seq.inPoint != null ? S.seq.inPoint : 0;
  const wasPlaying = S.playing;
  E.rate = rate;
  if (!wasPlaying && rate > 0 && !E.frameHook) {
    // pre-roll: seek every active decoder and wait (max 350 ms) so playback starts smoothly
    const tok = ++playToken;
    S.playing = true; TZ.emit('playstate');
    E.sync(S.playhead, false);
    const t0 = performance.now();
    while (performance.now() - t0 < 3000) {
      const busy = E.activeElements().some(e => { const c = TZ.clipById(e.clipId); if (!c) return false; const [ws, we] = R.clipWindow(c); return S.playhead >= ws && S.playhead < we && (e.el.seeking || e.el.readyState < 3); });
      if (busy && performance.now() - t0 > 250) TZ.status('Buforowanie…');
      if (!busy) break;
      await new Promise(r => setTimeout(r, 15));
      if (tok !== playToken || !S.playing) return;
    }
    if (tok !== playToken || !S.playing) return;
    startT = S.playhead; startPerf = performance.now();
    E.sync(S.playhead, true);
    raf = requestAnimationFrame(tick);
    return;
  }
  startT = S.playhead; startPerf = performance.now();
  if (!wasPlaying) { S.playing = true; TZ.emit('playstate'); raf = requestAnimationFrame(tick); }
};
E.stop = () => {
  playToken++;
  if (!S.playing) return;
  S.playing = false; E.rate = 1; cancelAnimationFrame(raf);
  for (const e of E.activeElements()) { if (!e.el.paused) e.el.pause(); if (e.kind === 'a') e.gain.gain.setTargetAtTime(0, actx.currentTime, 0.01); }
  S.playhead = TZ.snapFrame(S.playhead);
  if (TZ.settings.previewQuality === 'auto' && E.quality !== 1) { E.quality = 1; E.layoutProgram(); }
  TZ.emit('playstate'); TZ.emit('time'); E.requestRender();
};
E.toggle = () => S.playing ? E.stop() : E.play();
E.shuttle = (dir) => {
  if (dir === 0) { E.stop(); return; }
  if (!S.playing) { E.play(dir); return; }
  if (Math.sign(E.rate) !== dir) E.play(dir);
  else E.play(TZ.clamp(E.rate * 2, -8, 8));
  TZ.status('Szybkość odtwarzania: ' + E.rate + 'x');
};
let frameAvg = 0;
function tick() {
  if (!S.playing) return;
  let t = startT + (performance.now() - startPerf) / 1000 * E.rate;
  const end = E.endLimit ? E.endLimit() : (S.loop && S.seq.outPoint != null ? S.seq.outPoint : TZ.seqDuration());
  if (E.rate > 0 && t >= end) {
    if (S.loop && !E.frameHook) { const st = S.seq.inPoint != null ? S.seq.inPoint : 0; S.playhead = st; startT = st; startPerf = performance.now(); t = st; }
    else { S.playhead = end; if (E.frameHook) { const fh = E.frameHook; fh(end, true); } E.stop(); return; }
  }
  if (t < 0) { S.playhead = 0; E.stop(); return; }
  const syn = E.sync(t, E.rate > 0);
  if (syn && syn.stalled && E.rate > 0 && !E.frameHook) {
    // decoder is seeking/buffering: hold the clock instead of running away (prevents black/jerky playback)
    const now = performance.now();
    if (E._stallSince == null) E._stallSince = now;
    if (now - E._stallSince < 4000) {
      startT = S.playhead; startPerf = now; t = S.playhead;
      if (now - E._stallSince > 120) for (const e of E.activeElements()) if (e.kind === 'a' && !e.el.paused) e.el.pause();
    }
  } else E._stallSince = null;
  S.playhead = t;
  const f0 = performance.now();
  if (E.frameHook) E.frameHook(t, false); else E.renderProgram();
  frameAvg = frameAvg * 0.9 + (performance.now() - f0) * 0.1;
  if (!E.frameHook && TZ.settings.previewQuality === 'auto') {
    if (frameAvg > 22 && E.quality > 0.25) { E.quality = E.quality > 0.5 ? 0.5 : 0.25; frameAvg = 10; E.layoutProgram(); }
  }
  E.fps = E.fps ? E.fps * 0.95 + 0.05 * (1000 / Math.max(1, performance.now() - (E._lastTick || performance.now()))) : 30;
  E._lastTick = performance.now();
  TZ.emit('time');
  raf = requestAnimationFrame(tick);
}
E.seek = (t, keepPlaying) => {
  t = Math.max(0, t);
  if (S.playing && !keepPlaying) E.stop();
  S.playhead = S.playing ? t : TZ.snapFrame(t);
  if (S.playing) { startT = t; startPerf = performance.now(); }
  TZ.emit('time'); E.requestRender();
};
E.step = (n) => E.seek(TZ.snapFrame(S.playhead) + n / S.seq.fps);

/* ---------- meters ---------- */
const mc = TZ.$('#meterCanvas'), mx = mc.getContext('2d');
const buf = new Float32Array(1024);
let peakL = -60, peakR = -60, holdL = -60, holdR = -60, holdTL = 0, holdTR = 0;
E.meterLevels = () => [peakL, peakR];
function meterLoop() {
  const level = (an) => { an.getFloatTimeDomainData(buf); let m = 0; for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i]); if (v > m) m = v; } return TZ.gainToDb(m); };
  const l = level(anL), r = level(anR);
  peakL = l > peakL ? l : Math.max(-60, peakL - 1.2); peakR = r > peakR ? r : Math.max(-60, peakR - 1.2);
  const now = performance.now();
  if (peakL > holdL || now - holdTL > 1500) { holdL = peakL; holdTL = now; }
  if (peakR > holdR || now - holdTR > 1500) { holdR = peakR; holdTR = now; }
  const rect = mc.getBoundingClientRect();
  const W = Math.round(rect.width), Hh = Math.round(rect.height);
  if (W > 0 && Hh > 0) {
    if (mc.width !== W || mc.height !== Hh) { mc.width = W; mc.height = Hh; }
    mx.clearRect(0, 0, W, Hh);
    const y = db => Hh * (-db / 60);
    mx.fillStyle = '#888'; mx.font = '9px Segoe UI'; mx.textAlign = 'left';
    for (let d = 0; d >= -54; d -= 6) { mx.fillText(String(d), 31, Math.max(8, y(d) + 3)); mx.fillRect(26, y(d), 3, 1); }
    const bar = (x, pk, hd) => {
      mx.fillStyle = '#151515'; mx.fillRect(x, 0, 9, Hh);
      const g = mx.createLinearGradient(0, Hh, 0, 0);
      g.addColorStop(0, '#1d9f4a'); g.addColorStop(0.7, '#2fd25f'); g.addColorStop(0.85, '#e7d73a'); g.addColorStop(1, '#e33b2f');
      mx.fillStyle = g; const yy = y(Math.min(0, pk)); mx.fillRect(x, yy, 9, Hh - yy);
      mx.fillStyle = hd > -1 ? '#ff4040' : '#ddd'; mx.fillRect(x, y(Math.min(0, hd)), 9, 1.5);
    };
    bar(3, peakL, holdL); bar(14, peakR, holdR);
  }
  requestAnimationFrame(meterLoop);
}
requestAnimationFrame(meterLoop);

/* ---------- scopes ---------- */
const scC = TZ.$('#scopeCanvas'), scx = scC.getContext('2d');
const tiny = document.createElement('canvas'); const tx = tiny.getContext('2d', { willReadFrequently: true });
let lastScope = 0;
function scopesTick(force) {
  const page = TZ.$('#scopesPage');
  if (!page.classList.contains('active')) return;
  const now = performance.now();
  if (!force && now - lastScope < (S.playing ? 120 : 30)) return;
  lastScope = now;
  const mode = TZ.$('#scopeMode').value;
  const rect = scC.getBoundingClientRect();
  const W = Math.max(50, Math.round(rect.width)), Hh = Math.max(50, Math.round(rect.height));
  if (scC.width !== W || scC.height !== Hh) { scC.width = W; scC.height = Hh; }
  const tw = 256, th = Math.round(256 * pc.height / pc.width);
  tiny.width = tw; tiny.height = th; tx.drawImage(pc, 0, 0, tw, th);
  const d = tx.getImageData(0, 0, tw, th).data;
  scx.fillStyle = '#000'; scx.fillRect(0, 0, W, Hh);
  scx.strokeStyle = '#2a2a2a'; scx.fillStyle = '#666'; scx.font = '9px Segoe UI';
  if (mode === 'histogram') {
    const hr = new Uint32Array(256), hg = new Uint32Array(256), hb = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 4) { hr[d[i]]++; hg[d[i + 1]]++; hb[d[i + 2]]++; }
    let mxv = 1; for (let i = 2; i < 254; i++) mxv = Math.max(mxv, hr[i], hg[i], hb[i]);
    scx.globalCompositeOperation = 'lighter';
    [[hr, 'rgba(255,60,60,.8)'], [hg, 'rgba(60,255,60,.8)'], [hb, 'rgba(60,120,255,.8)']].forEach(([a, col]) => {
      scx.fillStyle = col; scx.beginPath(); scx.moveTo(0, Hh);
      for (let i = 0; i < 256; i++) scx.lineTo(i / 255 * W, Hh - Math.min(1, a[i] / mxv) * (Hh - 10));
      scx.lineTo(W, Hh); scx.fill();
    });
    scx.globalCompositeOperation = 'source-over';
  } else if (mode === 'vector') {
    const cx = W / 2, cy = Hh / 2, rad = Math.min(W, Hh) / 2 - 10;
    scx.strokeStyle = '#333'; scx.beginPath(); scx.arc(cx, cy, rad, 0, 7); scx.stroke();
    scx.beginPath(); scx.moveTo(cx - rad, cy); scx.lineTo(cx + rad, cy); scx.moveTo(cx, cy - rad); scx.lineTo(cx, cy + rad); scx.stroke();
    scx.fillStyle = 'rgba(120,255,140,.35)';
    for (let i = 0; i < d.length; i += 8) {
      const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
      const cb = -0.1687 * r - 0.3313 * g + 0.5 * b, cr = 0.5 * r - 0.4187 * g - 0.0813 * b;
      scx.fillRect(cx + cb * rad * 1.8, cy - cr * rad * 1.8, 1, 1);
    }
  } else {
    const parade = mode === 'parade';
    for (let v = 0; v <= 100; v += 10) { const y = Hh - 6 - v / 100 * (Hh - 12); scx.fillStyle = '#2a2a2a'; scx.fillRect(0, y, W, 1); scx.fillStyle = '#666'; scx.fillText(String(v), 2, y - 1); }
    const img = scx.getImageData(0, 0, W, Hh); const o = img.data;
    const plot = (x, val, r, g, b) => {
      const y = Math.round(Hh - 6 - val / 255 * (Hh - 12)); const xi = Math.round(x);
      if (xi < 0 || xi >= W || y < 0 || y >= Hh) return;
      const k = (y * W + xi) * 4; o[k] = Math.min(255, o[k] + r); o[k + 1] = Math.min(255, o[k + 1] + g); o[k + 2] = Math.min(255, o[k + 2] + b);
    };
    for (let yy = 0; yy < th; yy++) for (let xx = 0; xx < tw; xx++) {
      const i = (yy * tw + xx) * 4;
      if (parade) {
        const seg = W / 3;
        plot(xx / tw * seg, d[i], 70, 14, 14); plot(seg + xx / tw * seg, d[i + 1], 14, 70, 14); plot(2 * seg + xx / tw * seg, d[i + 2], 18, 30, 80);
      } else {
        const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        plot(xx / tw * W, l, 30, 60, 30);
      }
    }
    scx.putImageData(img, 0, 0);
  }
}
E.scopesTick = scopesTick;
TZ.$('#scopeMode').addEventListener('change', () => scopesTick(true));

/* ---------- source monitor ---------- */
const SM = E.source = { media: null, el: null, playing: false };
const sc = TZ.$('#srcCanvas'), sctx = sc.getContext('2d');
SM.open = (m) => {
  if (SM.el) { SM.el.pause(); SM.el.removeAttribute('src'); SM.el.load(); SM.el.remove(); }
  SM.media = m; SM.el = null;
  TZ.$('#srcName').textContent = m ? m.name : '(brak klipów)';
  TZ.$('#srcEmpty').style.display = m ? 'none' : '';
  if (!m) { sctx.clearRect(0, 0, sc.width, sc.height); return; }
  if (m.srcIn == null) { m.srcIn = null; m.srcOut = null; }
  if (m.type === 'video' || m.type === 'audio') {
    const el = document.createElement(m.type === 'video' ? 'video' : 'audio');
    el.preload = 'auto'; el.src = m.url; el.crossOrigin = 'anonymous';
    holder.append(el);
    SM.el = el;
    el.addEventListener('seeked', SM.draw); el.addEventListener('loadeddata', SM.draw);
    el.addEventListener('timeupdate', SM.updateUI);
    el.addEventListener('pause', () => { SM.playing = false; SM.updateUI(); });
  }
  if (m.type === 'video') { sc.width = m.width || 1280; sc.height = m.height || 720; }
  else { sc.width = 960; sc.height = 540; }
  SM.draw(); SM.updateUI();
  TZ.ui && TZ.ui.showTab('lefttop', 'source');
};
SM.time = () => SM.el ? SM.el.currentTime : 0;
SM.dur = () => SM.media ? SM.media.duration : 0;
SM.draw = () => {
  const m = SM.media; if (!m) return;
  sctx.fillStyle = '#000'; sctx.fillRect(0, 0, sc.width, sc.height);
  if (m.type === 'image' && m.img) { const f = Math.min(sc.width / m.width, sc.height / m.height); sctx.drawImage(m.img, (sc.width - m.width * f) / 2, (sc.height - m.height * f) / 2, m.width * f, m.height * f); }
  else if (m.type === 'video' && SM.el && SM.el.readyState >= 2) sctx.drawImage(SM.el, 0, 0, sc.width, sc.height);
  else if (m.type === 'audio') {
    sctx.fillStyle = '#0c1a14'; sctx.fillRect(0, 0, sc.width, sc.height);
    if (m.peaks) {
      sctx.fillStyle = '#2fb07e'; const n = m.peaks.length, mid = sc.height / 2;
      for (let x = 0; x < sc.width; x++) { const a = m.peaks[Math.floor(x / sc.width * n)] || 0; sctx.fillRect(x, mid - a * mid * 0.9, 1, a * mid * 1.8 + 1); }
      const px = SM.time() / (m.duration || 1) * sc.width; sctx.fillStyle = '#4aa3ff'; sctx.fillRect(px, 0, 2, sc.height);
    }
  }
  SM.updateUI();
};
SM.updateUI = () => {
  const m = SM.media; const d = SM.dur() || 1, t = SM.time();
  TZ.$('#srcTC').textContent = TZ.fmtTC(t, S.seq.fps);
  const io = (m && (m.srcOut != null ? m.srcOut : d) - (m.srcIn || 0)) || 0;
  TZ.$('#srcDur').textContent = TZ.fmtTC(m ? io : 0, S.seq.fps);
  TZ.$('#srcPH').style.left = (t / d * 100) + '%';
  const ioEl = TZ.$('#srcInOut');
  if (m && (m.srcIn != null || m.srcOut != null)) { const a = (m.srcIn || 0) / d * 100, b = (m.srcOut != null ? m.srcOut : d) / d * 100; ioEl.style.display = 'block'; ioEl.style.left = a + '%'; ioEl.style.width = (b - a) + '%'; }
  else ioEl.style.display = 'none';
  TZ.$('#sourcePage .play use').setAttribute('href', SM.playing ? '#i-pause' : '#i-play');
};
let srcRaf = 0;
const srcLoop = () => { if (!SM.playing) return; SM.draw(); if (SM.media && SM.media.srcOut != null && SM.el.currentTime >= SM.media.srcOut) { SM.el.pause(); } srcRaf = requestAnimationFrame(srcLoop); };
SM.toggle = () => {
  if (!SM.el) return;
  if (SM.playing) { SM.el.pause(); SM.playing = false; }
  else { if (S.playing) E.stop(); SM.el.play().catch(() => {}); SM.playing = true; srcLoop(); }
  SM.updateUI();
};
SM.seek = (t) => { if (!SM.el) return; SM.el.currentTime = TZ.clamp(t, 0, SM.dur()); SM.updateUI(); };
SM.step = (n) => SM.seek(SM.time() + n / S.seq.fps);
const srcScrub = TZ.$('#srcScrub');
srcScrub.addEventListener('pointerdown', e => {
  if (!SM.el) return;
  const r = srcScrub.getBoundingClientRect();
  const go = ev => SM.seek(TZ.clamp((ev.clientX - r.left) / r.width, 0, 1) * SM.dur());
  go(e); srcScrub.setPointerCapture(e.pointerId);
  srcScrub.onpointermove = go; srcScrub.onpointerup = () => { srcScrub.onpointermove = null; };
});
TZ.$$('#sourcePage [data-src]').forEach(b => b.addEventListener('click', () => {
  const a = b.dataset.src, m = SM.media; if (!m) return;
  if (a === 'play') SM.toggle();
  else if (a === 'mark-in') { m.srcIn = SM.time(); if (m.srcOut != null && m.srcOut <= m.srcIn) m.srcOut = null; SM.updateUI(); }
  else if (a === 'mark-out') { m.srcOut = SM.time(); if (m.srcIn != null && m.srcIn >= m.srcOut) m.srcIn = null; SM.updateUI(); }
  else if (a === 'go-in') SM.seek(m.srcIn || 0);
  else if (a === 'go-out') SM.seek(m.srcOut != null ? m.srcOut : SM.dur());
  else if (a === 'step-b') SM.step(-1);
  else if (a === 'step-f') SM.step(1);
  else if (a === 'insert' || a === 'overwrite') TZ.tl.sourceEdit(m, a);
}));
// drag from source monitor to timeline
sc.draggable = true;
sc.addEventListener('dragstart', e => { if (!SM.media) { e.preventDefault(); return; } e.dataTransfer.setData('text/tz-media', JSON.stringify([SM.media.id])); e.dataTransfer.setData('text/tz-source', '1'); e.dataTransfer.effectAllowed = 'copy'; });

/* ---------- program transport UI ---------- */
const progScrub = TZ.$('#progScrub');
progScrub.addEventListener('pointerdown', e => {
  const r = progScrub.getBoundingClientRect();
  const dur = Math.max(TZ.seqDuration(), 1);
  const go = ev => E.seek(TZ.clamp((ev.clientX - r.left) / r.width, 0, 1) * dur);
  go(e); progScrub.setPointerCapture(e.pointerId);
  progScrub.onpointermove = go; progScrub.onpointerup = () => { progScrub.onpointermove = null; };
});
TZ.on('time', () => {
  const dur = Math.max(TZ.seqDuration(), 1), fps = S.seq.fps;
  TZ.$('#progTC').textContent = TZ.fmtTC(S.playhead, fps);
  TZ.$('#tlTC').textContent = TZ.fmtTC(S.playhead, fps);
  TZ.$('#progPH').style.left = TZ.clamp(S.playhead / dur * 100, 0, 100) + '%';
  TZ.$('#progDur').textContent = TZ.fmtTC(S.seq.inPoint != null || S.seq.outPoint != null ? (S.seq.outPoint != null ? S.seq.outPoint : TZ.seqDuration()) - (S.seq.inPoint || 0) : TZ.seqDuration(), fps);
  const io = TZ.$('#progInOut');
  if (S.seq.inPoint != null || S.seq.outPoint != null) { const a = (S.seq.inPoint || 0) / dur * 100, b = (S.seq.outPoint != null ? S.seq.outPoint : dur) / dur * 100; io.style.display = 'block'; io.style.left = a + '%'; io.style.width = Math.max(0, b - a) + '%'; }
  else io.style.display = 'none';
});
TZ.on('playstate', () => {
  TZ.$('#progMonitor .play use').setAttribute('href', S.playing ? '#i-pause' : '#i-play');
  E.updateOverlay();
});
TZ.on('seq', () => { E.layoutProgram(); E.requestRender(); TZ.emit('time'); });
TZ.on('props', () => E.requestRender());
TZ.on('sel', () => E.updateOverlay());
new ResizeObserver(() => E.layoutProgram()).observe(view);
TZ.$('#progZoom').addEventListener('change', e => { E.zoom = e.target.value; E.layoutProgram(); });
})();
