// Minecraft release versions like 1.21.11 and 26.3
const isRelease = v => /^\d+\.\d+(\.\d+)?$/.test(v);
const parts = v => String(v).split('.').map(n => parseInt(n, 10) || 0);
const cmp = (a, b) => { const x = parts(a), y = parts(b); for (let i = 0; i < 3; i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; } return 0; };
const newest = list => list.filter(isRelease).sort(cmp).pop() || null;

// Does Minecraft version `ver` satisfy a mod's declared range? true / false / null (can't tell)
function mcSatisfies(range, ver) {
  if (!range || !isRelease(ver)) return null;
  range = String(range).trim();
  // Maven style used by Forge/NeoForge: [1.21,1.22)  (1.21,)  [1.21.1]
  if (/^[\[(]/.test(range)) {
    const alts = range.match(/[\[(][^\])]*[\])]/g) || [];
    if (!alts.length) return null;
    return alts.some(a => {
      const lo_inc = a[0] === '[', hi_inc = a[a.length - 1] === ']';
      const body = a.slice(1, -1);
      if (!body.includes(',')) return cmp(ver, body.trim()) === 0;
      const [lo, hi] = body.split(',').map(x => x.trim());
      if (lo && (lo_inc ? cmp(ver, lo) < 0 : cmp(ver, lo) <= 0)) return false;
      if (hi && (hi_inc ? cmp(ver, hi) > 0 : cmp(ver, hi) >= 0)) return false;
      return true;
    });
  }
  if (range === '*' || range === '') return true;
  // Fabric/Quilt style: ">=1.21 <1.22 || ~26.3 || 1.21.x"
  let unknown = false;
  const ok = range.split('||').some(alt => alt.trim().split(/\s+/).filter(Boolean).every(tok => {
    let m;
    if ((m = tok.match(/^(>=|<=|>|<|=|~|\^)?v?(\d+(?:\.\d+)*)(?:\.[xX*])?(-.*)?$/))) {
      const op = m[1] || '', base = m[2], wild = /[xX*]$/.test(tok.replace(/(-.*)$/, ''));
      const n = base.split('.').length;
      if (wild || (!op && n < 3 && /\.[xX*]/.test(tok))) { const p = parts(base); return parts(ver).slice(0, p.length).every((v, i) => v === p[i]); }
      const c = cmp(ver, base);
      switch (op) {
        case '>=': return c >= 0; case '<=': return c <= 0; case '>': return c > 0; case '<': return c < 0;
        case '~': { const p = parts(base); return c >= 0 && parts(ver)[0] === p[0] && (p.length < 2 || parts(ver)[1] === p[1]); }
        case '^': return c >= 0 && parts(ver)[0] === parts(base)[0];
        default: return c === 0;
      }
    }
    unknown = true; return true;
  }));
  return unknown && ok ? null : ok;
}
module.exports = { isRelease, cmp, newest, mcSatisfies };
