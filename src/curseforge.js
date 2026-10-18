const { isRelease, newest, cmp } = require('./versions');
const API = 'https://api.curseforge.com/v1';
const LOADER = { forge: 1, fabric: 4, quilt: 5, neoforge: 6 };
const fetchT = (u, o = {}) => fetch(u, { ...o, signal: AbortSignal.timeout(20000) });

async function cf(path, key, opts = {}) {
  const r = await fetchT(API + path, { ...opts, headers: { 'x-api-key': key, 'Content-Type': 'application/json', Accept: 'application/json' } });
  if (!r.ok) throw new Error(`CurseForge ${r.status}`);
  return (await r.json()).data;
}

async function checkCurseForge(mods, apiKey, target) {
  const out = new Map();
  if (!apiKey || !mods.length) return out;
  const fp = await cf('/fingerprints/432', apiKey, { method: 'POST', body: JSON.stringify({ fingerprints: mods.map(m => m.fingerprint) }) });
  const matches = fp.exactMatches || [];
  const ids = [...new Set(matches.map(m => m.id))];
  const projects = {};
  if (ids.length) for (const p of await cf('/mods', apiKey, { method: 'POST', body: JSON.stringify({ modIds: ids }) })) projects[p.id] = p;
  for (const m of matches) {
    const p = projects[m.id]; if (!p) continue;
    const fpv = m.file.fileFingerprint;
    const mod = mods.find(x => x.fingerprint === fpv);
    const lt = mod && LOADER[mod.loader.toLowerCase()];
    const idx = (p.latestFilesIndexes || []).filter(f => !lt || f.modLoader === lt);
    const supported = [...new Set(idx.map(f => f.gameVersion).filter(isRelease))].sort(cmp);
    const cands = idx.filter(f => !target || f.gameVersion === target).sort((a, b) => b.fileId - a.fileId);
    const best = cands[0];
    let file = best && (p.latestFiles || []).find(f => f.id === best.fileId);
    if (best && !file) { try { file = await cf(`/mods/${p.id}/files/${best.fileId}`, apiKey); } catch {} }
    out.set(fpv, {
      source: 'CurseForge', projectUrl: p.links && p.links.websiteUrl, icon: p.logo && p.logo.thumbnailUrl,
      currentVersion: m.file.displayName, latestVersion: file ? file.displayName : (best ? String(best.fileId) : null),
      supported, newestMc: newest(supported),
      hasTarget: !!best, isCurrent: !!best && best.fileId === m.file.id,
      updateAvailable: !!best && best.fileId > m.file.id,
      download: file && file.downloadUrl ? { url: file.downloadUrl, filename: file.fileName } : null,
    });
  }
  return out;
}
module.exports = { checkCurseForge };
