// Reads a mod .jar: name, version, loader, MC version, icon
const AdmZip = require('adm-zip');
const toml = require('@iarna/toml');
const crypto = require('crypto');
const fs = require('fs');

function sha1(buf) { return crypto.createHash('sha1').update(buf).digest('hex'); }

// CurseForge fingerprint: MurmurHash2 (seed 1) over bytes minus whitespace (9,10,13,32)
function curseFingerprint(buf) {
  const data = [];
  for (const b of buf) if (b !== 9 && b !== 10 && b !== 13 && b !== 32) data.push(b);
  const m = 0x5bd1e995, len = data.length;
  let h = (1 ^ len) >>> 0, i = 0;
  for (; i + 4 <= len; i += 4) {
    let k = (data[i] | (data[i + 1] << 8) | (data[i + 2] << 16) | (data[i + 3] << 24)) >>> 0;
    k = Math.imul(k, m) >>> 0; k ^= k >>> 24; k = Math.imul(k, m) >>> 0;
    h = Math.imul(h, m) >>> 0; h = (h ^ k) >>> 0;
  }
  switch (len - i) {
    case 3: h ^= data[i + 2] << 16;
    case 2: h ^= data[i + 1] << 8;
    case 1: h ^= data[i]; h = Math.imul(h, m) >>> 0;
  }
  h ^= h >>> 13; h = Math.imul(h, m) >>> 0; h ^= h >>> 15;
  return h >>> 0;
}

function readText(zip, name) {
  const e = zip.getEntry(name);
  return e ? e.getData().toString('utf8') : null;
}

// strip a Fabric-style version predicate to something readable
function mcFromRange(r) {
  if (!r) return null;
  if (Array.isArray(r)) r = r.join(' || ');
  const m = String(r).match(/\d+\.\d+(?:\.\d+)?/g);
  return m ? [...new Set(m)].join(' / ') : String(r);
}

function rangeStr(r) {
  if (!r) return null;
  if (Array.isArray(r)) return r.filter(x => typeof x === 'string').join(' || ') || null;
  return typeof r === 'string' ? r : null;
}

function parseJar(file) {
  const buf = fs.readFileSync(file);
  const info = {
    file, fileName: require('path').basename(file),
    sha1: sha1(buf), fingerprint: curseFingerprint(buf),
    name: null, version: null, loader: 'Unknown', mcVersion: null, icon: null, id: null,
    mcRange: null, deps: [], provides: [], nested: [],
  };
  let zip;
  try { zip = new AdmZip(buf); } catch { info.name = info.fileName; return info; }

  let iconPath = null;
  const fabric = readText(zip, 'fabric.mod.json');
  const quilt = readText(zip, 'quilt.mod.json');
  const neo = readText(zip, 'META-INF/neoforge.mods.toml');
  const forge = readText(zip, 'META-INF/mods.toml');
  try {
    if (fabric) {
      const j = JSON.parse(fabric.replace(/^﻿/, ''));
      info.loader = 'Fabric'; info.id = j.id; info.name = j.name || j.id; info.version = j.version;
      info.mcVersion = mcFromRange(j.depends && j.depends.minecraft);
      iconPath = typeof j.icon === 'string' ? j.icon : j.icon && Object.values(j.icon).pop();
      const dep = j.depends || {};
      info.mcRange = rangeStr(dep.minecraft);
      info.deps = Object.entries(dep).map(([id, range]) => ({ id, range: rangeStr(range) }));
      info.provides = (j.provides || []).map(x => typeof x === 'string' ? x : x.id).filter(Boolean);
      for (const jr of j.jars || []) {
        try {
          const e = zip.getEntry(jr.file); if (!e) continue;
          const nj = new AdmZip(e.getData()).getEntry('fabric.mod.json'); if (!nj) continue;
          const n = JSON.parse(nj.getData().toString('utf8').replace(/^\uFEFF/, ''));
          info.nested.push(n.id, ...(n.provides || []).map(x => typeof x === 'string' ? x : x.id));
        } catch {}
      }
    } else if (quilt) {
      const j = JSON.parse(quilt); const l = j.quilt_loader || {};
      info.loader = 'Quilt'; info.id = l.id; info.name = (l.metadata && l.metadata.name) || l.id; info.version = l.version;
      const dep = (l.depends || []).find(d => d.id === 'minecraft');
      info.mcVersion = dep && mcFromRange(dep.versions);
      info.mcRange = dep && rangeStr(dep.versions);
      info.deps = (l.depends || []).filter(d => typeof d === 'string' || !d.optional).map(d => typeof d === 'string' ? { id: d } : { id: d.id, range: rangeStr(d.versions) });
      info.provides = (l.provides || []).map(x => typeof x === 'string' ? x : x.id).filter(Boolean);
      const ic = l.metadata && l.metadata.icon; iconPath = typeof ic === 'string' ? ic : ic && Object.values(ic).pop();
    } else if (neo || forge) {
      const t = toml.parse(neo || forge);
      info.loader = neo ? 'NeoForge' : 'Forge';
      const m = (t.mods || [])[0] || {};
      info.id = m.modId; info.name = m.displayName || m.modId; info.version = m.version;
      if (info.version === '${file.jarVersion}') {
        const mf = readText(zip, 'META-INF/MANIFEST.MF') || '';
        const v = mf.match(/Implementation-Version:\s*(.+)/); info.version = v ? v[1].trim() : null;
      }
      const deps = (t.dependencies && t.dependencies[m.modId]) || [];
      const mc = deps.find(d => d.modId === 'minecraft');
      info.mcVersion = mc && mcFromRange(mc.versionRange);
      info.mcRange = mc ? rangeStr(mc.versionRange) : null;
      info.deps = deps.filter(d => (neo ? (d.type || 'required') === 'required' : d.mandatory === true)).map(d => ({ id: d.modId, range: rangeStr(d.versionRange) }));
      info.provides = (t.mods || []).slice(1).map(x => x.modId).filter(Boolean);
      iconPath = m.logoFile || t.logoFile;
    }
  } catch (e) { info.error = e.message; }

  if (!info.name) info.name = info.fileName.replace(/\.jar$/, '');
  if (!info.version) { const v = info.fileName.match(/(\d+\.\d+[\w.+-]*)\.jar$/); info.version = v ? v[1] : null; }
  if (iconPath) {
    const e = zip.getEntry(iconPath.replace(/^\//, ''));
    if (e) info.icon = 'data:image/png;base64,' + e.getData().toString('base64');
  }
  return info;
}

module.exports = { parseJar, sha1, curseFingerprint };
