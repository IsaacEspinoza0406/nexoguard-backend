import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findUser(email: string) {
    return this.prisma.usuario.findUnique({ where: { correoNormalizado: email }, select: { id: true, correoOriginal: true, passwordHash: true } });
  }

  async createSession(userId: string, hash: Buffer, previous: Buffer | undefined, now: Date, expires: Date) {
    await this.prisma.$transaction(async tx => {
      if (previous) await tx.sesion.updateMany({ where: { identificadorHash: new Uint8Array(previous), revocadoEn: null }, data: { revocadoEn: now } });
      await tx.sesion.create({ data: { usuarioId: userId, identificadorHash: new Uint8Array(hash), ultimoUsoEn: now, expiraAbsolutoEn: expires } });
    });
  }

  async authenticate(hash: Buffer, now: Date, idleSince: Date) {
    const session = await this.prisma.sesion.findUnique({ where: { identificadorHash: new Uint8Array(hash) }, select: { usuario: { select: { id: true, correoOriginal: true } } } });
    if (!session?.usuario) return null;
    const touched = await this.prisma.sesion.updateMany({ where: { identificadorHash: new Uint8Array(hash), usuarioId: session.usuario.id, revocadoEn: null, expiraAbsolutoEn: { gt: now }, ultimoUsoEn: { gt: idleSince } }, data: { ultimoUsoEn: now } });
    return touched.count === 1 ? { id: session.usuario.id, email: session.usuario.correoOriginal } : null;
  }

  async revoke(hash: Buffer, now: Date) {
    await this.prisma.sesion.updateMany({ where: { identificadorHash: new Uint8Array(hash), revocadoEn: null }, data: { revocadoEn: now } });
  }
}
