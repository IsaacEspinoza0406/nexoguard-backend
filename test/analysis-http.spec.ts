import 'reflect-metadata';
import { jest } from '@jest/globals';
import { UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AuthService } from '../src/auth/application/auth.service';
import { AnalysisService } from '../src/analysis/application/analysis.service';

it('controlador: sesión, CSRF/origen, cuerpos vacíos y propagación del propietario', async () => {
  const service = { start: jest.fn<AnalysisService['start']>().mockResolvedValue({ id: 'job', estado: 'PENDIENTE' }), history: jest.fn<AnalysisService['history']>().mockResolvedValue([]), detail: jest.fn<AnalysisService['detail']>(), compare: jest.fn<AnalysisService['compare']>() };
  const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue({}).overrideProvider(AnalysisService).useValue(service).overrideProvider(AuthService).useValue({ authenticate: async (token: string) => { if (!token) throw new UnauthorizedException(); return { id: 'owner', email: 'fixture@example.invalid' }; } }).compile();
  const app = module.createNestApplication({ logger: false }); await app.listen(0, '127.0.0.1');
  const base = await app.getUrl(), site = '12345678-1234-4234-8234-123456789abc', origin = 'http://127.0.0.1:3000';
  const path = `${base}/sites/${site}/analyses`, session = `nexoguard_session=${'a'.repeat(64)}`;
  try {
    expect((await fetch(path)).status).toBe(401);
    expect((await fetch(path, { headers: { cookie: session } })).status).toBe(200);
    expect(service.history).toHaveBeenCalledWith('owner', site);
    const comparison = path + '/compare/' + site + '/12345678-1234-4234-8234-123456789abd';
    expect((await fetch(comparison)).status).toBe(401);
    expect((await fetch(comparison, { headers: { cookie: session } })).status).toBe(200);
    expect(service.compare).toHaveBeenCalledWith('owner', site, site, '12345678-1234-4234-8234-123456789abd');
    expect((await fetch(path + '/compare/invalid/invalid', { headers: { cookie: session } })).status).toBe(400);
    const csrf = await fetch(`${base}/auth/csrf`, { headers: { origin, cookie: session } }); const { token } = await csrf.json() as { token: string };
    const headers = { origin, cookie: `${session}; ${csrf.headers.getSetCookie()[0].split(';')[0]}`, 'x-csrf-token': token, 'content-type': 'application/json' };
    expect((await fetch(path, { method: 'POST', headers: { ...headers, origin: 'https://untrusted.example' } })).status).toBe(403);
    expect((await fetch(path, { method: 'POST', headers, body: JSON.stringify({ domain: 'other.com' }) })).status).toBe(400);
    expect((await fetch(path, { method: 'POST', headers })).status).toBe(202);
    expect(service.start).toHaveBeenCalledWith('owner', site);
  } finally { await app.close(); }
}, 15000);
