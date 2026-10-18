const { isRelease, newest, cmp } = require('./versions');
const UA = 'MyModLauncher/0.1 (modpack version checker)';
const API = 'https://api.modrinth.com/v2';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// fetch with timeout + automatic wait-and-retry when Modrinth rate-limits us (HTTP 429)
async function fetchT(u, o = {}) {
  let r;
  for (let a = 0; a < 4; a++) {
    r = await fetch(u, { ...o, headers: { 'User-Agent': UA, ...(o.headers || {}) }, signal: AbortSignal.timeout(25000) });
    if (r.status !== 429) return r;
    const wait = Number(r.headers.get('retry-after') || r.headers.get('x-ratelimit-reset') || 5);
    await sleep(Math.min(Math.max(wait, 1), 30) * 1000);
  }
  return r;
}
const jpost = (path, body) => fetchT(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; await fn(items[k]); } }));
}

// mods: [{sha1, loader}] (call with small batches), target: Minecraft version for the whole pack
// -> Map(sha1 -> result). Uses Modrinth's bulk endpoints, so 100 mods cost ~3 requests, not 100.
async function checkModrinth(mods, target) {
  const out = new Map();
  if (!mods.length) return out;
  const r = await jpost('/version_files', { hashes: mods.map(m => m.sha1), algorithm: 'sha1' });
  if (!r.ok) throw new Error('Modrinth ' + r.status);
  const current = await r.json();
  const known = mods.filter(m => current[m.sha1]);
  const ids = [...new Set(known.map(m => current[m.sha1].project_id))];
  const projects = {};
  for (let i = 0; i < ids.length; i += 100) {
    const pr = await fetchT(`${API}/projects?ids=${encodeURIComponent(JSON.stringify(ids.slice(i, i + 100)))}`);
    if (pr.ok) for (const p of await pr.json()) projects[p.id] = p;
  }
  // newest file for the target version, one bulk call per loader
  const latest = {}, byLoader = {};
  for (const m of known) (byLoader[m.loader.toLowerCase()] ||= []).push(m.sha1);
  for (const [loader, hs] of Object.entries(byLoader)) {
    const body = { hashes: hs, algorithm: 'sha1', loaders: [loader] };
    if (target) body.game_versions = [target];
    const ur = await jpost('/version_files/update', body);
    if (ur.ok) Object.assign(latest, await ur.json());
  }
  // mods with no build for the target: look up what versions they DO have (so we can say "stuck at 1.21.11")
  const stuck = {};
  await pool(known.filter(m => target && !latest[m.sha1]), 6, async m => {
    const q = new URLSearchParams({ loaders: JSON.stringify([m.loader.toLowerCase()]), include_changelog: 'false' });
    try { const vr = await fetchT(`${API}/project/${current[m.sha1].project_id}/version?${q}`); if (vr.ok) stuck[m.sha1] = [...new Set((await vr.json()).flatMap(v => v.game_versions).filter(isRelease))]; } catch {}
  });
  for (const m of known) {
    const cur = current[m.sha1], p = projects[cur.project_id], best = latest[m.sha1];
    const file = best && (best.files.find(f => f.primary) || best.files[0]);
    const supported = (best ? best.game_versions.filter(isRelease) : stuck[m.sha1] || []).sort(cmp);
    out.set(m.sha1, {
      source: 'Modrinth', projectId: cur.project_id, title: p && p.title, categories: p ? p.categories : [],
      projectUrl: p ? `https://modrinth.com/mod/${p.slug}` : null, icon: p && p.icon_url,
      currentVersion: cur.version_number, latestVersion: best ? best.version_number : null, channel: best ? best.version_type : null,
      supported, newestMc: newest(supported),
      hasTarget: !!best, isCurrent: !!best && best.id === cur.id,
      updateAvailable: !!best && best.id !== cur.id,
      download: file && { url: file.url, filename: file.filename },
    });
  }
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
