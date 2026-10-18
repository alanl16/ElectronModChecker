const assert = require('assert');
const V = (id, num, gv, date, type = 'release') => ({ id, version_number: num, game_versions: gv, date_published: date, version_type: type, files: [{ primary: true, url: 'https://cdn/' + id + '.jar', filename: id + '.jar' }] });
global.fetch = async (url, o = {}) => {
  const j = d => ({ ok: true, status: 200, json: async () => d });
  if (url.endsWith('/version_files')) return j({ AAA: { id: 'a1', project_id: 'P1', version_number: '1.0', date_published: '2026-01-01' }, BBB: { id: 'b1', project_id: 'P2', version_number: '2.0', date_published: '2026-01-01' }, CCC: { id: 'c2', project_id: 'P3', version_number: '3.0', date_published: '2026-01-01' } });
  if (url.endsWith('/version_files/update')) { const b = JSON.parse(o.body); const m = { AAA: V('a2', '1.1', ['26.3', '26.2'], '2026-09-01'), CCC: V('c2', '3.0', ['26.3'], '2026-09-01') }; return j(Object.fromEntries(b.hashes.filter(h => m[h]).map(h => [h, m[h]]))); }
  if (url.includes('/projects?')) return j([{ id: 'P1', slug: 'one', icon_url: null }, { id: 'P2', slug: 'two' }, { id: 'P3', slug: 'three' }]);
  if (url.includes('/project/P1/')) return j([V('a1', '1.0', ['1.21.11'], '2026-01-01'), V('a2', '1.1', ['26.3', '26.2'], '2026-09-01')]);
  if (url.includes('/project/P2/')) return j([V('b1', '2.0', ['1.21.11', '1.21.10'], '2026-01-01')]);   // stuck
  if (url.includes('/project/P3/')) return j([V('c2', '3.0', ['26.3'], '2026-09-01')]);                  // already ready
  throw new Error('unexpected ' + url);
};
const { checkModrinth } = require('../src/modrinth');
(async () => {
  const r = await checkModrinth([{ sha1: 'AAA', loader: 'Fabric' }, { sha1: 'BBB', loader: 'Fabric' }, { sha1: 'CCC', loader: 'Fabric' }], '26.3');
  assert.deepStrictEqual([r.get('AAA').hasTarget, r.get('AAA').updateAvailable, r.get('AAA').latestVersion], [true, true, '1.1']);
  assert.deepStrictEqual([r.get('BBB').hasTarget, r.get('BBB').newestMc], [false, '1.21.11']);
  assert.deepStrictEqual([r.get('CCC').hasTarget, r.get('CCC').isCurrent], [true, true]);
  console.log('modrinth logic OK', r.get('BBB').supported);
})();
