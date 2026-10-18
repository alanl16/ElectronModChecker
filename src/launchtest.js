// Dry-run of "what would happen if I launched": checks the mod files against the loader + Minecraft version.
const { mcSatisfies } = require('./versions');

const BUILTIN = new Set(['minecraft', 'java', 'fabricloader', 'fabric-loader', 'quilt_loader', 'quilt_base', 'forge', 'neoforge', 'javafml', 'lowcodefml', 'fml', 'mixin']);
const LOADERS = ['Fabric', 'Forge', 'NeoForge', 'Quilt'];
const search = q => 'https://modrinth.com/mods?q=' + encodeURIComponent(q);

function inferLoader(mods) {
  const c = {}; for (const m of mods) if (LOADERS.includes(m.loader)) c[m.loader] = (c[m.loader] || 0) + 1;
  return Object.entries(c).sort((a, b) => b[1] - a[1]).map(x => x[0])[0] || null;
}

function analyze(mods, results, target, loaderSel) {
  const issues = [];
  const add = (level, mod, title, fix, link) => issues.push({ level, mod, title, fix, link: link || null });
  if (!mods.length) return { verdict: 'empty', headline: 'Nothing to test', issues };
  const loader = loaderSel && loaderSel !== 'Auto' ? loaderSel : inferLoader(mods);
  const isFabricFamily = l => l === 'Fabric' || l === 'Quilt';

  // provided ids
  const provided = new Set(BUILTIN);
  const byId = {};
  for (const m of mods) {
    for (const id of [m.id, ...(m.provides || []), ...(m.nested || [])]) if (id) provided.add(id);
    if (m.id) (byId[m.id] ||= []).push(m);
  }

  // duplicates
  for (const [id, list] of Object.entries(byId)) if (list.length > 1)
    add('error', list[0].name, `${list.length} copies of the same mod`, `Delete all but the newest: ${list.map(x => x.fileName).join(', ')}. The game refuses to start with duplicates.`);

  for (const m of mods) {
    const r = results && results[m.file];
    // loader mismatch
    if (m.loader === 'Unknown') {
      add('warn', m.name, "Couldn't read this file as a mod", 'Check it really is a Fabric/Forge/NeoForge/Quilt mod. If it is a library or resource pack, it may not belong in this folder.');
    } else if (loader && m.loader !== loader && !(loader === 'Quilt' && m.loader === 'Fabric')) {
      add('error', m.name, `Built for ${m.loader}, but your loader is ${loader}`,
        `Download the ${loader} version of this mod, or remove it. ${isFabricFamily(m.loader) !== isFabricFamily(loader) ? 'It will be ignored or crash the game.' : ''}`.trim(), search(m.name));
      continue;
    }
    // Minecraft version
    if (target) {
      const sat = mcSatisfies(m.mcRange, target);
      if (r && r.hasTarget && !r.isCurrent) {
        add('error', m.name, `Your copy is outdated for ${target}`, `A ${target} build exists (${r.latestVersion}). Click Update on this mod.`);
      } else if (r && !r.hasTarget) {
        add('error', m.name, `No ${target} build exists yet`, `It only goes up to ${r.newestMc || 'an older version'}. Remove it, wait for the author to update it, or use "Find alternatives".`);
      } else if (sat === false) {
        add('error', m.name, `Built for ${m.mcVersion || 'another version'}, not ${target}`, 'Update it if a newer build exists (refresh to check), otherwise remove it or find an alternative.');
      } else if (sat === null && !r) {
        add('warn', m.name, `Couldn't confirm it works on ${target}`, 'Press refresh to check online. If it isn\'t listed anywhere, test it in game.');
      }
    }
    // required dependencies
    for (const d of m.deps || []) {
      if (BUILTIN.has(d.id) || provided.has(d.id)) continue;
      const fabApi = /^fabric(-api)?$|^fabric-.*-v\d+$|^fabric-api-/.test(d.id);
      add('error', m.name, `Needs "${fabApi ? 'Fabric API' : d.id}" which isn't installed`,
        `Install ${fabApi ? 'Fabric API' : d.id}${d.range ? ' (' + d.range + ')' : ''} and import it too.`, fabApi ? 'https://modrinth.com/mod/fabric-api' : search(d.id));
    }
  }
  // collapse repeats of the same missing dependency
  const seen = new Set(), out = [];
  for (const i of issues) { const k = i.title + '|' + (i.title.startsWith('Needs') ? '' : i.mod); if (i.title.startsWith('Needs') && seen.has(k)) { const f = out.find(o => o.title === i.title); if (f && !f.mod.includes(i.mod)) f.mod += ', ' + i.mod; continue; } seen.add(k); out.push(i); }
  const errors = out.filter(i => i.level === 'error').length, warns = out.length - errors;
  const verdict = errors ? 'fail' : warns ? 'warn' : 'ok';
  const headline = errors ? `Would fail to launch — ${errors} problem${errors > 1 ? 's' : ''} to fix` : warns ? `Would probably launch — ${warns} warning${warns > 1 ? 's' : ''}` : `Should launch fine${target ? ' on ' + target : ''}`;
  out.sort((a, b) => (a.level === 'error' ? 0 : 1) - (b.level === 'error' ? 0 : 1));
  return { verdict, headline, issues: out, loader, target };
}
module.exports = { analyze };
