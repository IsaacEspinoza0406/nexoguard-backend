import { jest } from '@jest/globals';
import { AuthRepository } from '../src/auth/infrastructure/auth.repository';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { sessionHash } from '../src/auth/domain/session';

it('comprueba caducidad absoluta, inactividad y revocación al actualizar atómicamente', async () => {
  const findUnique = jest.fn<() => Promise<unknown>>().mockResolvedValue({ usuario: { id: 'u', correoOriginal: 'u@example.com' } });
  const updateMany = jest.fn<() => Promise<{ count: number }>>().mockResolvedValue({ count: 0 });
  const repo = new AuthRepository({ sesion: { findUnique, updateMany } } as unknown as PrismaService);
  const now = new Date(); const idle = new Date(now.getTime() - 1800000); const hash = sessionHash('ficticio');
  expect(await repo.authenticate(hash, now, idle)).toBeNull();
  expect(updateMany).toHaveBeenCalledWith({ where: { identificadorHash: new Uint8Array(hash), usuarioId: 'u', revocadoEn: null, expiraAbsolutoEn: { gt: now }, ultimoUsoEn: { gt: idle } }, data: { ultimoUsoEn: now } });
});
