// HTTP rehearsal of this collection, NOT Postman/Newman or their JavaScript runtime.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Script, createContext } from 'node:vm';
import fixture from './postman-fixture.cjs';

const collectionPath = new URL('../../docs/validation/NexoGuard.postman_collection.json', import.meta.url);
const collection = JSON.parse(await readFile(collectionPath, 'utf8'));

test('colección acotada, sin endpoints de ejecución ni secretos persistidos', () => {
  assert.equal(collection.item.length, 26);
  const permitted = /^(?:\/users(?:\/registration-token)?|\/auth\/(?:me|csrf|login|logout)|\/sites(?:\/\{\{(?:ownSite|foreignSite)\}\}\/analyses(?:\/\{\{(?:ownAnalysis|foreignAnalysis)\}\})?)?)$/;
  for (const item of collection.item) {
    assert.ok(item.request.url.startsWith('{{baseUrl}}'));
    assert.match(item.request.url.slice('{{baseUrl}}'.length), permitted);
    assert.equal(item.protocolProfileBehavior.followRedirects, false);
    assert.equal(item.protocolProfileBehavior.disableCookies, true);
    assert.ok(['GET', 'POST'].includes(item.request.method));
  }
  assert.deepEqual(collection.variable.filter(v => /password|cookie|token|secret/i.test(v.key)), []);
  assert.equal(collection.variable.find(v => v.key === 'baseUrl').value, 'http://127.0.0.1:38381');
});

test('26 solicitudes HTTP contra Nest aislado; persistencia en memoria y guardas reales', { timeout: 60000 }, async () => {
  // Never load dotenv or AppModule; don't inherit credentials into the fixture.
  const previous = { ...process.env };
  delete process.env.DATABASE_URL;
  delete process.env.FRONTEND_ORIGIN;
  process.env.NEXOGUARD_HTTP_MODE = 'local';
  process.env.SSLLABS_ENABLED = 'false';
  let app;
  const rows = [];
  try {
    ({ app } = await fixture.startFixture());
    const vars = new Map(collection.variable.map(v => [v.key, v.value]));
    const substitute = str => str.replace(/\{\{([^}]+)\}\}/g, (_, name) => {
      if (name === '$randomUUID') return randomUUID();
      assert.ok(vars.has(name), 'Variable requerida ausente.'); return vars.get(name);
    });
    for (const item of collection.item) {
      let assertions = 0;
      const failures = [];
      const context = createContext({ pm: {
        variables: { get: name => vars.get(name), set: (name, value) => vars.set(name, value), replaceIn: substitute },
        test: (name, fn) => { assertions++; try { fn(); } catch { failures.push(name); } },
        expect: value => ({ to: { equal: expected => assert.deepEqual(value, expected) } }),
      } });
      const execute = event => new Script(event.script.exec.join('\n')).runInContext(context, { timeout: 1000 });
      collection.event.filter(e => e.listen === 'prerequest').forEach(execute);
      const url = new URL(substitute(item.request.url));
      assert.equal(url.origin, 'http://127.0.0.1:38381');
      const response = await fetch(url, {
        method: item.request.method,
        headers: Object.fromEntries(item.request.header.map(h => [h.key, substitute(h.value)])),
        ...(item.request.body ? { body: substitute(item.request.body.raw) } : {}),
        redirect: 'error', signal: AbortSignal.timeout(10000),
      });
      const text = await response.text();
      context.pm.response = {
        code: response.status, text: () => text, json: () => JSON.parse(text),
        headers: {
          get: name => response.headers.get(name),
          all: () => [...response.headers].filter(([key]) => key !== 'set-cookie').map(([key, value]) => ({ key, value })).concat(response.headers.getSetCookie().map(value => ({ key: 'set-cookie', value }))),
        },
      };
      item.event.filter(e => e.listen === 'test').forEach(execute);
      rows.push({ case: item.name.split(' ')[0], status: response.status, assertions, failures });
    }
    const report = { tool: 'Node native fetch + limited pm shim; NOT Postman/Newman', timestampUtc: new Date().toISOString(), target: 'Nest loopback 38381, fictitious memory adapter; NOT MySQL', externalRequests: 0, cases: rows, assertions: rows.reduce((n, r) => n + r.assertions, 0), failedAssertions: rows.reduce((n, r) => n + r.failures.length, 0) };
    await writeFile(new URL('../../docs/validation/http-rehearsal-results.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
    for (const row of rows) console.log(`${row.case}: HTTP ${row.status}; ${row.assertions - row.failures.length}/${row.assertions} aserciones`);
    assert.equal(report.failedAssertions, 0, 'Aserciones fallidas; revisar informe agregado sin secretos.');
  } finally {
    if (app) await app.close();
    process.env = previous;
  }
});
