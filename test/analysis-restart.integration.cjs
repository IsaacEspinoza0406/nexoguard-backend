// Real MySQL and a real killed Nest process; no external network requests.
(async () => {
  await import('reflect-metadata');
  const { default: assert } = await import('node:assert/strict');
  const { randomUUID, createHash } = await import('node:crypto');
  const { spawn } = await import('node:child_process');
  const { once } = await import('node:events');
  const { NestFactory } = await import('@nestjs/core');
  const argon2 = await import('argon2');
  const { AppModule } = await import('./dist/app.module.js');
  const { PrismaService } = await import('./dist/infrastructure/prisma/prisma.service.js');
  const { AnalysisService } = await import('./dist/analysis/application/analysis.service.js');
  const { AnalysisRepository } = await import('./dist/analysis/infrastructure/analysis.repository.js');
  const { ManualEngine } = await import('./dist/analysis/application/manual-engine.js');
  const { codes, unavailable } = await import('./dist/analysis/domain/checks.js');
  const url = new URL(process.env.DATABASE_URL || '');
  assert.equal(url.hostname, 'db'); assert.equal(url.pathname, '/nexoguard_migration_test');
  assert.equal(process.env.NEXOGUARD_DB_MODE, 'local_unencrypted');
  assert.notEqual(process.env.SSLLABS_ENABLED, 'true');
  const prisma = new PrismaService(); await prisma.onModuleInit();
  const id = randomUUID(), email = `nexoguard-restart-${id}@example.invalid`, started = new Date();
  let app, child, stage = 'fixtures', owned = false;
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  try {
    assert.equal(await prisma.usuario.count({ where: { correoNormalizado: email } }), 0);
    const passwordHash = await argon2.hash('clave-ficticia-reinicio-controlado', { type: argon2.argon2id });
    const setup = await prisma.$transaction(async tx => {
      await tx.usuario.create({ data: { id, correoOriginal: email, correoNormalizado: email, passwordHash } });
      const domain = `nexoguard-restart-${id}.example.com`;
      const site = await tx.sitio.create({ data: { propietarioId: id, dominioCanonico: domain } });
      const revision = await tx.revisionDominio.create({ data: { sitioId: site.id, dominioCanonico: domain, numeroRevision: 1 } });
      await tx.sitio.update({ where: { id: site.id }, data: { revisionActualId: revision.id } });
      const verification = await tx.verificacionDominio.create({ data: { revisionDominioId: revision.id, codigoHash: new Uint8Array(createHash('sha256').update(randomUUID()).digest()), desafioExpiraEn: new Date(Date.now() + 60000), verificadoEn: new Date(), verificacionValidaHasta: new Date(Date.now() + 86400000) } });
      return { siteId: site.id, verificationId: verification.id };
    });
    owned = true;
    stage = 'proceso Nest en ejecución';
    const childCode = `(async () => {
      await import('reflect-metadata');
      const {NestFactory} = await import('@nestjs/core');
      const {AppModule} = await import('./dist/app.module.js');
      const {AnalysisService} = await import('./dist/analysis/application/analysis.service.js');
      const {ManualEngine} = await import('./dist/analysis/application/manual-engine.js');
      const {PrismaService} = await import('./dist/infrastructure/prisma/prisma.service.js');
      const app = await NestFactory.createApplicationContext(AppModule,{logger:false});
      app.get(ManualEngine).run = async () => new Promise(() => {});
      setInterval(() => {},1000);
      const job = await app.get(AnalysisService).start(process.env.FIXTURE_OWNER,process.env.FIXTURE_SITE);
      const p=app.get(PrismaService);
      for(let i=0;i<100;i++){
        const row=await p.analisis.findUnique({where:{id:job.id}});
        if(row.estado==='EN_EJECUCION'){console.log('READY '+job.id);return;}
        await new Promise(r=>setTimeout(r,20));
      }
      process.exit(2);
    })().catch(()=>process.exit(2));`;
    child = spawn(process.execPath, ['-e', childCode], { cwd: process.cwd(), env: { ...process.env, FIXTURE_OWNER: id, FIXTURE_SITE: setup.siteId }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stderr.on('data', () => {}); // Never forward driver errors or environment data.
    const jobId = await new Promise((resolve, reject) => {
      let output = '';
      const timeout = setTimeout(() => reject(new Error('Nest child timeout')), 15000);
      child.once('error', () => { clearTimeout(timeout); reject(new Error('Child failed')); });
      child.once('exit', () => { clearTimeout(timeout); reject(new Error('Child exited early')); });
      child.stdout.on('data', data => { output += data.toString(); const match = /READY ([0-9a-f-]{36})/.exec(output); if (match) { clearTimeout(timeout); resolve(match[1]); } });
    });
    const running = await prisma.analisis.findUniqueOrThrow({ where: { id: jobId } });
    assert.equal(running.estado, 'EN_EJECUCION');
    const exited = once(child, 'exit'); child.kill('SIGKILL'); const [, signal] = await exited; assert.equal(signal, 'SIGKILL');
    console.log('Proceso Nest real detenido abruptamente con un análisis EN_EJECUCION: OK');
    // Shorten only this fixture's lease; production continues using 90 seconds.
    await prisma.analisis.update({ where: { id: jobId }, data: { reclamoExpiraEn: new Date(Date.now() + 5000) } });
    const oldPending = randomUUID(), oldRunning = randomUUID(), noStarted = randomUUID(), expired = randomUUID(), fresh = randomUUID(), terminal = randomUUID();
    await prisma.analisis.createMany({ data: [
      { id: oldPending, estado: 'PENDIENTE', creadoEn: new Date(0), reclamoExpiraEn: null },
      { id: oldRunning, estado: 'EN_EJECUCION', creadoEn: new Date(0), iniciadoEn: new Date(0), reclamoExpiraEn: null },
      { id: noStarted, estado: 'EN_EJECUCION', creadoEn: new Date(0), iniciadoEn: null, reclamoExpiraEn: null },
      { id: expired, estado: 'PENDIENTE', reclamoExpiraEn: new Date(0) },
      { id: fresh, estado: 'PENDIENTE', reclamoExpiraEn: null },
      { id: terminal, estado: 'COMPLETADO', creadoEn: new Date(0), reclamoExpiraEn: null },
    ].map(row => ({ ...row, verificacionId: setup.verificationId, procedencia: 'manual-v1', disponibleEn: new Date() })) });
    // Own-engine recovery must not terminate independently managed provider jobs.
    const external = await prisma.analisis.create({ data: { verificacionId: setup.verificationId, procedencia: 'ssllabs-v4', estado: 'PENDIENTE', creadoEn: new Date(0), reclamoExpiraEn: new Date(0), disponibleEn: new Date() } });
    stage = 'arranque y recuperación';
    app = await NestFactory.createApplicationContext(AppModule, { logger: false });
    for (const job of [oldPending, oldRunning, noStarted, expired]) assert.equal((await prisma.analisis.findUniqueOrThrow({ where: { id: job } })).estado, 'FALLIDO');
    assert.equal((await prisma.analisis.findUniqueOrThrow({ where: { id: fresh } })).estado, 'PENDIENTE');
    assert.equal((await prisma.analisis.findUniqueOrThrow({ where: { id: terminal } })).estado, 'COMPLETADO');
    assert.equal((await prisma.analisis.findUniqueOrThrow({ where: { id: external.id } })).estado, 'PENDIENTE');
    for (let i = 0; i < 45; i++) { if ((await prisma.analisis.findUniqueOrThrow({ where: { id: jobId } })).estado === 'FALLIDO') break; await delay(500); }
    const recovered = await prisma.analisis.findUniqueOrThrow({ where: { id: jobId } });
    assert.equal(recovered.estado, 'FALLIDO'); assert.ok(recovered.finalizadoEn); assert.ok(recovered.versionReclamo > running.versionReclamo);
    await app.get(AnalysisRepository).finish(jobId, running.versionReclamo, [], false);
    assert.equal((await prisma.analisis.findUniqueOrThrow({ where: { id: jobId } })).estado, 'FALLIDO');
    assert.equal(await prisma.resultadoComprobacion.count({ where: { analisisId: jobId } }), 0);
    console.log('Nuevo arranque: recuperación de trabajos propios, aislamiento SSL Labs, barrido periódico y rechazo de escritura tardía: OK');
    await prisma.analisis.update({ where: { id: fresh }, data: { creadoEn: new Date(0) } });
    await app.get(AnalysisRepository).expire();
    app.get(ManualEngine).run = async () => ({ results: codes.map(code => unavailable(code, 'Respuesta didáctica controlada; no se consultó la red.')), failed: false });
    const next = await app.get(AnalysisService).start(id, setup.siteId);
    for (let i = 0; i < 50; i++) { if ((await prisma.analisis.findUniqueOrThrow({ where: { id: next.id } })).estado === 'COMPLETADO') break; await delay(50); }
    assert.equal((await prisma.analisis.findUniqueOrThrow({ where: { id: next.id } })).estado, 'COMPLETADO');
    assert.equal(await prisma.resultadoComprobacion.count({ where: { analisisId: next.id } }), 12);
    console.log('Sitio desbloqueado: nuevo análisis con doce resultados persistidos; terminales conservados: OK');
  } catch (error) { console.error(`Falló prueba de reinicio en ${stage}; tipo ${error?.constructor?.name || 'Error'}; detalles ocultos.`); process.exitCode = 1; }
  finally {
    if (child && child.exitCode === null && child.signalCode === null) { const stopped = once(child, 'exit'); child.kill('SIGKILL'); await stopped; }
    if (app) await app.close();
    try {
      if (owned) {
        const row = await prisma.usuario.findUniqueOrThrow({ where: { id } }); assert.equal(row.correoNormalizado, email); assert.ok(row.creadoEn >= started);
        await prisma.$transaction(async tx => {
          const scope = { verificacion: { revisionDominio: { sitio: { propietarioId: id } } } };
          await tx.resultadoComprobacion.deleteMany({ where: { analisis: scope } }); await tx.analisis.deleteMany({ where: scope });
          await tx.sitio.updateMany({ where: { propietarioId: id }, data: { revisionActualId: null } });
          await tx.verificacionDominio.deleteMany({ where: { revisionDominio: { sitio: { propietarioId: id } } } });
          await tx.revisionDominio.deleteMany({ where: { sitio: { propietarioId: id } } }); await tx.sitio.deleteMany({ where: { propietarioId: id } });
          await tx.usuario.deleteMany({ where: { id, correoNormalizado: email } });
        });
        assert.equal(await prisma.usuario.count({ where: { id } }), 0);
        console.log('Limpieza exclusiva de fixtures de reinicio: OK');
      }
    } finally { await prisma.onModuleDestroy(); }
  }
})().catch(() => { console.error('Falló preparación/limpieza de reinicio; detalles ocultos.'); process.exitCode = 1; });
