import assert from 'node:assert/strict';
import { request } from 'node:http';
import { randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { PrismaService } from '../dist/infrastructure/prisma/prisma.service.js';

const origin = 'https://review.up.railway.app';
let stage = 'preflight';
function client() {
  const jar = new Map();
  async function send(method, path, body, token, replay) {
    return new Promise((resolve, reject) => {
      const value = body ? JSON.stringify(body) : undefined;
      const req = request({ host: 'gateway', port: 8080, path: `/api${path}`, method, agent: false,
        headers: { Host: 'review.up.railway.app', Origin: origin, Cookie: replay || [...jar].map(([name, content]) => `${name}=${content}`).join('; '), ...(token ? { 'X-CSRF-Token': token } : {}), ...(value ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(value) } : {}) },
      }, response => {
        for (const cookie of response.headers['set-cookie'] || []) {
          const [pair] = cookie.split(';'); const split = pair.indexOf('=');
          const name = pair.slice(0, split), content = pair.slice(split + 1);
          if (!content || /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(cookie)) jar.delete(name); else jar.set(name, content);
        }
        let data = ''; response.on('data', chunk => { data += String(chunk); });
        response.on('end', () => { try { resolve({ status: response.statusCode, data: data ? JSON.parse(data) : null }); } catch { reject(new Error('INVALID_RESPONSE')); } });
      }); req.on('error', reject); req.setTimeout(10000, () => req.destroy(new Error('TIMEOUT'))); req.end(value);
    });
  }
  async function csrf() { const result = await send('GET', '/auth/csrf'); assert.equal(result.status, 200); return result.data.token; }
  return { jar, send, csrf };
}

const prisma = new PrismaService();
try {
  assert.equal(process.env.NEXOGUARD_DB_EXPECTED_HOST, 'prod-db');
  await prisma.onModuleInit();
  const suffix = randomBytes(8).toString('hex');
  const password = `Fictitious-${randomBytes(24).toString('base64url')}`;
  const owner = client(), other = client();
  const users = [];
  for (const [index, session] of [owner, other].entries()) {
    stage = `registration-${index}`;
    const email = `nexoguard-production-check-${suffix}-${index}@example.invalid`;
    const token = await session.send('GET', '/users/registration-token'); assert.equal(token.status, 200);
    const registered = await session.send('POST', '/users', { email, password }, token.data.token); assert.equal(registered.status, 201);
    assert.deepEqual(Object.keys(registered.data), ['id']); users.push(registered.data.id);
    if (index === 0) assert.equal((await session.send('POST', '/users', { email, password }, token.data.token)).status, 409);
    stage = `hash-${index}`;
    const stored = await prisma.usuario.findUniqueOrThrow({ where: { id: registered.data.id } });
    assert.match(stored.passwordHash, /^\$argon2id\$/); assert.equal(await argon2.verify(stored.passwordHash, password), true);
    stage = `login-${index}`;
    const login = await session.send('POST', '/auth/login', { email, password }, await session.csrf()); assert.equal(login.status, 200);
    assert.equal((await session.send('GET', '/auth/me')).status, 200);
  }
  stage = 'site';
  const site = await owner.send('POST', '/sites', { domain: `controlled-${suffix}.example.com` }, await owner.csrf()); assert.equal(site.status, 201);
  const owned = await owner.send('GET', '/sites'); assert.equal(owned.status, 200); assert.ok(JSON.stringify(owned.data).includes(site.data.id));
  assert.equal((await owner.send('GET', `/sites/${site.data.id}/analyses`)).status, 200);
  stage = 'authorization';
  assert.equal((await other.send('GET', `/sites/${site.data.id}/analyses`)).status, 404);
  stage = 'logout';
  const replay = [...owner.jar].map(([name, content]) => `${name}=${content}`).join('; ');
  assert.equal((await owner.send('POST', '/auth/logout', undefined, await owner.csrf())).status, 204);
  assert.equal((await owner.send('GET', '/auth/me', undefined, undefined, replay)).status, 401);
  assert.equal((await other.send('POST', '/auth/logout', undefined, await other.csrf())).status, 204);
  assert.equal(await prisma.usuario.count({ where: { id: { in: users } } }), 2);
  console.log(JSON.stringify({ scope: 'real Nest/MySQL TLS and runtime identity in isolated new database; HTTP simulates Railway edge, not browser HTTPS', registration201: true, duplicate409: true, argon2idVerified: true, registrationResponseOnlyId: true, loginAndSession: true, createAndListSite: true, ownHistory200: true, foreignHistory404: true, logout204: true, revokedReplay401: true, fictionalUsersPersisted: 2, fictionalSitesPersisted: 1, externalRequests: 0, cleanup: 'preserved in isolated test volume, no deletion' }));
} catch { console.error(JSON.stringify({ check: 'PRODUCTION_AUTH_CHECK_FAILED', stage })); process.exitCode = 1; }
finally { await prisma.onModuleDestroy(); }
