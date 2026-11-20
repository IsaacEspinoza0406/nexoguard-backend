import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { SSL_CODE, SSL_SOURCE, initialSslReport, publicSslReport, SslReport, storedSslReport } from '../domain/ssl-labs';

@Injectable()
export class SslLabsRepository {
  constructor(private readonly prisma: PrismaService) {}
  async authorized(id: string, owner: string, domain: string, now: Date) {
    const job = await this.prisma.analisis.findFirst({ where: { id, procedencia: SSL_SOURCE, verificacion: { invalidadoEn: null, verificadoEn: { not: null }, verificacionValidaHasta: { gt: now }, revisionDominio: { dominioCanonico: domain, sitio: { propietarioId: owner } } } }, select: { verificacion: { select: { revisionDominioId: true, revisionDominio: { select: { sitio: { select: { revisionActualId: true } } } } } } } });
    return !!job && job.verificacion.revisionDominioId === job.verificacion.revisionDominio.sitio.revisionActualId;
  }
  private async owned(owner: string, site: string) {
    if (!await this.prisma.sitio.findFirst({ where: { id: site, propietarioId: owner }, select: { id: true } })) throw new NotFoundException('Sitio no encontrado.');
  }
  async history(owner: string, site: string) {
    await this.owned(owner, site);
    const rows = await this.prisma.analisis.findMany({ where: { procedencia: SSL_SOURCE, verificacion: { revisionDominio: { sitioId: site, sitio: { propietarioId: owner } } } }, orderBy: [{ creadoEn: 'desc' }, { id: 'desc' }], take: 20, select: { id: true, estado: true, creadoEn: true, finalizadoEn: true, motivoFallo: true, disponibleEn: true, resultados: { where: { codigoComprobacion: SSL_CODE }, select: { evidencia: true } }, verificacion: { select: { revisionDominio: { select: { numeroRevision: true, dominioCanonico: true } } } } } });
    return rows.map(({ resultados, ...row }) => ({ ...row, report: publicSslReport(resultados[0]?.evidencia) }));
  }
  start(owner: string, site: string, now: Date) {
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM sitios WHERE id=${site} AND propietario_id=${owner} FOR UPDATE`;
      const row = await tx.sitio.findFirst({ where: { id: site, propietarioId: owner }, include: { revisionActual: { include: { verificaciones: { where: { invalidadoEn: null, verificadoEn: { not: null }, verificacionValidaHasta: { gt: now } }, take: 1 } } } } });
      if (!row) throw new NotFoundException('Sitio no encontrado.');
      const verification = row.revisionActual?.verificaciones[0];
      if (!verification) throw new ConflictException('Verifica la revisión actual antes de consultar SSL Labs.');
      if (await tx.analisis.findFirst({ where: { procedencia: SSL_SOURCE, estado: { in: ['PENDIENTE', 'EN_EJECUCION'] }, verificacion: { revisionDominio: { sitioId: site } } }, select: { id: true } })) throw new ConflictException('El sitio ya tiene una consulta SSL Labs pendiente.');
      return tx.analisis.create({ data: { verificacionId: verification.id, estado: 'PENDIENTE', procedencia: SSL_SOURCE, disponibleEn: now, resultados: { create: { codigoComprobacion: SSL_CODE, estado: 'NO_EVALUADO', evidencia: { ...initialSslReport(owner, now) } } } }, select: { id: true, estado: true } });
    });
  }
  claim(now: Date, onlySite?: string) {
    return this.prisma.$transaction(async tx => {
      // One persisted gate serializes all processes without holding a transaction during HTTP.
      await tx.$queryRaw`SELECT id FROM proveedores_externos WHERE id=${SSL_SOURCE} FOR UPDATE`;
      const gate = await tx.proveedorExterno.findUnique({ where: { id: SSL_SOURCE } });
      if (!gate || gate.siguienteSolicitudEn > now || gate.reclamoExpiraEn && gate.reclamoExpiraEn > now) return null;
      const job = await tx.analisis.findFirst({ where: { procedencia: SSL_SOURCE, ...(onlySite ? { verificacion: { revisionDominio: { sitioId: onlySite } } } : {}), estado: { in: ['PENDIENTE', 'EN_EJECUCION'] }, disponibleEn: { lte: now }, OR: [{ reclamoExpiraEn: null }, { reclamoExpiraEn: { lte: now } }] }, orderBy: [{ creadoEn: 'asc' }, { id: 'asc' }], include: { resultados: true, verificacion: { include: { revisionDominio: { include: { sitio: true } } } } } });
      if (!job) return null;
      const report = storedSslReport(job.resultados.find(r => r.codigoComprobacion === SSL_CODE)?.evidencia);
      const v = job.verificacion;
      if (!report || v.invalidadoEn || !v.verificadoEn || !v.verificacionValidaHasta || v.verificacionValidaHasta <= now || v.revisionDominio.sitio.revisionActualId !== v.revisionDominioId || v.revisionDominio.sitio.propietarioId !== report.requestedBy || now.getTime() - job.creadoEn.getTime() >= 3600000) {
        await tx.analisis.update({ where: { id: job.id }, data: { estado: 'FALLIDO', finalizadoEn: now, reclamoExpiraEn: null, motivoFallo: 'Consulta externa vencida o sin autorización vigente.' } });
        return null;
      }
      const lease = new Date(now.getTime() + 45000);
      await tx.proveedorExterno.update({ where: { id: SSL_SOURCE }, data: { version: { increment: 1 }, reclamoExpiraEn: lease, siguienteSolicitudEn: lease } });
      await tx.analisis.update({ where: { id: job.id }, data: { estado: 'EN_EJECUCION', iniciadoEn: job.iniciadoEn ?? now, reclamoExpiraEn: lease, versionReclamo: { increment: 1 }, intentos: { increment: 1 } } });
      return { id: job.id, domain: v.revisionDominio.dominioCanonico, report, jobVersion: job.versionReclamo + 1, gateVersion: gate.version + 1 };
    });
  }
  finish(claim: { id: string; jobVersion: number; gateVersion: number }, report: SslReport, delay: number, now: Date) {
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM proveedores_externos WHERE id=${SSL_SOURCE} FOR UPDATE`;
      const gate = await tx.proveedorExterno.findUnique({ where: { id: SSL_SOURCE } });
      if (!gate || gate.version !== claim.gateVersion || !gate.reclamoExpiraEn || gate.reclamoExpiraEn <= now) return;
      const next = new Date(Math.min(8640000000000000, now.getTime() + delay));
      const terminal = ['READY', 'ERROR'].includes(report.phase);
      const updated = await tx.analisis.updateMany({ where: { id: claim.id, procedencia: SSL_SOURCE, versionReclamo: claim.jobVersion, estado: 'EN_EJECUCION', reclamoExpiraEn: { gt: now } }, data: { estado: terminal ? report.phase === 'READY' ? 'COMPLETADO' : 'FALLIDO' : 'PENDIENTE', finalizadoEn: terminal ? now : null, motivoFallo: report.reason, disponibleEn: next, reclamoExpiraEn: null } });
      if (updated.count) await tx.resultadoComprobacion.updateMany({ where: { analisisId: claim.id, codigoComprobacion: SSL_CODE }, data: { estado: 'NO_EVALUADO', observadoEn: now, evidencia: { ...report } } });
      await tx.proveedorExterno.update({ where: { id: SSL_SOURCE }, data: { siguienteSolicitudEn: next, reclamoExpiraEn: null } });
    });
  }
}
