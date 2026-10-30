const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, '../dist/live.js'), 'utf8');

function setup(route, token) {
  const elements = new Map();
  const storage = new Map(token ? [['librarium-access', token]] : []);
  const element = key => {
    if (!elements.has(key)) elements.set(key, { innerHTML: '', disabled: false, events: {}, addEventListener(name, fn) { this.events[name] = fn; } });
    return elements.get(key);
  };
  const handlers = [{ attrs: { onclick: 'openBook(12345678-1234-1234-1234-123456789abc)', onkeydown: "if(event.key==='Enter')openBook(12345678-1234-1234-1234-123456789abc)" }, getAttribute(k) { return this.attrs[k]; }, setAttribute(k, v) { this.attrs[k] = v; } }];
  const choices = [0, 1, 2].map(i => ({ dataset: { libraryChoice: String(i) }, addEventListener(name, fn) { this[name] = fn; } }));
  const requests = [];
  const context = {
    localStorage: { getItem: () => '1', removeItem() {}, setItem() {} },
    sessionStorage: { getItem: k => storage.get(k), removeItem: k => storage.delete(k), setItem: (k, v) => storage.set(k, String(v)) },
    document: { createElement: () => ({}), head: { appendChild() {} }, getElementById: element,
      querySelector: element, querySelectorAll: selector => selector.includes('data-library-choice') ? choices : handlers },
    fetch: async (url, options) => { requests.push({ url, options }); const response = await route(url, options); return { ok: response.status < 400, status: response.status, json: async () => response.body }; },
    FormData: class { constructor(form) { this.values = Object.entries(form.fields); } [Symbol.iterator]() { return this.values[Symbol.iterator](); } },
    books: [], seriesData: [], owner: 'Safi', render() {}, esc: s => String(s ?? '').replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll("'", '&#39;'),
    toast() {}, show(html) { context.modal.html = html; }, shelfOptions: () => '', modal: { close() {} },
    setTimeout, clearTimeout, console
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source, context);
  return { context, element, requests, storage, handlers, choices };
}
const json = data => ({ status: 200, body: { data } });
const libraries = [{ id: 'lib1', name: "Safi's Library" }, { id: 'lib2', name: 'Adam' }];
const book = id => ({ id, title: 'Real book ' + id, contributors: [{ name: 'Real author', role: 'author' }], shelves: [{ id: 's1', name: 'A2' }] });
async function signIn(env) {
  const button = {};
  await env.element('liveLogin').events.submit({ preventDefault() {}, currentTarget: { fields: { identifier: 'test', password: 'test-only' }, querySelector: () => button } });
}

test('unwraps login and catalogue, loads all pages, sends bearer token, repairs UUID links', async () => {
  const env = setup((url, options) => {
    if (url.endsWith('/auth/login')) return json({ access_token: 'test-token' });
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    if (url.endsWith('/libraries')) return json(libraries);
    if (url.endsWith('/shelves')) return json([]);
    if (url.includes('/lib1/books')) return json({ items: url.includes('page=1&') ? [book('one'), book('two')] : [book('three')], total: 3, per_page: 2 });
    return json({ items: [], total: 0 });
  });
  await signIn(env);
  assert.equal(env.storage.get('librarium-access'), 'test-token');
  assert.equal(env.context.books.length, 3);
  assert.equal(env.context.books[0].author, 'Real author');
  assert.equal(env.context.books[0].shelf, 'A2');
  assert.ok(env.requests.some(r => r.url.includes('page=2')));
  assert.ok(env.handlers[0].attrs.onclick.includes('openBook("12345678-1234-1234-1234-123456789abc")'));
  assert.ok(!env.element('owners').innerHTML.includes('onclick="owner='));
  env.choices[1].click();
  assert.equal(env.context.owner, 'Adam');
  assert.ok(env.context.row({ id: 'uuid', title: 'Book', owner: 'Adam' }).includes('openBook(&quot;uuid&quot;)'));
});

test('invalid credentials show a visible error and never save an undefined token', async () => {
  const env = setup(() => ({ status: 401, body: { error: 'invalid credentials' } }));
  await signIn(env);
  assert.match(env.element('content').innerHTML, /role="alert".*Username or password/);
  assert.equal(env.storage.has('librarium-access'), false);
  assert.equal(env.requests.length, 1);
});

test('rejects a missing access token before any catalogue request', async () => {
  const env = setup(() => json({ user: {} }));
  await signIn(env);
  assert.match(env.element('content').innerHTML, /did not include an access token/);
  assert.equal(env.storage.has('librarium-access'), false);
  assert.equal(env.requests.length, 1);
});

test('old poisoned session is cleared, navigation cannot dismiss sign-in', () => {
  const env = setup(() => { throw new Error('must not request'); }, 'undefined');
  env.context.render();
  assert.equal(env.requests.length, 0);
  assert.equal(env.storage.has('librarium-access'), false);
  assert.match(env.element('content').innerHTML, /id="liveLogin"/);
});

test('empty membership is explicit; failure loading books remains visible', async () => {
  for (const empty of [true, false]) {
    const env = setup(url => url.endsWith('/auth/login') ? json({ access_token: 'test' }) : url.endsWith('/libraries') ? json(empty ? [] : libraries) : url.endsWith('/shelves') ? json([]) : { status: 502, body: { error: 'Backend unavailable' } });
    await signIn(env);
    assert.match(env.element('content').innerHTML, empty ? /no accessible libraries/ : /role="alert".*Backend unavailable/);
  }
});
