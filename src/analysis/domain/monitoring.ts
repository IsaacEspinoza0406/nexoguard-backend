import { createHash } from 'node:crypto';
import { compareAnalyses, HistoricalAnalysis } from './comparison';

export function nextOpportunity(due: Date, intervalMinutes: number, now: Date) {
  if (!Number.isSafeInteger(intervalMinutes) || intervalMinutes <= 0) throw new Error('INVALID_INTERVAL');
  const interval = intervalMinutes * 60000;
  return new Date(due.getTime() + (Math.max(0, Math.floor((now.getTime() - due.getTime()) / interval)) + 1) * interval);
}

export function alertCandidates(revision: string, previous: HistoricalAnalysis | null, current: HistoricalAnalysis, warningDays: number) {
  const entries: { codigoComprobacion: string; tipo: string; claveDeduplicacion: string; detalle: Record<string, string | number> }[] = [];
  if (current.estado !== 'COMPLETADO' || current.procedencia !== 'manual-v1') return entries;
  const key = (value: string) => createHash('sha256').update(value).digest('hex');
  if (previous) for (const row of compareAnalyses(previous, current)) {
    if (row.change === 'EMPEORO') entries.push({ codigoComprobacion: row.code, tipo: 'EMPEORAMIENTO', claveDeduplicacion: key(`regression:${current.id}:${row.code}`), detalle: { anteriorId: previous.id, antes: 'APROBADO', despues: 'HALLAZGO', rulesVersion: 'manual-v1' } });
  }
  const cert = current.resultados.find(r => r.codigoComprobacion === 'CERTIFICATE_EXPIRY');
  const evidence = cert?.evidencia;
  if (cert && ['APROBADO', 'HALLAZGO'].includes(cert.estado) && cert.observadoEn && evidence && typeof evidence === 'object' && !Array.isArray(evidence)) {
    const e = evidence as Record<string, unknown>;
    const expiry = typeof e.validTo === 'string' ? Date.parse(e.validTo) : NaN;
    const start = typeof e.validFrom === 'string' ? Date.parse(e.validFrom) : NaN;
    const remaining = expiry - cert.observadoEn.getTime();
    if (e.rulesVersion === 'manual-v1' && Number.isFinite(expiry) && Number.isFinite(start) && start <= cert.observadoEn.getTime() && Number.isSafeInteger(warningDays) && warningDays > 0 && remaining <= warningDays * 86400000) {
      entries.push({ codigoComprobacion: 'CERTIFICATE_EXPIRY', tipo: 'CERTIFICADO', claveDeduplicacion: key(`expiry:${revision}:${new Date(expiry).toISOString()}:${warningDays}`), detalle: { venceEn: new Date(expiry).toISOString(), observadoEn: cert.observadoEn.toISOString(), ventanaDias: warningDays, situacion: remaining <= 0 ? 'VENCIDO' : 'PROXIMO_A_VENCER' } });
    }
  }
  return entries;
}
