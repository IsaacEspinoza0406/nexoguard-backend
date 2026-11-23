// Isolated HTTP rehearsal only. No AppModule, dotenv, PrismaClient or workers.
// Uses actual controllers/services/repositories with a deliberately limited memory adapter.
const startFixture = async () => {
  await import('reflect-metadata');
  const { Test } = await import('@nestjs/testing');
  const { ValidationPipe } = await import('@nestjs/common');
  const { ThrottlerModule } = await import('@nestjs/throttler');
  const { randomUUID, randomBytes } = await import('node:crypto');
  const { AuthController } = await import('../dist/auth/presentation/auth.controller.js');
  const { AuthService } = await import('../dist/auth/application/auth.service.js');
  const { AuthRepository } = await import('../dist/auth/infrastructure/auth.repository.js');
  const { RegistrationController } = await import('../dist/users/presentation/registration.controller.js');
  const { RegisterUserService } = await import('../dist/users/application/register-user.service.js');
  const { UserRepository } = await import('../dist/users/infrastructure/user.repository.js');
  const { Prisma } = await import('../dist/generated/prisma/client.js');
  const { SitesController } = await import('../dist/sites/presentation/sites.controller.js');
  const { SitesService } = await import('../dist/sites/application/sites.service.js');
  const { SitesRepository } = await import('../dist/sites/infrastructure/sites.repository.js');
  const { AnalysisController } = await import('../dist/analysis/presentation/analysis.controller.js');
  const { AnalysisService } = await import('../dist/analysis/application/analysis.service.js');
  const { AnalysisRepository } = await import('../dist/analysis/infrastructure/analysis.repository.js');
  const { httpSecurity, securityHeaders } = await import('../dist/security/http-security.js');
  const { securityEvents } = await import('../dist/security/security-events.js');
  const tlsFixture = process.env.NEXOGUARD_VALIDATION_TLS === '1' && process.env.NEXOGUARD_HTTP_MODE === 'production' && process.env.FRONTEND_ORIGIN === 'https://localhost:38443';
  if ((!tlsFixture && process.env.NEXOGUARD_HTTP_MODE !== 'local') || process.env.DATABASE_URL || process.env.SSLLABS_ENABLED === 'true') throw new Error('La fixture exige proceso aislado sin credenciales ni proveedor.');
  if (tlsFixture) process.env.NEXOGUARD_CSRF_SECRET = randomBytes(32).toString('hex');
  const owner = '11111111-1111-4111-8111-111111111111';
  const ownSite = '22222222-2222-4222-8222-222222222222';
  const foreignSite = '33333333-3333-4333-8333-333333333333';
  const ownAnalysis = '44444444-4444-4444-8444-444444444444';
  const foreignAnalysis = '55555555-5555-4555-8555-555555555555';
  const users = new Map(), sessions = new Map();
  const sites = [
    { id: ownSite, propietarioId: owner, dominioCanonico: 'owner.example.invalid', creadoEn: new Date(), revisionActual: null },
    { id: foreignSite, propietarioId: '66666666-6666-4666-8666-666666666666', dominioCanonico: 'other.example.invalid', creadoEn: new Date(), revisionActual: null },
  ];
  const scopedSite = where => {
    if (!where?.propietarioId) throw new Error('Consulta no acotada.');
    return sites.find(s => s.propietarioId === where.propietarioId && (!where.id || s.id === where.id));
  };
  const scopedAnalysis = where => {
    const scope = where?.verificacion?.revisionDominio;
    if (!scope?.sitio?.propietarioId || !scope.sitioId || where.procedencia !== 'manual-v1') throw new Error('Consulta no acotada.');
    const site = scopedSite({ id: scope.sitioId, propietarioId: scope.sitio.propietarioId });
    if (!site || (where.id && where.id !== ownAnalysis)) return null;
    return { id: ownAnalysis, estado: 'COMPLETADO', creadoEn: new Date('2026-01-01T00:00:00Z'), finalizadoEn: new Date('2026-01-01T00:00:01Z'), motivoFallo: null, procedencia: 'manual-v1', verificacion: { revisionDominio: { dominioCanonico: site.dominioCanonico, numeroRevision: 1 } }, resultados: [{ codigoComprobacion: 'CSP', estado: 'NO_EVALUADO', evidencia: { present: true, controlled: true }, observadoEn: new Date('2026-01-01T00:00:01Z') }] };
  };
  const key = value => Buffer.from(value).toString('hex');
  const memory = {
    usuario: {
      create: async ({ data }) => {
        if (users.has(data.correoNormalizado)) throw new Prisma.PrismaClientKnownRequestError('Fixture duplicate', { code: 'P2002', clientVersion: 'fixture' });
        if (!data.correoNormalizado.endsWith('@example.invalid')) throw new Error('Solo correos ficticios.');
        const user = { ...data, id: users.size ? randomUUID() : owner }; users.set(data.correoNormalizado, user); return { id: user.id };
      },
      findUnique: async ({ where }) => users.get(where.correoNormalizado) || null,
    },
    sesion: {
      create: async ({ data }) => { sessions.set(key(data.identificadorHash), { ...data, revocadoEn: null }); return {}; },
      findUnique: async ({ where }) => { const s = sessions.get(key(where.identificadorHash)); const u = s && [...users.values()].find(u => u.id === s.usuarioId); return u ? { usuario: u } : null; },
      updateMany: async ({ where, data }) => {
        const s = sessions.get(key(where.identificadorHash));
        if (!s || s.revocadoEn || (where.usuarioId && s.usuarioId !== where.usuarioId) || (where.expiraAbsolutoEn && s.expiraAbsolutoEn <= where.expiraAbsolutoEn.gt) || (where.ultimoUsoEn && s.ultimoUsoEn <= where.ultimoUsoEn.gt)) return { count: 0 };
        Object.assign(s, data); return { count: 1 };
      },
    },
    sitio: {
      findMany: async ({ where }) => { if (!where?.propietarioId) throw new Error('Consulta no acotada.'); return sites.filter(s => s.propietarioId === where.propietarioId); },
      findFirst: async ({ where }) => scopedSite(where) || null,
    },
    analisis: {
      findMany: async ({ where }) => { const result = scopedAnalysis(where); return result ? [result] : []; },
      findFirst: async ({ where }) => scopedAnalysis(where),
    },
    $transaction: async action => action(memory),
  };
  const auth = new AuthService(new AuthRepository(memory));
  const sitesService = new SitesService(new SitesRepository(memory), { read: async () => { throw new Error('Red deshabilitada.'); } });
  const analysis = new AnalysisService(new AnalysisRepository(memory), { run: async () => { throw new Error('Motor deshabilitado.'); } });
  // Only bind read methods: no lifecycle worker or task creation in this fixture.
  const module = await Test.createTestingModule({
    imports: [ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }])],
    controllers: [RegistrationController, AuthController, SitesController, AnalysisController],
    providers: [
      { provide: RegisterUserService, useValue: new RegisterUserService(new UserRepository(memory)) },
      { provide: AuthService, useValue: auth }, { provide: SitesService, useValue: sitesService },
      { provide: AnalysisService, useValue: { history: analysis.history.bind(analysis), detail: analysis.detail.bind(analysis) } },
    ],
  }).compile();
  const app = module.createNestApplication({ logger: false });
  app.use(securityHeaders);
  app.use(securityEvents());
  app.use((req, res, next) => {
    res.setHeader('X-NexoGuard-Validation', 'memory-only');
    const path = req.path;
    const reads = req.method === 'GET' && (/^\/(auth\/(me|csrf)|users\/registration-token|sites)$/.test(path) || /^\/sites\/[0-9a-f-]+\/analyses(?:\/[0-9a-f-]+)?$/.test(path));
    const writes = req.method === 'POST' && ['/users', '/auth/login', '/auth/logout', '/sites'].includes(path);
    if (!reads && !writes && req.method !== 'OPTIONS') return res.status(405).json({ message: 'Fuera de alcance de la fixture.' });
    // /sites writes are restricted to rejected DTO/CSRF cases; valid writes cannot reach persistence.
    if (req.method === 'POST' && path === '/sites' && !req.headers['x-validation-negative']) return res.status(405).json({ message: 'Solo casos negativos de sitios.' });
    next();
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableCors({ origin: httpSecurity().origin, credentials: true });
  await app.listen(38381, process.env.NEXOGUARD_VALIDATION_CONTAINER === '1' ? '0.0.0.0' : '127.0.0.1');
  return { app, ids: { owner, ownSite, foreignSite, ownAnalysis, foreignAnalysis } };
};
module.exports = { startFixture };
if (process.argv.includes('--serve')) {
  startFixture().then(({ app }) => {
    console.log('Fixture aislada http://127.0.0.1:38381; memoria ficticia, sin MySQL, sin motor ni proveedor.');
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void app.close(); });
  }).catch(() => { console.error('No se pudo iniciar la fixture; detalles omitidos.'); process.exitCode = 1; });
}
