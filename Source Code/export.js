'use strict';
/* ==========================================================
   Export 26.1
   • TopaZ GPU engine: WebCodecs hardware decode (AMD/NVIDIA/Intel)
     → WebGL compositor → WebCodecs hardware encode (AMF/NVENC/QSV)
     → streaming MP4 muxer.   Frame-accurate and many × real time.
   • Native C++ engine (Media Foundation) – same fast decode path
   • Real-time recorder (fallback / WebM)
   • WAV audio, PNG/JPG frame
   ========================================================== */
(() => {
const S = TZ.state, R = TZ.render, E = TZ.engine, h = TZ.h, N = window.native || null;
const X = TZ.exporter = { engineInfo: 'sprawdzanie…', engineOK: false, busy: false, caps: {} };
if (N && N.engineInfo) N.engineInfo().then(i => { X.engineOK = !!(i && i.path); X.engineInfo = X.engineOK ? 'TopazMediaEngine ' + (i.version || '') + ' (Media Foundation)' : 'niedostępny'; TZ.panels && TZ.panels.renderInfo(); });
else X.engineInfo = 'niedostępny (tryb przeglądarki)';

/* ---------- presets ---------- */
const RES = [
  ['seq', 'Zgodnie z sekwencją'], ['7680x4320', '8K UHD – 7680×4320'], ['3840x2160', '4K UHD – 3840×2160'], ['4096x2160', '4K DCI – 4096×2160'],
  ['2560x1440', '2K QHD (1440p) – 2560×1440'], ['2048x1080', '2K DCI – 2048×1080'], ['1920x1080', 'Full HD (1080p) – 1920×1080'], ['1280x720', 'HD (720p) – 1280×720'],
  ['960x540', 'qHD (540p) – 960×540'], ['854x480', 'SD (480p) – 854×480'],
  ['2160x3840', 'Pionowe 4K – 2160×3840'], ['1440x2560', 'Pionowe 2K – 1440×2560'], ['1080x1920', 'Pionowe Full HD – 1080×1920'], ['720x1280', 'Pionowe HD – 720×1280'],
  ['2160x2160', 'Kwadrat 4K – 2160×2160'], ['1080x1080', 'Kwadrat – 1080×1080'], ['1080x1350', 'Instagram 4:5 – 1080×1350'], ['2560x1080', 'Ultrawide 21:9 – 2560×1080'], ['custom', 'Niestandardowa…']
];
const PLATFORMS = [
  { id: 'none', name: '— Własne ustawienia —' },
  { id: 'yt4k', name: 'YouTube 4K (2160p)', res: '3840x2160', q: 'vhigh', codec: 'h264' },
  { id: 'yt1440', name: 'YouTube 2K (1440p)', res: '2560x1440', q: 'vhigh', codec: 'h264' },
  { id: 'yt1080', name: 'YouTube Full HD (1080p)', res: '1920x1080', q: 'high', codec: 'h264' },
  { id: 'tiktok', name: 'TikTok / Instagram Reels / YouTube Shorts', res: '1080x1920', q: 'high', codec: 'h264' },
  { id: 'insta', name: 'Instagram – post kwadratowy', res: '1080x1080', q: 'high', codec: 'h264' },
  { id: 'insta45', name: 'Instagram – post 4:5', res: '1080x1350', q: 'high', codec: 'h264' },
  { id: 'fb', name: 'Facebook 1080p', res: '1920x1080', q: 'medium', codec: 'h264' },
  { id: 'x', name: 'X (Twitter) 1080p', res: '1920x1080', q: 'medium', codec: 'h264' },
  { id: 'discord', name: 'Discord (do 10 MB)', res: '1280x720', target: 9.5, codec: 'h264' },
  { id: 'discord50', name: 'Discord Nitro (do 50 MB)', res: '1920x1080', target: 48, codec: 'h264' },
  { id: 'archive', name: 'Archiwum – maksymalna jakość (H.265)', res: 'seq', q: 'max', codec: 'hevc' }
];
const QUALITY = [['low', 'Niska', 0.06], ['medium', 'Średnia', 0.1], ['high', 'Wysoka', 0.16], ['vhigh', 'Bardzo wysoka', 0.25], ['max', 'Maksymalna', 0.4], ['custom', 'Własna szybkość transmisji', 0]];
const FPS = [['seq', 'Zgodnie z sekwencją'], [23.976, '23,976'], [24, '24'], [25, '25'], [29.97, '29,97'], [30, '30'], [50, '50'], [59.94, '59,94'], [60, '60'], [120, '120']];
const cfg = X.cfg = { name: '', folder: '', format: 'mp4', codec: 'h264', res: 'seq', w: 1920, h: 1080, fps: 'seq', quality: 'high', br: 16, brMode: 'variable', keyInt: 2, abr: 192, asr: 48000, range: 'all', engine: TZ.settings.exportEngine || 'gpu', openAfter: true, platform: 'none', target: 0 };

const even = n => { n = Math.max(2, Math.round(n)); return n % 2 ? n + 1 : n; };
function outputSize() {
  if (cfg.res === 'seq') return [even(S.seq.width), even(S.seq.height)];
  if (cfg.res === 'custom') return [even(cfg.w), even(cfg.h)];
  const [a, b] = cfg.res.split('x').map(Number); return [a, b];
}
const outFps = () => cfg.fps === 'seq' ? S.seq.fps : +cfg.fps;
function range() {
  const end = TZ.seqDuration();
  if (cfg.range === 'io' && (S.seq.inPoint != null || S.seq.outPoint != null)) return [S.seq.inPoint || 0, S.seq.outPoint != null ? S.seq.outPoint : end];
  return [0, end];
}
function bitrateMbps() {
  const [w, hh] = outputSize(), f = outFps();
  if (cfg.target > 0) { const [a, b] = range(); const d = Math.max(0.5, b - a); return Math.max(0.2, (cfg.target * 8 / d) - cfg.abr / 1000); }
  if (cfg.quality === 'custom') return cfg.br;
  const q = QUALITY.find(x => x[0] === cfg.quality) || QUALITY[2];
  let bpp = q[2]; if (cfg.codec === 'hevc' || cfg.codec === 'av1') bpp *= 0.62;
  return Math.max(0.5, Math.round(w * hh * Math.min(f, 60) * bpp / 1e5) / 10);
}
const extFor = f => ({ mp4: 'mp4', webm: 'webm', wav: 'wav', png: 'png', jpg: 'jpg' })[f] || 'mp4';
function fpsRatio(f) { const t = [[23.976, 24000, 1001], [29.97, 30000, 1001], [59.94, 60000, 1001], [47.952, 48000, 1001], [119.88, 120000, 1001]]; for (const [x, nn, d] of t) if (Math.abs(f - x) < 0.01) return [nn, d]; return [Math.round(f * 1000), 1000]; }
function h264Level(w, hh, f) { const mbs = Math.ceil(w / 16) * Math.ceil(hh / 16), rate = mbs * f; if (mbs <= 8192 && rate <= 245760) return 0x28; if (mbs <= 8704 && rate <= 522240) return 0x2a; if (mbs <= 22080 && rate <= 589824) return 0x32; if (mbs <= 36864 && rate <= 983040) return 0x33; if (mbs <= 36864 && rate <= 2073600) return 0x34; if (mbs <= 139264 && rate <= 4177920) return 0x3c; return 0x3e; }
function codecString(codec, w, hh, f) {
  if (codec === 'hevc') { const px = w * hh * f; const lvl = px <= 2228224 * 30 ? 123 : px <= 8912896 * 30 ? 153 : px <= 8912896 * 60 ? 156 : 183; return `hvc1.1.6.L${lvl}.B0`; }
  if (codec === 'av1') { const px = w * hh; const lvl = px <= 2228224 ? (f > 30 ? 9 : 8) : px <= 8912896 ? (f > 30 ? 13 : 12) : 16; return `av01.0.${String(lvl).padStart(2, '0')}M.08`; }
  return 'avc1.6400' + h264Level(w, hh, f).toString(16).toUpperCase().padStart(2, '0');
}
X.codecString = codecString;

/* ---------- capability detection ---------- */
X.detectCaps = async () => {
  if (!window.VideoEncoder) { X.caps = {}; return X.caps; }
  const [w, hh] = outputSize(), f = outFps();
  const res = {};
  for (const c of ['h264', 'hevc', 'av1']) {
    const base = { codec: codecString(c, w, hh, f), width: w, height: hh, bitrate: 8e6, framerate: f };
    if (c === 'h264') base.avc = { format: 'avc' }; if (c === 'hevc') base.hevc = { format: 'hevc' };
    const hw = await VideoEncoder.isConfigSupported(Object.assign({}, base, { hardwareAcceleration: 'prefer-hardware' })).then(r => r.supported).catch(() => false);
    const any = hw || await VideoEncoder.isConfigSupported(Object.assign({}, base, { hardwareAcceleration: 'no-preference' })).then(r => r.supported).catch(() => false);
    res[c] = { hw, any };
  }
  res.aac = window.AudioEncoder ? await AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 }).then(r => r.supported).catch(() => false) : false;
  res.opus = window.AudioEncoder ? await AudioEncoder.isConfigSupported({ codec: 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 }).then(r => r.supported).catch(() => false) : false;
  X.caps = res;
  return res;
};

/* ---------- workspace UI ---------- */
let previewT = 0;
X.buildWorkspace = async () => {
  const box = TZ.$('#expSettings'); box.innerHTML = '';
  if (!cfg.name) cfg.name = S.seq.name || S.project.name;
  if (!cfg.folder && TZ.settings.exportFolder) cfg.folder = TZ.settings.exportFolder;
  if (!cfg.folder && N) { try { const ud = await N.userData(); cfg.folder = ud.replace(/[\\/]AppData[\\/].*$/i, '') + (ud.includes('\\') ? '\\Videos' : '/Videos'); } catch (e) {} }
  cfg.engine = cfg.engine || TZ.settings.exportEngine || 'gpu';
  await X.detectCaps();
  const caps = X.caps;
  const fld = (label, ctl, hint) => h('div', { class: 'fld' }, h('label', null, label), h('div', null, ctl, hint ? h('div', { class: 'pref-hint' }, hint) : ''));
  const stop = el => { el.addEventListener('keydown', e => e.stopPropagation()); return el; };
  const name = stop(h('input', { type: 'text', value: cfg.name })); name.oninput = () => { cfg.name = name.value; summary(); };
  const folder = stop(h('input', { type: 'text', value: cfg.folder, style: { flex: 1, minWidth: 0 } })); folder.oninput = () => cfg.folder = folder.value;
  const browse = h('button', { class: 'btn small', onclick: async () => { if (!N) return; const p = await N.saveDialog({ title: 'Wybierz lokalizację', defaultPath: (cfg.folder ? cfg.folder + '/' : '') + cfg.name + '.' + extFor(cfg.format) }); if (p) { const parts = p.split(/[\\/]/); const fn = parts.pop(); cfg.folder = parts.join(p.includes('\\') ? '\\' : '/'); cfg.name = fn.replace(/\.[^.]+$/, ''); folder.value = cfg.folder; name.value = cfg.name; summary(); } } }, 'Przeglądaj…');
  const lab = (c) => c && c.hw ? ' – sprzętowy (GPU)' : c && c.any ? ' – programowy (CPU)' : ' – niedostępny';
  const fmt = h('select', null,
    h('option', { value: 'mp4|h264' }, 'H.264 (MP4)' + lab(caps.h264)),
    h('option', { value: 'mp4|hevc', disabled: !(caps.hevc && caps.hevc.any) }, 'H.265 / HEVC (MP4)' + lab(caps.hevc)),
    h('option', { value: 'mp4|av1', disabled: !(caps.av1 && caps.av1.any) }, 'AV1 (MP4)' + lab(caps.av1)),
    h('option', { value: 'webm|vp9' }, 'VP9 (WebM) – w czasie rzeczywistym'),
    h('option', { value: 'wav|' }, 'Tylko audio – WAV'),
    h('option', { value: 'png|' }, 'Bieżąca klatka – PNG'),
    h('option', { value: 'jpg|' }, 'Bieżąca klatka – JPG'));
  fmt.value = cfg.format + '|' + (cfg.format === 'mp4' ? cfg.codec : cfg.format === 'webm' ? 'vp9' : '');
  fmt.onchange = () => { const [f, c] = fmt.value.split('|'); cfg.format = f; if (c) cfg.codec = c; vis(); summary(); };
  const plat = h('select', null, ...PLATFORMS.map(p => h('option', { value: p.id }, p.name))); plat.value = cfg.platform;
  const res = h('select', null, ...RES.map(([v, nm]) => h('option', { value: v }, nm))); res.value = cfg.res;
  const w = stop(h('input', { type: 'number', value: cfg.w, style: { width: '80px' } })), hh = stop(h('input', { type: 'number', value: cfg.h, style: { width: '80px' } }));
  const customRow = h('div', { class: 'row', style: { marginTop: '6px' } }, w, '×', hh);
  res.onchange = () => { cfg.res = res.value; cfg.platform = 'none'; plat.value = 'none'; vis(); summary(); drawPreview(); };
  w.oninput = () => { cfg.w = +w.value; summary(); }; hh.oninput = () => { cfg.h = +hh.value; summary(); };
  const fps = h('select', null, ...FPS.map(([v, nm]) => h('option', { value: String(v) }, nm))); fps.value = String(cfg.fps); fps.onchange = () => { cfg.fps = fps.value === 'seq' ? 'seq' : +fps.value; summary(); };
  const qual = h('select', null, ...QUALITY.map(([v, nm]) => h('option', { value: v }, nm))); qual.value = cfg.quality;
  const br = stop(h('input', { type: 'number', value: cfg.br, min: 0.5, max: 400, step: 0.5, style: { width: '80px' } }));
  const brInfo = h('span', { class: 'pref-hint' });
  qual.onchange = () => { cfg.quality = qual.value; cfg.target = 0; vis(); summary(); };
  br.oninput = () => { cfg.br = +br.value; summary(); };
  const brMode = h('select', null, h('option', { value: 'variable' }, 'VBR – zmienna (zalecana)'), h('option', { value: 'constant' }, 'CBR – stała')); brMode.value = cfg.brMode; brMode.onchange = () => cfg.brMode = brMode.value;
  const keyInt = h('select', null, ...[[0.5, 'co 0,5 s'], [1, 'co 1 s'], [2, 'co 2 s (zalecane)'], [5, 'co 5 s'], [10, 'co 10 s']].map(([v, nm]) => h('option', { value: v }, nm))); keyInt.value = String(cfg.keyInt); keyInt.onchange = () => cfg.keyInt = +keyInt.value;
  const abr = h('select', null, ...[96, 128, 160, 192, 256, 320].map(v => h('option', { value: v, selected: v === cfg.abr }, v + ' kb/s'))); abr.onchange = () => { cfg.abr = +abr.value; summary(); };
  const acodec = h('span', { class: 'pref-hint' }, caps.aac ? 'AAC-LC, 48 kHz stereo' : caps.opus ? 'Opus, 48 kHz stereo (koder AAC niedostępny)' : 'brak kodera audio');
  const rng = h('select', null, h('option', { value: 'all' }, 'Cała sekwencja'), h('option', { value: 'io' }, 'Od wejścia do wyjścia (I/O)')); rng.value = cfg.range; rng.onchange = () => { cfg.range = rng.value; summary(); };
  const eng = h('select', null, h('option', { value: 'gpu' }, 'TopaZ GPU – sprzętowe dekodowanie i kodowanie (najszybszy)'), h('option', { value: 'native', disabled: !X.engineOK }, 'Silnik C++ – Media Foundation' + (X.engineOK ? '' : ' (niedostępny)')), h('option', { value: 'realtime' }, 'W czasie rzeczywistym (podgląd)'));
  eng.value = cfg.engine; eng.onchange = () => { cfg.engine = eng.value; summary(); };
  const open = h('input', { type: 'checkbox', checked: cfg.openAfter }); open.onchange = () => cfg.openAfter = open.checked;
  plat.onchange = () => { const p = PLATFORMS.find(x => x.id === plat.value); cfg.platform = p.id; if (p.res) { cfg.res = p.res; res.value = p.res; } if (p.q) { cfg.quality = p.q; qual.value = p.q; cfg.target = 0; } if (p.target) { cfg.target = p.target; } if (p.codec) { cfg.codec = p.codec; cfg.format = 'mp4'; fmt.value = 'mp4|' + p.codec; } vis(); summary(); drawPreview(); };
  const vidBlock = h('div', null,
    h('h4', null, 'Wideo'), fld('Platforma', plat), fld('Rozdzielczość', h('div', null, res, customRow)), fld('Klatki na sekundę', fps),
    fld('Jakość', h('div', null, qual, h('div', { class: 'row', style: { marginTop: '6px' } }, br, 'Mb/s', brInfo))), fld('Tryb bitrate', brMode), fld('Klatki kluczowe', keyInt));
  const audBlock = h('div', null, h('h4', null, 'Audio'), fld('Szybkość audio', abr, null), h('div', { class: 'fld' }, h('label'), acodec));
  const engRow = fld('Silnik eksportu', eng, 'TopaZ GPU używa karty graficznej do dekodowania, efektów i kodowania.');
  const vis = () => {
    const isVid = cfg.format === 'mp4' || cfg.format === 'webm';
    vidBlock.style.display = isVid ? '' : 'none'; audBlock.style.display = cfg.format === 'png' || cfg.format === 'jpg' ? 'none' : '';
    engRow.style.display = cfg.format === 'mp4' ? '' : 'none';
    customRow.style.display = cfg.res === 'custom' ? '' : 'none';
    br.disabled = cfg.quality !== 'custom'; br.style.opacity = br.disabled ? 0.55 : 1;
  };
  X._refreshBr = () => { const v = bitrateMbps(); if (cfg.quality !== 'custom') br.value = v; brInfo.textContent = cfg.target ? `  (cel: ${cfg.target} MB)` : ''; };
  box.append(h('h3', null, 'Ustawienia eksportu'),
    fld('Nazwa pliku', name), fld('Lokalizacja', h('div', { class: 'row' }, folder, browse)), fld('Format', fmt), fld('Zakres', rng), engRow,
    vidBlock, audBlock, h('h4', null, 'Opcje'), h('label', { class: 'chk' }, open, 'Pokaż plik po zakończeniu eksportu'),
    h('div', { class: 'pref-card', style: { marginTop: '14px' } }, h('div', null, h('b', null, 'GPU: '), (R.gpuName || '?').replace(/^ANGLE \((.*)\)$/, '$1')), h('div', null, h('b', null, 'Kodery sprzętowe: '), ['h264', 'hevc', 'av1'].filter(c => caps[c] && caps[c].hw).map(c => ({ h264: 'H.264', hevc: 'H.265', av1: 'AV1' })[c]).join(', ') || 'brak (kodowanie na CPU)')));
  vis(); summary();
  const sc = TZ.$('#expScrub'); sc.oninput = () => { const [a, b] = range(); previewT = a + (b - a) * sc.value / 1000; drawPreview(); };
  previewT = S.playhead; sc.value = TZ.seqDuration() ? previewT / TZ.seqDuration() * 1000 : 0;
  drawPreview();
};
function summary() {
  const [a, b] = range(); const [w, hh] = outputSize();
  const dur = Math.max(0, b - a); const mb = bitrateMbps();
  X._refreshBr && X._refreshBr();
  const sizeMB = cfg.format === 'wav' ? dur * 48000 * 4 / 1e6 : (cfg.format === 'png' || cfg.format === 'jpg') ? 0 : dur * (mb * 1e6 + cfg.abr * 1e3) / 8 / 1e6;
  const el = TZ.$('#expSummary'); if (!el) return; el.innerHTML = '';
  const add = (k, v) => el.append(h('div', null, h('b', null, k), h('span', null, v)));
  add('Plik', (cfg.name || 'film') + '.' + extFor(cfg.format));
  add('Format', cfg.format === 'wav' ? 'WAV 48 kHz stereo' : (cfg.format === 'png' || cfg.format === 'jpg') ? `${cfg.format.toUpperCase()} ${w}×${hh}` : `${({ h264: 'H.264', hevc: 'H.265', av1: 'AV1', vp9: 'VP9' })[cfg.format === 'webm' ? 'vp9' : cfg.codec]} ${w}×${hh}, ${outFps()} kl./s, ${mb} Mb/s`);
  add('Czas trwania', TZ.fmtTC(dur, S.seq.fps));
  add('Szacowany rozmiar', sizeMB === 0 ? '—' : (sizeMB > 1000 ? (sizeMB / 1000).toFixed(2) + ' GB' : Math.max(0.1, sizeMB).toFixed(1) + ' MB'));
}
async function drawPreview() {
  const c = TZ.$('#expPreviewCanvas'); if (!c) return;
  const [w, hh] = outputSize(); const k = Math.min(960 / w, 540 / hh);
  c.width = Math.round(w * k); c.height = Math.round(hh * k);
  await prepareFrame(previewT);
  R.renderFrame(previewT, c.getContext('2d'), c.width, c.height);
  TZ.$('#expTC').textContent = TZ.fmtTC(previewT, S.seq.fps);
  E.requestRender();
}

/* ---------- frame-accurate element preparation (fallback for non-MP4 sources) ---------- */
async function prepareFrame(t, skip) {
  S.playhead = t;
  E.sync(t, false);
  const waitEls = () => {
    const ws = [];
    for (const c of S.seq.clips) {
      if (c.type !== 'video' || c.enabled === false || (skip && skip.has(c.id))) continue;
      const [a, b] = R.clipWindow(c); if (t < a || t >= b) continue;
      const el = E.videoEl(c); if (!el) continue;
      const want = E.srcTime(c, t);
      if (Math.abs(el.currentTime - want) > 0.5 / S.seq.fps && !el.seeking) el.currentTime = want;
      if (el.readyState < 2) ws.push(TZ.waitEvent(el, 'loadeddata', 'error', 8000).catch(() => {}));
      if (el.seeking) ws.push(TZ.waitEvent(el, 'seeked', 'error', 8000).catch(() => {}));
    }
    return ws;
  };
  let ws = waitEls(); if (ws.length) await Promise.all(ws);
  ws = waitEls(); if (ws.length) await Promise.all(ws);
}
X.prepareFrame = prepareFrame;

/* ---------- offline audio mix ---------- */
const decoded = new Map();
async function decodeMedia(m, ctx) {
  if (decoded.has(m.id)) return decoded.get(m.id);
  const ab = await ctx.decodeAudioData(await (await fetch(m.url)).arrayBuffer());
  decoded.set(m.id, ab); return ab;
}
X.renderAudio = async (start, end, sr = 48000, onProgress) => {
  const len = Math.max(1, Math.ceil((end - start) * sr));
  const oc = new OfflineAudioContext(2, len, sr);
  const master = oc.createGain(); master.gain.value = TZ.dbToGain(S.seq.masterVolume || 0); master.connect(oc.destination);
  const anySolo = TZ.audioTracks().some(t => t.solo);
  const tnodes = {};
  for (const tr of TZ.audioTracks()) { const g = oc.createGain(); g.gain.value = (tr.muted || (anySolo && !tr.solo)) ? 0 : TZ.dbToGain(tr.volume || 0); g.connect(master); tnodes[tr.id] = g; }
  const clips = S.seq.clips.filter(c => c.type === 'audio' && c.enabled !== false && tnodes[c.track]);
  let i = 0, any = false;
  for (const c of clips) {
    i++; if (onProgress) onProgress(i / clips.length);
    const m = TZ.mediaById(c.mediaId); if (!m || m.missing) continue;
    const tclips = S.seq.clips.filter(x => x.track === c.track && x.enabled !== false);
    const [ws, we] = R.clipWindow(c, tclips);
    const s = Math.max(ws, start), e = Math.min(we, end);
    if (e <= s) continue;
    let buf; try { buf = await decodeMedia(m, oc); } catch (er) { console.warn('decode', er); continue; }
    any = true;
    const src = oc.createBufferSource(); src.buffer = buf; src.playbackRate.value = c.speed;
    const chain = E.buildChain(c.effects, oc);
    const g = oc.createGain(); const pan = oc.createStereoPanner(); pan.pan.value = TZ.clamp((c.props.pan || 0) / 100, -1, 1);
    src.connect(chain.input); chain.output.connect(g); g.connect(pan); pan.connect(tnodes[c.track]);
    const nn = Math.max(2, Math.ceil((e - s) * 100)); const curve = new Float32Array(nn);
    for (let k = 0; k < nn; k++) curve[k] = E.clipGainAt(c, s + k / (nn - 1) * (e - s), tclips);
    g.gain.setValueCurveAtTime(curve, s - start, e - s);
    src.start(s - start, E.srcTime(c, s), (e - s) * c.speed);
  }
  const ab = await oc.startRendering();
  ab._hasAudio = any;
  return ab;
};
function interleave16(ab) {
  const n = ab.length, out = new Int16Array(n * 2);
  const L = ab.getChannelData(0), Rr = ab.numberOfChannels > 1 ? ab.getChannelData(1) : L;
  for (let i = 0; i < n; i++) { let l = L[i], r = Rr[i]; l = l < -1 ? -1 : l > 1 ? 1 : l; r = r < -1 ? -1 : r > 1 ? 1 : r; out[i * 2] = l * 32767; out[i * 2 + 1] = r * 32767; }
  return out;
}
function wavFile(ab) {
  const pcm = interleave16(ab); const sr = ab.sampleRate;
  const buf = new ArrayBuffer(44 + pcm.byteLength); const v = new DataView(buf);
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); v.setUint32(4, 36 + pcm.byteLength, true); ws(8, 'WAVE'); ws(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
  v.setUint32(24, sr, true); v.setUint32(28, sr * 4, true); v.setUint16(32, 4, true); v.setUint16(34, 16, true); ws(36, 'data'); v.setUint32(40, pcm.byteLength, true);
  new Uint8Array(buf, 44).set(new Uint8Array(pcm.buffer));
  return new Uint8Array(buf);
}

/* ---------- progress dialog ---------- */
function progressDialog(title) {
  let cancelled = false;
  const bar = h('i'); const txt = h('div', { style: { fontSize: '12px', color: '#aaa' } }, 'Przygotowywanie…');
  const spd = h('div', { class: 'exp-speed', style: { fontSize: '12px', marginTop: '4px' } }, '');
  const prev = h('canvas', { width: 384, height: 216, style: { width: '384px', height: '216px', background: '#000', borderRadius: '4px', display: 'block', margin: '0 auto 8px', objectFit: 'contain' } });
  let close;
  TZ.modal({ title, closable: false, body: h('div', { style: { width: '460px' } }, prev, h('div', { class: 'progress' }, bar), txt, spd), buttons: [{ label: 'Anuluj', value: 'cancel' }], onOpen: (m, c) => { close = c; } }).then(v => { if (v === 'cancel') cancelled = true; });
  const t0 = performance.now();
  return {
    set(p, msg, speed) {
      bar.style.width = (p * 100).toFixed(1) + '%';
      const el = (performance.now() - t0) / 1000; const eta = p > 0.02 ? el / p - el : 0;
      txt.textContent = (msg || '') + `  ${(p * 100).toFixed(0)}%` + (eta ? `  ·  pozostało ok. ${TZ.fmtShort(eta)}` : '');
      if (speed) spd.textContent = speed;
    },
    preview(src) { try { const x = prev.getContext('2d'); const k = Math.min(384 / src.width, 216 / src.height); x.fillStyle = '#000'; x.fillRect(0, 0, 384, 216); x.drawImage(src, (384 - src.width * k) / 2, (216 - src.height * k) / 2, src.width * k, src.height * k); } catch (e) {} },
    get cancelled() { return cancelled; },
    elapsed() { return (performance.now() - t0) / 1000; },
    close() { if (close) close(null); }
  };
}

/* ---------- entry points ---------- */
async function chooseOutput(ext) {
  const sep = cfg.folder && cfg.folder.includes('\\') ? '\\' : '/';
  const def = (cfg.folder ? cfg.folder + sep : '') + (cfg.name || 'film') + '.' + ext;
  if (!N) return def;
  if (X.fromWorkspace && cfg.folder) return def;
  return await N.saveDialog({ title: 'Eksportuj', defaultPath: def, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
}
X.run = async (opts = {}) => {
  if (X.busy) return;
  if (!S.seq.clips.length && cfg.format !== 'png' && cfg.format !== 'jpg') { TZ.alert('Sekwencja jest pusta – dodaj klipy na oś czasu przed eksportem.'); return; }
  E.stop(); E.source && E.source.playing && E.source.toggle();
  X.fromWorkspace = !!opts.fromWorkspace;
  const out = await chooseOutput(extFor(cfg.format));
  if (!out) return;
  X.busy = true;
  const savedT = S.playhead;
  try {
    if (cfg.format === 'png' || cfg.format === 'jpg') await exportFrame(out);
    else if (cfg.format === 'wav') await exportWav(out);
    else if (cfg.format === 'webm' || cfg.engine === 'realtime') await exportRealtime(out);
    else if (cfg.engine === 'native' && X.engineOK) await exportPipeline(out, 'native');
    else {
      try { await exportPipeline(out, 'gpu'); }
      catch (e) {
        if (e.message === 'cancelled') throw e;
        console.warn(e);
        if (X.engineOK && await TZ.confirm('Eksport GPU nie powiódł się:\n' + e.message + '\n\nSpróbować silnikiem C++ (Media Foundation)?', 'Tak')) await exportPipeline(out, 'native');
        else if (await TZ.confirm('Eksport GPU nie powiódł się:\n' + e.message + '\n\nUżyć eksportu w czasie rzeczywistym?', 'Tak')) await exportRealtime(out);
        else throw new Error('cancelled');
      }
    }
  } catch (e) {
    if (e.message !== 'cancelled') { console.error(e); TZ.alert('Eksport nie powiódł się:\n' + (e.message || e)); }
    else TZ.toast('Eksport anulowany');
  } finally {
    X.busy = false; E.frameHook = null; E.endLimit = null;
    S.playhead = savedT; E.layoutProgram(); E.requestRender(); TZ.emit('time');
  }
};
async function finished(path, what, stats) {
  TZ.status('Wyeksportowano: ' + path + (stats ? ' · ' + stats : ''));
  if (!N) return;
  const r = await TZ.modal({ title: 'Eksport zakończony', body: h('div', { style: { maxWidth: '480px' } }, what + ' zapisano w:', h('div', { style: { color: '#ddd', margin: '6px 0', wordBreak: 'break-all' } }, path), stats ? h('div', { class: 'exp-speed' }, stats) : ''), buttons: [{ label: 'Zamknij', value: null }, { label: 'Pokaż w folderze', value: 'show' }, { label: 'Odtwórz', value: 'open', primary: true }] });
  if (r === 'show') N.showItem(path); else if (r === 'open') N.openPath(path);
}
async function exportFrame(out) {
  const [w, hh] = outputSize();
  await prepareFrame(S.playhead);
  const glc = R.renderFrame(S.playhead, null, w, hh);
  const c = document.createElement('canvas'); c.width = w; c.height = hh; c.getContext('2d').drawImage(glc, 0, 0);
  const type = cfg.format === 'jpg' ? 'image/jpeg' : 'image/png';
  const blob = await new Promise(r => c.toBlob(r, type, 0.95));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (N) await N.writeBinary(out, bytes); else { const a = h('a', { href: URL.createObjectURL(blob), download: 'klatka.' + cfg.format }); a.click(); }
  TZ.toast('Wyeksportowano klatkę');
  if (N && cfg.openAfter && X.fromWorkspace) N.showItem(out);
}
X.exportFrameQuick = async () => {
  const prevF = cfg.format; cfg.format = 'png';
  const out = N ? await N.saveDialog({ title: 'Eksportuj klatkę', defaultPath: (S.seq.name || 'klatka') + '_' + TZ.fmtTC(S.playhead, S.seq.fps).replace(/:/g, '-') + '.png', filters: [{ name: 'PNG', extensions: ['png'] }, { name: 'JPG', extensions: ['jpg'] }] }) : 'klatka.png';
  if (out) { if (/\.jpe?g$/i.test(out)) cfg.format = 'jpg'; E.stop(); const prevR = cfg.res; cfg.res = 'seq'; await exportFrame(out); cfg.res = prevR; }
  cfg.format = prevF;
};
async function exportWav(out) {
  const [a, b] = range();
  const pd = progressDialog('Eksport audio (WAV)');
  pd.set(0.05, 'Miksowanie audio…');
  const ab = await X.renderAudio(a, b, 48000, p => pd.set(0.05 + p * 0.8, 'Dekodowanie klipów…'));
  if (pd.cancelled) throw new Error('cancelled');
  const bytes = wavFile(ab);
  if (N) await N.writeBinary(out, bytes); else { const al = h('a', { href: URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' })), download: 'audio.wav' }); al.click(); }
  pd.set(1, 'Gotowe'); pd.close();
  finished(out, 'Plik audio');
}

/* ---------- the fast pipeline (GPU or native C++) ---------- */
async function exportPipeline(out, mode) {
  const [a, b] = range(); const [w, hh] = outputSize(); const fps = outFps();
  const frames = Math.max(1, Math.round((b - a) * fps));
  const [fnum, fden] = fpsRatio(fps);
  const pd = progressDialog(mode === 'gpu' ? 'Eksportowanie – TopaZ GPU' : 'Eksportowanie – silnik C++ (Media Foundation)');
  const t0 = performance.now();
  const decoders = new Map(); const fallback = new Set(); const decFail = new Map();
  let encoder = null, muxer = null, aEncoder = null, pcmPath = null, encErr = null;
  const hw = TZ.settings.hwEncode || 'prefer-hardware';
  const hwDec = TZ.settings.hwDecode === false ? 'prefer-software' : 'prefer-hardware';
  const cleanup = () => { decoders.forEach(d => d && d.close && d.close()); decoders.clear(); try { encoder && encoder.state !== 'closed' && encoder.close(); } catch (e) {} try { aEncoder && aEncoder.state !== 'closed' && aEncoder.close(); } catch (e) {} };
  try {
    // ---- audio mix
    pd.set(0, 'Miksowanie ścieżek audio…');
    const ab = await X.renderAudio(a, b, 48000, p => pd.set(p * 0.03, 'Miksowanie ścieżek audio…'));
    if (pd.cancelled) throw new Error('cancelled');
    const hasAudio = ab._hasAudio;
    // ---- set up output
    const keyEvery = Math.max(1, Math.round(fps * (cfg.keyInt || 2)));
    const bitrate = Math.round(bitrateMbps() * 1e6);
    if (mode === 'gpu') {
      if (!window.VideoEncoder) throw new Error('WebCodecs niedostępne');
      const codec = cfg.codec || 'h264';
      const vc = { codec: codecString(codec, w, hh, fps), width: w, height: hh, bitrate, framerate: fps, bitrateMode: cfg.brMode || 'variable', latencyMode: 'quality' };
      if (codec === 'h264') vc.avc = { format: 'avc' }; if (codec === 'hevc') vc.hevc = { format: 'hevc' };
      let cfgOK = null;
      for (const acc of [hw, 'no-preference', 'prefer-software']) {
        const c2 = Object.assign({}, vc, { hardwareAcceleration: acc });
        const s = await VideoEncoder.isConfigSupported(c2).catch(() => ({ supported: false }));
        if (s.supported) { cfgOK = c2; break; }
        const c3 = Object.assign({}, c2); delete c3.bitrateMode; const s2 = await VideoEncoder.isConfigSupported(c3).catch(() => ({ supported: false }));
        if (s2.supported) { cfgOK = c3; break; }
      }
      if (!cfgOK) throw new Error('Koder ' + vc.codec + ' ' + w + '×' + hh + ' nie jest obsługiwany');
      X.lastEncoder = cfgOK.hardwareAcceleration;
      const vts = fden === 1001 ? fnum : fnum, vdur = fden === 1001 ? fden : fden;
      let acfg = null;
      if (hasAudio && window.AudioEncoder) {
        for (const c of [{ codec: 'mp4a.40.2', name: 'aac' }, { codec: 'opus', name: 'opus' }]) {
          const ac = { codec: c.codec, sampleRate: 48000, numberOfChannels: 2, bitrate: cfg.abr * 1000 };
          if ((await AudioEncoder.isConfigSupported(ac).catch(() => ({ supported: false }))).supported) { acfg = Object.assign(ac, { _name: c.name }); break; }
        }
      }
      if (N) await N.unlink(out);
      muxer = new TZ.MP4.Muxer(out, { video: { codec, codecString: vc.codec, width: w, height: hh, timescale: vts, frameDur: vdur }, audio: acfg ? { codec: acfg._name, sampleRate: 48000, channels: 2, bitrate: cfg.abr * 1000 } : null });
      encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideo(chunk, meta), error: e => { encErr = e; } });
      encoder.configure(cfgOK);
      // audio: encode all now, write interleaved later
      if (acfg) {
        const achunks = [];
        aEncoder = new AudioEncoder({ output: (chunk, meta) => achunks.push([chunk, meta]), error: e => console.warn('audio enc', e) });
        aEncoder.configure({ codec: acfg.codec, sampleRate: 48000, numberOfChannels: 2, bitrate: acfg.bitrate });
        const L = ab.getChannelData(0), Rr = ab.numberOfChannels > 1 ? ab.getChannelData(1) : L;
        const step = 4800;
        for (let i = 0; i < ab.length; i += step) {
          const n = Math.min(step, ab.length - i); const data = new Float32Array(n * 2);
          data.set(L.subarray(i, i + n), 0); data.set(Rr.subarray(i, i + n), n);
          const ad = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(i / 48000 * 1e6), data });
          aEncoder.encode(ad); ad.close();
        }
        await aEncoder.flush();
        X._achunks = achunks;
      } else X._achunks = [];
    } else {
      const pcm = interleave16(ab);
      pcmPath = await N.tempPath('topaz_mix_' + Date.now() + '.pcm');
      await N.writeBinary(pcmPath, new Uint8Array(pcm.buffer));
      const st = await N.engineStart({ out, width: w, height: hh, fps, vbitrate: bitrate, abitrate: cfg.abr * 1000, audio: pcmPath, sampleRate: 48000, channels: 2, threads: TZ.settings.engineThreads || 0 });
      if (!st.ok) throw new Error(st.error || 'Nie można uruchomić silnika C++');
    }
    // ---- frame loop
    let aIdx = 0; const achunks = X._achunks || [];
    const pixBuf = mode === 'native' ? new Uint8Array(w * hh * 4) : null;
    let lastPrev = 0;
    for (let i = 0; i < frames; i++) {
      if (pd.cancelled) throw new Error('cancelled');
      if (encErr) throw encErr;
      const t = a + i / fps;
      const sources = new Map();
      // active video clips
      for (const c of S.seq.clips) {
        if (c.type !== 'video' || c.enabled === false) continue;
        const tr = TZ.trackById(c.track); if (tr && tr.hidden) continue;
        const [ws, we] = R.clipWindow(c);
        if (t < ws || t >= we) { const d = decoders.get(c.id); if (d && t >= we) { d.close(); decoders.delete(c.id); } continue; }
        if (fallback.has(c.id)) continue;
        let d = decoders.get(c.id);
        if (!d) {
          const m = TZ.mediaById(c.mediaId);
          try {
            if (decFail.has(c.mediaId)) throw decFail.get(c.mediaId);
            d = await TZ.MP4.openDecoder(m, hwDec); decoders.set(c.id, d);
          } catch (er) { decFail.set(c.mediaId, er); fallback.add(c.id); console.info('Dekodowanie przez element wideo dla', m && m.name, '-', er.message); continue; }
        }
        let st = E.srcTime(c, t);
        const pt = (c.effects || []).find(f => f.id === 'postime' && f.enabled !== false);
        if (pt) st = E.srcTime(c, c.start + Math.floor((t - c.start) * pt.p.fps) / pt.p.fps);
        try { const f = await d.frameAt(st); if (f) sources.set(c.id, d.rot ? { frame: f, rot: d.rot } : f); }
        catch (er) { console.warn('decoder error', er); d.close(); decoders.delete(c.id); fallback.add(c.id); }
      }
      if (fallback.size) await prepareFrame(t, new Set([...S.seq.clips.filter(c => !fallback.has(c.id)).map(c => c.id)]));
      const glc = R.renderFrame(t, null, w, hh, { sources });
      if (mode === 'gpu') {
        const vf = new VideoFrame(glc, { timestamp: Math.round(i * 1e6 * fden / fnum), duration: Math.round(1e6 * fden / fnum) });
        encoder.encode(vf, { keyFrame: i % keyEvery === 0 });
        vf.close();
        while (aIdx < achunks.length && achunks[aIdx][0].timestamp <= (i + 1) * 1e6 * fden / fnum) { muxer.addAudio(achunks[aIdx][0], achunks[aIdx][1]); aIdx++; }
        while (encoder.encodeQueueSize > 6) await new Promise(r => setTimeout(r, 1));
        if (muxer.w.bufLen > 64 * 1024 * 1024) await muxer.w.flush();
      } else {
        R.readPixels(w, hh, pixBuf);
        const r = await N.engineWrite(pixBuf);
        if (!r.ok) throw new Error(r.error || 'Błąd silnika C++');
      }
      const now = performance.now();
      if (now - lastPrev > 250 || i === frames - 1) {
        lastPrev = now;
        const el = (now - t0) / 1000, fpsDone = (i + 1) / Math.max(0.001, el), rt = ((i + 1) / fps) / Math.max(0.001, el);
        pd.set(0.03 + 0.95 * (i + 1) / frames, `Klatka ${i + 1} z ${frames}`, `${fpsDone.toFixed(0)} kl./s  ·  ${rt.toFixed(1)}× szybciej niż czas rzeczywisty  ·  ${mode === 'gpu' ? (X.lastEncoder === 'prefer-hardware' ? 'koder GPU' : 'koder CPU') : 'Media Foundation'}`);
        pd.preview(glc);
        TZ.engine.programCanvas.getContext('2d').drawImage(glc, 0, 0, TZ.engine.programCanvas.width, TZ.engine.programCanvas.height);
        await new Promise(r => setTimeout(r, 0));
      }
    }
    pd.set(0.99, 'Finalizowanie pliku…');
    if (mode === 'gpu') {
      await encoder.flush();
      if (encErr) throw encErr;
      while (aIdx < achunks.length) { muxer.addAudio(achunks[aIdx][0], achunks[aIdx][1]); aIdx++; }
      const blob = await muxer.finish();
      if (blob) { const al = h('a', { href: URL.createObjectURL(blob), download: (cfg.name || 'film') + '.mp4' }); al.click(); }
    } else {
      const fin = await N.engineEnd();
      if (!fin.ok) throw new Error(fin.error || 'Silnik zakończył się błędem');
    }
    const el = (performance.now() - t0) / 1000;
    const stats = `Wyrenderowano ${TZ.fmtShort(b - a)} materiału w ${TZ.fmtShort(el)} (${(frames / el).toFixed(0)} kl./s, ${((b - a) / el).toFixed(1)}× czasu rzeczywistego)`;
    pd.set(1, 'Gotowe'); pd.close();
    if (cfg.openAfter || !X.fromWorkspace) finished(out, 'Film', stats); else TZ.status(stats);
  } catch (e) {
    pd.close();
    if (mode === 'native') { try { await N.engineAbort(); } catch (er) {} }
    if (N && e.message === 'cancelled') { try { await N.unlink(out); } catch (er) {} }
    throw e;
  } finally {
    cleanup();
    if (pcmPath && N) N.unlink(pcmPath);
  }
}

/* ---------- real-time recorder ---------- */
function pickMime(fmt) {
  const mp4 = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1.4d0028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a'];
  const webm = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  const list = fmt === 'mp4' ? mp4.concat(webm) : webm;
  return list.find(m => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
}
async function exportRealtime(out) {
  const [a, b] = range(); const [w, hh] = outputSize(); const fps = outFps();
  const mime = pickMime(cfg.format);
  if (!mime) throw new Error('Brak obsługiwanego kodera wideo');
  if (!mime.startsWith('video/mp4')) out = out.replace(/\.mp4$/i, '.webm');
  const c = document.createElement('canvas'); c.width = w; c.height = hh; const ctx = c.getContext('2d');
  R.renderFrame(a, ctx, w, hh);
  const vstream = c.captureStream(fps);
  const stream = new MediaStream([...vstream.getVideoTracks(), ...E.exportStream().getAudioTracks()]);
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: Math.round(bitrateMbps() * 1e6), audioBitsPerSecond: cfg.abr * 1000 });
  const chunks = []; let q = Promise.resolve();
  if (N) await N.unlink(out);
  rec.ondataavailable = (e) => { if (!e.data || !e.data.size) return; if (N) q = q.then(async () => N.append(out, new Uint8Array(await e.data.arrayBuffer()))); else chunks.push(e.data); };
  const pd = progressDialog('Eksportowanie (w czasie rzeczywistym)');
  await prepareFrame(a); await TZ.sleep(250);
  const pc = TZ.engine.programCanvas, pctx = pc.getContext('2d');
  const done = new Promise(res => {
    E.endLimit = () => b;
    E.frameHook = (t, last) => {
      R.renderFrame(Math.min(t, b), ctx, w, hh);
      pctx.drawImage(c, 0, 0, pc.width, pc.height);
      pd.set(TZ.clamp((t - a) / (b - a || 1), 0, 1), 'Nagrywanie ' + TZ.fmtTC(t - a, fps) + ' / ' + TZ.fmtTC(b - a, fps));
      if (Math.floor(t * 4) !== Math.floor((t - 1 / 60) * 4)) pd.preview(c);
      if (pd.cancelled) E.stop();
      if (last) res();
    };
    TZ.on('playstate', () => { if (!S.playing) res(); });
  });
  rec.start(1000); S.playhead = a; E.play(1);
  await done;
  E.frameHook = null; E.endLimit = null;
  await new Promise(r => { rec.onstop = r; rec.stop(); });
  await q; vstream.getTracks().forEach(t => t.stop());
  pd.close();
  if (pd.cancelled) { if (N) await N.unlink(out); throw new Error('cancelled'); }
  if (!N) { const blob = new Blob(chunks, { type: mime }); const al = h('a', { href: URL.createObjectURL(blob), download: 'film.' + (mime.includes('mp4') ? 'mp4' : 'webm') }); al.click(); return; }
  if (cfg.openAfter || !X.fromWorkspace) finished(out, 'Film');
}

/* ---------- quick export ---------- */
X.quickExport = async () => {
  if (!S.seq.clips.length) { TZ.alert('Sekwencja jest pusta – dodaj klipy przed eksportem.'); return; }
  await X.detectCaps();
  const caps = X.caps;
  const fmt = h('select', null, h('option', { value: 'h264' }, 'H.264 (MP4)' + (caps.h264 && caps.h264.hw ? ' – GPU' : '')), h('option', { value: 'hevc', disabled: !(caps.hevc && caps.hevc.any) }, 'H.265 (MP4)' + (caps.hevc && caps.hevc.hw ? ' – GPU' : '')), h('option', { value: 'wav' }, 'Audio WAV'));
  fmt.value = cfg.codec === 'hevc' ? 'hevc' : 'h264';
  const res = h('select', null, ...RES.filter(r => r[0] !== 'custom').map(([v, nm]) => h('option', { value: v, selected: v === cfg.res }, nm)));
  const q = h('select', null, ...QUALITY.filter(x => x[0] !== 'custom').map(([v, nm]) => h('option', { value: v, selected: v === cfg.quality }, nm)));
  const r = await TZ.modal({ title: 'Szybki eksport', body: h('div', { style: { display: 'grid', gridTemplateColumns: '130px 1fr', gap: '10px', alignItems: 'center', width: '460px' } }, 'Format', fmt, 'Rozdzielczość', res, 'Jakość', q), buttons: [{ label: 'Anuluj', value: null }, { label: 'Więcej ustawień…', value: 'more' }, { label: 'Eksportuj', primary: true, value: 'go' }] });
  if (r === 'more') { TZ.ui.workspace('export'); return; }
  if (r !== 'go') return;
  if (fmt.value === 'wav') cfg.format = 'wav'; else { cfg.format = 'mp4'; cfg.codec = fmt.value; }
  cfg.res = res.value; cfg.quality = q.value; cfg.target = 0; cfg.engine = TZ.settings.exportEngine || 'gpu';
  if (!cfg.name) cfg.name = S.seq.name;
  X.run({ fromWorkspace: false });
};
TZ.$('#expGo').onclick = () => X.run({ fromWorkspace: true });
TZ.$('#expBack').onclick = () => TZ.ui.workspace('edit');
})();
