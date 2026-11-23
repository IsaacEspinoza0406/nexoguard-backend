import assert from 'node:assert/strict';
import { request } from 'node:https';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire('/app/package.json');
const argon2 = require('argon2');
const { PrismaService } = require('/app/dist/infrastructure/prisma/prisma.service.js');
const prisma = new PrismaService();
const host = process.env.PUBLIC_HOST;
const ca = readFileSync('/run/secrets/ca.pem');
let stage = 'preflight';
function client() {
  const jar = new Map(); let csrf;
  async function send(method, path, body, token, extra = {}) {
    return new Promise((resolve, reject) => {
      const value = body === undefined ? undefined : JSON.stringify(body);
      const cookies = [...jar.values()].filter(c => path.startsWith(c.path)).map(c => c.pair).join('; ');
      const req = request({ hostname: 'gateway', port: 8443, servername: host, ca, path, method, agent: false,
        headers: { Host: host, Origin: `https://${host}`, Cookie: cookies, ...(token ? { 'X-CSRF-Token': token } : {}), ...(value ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(value) } : {}), ...extra },
      }, res => {
        for (const cookie of res.headers['set-cookie'] || []) {
          const pair = cookie.split(';')[0], name = pair.split('=')[0];
          assert.match(cookie, /; Secure/i); assert.match(cookie, /; HttpOnly/i); assert.match(cookie, /; SameSite=Strict/i);
          if (/Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(cookie)) jar.delete(name);
          else jar.set(name, { pair, path: /; Path=([^;]+)/i.exec(cookie)?.[1] || '/' });
        }
        let text = ''; res.on('data', chunk => { text += chunk; });
        res.on('end', () => { let data; try { data = JSON.parse(text); } catch { data = text; } resolve({ status: res.statusCode, headers: res.headers, data }); });
      }); req.on('error', reject); req.setTimeout(15000, () => req.destroy(new Error('TIMEOUT'))); req.end(value);
    });
  }
  async function mutate(path, body) {
    if (!csrf) { const r = await send('GET', '/api/auth/csrf'); assert.equal(r.status, 200); csrf = r.data.token; }
    return send('POST', `/api${path}`, body, csrf);
  }
  return { send, mutate, reset: () => { csrf = undefined; }, jar };
}
try {
  assert.equal(process.env.NEXOGUARD_DB_EXPECTED_HOST, 'db');
  await prisma.onModuleInit();
  const owner = client(), other = client();
  const page = await owner.send('GET', '/login'); assert.equal(page.status, 200);
  const nonce = /'nonce-([^']+)'/.exec(page.headers['content-security-policy'])?.[1]; assert.ok(nonce);
  assert.ok(page.data.includes(`nonce="${nonce}"`));
  assert.equal((await owner.send('GET', '/api/auth/me')).status, 401);
  assert.equal((await owner.send('GET', '/api/auth/csrf', undefined, undefined, { Origin: 'https://attacker.invalid' })).status, 403);
  const password = `Fictitious-${randomBytes(24).toString('base64url')}`, suffix = randomBytes(8).toString('hex');
  for (const [index, session] of [owner, other].entries()) {
    stage = `registration-${index}`;
    const email = `nexoguard-ec2-${suffix}-${index}@example.invalid`;
    const token = await session.send('GET', '/api/users/registration-token'); assert.equal(token.status, 200);
    assert.equal([...session.jar.values()].find(c => c.pair.startsWith('registration_csrf='))?.path, '/api/users');
    const result = await session.send('POST', '/api/users', { email, password }, token.data.token);
    assert.equal(result.status, 201); assert.deepEqual(Object.keys(result.data), ['id']);
    const stored = await prisma.usuario.findUniqueOrThrow({ where: { id: result.data.id } });
    assert.match(stored.passwordHash, /^\$argon2id\$/); assert.equal(await argon2.verify(stored.passwordHash, password), true);
    if (!index) assert.equal((await session.send('POST', '/api/users', { email, password }, token.data.token)).status, 409);
    stage = `login-${index}`;
    assert.equal((await session.mutate('/auth/login', { email, password })).status, 200); session.reset();
    assert.equal((await session.send('GET', '/api/auth/me')).status, 200);
  }
  stage = 'site';
  const site = await owner.mutate('/sites', { domain: process.env.CONTROLLED_TARGET === 'true' ? 'ec2-target.example.com' : `controlled-${suffix}.example.com` }); assert.equal(site.status, 201);
  assert.equal((await owner.send('GET', '/api/sites')).status, 200);
  assert.equal((await owner.send('GET', `/api/sites/${site.data.id}/analyses`)).status, 200);
  assert.equal((await other.send('GET', `/api/sites/${site.data.id}/analyses`)).status, 404);
  assert.equal((await owner.send('POST', '/api/sites', { domain: 'unapproved.example.com' }, 'invalid')).status, 403);
  let engineChecks = {};
  if (process.env.CONTROLLED_TARGET === 'true') {
    writeFileSync('/state/improved', 'before');
    const path = `/sites/${site.data.id}`;
    stage = 'ownership';
    const challenge = await owner.mutate(`${path}/verification-challenges`); assert.equal(challenge.status, 201);
    writeFileSync('/state/ownership.txt', challenge.data.content, { mode: 0o600 });
    assert.equal((await owner.mutate(`${path}/verification-challenges/${challenge.data.id}/check`)).status, 200);
    const analyze = async () => {
      const start = await owner.mutate(`${path}/analyses`); assert.equal(start.status, 202);
      for (let i = 0; i < 45; i++) {
        const detail = await owner.send('GET', `/api${path}/analyses/${start.data.id}`); assert.equal(detail.status, 200);
        if (detail.data.estado === 'COMPLETADO') return start.data.id;
        assert.notEqual(detail.data.estado, 'FALLIDO');
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      throw new Error('CONTROLLED_ANALYSIS_TIMEOUT');
    };
    stage = 'analysis-before'; const before = await analyze();
    writeFileSync('/state/improved', 'after');
    stage = 'analysis-after'; const after = await analyze();
    stage = 'comparison';
    const comparison = await owner.send('GET', `/api${path}/analyses/compare/${before}/${after}`); assert.equal(comparison.status, 200);
    const checks = comparison.data.results;
    assert.ok(Array.isArray(checks));
    assert.deepEqual(checks.filter(c => c.change === 'MEJORO').map(c => c.code).sort(), ['FRAMING', 'HSTS']);
    assert.equal(checks.find(c => c.code === 'CSP').change, 'NO_COMPARABLE');
    assert.equal((await owner.send('GET', `/api${path}/analyses`)).data.length, 2);
    stage = 'schedule';
    assert.equal((await owner.mutate(`${path}/schedule`, { enabled: true, intervalMinutes: 1440 })).status, 200);
    assert.equal((await owner.send('GET', `/api${path}/schedule`)).status, 200);
    assert.equal((await owner.mutate(`${path}/schedule`, { enabled: false, intervalMinutes: 1440 })).status, 200);
    stage = 'alerts'; const alerts = await owner.send('GET', `/api${path}/alerts`); assert.equal(alerts.status, 200); assert.ok(alerts.data.length >= 1);
    engineChecks = { controlledTlsRpc: true, fileOwnershipVerified: true, completedAnalyses: 2, comparisonImprovements: 2, cspNotComparable: true, dailyScheduleSavedThenDisabled: true, controlledCertificateAlertPersisted: true };
  }
  stage = 'ssr';
  assert.equal((await owner.send('GET', '/cuenta')).status, 200);
  stage = 'logout';
  const replay = [...owner.jar.values()].map(c => c.pair).join('; ');
  assert.equal((await owner.mutate('/auth/logout')).status, 204);
  assert.equal((await owner.send('GET', '/api/auth/me', undefined, undefined, { Cookie: replay })).status, 401);
  assert.equal((await other.mutate('/auth/logout')).status, 204);
  console.log(JSON.stringify({ scope: 'real HTTPS with local CA, real Next/Nest/MySQL isolated; not public TLS', frontendCspNonce: true, registration201: true, duplicate409: true, responseOnlyId: true, secureHttpOnlyStrictCookies: true, csrfCookiePath: true, foreignOrigin403: true, invalidCsrf403: true, loginAndSession: true, siteCreationAndHistory: true, foreignHistory404: true, authenticatedSsr: true, logoutAndRevocation: true, ...engineChecks, fictionalUsers: 2, fictionalSites: 1, externalRequests: 0 }));
} catch { console.error(JSON.stringify({ check: 'EC2_HTTPS_CHECK_FAILED', stage })); process.exitCode = 1; }
finally { await prisma.onModuleDestroy(); }
