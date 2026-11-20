import 'reflect-metadata';
import { jest } from '@jest/globals';
import { ValidationPipe, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AuthService } from '../src/auth/application/auth.service';
import { SslLabsService } from '../src/analysis/application/ssl-labs.service';

async function setup() {
  const service = { history: jest.fn<SslLabsService['history']>().mockResolvedValue({ configured: false, reason: 'Configuración requerida.', reports: [] }), start: jest.fn<SslLabsService['start']>().mockResolvedValue({ id: 'external', estado: 'PENDIENTE' }) };
  const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue({}).overrideProvider(SslLabsService).useValue(service).overrideProvider(AuthService).useValue({ authenticate: async (token: string) => { if (!token) throw new UnauthorizedException(); return { id: 'owner', email: 'fixture@example.invalid' }; } }).compile();
  const app = module.createNestApplication({ logger: false }); app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })); await app.listen(0, '127.0.0.1');
  const base = await app.getUrl(), id = '12345678-1234-4234-8234-123456789abc', origin = 'http://127.0.0.1:3000', session = `nexoguard_session=${'a'.repeat(64)}`;
  const csrf = await fetch(`${base}/auth/csrf`, { headers: { origin, cookie: session } }); const { token } = await csrf.json() as { token: string };
  const headers = { origin, cookie: `${session}; ${csrf.headers.getSetCookie()[0].split(';')[0]}`, 'x-csrf-token': token, 'content-type': 'application/json' };
  return { app, base, id, path: `${base}/sites/${id}/ssl-labs`, headers, service };
}
it('SSL Labs API: sesión, origen/CSRF y propietario sin divulgar configuración privada', async () => {
  const { app, path, headers, service } = await setup();
  try {
    expect((await fetch(path)).status).toBe(401);
    expect((await fetch(path, { headers })).status).toBe(200); expect(service.history).toHaveBeenCalledWith('owner', expect.any(String));
    expect((await fetch(path, { method: 'POST' })).status).toBe(401);
    expect((await fetch(path, { method: 'POST', headers: { cookie: headers.cookie }, body: '{}' })).status).toBe(403);
    expect((await fetch(path, { method: 'POST', headers: { ...headers, origin: 'https://untrusted.example' }, body: '{"consent":true}' })).status).toBe(403);
  } finally { await app.close(); }
}, 15000);
it('exige consentimiento explícito y rechaza campos imprevistos', async () => {
  const { app, path, headers, service } = await setup();
  try {
    expect((await fetch(path, { method: 'POST', headers, body: '{"consent":false}' })).status).toBe(400);
    expect((await fetch(path, { method: 'POST', headers, body: '{"consent":true,"host":"other.example"}' })).status).toBe(400);
    expect(service.start).not.toHaveBeenCalled();
  } finally { await app.close(); }
}, 15000);
it('encola una consulta autorizada con 202 y aplica límite de solicitudes', async () => {
  const { app, path, headers, service, id } = await setup();
  try {
    expect((await fetch(path, { method: 'POST', headers, body: '{"consent":true}' })).status).toBe(202);
    expect(service.start).toHaveBeenCalledWith('owner', id, true);
    expect((await fetch(path, { method: 'POST', headers, body: '{"consent":true}' })).status).toBe(202);
    expect((await fetch(path, { method: 'POST', headers, body: '{"consent":true}' })).status).toBe(429);
  } finally { await app.close(); }
}, 15000);
