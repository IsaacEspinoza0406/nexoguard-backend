import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
import { request } from 'node:http';
import { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import { AuthController } from '../src/auth/presentation/auth.controller';
import { AuthService } from '../src/auth/application/auth.service';
import { RegistrationController } from '../src/users/presentation/registration.controller';
import { RegisterUserService } from '../src/users/application/register-user.service';
import { securityHeaders } from '../src/security/http-security';

it('GET CSRF de producción sin Origin exige Fetch Metadata y Host exactos; POST conserva Origin/token/cookie', async () => {
  const previous = { ...process.env };
  process.env.NEXOGUARD_HTTP_MODE = 'production';
  process.env.FRONTEND_ORIGIN = 'https://nexoguard.example.invalid';
  process.env.NEXOGUARD_CSRF_SECRET = randomBytes(32).toString('hex');
  const module = await Test.createTestingModule({
    imports: [ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }])],
    controllers: [AuthController, RegistrationController],
    providers: [{ provide: AuthService, useValue: {} }, { provide: RegisterUserService, useValue: {} }],
  }).compile();
  const app = module.createNestApplication({ logger: false });
  app.use(securityHeaders);
  try {
    await app.listen(0, '127.0.0.1');
    const port = (app.getHttpServer().address() as AddressInfo).port;
    const send = (path: string, headers: Record<string, string>, method = 'GET') => new Promise<{ status: number; cookies: string[]; body: string }>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path, method, headers, agent: false }, res => {
        expect(res.headers['x-powered-by']).toBeUndefined();
        expect(res.headers['x-content-type-options']).toBe('nosniff');
        let body = ''; res.on('data', b => { body += b; });
        res.on('end', () => resolve({ status: res.statusCode!, cookies: res.headers['set-cookie'] || [], body }));
      }); req.setTimeout(3000, () => req.destroy(new Error('HTTP test timeout'))); req.on('error', reject); req.end();
    });
    const trusted = { host: 'nexoguard.example.invalid', 'sec-fetch-site': 'same-origin' };
    for (const path of ['/auth/csrf', '/users/registration-token']) {
      const ok = await send(path, trusted);
      expect(ok.status).toBe(200);
      expect(ok.cookies[0]).toContain('HttpOnly'); expect(ok.cookies[0]).toContain('Secure'); expect(ok.cookies[0]).toContain('SameSite=Strict');
      expect((await send(path, { host: trusted.host })).status).toBe(403);
      expect((await send(path, { ...trusted, host: 'other.example.invalid' })).status).toBe(403);
      expect((await send(path, { ...trusted, 'sec-fetch-site': 'cross-site' })).status).toBe(403);
      expect((await send(path, { ...trusted, origin: 'null' })).status).toBe(403);
      expect((await send(path, { ...trusted, origin: 'https://other.example.invalid' })).status).toBe(403);
    }
    const issued = await send('/auth/csrf', trusted);
    const token = (JSON.parse(issued.body) as { token: string }).token;
    const cookie = issued.cookies[0].split(';')[0];
    expect((await send('/auth/login', { ...trusted, cookie, 'x-csrf-token': token }, 'POST')).status).toBe(403);
    expect((await send('/auth/login', { ...trusted, origin: process.env.FRONTEND_ORIGIN!, cookie }, 'POST')).status).toBe(403);
    process.env.NEXOGUARD_HTTP_MODE = 'local'; delete process.env.FRONTEND_ORIGIN;
    expect((await send('/auth/csrf', { host: '127.0.0.1:3000', 'sec-fetch-site': 'same-origin' })).status).toBe(403);
  } finally { await app.close(); process.env = previous; }
}, 20000);
