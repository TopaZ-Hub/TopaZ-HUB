// TopaZ Editing Pro 26 - main process
const { app, BrowserWindow, ipcMain, dialog, protocol, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { Readable } = require('stream');
const { spawn } = require('child_process');

// ---------- settings (Preferencje) – applied before the app starts ----------
const os = require('os');
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
let SETTINGS = {};
try { SETTINGS = JSON.parse(fs.readFileSync(settingsPath(), 'utf8')); } catch (e) { SETTINGS = {}; }
if (SETTINGS.gpu === false) app.disableHardwareAcceleration();
else {
  if (SETTINGS.ignoreBlocklist !== false) app.commandLine.appendSwitch('ignore-gpu-blocklist');
  app.commandLine.appendSwitch('enable-gpu-rasterization');
  app.commandLine.appendSwitch('enable-zero-copy');
}
if (SETTINGS.highPerfGPU !== false) app.commandLine.appendSwitch('force_high_performance_gpu');
if (SETTINGS.hwDecode === false) app.commandLine.appendSwitch('disable-accelerated-video-decode');
app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport,PlatformHEVCEncoderSupport,WebCodecsHEVCEncoderSupport,MediaFoundationD3D11VideoCapture');
app.commandLine.appendSwitch('enable-unsafe-swiftshader');
{
  const totalGB = os.totalmem() / 1073741824;
  const ramGB = SETTINGS.ramGB > 0 ? SETTINGS.ramGB : Math.max(2, Math.min(totalGB - 3, totalGB * 0.7));
  const heapMB = Math.max(2048, Math.min(16384, Math.round(ramGB * 1024 * 0.5)));
  app.commandLine.appendSwitch('js-flags', '--max-old-space-size=' + heapMB);
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'tz', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
]);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.json': 'application/json',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/mp4', '.webm': 'video/webm', '.mkv': 'video/webm',
  '.ogv': 'video/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
  '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.flac': 'audio/flac', '.woff2': 'font/woff2'
};

let win = null;
let forceClose = false;
let fileToOpen = process.argv.find(a => a.toLowerCase().endsWith('.tzproj')) || null;

function serveFile(p, request) {
  let stat;
  try { stat = fs.statSync(p); } catch (e) { return new Response('Not found', { status: 404 }); }
  const type = MIME[path.extname(p).toLowerCase()] || 'application/octet-stream';
  const size = stat.size;
  const range = request.headers.get('range');
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m && m[1] ? parseInt(m[1], 10) : 0;
    let end = m && m[2] ? parseInt(m[2], 10) : size - 1;
    if (end >= size) end = size - 1;
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    }
    const stream = fs.createReadStream(p, { start, end });
    return new Response(Readable.toWeb(stream), {
      status: 206,
      headers: {
        'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${size}`, 'Access-Control-Allow-Origin': '*'
      }
    });
  }
  return new Response(Readable.toWeb(fs.createReadStream(p)), {
    status: 200,
    headers: { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': String(size), 'Access-Control-Allow-Origin': '*' }
  });
}

function findFfmpeg() {
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const candidates = [
    path.join(process.resourcesPath || '', 'ffmpeg', exe),
    path.join(path.dirname(app.getPath('exe')), 'ffmpeg', exe),
    path.join(path.dirname(app.getPath('exe')), exe),
    path.join(__dirname, 'ffmpeg', exe)
  ];
  for (const c of candidates) { try { if (fs.existsSync(c)) return c; } catch (e) {} }
  // PATH
  const dirs = (process.env.PATH || '').split(path.delimiter);
  for (const d of dirs) { const c = path.join(d, exe); try { if (fs.existsSync(c)) return c; } catch (e) {} }
  return null;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1600, height: 960, minWidth: 1100, minHeight: 680,
    backgroundColor: '#161616', title: 'TopaZ Editing Pro 26',
    icon: path.join(__dirname, 'renderer', 'icon.png'),
    autoHideMenuBar: true, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: false, backgroundThrottling: false, enableBlinkFeatures: 'AudioVideoTracks' }
  });
  Menu.setApplicationMenu(null);
  win.loadURL('tz://app/index.html');
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.on('close', (e) => {
    if (!forceClose) { e.preventDefault(); win.webContents.send('close-request'); }
  });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }
app.on('second-instance', (e, argv) => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
    const f = argv.find(a => a.toLowerCase().endsWith('.tzproj'));
    if (f) win.webContents.send('open-project-file', f);
  }
});

app.whenReady().then(() => {
  protocol.handle('tz', (request) => {
    const u = new URL(request.url);
    if (u.pathname === '/media') {
      return serveFile(u.searchParams.get('p'), request);
    }
    let rel = decodeURIComponent(u.pathname).replace(/^\/+/, '') || 'index.html';
    const base = path.join(__dirname, 'renderer');
    const p = path.normalize(path.join(base, rel));
    if (!p.startsWith(base)) return new Response('Forbidden', { status: 403 });
    return serveFile(p, request);
  });
  createWindow();
});
app.on('window-all-closed', () => app.quit());

// ---------- IPC ----------
const videoExt = ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'ogv'];
const audioExt = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac'];
const imageExt = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'];

ipcMain.handle('dialog:openMedia', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Importuj multimedia', properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Wszystkie multimedia', extensions: [...videoExt, ...audioExt, ...imageExt] },
      { name: 'Wideo', extensions: videoExt }, { name: 'Audio', extensions: audioExt }, { name: 'Obrazy', extensions: imageExt },
      { name: 'Wszystkie pliki', extensions: ['*'] }
    ]
  });
  return r.canceled ? [] : r.filePaths;
});
ipcMain.handle('dialog:openFolder', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Importuj folder', properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return [];
  const all = [...videoExt, ...audioExt, ...imageExt];
  const out = [];
  const walk = (d, depth) => {
    if (depth > 3) return;
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) walk(p, depth + 1);
      else if (all.includes(path.extname(f.name).slice(1).toLowerCase())) out.push(p);
    }
  };
  try { walk(r.filePaths[0], 0); } catch (e) {}
  return out;
});
ipcMain.handle('dialog:openProject', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Otwórz projekt', properties: ['openFile'], filters: [{ name: 'Projekt TopaZ', extensions: ['tzproj'] }] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('dialog:save', async (e, opts) => {
  const r = await dialog.showSaveDialog(win, opts || {});
  return r.canceled ? null : r.filePath;
});
ipcMain.handle('dialog:message', async (e, opts) => {
  const r = await dialog.showMessageBox(win, opts);
  return r.response;
});
ipcMain.handle('fs:readText', async (e, p) => fs.promises.readFile(p, 'utf8'));
ipcMain.handle('fs:writeText', async (e, p, txt) => { await fs.promises.writeFile(p, txt, 'utf8'); return true; });
ipcMain.handle('fs:writeBinary', async (e, p, data) => { await fs.promises.writeFile(p, Buffer.from(data)); return true; });
ipcMain.on('settings:get', (e) => { e.returnValue = SETTINGS; });
ipcMain.handle('settings:set', async (e, st) => { SETTINGS = st || {}; try { fs.mkdirSync(path.dirname(settingsPath()), { recursive: true }); fs.writeFileSync(settingsPath(), JSON.stringify(SETTINGS, null, 1)); } catch (er) {} return true; });
ipcMain.handle('app:relaunch', async () => { forceClose = true; app.relaunch(); app.exit(0); return true; });
ipcMain.handle('sys:info', async () => {
  const cpus = os.cpus();
  let gpu = null; try { gpu = await app.getGPUInfo('basic'); } catch (e) {}
  return { cpu: cpus[0] ? cpus[0].model.trim() : '?', threads: cpus.length, totalMem: os.totalmem(), freeMem: os.freemem(), platform: process.platform, gpu };
});
ipcMain.handle('fs:writeAt', async (e, p, offset, data) => {
  const fh = await fs.promises.open(p, 'r+');
  try { await fh.write(Buffer.from(data), 0, data.byteLength, offset); } finally { await fh.close(); }
  return true;
});
ipcMain.handle('fs:append', async (e, p, data) => { await fs.promises.appendFile(p, Buffer.from(data)); return true; });
ipcMain.handle('fs:exists', async (e, p) => { try { await fs.promises.access(p); return true; } catch (er) { return false; } });
ipcMain.handle('fs:unlink', async (e, p) => { try { await fs.promises.unlink(p); } catch (er) {} return true; });
ipcMain.handle('fs:tempPath', async (e, name) => path.join(app.getPath('temp'), name));
ipcMain.handle('fs:userData', async () => app.getPath('userData'));
ipcMain.handle('shell:showItem', async (e, p) => { shell.showItemInFolder(p); return true; });
ipcMain.handle('shell:openPath', async (e, p) => shell.openPath(p));
ipcMain.handle('shell:openExternal', async (e, u) => shell.openExternal(u));
ipcMain.handle('win:setTitle', async (e, t) => { if (win) win.setTitle(t); return true; });
ipcMain.handle('win:confirmClose', async () => { forceClose = true; if (win) win.close(); return true; });
ipcMain.handle('app:startupFile', async () => { const f = fileToOpen; fileToOpen = null; return f; });
ipcMain.handle('app:info', async () => ({ version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, platform: process.platform, ffmpeg: findFfmpeg() }));

// ---------- Native C++ media engine (TopazMediaEngine.exe) ----------
function findEngine() {
  const exe = process.platform === 'win32' ? 'TopazMediaEngine.exe' : 'TopazMediaEngine';
  const c = [
    path.join(process.resourcesPath || '', 'engine', exe),
    path.join(path.dirname(app.getPath('exe')), 'engine', exe),
    path.join(__dirname, 'engine', exe)
  ];
  for (const p of c) { try { if (fs.existsSync(p)) return p; } catch (e) {} }
  return null;
}
let engineProc = null, engineErr = '', engineExit = null;
ipcMain.handle('engine:info', async () => {
  const p = findEngine();
  if (!p) return { path: null };
  return await new Promise((resolve) => {
    try {
      const pr = spawn(p, ['--version'], { windowsHide: true });
      let out = '';
      pr.stdout.on('data', d => out += d.toString());
      pr.on('close', () => resolve({ path: p, version: out.trim().replace(/^TopazMediaEngine\s*/i, '') }));
      pr.on('error', () => resolve({ path: null }));
      setTimeout(() => { try { pr.kill(); } catch (e) {} resolve({ path: p, version: '' }); }, 4000);
    } catch (e) { resolve({ path: null }); }
  });
});
ipcMain.handle('engine:start', async (e, o) => {
  const p = findEngine();
  if (!p) return { ok: false, error: 'Brak pliku TopazMediaEngine.exe' };
  if (engineProc) { try { engineProc.kill(); } catch (er) {} engineProc = null; }
  engineErr = ''; engineExit = null;
  const args = ['--out', o.out, '--width', String(o.width), '--height', String(o.height), '--fps', String(o.fps),
    '--vbitrate', String(o.vbitrate), '--abitrate', String(o.abitrate), '--samplerate', String(o.sampleRate || 48000), '--channels', String(o.channels || 2)];
  if (o.audio) args.push('--audio', o.audio);
  if (o.threads) args.push('--threads', String(o.threads));
  return await new Promise((resolve) => {
    const pr = spawn(p, args, { windowsHide: true });
    engineProc = pr;
    let settled = false;
    pr.stderr.on('data', d => { engineErr = (engineErr + d.toString()).slice(-6000); });
    pr.stdout.on('data', d => {
      const s = d.toString();
      if (!settled && s.includes('READY')) { settled = true; resolve({ ok: true }); }
    });
    pr.on('error', er => { if (!settled) { settled = true; resolve({ ok: false, error: String(er) }); } });
    pr.on('close', code => { engineExit = code; if (!settled) { settled = true; resolve({ ok: false, error: engineErr || ('kod wyjścia ' + code) }); } });
    pr.stdin.on('error', () => {});
  });
});
ipcMain.handle('engine:write', async (e, data) => {
  const pr = engineProc;
  if (!pr || engineExit !== null) return { ok: false, error: engineErr || 'Silnik nie działa' };
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  return await new Promise((resolve) => {
    const ok = pr.stdin.write(buf, (err) => { if (err) resolve({ ok: false, error: String(err) + '\n' + engineErr }); else if (ok) resolve({ ok: true }); });
    if (!ok) pr.stdin.once('drain', () => resolve({ ok: true }));
  });
});
ipcMain.handle('engine:end', async () => {
  const pr = engineProc;
  if (!pr) return { ok: false, error: 'Silnik nie działa' };
  return await new Promise((resolve) => {
    const done = (code) => { engineProc = null; resolve({ ok: code === 0, error: code === 0 ? null : (engineErr || ('kod wyjścia ' + code)) }); };
    if (engineExit !== null) return done(engineExit);
    pr.on('close', done);
    pr.stdin.end();
  });
});
ipcMain.handle('engine:abort', async () => { if (engineProc) { try { engineProc.kill(); } catch (e) {} engineProc = null; } return true; });

// ffmpeg transcode (optional - used when ffmpeg is available)
ipcMain.handle('ffmpeg:run', async (e, args, jobId) => {
  const ff = findFfmpeg();
  if (!ff) return { ok: false, error: 'Nie znaleziono ffmpeg' };
  return new Promise((resolve) => {
    const p = spawn(ff, args, { windowsHide: true });
    let err = '';
    p.stderr.on('data', d => {
      const s = d.toString(); err = (err + s).slice(-4000);
      const m = /time=(\d+):(\d+):(\d+\.?\d*)/.exec(s);
      if (m && win) win.webContents.send('ffmpeg:progress', jobId, (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]));
    });
    p.on('close', code => resolve({ ok: code === 0, error: code === 0 ? null : err }));
    p.on('error', er => resolve({ ok: false, error: String(er) }));
  });
});
