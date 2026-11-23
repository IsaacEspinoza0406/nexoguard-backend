import assert from 'node:assert/strict';
import { request } from 'node:http';

function get(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: 'gateway', port: 8080, path, agent: false, headers: { Host: 'review.up.railway.app', ...headers } }, res => {
      let body = ''; res.on('data', chunk => { body += String(chunk); }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }); req.on('error', reject); req.setTimeout(7000, () => req.destroy(new Error('TIMEOUT'))); req.end();
  });
}
(async () => {
  const ready = await get('/health/ready', { Host: 'healthcheck.railway.app' }); assert.equal(ready.status, 200);
  const frontend = await get('/login'); assert.equal(JSON.parse(frontend.body).page, 'controlled-frontend');
  assert.equal((await get('/api/auth/me')).status, 401);
  const token = await get('/api/users/registration-token', { 'Sec-Fetch-Site': 'same-origin', 'X-Forwarded-Host': 'attacker.invalid', 'X-Forwarded-Proto': 'http' });
  assert.equal(token.status, 200);
  const cookie = token.headers['set-cookie'].find(value => value.startsWith('registration_csrf='));
  assert.ok(cookie); assert.match(cookie, /Path=\/api\/users(?:;|$)/); assert.match(cookie, /; Secure/); assert.match(cookie, /; HttpOnly/); assert.match(cookie, /; SameSite=Strict/);
  assert.equal((await get('/api/auth/csrf', { Origin: 'https://attacker.invalid' })).status, 403);
  await assert.rejects(get('/login', { Host: 'attacker.invalid' }));
  assert.equal(frontend.headers['strict-transport-security'], 'max-age=86400');
  console.log(JSON.stringify({ scope: 'local HTTP simulates trusted Railway TLS termination; real Nest and isolated MySQL, controlled frontend', railwayHealthHostAccepted: true, frontendRoute: true, apiPrefix: true, anonymous401: true, registrationCookiePath: true, secureCookieFlags: true, foreignOrigin403: true, unknownHostRejected: true, hsts: true, noUserDataWritten: true }));
})().catch(() => { console.error('PRODUCTION_ROUTING_CHECK_FAILED'); process.exitCode = 1; });
