// Find Java runtimes on this computer and ask Mojang which Java a Minecraft version needs.
const { execFile } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');

const ls = d => { try { return fs.readdirSync(d).map(n => path.join(d, n)); } catch { return []; } };
const exe = process.platform === 'win32' ? 'java.exe' : 'java';

function probe(p) {
  return new Promise(res => execFile(p, ['-version'], { timeout: 8000 }, (err, so, se) => {
    const out = (se || '') + (so || '');
    const m = out.match(/version "([^"]+)"/);
    if (!m) return res(null);
    const parts = m[1].split(/[._+-]/).map(Number);
    const major = parts[0] === 1 ? parts[1] : parts[0];
    const vend = (out.match(/Temurin|Zulu|Corretto|GraalVM|Microsoft|Oracle|Liberica|Semeru|OpenJ9|Mojang/i) || [''])[0];
    res({ path: p, version: m[1], major, vendor: vend });
  }));
}

function candidates() {
  const home = os.homedir(), c = new Set();
  const add = p => { if (p && fs.existsSync(p)) c.add(p); };
  if (process.env.JAVA_HOME) add(path.join(process.env.JAVA_HOME, 'bin', exe));
  const mcRuntime = root => { // official launcher's bundled Java: runtime/<component>/<platform>/<component>/bin/java
    for (const comp of ls(path.join(root, 'runtime'))) for (const plat of ls(comp)) for (const inner of ls(plat)) {
      add(path.join(inner, 'bin', exe)); add(path.join(inner, 'jre.bundle', 'Contents', 'Home', 'bin', exe));
    }
  };
  if (process.platform === 'win32') {
    const pf = [process.env['ProgramFiles'], process.env['ProgramFiles(x86)']].filter(Boolean);
    for (const b of pf) for (const v of ['Java', 'Eclipse Adoptium', 'Microsoft', 'Zulu', 'Amazon Corretto', 'BellSoft', 'Semeru', 'Eclipse Foundation'])
      for (const d of ls(path.join(b, v))) add(path.join(d, 'bin', exe));
    if (process.env.APPDATA) mcRuntime(path.join(process.env.APPDATA, '.minecraft'));
  } else if (process.platform === 'darwin') {
    for (const base of ['/Library/Java/JavaVirtualMachines', path.join(home, 'Library/Java/JavaVirtualMachines')])
      for (const d of ls(base)) add(path.join(d, 'Contents/Home/bin', exe));
    for (const base of ['/opt/homebrew/opt', '/usr/local/opt']) for (const d of ls(base)) if (/openjdk/.test(d)) add(path.join(d, 'bin', exe));
    mcRuntime(path.join(home, 'Library/Application Support/minecraft'));
  } else {
    for (const d of ls('/usr/lib/jvm')) add(path.join(d, 'bin', exe));
    for (const d of ls(path.join(home, '.sdkman/candidates/java'))) add(path.join(d, 'bin', exe));
    mcRuntime(path.join(home, '.minecraft'));
  }
  const real = new Map();
  for (const p of c) { try { const r = fs.realpathSync(p); if (!real.has(r)) real.set(r, p); } catch { real.set(p, p); } }
  return [...real.values()];
}

let cache = null;
async function detect(force) {
  if (cache && !force) return cache;
  const list = (await Promise.all([...candidates(), 'java'].map(probe))).filter(Boolean);
  const seen = new Set(), key = j => j.version + '|' + j.vendor + '|' + safeReal(j.path);
  const real = list.filter(j => j.path !== 'java'), onPath = list.find(j => j.path === 'java');
  if (onPath && !real.some(j => j.version === onPath.version && j.vendor === onPath.vendor)) real.push(onPath);
  cache = real.filter(j => { const k = key(j); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => b.major - a.major);
  return cache;
}
const safeReal = p => { try { return fs.realpathSync(p); } catch { return p; } };

const reqCache = new Map();
async function required(mc) {
  if (!mc) return null;
  if (reqCache.has(mc)) return reqCache.get(mc);
  try {
    const m = await (await fetch('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json', { signal: AbortSignal.timeout(10000) })).json();
    const v = m.versions.find(x => x.id === mc); if (!v) return null;
    const j = await (await fetch(v.url, { signal: AbortSignal.timeout(10000) })).json();
    const n = j.javaVersion && j.javaVersion.majorVersion;
    if (n) reqCache.set(mc, n); return n || null;
  } catch { return null; }
}

// Auto: the smallest Java that is new enough; if none is, the newest one we have.
function pick(list, req) {
  if (!list.length) return null;
  if (req) { const ok = list.filter(j => j.major >= req).sort((a, b) => a.major - b.major); if (ok.length) return ok[0]; }
  return list[0];
}
module.exports = { detect, probe, required, pick };
