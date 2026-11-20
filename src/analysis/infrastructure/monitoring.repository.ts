import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MonitoringPolicy } from '../application/monitoring-policy';

const scheduleSelect = { activa: true, intervaloMinutos: true, proximaEjecucionEn: true, ultimoEstado: true, revisionDominioId: true, actualizadoEn: true } as const;
@Injectable()
export class MonitoringRepository {
  constructor(private readonly prisma: PrismaService, private readonly policy: MonitoringPolicy) {}
  async get(owner: string, site: string) {
    if (!await this.prisma.sitio.findFirst({ where: { id: site, propietarioId: owner }, select: { id: true } })) throw new NotFoundException('Sitio no encontrado.');
    return { schedule: await this.prisma.programacionAnalisis.findUnique({ where: { sitioId: site }, select: scheduleSelect }), allowedMinutes: this.policy.allowedMinutes, warningDays: this.policy.warningDays, channel: 'IN_APP' };
  }
  configure(owner: string, site: string, enabled: boolean, minutes: number, now: Date) {
    if (enabled && !this.policy.allowedMinutes.includes(minutes)) throw new BadRequestException('Frecuencia no aprobada.');
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM sitios WHERE id = ${site} AND propietario_id = ${owner} FOR UPDATE`;
      const row = await tx.sitio.findFirst({ where: { id: site, propietarioId: owner }, include: { revisionActual: { include: { verificaciones: { where: { invalidadoEn: null, verificadoEn: { not: null }, verificacionValidaHasta: { gt: now } }, take: 1 } } } } });
      if (!row) throw new NotFoundException('Sitio no encontrado.');
      if (!enabled) {
        await tx.programacionAnalisis.updateMany({ where: { sitioId: site }, data: { activa: false, proximaEjecucionEn: null, ultimoEstado: 'DESACTIVADA', actualizadoEn: now } });
        return tx.programacionAnalisis.findUnique({ where: { sitioId: site }, select: scheduleSelect });
      }
      if (!row.revisionActual?.verificaciones.length) throw new ConflictException('Verifica la revisión actual antes de programar.');
      const data = { revisionDominioId: row.revisionActual.id, configuradoPorId: owner, intervaloMinutos: minutes, activa: true, proximaEjecucionEn: new Date(now.getTime() + minutes * 60000), ultimoEstado: 'ESPERANDO', actualizadoEn: now };
      return tx.programacionAnalisis.upsert({ where: { sitioId: site }, create: { sitioId: site, ...data }, update: data, select: scheduleSelect });
    });
  }
  due(now: Date) {
    return this.prisma.programacionAnalisis.findMany({ where: { activa: true, proximaEjecucionEn: { lte: now } }, orderBy: [{ proximaEjecucionEn: 'asc' }, { sitioId: 'asc' }], take: 20, select: { sitioId: true, configuradoPorId: true } });
  }
  async alerts(owner: string, site: string) {
    if (!await this.prisma.sitio.findFirst({ where: { id: site, propietarioId: owner }, select: { id: true } })) throw new NotFoundException('Sitio no encontrado.');
    return this.prisma.alerta.findMany({ where: { analisis: { verificacion: { revisionDominio: { sitioId: site, sitio: { propietarioId: owner } } } } }, orderBy: [{ creadoEn: 'desc' }, { id: 'desc' }], take: 50, select: { id: true, analisisId: true, codigoComprobacion: true, tipo: true, detalle: true, creadoEn: true, leidaEn: true } });
  }
  async read(owner: string, site: string, id: string, now: Date) {
    const scope = { id, analisis: { verificacion: { revisionDominio: { sitioId: site, sitio: { propietarioId: owner } } } } };
    // Idempotent read state, never overwrite the first acknowledgement timestamp.
    await this.prisma.alerta.updateMany({ where: { ...scope, leidaEn: null }, data: { leidaEn: now } });
    if (!await this.prisma.alerta.findFirst({ where: scope, select: { id: true } })) throw new NotFoundException('Alerta no encontrada.');
    return { read: true };
  }
}
