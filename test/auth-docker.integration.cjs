// Ejecutar dentro del contenedor backend con Node 24. Solo datos ficticios propios.
(async () => {
  await import('reflect-metadata');
  const { default: assert } = await import('node:assert/strict');
  const { randomUUID, createHash } = await import('node:crypto');
  const argon2 = await import('argon2');
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('./dist/app.module.js');
  const { PrismaService } = await import('./dist/infrastructure/prisma/prisma.service.js');
  const url = new URL(process.env.DATABASE_URL || '');
  assert.equal(url.hostname, 'db'); assert.equal(url.pathname, '/nexoguard_migration_test');
  assert.equal(process.env.NEXOGUARD_DB_MODE, 'local_unencrypted');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const prisma = app.get(PrismaService);
  const email = `nexoguard-auth-test-${randomUUID()}@example.invalid`;
  const password = 'clave-ficticia-para-integracion';
  const started = new Date(); let owned = false;
  const origin = 'http://127.0.0.1:3000'; const base = 'http://127.0.0.1:3001';
  const jar = new Map();
  const cookie = () => [...jar].map(([key, value]) => `${key}=${value}`).join('; ');
  async function request(path, method = 'GET', body, token, overrideCookie) {
    const response = await fetch(`${base}${path}`, { method, headers: { origin, cookie: overrideCookie ?? cookie(), ...(token ? { 'x-csrf-token': token } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    for (const entry of response.headers.getSetCookie()) { const [pair] = entry.split(';'); const index = pair.indexOf('='); const key = pair.slice(0, index); const value = pair.slice(index + 1); if (value) jar.set(key, value); else jar.delete(key); }
    return response;
  }
  async function authCsrf() { const r = await request('/auth/csrf'); assert.equal(r.status, 200); return (await r.json()).token; }
  async function login() { const r = await request('/auth/login', 'POST', { email, password }, await authCsrf()); assert.equal(r.status, 200); assert.deepEqual(Object.keys(await r.json()).sort(), ['email', 'id']); return jar.get('nexoguard_session'); }
  const hash = token => new Uint8Array(createHash('sha256').update(token).digest());
  try {
    assert.equal(await prisma.usuario.findUnique({ where: { correoNormalizado: email } }), null); owned = true;
    assert.equal((await request('/auth/me')).status, 401);
    const registration = await request('/users/registration-token'); assert.equal(registration.status, 200);
    const created = await request('/users', 'POST', { email, password }, (await registration.json()).token); assert.equal(created.status, 201);
    const user = await prisma.usuario.findUniqueOrThrow({ where: { correoNormalizado: email } });
    assert.ok(user.passwordHash.startsWith('$argon2id$')); assert.ok(await argon2.verify(user.passwordHash, password));
    console.log('Registro y hash real: OK');
    const invalid = await request('/auth/login', 'POST', { email, password: 'clave-equivocada-para-pruebas' }, await authCsrf()); assert.equal(invalid.status, 401);
    const first = await login(); assert.equal((await request('/auth/me')).status, 200);
    const second = await login(); assert.notEqual(first, second);
    assert.equal((await request('/auth/me', 'GET', undefined, undefined, `nexoguard_session=${first}`)).status, 401);
    assert.equal((await request('/auth/logout', 'POST')).status, 403);
    assert.equal((await request('/auth/logout', 'POST', undefined, await authCsrf())).status, 204);
    assert.equal((await request('/auth/me', 'GET', undefined, undefined, `nexoguard_session=${second}`)).status, 401);
    const stored = await prisma.sesion.findUniqueOrThrow({ where: { identificadorHash: hash(second) } });
    assert.ok(stored.revocadoEn); assert.notEqual(Buffer.from(stored.identificadorHash).toString('hex'), second);
    console.log('Login, rotación, CSRF, logout y revocación real: OK');
    const absolute = await login();
    await prisma.sesion.updateMany({ where: { usuarioId: user.id, identificadorHash: hash(absolute) }, data: { expiraAbsolutoEn: new Date(Date.now() - 1000) } });
    assert.equal((await request('/auth/me')).status, 401);
    const idle = await login();
    await prisma.sesion.updateMany({ where: { usuarioId: user.id, identificadorHash: hash(idle) }, data: { ultimoUsoEn: new Date(Date.now() - 1801000) } });
    assert.equal((await request('/auth/me')).status, 401);
    console.log('Caducidad absoluta e inactividad reales: OK');
  } finally {
    try {
      if (owned) {
        const row = await prisma.usuario.findUnique({ where: { correoNormalizado: email } });
        if (row && row.correoOriginal === email && row.creadoEn >= started) {
          await prisma.$transaction(async tx => { await tx.sesion.deleteMany({ where: { usuarioId: row.id } }); await tx.usuario.deleteMany({ where: { id: row.id, correoNormalizado: email } }); });
          assert.equal(await prisma.usuario.count({ where: { correoNormalizado: email } }), 0);
          console.log('Limpieza exclusiva del usuario y sesiones ficticios: OK');
        }
      }
    } finally { await app.close(); }
  }
})().catch(() => { console.error('Falló la integración de autenticación; revisar sin imprimir credenciales.'); process.exitCode = 1; });
