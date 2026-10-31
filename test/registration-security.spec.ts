import 'reflect-metadata';
import { jest } from '@jest/globals';
import { ConflictException } from '@nestjs/common';
import { Prisma } from '../src/generated/prisma/client';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { UserRepository } from '../src/users/infrastructure/user.repository';
import { createRegistrationToken, isValidRegistrationToken } from '../src/users/presentation/registration-token';

describe('Token de registro', () => {
  it('acepta un token válido y rechaza ausentes, alterados y cookies distintas', () => {
    const token = createRegistrationToken();
    expect(isValidRegistrationToken(token, token)).toBe(true);
    expect(isValidRegistrationToken('', '')).toBe(false);
    expect(isValidRegistrationToken(token, '')).toBe(false);
    const altered = `${token.slice(0, -1)}${token.endsWith('0') ? '1' : '0'}`;
    expect(isValidRegistrationToken(altered, altered)).toBe(false);
    expect(isValidRegistrationToken(token, altered)).toBe(false);
  });

  it('rechaza un token vencido y un reloj anterior a su emisión', () => {
    const time = jest.spyOn(Date, 'now');
    try {
      time.mockReturnValue(1_700_000_000_000);
      const token = createRegistrationToken();
      time.mockReturnValue(1_700_000_600_000);
      expect(isValidRegistrationToken(token, token)).toBe(false);
      time.mockReturnValue(1_699_999_999_999);
      expect(isValidRegistrationToken(token, token)).toBe(false);
    } finally { time.mockRestore(); }
  });
});

describe('Repositorio de usuarios con Prisma simulado', () => {
  it('traduce una violación única sin revelar detalles', async () => {
    const create = jest.fn<() => Promise<never>>().mockRejectedValue(new Prisma.PrismaClientKnownRequestError('detalle privado', { code: 'P2002', clientVersion: 'test' }));
    const repo = new UserRepository({ usuario: { create } } as unknown as PrismaService);
    await expect(repo.create('a@example.com', 'a@example.com', 'hash')).rejects.toEqual(new ConflictException('No se pudo registrar el correo.'));
  });

  it('propaga errores de persistencia para que la aplicación los oculte', async () => {
    const failure = new Error('detalle privado');
    const create = jest.fn<() => Promise<never>>().mockRejectedValue(failure);
    const repo = new UserRepository({ usuario: { create } } as unknown as PrismaService);
    await expect(repo.create('a@example.com', 'a@example.com', 'hash')).rejects.toBe(failure);
  });
});
