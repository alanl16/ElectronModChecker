const { isRelease, newest } = require('./versions');
const UA = 'MyModLauncher/0.1 (modpack version checker)';
const API = 'https://api.modrinth.com/v2';
const fetchT = (u, o = {}) => fetch(u, { ...o, headers: { 'User-Agent': UA, ...(o.headers || {}) }, signal: AbortSignal.timeout(20000) });

async function pool(items, n, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

// mods: [{sha1, loader}], target: MC version of the whole modpack
// -> Map(sha1 -> result)
async function checkModrinth(mods, target) {
  const out = new Map();
  if (!mods.length) return out;
  const r = await fetchT(API + '/version_files', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hashes: mods.map(m => m.sha1), algorithm: 'sha1' }) });
  if (!r.ok) throw new Error('Modrinth ' + r.status);
  const current = await r.json();
  const ids = [...new Set(Object.values(current).map(v => v.project_id))];
  const projects = {};
  for (let i = 0; i < ids.length; i += 100) {
    const pr = await fetchT(`${API}/projects?ids=${encodeURIComponent(JSON.stringify(ids.slice(i, i + 100)))}`);
    if (pr.ok) for (const p of await pr.json()) projects[p.id] = p;
  }
  const found = mods.filter(m => current[m.sha1]);
  await pool(found, 6, async m => {
    const cur = current[m.sha1], p = projects[cur.project_id];
    const loader = m.loader.toLowerCase();
    const q = new URLSearchParams({ loaders: JSON.stringify([loader]), include_changelog: 'false' });
    let versions = [];
    try { const vr = await fetchT(`${API}/project/${cur.project_id}/version?${q}`); if (vr.ok) versions = await vr.json(); } catch {}
    const supported = [...new Set(versions.flatMap(v => v.game_versions).filter(isRelease))];
    const forTarget = versions.filter(v => !target || v.game_versions.includes(target))
      .sort((a, b) => (b.version_type === 'release') - (a.version_type === 'release') || new Date(b.date_published) - new Date(a.date_published));
    const best = forTarget[0];
    const file = best && (best.files.find(f => f.primary) || best.files[0]);
    out.set(m.sha1, {
      source: 'Modrinth', projectId: cur.project_id, title: p && p.title, categories: p ? p.categories : [], projectUrl: p ? `https://modrinth.com/mod/${p.slug}` : null, icon: p && p.icon_url,
      currentVersion: cur.version_number, latestVersion: best ? best.version_number : null,
      channel: best ? best.version_type : null,
      supported: supported.sort((a, b) => require('./versions').cmp(a, b)), newestMc: newest(supported),
      hasTarget: !!best, isCurrent: !!best && best.id === cur.id,
      updateAvailable: !!best && best.id !== cur.id,
      download: file && { url: file.url, filename: file.filename },
    });
  });
  return out;
}

const LOADER_CATS = new Set(['fabric', 'forge', 'neoforge', 'quilt', 'liteloader', 'rift', 'modloader', 'bukkit', 'spigot', 'paper', 'purpur', 'sponge', 'folia', 'bungeecord', 'velocity', 'waterfall', 'datapack', 'minecraft']);

// Mods similar to `info` (a Modrinth check result) that already support `target` on `loader`
async function findSimilar(info, target, loader) {
  const cats = (info.categories || []).filter(c => !LOADER_CATS.has(c));
  const run = async catsList => {
    const facets = [['project_type:mod'], [`categories:${loader.toLowerCase()}`]];
    if (target) facets.push([`versions:${target}`]);
    if (catsList.length) facets.push(catsList.map(c => `categories:${c}`));
    const q = new URLSearchParams({ facets: JSON.stringify(facets), index: 'downloads', limit: '9' });
    const r = await fetchT(`${API}/search?${q}`);
    if (!r.ok) throw new Error('Modrinth ' + r.status);
    return (await r.json()).hits.filter(h => h.project_id !== info.projectId);
  };
  let hits = await run(cats);
  if (!hits.length && cats.length > 1) hits = await run([]);
  return hits.slice(0, 6).map(h => ({ title: h.title, description: h.description, icon: h.icon_url, downloads: h.downloads, url: 'https://modrinth.com/mod/' + h.slug, author: h.author }));
}
module.exports = { checkModrinth, findSimilar };
