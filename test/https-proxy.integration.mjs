// Verified local TLS, isolated fictitious persistence. Not a public deployment/browser test.
import { request } from 'node:https';
import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const ca = await readFile(new URL('../../bd/private-backups/validation-20261122/tls/server.crt', import.meta.url));
const cookies = new Map(), cases = [];
function send(path, method = 'GET', body, extra = {}) {
  return new Promise((resolve, reject) => {
    const jar = [...cookies].filter(([, c]) => path.startsWith(c.path)).map(([name, c]) => `${name}=${c.value}`).join('; ');
    const req = request({ hostname: 'localhost', port: 38443, path, method, ca, rejectUnauthorized: true, agent: false,
      headers: { 'sec-fetch-site': 'same-origin', cookie: jar, ...(method === 'POST' ? { origin: 'https://localhost:38443', 'content-type': 'application/json' } : {}), ...extra },
    }, res => {
      let text = '';
      res.on('data', b => { text += b; });
      res.on('end', () => {
        for (const line of res.headers['set-cookie'] || []) {
          const [pair, ...attrs] = line.split(';'); const idx = pair.indexOf('=');
          const name = pair.slice(0, idx), value = pair.slice(idx + 1);
          const path = attrs.map(x => x.trim()).find(x => /^path=/i.test(x))?.slice(5) || '/';
          if (value) cookies.set(name, { value, path }); else cookies.delete(name);
        }
        resolve({ status: res.statusCode, text, headers: res.headers, json: () => JSON.parse(text) });
      });
    });
    req.setTimeout(10000, () => req.destroy(new Error('Timeout local TLS'))); req.on('error', reject);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}
const check = (id, response, expected) => { assert.equal(response.status, expected, id); cases.push({ case: id, status: response.status, expected }); return response; };
try {
  const page = check('TLS01 UI y CSP', await send('/'), 200);
  assert.ok(page.headers['content-security-policy']?.includes('nonce-'));
  const registration = check('TLS02 CSRF GET sin Origin', await send('/api/users/registration-token'), 200);
  assert.equal(cookies.get('registration_csrf').path, '/api/users');
  assert.ok(registration.headers['set-cookie'][0].includes('Secure'));
  assert.ok(registration.headers['set-cookie'][0].includes('HttpOnly'));
  assert.ok(registration.headers['set-cookie'][0].includes('SameSite=Strict'));
  const body = { email: `tls-${randomUUID()}@example.invalid`, password: randomBytes(24).toString('hex') };
  const registrationToken = registration.json().token;
  const registered = check('TLS03 registro', await send('/api/users', 'POST', body, { 'x-csrf-token': registrationToken }), 201);
  assert.deepEqual(Object.keys(registered.json()), ['id']);
  check('TLS04 duplicado', await send('/api/users', 'POST', body, { 'x-csrf-token': registrationToken }), 409);
  const loginCsrf = check('TLS05 CSRF acceso', await send('/api/auth/csrf'), 200);
  check('TLS06 login', await send('/api/auth/login', 'POST', body, { 'x-csrf-token': loginCsrf.json().token }), 200);
  assert.ok(cookies.has('__Host-nexoguard_session'));
  const oldCookie = `__Host-nexoguard_session=${cookies.get('__Host-nexoguard_session').value}`;
  check('TLS07 sesión', await send('/api/auth/me'), 200);
  const account = check('TLS08 SSR privado y URL interna', await send('/cuenta'), 200);
  assert.ok(account.text.includes(body.email));
  assert.ok(!account.text.includes(body.password));
  assert.ok(!account.text.includes(oldCookie.split('=')[1]));
  check('TLS09 sitios propios', await send('/api/sites'), 200);
  check('TLS10 autorización ajena', await send('/api/sites/33333333-3333-4333-8333-333333333333/analyses'), 404);
  const bound = check('TLS11 CSRF sesión', await send('/api/auth/csrf'), 200);
  check('TLS12 origen ajeno', await send('/api/auth/logout', 'POST', undefined, { origin: 'https://other.example.invalid', 'x-csrf-token': bound.json().token }), 403);
  check('TLS13 logout', await send('/api/auth/logout', 'POST', undefined, { 'x-csrf-token': bound.json().token }), 204);
  check('TLS14 replay sesión revocada', await send('/api/auth/me', 'GET', undefined, { cookie: oldCookie }), 401);
  const report = { timestampUtc: new Date().toISOString(), environment: 'Local HTTPS with explicit CA/hostname verification, Nginx and separate memory fixture; NOT public or MySQL', tests: cases, failed: 0 };
  await writeFile(new URL('../../docs/validation/https-local-results.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log('HTTPS local: 14 casos aprobados; CA/nombre verificados, cookies Secure/HttpOnly/SameSite, CSRF, SSR, autorización y revocación. Sin MySQL.');
} catch { console.error(`HTTPS local no aprobado; ${cases.length} casos completados; detalles privados ocultos.`); process.exitCode = 1; }
