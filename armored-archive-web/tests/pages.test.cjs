const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');

test('Pages artifact has all entry-point assets and excludes backend state', () => {
  const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  for (const match of html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"?#]+)[^"]*"/g)) {
    assert.ok(!match[1].startsWith('/'), 'Asset must work under a repository path: ' + match[1]);
    assert.ok(fs.existsSync(path.join(dist, match[1])), 'Missing asset: ' + match[1]);
  }
  for (const file of ['server.js', 'backend_data', 'local_assets', 'display_probe.cjs', 'package.json', 'tests']) {
    assert.ok(!fs.existsSync(path.join(dist, file)), 'Private/server file copied: ' + file);
  }
  assert.ok(fs.existsSync(path.join(dist, '.nojekyll')));
});

test('static gallery uses repository-relative JSON, direct images, and no API', async () => {
  const nodes = new Map();
  const node = () => ({ textContent: '', classList: { add() {} }, append() {}, after() {}, closest() { return this; } });
  const get = id => { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); };
  const requests = [];
  const context = {
    URL, console, location: { origin: 'https://example.github.io' },
    document: { baseURI: 'https://example.github.io/ARMORED-ARCHIVE/', createElement: node },
    $: get, family: 'iv', variant: 'h', current: () => ({ id: 'h' }),
    mediaRevision: 0, curKey: '', items: [], initMedia() {}, setSrc() {}, renderAmmo() {},
    renderArmor() {}, renderShells() {}, clearMedia() {}, drawThumbs() {}, show() {},
    fetch: async url => {
      requests.push(String(url));
      return { ok: true, json: async () => ({ vehicles: { 'iv:h': { links: [], photos: [
        { title: 'Assigned photo', thumb: '/backend_data/images/missing.jpg', upstream: '/api/image?url=https%3A%2F%2Fupload.wikimedia.org%2Fexample.jpg' },
        { title: 'Invalid protocol', upstream: 'javascript:alert(1)' },
      ] } } }) };
    },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'pages.js'), 'utf8'), context);
  // Shared ammunition cards still have their escaping/link helpers without combat_ui.js.
  vm.runInContext(fs.readFileSync(path.join(root, 'ammo_details.js'), 'utf8'), context);
  context.COMBAT_DATA = { retrieved: '2026-10-08' };
  const card = context.ammoDetails({name:'Test <shell>',type:'AP',kind:'shot',props:{},pen:[10]}, {name:'Tank',source:'https://example.com'});
  assert.match(card, /Test &lt;shell&gt;/);
  assert.match(card, /https:\/\/example.com/);
  await context.initMedia();
  assert.deepEqual(requests, ['https://example.github.io/ARMORED-ARCHIVE/gallery_library.json']);
  assert.equal(context.items.length, 1);
  assert.equal(context.items[0].thumb, 'https://upload.wikimedia.org/example.jpg');
  assert.match(get('mediaNote').textContent, /original hosts/);
  assert.equal(get('mediaLinks').textContent, '');
});
