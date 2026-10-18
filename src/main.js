const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path'), fs = require('fs');
const { parseJarAsync, fingerprintFile } = require('./jar');
const { checkModrinth, findSimilar } = require('./modrinth');
const { analyze } = require('./launchtest');
const java = require('./java');
const { checkCurseForge } = require('./curseforge');

const cfgFile = () => path.join(app.getPath('userData'), 'config.json');
const loadCfg = () => { try { return JSON.parse(fs.readFileSync(cfgFile(), 'utf8')); } catch { return {}; } };
const saveCfg = c => fs.writeFileSync(cfgFile(), JSON.stringify(c, null, 2));

function defaultModsDir() {
  const home = app.getPath('home');
  if (process.platform === 'win32') return path.join(process.env.APPDATA || '', '.minecraft', 'mods');
  if (process.platform === 'darwin') return path.join(home, 'Library/Application Support/minecraft/mods');
  return path.join(home, '.minecraft/mods');
}

app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 1000, height: 740, backgroundColor: '#16181d',
    webPreferences: { preload: path.join(__dirname, 'preload.js') } });
  win.removeMenu(); win.loadFile(path.join(__dirname, 'index.html'));
});
app.on('window-all-closed', () => app.quit());

ipcMain.handle('config:get', () => ({ modsDir: defaultModsDir(), ...loadCfg() }));
ipcMain.handle('config:set', (_, c) => { saveCfg({ ...loadCfg(), ...c }); });
ipcMain.handle('dir:pick', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('open:url', (_, u) => { if (/^https:\/\//.test(u)) shell.openExternal(u); });

ipcMain.handle('files:pick', async (_, folder) => {
  const r = await dialog.showOpenDialog(folder ? { properties: ['openDirectory'] } : { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Mods', extensions: ['jar'] }] });
  return r.canceled ? [] : r.filePaths;
});
// expand files/folders into a flat list of .jar paths (cheap)
ipcMain.handle('mods:expand', (_, paths) => {
  const files = [];
  for (const p of paths) {
    try {
      if (fs.statSync(p).isDirectory()) { for (const f of fs.readdirSync(p)) if (f.endsWith('.jar')) files.push(path.join(p, f)); }
      else if (p.endsWith('.jar')) files.push(p);
    } catch {}
  }
  return files;
});
// Parsed-jar cache (path + size + modified time), so re-opening a 900-mod list is instant.
let pcache = null, pTimer = null;
const pcFile = () => path.join(app.getPath('userData'), 'parse-cache.json');
const pc = () => { if (!pcache) { try { pcache = JSON.parse(fs.readFileSync(pcFile(), 'utf8')); } catch { pcache = {}; } } return pcache; };
const pcSave = () => { clearTimeout(pTimer); pTimer = setTimeout(() => { try { fs.writeFileSync(pcFile(), JSON.stringify(pc())); } catch {} }, 2000); };

// parse jars one at a time (the window asks for them one by one and shows each as it arrives)
ipcMain.handle('mods:parse', async (_, files) => {
  const out = [];
  for (const f of files) {
    try {
      const st = await fs.promises.stat(f), sig = st.size + '|' + st.mtimeMs, hit = pc()[f];
      if (hit && hit.sig === sig) { out.push(hit.info); continue; }
      const info = await parseJarAsync(f);
      pc()[f] = { sig, info }; pcSave(); out.push(info);
    } catch (e) { out.push({ file: f, fileName: path.basename(f), name: path.basename(f), loader: 'Unknown', sha1: '', deps: [], provides: [], nested: [], error: e.message }); }
  }
  return out;
});
ipcMain.handle('dir:default', () => defaultModsDir());


ipcMain.handle('mods:check', async (_, mods, cfKey, mc, loader) => {
  if (loader && loader !== 'Auto') mods = mods.map(x => ({ ...x, loader }));
  const result = {};
  mc = mc || null; // only offer updates built for this Minecraft version
  try {
    const m = await checkModrinth(mods.map(x => ({ sha1: x.sha1, loader: x.loader })), mc);
    for (const x of mods) if (m.has(x.sha1)) result[x.file] = m.get(x.sha1);
  } catch (e) { result.__modrinthError = e.message; }
  try {
    const fps = [];
    if (cfKey) for (const x of mods) fps.push({ file: x.file, loader: x.loader, fingerprint: await fingerprintFile(x.file).catch(() => 0) });
    const c = await checkCurseForge(fps, cfKey, mc);
    for (const x of fps) if (!result[x.file] && c.has(x.fingerprint)) result[x.file] = c.get(x.fingerprint);
  } catch (e) { result.__curseError = e.message; }
  return result;
});

ipcMain.handle('mods:update', async (_, mod, dl) => {
  const dir = path.dirname(mod.file);
  const r = await fetch(dl.url); if (!r.ok) throw new Error('Download failed ' + r.status);
  const buf = Buffer.from(await r.arrayBuffer());
  const dest = path.join(dir, path.basename(dl.filename));
  fs.writeFileSync(dest, buf);
  if (path.resolve(dest) !== path.resolve(mod.file)) {
    const old = path.join(dir, '.old-mods'); fs.mkdirSync(old, { recursive: true });
    fs.renameSync(mod.file, path.join(old, path.basename(mod.file) + '.bak'));
  }
  return dest;
});

ipcMain.handle('mc:versions', async () => {
  try {
    const r = await fetch('https://api.modrinth.com/v2/tag/game_version', { headers: { 'User-Agent': 'MyModLauncher/0.1' }, signal: AbortSignal.timeout(10000) });
    return (await r.json()).filter(v => v.version_type === 'release').map(v => v.version);
  } catch { return []; }
});

ipcMain.handle('cf:test', async (_, key) => {
  if (!key) return { ok: false, code: 'empty' };
  try {
    const r = await fetch('https://api.curseforge.com/v1/games/432', { headers: { 'x-api-key': key, Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
    if (r.ok) return { ok: true, code: 'ok' };
    if (r.status === 401 || r.status === 403) return { ok: false, code: 'rejected' };
    return { ok: false, code: 'err', status: r.status };
  } catch (e) { return { ok: false, code: 'unreach' }; }
});

ipcMain.handle('mods:similar', async (_, info, target, loader) => {
  try { return { items: await findSimilar(info, target, loader) }; } catch (e) { return { error: e.message }; }
});
async function effectiveJava(target) {
  const cfg = loadCfg(), list = await java.detect(), req = await java.required(target);
  let have = null;
  if (cfg.java) have = list.find(j => j.path === cfg.java) || await java.probe(cfg.java);
  if (!have) have = java.pick(list, req);
  return { have, required: req, custom: !!cfg.java };
}
ipcMain.handle('java:detect', (_, force) => java.detect(force));
ipcMain.handle('java:effective', (_, target) => effectiveJava(target));
ipcMain.handle('java:browse', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openFile'], filters: process.platform === 'win32' ? [{ name: 'java.exe', extensions: ['exe'] }] : [] });
  return r.canceled ? null : java.probe(r.filePaths[0]);
});
ipcMain.handle('launch:test', async (_, mods, results, target, loader) => {
  const j = await effectiveJava(target);
  return analyze(mods, results, target, loader, { required: j.required, have: j.have });
});
