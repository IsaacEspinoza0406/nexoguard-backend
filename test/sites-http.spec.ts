import 'reflect-metadata';
import { jest } from '@jest/globals';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { AuthService } from '../src/auth/application/auth.service';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { SitesService } from '../src/sites/application/sites.service';

it('API de sitios: sesión obligatoria, CSRF/origen, DTO estricto y límites (servicio simulado)', async () => {
  const sites = { list: jest.fn<SitesService['list']>().mockResolvedValue([]), create: jest.fn<SitesService['create']>().mockResolvedValue({ id: 's', domain: 'example.com', createdAt: new Date(), status: 'unverified', verification: null }) };
  const auth = { authenticate: async (value: string) => { if (value !== 'a'.repeat(64)) throw new (await import('@nestjs/common')).UnauthorizedException(); return { id: 'owner', email: 'u@example.com' }; } };
  const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue({}).overrideProvider(AuthService).useValue(auth).overrideProvider(SitesService).useValue(sites).compile();
  const app = module.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  const origin = 'http://127.0.0.1:3000';
  const session = `nexoguard_session=${'a'.repeat(64)}`;
  try {
    expect((await fetch(`${base}/sites`)).status).toBe(401);
    expect((await fetch(`${base}/sites`, { headers: { cookie: session } })).status).toBe(200);
    expect(sites.list).toHaveBeenCalledWith('owner');
    const csrf = await fetch(`${base}/auth/csrf`, { headers: { origin, cookie: session } });
    const { token } = await csrf.json() as { token: string };
    const headers = { origin, cookie: `${session}; ${csrf.headers.getSetCookie()[0].split(';')[0]}`, 'content-type': 'application/json', 'x-csrf-token': token };
    const post = (body: object, extra: object = {}) => fetch(`${base}/sites`, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(body) });
    expect((await post({ domain: 'example.com' }, { 'x-csrf-token': '' })).status).toBe(403);
    expect((await post({ domain: 'example.com' }, { origin: 'https://other.example' })).status).toBe(403);
    expect((await post({ domain: 'example.com', propietarioId: 'other' })).status).toBe(400);
    expect((await post({ domain: 'example.com' })).status).toBe(201);
    expect(sites.create).toHaveBeenCalledWith('owner', 'example.com');
    const unexpectedBody = await fetch(`${base}/sites/12345678-1234-4234-8234-123456789abc/verification-challenges`, { method: 'POST', headers, body: JSON.stringify({ domain: 'other.example.com' }) });
    expect(unexpectedBody.status).toBe(400);
    let status = 0;
    for (let i = 0; i < 12 && status !== 429; i++) status = (await post({ domain: 'example.com' })).status;
    expect(status).toBe(429);
  } finally { await app.close(); }
}, 20000);
