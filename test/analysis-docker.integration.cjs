// Test-only Nest app: real MySQL, controlled DNS/TLS/HTTP. Never imported by production.
(async () => {
  await import('reflect-metadata');
  const { ValidationPipe } = await import('@nestjs/common'); await import('@nestjs/core');
  const { Test } = await import('@nestjs/testing');
  const { default: assert } = await import('node:assert/strict');
  const { randomUUID, createHash } = await import('node:crypto');
  const { AppModule } = await import('./dist/app.module.js');
  const { PrismaService } = await import('./dist/infrastructure/prisma/prisma.service.js');
  const { AnalysisService } = await import('./dist/analysis/application/analysis.service.js');
  const { AnalysisNetwork } = await import('./dist/analysis/infrastructure/analysis-network.js');
  const { OwnershipFileReader } = await import('./dist/sites/infrastructure/ownership-file.reader.js');
  const { MonitoringService } = await import('./dist/analysis/application/monitoring.service.js');
  const { MonitoringRepository } = await import('./dist/analysis/infrastructure/monitoring.repository.js');
  const { AnalysisRepository } = await import('./dist/analysis/infrastructure/analysis.repository.js');
  const { ManualEngine } = await import('./dist/analysis/application/manual-engine.js');
  const { SslLabsClient } = await import('./dist/analysis/infrastructure/ssl-labs.client.js');
  const { SslLabsRepository } = await import('./dist/analysis/infrastructure/ssl-labs.repository.js');
  const { SslLabsService } = await import('./dist/analysis/application/ssl-labs.service.js');
  const target = new URL(process.env.DATABASE_URL || '');
  assert.equal(target.hostname, 'db'); assert.equal(target.pathname, '/nexoguard_migration_test'); assert.equal(process.env.NEXOGUARD_DB_MODE, 'local_unencrypted');
  assert.notEqual(process.env.SSLLABS_ENABLED, 'true'); // Never race this fixture against a real external worker.
  const browser = process.argv.includes('--browser');
  const run = randomUUID(), domain = `nexoguard-analysis-${run}.example.com`, started = new Date();
  const accounts = ['a', 'b'].map(label => ({ email: `nexoguard-analysis-${label}-${run}@example.invalid`, id: '', jar: new Map(), token: '' }));
  let content = '', mode = 'valid', stage = 'inicio', sslSite = null, sslMode = 'READY', remoteCalls = 0;
  const sslClient = { configured: () => true, get: async (resource, host) => {
    if (resource === 'info') return { status: 200, data: { maxAssessments: 1, currentAssessments: sslMode === 'CAPACITY' ? 1 : 0, newAssessmentCoolOff: 30000 }, maximum: 1, current: 0 };
    assert.equal(host, domain); remoteCalls++;
    if (typeof sslMode === 'number') return { status: sslMode, data: null, retryAfter: sslMode === 429 ? '120' : undefined };
    return { status: 200, data: { host: domain, port: 443, status: sslMode, startTime: Date.now() - 120000, testTime: Date.now() - 60000, engineVersion: '2.4-fixture', criteriaVersion: 'fixture-1', endpoints: [{ ipAddress: '93.184.215.14', statusMessage: 'Ready', grade: 'A', hasWarnings: false }, { statusMessage: 'controlled private error', grade: 'F' }], certs: ['never-store-fixture'] }, maximum: 1, current: 0 };
  } };
  const reader = new OwnershipFileReader();
  reader.resolve = async host => { assert.equal(host, domain); if (mode === 'dns-error') throw new Error('Controlled DNS failure'); return [{ address: '93.184.215.14', family: 4 }]; };
  reader.download = async () => content;
  const network = new AnalysisNetwork(reader, {});
  network.page = async url => {
    await network.destination(url.hostname);
    return url.protocol === 'http:' ? { status: 301, location: `https://${domain}/`, headers: {}, cookies: [] } : { status: 200, headers: { 'x-content-type-options': 'nosniff', 'strict-transport-security': 'max-age=31536000', 'x-frame-options': 'DENY', 'referrer-policy': 'strict-origin' }, cookies: ['synthetic-cookie=discard-this-fixture-value; Secure; HttpOnly; SameSite=Lax'] };
  };
  network.certificate = async host => {
    await network.destination(host); await new Promise(resolve => setTimeout(resolve, 150));
    return { trusted: mode !== 'expired', identity: true, validFrom: '2020-01-01T00:00:00.000Z', validTo: mode === 'expired' ? '2021-01-01T00:00:00.000Z' : '2099-01-01T00:00:00.000Z' };
  };
  const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(OwnershipFileReader).useValue(reader).overrideProvider(AnalysisNetwork).useValue(network)
    .overrideProvider(SslLabsClient).useValue(sslClient)
    .overrideProvider(SslLabsRepository).useFactory({ inject: [PrismaService], factory: prisma => {
      const repository = new SslLabsRepository(prisma), claim = repository.claim.bind(repository);
      repository.claim = now => sslSite ? claim(now, sslSite) : Promise.resolve(null);
      return repository; // Restrict this test worker to its own fixture site.
    } })
    .overrideProvider(MonitoringService).useFactory({ inject: [MonitoringRepository, AnalysisService], factory: (repository, analyses) => {
      const scoped = Object.assign(Object.create(repository), { due: async now => (await repository.due(now)).filter(row => accounts.some(a => a.id === row.configuradoPorId)) });
      return new MonitoringService(scoped, analyses); // The test worker can dispatch only this run's own fixtures.
    } }).compile();
  const app = module.createNestApplication({ logger: false });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableCors({ origin: 'http://127.0.0.1:3000', credentials: true });
  await app.listen(browser ? 3002 : 0, browser ? '0.0.0.0' : '127.0.0.1');
  const prisma = app.get(PrismaService), service = app.get(AnalysisService), monitoring = app.get(MonitoringService), ssl = app.get(SslLabsService);
  const base = browser ? 'http://127.0.0.1:3002' : await app.getUrl(), origin = 'http://127.0.0.1:3000';
  const password = 'clave-ficticia-analisis-integracion';
  async function request(account, path, method = 'GET', body, csrf = true) {
    const r = await fetch(`${base}${path}`, { method, headers: { origin, cookie: [...account.jar].map(([k, v]) => `${k}=${v}`).join('; '), ...(csrf ? { 'x-csrf-token': account.token } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    for (const entry of r.headers.getSetCookie()) { const pair = entry.split(';')[0], index = pair.indexOf('='); const k = pair.slice(0, index), v = pair.slice(index + 1); if (v) account.jar.set(k, v); else account.jar.delete(k); }
    return r;
  }
  async function fingerprint() {
    const c = await prisma.$queryRaw`SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,ORDINAL_POSITION`;
    const i = await prisma.$queryRaw`SELECT TABLE_NAME,INDEX_NAME,COLUMN_NAME,NON_UNIQUE,SEQ_IN_INDEX FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX`;
    return createHash('sha256').update(JSON.stringify([c, i], (_key, v) => typeof v === 'bigint' ? v.toString() : v)).digest('hex');
  }
  let before, originalGate;
  try {
    before = await fingerprint(); stage = 'cuentas ficticias';
    originalGate = await prisma.proveedorExterno.findUniqueOrThrow({ where: { id: 'ssllabs-v4' } });
    for (const a of accounts) {
      assert.equal(await prisma.usuario.count({ where: { correoNormalizado: a.email } }), 0);
      const t = await request(a, '/users/registration-token'); assert.equal(t.status, 200); a.token = (await t.json()).token;
      const u = await request(a, '/users', 'POST', { email: a.email, password }); assert.equal(u.status, 201); a.id = (await u.json()).id;
      const t2 = await request(a, '/auth/csrf'); a.token = (await t2.json()).token;
      assert.equal((await request(a, '/auth/login', 'POST', { email: a.email, password })).status, 200);
      const t3 = await request(a, '/auth/csrf'); a.token = (await t3.json()).token;
    }
    const [a, b] = accounts;
    const created = await request(a, '/sites', 'POST', { domain }); assert.equal(created.status, 201); const site = await created.json();
    const path = `/sites/${site.id}/analyses`;
    stage = 'propiedad y vigencia';
    await assert.rejects(service.start(b.id, site.id), e => e.getStatus() === 404);
    await assert.rejects(service.start(a.id, site.id), e => e.getStatus() === 409);
    const issued = await request(a, `/sites/${site.id}/verification-challenges`, 'POST'); assert.equal(issued.status, 201); const challenge = await issued.json(); content = challenge.content;
    assert.equal((await request(a, `/sites/${site.id}/verification-challenges/${challenge.id}/check`, 'POST')).status, 200);
    await prisma.verificacionDominio.update({ where: { id: challenge.id }, data: { verificacionValidaHasta: new Date(0) } });
    await assert.rejects(service.start(a.id, site.id), e => e.getStatus() === 409);
    await prisma.verificacionDominio.update({ where: { id: challenge.id }, data: { verificacionValidaHasta: new Date(Date.now() + 86400000) } });
      async function finished(id) {
        for (let n = 0; n < 40; n++) { const detail = await service.detail(a.id, site.id, id); if (['COMPLETADO', 'FALLIDO'].includes(detail.estado)) return detail; await new Promise(resolve => setTimeout(resolve, 50)); }
        throw new Error('Controlled job timeout');
      }
    if (browser) {
      mode = 'expired'; const baseline = await service.start(a.id, site.id); await finished(baseline.id);
      mode = 'valid'; const target = await service.start(a.id, site.id); await finished(target.id);
      const comparison = await service.compare(a.id, site.id, baseline.id, target.id);
      assert.equal(comparison.results.find(r => r.code === 'CERTIFICATE').change, 'MEJORO');
      const external = await ssl.start(a.id, site.id, true); sslSite = site.id;
      await ssl.tick(new Date(Math.max(Date.now(), originalGate.siguienteSolicitudEn.getTime())));
      assert.equal((await prisma.analisis.findUnique({ where: { id: external.id } })).estado, 'COMPLETADO');
      console.log(JSON.stringify({ browserFixtureReady: true, email: a.email, siteId: site.id, domain, api: 'http://127.0.0.1:3002', network: 'controlled' }));
      await new Promise(resolve => { process.once('SIGTERM', resolve); process.once('SIGINT', resolve); });
    } else {
      stage = 'CSRF y concurrencia HTTP';
      assert.equal((await request(a, path, 'POST', undefined, false)).status, 403);
      const concurrent = await Promise.all([request(a, path, 'POST'), request(a, path, 'POST')]); assert.deepEqual(concurrent.map(r => r.status).sort(), [202, 409]);
      const accepted = await concurrent.find(r => r.status === 202).json();
      const detail = await finished(accepted.id); assert.equal(detail.estado, 'COMPLETADO'); assert.equal(detail.resultados.length, 12);
      assert.equal((await request(b, path)).status, 404); assert.equal((await request(b, `${path}/${accepted.id}`)).status, 404);
      assert.ok(!JSON.stringify(detail).includes('discard-this-fixture-value')); assert.ok(!JSON.stringify(detail).includes('synthetic-cookie'));
      console.log('MySQL y HTTP reales: verificación actual/vigente, CSRF, autorización, concurrencia 202/409 y doce resultados atómicos: OK');
      stage = 'fallos parciales'; mode = 'expired';
      const expired = await service.start(a.id, site.id), expiredResult = await finished(expired.id);
      assert.equal(expiredResult.estado, 'COMPLETADO'); assert.equal(expiredResult.resultados.find(r => r.codigoComprobacion === 'CERTIFICATE_EXPIRY').estado, 'HALLAZGO');
      assert.equal(expiredResult.resultados.find(r => r.codigoComprobacion === 'CSP').estado, 'NO_EVALUADO');
      mode = 'dns-error'; const failed = await service.start(a.id, site.id); assert.equal((await finished(failed.id)).estado, 'FALLIDO'); mode = 'valid';
      const history = await service.history(a.id, site.id); assert.equal(history.length, 3);
      stage = 'comparaciones persistidas';
      const regression = await request(a, `${path}/compare/${accepted.id}/${expired.id}`);
      assert.equal(regression.status, 200); const changes = await regression.json();
      assert.equal(changes.results.find(r => r.code === 'CERTIFICATE').change, 'EMPEORO');
      assert.equal(changes.results.find(r => r.code === 'HSTS').change, 'NO_COMPARABLE');
      assert.ok(changes.results.every(r => r.guidance?.verification && r.guidance?.consequence));
      const recovery = await service.compare(a.id, site.id, expired.id, accepted.id).catch(e => e);
      assert.equal(recovery.getStatus(), 400); // reversed chronology
      assert.equal((await request(b, `${path}/compare/${accepted.id}/${expired.id}`)).status, 404);
      assert.equal((await request(a, `${path}/compare/${accepted.id}/${accepted.id}`)).status, 400);
      const failure = await service.compare(a.id, site.id, expired.id, failed.id);
      assert.ok(failure.results.every(r => r.change === 'NO_COMPARABLE'));
      // An owned historical revision with the same domain must not be conflated with this revision.
      const revision = await prisma.revisionDominio.create({ data: { sitioId: site.id, numeroRevision: 2, dominioCanonico: domain } });
      const v = await prisma.verificacionDominio.create({ data: { revisionDominioId: revision.id, codigoHash: new Uint8Array(32), desafioExpiraEn: new Date() } });
      const different = await prisma.analisis.create({ data: { verificacionId: v.id, estado: 'COMPLETADO', procedencia: 'manual-v1', disponibleEn: new Date() } });
      assert.equal((await request(a, `${path}/compare/${accepted.id}/${different.id}`)).status, 409);
      assert.equal((await request(b, `${path}/compare/${accepted.id}/${different.id}`)).status, 404);
      console.log('MySQL real: comparación HTTP autorizada, regresión, fallo no comparable, cronología, IDs y revisiones distintas: OK');
      console.log('Red controlada: certificado vencido, cabeceras no evaluadas y DNS fallido; sin conexiones públicas: OK');
      stage = 'programación con reloj controlado';
      await prisma.verificacionDominio.update({ where: { id: challenge.id }, data: { verificacionValidaHasta: new Date(Date.now() + 30 * 86400000) } });
      const schedulePath = `/sites/${site.id}/schedule`, alertsPath = `/sites/${site.id}/alerts`;
      assert.equal((await request(a, schedulePath, 'POST', { enabled: true, intervalMinutes: 1440 }, false)).status, 403);
      assert.equal((await request(b, schedulePath)).status, 404);
      assert.equal((await request(b, alertsPath)).status, 404);
      assert.equal((await request(b, schedulePath, 'POST', { enabled: true, intervalMinutes: 1440 })).status, 404);
      assert.equal((await request(a, schedulePath, 'POST', { enabled: true, intervalMinutes: 1440 })).status, 200);
      const config = await (await request(a, schedulePath)).json();
      const due = new Date(config.schedule.proximaEjecucionEn);
      assert.ok(due > new Date(Date.now() + 86000000)); // Actual production clock cannot see this future fixture as due.
      const beforeCount = await prisma.analisis.count({ where: { verificacionId: challenge.id } });
      await Promise.all([monitoring.tick(due), service.start(a.id, site.id, due)]);
      let scheduledJob = await prisma.analisis.findFirst({ where: { verificacionId: challenge.id, programadoPara: due } });
      assert.ok(scheduledJob); await finished(scheduledJob.id);
      assert.equal(await prisma.analisis.count({ where: { verificacionId: challenge.id } }), beforeCount + 1);
      await monitoring.tick(due); // Repeated tick/restarted worker does not consume the opportunity twice.
      assert.equal(await prisma.analisis.count({ where: { verificacionId: challenge.id } }), beforeCount + 1);
      const restartedWorker = new MonitoringService({ due: async time => (await app.get(MonitoringRepository).due(time)).filter(r => r.sitioId === site.id) }, service);
      await restartedWorker.tick(due); await restartedWorker.onModuleDestroy();
      assert.equal(await prisma.analisis.count({ where: { verificacionId: challenge.id } }), beforeCount + 1);
      const manual = await service.start(a.id, site.id);
      const future = (await prisma.programacionAnalisis.findUnique({ where: { sitioId: site.id } })).proximaEjecucionEn;
      await monitoring.tick(future); await finished(manual.id);
      assert.equal((await prisma.programacionAnalisis.findUnique({ where: { sitioId: site.id } })).ultimoEstado, 'OMITIDA_POR_ANALISIS_ACTIVO');
      await prisma.verificacionDominio.update({ where: { id: challenge.id }, data: { verificacionValidaHasta: new Date(0) } });
      const next = (await prisma.programacionAnalisis.findUnique({ where: { sitioId: site.id } })).proximaEjecucionEn;
      await monitoring.tick(next);
      assert.equal((await prisma.programacionAnalisis.findUnique({ where: { sitioId: site.id } })).activa, false);
      assert.equal((await request(a, schedulePath, 'POST', { enabled: true, intervalMinutes: 1440 })).status, 409);
      await prisma.verificacionDominio.update({ where: { id: challenge.id }, data: { verificacionValidaHasta: new Date(Date.now() + 30 * 86400000) } });
      assert.equal((await request(a, schedulePath, 'POST', { enabled: true, intervalMinutes: 10080 })).status, 200);
      assert.equal((await (await request(a, schedulePath)).json()).schedule.intervaloMinutos, 10080);
      assert.equal((await request(a, schedulePath, 'POST', { enabled: false })).status, 200);
      console.log('MySQL real + reloj lógico controlado: programación/edición/desactivación, oportunidad única concurrente, nuevo trabajador, solapamiento y propiedad vencida: OK');
      stage = 'alertas persistidas'; mode = 'expired';
      const repeat = await service.start(a.id, site.id); await finished(repeat.id);
      const alertCount = await prisma.alerta.count({ where: { analisis: { verificacion: { revisionDominio: { sitioId: site.id } } } } });
      const repeatAgain = await service.start(a.id, site.id); await finished(repeatAgain.id);
      assert.equal(await prisma.alerta.count({ where: { analisis: { verificacion: { revisionDominio: { sitioId: site.id } } } } }), alertCount);
      const alerts = await (await request(a, alertsPath)).json();
      assert.ok(alerts.some(r => r.tipo === 'EMPEORAMIENTO'));
      assert.equal(alerts.filter(r => r.tipo === 'CERTIFICADO').length, 1);
      const alert = alerts[0];
      assert.equal((await request(b, `${alertsPath}/${alert.id}/read`, 'POST')).status, 404);
      assert.equal((await request(a, `${alertsPath}/${alert.id}/read`, 'POST', undefined, false)).status, 403);
      assert.equal((await request(a, `${alertsPath}/${alert.id}/read`, 'POST')).status, 200);
      const readAt = (await prisma.alerta.findUnique({ where: { id: alert.id } })).leidaEn;
      assert.equal((await request(a, `${alertsPath}/${alert.id}/read`, 'POST')).status, 200);
      assert.equal((await prisma.alerta.findUnique({ where: { id: alert.id } })).leidaEn.getTime(), readAt.getTime());
      console.log('MySQL/API reales: regresiones y certificado, deduplicación entre ejecuciones, lectura idempotente, CSRF y propietario: OK');
      stage = 'atomicidad de resultados y alertas'; mode = 'valid';
      const repository = app.get(AnalysisRepository);
      const baseline = await service.start(a.id, site.id); await finished(baseline.id);
      const atomic = await repository.start(a.id, site.id), claim = await repository.claim(atomic.id);
      const observed = await app.get(ManualEngine).run(domain);
      const hsts = observed.results.find(r => r.code === 'HSTS'); hsts.status = 'HALLAZGO'; hsts.evidence.positiveMaxAge = false;
      const injected = new AnalysisRepository({ analisis: prisma.analisis, $transaction: work => prisma.$transaction(tx => work({ $queryRaw: tx.$queryRaw.bind(tx), analisis: tx.analisis, resultadoComprobacion: tx.resultadoComprobacion, alerta: { createMany: async () => { throw new Error('CONTROLLED_ALERT_WRITE_FAILURE'); } } })) }, { allowedMinutes: [1440, 10080], warningDays: 30 });
      await assert.rejects(injected.finish(atomic.id, claim.version, observed.results, false), e => e.message === 'CONTROLLED_ALERT_WRITE_FAILURE');
      assert.equal((await prisma.analisis.findUnique({ where: { id: atomic.id } })).estado, 'EN_EJECUCION');
      assert.equal(await prisma.resultadoComprobacion.count({ where: { analisisId: atomic.id } }), 0);
      assert.equal(await prisma.alerta.count({ where: { analisisId: atomic.id } }), 0);
      await repository.finish(atomic.id, claim.version, observed.results, false);
      assert.equal((await prisma.analisis.findUnique({ where: { id: atomic.id } })).estado, 'COMPLETADO');
      assert.equal(await prisma.resultadoComprobacion.count({ where: { analisisId: atomic.id } }), 12);
      assert.equal(await prisma.alerta.count({ where: { analisisId: atomic.id } }), 1);
      console.log('Transacción MySQL real: fallo de escritura de alerta inyectado, rollback de estado/resultados y posterior escritura atómica: OK');
      stage = 'SSL Labs controlado';
      const manualHistoryCount = (await service.history(a.id, site.id)).length;
      const sslPath = `/sites/${site.id}/ssl-labs`;
      assert.equal((await request(b, sslPath)).status, 404);
      await assert.rejects(ssl.start(b.id, site.id, true), e => e.getStatus() === 404);
      await assert.rejects(ssl.start(a.id, site.id, false), e => e.getStatus() === 400);
      const acceptedSsl = await request(a, sslPath, 'POST', { consent: true }); assert.equal(acceptedSsl.status, 202);
      const external = await acceptedSsl.json();
      assert.equal((await request(a, sslPath, 'POST', { consent: true })).status, 409);
      sslSite = site.id; sslMode = 'DNS';
      let clock = new Date(Math.max(Date.now(), originalGate.siguienteSolicitudEn.getTime()));
      const otherWorker = new SslLabsService(app.get(SslLabsRepository), sslClient, network);
      await Promise.all([ssl.tick(clock), otherWorker.tick(clock)]); await otherWorker.onModuleDestroy();
      assert.equal(remoteCalls, 1); // Cross-worker gate, not merely the in-process promise.
      let stored = await prisma.analisis.findUnique({ where: { id: external.id }, include: { resultados: true } });
      assert.equal(stored.resultados[0].evidencia.phase, 'DNS');
      for (const remote of ['IN_PROGRESS', 429, 503, 529, 'READY']) {
        sslMode = remote;
        const gate = await prisma.proveedorExterno.findUniqueOrThrow({ where: { id: 'ssllabs-v4' } });
        const required = remote === 503 ? 120000 : remote === 529 ? 900000 : 0;
        if (required) assert.ok(gate.siguienteSolicitudEn.getTime() - clock.getTime() >= required);
        clock = new Date(gate.siguienteSolicitudEn.getTime() + 1);
        await ssl.tick(clock);
      }
      stored = await prisma.analisis.findUnique({ where: { id: external.id }, include: { resultados: true } });
      assert.equal(stored.estado, 'COMPLETADO'); assert.equal(stored.resultados[0].estado, 'NO_EVALUADO');
      assert.equal(stored.resultados[0].evidencia.endpoints[0].grade, 'A'); assert.equal(stored.resultados[0].evidencia.endpoints[1].status, 'ERROR');
      assert.ok(!JSON.stringify(stored).includes('never-store-fixture')); assert.ok(!JSON.stringify(stored).includes('controlled private error'));
      const publicReports = await (await request(a, sslPath)).json(); assert.equal(publicReports.reports.length, 1); assert.ok(!JSON.stringify(publicReports).includes('requestedBy'));
      assert.equal((await service.history(a.id, site.id)).length, manualHistoryCount);
      await assert.rejects(service.detail(a.id, site.id, external.id), e => e.getStatus() === 404);
      const gatedBefore = remoteCalls; await ssl.tick(new Date()); assert.equal(remoteCalls, gatedBefore);
      const externalFailure = await ssl.start(a.id, site.id, true); sslMode = 441;
      const gateForFailure = await prisma.proveedorExterno.findUniqueOrThrow({ where: { id: 'ssllabs-v4' } });
      await ssl.tick(new Date(gateForFailure.siguienteSolicitudEn.getTime() + 1));
      assert.equal((await prisma.analisis.findUnique({ where: { id: externalFailure.id } })).estado, 'FALLIDO');
      assert.equal((await service.history(a.id, site.id)).length, manualHistoryCount);
      assert.equal((await service.detail(a.id, site.id, atomic.id)).resultados.length, 12);
      console.log('MySQL/API reales + SSL Labs simulado: consentimiento, propietario, gate entre trabajadores, DNS/en curso, 429/503/529, informe con fallo parcial, fechas/procedencia y separación del motor propio: OK');
    }
  } catch (error) { console.error(`Falló integración en ${stage}; tipo ${error?.constructor?.name || 'Error'}; detalles ocultos.`); process.exitCode = 1; }
  finally {
    try {
      await ssl.onModuleDestroy(); await monitoring.onModuleDestroy(); await service.onModuleDestroy();
      for (const a of accounts) {
        const row = await prisma.usuario.findUnique({ where: { correoNormalizado: a.email } }); if (!row) continue;
        assert.equal(row.id, a.id); assert.equal(row.correoOriginal, a.email); assert.ok(row.creadoEn >= started);
        await prisma.$transaction(async tx => {
          const scope = { verificacion: { revisionDominio: { sitio: { propietarioId: row.id } } } };
          await tx.alerta.deleteMany({ where: { analisis: scope } });
          await tx.programacionAnalisis.deleteMany({ where: { configuradoPorId: row.id } });
          await tx.resultadoComprobacion.deleteMany({ where: { analisis: scope } });
          await tx.analisis.deleteMany({ where: scope });
          await tx.sitio.updateMany({ where: { propietarioId: row.id }, data: { revisionActualId: null } });
          await tx.verificacionDominio.deleteMany({ where: { revisionDominio: { sitio: { propietarioId: row.id } } } });
          await tx.revisionDominio.deleteMany({ where: { sitio: { propietarioId: row.id } } });
          await tx.sitio.deleteMany({ where: { propietarioId: row.id } }); await tx.sesion.deleteMany({ where: { usuarioId: row.id } });
          await tx.usuario.deleteMany({ where: { id: row.id, correoNormalizado: a.email } });
        });
        assert.equal(await prisma.usuario.count({ where: { id: row.id } }), 0);
      }
      if (before) assert.equal(await fingerprint(), before);
      if (originalGate) {
        const currentGate = await prisma.proveedorExterno.findUniqueOrThrow({ where: { id: 'ssllabs-v4' } });
        const restored = await prisma.proveedorExterno.updateMany({ where: { id: 'ssllabs-v4', version: currentGate.version }, data: { siguienteSolicitudEn: originalGate.siguienteSolicitudEn, reclamoExpiraEn: originalGate.reclamoExpiraEn, version: { increment: 1 } } });
        assert.equal(restored.count, 1); // Preserve monotonic fencing; never restore an old version.
      }
      console.log('Limpieza exclusiva de fixtures, esquema e índices intactos: OK');
    } finally { await app.close(); }
    console.log('Aplicación temporal y conexiones cerradas: OK');
  }
})().catch(() => { console.error('Falló preparación/limpieza; detalles internos ocultos.'); process.exitCode = 1; });
