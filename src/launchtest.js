// Dry-run of "what would happen if I launched": checks mod files against loader, Minecraft version and Java.
// Returns issue CODES + params; the window translates them.
const { mcSatisfies } = require('./versions');

const BUILTIN = new Set(['minecraft', 'java', 'fabricloader', 'fabric-loader', 'quilt_loader', 'quilt_base', 'forge', 'neoforge', 'javafml', 'lowcodefml', 'fml', 'mixin']);
const LOADERS = ['Fabric', 'Forge', 'NeoForge', 'Quilt'];
const search = q => 'https://modrinth.com/mods?q=' + encodeURIComponent(q);

function inferLoader(mods) {
  const c = {}; for (const m of mods) if (LOADERS.includes(m.loader)) c[m.loader] = (c[m.loader] || 0) + 1;
  return Object.entries(c).sort((a, b) => b[1] - a[1]).map(x => x[0])[0] || null;
}

// jv = { required: 21 | null, have: { major, path } | null }
function analyze(mods, results, target, loaderSel, jv) {
  const issues = [];
  const add = (level, mod, code, p, link) => issues.push({ level, mod, code, p: p || {}, link: link || null });
  if (!mods.length) return { verdict: 'empty', errors: 0, warns: 0, issues };
  const loader = loaderSel && loaderSel !== 'Auto' ? loaderSel : inferLoader(mods);
  const fam = l => l === 'Fabric' || l === 'Quilt';

  if (jv && jv.required) {
    const link = `https://adoptium.net/temurin/releases/?version=${jv.required}`;
    if (!jv.have) add('warn', 'Java', 'javaNone', { req: jv.required }, link);
    else if (jv.have.major < jv.required) add('error', 'Java', 'java', { req: jv.required, have: jv.have.major }, link);
  }

  const provided = new Set(BUILTIN), byId = {};
  for (const m of mods) {
    for (const id of [m.id, ...(m.provides || []), ...(m.nested || [])]) if (id) provided.add(id);
    if (m.id) (byId[m.id] ||= []).push(m);
  }
  for (const list of Object.values(byId)) if (list.length > 1)
    add('error', list[0].name, 'dup', { n: list.length, files: list.map(x => x.fileName).join(', ') });

  for (const m of mods) {
    const r = results && results[m.file];
    if (m.loader === 'Unknown') add('warn', m.name, 'unreadable');
    else if (loader && m.loader !== loader && !(loader === 'Quilt' && m.loader === 'Fabric')) {
      add('error', m.name, fam(m.loader) !== fam(loader) ? 'wrongLoaderX' : 'wrongLoader', { a: m.loader, b: loader }, search(m.name));
      continue;
    }
    if (target) {
      const sat = mcSatisfies(m.mcRange, target);
      if (r && r.hasTarget && !r.isCurrent) add('error', m.name, 'outdated', { v: target, ver: r.latestVersion });
      else if (r && !r.hasTarget) add('error', m.name, 'stuck', { v: target, newest: r.newestMc || '' });
      else if (sat === false) add('error', m.name, 'mcMismatch', { v: target, a: m.mcVersion || '' });
      else if (sat === null && !r) add('warn', m.name, 'unknownMc', { v: target });
    }
    for (const d of m.deps || []) {
      if (BUILTIN.has(d.id) || provided.has(d.id)) continue;
      const fabApi = /^fabric(-api)?$|^fabric-.*-v\d+$|^fabric-api-/.test(d.id);
      add('error', m.name, 'needs', { d: fabApi ? 'Fabric API' : d.id, r: d.range ? ' (' + d.range + ')' : '' }, fabApi ? 'https://modrinth.com/mod/fabric-api' : search(d.id));
    }
  }
  const out = [];
  for (const i of issues) {
    if (i.code === 'needs') { const f = out.find(o => o.code === 'needs' && o.p.d === i.p.d); if (f) { if (!f.mod.split(', ').includes(i.mod)) f.mod += ', ' + i.mod; continue; } }
    out.push(i);
  }
  out.sort((a, b) => (a.level === 'error' ? 0 : 1) - (b.level === 'error' ? 0 : 1));
  const errors = out.filter(i => i.level === 'error').length, warns = out.length - errors;
  return { verdict: errors ? 'fail' : warns ? 'warn' : 'ok', errors, warns, issues: out, loader, target };
}
module.exports = { analyze };
