import 'reflect-metadata';
import { jest } from '@jest/globals';
import { ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as argon2 from 'argon2';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { UserRepository } from '../src/users/infrastructure/user.repository';
import { RegisterUserService } from '../src/users/application/register-user.service';
import { ConflictException } from '@nestjs/common';

describe('Registro HTTP con repositorio simulado', () => {
  it('valida, normaliza, protege y limita solicitudes', async () => {
    const create = jest.fn<(original: string, normalized: string, hash: string) => Promise<{ id: string }>>().mockResolvedValue({ id: 'id-ficticio' });
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService).useValue({})
      .overrideProvider(UserRepository).useValue({ create }).compile();
    const app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as { port: number };
    const base = `http://127.0.0.1:${address.port}`;
    const origin = 'http://127.0.0.1:3000';
    try {
      const tokenResponse = await fetch(`${base}/users/registration-token`, { headers: { origin } });
      expect(tokenResponse.status).toBe(200);
      const { token } = await tokenResponse.json() as { token: string };
      const cookie = tokenResponse.headers.get('set-cookie')!.split(';')[0];
      const post = (body: object, csrf = token, requestOrigin = origin) => fetch(`${base}/users`, { method: 'POST', headers: { origin: requestOrigin, cookie, 'x-csrf-token': csrf, 'content-type': 'application/json' }, body: JSON.stringify(body) });
      expect((await post({ email: 'a@example.com', password: '123456789012' }, 'incorrecto')).status).toBe(403);
      expect((await post({ email: 'a@example.com', password: '123456789012' }, token, 'https://example.com')).status).toBe(403);
      expect((await post({ email: 'invalido', password: '123456789012' })).status).toBe(400);
      expect((await post({ email: 'a@example.com', password: 'short' })).status).toBe(400);
      expect((await post({ email: 'a@example.com', password: 'x'.repeat(129) })).status).toBe(400);
      expect((await post({ email: 'a@example.com', password: '123456789012' })).status).toBe(429);
      expect(create).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it('devuelve solo el identificador y almacena un hash verificable', async () => {
    const create = jest.fn<(original: string, normalized: string, hash: string) => Promise<{ id: string }>>().mockResolvedValue({ id: 'id-ficticio' });
    const module = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(PrismaService).useValue({}).overrideProvider(UserRepository).useValue({ create }).compile();
    const app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    const origin = 'http://127.0.0.1:3000';
    try {
      const t = await fetch(`${base}/users/registration-token`, { headers: { origin } });
      const { token } = await t.json() as { token: string };
      const response = await fetch(`${base}/users`, { method: 'POST', headers: { origin, cookie: t.headers.get('set-cookie')!.split(';')[0], 'x-csrf-token': token, 'content-type': 'application/json' }, body: JSON.stringify({ email: '  Ejemplo@Example.com  ', password: 'clave-ficticia-123' }) });
      expect(response.status).toBe(201);
      expect(await response.json()).toEqual({ id: 'id-ficticio' });
      expect(create.mock.calls[0][0]).toBe('Ejemplo@Example.com');
      expect(create.mock.calls[0][1]).toBe('ejemplo@example.com');
      expect(create.mock.calls[0][2]).toMatch(/^\$argon2id\$/);
      expect(await argon2.verify(create.mock.calls[0][2], 'clave-ficticia-123')).toBe(true);
      const extra = await fetch(`${base}/users`, { method: 'POST', headers: { origin, cookie: t.headers.get('set-cookie')!.split(';')[0], 'x-csrf-token': token, 'content-type': 'application/json' }, body: JSON.stringify({ email: 'a@example.com', password: 'clave-ficticia-123', role: 'admin' }) });
      expect(extra.status).toBe(400);
    } finally { await app.close(); }
  });
});

describe('Registro de aplicación con repositorio simulado', () => {
  it('conserva el conflicto de duplicado y oculta fallos internos', async () => {
    const repository = { create: jest.fn<UserRepository['create']>() };
    const service = new RegisterUserService(repository as unknown as UserRepository);
    repository.create.mockRejectedValueOnce(new ConflictException('Duplicado'));
    await expect(service.register('a@example.com', 'clave-ficticia-123')).rejects.toBeInstanceOf(ConflictException);
    repository.create.mockRejectedValueOnce(new Error('detalle privado'));
    await expect(service.register('a@example.com', 'clave-ficticia-123')).rejects.toThrow('No se pudo completar el registro.');
  });
});
