const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path'), fs = require('fs');
const { parseJar } = require('./jar');
const { checkModrinth, findSimilar } = require('./modrinth');
const { analyze } = require('./launchtest');
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
ipcMain.handle('mods:parse', (_, paths) => {
  const files = [];
  for (const p of paths) {
    try {
      if (fs.statSync(p).isDirectory()) for (const f of fs.readdirSync(p)) { if (f.endsWith('.jar')) files.push(path.join(p, f)); }
      else if (p.endsWith('.jar')) files.push(p);
    } catch {}
  }
  return files.map(f => { try { return parseJar(f); } catch (e) { return { file: f, fileName: path.basename(f), name: path.basename(f), loader: 'Unknown', sha1: '', fingerprint: 0, error: e.message }; } });
});
ipcMain.handle('dir:default', () => defaultModsDir());
ipcMain.handle('mods:scan', (_, dir) => {
  if (!fs.existsSync(dir)) throw new Error('Folder not found: ' + dir);
  return fs.readdirSync(dir).filter(f => f.endsWith('.jar')).map(f => parseJar(path.join(dir, f)));
});

ipcMain.handle('mods:check', async (_, mods, cfKey, mc, loader) => {
  if (loader && loader !== 'Auto') mods = mods.map(x => ({ ...x, loader }));
  const result = {};
  mc = mc || null; // only offer updates built for this Minecraft version
  try {
    const m = await checkModrinth(mods.map(x => ({ sha1: x.sha1, loader: x.loader })), mc);
    for (const x of mods) if (m.has(x.sha1)) result[x.file] = m.get(x.sha1);
  } catch (e) { result.__modrinthError = e.message; }
  try {
    const c = await checkCurseForge(mods.map(x => ({ fingerprint: x.fingerprint, loader: x.loader })), cfKey, mc);
    for (const x of mods) if (!result[x.file] && c.has(x.fingerprint)) result[x.file] = c.get(x.fingerprint);
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
  if (!key) return { ok: false, msg: 'Paste a key first' };
  try {
    const r = await fetch('https://api.curseforge.com/v1/games/432', { headers: { 'x-api-key': key, Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
    if (r.ok) return { ok: true, msg: 'Key works' };
    if (r.status === 401 || r.status === 403) return { ok: false, msg: 'Key rejected (invalid)' };
    return { ok: false, msg: 'CurseForge error ' + r.status };
  } catch (e) { return { ok: false, msg: 'Could not reach CurseForge' }; }
});

ipcMain.handle('mods:similar', async (_, info, target, loader) => {
  try { return { items: await findSimilar(info, target, loader) }; } catch (e) { return { error: e.message }; }
});
ipcMain.handle('launch:test', (_, mods, results, target, loader) => analyze(mods, results, target, loader));
