'use strict';
/* ==========================================================
   TopaZ MP4 toolkit: ISO-BMFF demuxer (for WebCodecs decoding)
   and streaming MP4 muxer (H.264 / H.265 / AV1 + AAC / Opus)
   ========================================================== */
(() => {
const MP4 = TZ.MP4 = {};
MP4.stats = { seeks: 0, decoded: 0 };
const N = window.native || null;
const str4 = (dv, o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
const hex2 = v => v.toString(16).padStart(2, '0').toUpperCase();

/* ---------------- byte source with window cache ---------------- */
class Source {
  constructor(url) { this.url = url; this.size = 0; this.win = null; this.winStart = 0; this.whole = null; }
  async init() {
    try {
      const r = await fetch(this.url, { headers: { Range: 'bytes=0-15' } });
      const cr = r.headers.get('content-range');
      if (r.status === 206 && cr) { this.size = +cr.split('/')[1]; await r.arrayBuffer(); return; }
      // no range support (blob: URLs) -> keep whole file
      this.whole = new Uint8Array(await r.arrayBuffer()); this.size = this.whole.length;
    } catch (e) { const r = await fetch(this.url); this.whole = new Uint8Array(await r.arrayBuffer()); this.size = this.whole.length; }
  }
  async read(off, len) {
    if (this.whole) return this.whole.subarray(off, off + len);
    if (this.win && off >= this.winStart && off + len <= this.winStart + this.win.length) return this.win.subarray(off - this.winStart, off - this.winStart + len);
    const want = Math.min(this.size - off, Math.max(len, 24 * 1024 * 1024));
    const r = await fetch(this.url, { headers: { Range: `bytes=${off}-${off + want - 1}` } });
    this.win = new Uint8Array(await r.arrayBuffer()); this.winStart = off;
    return this.win.subarray(0, len);
  }
  async readFresh(off, len) {
    if (this.whole) return this.whole.subarray(off, off + len);
    const r = await fetch(this.url, { headers: { Range: `bytes=${off}-${off + len - 1}` } });
    return new Uint8Array(await r.arrayBuffer());
  }
}
MP4.Source = Source;

/* ---------------- demuxer ---------------- */
function children(dv, start, end, cb) {
  let p = start;
  while (p + 8 <= end) {
    let size = dv.getUint32(p); const type = str4(dv, p + 4); let hdr = 8;
    if (size === 1) { size = Number(dv.getBigUint64(p + 8)); hdr = 16; } else if (size === 0) size = end - p;
    if (size < hdr) break;
    cb(type, p + hdr, p + size, p);
    p += size;
  }
}
function codecString(entryType, cfgType, b) {
  if (cfgType === 'avcC') return 'avc1.' + hex2(b[1]) + hex2(b[2]) + hex2(b[3]);
  if (cfgType === 'hvcC') {
    const space = b[1] >> 6, tier = (b[1] >> 5) & 1, prof = b[1] & 31;
    let compat = ((b[2] << 24) | (b[3] << 16) | (b[4] << 8) | b[5]) >>> 0, rev = 0;
    for (let i = 0; i < 32; i++) { rev = (rev << 1) | (compat & 1); compat >>>= 1; }
    let s = (entryType === 'hev1' ? 'hev1' : 'hvc1') + '.' + ['', 'A', 'B', 'C'][space] + prof + '.' + (rev >>> 0).toString(16).toUpperCase() + '.' + (tier ? 'H' : 'L') + b[12];
    const cons = [b[6], b[7], b[8], b[9], b[10], b[11]]; while (cons.length && cons[cons.length - 1] === 0) cons.pop();
    cons.forEach(c => s += '.' + hex2(c));
    return s;
  }
  if (cfgType === 'av1C') {
    const prof = b[1] >> 5, lvl = b[1] & 31, tier = b[2] >> 7, hi = (b[2] >> 6) & 1, twelve = (b[2] >> 5) & 1;
    return `av01.${prof}.${String(lvl).padStart(2, '0')}${tier ? 'H' : 'M'}.${hi ? (twelve ? '12' : '10') : '08'}`;
  }
  if (cfgType === 'vpcC') return `vp09.${String(b[4]).padStart(2, '0')}.${String(b[5]).padStart(2, '0')}.${String(b[6] >> 4).padStart(2, '0')}`;
  return null;
}
MP4.demux = async (url) => {
  const src = new Source(url); await src.init();
  // locate moov among top-level boxes
  let pos = 0, moov = null, guard = 0;
  while (pos + 8 <= src.size && guard++ < 10000) {
    const hb = await src.readFresh(pos, 16); const dv = new DataView(hb.buffer, hb.byteOffset, hb.byteLength);
    let size = dv.getUint32(0); const type = str4(dv, 4);
    if (size === 1) size = Number(dv.getBigUint64(8)); else if (size === 0) size = src.size - pos;
    if (size < 8) break;
    if (type === 'moov') { moov = await src.readFresh(pos, size); break; }
    pos += size;
  }
  if (!moov) throw new Error('Brak atomu moov (nie jest to plik MP4/MOV)');
  const dv = new DataView(moov.buffer, moov.byteOffset, moov.byteLength);
  const tracks = [];
  children(dv, 8, moov.length, (type, s, e) => {
    if (type !== 'trak') return;
    const tr = { stts: [], ctts: [], stss: null, stsz: [], stsc: [], stco: [], elst: 0, rot: 0 };
    const walk = (s2, e2) => children(dv, s2, e2, (t, a, b) => {
      if (['mdia', 'minf', 'stbl', 'edts'].includes(t)) walk(a, b);
      else if (t === 'tkhd') { const v = dv.getUint8(a); const mo = a + (v === 1 ? 4 + 8 + 8 + 4 + 4 + 8 : 4 + 4 + 4 + 4 + 4 + 4) + 8 + 2 + 2 + 2 + 2; const m0 = dv.getInt32(mo) / 65536, m1 = dv.getInt32(mo + 4) / 65536; tr.rot = Math.round(Math.atan2(m1, m0) * 180 / Math.PI); tr.w = dv.getUint32(mo + 36) / 65536; tr.h = dv.getUint32(mo + 40) / 65536; }
      else if (t === 'mdhd') { const v = dv.getUint8(a); tr.timescale = dv.getUint32(a + (v === 1 ? 20 : 12)); }
      else if (t === 'hdlr') tr.handler = str4(dv, a + 8);
      else if (t === 'elst') { const v = dv.getUint8(a), n = dv.getUint32(a + 4); let o = a + 8; for (let i = 0; i < n; i++) { const mt = v === 1 ? Number(dv.getBigInt64(o + 8)) : dv.getInt32(o + 4); if (mt >= 0) { tr.elst = mt; break; } o += v === 1 ? 20 : 12; } }
      else if (t === 'stsd') {
        const ent = a + 8; const esize = dv.getUint32(ent); tr.entry = str4(dv, ent + 4);
        if (['avc1', 'avc3', 'hvc1', 'hev1', 'av01', 'vp09'].includes(tr.entry)) {
          tr.cw = dv.getUint16(ent + 8 + 24); tr.ch = dv.getUint16(ent + 8 + 26);
          children(dv, ent + 8 + 78, ent + esize, (ct, ca, cb) => { if (['avcC', 'hvcC', 'av1C', 'vpcC'].includes(ct)) { tr.cfgType = ct; tr.desc = moov.slice(ca, cb); } });
        }
      }
      else if (t === 'stts') { const n = dv.getUint32(a + 4); for (let i = 0; i < n; i++) tr.stts.push([dv.getUint32(a + 8 + i * 8), dv.getUint32(a + 12 + i * 8)]); }
      else if (t === 'ctts') { const v = dv.getUint8(a), n = dv.getUint32(a + 4); for (let i = 0; i < n; i++) tr.ctts.push([dv.getUint32(a + 8 + i * 8), v === 1 ? dv.getInt32(a + 12 + i * 8) : dv.getUint32(a + 12 + i * 8)]); }
      else if (t === 'stss') { const n = dv.getUint32(a + 4); tr.stss = new Set(); for (let i = 0; i < n; i++) tr.stss.add(dv.getUint32(a + 8 + i * 4)); }
      else if (t === 'stsz') { const ss = dv.getUint32(a + 4), n = dv.getUint32(a + 8); tr.stszN = n; if (ss) tr.stszConst = ss; else for (let i = 0; i < n; i++) tr.stsz.push(dv.getUint32(a + 12 + i * 4)); }
      else if (t === 'stsc') { const n = dv.getUint32(a + 4); for (let i = 0; i < n; i++) tr.stsc.push([dv.getUint32(a + 8 + i * 12), dv.getUint32(a + 12 + i * 12)]); }
      else if (t === 'stco') { const n = dv.getUint32(a + 4); for (let i = 0; i < n; i++) tr.stco.push(dv.getUint32(a + 8 + i * 4)); }
      else if (t === 'co64') { const n = dv.getUint32(a + 4); for (let i = 0; i < n; i++) tr.stco.push(Number(dv.getBigUint64(a + 8 + i * 8))); }
    });
    walk(s, e);
    tracks.push(tr);
  });
  const v = tracks.find(t => t.handler === 'vide' && t.desc);
  if (!v) throw new Error('Brak obsługiwanej ścieżki wideo');
  // build sample table (decode order)
  const n = v.stszN || 0, samples = new Array(n);
  let si = 0;
  for (let ci = 0; ci < v.stco.length && si < n; ci++) {
    let per = 0; for (let k = v.stsc.length - 1; k >= 0; k--) if (v.stsc[k][0] <= ci + 1) { per = v.stsc[k][1]; break; }
    let off = v.stco[ci];
    for (let j = 0; j < per && si < n; j++, si++) { const sz = v.stszConst || v.stsz[si]; samples[si] = { off, size: sz }; off += sz; }
  }
  let dts = 0, idx = 0;
  for (const [cnt, d] of v.stts) for (let j = 0; j < cnt && idx < n; j++, idx++) { samples[idx].dts = dts; samples[idx].dur = d; dts += d; }
  idx = 0; for (const [cnt, o] of v.ctts) for (let j = 0; j < cnt && idx < n; j++, idx++) samples[idx].cto = o;
  for (let i = 0; i < n; i++) { const s = samples[i]; s.pts = ((s.dts || 0) + (s.cto || 0) - v.elst) / v.timescale; s.key = v.stss ? v.stss.has(i + 1) : true; s.durS = (s.dur || 0) / v.timescale; }
  return { src, codec: codecString(v.entry, v.cfgType, v.desc), desc: v.cfgType === 'vpcC' ? undefined : v.desc, width: v.cw || v.w, height: v.ch || v.h, rot: v.rot, samples: samples.filter(Boolean), timescale: v.timescale };
};

/* ---------------- sequential decoder for one clip ---------------- */
class ClipDecoder {
  constructor(info, hw) { this.info = info; this.hw = hw; this.q = []; this.next = 0; this.flushed = false; this.err = null; this.waiters = []; this.lastReq = -1; }
  async open() {
    const cfg = { codec: this.info.codec, codedWidth: this.info.width, codedHeight: this.info.height, description: this.info.desc, hardwareAcceleration: this.hw, optimizeForLatency: false };
    let sup = await VideoDecoder.isConfigSupported(cfg).catch(() => ({ supported: false }));
    if (!sup.supported && this.hw !== 'no-preference') { cfg.hardwareAcceleration = 'no-preference'; sup = await VideoDecoder.isConfigSupported(cfg).catch(() => ({ supported: false })); }
    if (!sup.supported) throw new Error('Dekoder ' + this.info.codec + ' nieobsługiwany');
    this.cfg = cfg;
    this.dec = new VideoDecoder({ output: f => { MP4.stats.decoded++; this.q.push(f); this.wake(); }, error: e => { this.err = e; this.wake(); } });
    this.dec.configure(cfg);
    return this;
  }
  wake() { const w = this.waiters; this.waiters = []; w.forEach(r => r()); }
  waitOut(ms) { return new Promise(r => { this.waiters.push(r); setTimeout(r, ms); }); }
  dropAll() { this.q.forEach(f => { try { f.close(); } catch (e) {} }); this.q = []; }
  seekTo(t) {
    MP4.stats.seeks++;
    const S = this.info.samples;
    let k = 0;
    for (let i = 0; i < S.length; i++) if (S[i].key && S[i].pts <= t + 1e-6) k = i; else if (S[i].pts > t + 2) break;
    this.dropAll();
    try { this.dec.reset(); this.dec.configure(this.cfg); } catch (e) {}
    this.next = k; this.flushed = false; this.err = null;
  }
  async feed(max = 6) {
    const S = this.info.samples;
    while (this.dec.decodeQueueSize < max && this.next < S.length) {
      const s = S[this.next++];
      const data = await this.info.src.read(s.off, s.size);
      this.dec.decode(new EncodedVideoChunk({ type: s.key ? 'key' : 'delta', timestamp: Math.round(s.pts * 1e6), duration: Math.round(s.durS * 1e6), data }));
    }
  }
  async frameAt(t) {
    const tus = Math.round(t * 1e6) + 500;
    const S = this.info.samples;
    const front = this.q.length ? this.q[0].timestamp : null;
    // need to (re)seek: backwards, first use, or far jump forward
    const nextPts = this.next < S.length ? S[this.next].pts : Infinity;
    if (this.lastReq < 0 || t < this.lastReq - 1e-4 || (front != null && front > tus + 1e5 && t < (front / 1e6) - 0.05) || (!this.q.length && nextPts > t + 0.5 && this.next > 0) || t > nextPts + 3) this.seekTo(t);
    this.lastReq = t;
    for (let guard = 0; guard < 4000; guard++) {
      if (this.err) throw this.err;
      while (this.q.length >= 2 && this.q[1].timestamp <= tus) this.q.shift().close();
      if (this.q.length && (this.q.length >= 2 || this.q[0].timestamp > tus || (this.flushed && this.next >= S.length))) return this.q[0];
      if (this.next >= S.length) {
        if (!this.flushed) { this.flushed = true; await this.dec.flush().catch(() => {}); continue; }
        return this.q[this.q.length - 1] || null;
      }
      if (this.q.length > 8) { this.q.shift().close(); }
      await this.feed();
      if (this.dec.decodeQueueSize > 0) await this.waitOut(30);
    }
    return this.q[0] || null;
  }
  close() { this.dropAll(); try { this.dec.close(); } catch (e) {} }
}
MP4.ClipDecoder = ClipDecoder;
const infoCache = new Map();
MP4.openDecoder = async (media, hw) => {
  let info = infoCache.get(media.id);
  if (!info) { info = await MP4.demux(media.url); infoCache.set(media.id, info); }
  if (!info.codec) throw new Error('nieznany kodek');
  const d = await new ClipDecoder(info, hw).open();
  d.rot = ((info.rot % 360) + 360) % 360;
  return d;
};

/* ---------------- muxer ---------------- */
const enc = new TextEncoder();
function box(type, ...parts) {
  let len = 8; for (const p of parts) len += p.length;
  const o = new Uint8Array(len); const dv = new DataView(o.buffer);
  dv.setUint32(0, len); o.set(enc.encode(type), 4);
  let p = 8; for (const x of parts) { o.set(x, p); p += x.length; }
  return o;
}
function fbox(type, version, flags, ...parts) { return box(type, new Uint8Array([version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255]), ...parts); }
function u8(...v) { return new Uint8Array(v); }
function u16(v) { const o = new Uint8Array(2); new DataView(o.buffer).setUint16(0, v); return o; }
function u32(v) { const o = new Uint8Array(4); new DataView(o.buffer).setUint32(0, v >>> 0); return o; }
function i32(v) { const o = new Uint8Array(4); new DataView(o.buffer).setInt32(0, v); return o; }
function u64(v) { const o = new Uint8Array(8); new DataView(o.buffer).setBigUint64(0, BigInt(Math.max(0, Math.round(v)))); return o; }
function cat(arr) { let n = 0; arr.forEach(a => n += a.length); const o = new Uint8Array(n); let p = 0; arr.forEach(a => { o.set(a, p); p += a.length; }); return o; }
const MATRIX = cat([u32(0x00010000), u32(0), u32(0), u32(0), u32(0x00010000), u32(0), u32(0), u32(0), u32(0x40000000)]);

class Writer {
  constructor(path) { this.path = path; this.pos = 0; this.buf = []; this.bufLen = 0; this.chain = Promise.resolve(); this.mem = N ? null : []; this.err = null; }
  write(bytes) {
    this.pos += bytes.length;
    if (this.mem) { this.mem.push(bytes); return; }
    this.buf.push(bytes); this.bufLen += bytes.length;
    if (this.bufLen > 16 * 1024 * 1024) this.flush();
  }
  flush() {
    if (this.mem || !this.bufLen) return this.chain;
    const data = cat(this.buf); this.buf = []; this.bufLen = 0;
    this.chain = this.chain.then(() => N.append(this.path, data)).catch(e => { this.err = e; });
    return this.chain;
  }
  async patch(offset, bytes) {
    if (this.mem) { let p = 0; for (const part of this.mem) { if (offset >= p && offset < p + part.length) { part.set(bytes, offset - p); return; } p += part.length; } return; }
    await this.flush(); await this.chain; await N.writeAt(this.path, offset, bytes);
  }
  get pending() { return this.chain; }
}

class Muxer {
  constructor(path, o) {
    this.o = o; this.w = new Writer(path); this.v = []; this.a = []; this.vdesc = null; this.adesc = null;
    const ftyp = box('ftyp', enc.encode('isom'), u32(0x200), enc.encode('isom'), enc.encode('iso2'), enc.encode(o.video.codec === 'hevc' ? 'hvc1' : o.video.codec === 'av1' ? 'av01' : 'avc1'), enc.encode('mp41'));
    this.w.write(ftyp);
    this.mdatStart = this.w.pos;
    this.w.write(cat([u32(1), enc.encode('mdat'), u64(0)]));
  }
  addVideo(chunk, meta) {
    if (meta && meta.decoderConfig && meta.decoderConfig.colorSpace && !this.vcs) this.vcs = meta.decoderConfig.colorSpace;
    if (meta && meta.decoderConfig && meta.decoderConfig.description && !this.vdesc) this.vdesc = new Uint8Array(meta.decoderConfig.description instanceof ArrayBuffer ? meta.decoderConfig.description : meta.decoderConfig.description.buffer ? new Uint8Array(meta.decoderConfig.description.buffer, meta.decoderConfig.description.byteOffset, meta.decoderConfig.description.byteLength) : meta.decoderConfig.description).slice();
    const d = new Uint8Array(chunk.byteLength); chunk.copyTo(d);
    this.v.push({ off: this.w.pos, size: d.length, pts: chunk.timestamp, key: chunk.type === 'key' });
    this.w.write(d);
  }
  addAudio(chunk, meta) {
    if (meta && meta.decoderConfig && meta.decoderConfig.description && !this.adesc) { const ds = meta.decoderConfig.description; this.adesc = new Uint8Array(ds instanceof ArrayBuffer ? ds : ds.buffer ? new Uint8Array(ds.buffer, ds.byteOffset, ds.byteLength) : ds).slice(); }
    const d = new Uint8Array(chunk.byteLength); chunk.copyTo(d);
    this.a.push({ off: this.w.pos, size: d.length, pts: chunk.timestamp, dur: chunk.duration });
    this.w.write(d);
  }
  videoTrak(id, movieTs) {
    const V = this.o.video, ts = V.timescale, frameDur = V.frameDur;
    const pts = this.v.map(s => Math.round(s.pts * ts / 1e6));
    const sorted = [...pts].sort((a, b) => a - b);
    let shift = 0; for (let i = 0; i < pts.length; i++) shift = Math.max(shift, sorted[i] - pts[i]);
    const dts = sorted; const cto = pts.map((p, i) => p - dts[i] + shift);
    const durMedia = (sorted.length ? sorted[sorted.length - 1] - sorted[0] : 0) + frameDur;
    const durMovie = Math.round(durMedia / ts * movieTs);
    // stts
    const stts = []; for (let i = 0; i < dts.length; i++) { const d = i < dts.length - 1 ? dts[i + 1] - dts[i] : frameDur; if (stts.length && stts[stts.length - 1][1] === d) stts[stts.length - 1][0]++; else stts.push([1, d]); }
    const needCtts = cto.some(x => x !== 0);
    const ctts = []; if (needCtts) for (const c of cto) { if (ctts.length && ctts[ctts.length - 1][1] === c) ctts[ctts.length - 1][0]++; else ctts.push([1, c]); }
    const keys = []; this.v.forEach((s, i) => { if (s.key) keys.push(i + 1); });
    const base = this.mdatStart;
    const sampleEntry = (() => {
      const head = cat([u8(0, 0, 0, 0, 0, 0), u16(1), u16(0), u16(0), u32(0), u32(0), u32(0), u16(V.width), u16(V.height), u32(0x00480000), u32(0x00480000), u32(0), u16(1), new Uint8Array(32), u16(0x18), u16(0xffff)]);
      const cfgName = V.codec === 'hevc' ? 'hvcC' : V.codec === 'av1' ? 'av1C' : 'avcC';
      const entryName = V.codec === 'hevc' ? 'hvc1' : V.codec === 'av1' ? 'av01' : 'avc1';
      let cfg = this.vdesc;
      if (!cfg && V.codec === 'av1') { const m = /av01\.(\d)\.(\d+)([MH])\.(\d+)/.exec(V.codecString || ''); const prof = m ? +m[1] : 0, lvl = m ? +m[2] : 8, tier = m && m[3] === 'H' ? 1 : 0, bd = m ? +m[4] : 8; cfg = u8(0x81, (prof << 5) | lvl, (tier << 7) | ((bd > 8 ? 1 : 0) << 6) | ((bd === 12 ? 1 : 0) << 5) | 0x0C, 0); }
      const cs = this.vcs || {};
      const PRI = { bt709: 1, bt470bg: 5, smpte170m: 6, bt2020: 9, smpte432: 12 }, TRC = { bt709: 1, smpte170m: 6, 'iec61966-2-1': 13, linear: 8, pq: 16, hlg: 18 }, MAT = { rgb: 0, bt709: 1, bt470bg: 5, smpte170m: 6, 'bt2020-ncl': 9 };
      const pri = PRI[cs.primaries] || 6, trc = TRC[cs.transfer] || 6, mat = MAT[cs.matrix] != null ? MAT[cs.matrix] : 6;
      return box(entryName, head, box(cfgName, cfg || new Uint8Array(0)), box('colr', enc.encode('nclx'), u16(pri), u16(trc), u16(mat), u8(cs.fullRange ? 0x80 : 0)), box('pasp', u32(1), u32(1)));
    })();
    const stbl = box('stbl',
      fbox('stsd', 0, 0, u32(1), sampleEntry),
      fbox('stts', 0, 0, u32(stts.length), ...stts.map(([c, d]) => cat([u32(c), u32(d)]))),
      needCtts ? fbox('ctts', 0, 0, u32(ctts.length), ...ctts.map(([c, o]) => cat([u32(c), u32(o)]))) : new Uint8Array(0),
      fbox('stss', 0, 0, u32(keys.length), ...keys.map(u32)),
      fbox('stsc', 0, 0, u32(1), u32(1), u32(1), u32(1)),
      fbox('stsz', 0, 0, u32(0), u32(this.v.length), ...this.v.map(s => u32(s.size))),
      fbox('co64', 0, 0, u32(this.v.length), ...this.v.map(s => u64(s.off))));
    void base;
    const minf = box('minf', fbox('vmhd', 0, 1, u16(0), u16(0), u16(0), u16(0)), box('dinf', fbox('dref', 0, 0, u32(1), fbox('url ', 0, 1))), stbl);
    const mdia = box('mdia', fbox('mdhd', 0, 0, u32(0), u32(0), u32(ts), u32(durMedia), u16(0x55c4), u16(0)), fbox('hdlr', 0, 0, u32(0), enc.encode('vide'), u32(0), u32(0), u32(0), enc.encode('TopaZ Video\0')), minf);
    const tkhd = fbox('tkhd', 0, 3, u32(0), u32(0), u32(id), u32(0), u32(durMovie), u32(0), u32(0), u16(0), u16(0), u16(0), u16(0), MATRIX, u32(V.width * 65536), u32(V.height * 65536));
    const edts = shift ? box('edts', fbox('elst', 0, 0, u32(1), u32(durMovie), i32(shift), u16(1), u16(0))) : new Uint8Array(0);
    return { trak: box('trak', tkhd, edts, mdia), durMovie };
  }
  audioTrak(id, movieTs) {
    const A = this.o.audio, ts = A.sampleRate;
    const durs = this.a.map(s => Math.max(1, Math.round((s.dur || 0) * ts / 1e6)) || (A.codec === 'aac' ? 1024 : 960));
    const stts = []; for (const d of durs) { if (stts.length && stts[stts.length - 1][1] === d) stts[stts.length - 1][0]++; else stts.push([1, d]); }
    const durMedia = durs.reduce((x, y) => x + y, 0);
    const durMovie = Math.round(durMedia / ts * movieTs);
    const head = cat([u8(0, 0, 0, 0, 0, 0), u16(1), u32(0), u32(0), u16(A.channels), u16(16), u16(0), u16(0), u32(A.sampleRate * 65536 >>> 0)]);
    let entry;
    if (A.codec === 'aac') {
      const asc = this.adesc || new Uint8Array([0x11, 0x90]);
      const dsi = cat([u8(0x05, asc.length), asc]);
      const dcd = cat([u8(0x04, 13 + dsi.length, 0x40, 0x15, 0, 0, 0), u32(A.bitrate), u32(A.bitrate), dsi]);
      const esd = cat([u8(0x03, 3 + dcd.length + 3, 0, 1, 0), dcd, u8(0x06, 1, 2)]);
      entry = box('mp4a', head, fbox('esds', 0, 0, esd));
    } else {
      let preskip = 312, inRate = A.sampleRate;
      if (this.adesc && this.adesc.length >= 19) { const dv = new DataView(this.adesc.buffer, this.adesc.byteOffset); preskip = dv.getUint16(10, true); inRate = dv.getUint32(12, true); }
      entry = box('Opus', head, box('dOps', u8(0, A.channels), u16(preskip), u32(inRate), u16(0), u8(0)));
    }
    const stbl = box('stbl', fbox('stsd', 0, 0, u32(1), entry),
      fbox('stts', 0, 0, u32(stts.length), ...stts.map(([c, d]) => cat([u32(c), u32(d)]))),
      fbox('stsc', 0, 0, u32(1), u32(1), u32(1), u32(1)),
      fbox('stsz', 0, 0, u32(0), u32(this.a.length), ...this.a.map(s => u32(s.size))),
      fbox('co64', 0, 0, u32(this.a.length), ...this.a.map(s => u64(s.off))));
    const minf = box('minf', fbox('smhd', 0, 0, u16(0), u16(0)), box('dinf', fbox('dref', 0, 0, u32(1), fbox('url ', 0, 1))), stbl);
    const mdia = box('mdia', fbox('mdhd', 0, 0, u32(0), u32(0), u32(ts), u32(durMedia), u16(0x55c4), u16(0)), fbox('hdlr', 0, 0, u32(0), enc.encode('soun'), u32(0), u32(0), u32(0), enc.encode('TopaZ Audio\0')), minf);
    const tkhd = fbox('tkhd', 0, 3, u32(0), u32(0), u32(id), u32(0), u32(durMovie), u32(0), u32(0), u16(0), u16(1), u16(0x0100), u16(0), MATRIX, u32(0), u32(0));
    return { trak: box('trak', tkhd, mdia), durMovie };
  }
  async finish() {
    await this.w.flush();
    const mdatSize = this.w.pos - this.mdatStart;
    const movieTs = 1000;
    const vt = this.videoTrak(1, movieTs);
    const at = this.a.length ? this.audioTrak(2, movieTs) : null;
    const dur = Math.max(vt.durMovie, at ? at.durMovie : 0);
    const mvhd = fbox('mvhd', 0, 0, u32(0), u32(0), u32(movieTs), u32(dur), u32(0x00010000), u16(0x0100), u16(0), u32(0), u32(0), MATRIX, new Uint8Array(24), u32(at ? 3 : 2));
    const moov = box('moov', mvhd, vt.trak, at ? at.trak : new Uint8Array(0));
    this.w.write(moov);
    await this.w.flush(); await this.w.pending;
    await this.w.patch(this.mdatStart + 8, u64(mdatSize));
    if (this.w.err) throw this.w.err;
    return this.w.mem ? new Blob(this.w.mem, { type: 'video/mp4' }) : null;
  }
}
MP4.Muxer = Muxer;
})();
