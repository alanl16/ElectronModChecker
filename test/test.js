const AdmZip = require('adm-zip'), fs = require('fs'), os = require('os'), path = require('path');
const { parseJar } = require('../src/jar');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mods-'));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
let z = new AdmZip();
z.addFile('fabric.mod.json', Buffer.from(JSON.stringify({ id: 'animatica', name: 'Animatica', version: '0.6.1+1.21', icon: 'assets/icon.png', depends: { minecraft: '~1.21.11' } })));
z.addFile('assets/icon.png', png); z.writeZip(path.join(dir, 'animatica.jar'));
z = new AdmZip();
z.addFile('META-INF/neoforge.mods.toml', Buffer.from('[[mods]]\nmodId="foo"\ndisplayName="Foo"\nversion="1.2.3"\n[[dependencies.foo]]\nmodId="minecraft"\nversionRange="[1.21.1,1.22)"\n'));
z.writeZip(path.join(dir, 'foo.jar'));
const a = parseJar(path.join(dir, 'animatica.jar')), b = parseJar(path.join(dir, 'foo.jar'));
console.log(a.name, a.version, a.loader, a.mcVersion, !!a.icon, a.sha1.slice(0, 8), a.fingerprint);
console.log(b.name, b.version, b.loader, b.mcVersion);
const assert = require('assert');
assert.equal(a.loader, 'Fabric'); assert.equal(a.mcVersion, '1.21.11'); assert.ok(a.icon);
assert.equal(b.loader, 'NeoForge'); assert.equal(b.name, 'Foo');
console.log('parse OK');
(async () => {
  try {
    const { checkModrinth } = require('../src/modrinth');
    const r = await checkModrinth([{ sha1: a.sha1, loader: 'Fabric' }], '1.21.11');
    console.log('modrinth reachable, matches:', r.size);
  } catch (e) { console.log('modrinth network:', e.message); }
})();
