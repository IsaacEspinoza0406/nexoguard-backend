import 'reflect-metadata';
import { jest } from '@jest/globals';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AuthRepository } from '../src/auth/infrastructure/auth.repository';
import { AuthService } from '../src/auth/application/auth.service';
import { sessionHash } from '../src/auth/domain/session';
import { cookieOptions, httpSecurity } from '../src/security/http-security';
import { createRegistrationToken, isValidRegistrationToken, validateCsrfConfiguration } from '../src/users/presentation/registration-token';

describe('Autenticación HTTP, repositorio simulado', () => {
  it('rechaza accesos, rota identificadores, liga CSRF a la sesión y revoca al salir', async () => {
    const passwordHash = await argon2.hash('clave-ficticia-123', { type: argon2.argon2id });
    const sessions = new Map<string, boolean>();
    const repository = {
      findUser: jest.fn<AuthRepository['findUser']>().mockImplementation(async email => email === 'usuario@example.com' ? { id: 'u', correoOriginal: 'Usuario@example.com', passwordHash } : null),
      createSession: jest.fn<AuthRepository['createSession']>().mockImplementation(async (_id, hash, previous) => { if (previous) sessions.set(previous.toString('hex'), false); sessions.set(hash.toString('hex'), true); }),
      authenticate: jest.fn<AuthRepository['authenticate']>().mockImplementation(async hash => sessions.get(hash.toString('hex')) ? { id: 'u', email: 'Usuario@example.com' } : null),
      revoke: jest.fn<AuthRepository['revoke']>().mockImplementation(async hash => { sessions.set(hash.toString('hex'), false); }),
    };
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue({}).overrideProvider(AuthRepository).useValue(repository).compile();
    const app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    const origin = 'http://127.0.0.1:3000';
    async function csrf(session = '') {
      const r = await fetch(`${base}/auth/csrf`, { headers: { origin, cookie: session } });
      expect(r.status).toBe(200);
      const body = await r.json() as { token: string };
      return { token: body.token, cookie: [session, r.headers.get('set-cookie')!.split(';')[0]].filter(Boolean).join('; ') };
    }
    const post = (path: string, cookie: string, token: string, body?: object, requestOrigin = origin) => fetch(`${base}/auth/${path}`, { method: 'POST', headers: { origin: requestOrigin, cookie, 'x-csrf-token': token, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const credentials = { email: ' Usuario@Example.com ', password: 'clave-ficticia-123' };
    try {
      expect((await fetch(`${base}/auth/me`)).status).toBe(401);
      const token = await csrf();
      expect((await post('login', token.cookie, '', credentials)).status).toBe(403);
      expect((await post('login', token.cookie, token.token, credentials, 'https://otro.example')).status).toBe(403);
      const invalid = await post('login', token.cookie, token.token, { ...credentials, password: 'clave-equivocada-123' });
      expect(invalid.status).toBe(401);
      expect(JSON.stringify(await invalid.json())).not.toContain(passwordHash);
      const login = await post('login', token.cookie, token.token, credentials);
      expect(login.status).toBe(200);
      expect(await login.json()).toEqual({ id: 'u', email: 'Usuario@example.com' });
      const cookies = login.headers.getSetCookie();
      const sessionCookie = cookies.find(c => c.startsWith('nexoguard_session='))!.split(';')[0];
      expect(cookies.join(';')).toContain('HttpOnly');
      expect(cookies.join(';')).toContain('SameSite=Strict');
      expect((await fetch(`${base}/auth/me`, { headers: { cookie: sessionCookie } })).status).toBe(200);
      // El token anónimo anterior no puede usarse para cerrar la sesión nueva.
      expect((await post('logout', `${sessionCookie}; ${token.cookie}`, token.token)).status).toBe(403);
      const bound = await csrf(sessionCookie);
      const rotated = await post('login', bound.cookie, bound.token, credentials);
      expect(rotated.status).toBe(200);
      const newCookie = rotated.headers.getSetCookie().find(c => c.startsWith('nexoguard_session='))!.split(';')[0];
      expect(newCookie).not.toBe(sessionCookie);
      expect((await fetch(`${base}/auth/me`, { headers: { cookie: sessionCookie } })).status).toBe(401);
      const logoutToken = await csrf(newCookie);
      expect((await post('logout', logoutToken.cookie, logoutToken.token)).status).toBe(204);
      expect((await fetch(`${base}/auth/me`, { headers: { cookie: newCookie } })).status).toBe(401);
      expect(repository.findUser).toHaveBeenCalledWith('usuario@example.com');
      expect(sessions.get(sessionHash(newCookie.split('=')[1]).toString('hex'))).toBe(false);
    } finally { await app.close(); }
  }, 20000);
});

describe('Servicio de acceso', () => {
  it('responde igual para usuario inexistente y contraseña incorrecta', async () => {
    const findUser = jest.fn<AuthRepository['findUser']>().mockResolvedValue(null);
    const service = new AuthService({ findUser } as unknown as AuthRepository);
    await expect(service.login('no@example.com', 'clave-ficticia-123', '')).rejects.toThrow('Correo o contraseña incorrectos.');
  });

  it('oculta errores internos y no acepta cookies malformadas', async () => {
    const service = new AuthService({ findUser: async () => { throw new Error('datos internos'); } } as unknown as AuthRepository);
    await expect(service.login('a@example.com', 'clave-ficticia-123', '')).rejects.toThrow('No se pudo completar el acceso.');
    await expect(service.authenticate('malformada')).rejects.toThrow('Sesión no válida o caducada.');
  });
});

describe('Seguridad de producción', () => {
  it('requiere HTTPS y clave privada; usa cookies Secure host-only y token ligado', () => {
    const previous = { mode: process.env.NEXOGUARD_HTTP_MODE, origin: process.env.FRONTEND_ORIGIN, secret: process.env.NEXOGUARD_CSRF_SECRET };
    try {
      process.env.NEXOGUARD_HTTP_MODE = 'production'; delete process.env.FRONTEND_ORIGIN;
      expect(() => httpSecurity()).toThrow();
      process.env.FRONTEND_ORIGIN = 'https://nexoguard.example'; delete process.env.NEXOGUARD_CSRF_SECRET;
      expect(() => validateCsrfConfiguration()).toThrow();
      process.env.NEXOGUARD_CSRF_SECRET = 'clave-solo-para-pruebas-no-de-produccion';
      expect(cookieOptions()).toEqual({ httpOnly: true, secure: true, sameSite: 'strict', path: '/' });
      expect(httpSecurity().sessionCookie).toMatch(/^__Host-/);
      const token = createRegistrationToken('sesion-1');
      expect(isValidRegistrationToken(token, token, 'sesion-1')).toBe(true);
      expect(isValidRegistrationToken(token, token, 'sesion-2')).toBe(false);
    } finally {
      for (const [name, value] of Object.entries({ NEXOGUARD_HTTP_MODE: previous.mode, FRONTEND_ORIGIN: previous.origin, NEXOGUARD_CSRF_SECRET: previous.secret })) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    }
  });
});
