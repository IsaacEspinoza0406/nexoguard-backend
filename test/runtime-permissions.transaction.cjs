// Permission integration: actual use cases/Prisma, no network, no DELETE or committed fixtures.
(async () => {
  await import('reflect-metadata');
  const { default: assert } = await import('node:assert/strict');
  const { randomUUID, randomBytes, createHash } = await import('node:crypto');
  const { PrismaService } = await import('./dist/infrastructure/prisma/prisma.service.js');
  const { UserRepository } = await import('./dist/users/infrastructure/user.repository.js');
  const { RegisterUserService } = await import('./dist/users/application/register-user.service.js');
  const { AuthRepository } = await import('./dist/auth/infrastructure/auth.repository.js');
  const { AuthService } = await import('./dist/auth/application/auth.service.js');
  const { SitesRepository } = await import('./dist/sites/infrastructure/sites.repository.js');
  const { SitesService } = await import('./dist/sites/application/sites.service.js');
  const { AnalysisRepository } = await import('./dist/analysis/infrastructure/analysis.repository.js');
  const { MonitoringRepository } = await import('./dist/analysis/infrastructure/monitoring.repository.js');
  const { MonitoringPolicy } = await import('./dist/analysis/application/monitoring-policy.js');
  const { SslLabsRepository } = await import('./dist/analysis/infrastructure/ssl-labs.repository.js');
  const { codes, unavailable } = await import('./dist/analysis/domain/checks.js');
  const p = new PrismaService();
  const url = new URL(process.env.DATABASE_URL || '');
  assert.equal(url.hostname, 'db'); assert.equal(url.pathname, '/nexoguard_migration_test');
  const email = `nexoguard-permissions-${randomUUID()}@example.invalid`;
  const rollback = new Error('CONTROLLED_ROLLBACK');
  let stage = 'conexión', completed = false;
  await p.onModuleInit();
  try {
    assert.equal(await p.usuario.count({ where: { correoNormalizado: email } }), 0);
    try {
      await p.$transaction(async tx => {
        // Nested repository transactions share the outer rollback-only transaction.
        const client = new Proxy(tx, { get(target, key) { return key === '$transaction' ? async action => action(client) : Reflect.get(target, key); } });
        stage = 'registro';
        const registration = new RegisterUserService(new UserRepository(client));
        const password = randomBytes(24).toString('hex');
        const user = await registration.register(email.toUpperCase(), password);
        assert.deepEqual(Object.keys(user), ['id']);
        await assert.rejects(() => registration.register(email, password), e => e.getStatus?.() === 409);
        stage = 'login, sesión y logout';
        const auth = new AuthService(new AuthRepository(client));
        const login = await auth.login(` ${email} `, password, '');
        assert.equal((await auth.authenticate(login.token)).id, user.id);
        await auth.logout(login.token);
        await assert.rejects(() => auth.authenticate(login.token), e => e.getStatus?.() === 401);
        stage = 'sitio y archivo de propiedad controlado';
        let content = '';
        const sites = new SitesService(new SitesRepository(client), { read: async () => content });
        const site = await sites.create(user.id, `permissions-${randomUUID()}.example.com`);
        const challenge = await sites.issue(user.id, site.id); content = challenge.content;
        await sites.verify(user.id, site.id, challenge.id);
        assert.equal((await sites.list(user.id))[0].status, 'verified');
        const policy = new MonitoringPolicy();
        const monitoring = new MonitoringRepository(client, policy);
        stage = 'programación';
        assert.equal((await monitoring.configure(user.id, site.id, true, 1440, new Date())).activa, true);
        assert.equal((await monitoring.get(user.id, site.id)).schedule.intervaloMinutos, 1440);
        const analyses = new AnalysisRepository(client, policy);
        stage = 'análisis con resultados controlados e historial';
        const job = await analyses.start(user.id, site.id);
        const claim = await analyses.claim(job.id); assert.ok(claim);
        await analyses.finish(job.id, claim.version, codes.map(code => unavailable(code, 'Respuesta controlada; sin conexión externa.')), false);
        assert.equal((await analyses.detail(user.id, site.id, job.id)).resultados.length, 12);
        assert.equal((await analyses.history(user.id, site.id)).length, 1);
        stage = 'alertas';
        const alert = await client.alerta.create({ data: { analisisId: job.id, codigoComprobacion: 'HSTS', tipo: 'REGRESION', claveDeduplicacion: createHash('sha256').update(randomUUID()).digest('hex'), detalle: { controlled: true } } });
        assert.equal((await monitoring.alerts(user.id, site.id)).length, 1);
        assert.equal((await monitoring.read(user.id, site.id, alert.id, new Date())).read, true);
        assert.equal((await monitoring.configure(user.id, site.id, false, 0, new Date())).activa, false);
        stage = 'persistencia SSL Labs sin proveedor';
        const ssl = new SslLabsRepository(client);
        const external = await ssl.start(user.id, site.id, new Date());
        const externalClaim = await ssl.claim(new Date(Date.now() + 1000), site.id); assert.ok(externalClaim);
        await ssl.finish(externalClaim, { ...externalClaim.report, phase: 'READY', fetchedAt: new Date().toISOString(), testTime: new Date().toISOString(), endpoints: [{ endpoint: 1, status: 'READY', grade: 'A', hasWarnings: false }] }, 10000, new Date());
        assert.equal((await ssl.history(user.id, site.id)).find(row => row.id === external.id).estado, 'COMPLETADO');
        completed = true;
        throw rollback;
      }, { timeout: 60000 });
    } catch (error) { if (error !== rollback) throw error; }
    assert.ok(completed);
    assert.equal(await p.usuario.count({ where: { correoNormalizado: email } }), 0);
    console.log('Permisos reales: registro/duplicado, login/sesión/logout, sitio/propiedad, programación, análisis/historial, alertas y persistencia SSL controlada: OK');
    console.log('Rollback confirmado: cero usuarios ficticios persistidos; sin DELETE ni tráfico externo.');
  } catch { console.error(`Falló la verificación en ${stage}; detalles privados ocultos.`); process.exitCode = 1; }
  finally { await p.onModuleDestroy(); }
})().catch(() => { console.error('No se pudo completar la comprobación de permisos; detalles privados ocultos.'); process.exitCode = 1; });
