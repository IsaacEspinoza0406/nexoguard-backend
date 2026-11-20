import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';

const siteSelect = { id: true, dominioCanonico: true, creadoEn: true, revisionActual: { select: { verificaciones: { where: { invalidadoEn: null }, orderBy: [{ creadoEn: 'desc' }, { id: 'desc' }], take: 1, select: { id: true, desafioExpiraEn: true, verificadoEn: true, verificacionValidaHasta: true } } } } } satisfies Prisma.SitioSelect;

@Injectable()
export class SitesRepository {
  constructor(private readonly prisma: PrismaService) {}

  list(owner: string) { return this.prisma.sitio.findMany({ where: { propietarioId: owner }, select: siteSelect, orderBy: [{ creadoEn: 'desc' }, { id: 'desc' }] }); }

  async create(owner: string, domain: string) {
    return this.prisma.$transaction(async tx => {
      const site = await tx.sitio.create({ data: { propietarioId: owner, dominioCanonico: domain } });
      const revision = await tx.revisionDominio.create({ data: { sitioId: site.id, dominioCanonico: domain, numeroRevision: 1 } });
      return tx.sitio.update({ where: { id: site.id }, data: { revisionActualId: revision.id }, select: siteSelect });
    });
  }

  private async owned(tx: Prisma.TransactionClient, owner: string, id: string) {
    // Serialize issuance/confirmation on the site row; a renewal cannot resurrect an old challenge.
    await tx.$queryRaw`SELECT id FROM sitios WHERE id = ${id} AND propietario_id = ${owner} FOR UPDATE`;
    const site = await tx.sitio.findFirst({ where: { id, propietarioId: owner }, select: { dominioCanonico: true, revisionActualId: true } });
    if (!site?.revisionActualId) throw new NotFoundException('Sitio no encontrado.');
    return site;
  }

  issue(owner: string, id: string, hash: Uint8Array, expires: Date, now: Date) {
    return this.prisma.$transaction(async tx => {
      const site = await this.owned(tx, owner, id);
      await tx.verificacionDominio.updateMany({ where: { revisionDominioId: site.revisionActualId!, invalidadoEn: null }, data: { invalidadoEn: now } });
      const challenge = await tx.verificacionDominio.create({ data: { revisionDominioId: site.revisionActualId!, codigoHash: new Uint8Array(hash), desafioExpiraEn: expires } });
      return { id: challenge.id, domain: site.dominioCanonico };
    });
  }

  async pending(owner: string, id: string, challengeId: string) {
    const site = await this.prisma.sitio.findFirst({ where: { id, propietarioId: owner }, select: { dominioCanonico: true, revisionActual: { select: { verificaciones: { where: { id: challengeId, invalidadoEn: null }, select: { id: true, codigoHash: true, desafioExpiraEn: true, verificadoEn: true } } } } } });
    if (!site) throw new NotFoundException('Sitio no encontrado.');
    const challenge = site.revisionActual?.verificaciones[0];
    if (!challenge) throw new ConflictException('Desafío inexistente o renovado. Genera otro.');
    return { domain: site.dominioCanonico, ...challenge };
  }

  complete(owner: string, id: string, challengeId: string, now: Date, validUntil: Date) {
    return this.prisma.$transaction(async tx => {
      const site = await this.owned(tx, owner, id);
      const result = await tx.verificacionDominio.updateMany({ where: { id: challengeId, revisionDominioId: site.revisionActualId!, invalidadoEn: null, verificadoEn: null, desafioExpiraEn: { gt: now } }, data: { verificadoEn: now, verificacionValidaHasta: validUntil } });
      if (result.count !== 1) throw new ConflictException('El desafío caducó, fue renovado o ya fue utilizado.');
      return { verifiedAt: now, validUntil };
    });
  }
}
