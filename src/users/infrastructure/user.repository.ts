import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

@Injectable()
export class UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(correoOriginal: string, correoNormalizado: string, passwordHash: string): Promise<{ id: string }> {
    try {
      return await this.prisma.usuario.create({ data: { correoOriginal, correoNormalizado, passwordHash }, select: { id: true } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('No se pudo registrar el correo.');
      }
      throw error;
    }
  }
}
