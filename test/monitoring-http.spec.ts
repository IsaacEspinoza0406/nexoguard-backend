import 'reflect-metadata';
import { jest } from '@jest/globals';
import { ValidationPipe, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AuthService } from '../src/auth/application/auth.service';
import { MonitoringService } from '../src/analysis/application/monitoring.service';

it('API monitoreo: sesión, UUID, DTO estricto, CSRF/origen y propietario propagado', async () => {
  const service = { get: jest.fn<MonitoringService['get']>().mockResolvedValue({ schedule: null, allowedMinutes: [], warningDays: null, channel: 'IN_APP' }), configure: jest.fn<MonitoringService['configure']>().mockResolvedValue(null), alerts: jest.fn<MonitoringService['alerts']>().mockResolvedValue([]), read: jest.fn<MonitoringService['read']>().mockResolvedValue({ read: true }) };
  const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue({}).overrideProvider(MonitoringService).useValue(service).overrideProvider(AuthService).useValue({ authenticate: async (token: string) => { if (!token) throw new UnauthorizedException(); return { id: 'owner', email: 'fixture@example.invalid' }; } }).compile();
  const app = module.createNestApplication({ logger: false }); app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })); await app.listen(0, '127.0.0.1');
  const base = await app.getUrl(), id = '12345678-1234-4234-8234-123456789abc', origin = 'http://127.0.0.1:3000', session = `nexoguard_session=${'a'.repeat(64)}`, path = `${base}/sites/${id}`;
  try {
    expect((await fetch(`${path}/schedule`)).status).toBe(401);
    const config = await fetch(`${path}/schedule`, { headers: { cookie: session } }); expect(config.status).toBe(200); expect(config.headers.get('cache-control')).toBe('no-store');
    expect(service.get).toHaveBeenCalledWith('owner', id);
    expect((await fetch(`${base}/sites/invalid/schedule`, { headers: { cookie: session } })).status).toBe(400);
    expect((await fetch(`${path}/alerts`, { headers: { cookie: session } })).status).toBe(200); expect(service.alerts).toHaveBeenCalledWith('owner', id);
    expect((await fetch(`${path}/schedule`, { method: 'POST', headers: { cookie: session } })).status).toBe(403);
    const csrf = await fetch(`${base}/auth/csrf`, { headers: { origin, cookie: session } }); const { token } = await csrf.json() as { token: string };
    const headers = { origin, cookie: `${session}; ${csrf.headers.getSetCookie()[0].split(';')[0]}`, 'x-csrf-token': token, 'content-type': 'application/json' };
    for (const body of [{ enabled: 'true' }, { enabled: true, intervalMinutes: '1440' }, { enabled: true, intervalMinutes: -1 }, { enabled: true, intervalMinutes: 1440, owner: 'other' }]) expect((await fetch(`${path}/schedule`, { method: 'POST', headers, body: JSON.stringify(body) })).status).toBe(400);
    expect((await fetch(`${path}/schedule`, { method: 'POST', headers: { ...headers, origin: 'https://untrusted.example' }, body: JSON.stringify({ enabled: false }) })).status).toBe(403);
    expect((await fetch(`${path}/schedule`, { method: 'POST', headers, body: JSON.stringify({ enabled: true, intervalMinutes: 1440 }) })).status).toBe(200);
    expect(service.configure).toHaveBeenCalledWith('owner', id, true, 1440);
    expect((await fetch(`${path}/schedule`, { method: 'POST', headers, body: JSON.stringify({ enabled: false }) })).status).toBe(200);
    expect(service.configure).toHaveBeenCalledWith('owner', id, false, 0);
    expect((await fetch(`${path}/alerts/${id}/read`, { method: 'POST', headers, body: '{}' })).status).toBe(200); expect(service.read).toHaveBeenCalledWith('owner', id, id);
    expect((await fetch(`${path}/alerts/${id}/read`, { method: 'POST', headers, body: '{"read":true}' })).status).toBe(400);
  } finally { await app.close(); }
}, 15000);
