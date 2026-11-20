// MySQL real; DNS y transporte HTTPS controlados. Ejecutar por stdin en /app del backend.
(async () => {
  await import('reflect-metadata');
  const { ValidationPipe } = await import('@nestjs/common');
  await import('@nestjs/core');
  const { Test } = await import('@nestjs/testing');
  const { default: assert } = await import('node:assert/strict');
  const { randomUUID, createHash } = await import('node:crypto');
  const { AppModule } = await import('./dist/app.module.js');
  const { PrismaService } = await import('./dist/infrastructure/prisma/prisma.service.js');
  const { SitesService } = await import('./dist/sites/application/sites.service.js');
  const { OwnershipFileReader } = await import('./dist/sites/infrastructure/ownership-file.reader.js');
  const url = new URL(process.env.DATABASE_URL || '');
  assert.equal(url.hostname, 'db'); assert.equal(url.pathname, '/nexoguard_migration_test');
  assert.equal(process.env.NEXOGUARD_DB_MODE, 'local_unencrypted');
  let content = '', dnsError = false;
  const reader = new OwnershipFileReader();
  reader.resolve = async () => { if (dnsError) throw new Error('Fallo DNS simulado'); return [{ address: '93.184.215.14', family: 4 }]; };
  reader.download = async () => content;
  const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(OwnershipFileReader).useValue(reader).compile();
  const app = module.createNestApplication({ logger: false });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  const prisma = app.get(PrismaService);
  const base = await app.getUrl(), origin = 'http://127.0.0.1:3000';
  const runId = randomUUID();
  const domain = `nexoguard-sites-${runId}.example.com`;
  const started = new Date();
  const accounts = ['a', 'b'].map(label => ({ email: `nexoguard-sites-${label}-${runId}@example.invalid`, jar: new Map(), token: '', id: '' }));
  const password = 'clave-ficticia-sitios-integracion';
  let stage = 'inicio';
  async function request(account, path, method = 'GET', body) {
    const response = await fetch(`${base}${path}`, { method, headers: { origin, cookie: [...account.jar].map(([key, value]) => `${key}=${value}`).join('; '), 'x-csrf-token': account.token, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    for (const entry of response.headers.getSetCookie()) { const pair = entry.split(';')[0], index = pair.indexOf('='); const key = pair.slice(0, index), value = pair.slice(index + 1); if (value) account.jar.set(key, value); else account.jar.delete(key); }
    return response;
  }
  async function schemaFingerprint() {
    const columns = await prisma.$queryRaw`SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION`;
    const indexes = await prisma.$queryRaw`SELECT TABLE_NAME, INDEX_NAME, COLUMN_NAME, NON_UNIQUE, SEQ_IN_INDEX FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`;
    return createHash('sha256').update(JSON.stringify([columns, indexes], (_key, value) => typeof value === 'bigint' ? value.toString() : value)).digest('hex');
  }
  let fingerprint;
  try {
    fingerprint = await schemaFingerprint();
    stage = 'usuarios ficticios y acceso';
    for (const account of accounts) {
      assert.equal(await prisma.usuario.count({ where: { correoNormalizado: account.email } }), 0);
      const registrationToken = await request(account, '/users/registration-token'); assert.equal(registrationToken.status, 200);
      account.token = (await registrationToken.json()).token;
      const registration = await request(account, '/users', 'POST', { email: account.email, password }); assert.equal(registration.status, 201);
      account.id = (await registration.json()).id;
      const csrf = await request(account, '/auth/csrf'); assert.equal(csrf.status, 200); account.token = (await csrf.json()).token;
      assert.equal((await request(account, '/auth/login', 'POST', { email: account.email, password })).status, 200);
      const bound = await request(account, '/auth/csrf'); assert.equal(bound.status, 200); account.token = (await bound.json()).token;
    }
    const [a, b] = accounts;
    stage = 'registro concurrente y aislamiento';
    const concurrent = await Promise.all([request(a, '/sites', 'POST', { domain: domain.toUpperCase() + '.' }), request(a, '/sites', 'POST', { domain })]);
    assert.deepEqual(concurrent.map(r => r.status).sort(), [201, 409]);
    const site = await concurrent.find(r => r.status === 201).json();
    assert.equal(site.domain, domain);
    assert.equal((await request(b, '/sites', 'POST', { domain })).status, 201);
    const aSites = await (await request(a, '/sites')).json(), bSites = await (await request(b, '/sites')).json();
    assert.equal(aSites.length, 1); assert.equal(bSites.length, 1); assert.notEqual(aSites[0].id, bSites[0].id);
    assert.equal((await request(b, `/sites/${site.id}/verification-challenges`, 'POST')).status, 404);
    assert.equal((await fetch(`${base}/sites`)).status, 401);
    console.log('MySQL real: normalización, UNIQUE concurrente 201/409 y aislamiento de dos propietarios: OK');
    stage = 'desafío e invalidez';
    const issue = async () => { const r = await request(a, `/sites/${site.id}/verification-challenges`, 'POST'); assert.equal(r.status, 201); return r.json(); };
    const check = challenge => request(a, `/sites/${site.id}/verification-challenges/${challenge.id}/check`, 'POST');
    const first = await issue();
    const stored = await prisma.verificacionDominio.findUniqueOrThrow({ where: { id: first.id } });
    assert.deepEqual(Buffer.from(stored.codigoHash), createHash('sha256').update(first.content).digest());
    await assert.rejects(app.get(SitesService).verify(b.id, site.id, first.id), error => error.getStatus() === 404);
    content = `nexoguard-verification=${'0'.repeat(64)}`;
    assert.equal((await check(first)).status, 400);
    // Solo se caduca el desafío que esta prueba acaba de crear.
    await prisma.verificacionDominio.update({ where: { id: first.id }, data: { desafioExpiraEn: new Date(0) } });
    assert.equal((await check(first)).status, 409);
    const second = await issue();
    assert.notEqual(first.content, second.content);
    assert.ok((await prisma.verificacionDominio.findUniqueOrThrow({ where: { id: first.id } })).invalidadoEn);
    assert.equal((await check(first)).status, 409);
    dnsError = true; assert.equal((await check(second)).status, 502); dnsError = false;
    stage = 'confirmación';
    content = second.content; assert.equal((await check(second)).status, 200);
    const verified = await prisma.verificacionDominio.findUniqueOrThrow({ where: { id: second.id } });
    assert.ok(verified.verificadoEn); assert.ok(verified.verificacionValidaHasta > verified.verificadoEn);
    const listed = await (await request(a, '/sites')).json(); assert.equal(listed[0].status, 'verified');
    assert.ok(!JSON.stringify(listed).includes(second.content)); assert.ok(!JSON.stringify(listed).includes('codigoHash'));
    console.log('MySQL real: hash, caducidad, renovación, estado persistido y ausencia de código/hash en listado: OK');
    console.log('DNS/HTTPS controlados: código incorrecto 400, caducado/renovado 409, DNS fallido 502, archivo correcto 200: OK');
  } catch (error) { console.error(`Integración de sitios falló en: ${stage}. Tipo: ${error?.constructor?.name || 'Error'}. Valores internos ocultos.`); process.exitCode = 1; }
  finally {
    try {
      for (const account of accounts) {
        // UUID único, correo exacto y fecha comprobados; nunca se seleccionan cuentas preexistentes.
        const row = await prisma.usuario.findUnique({ where: { correoNormalizado: account.email } });
        if (!row) continue;
        assert.equal(row.id, account.id); assert.equal(row.correoOriginal, account.email); assert.ok(row.creadoEn >= started);
        await prisma.$transaction(async tx => {
          assert.equal(await tx.analisis.count({ where: { verificacion: { revisionDominio: { sitio: { propietarioId: row.id } } } } }), 0);
          await tx.sitio.updateMany({ where: { propietarioId: row.id }, data: { revisionActualId: null } });
          await tx.verificacionDominio.deleteMany({ where: { revisionDominio: { sitio: { propietarioId: row.id } } } });
          await tx.revisionDominio.deleteMany({ where: { sitio: { propietarioId: row.id } } });
          await tx.sitio.deleteMany({ where: { propietarioId: row.id } });
          await tx.sesion.deleteMany({ where: { usuarioId: row.id } });
          await tx.usuario.deleteMany({ where: { id: row.id, correoNormalizado: account.email } });
        });
        assert.equal(await prisma.usuario.count({ where: { id: row.id } }), 0);
      }
      if (fingerprint) assert.equal(await schemaFingerprint(), fingerprint);
      console.log('Limpieza exclusiva de fixtures, esquema e índices sin cambios: OK');
    } finally { await app.close(); }
    console.log('Cierre de conexiones de la aplicación temporal: OK');
  }
})().catch(() => { console.error('Falló la preparación o limpieza de la integración; detalles internos ocultos.'); process.exitCode = 1; });
