import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { Check } from '../domain/checks';
import { compareAnalyses } from '../domain/comparison';
import { guidanceFor } from '../domain/recommendations';
import { alertCandidates, nextOpportunity } from '../domain/monitoring';
import { MonitoringPolicy } from '../application/monitoring-policy';

@Injectable()
export class AnalysisRepository {
  constructor(private readonly prisma: PrismaService, private readonly policy: MonitoringPolicy = new MonitoringPolicy()) {}
  async start(owner: string, siteId: string, scheduled?: Date) {
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM sitios WHERE id = ${siteId} AND propietario_id = ${owner} FOR UPDATE`;
      const site = await tx.sitio.findFirst({ where: { id: siteId, propietarioId: owner }, include: { revisionActual: { include: { verificaciones: { where: { invalidadoEn: null, verificadoEn: { not: null }, verificacionValidaHasta: { gt: new Date() } }, take: 1 } } } } });
      if (!site) throw new NotFoundException('Sitio no encontrado.');
      const verification = site.revisionActual?.verificaciones[0];
      const schedule = scheduled ? await tx.programacionAnalisis.findUnique({ where: { sitioId: siteId } }) : null;
      if (scheduled) {
        if (!schedule?.activa || !schedule.proximaEjecucionEn || schedule.proximaEjecucionEn > scheduled) return null;
        if (schedule.configuradoPorId !== owner || schedule.revisionDominioId !== site.revisionActualId || !verification || !this.policy.allowedMinutes.includes(schedule.intervaloMinutos)) {
          await tx.programacionAnalisis.update({ where: { sitioId: siteId }, data: { activa: false, proximaEjecucionEn: null, ultimoEstado: 'REQUIERE_REVISION', actualizadoEn: scheduled } });
          return null;
        }
      }
      if (!verification) throw new ConflictException('Verifica la revisión actual del dominio antes de analizar.');
      const active = await tx.analisis.findFirst({ where: { procedencia: 'manual-v1', verificacion: { revisionDominio: { sitioId: siteId } }, estado: { in: ['PENDIENTE', 'EN_EJECUCION'] } } });
      if (scheduled && schedule?.proximaEjecucionEn) {
        await tx.programacionAnalisis.update({ where: { sitioId: siteId }, data: { proximaEjecucionEn: nextOpportunity(schedule.proximaEjecucionEn, schedule.intervaloMinutos, scheduled), ultimoEstado: active ? 'OMITIDA_POR_ANALISIS_ACTIVO' : 'ENCOLADO', actualizadoEn: scheduled } });
        if (active) return null;
      } else if (active) throw new ConflictException('El sitio ya tiene un análisis activo.');
      return tx.analisis.create({ data: { verificacionId: verification.id, estado: 'PENDIENTE', procedencia: 'manual-v1', programadoPara: scheduled ? schedule?.proximaEjecucionEn : null, disponibleEn: new Date(), reclamoExpiraEn: new Date(Date.now() + 90000) }, select: { id: true, estado: true } });
    });
  }

  async claim(id: string) {
    const reference = await this.prisma.analisis.findUnique({ where: { id }, select: { verificacion: { select: { revisionDominio: { select: { sitioId: true } } } } } });
    if (!reference) return null;
    return this.prisma.$transaction(async tx => {
      // Acquire the same site lock as renewal before creating a consistent-read snapshot.
      const siteId = reference.verificacion.revisionDominio.sitioId;
      await tx.$queryRaw`SELECT id FROM sitios WHERE id = ${siteId} FOR UPDATE`;
      const job = await tx.analisis.findUnique({ where: { id }, include: { verificacion: { include: { revisionDominio: { include: { sitio: true } } } } } });
      if (!job) return null;
      const v = job.verificacion;
      const now = new Date();
      if (job.programadoPara) {
        const schedule = await tx.programacionAnalisis.findUnique({ where: { sitioId: siteId } });
        if (!schedule?.activa || schedule.revisionDominioId !== v.revisionDominioId || schedule.configuradoPorId !== v.revisionDominio.sitio.propietarioId || !this.policy.allowedMinutes.includes(schedule.intervaloMinutos)) {
          await tx.analisis.updateMany({ where: { id, estado: 'PENDIENTE' }, data: { estado: 'FALLIDO', finalizadoEn: now, reclamoExpiraEn: null, motivoFallo: 'La programación dejó de estar autorizada antes de iniciar.' } });
          return null;
        }
      }
      if (v.invalidadoEn || !v.verificadoEn || !v.verificacionValidaHasta || v.verificacionValidaHasta <= now || v.revisionDominio.sitio.revisionActualId !== v.revisionDominioId) {
        await tx.analisis.updateMany({ where: { id, estado: 'PENDIENTE' }, data: { estado: 'FALLIDO', finalizadoEn: now, motivoFallo: 'La verificación dejó de estar vigente antes de iniciar.' } }); return null;
      }
      const result = await tx.analisis.updateMany({ where: { id, estado: 'PENDIENTE', reclamoExpiraEn: { gt: now } }, data: { estado: 'EN_EJECUCION', iniciadoEn: now, versionReclamo: { increment: 1 }, intentos: { increment: 1 }, reclamoExpiraEn: new Date(Date.now() + 90000) } });
      return result.count === 1 ? { domain: v.revisionDominio.dominioCanonico, version: job.versionReclamo + 1 } : null;
    });
  }

  async finish(id: string, version: number, results: Check[], failed: boolean) {
    const reference = await this.prisma.analisis.findUnique({ where: { id }, select: { verificacion: { select: { revisionDominio: { select: { sitioId: true } } } } } });
    if (!reference) return;
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM sitios WHERE id = ${reference.verificacion.revisionDominio.sitioId} FOR UPDATE`;
      const now = new Date();
      const updated = await tx.analisis.updateMany({ where: { id, estado: 'EN_EJECUCION', versionReclamo: version, reclamoExpiraEn: { gt: now } }, data: { estado: failed ? 'FALLIDO' : 'COMPLETADO', finalizadoEn: now, motivoFallo: failed ? 'No se pudo establecer una conexión TLS con el destino permitido.' : null, reclamoExpiraEn: null } });
      if (updated.count !== 1) return;
      await tx.resultadoComprobacion.createMany({ data: results.map(result => ({ analisisId: id, codigoComprobacion: result.code, estado: result.status, observadoEn: now, evidencia: { ...result.evidence, recommendation: result.recommendation, rulesVersion: 'manual-v1' } })) });
      if (!failed) {
        const current = await tx.analisis.findUniqueOrThrow({ where: { id }, include: { resultados: true, verificacion: { select: { revisionDominioId: true } } } });
        const previous = await tx.analisis.findFirst({ where: { id: { not: id }, procedencia: 'manual-v1', estado: 'COMPLETADO', verificacion: { revisionDominioId: current.verificacion.revisionDominioId }, OR: [{ creadoEn: { lt: current.creadoEn } }, { creadoEn: current.creadoEn, id: { lt: id } }] }, orderBy: [{ creadoEn: 'desc' }, { id: 'desc' }], include: { resultados: true } });
        const alerts = alertCandidates(current.verificacion.revisionDominioId, previous, current, this.policy.warningDays ?? 0);
        if (alerts.length) await tx.alerta.createMany({ data: alerts.map(alert => ({ ...alert, analisisId: id })), skipDuplicates: true });
      }
    });
  }

  expire() {
    const now = new Date();
    const cutoff = new Date(now.getTime() - 90000);
    return this.prisma.analisis.updateMany({
      where: { procedencia: 'manual-v1', estado: { in: ['PENDIENTE', 'EN_EJECUCION'] }, OR: [
        { reclamoExpiraEn: { lte: now } },
        { reclamoExpiraEn: null, OR: [
          { estado: 'PENDIENTE', creadoEn: { lte: cutoff } },
          { estado: 'EN_EJECUCION', iniciadoEn: { lte: cutoff } },
          { estado: 'EN_EJECUCION', iniciadoEn: null, creadoEn: { lte: cutoff } },
        ] },
      ] },
      data: { estado: 'FALLIDO', finalizadoEn: now, motivoFallo: 'Trabajo interrumpido o plazo de ejecución agotado. Puedes iniciar otro análisis.', reclamoExpiraEn: null, versionReclamo: { increment: 1 } },
    });
  }

  async history(owner: string, siteId: string) {
    if (!await this.prisma.sitio.findFirst({ where: { id: siteId, propietarioId: owner }, select: { id: true } })) throw new NotFoundException('Sitio no encontrado.');
    return this.prisma.analisis.findMany({ where: { procedencia: 'manual-v1', verificacion: { revisionDominio: { sitioId: siteId, sitio: { propietarioId: owner } } } }, orderBy: [{ creadoEn: 'desc' }, { id: 'desc' }], take: 50, select: { id: true, estado: true, creadoEn: true, iniciadoEn: true, finalizadoEn: true, motivoFallo: true, procedencia: true, verificacion: { select: { revisionDominio: { select: { dominioCanonico: true, numeroRevision: true } } } } } });
  }

  async detail(owner: string, siteId: string, id: string) {
    const job = await this.prisma.analisis.findFirst({ where: { id, procedencia: 'manual-v1', verificacion: { revisionDominio: { sitioId: siteId, sitio: { propietarioId: owner } } } }, select: { id: true, estado: true, creadoEn: true, finalizadoEn: true, motivoFallo: true, procedencia: true, resultados: { orderBy: { codigoComprobacion: 'asc' }, select: { codigoComprobacion: true, estado: true, evidencia: true, observadoEn: true } } } });
    if (!job) throw new NotFoundException('Análisis no encontrado.');
    return { ...job, resultados: job.resultados.map(result => ({ ...result, guidance: guidanceFor(result.codigoComprobacion) })) };
  }

  async compare(owner: string, siteId: string, beforeId: string, afterId: string) {
    if (beforeId === afterId) throw new BadRequestException('Selecciona dos análisis distintos.');
    // One scoped read: neither foreign sites nor foreign analyses are disclosed.
    const jobs = await this.prisma.analisis.findMany({
      where: { id: { in: [beforeId, afterId] }, procedencia: 'manual-v1', verificacion: { revisionDominio: { sitioId: siteId, sitio: { propietarioId: owner } } } },
      select: { id: true, estado: true, procedencia: true, creadoEn: true, verificacion: { select: { revisionDominioId: true } }, resultados: { select: { codigoComprobacion: true, estado: true, evidencia: true, observadoEn: true } } },
    });
    const before = jobs.find(job => job.id === beforeId), after = jobs.find(job => job.id === afterId);
    if (!before || !after) throw new NotFoundException('Análisis no encontrados.');
    if (before.verificacion.revisionDominioId !== after.verificacion.revisionDominioId) throw new ConflictException('Los análisis deben pertenecer a la misma revisión del dominio.');
    if (before.creadoEn > after.creadoEn) throw new BadRequestException('El análisis base debe ser anterior al análisis de destino.');
    return { before: { id: before.id, creadoEn: before.creadoEn, estado: before.estado }, after: { id: after.id, creadoEn: after.creadoEn, estado: after.estado }, revisionId: before.verificacion.revisionDominioId, results: compareAnalyses(before, after) };
  }
}
