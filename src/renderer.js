const $ = id => document.getElementById(id);
let mods = [], results = {}, loading = false, alts = {};
const liHtml = l => ['Fabric', 'Forge', 'NeoForge', 'Quilt'].includes(l) ? `<img class="li" src="icons/${l.toLowerCase()}.png">` : '<span class="li">❔</span>';
const setLoaderIcon = () => { const v = $('loader').value; if (v === 'Auto') $('loaderIcon').removeAttribute('src'); else $('loaderIcon').src = `icons/${v.toLowerCase()}.png`; };
const fmtN = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
addEventListener('error', e => { $('status').textContent = 'Error: ' + e.message; });
addEventListener('unhandledrejection', e => { $('status').textContent = 'Error: ' + (e.reason && e.reason.message || e.reason); });
$('skin').onerror = () => { $('skin').onerror = null; $('skin').src = 'https://mc-heads.net/avatar/AlanL14/64'; };
for (const id of ['skin2', 'skin3']) $(id).onerror = () => { $(id).onerror = null; $(id).src = 'https://mc-heads.net/avatar/AlanL14/64'; };
$('help').onclick = () => $('welcome').classList.add('show');
$('go').onclick = () => { $('welcome').classList.remove('show'); api.setConfig({ hideWelcome: $('hide').checked }); };
const saveList = () => api.setConfig({ files: mods.map(m => m.file) });

function classify(m) {
  const r = results[m.file], target = $('mc').value.trim();
  if (loading) return { k: 'load', label: 'Checking…' };
  if (!results.__done) return { k: 'none', label: 'Not checked' };
  if (!r) return { k: 'none', label: results.__modrinthError ? 'Check failed' : 'Not found online' };
  if (!target) return { k: 'none', label: 'Pick a Minecraft version' };
  if (!r.hasTarget) return { k: 'bad', label: `No ${target} build` };
  if (r.isCurrent) return { k: 'good', label: `Ready for ${target}` };
  return { k: 'upd', label: `${target}: ${r.latestVersion}` };
}

function render() {
  const target = $('mc').value.trim();
  const rows = mods.map((m, i) => ({ m, i, c: classify(m) }));
  const order = { bad: 0, upd: 1, load: 2, none: 2, good: 3 };
  rows.sort((a, b) => order[a.c.k] - order[b.c.k] || a.m.name.localeCompare(b.m.name));
  const bad = rows.filter(x => x.c.k === 'bad').length, upd = rows.filter(x => x.c.k === 'upd').length, good = rows.filter(x => x.c.k === 'good').length;
  $('summary').innerHTML = loading ? '<span class="pulse">Checking Modrinth & CurseForge…</span>' : results.__done && target
    ? `<span class="good">${good + upd}/${mods.length} ready for ${esc(target)}</span> · <span class="bad">${bad} blocked</span>${upd ? ` · ${upd} need update` : ''}` : '';
  $('list').innerHTML = '';
  if (!mods.length) {
    $('list').innerHTML = '<div class="empty" id="emptybox"><div class="ico">📂</div><div class="t">No mods yet</div><div class="d">Drag your .jar files here, or click to choose them</div></div>';
    return;
  }
  if ($('onlyBad').checked && !loading && !rows.some(x => x.c.k === 'bad')) {
    $('list').innerHTML = '<div class="empty"><div class="ico">✅</div><div class="t">No problems</div><div class="d">Every mod has a build for this version</div></div>';
    return;
  }
  for (const { m, i, c } of rows) {
    if ($('onlyBad').checked && c.k !== 'bad') continue;
    const r = results[m.file];
    const el = document.createElement('div'); el.className = 'mod ' + c.k;
    const icon = m.icon || (r && r.icon);
    const bc = { bad: 'bad', good: 'good', upd: 'upd', none: 'unk', load: 'unk pulse' }[c.k];
    let sup = '';
    if (r && r.supported && r.supported.length) {
      const last = r.supported.slice(-5).reverse().map(esc).join(', ');
      sup = c.k === 'bad' ? `<div class="sup"><b>Stuck at ${esc(r.newestMc)}</b> · available for: ${last}</div>` : `<div class="sup">Available for: ${last}</div>`;
    }
    el.innerHTML = `${icon ? `<img src="${esc(icon)}">` : '<div class="ph">🧩</div>'}
      <div><div class="name">${esc(m.name)}</div>
      <div class="meta"><span class="tag ${esc(m.loader)}">${liHtml(m.loader)}${esc(m.loader)}</span>
        <span>${esc(m.version || '?')}</span>${m.mcVersion ? `<span>· now ${esc(m.mcVersion)} ${esc(m.loader)}</span>` : ''}
        ${r ? `<span>· ${esc(r.source)}</span>` : ''}${r && r.projectUrl ? `<a data-u="${esc(r.projectUrl)}">page</a>` : ''}</div>${sup}</div>
      <div class="right"><span class="badge ${bc}">${esc(c.label)}</span>${c.k === 'bad' && r && r.projectId ? `<button class="altbtn" data-alt="${i}">${alts[m.file] ? 'Hide' : 'Find alternatives'}</button>` : ''}${c.k === 'upd' && r.download ? `<button data-i="${i}">Update</button>` : ''}<button class="x" data-rm="${i}" title="Remove">✕</button></div>`;
    const al = alts[m.file];
    if (al) {
      const box = document.createElement('div'); box.className = 'alts';
      box.innerHTML = al.loading ? '<div class="pulse">Searching Modrinth for similar mods on ' + esc(target) + '…</div>'
        : al.error ? '<div>Couldn\'t search: ' + esc(al.error) + '</div>'
        : !al.items.length ? '<div>No similar mods found for ' + esc(target) + ' yet.</div>'
        : '<div class="sup">Similar mods that already support ' + esc(target) + ':</div>' + al.items.map(a => `<div class="alt">${a.icon ? `<img src="${esc(a.icon)}">` : '<div class="ph">🧩</div>'}<div><div class="t"><a data-u="${esc(a.url)}">${esc(a.title)}</a></div><div class="d">${esc(a.description)}</div></div><div class="n">⬇ ${fmtN(a.downloads)}</div></div>`).join('');
      el.appendChild(box);
    }
    $('list').appendChild(el);
  }
}

async function importFiles(paths) {
  const parsed = await api.parse(paths);
  if (!parsed.length) { $('status').textContent = 'No .jar files found in that.'; return; }
  const have = new Set(mods.map(m => m.file));
  mods.push(...parsed.filter(m => !have.has(m.file)));
  saveList();
  render(); check();
}

async function check() {
  if (!mods.length) return;
  loading = true; render();
  $('check').classList.add('busy');
  $('status').textContent = 'Checking Modrinth & CurseForge…';
  api.setConfig({ cfKey: $('cfkey').value });
  results = await api.check(mods, $('cfkey').value.trim(), $('mc').value.trim(), $('loader').value);
  api.setConfig({ loader: $('loader').value, mc: $('mc').value });
  results.__done = true;
  const n = Object.values(results).filter(r => r && r.updateAvailable).length;
  const errs = [results.__modrinthError, results.__curseError].filter(Boolean).join(' · ');
  $('status').textContent = `${mods.length} mods checked` + (errs ? ` — ${errs}` : '');
  loading = false;
  $('check').classList.remove('busy');
  render();
}

$('list').addEventListener('click', async e => {
  const d = e.target.dataset;
  if (d.u) return api.open(d.u);
  if (d.alt != null) {
    const m = mods[d.alt], r = results[m.file];
    if (alts[m.file]) { delete alts[m.file]; return render(); }
    alts[m.file] = { loading: true }; render();
    const res = await api.similar(r, $('mc').value.trim(), $('loader').value === 'Auto' ? m.loader : $('loader').value);
    alts[m.file] = res; return render();
  }
  if (d.rm != null) { mods.splice(d.rm, 1); saveList(); return render(); }
  if (d.i != null) {
    const m = mods[d.i], r = results[m.file];
    e.target.disabled = true; e.target.textContent = '…';
    try {
      const dest = await api.update(m, r.download);
      const [nm] = await api.parse([dest]); mods[d.i] = nm; delete results[m.file]; saveList(); render(); check();
    } catch (err) { $('status').textContent = 'Update failed: ' + err.message; render(); }
  }
});

$('import').onclick = async () => { const f = await api.pickFiles(false); if (f.length) importFiles(f); };
$('list').addEventListener('click', async e => { if (e.target.closest('#emptybox')) { const f = await api.pickFiles(false); if (f.length) importFiles(f); } });
$('importdir').onclick = async () => { const f = await api.pickFiles(true); if (f.length) importFiles(f); };
$('loader').onchange = $('mc').onchange = () => { setLoaderIcon(); check(); };
$('onlyBad').onchange = render;
$('check').onclick = check;
$('launch').onclick = async () => {
  const a = await api.launchTest(mods, results, $('mc').value.trim(), $('loader').value);
  $('lv').className = 'verdict ' + a.verdict;
  $('lv').textContent = (a.verdict === 'ok' ? '✅ ' : a.verdict === 'warn' ? '⚠️ ' : a.verdict === 'fail' ? '❌ ' : '') + a.headline;
  $('issues').innerHTML = a.issues.map(i => `<div class="issue ${i.level}"><div class="it">${esc(i.title)}</div><div class="im">${esc(i.mod)}</div><div class="if"><b>Fix:</b> ${esc(i.fix)}</div>${i.link ? `<a data-u="${esc(i.link)}">Open on Modrinth ↗</a>` : ''}</div>`).join('');
  $('launchModal').classList.add('show');
};
$('lclose').onclick = () => $('launchModal').classList.remove('show');
$('issues').addEventListener('click', e => { if (e.target.dataset.u) api.open(e.target.dataset.u); });
$('testkey').onclick = async () => {
  const el = $('keyres'); el.className = ''; el.textContent = 'Testing…';
  const r = await api.testKey($('cfkey').value.trim());
  el.className = r.ok ? 'ok' : 'no'; el.textContent = (r.ok ? '✔ ' : '✖ ') + r.msg;
  if (r.ok) api.setConfig({ cfKey: $('cfkey').value.trim() });
};
$('clear').onclick = () => { mods = []; results = {}; saveList(); render(); };

let depth = 0;
addEventListener('dragenter', e => { e.preventDefault(); depth++; document.body.classList.add('drag'); });
addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; document.body.classList.remove('drag'); } });
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => {
  e.preventDefault(); depth = 0; document.body.classList.remove('drag');
  importFiles([...e.dataTransfer.files].map(f => api.pathOf(f)));
});

api.mcVersions().then(v => { if (v.length) { $('mcs').innerHTML = v.map(x => `<option>${esc(x)}</option>`).join(''); if (!$('mc').value) { $('mc').value = v[0]; check(); } } });
(async () => {
  const c = await api.getConfig(); if (!c.hideWelcome) $('welcome').classList.add('show'); $('cfkey').value = c.cfKey || ''; $('loader').value = c.loader || 'Auto'; setLoaderIcon(); $('mc').value = c.mc || '';
  if (c.files && c.files.length) { mods = await api.parse(c.files); }
  else { mods = await api.parse([await api.defaultDir()]); if (mods.length) saveList(); }
  if (!mods.length) $('status').textContent = '';
  render(); check();
})();
