import 'reflect-metadata';
import { INestApplication, UnauthorizedException, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { contracts, createApiDocument, setupSwagger, swaggerEnabled } from '../src/documentation/openapi';
import { RegistrationController } from '../src/users/presentation/registration.controller';
import { RegisterUserService } from '../src/users/application/register-user.service';
import { AuthController } from '../src/auth/presentation/auth.controller';
import { AuthService } from '../src/auth/application/auth.service';
import { SitesController } from '../src/sites/presentation/sites.controller';
import { SitesService } from '../src/sites/application/sites.service';
import { AnalysisController } from '../src/analysis/presentation/analysis.controller';
import { AnalysisService } from '../src/analysis/application/analysis.service';
import { MonitoringController } from '../src/analysis/presentation/monitoring.controller';
import { MonitoringService } from '../src/analysis/application/monitoring.service';
import { SslLabsController } from '../src/analysis/presentation/ssl-labs.controller';
import { SslLabsService } from '../src/analysis/application/ssl-labs.service';

let app: INestApplication;
let previous: NodeJS.ProcessEnv;
beforeEach(async () => {
  previous = { ...process.env };
  process.env.NEXOGUARD_HTTP_MODE = 'local';
  delete process.env.FRONTEND_ORIGIN;
  delete process.env.NEXOGUARD_SWAGGER_ENABLED;
  const module = await Test.createTestingModule({
    imports: [ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }])],
    controllers: [RegistrationController, AuthController, SitesController, AnalysisController, MonitoringController, SslLabsController],
    providers: [
      { provide: AuthService, useValue: { authenticate: async () => { throw new UnauthorizedException(); } } },
      ...[RegisterUserService, SitesService, AnalysisService, MonitoringService, SslLabsService].map(provide => ({ provide, useValue: {} })),
    ],
  }).compile();
  app = module.createNestApplication({ logger: false });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
});
afterEach(async () => { await app.close(); process.env = previous; });

it('configuración desactiva exposición en producción por defecto y exige booleanos explícitos', () => {
  expect(swaggerEnabled({ NODE_ENV: 'production' })).toBe(false);
  expect(swaggerEnabled({ NEXOGUARD_HTTP_MODE: 'production' })).toBe(false);
  expect(swaggerEnabled({ NODE_ENV: 'production', NEXOGUARD_HTTP_MODE: 'local' })).toBe(true);
  expect(swaggerEnabled({ NEXOGUARD_HTTP_MODE: 'production', NEXOGUARD_SWAGGER_ENABLED: 'true' })).toBe(true);
  expect(swaggerEnabled({ NEXOGUARD_HTTP_MODE: 'local', NEXOGUARD_SWAGGER_ENABLED: 'false' })).toBe(false);
  expect(() => swaggerEnabled({ NEXOGUARD_SWAGGER_ENABLED: 'invalid' })).toThrow();
});
it('genera las veinte operaciones reales con respuestas, errores y todas las referencias resueltas', () => {
  const doc = createApiDocument(app);
  expect(contracts).toHaveLength(20);
  for (const c of contracts) {
    const operation = doc.paths[c.path][c.method]!;
    expect(operation.summary).toBeTruthy();
    expect(operation.responses[c.status]).toBeDefined();
    expect(operation.responses[429]).toBeDefined();
    expect(operation.responses[500]).toBeDefined();
  }
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    if ('$ref' in value && typeof value.$ref === 'string') expect(doc.components?.schemas?.[value.$ref.split('/').pop()!]).toBeDefined();
    for (const item of Object.values(value)) visit(item);
  };
  visit(doc);
});
it('describe DTO estrictos, contraseñas solo de entrada y CSRF con condiciones AND', () => {
  const doc = createApiDocument(app);
  expect(doc.paths['/auth/login'].post?.security).toEqual([{ csrfToken: [], authCsrfCookie: [] }]);
  expect(doc.paths['/users'].post?.security).toEqual([{ csrfToken: [], registrationCsrfCookie: [] }]);
  expect(doc.paths['/sites/{siteId}/ssl-labs'].post?.security).toEqual([{ session: [], csrfToken: [], authCsrfCookie: [] }]);
  expect(doc.paths['/sites/{siteId}/ssl-labs'].get?.security).toEqual([{ session: [] }]);
  expect(doc.components?.schemas?.RegistrationInput).toMatchObject({ additionalProperties: false, required: ['email', 'password'], properties: { password: { writeOnly: true, minLength: 12, maxLength: 128 } } });
  expect(doc.components?.schemas?.CreatedUser).toMatchObject({ properties: { id: { format: 'uuid' } } });
  expect(JSON.stringify(doc)).not.toContain('passwordHash');
  expect(JSON.stringify(doc)).not.toContain('SSLLABS_EMAIL=');
  expect(doc.paths['/auth/logout'].post?.responses[204]).not.toHaveProperty('content');
});
it('sirve UI y JSON sin habilitar acciones interactivas y conserva las guardas reales', async () => {
  setupSwagger(app); await app.listen(0, '127.0.0.1'); const base = await app.getUrl();
  expect((await fetch(`${base}/docs`)).status).toBe(200);
  const document = await fetch(`${base}/docs-json`);
  expect(document.status).toBe(200);
  expect(Object.keys((await document.json() as { paths: object }).paths)).toHaveLength(16);
  const init = await (await fetch(`${base}/docs/swagger-ui-init.js`)).text();
  expect(init).toContain('"supportedSubmitMethods": []');
  expect((await fetch(`${base}/auth/me`)).status).toBe(401);
  expect((await fetch(`${base}/sites`)).status).toBe(401);
  expect((await fetch(`${base}/users`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'fixture@example.invalid', password: 'clave-ficticia-de-prueba' }) })).status).toBe(403);
});
it('no registra UI ni JSON cuando la exposición está deshabilitada', async () => {
  process.env.NEXOGUARD_SWAGGER_ENABLED = 'false';
  setupSwagger(app); await app.listen(0, '127.0.0.1'); const base = await app.getUrl();
  expect((await fetch(`${base}/docs`)).status).toBe(404);
  expect((await fetch(`${base}/docs-json`)).status).toBe(404);
});
