const $ = id => document.getElementById(id);
const DISCORD = 'https://discord.gg/NVtpMN25gM', GITHUB = 'https://github.com/alanl16/ElectronModChecker';
const LOADERS = ['Fabric', 'Forge', 'NeoForge', 'Quilt'];
const CHUNK = 40; // mods per online check batch

let mods = [], results = {}, alts = {};
let pending = new Set(), done = new Set();     // files being checked / already checked
let importing = null, checking = null;          // {n,total} progress while running
let runImport = 0, runCheck = 0;                // tokens: a newer run cancels an older one

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const liHtml = l => LOADERS.includes(l) ? `<img class="li" src="icons/${l.toLowerCase()}.png">` : '<span class="li">❔</span>';
const fmtN = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n);
const setLoaderIcon = () => { const v = $('loader').value; if (v === 'Auto') $('loaderIcon').removeAttribute('src'); else $('loaderIcon').src = `icons/${v.toLowerCase()}.png`; };
const slim = m => { const { icon, ...rest } = m; return rest; };   // don't ship icons back and forth over IPC
const saveList = () => api.setConfig({ files: mods.map(m => m.file) });
const loaderSel = () => $('loader').value, target = () => $('mc').value.trim();

addEventListener('error', e => { $('status').textContent = t('st.error', { e: e.message }); });
addEventListener('unhandledrejection', e => { $('status').textContent = t('st.error', { e: (e.reason && e.reason.message) || e.reason }); });
for (const id of ['skin', 'skin2', 'skin3']) $(id).onerror = () => { $(id).onerror = null; $(id).src = 'https://mc-heads.net/avatar/AlanL14/64'; };

// ---------- rendering (throttled so 900 mods can stream in without lag) ----------
let rT = null;
const scheduleRender = () => { if (!rT) rT = setTimeout(() => { rT = null; render(); }, 150); };

function classify(m) {
  const r = results[m.file], v = target();
  if (pending.has(m.file)) return { k: 'load', label: t('b.checking') };
  if (!done.has(m.file)) return { k: 'none', label: t('b.notChecked') };
  if (!r) return { k: 'none', label: results.__modrinthError ? t('b.failed') : t('b.notFound') };
  if (!v) return { k: 'none', label: t('b.pickMc') };
  if (!r.hasTarget) return { k: 'bad', label: t('b.noBuild', { v }) };
  if (r.isCurrent) return { k: 'good', label: t('b.ready', { v }) };
  return { k: 'upd', label: `${v}: ${r.latestVersion}${r.channel && r.channel !== 'release' ? ' (' + r.channel + ')' : ''}` };
}

function altsHtml(m) {
  const al = alts[m.file]; if (!al) return '';
  const v = target();
  const body = al.loading ? `<div class="pulse">${esc(t('a.search', { v }))}</div>`
    : al.error ? `<div>${esc(t('a.err', { e: al.error }))}</div>`
    : !al.items.length ? `<div>${esc(t('a.none', { v }))}</div>`
    : `<div class="sup">${esc(t('a.head', { v }))}</div>` + al.items.map(a => `<div class="alt">${a.icon ? `<img src="${esc(a.icon)}">` : '<div class="ph">🧩</div>'}<div><div class="t"><a data-u="${esc(a.url)}">${esc(a.title)}</a></div><div class="d">${esc(a.description)}</div></div><div class="n">⬇ ${fmtN(a.downloads)}</div></div>`).join('');
  return `<div class="alts">${body}</div>`;
}

function cardHtml(m, i, c) {
  const r = results[m.file];
  const icon = m.icon || (r && r.icon);
  const bc = { bad: 'bad', good: 'good', upd: 'upd', none: 'unk', load: 'unk pulse' }[c.k];
  let sup = '';
  if (r && r.supported && r.supported.length) {
    const l = r.supported.slice(-5).reverse().map(esc).join(', ');
    sup = c.k === 'bad' ? `<div class="sup"><b>${esc(t('c.stuck', { v: r.newestMc }))}</b> · ${esc(t('c.avail', { l: '' }))}${l}</div>` : `<div class="sup">${esc(t('c.Avail', { l: '' }))}${l}</div>`;
  }
  return `<div class="mod ${c.k}">${icon ? `<img src="${esc(icon)}">` : '<div class="ph">🧩</div>'}
    <div><div class="name">${esc(m.name)}</div>
    <div class="meta"><span class="tag ${esc(m.loader)}">${liHtml(m.loader)}${esc(m.loader)}</span>
      <span>${esc(m.version || '?')}</span>${m.mcVersion ? `<span>· ${esc(t('c.now'))} ${esc(m.mcVersion)} ${esc(m.loader)}</span>` : ''}
      ${r ? `<span>· ${esc(r.source)}</span>` : ''}${r && r.projectUrl ? `<a data-u="${esc(r.projectUrl)}">${esc(t('c.page'))}</a>` : ''}</div>${sup}</div>
    <div class="right"><span class="badge ${bc}">${esc(c.label)}</span>${c.k === 'bad' && r && r.projectId ? `<button class="altbtn" data-alt="${i}">${esc(alts[m.file] ? t('btn.hide') : t('btn.alt'))}</button>` : ''}${c.k === 'upd' && r.download ? `<button data-i="${i}">${esc(t('btn.update'))}</button>` : ''}<button class="x" data-rm="${i}" title="${esc(t('tip.remove'))}">✕</button></div>
    ${altsHtml(m)}</div>`;
}

function render() {
  const v = target(), only = $('onlyBad').checked;
  const rows = mods.map((m, i) => ({ m, i, c: classify(m) }));
  const order = { bad: 0, upd: 1, load: 2, none: 2, good: 3 };
  if (!importing) rows.sort((a, b) => order[a.c.k] - order[b.c.k] || a.m.name.localeCompare(b.m.name));   // keep arrival order while loading
  const bad = rows.filter(x => x.c.k === 'bad').length, upd = rows.filter(x => x.c.k === 'upd').length, good = rows.filter(x => x.c.k === 'good').length;

  // progress bar + status line
  const prog = importing || checking;
  $('prog').style.display = prog ? 'block' : 'none';
  if (prog) $('prog').firstElementChild.style.width = Math.round(100 * prog.n / Math.max(prog.total, 1)) + '%';
  if (importing) $('status').textContent = t('st.importing', importing);
  else if (checking) $('status').textContent = `${t('s.checking')} ${checking.n}/${checking.total}`;

  $('summary').innerHTML = done.size && v && Object.keys(results).some(k => !k.startsWith('__'))
    ? `<span class="good">${esc(t('s.ready', { n: good + upd, total: mods.length, v }))}</span> · <span class="bad">${esc(t('s.blocked', { n: bad }))}</span>${upd ? ` · ${esc(t('s.needUpdate', { n: upd }))}` : ''}` : '';

  let html;
  if (!mods.length) html = `<div class="empty" id="emptybox"><div class="ico">📂</div><div class="t">${esc(t('e.none.t'))}</div><div class="d">${esc(t('e.none.d'))}</div></div>`;
  else if (only && !checking && !importing && !bad) html = `<div class="empty"><div class="ico">✅</div><div class="t">${esc(t('e.ok.t'))}</div><div class="d">${esc(t('e.ok.d'))}</div></div>`;
  else html = rows.filter(x => !only || x.c.k === 'bad').map(x => cardHtml(x.m, x.i, x.c)).join('');
  const y = scrollY; $('list').innerHTML = html; scrollTo(0, y);
}

// ---------- importing: one mod at a time, each appears as soon as it's read ----------
async function importPaths(paths) {
  const my = ++runImport;
  const files = await api.expand(paths);
  if (!files.length) { if (!mods.length) render(); $('status').textContent = t('st.noJar'); return; }
  const have = new Set(mods.map(m => m.file));
  const todo = [...new Set(files)].filter(f => !have.has(f));
  importing = { n: 0, total: todo.length };
  for (const f of todo) {
    if (my !== runImport) return;                   // cleared or a newer import started
    const [m] = await api.parse([f]);
    if (my !== runImport) return;
    mods.push(m); importing.n++; scheduleRender();
  }
  importing = null; saveList(); $('status').textContent = ''; render();
  check();
}

// ---------- online check: in batches, results fill in as they arrive ----------
async function checkList(list, fresh) {
  if (!list.length) return;
  const my = ++runCheck;
  if (fresh) { results = { __modrinthError: null }; done = new Set(); }
  pending = new Set(list.map(m => m.file));
  checking = { n: 0, total: list.length };
  $('check').classList.add('busy'); render();
  const key = $('cfkey').value.trim();
  api.setConfig({ cfKey: $('cfkey').value, loader: loaderSel(), mc: $('mc').value });
  for (let i = 0; i < list.length; i += CHUNK) {
    const chunk = list.slice(i, i + CHUNK);
    let res; try { res = await api.check(chunk.map(m => ({ file: m.file, sha1: m.sha1, loader: m.loader })), key, target(), loaderSel()); } catch (e) { res = { __modrinthError: e.message }; }
    if (my !== runCheck) return;                    // refreshed or cleared meanwhile
    for (const m of chunk) { pending.delete(m.file); done.add(m.file); if (res[m.file]) results[m.file] = res[m.file]; }
    if (res.__modrinthError) results.__modrinthError = res.__modrinthError;
    if (res.__curseError) results.__curseError = res.__curseError;
    checking.n = Math.min(i + CHUNK, list.length); scheduleRender();
  }
  checking = null; pending.clear();
  const errs = [results.__modrinthError, results.__curseError].filter(Boolean).join(' · ');
  $('status').textContent = t('st.checked', { n: mods.length }) + (errs ? ` — ${errs}` : '');
  $('check').classList.remove('busy'); render();
}
const check = () => checkList(mods, true);

// ---------- list clicks ----------
$('list').addEventListener('click', async e => {
  if (e.target.closest('#emptybox')) { const f = await api.pickFiles(false); if (f.length) importPaths(f); return; }
  const d = e.target.dataset;
  if (d.u) return api.open(d.u);
  if (d.alt != null) {
    const m = mods[d.alt], r = results[m.file];
    if (alts[m.file]) { delete alts[m.file]; return render(); }
    alts[m.file] = { loading: true }; render();
    alts[m.file] = await api.similar(r, target(), loaderSel() === 'Auto' ? m.loader : loaderSel()); return render();
  }
  if (d.rm != null) { delete results[mods[d.rm].file]; mods.splice(d.rm, 1); saveList(); return render(); }
  if (d.i != null) {
    const m = mods[d.i], r = results[m.file];
    e.target.disabled = true; e.target.textContent = '…';
    try {
      const dest = await api.update(slim(m), r.download);
      const [nm] = await api.parse([dest]); mods[d.i] = nm; delete results[m.file]; saveList(); render();
      checkList([nm], false);
    } catch (err) { $('status').textContent = t('st.updateFail', { e: err.message }); render(); }
  }
});

// ---------- toolbar ----------
$('import').onclick = async () => { const f = await api.pickFiles(false); if (f.length) importPaths(f); };
$('importdir').onclick = async () => { const f = await api.pickFiles(true); if (f.length) importPaths(f); };
$('check').onclick = check;
$('loader').onchange = $('mc').onchange = () => { setLoaderIcon(); check(); };
$('onlyBad').onchange = render;

$('launch').onclick = async () => {
  const a = await api.launchTest(mods.map(slim), results, target(), loaderSel());
  $('lv').className = 'verdict ' + a.verdict;
  const head = a.verdict === 'ok' ? '✅ ' + (a.target ? t('l.okv', { v: a.target }) : t('l.ok'))
    : a.verdict === 'warn' ? '⚠️ ' + (a.warns === 1 ? t('l.warn1') : t('l.warnN', { n: a.warns }))
    : a.verdict === 'fail' ? '❌ ' + (a.errors === 1 ? t('l.fail1') : t('l.failN', { n: a.errors })) : t('l.empty');
  $('lv').textContent = head;
  $('issues').innerHTML = a.issues.map(i => {
    const p = { ...i.p }; if ('newest' in p) p.newest = p.newest || '—'; if ('a' in p) p.a = p.a || '—';
    return `<div class="issue ${i.level}"><div class="it">${esc(t('i.' + i.code + '.t', p))}</div><div class="im">${esc(i.mod)}</div><div class="if"><b>${esc(t('l.fix'))}</b> ${esc(t('i.' + i.code + '.f', p))}</div>${i.link ? `<a data-u="${esc(i.link)}">${esc(t('l.open'))}</a>` : ''}</div>`;
  }).join('');
  $('launchModal').classList.add('show');
};
$('lclose').onclick = () => $('launchModal').classList.remove('show');
$('issues').addEventListener('click', e => { if (e.target.dataset.u) api.open(e.target.dataset.u); });

$('testkey').onclick = async () => {
  const el = $('keyres'); el.className = ''; el.textContent = t('k.testing');
  const r = await api.testKey($('cfkey').value.trim());
  el.className = r.ok ? 'ok' : 'no'; el.textContent = (r.ok ? '✔ ' : '✖ ') + t('k.' + r.code, { s: r.status });
  if (r.ok) api.setConfig({ cfKey: $('cfkey').value.trim() });
};

// ---------- clear list: confirm, with a 3 second lock ----------
let cdTimer = null;
function closeClear() { clearTimeout(cdTimer); $('clModal').classList.remove('show'); }
$('clear').onclick = () => {
  if (!mods.length) return;
  $('clBody').textContent = t('cl.body', { n: mods.length });
  const yes = $('clYes'); yes.disabled = true;
  $('clModal').classList.add('show');
  let n = 3; clearTimeout(cdTimer);
  const tick = () => { if (n > 0) { yes.textContent = `${t('cl.confirm')} (${n--})`; cdTimer = setTimeout(tick, 1000); } else { yes.textContent = t('cl.confirm'); yes.disabled = false; } };
  tick();
};
$('clNo').onclick = closeClear;
$('clYes').onclick = () => {
  if ($('clYes').disabled) return;
  closeClear(); runImport++; runCheck++; importing = checking = null; pending.clear(); done.clear();
  mods = []; results = {}; alts = {}; saveList(); $('status').textContent = ''; $('check').classList.remove('busy'); render();
};

// ---------- settings: language + Java ----------
async function javaStatus() {
  const e = await api.javaEffective(target()), el = $('javaStatus');
  const lines = []; let cls = '';
  if (e.required) lines.push(t('set.need', { v: target(), n: e.required }));
  if (!e.have) { lines.push(t('set.noJava', { n: e.required || '?' })); cls = 'bad'; }
  else if (e.required && e.have.major < e.required) { lines.push(t('set.bad', { j: e.have.major, n: e.required })); cls = 'bad'; }
  else { lines.push(e.required ? t('set.ok', { j: e.have.major }) : t('set.using', { j: e.have.major })); cls = 'ok'; }
  el.className = 'jstat ' + cls; el.innerHTML = lines.map(esc).join('<br>');
  $('javaPath').textContent = e.have ? e.have.path : '';
}
const javaLabel = j => `Java ${j.major} · ${j.version}${j.vendor ? ' (' + j.vendor + ')' : ''}`;
async function refreshJava(force, pick) {
  const list = await api.javaDetect(force), cfg = await api.getConfig(), cur = pick !== undefined ? pick : (cfg.java || '');
  let opts = `<option value="">${esc(t('set.javaAuto'))}</option>` + list.map(j => `<option value="${esc(j.path)}">${esc(javaLabel(j))}</option>`).join('');
  if (cur && !list.some(j => j.path === cur)) opts += `<option value="${esc(cur)}">${esc(cur)}</option>`;
  $('javaSel').innerHTML = opts; $('javaSel').value = cur;
  await javaStatus();
}
$('gear').onclick = async () => {
  const c = await api.getConfig();
  $('lang').innerHTML = LANGS.map(([k, n]) => `<option value="${k}">${esc(n)}</option>`).join(''); $('lang').value = LANG;
  $('mem').value = c.mem || 4096; $('jvmArgs').value = c.jvmArgs || '-XX:+UseG1GC';
  $('settings').classList.add('show'); refreshJava(false);
};
$('setClose').onclick = () => $('settings').classList.remove('show');
$('lang').onchange = () => { LANG = $('lang').value; api.setConfig({ lang: LANG }); applyI18n(); render(); refreshJava(false); };
$('javaSel').onchange = async () => { await api.setConfig({ java: $('javaSel').value }); javaStatus(); };
$('javaDetect').onclick = () => refreshJava(true);
$('javaBrowse').onclick = async () => {
  const j = await api.javaBrowse(); if (j === null) return;
  if (!j) { $('javaStatus').className = 'jstat bad'; $('javaStatus').textContent = t('set.notJava'); return; }
  await api.setConfig({ java: j.path }); refreshJava(false, j.path);
};
$('mem').onchange = () => api.setConfig({ mem: Math.max(512, parseInt($('mem').value, 10) || 4096) });
$('jvmArgs').onchange = () => api.setConfig({ jvmArgs: $('jvmArgs').value });

// ---------- info screen ----------
$('help').onclick = () => $('welcome').classList.add('show');
$('go').onclick = () => { $('welcome').classList.remove('show'); api.setConfig({ hideWelcome: $('hide').checked }); };
$('discord').onclick = () => api.open(DISCORD);
$('github').onclick = () => api.open(GITHUB);
addEventListener('keydown', e => { if (e.key === 'Escape') { closeClear(); for (const o of document.querySelectorAll('.overlay.show')) o.classList.remove('show'); } });

// ---------- drag & drop ----------
let depth = 0;
addEventListener('dragenter', e => { e.preventDefault(); depth++; document.body.classList.add('drag'); });
addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; document.body.classList.remove('drag'); } });
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => {
  e.preventDefault(); depth = 0; document.body.classList.remove('drag');
  importPaths([...e.dataTransfer.files].map(f => api.pathOf(f)));
});

// ---------- start ----------
api.mcVersions().then(v => { if (v.length) { $('mcs').innerHTML = v.map(x => `<option>${esc(x)}</option>`).join(''); if (!$('mc').value) { $('mc').value = v[0]; check(); } } });
(async () => {
  const c = await api.getConfig();
  LANG = c.lang || guessLang(); applyI18n();
  if (!c.hideWelcome) $('welcome').classList.add('show');
  $('cfkey').value = c.cfKey || ''; $('loader').value = c.loader || 'Auto'; setLoaderIcon(); $('mc').value = c.mc || '';
  render();
  await importPaths(c.files && c.files.length ? c.files : [await api.defaultDir()]);
})();
