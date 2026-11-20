import 'reflect-metadata';
import { jest } from '@jest/globals';
import { ServiceUnavailableException } from '@nestjs/common';
import { alertCandidates, nextOpportunity } from '../src/analysis/domain/monitoring';
import { HistoricalAnalysis } from '../src/analysis/domain/comparison';
import { MonitoringPolicy } from '../src/analysis/application/monitoring-policy';
import { MonitoringService } from '../src/analysis/application/monitoring.service';
import { MonitoringRepository } from '../src/analysis/infrastructure/monitoring.repository';
import { AnalysisRepository } from '../src/analysis/infrastructure/analysis.repository';
import { AnalysisService } from '../src/analysis/application/analysis.service';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';

// These are controlled test policy values, not implicit production approval of DP-08.
const policy: MonitoringPolicy = { allowedMinutes: [1440, 10080], warningDays: 30 };
const now = new Date('2026-01-01T00:00:00.000Z');
function analysis(id: string, approved: boolean): HistoricalAnalysis { return { id, estado: 'COMPLETADO', procedencia: 'manual-v1', creadoEn: now, resultados: [{ codigoComprobacion: 'HSTS', estado: approved ? 'APROBADO' : 'HALLAZGO', evidencia: { rulesVersion: 'manual-v1', positiveMaxAge: approved }, observadoEn: now }] }; }

describe('Calendario y alertas con reloj controlado', () => {
  it.each([1440, 10080])('conserva cadencia de %s minutos sin recuperar todas las oportunidades perdidas', minutes => {
    const due = new Date(now.getTime() - minutes * 60000 * 5);
    expect(nextOpportunity(due, minutes, now)).toEqual(new Date(now.getTime() + minutes * 60000));
    expect(nextOpportunity(due, minutes, new Date(now.getTime() + 15000))).toEqual(new Date(now.getTime() + minutes * 60000));
  });
  it('rechaza intervalos no válidos', () => { expect(() => nextOpportunity(now, 0, now)).toThrow(); });
  it('genera regresiones comparables, no hallazgos iniciales, repetidos ni datos incompletos', () => {
    const a = analysis('a', true), b = analysis('b', false);
    expect(alertCandidates('r', a, b, 30)).toHaveLength(1);
    expect(alertCandidates('r', null, b, 30)).toHaveLength(0);
    expect(alertCandidates('r', b, analysis('c', false), 30)).toHaveLength(0);
    expect(alertCandidates('r', a, { ...b, estado: 'FALLIDO' }, 30)).toHaveLength(0);
    expect(alertCandidates('r', { ...a, resultados: [] }, b, 30)).toHaveLength(0);
    expect(alertCandidates('r', a, b, 30)[0].claveDeduplicacion).toBe(alertCandidates('r', a, b, 30)[0].claveDeduplicacion);
  });
  function certificate(days: number) {
    const j = analysis('cert', true); j.resultados = [{ codigoComprobacion: 'CERTIFICATE_EXPIRY', estado: days > 0 ? 'APROBADO' : 'HALLAZGO', observadoEn: now, evidencia: { rulesVersion: 'manual-v1', validFrom: '2020-01-01', validTo: new Date(now.getTime() + days * 86400000).toISOString() } }]; return j;
  }
  it.each([[31, 0], [30, 1], [1, 1], [0, 1], [-1, 1]])('aviso a %s días: %s alerta', (days, count) => expect(alertCandidates('r', null, certificate(days), 30)).toHaveLength(count));
  it('deduplica certificado por revisión, vencimiento y ventana; no por cada análisis', () => {
    const j = certificate(20), first = alertCandidates('r', null, j, 30)[0];
    expect(alertCandidates('r', null, { ...j, id: 'other' }, 30)[0].claveDeduplicacion).toBe(first.claveDeduplicacion);
    expect(alertCandidates('r2', null, j, 30)[0].claveDeduplicacion).not.toBe(first.claveDeduplicacion);
    expect(alertCandidates('r', null, j, 0)).toHaveLength(0);
    expect(alertCandidates('r', null, { ...j, resultados: [{ ...j.resultados[0], estado: 'NO_EVALUADO' }] }, 30)).toHaveLength(0);
  });
});

describe('Programación atómica (Prisma simulado)', () => {
  function setup() {
    const schedule = { activa: true, configuradoPorId: 'owner', revisionDominioId: 'r', intervaloMinutos: 1440, proximaEjecucionEn: now };
    const update = jest.fn<() => Promise<unknown>>().mockResolvedValue({});
    const create = jest.fn<() => Promise<unknown>>().mockResolvedValue({ id: 'job', estado: 'PENDIENTE' });
    const site = { revisionActualId: 'r', revisionActual: { verificaciones: [{ id: 'v' }] } };
    const active = jest.fn<() => Promise<unknown>>().mockResolvedValue(null);
    const tx = { $queryRaw: jest.fn<() => Promise<unknown>>().mockResolvedValue([]), sitio: { findFirst: async () => site }, programacionAnalisis: { findUnique: async () => schedule, update }, analisis: { findFirst: active, create } };
    const repository = new AnalysisRepository({ $transaction: async (work: (tx: unknown) => unknown) => work(tx) } as unknown as PrismaService, policy);
    return { schedule, site, update, create, active, repository, tx };
  }
  it('consume la oportunidad y crea un trabajo en una transacción bajo bloqueo', async () => {
    const { repository, tx, create, update } = setup();
    await repository.start('owner', 'site', now);
    expect(tx.$queryRaw).toHaveBeenCalled(); expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ programadoPara: now, procedencia: 'manual-v1' }) }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ proximaEjecucionEn: new Date('2026-01-02'), ultimoEstado: 'ENCOLADO' }) }));
  });
  it.each(['disabled', 'notdue', 'expired', 'revision', 'owner', 'frequency'])('bloquea %s sin hacer tráfico', async mode => {
    const { repository, schedule, site, create } = setup();
    if (mode === 'disabled') schedule.activa = false;
    if (mode === 'notdue') schedule.proximaEjecucionEn = new Date(now.getTime() + 1);
    if (mode === 'expired') site.revisionActual.verificaciones = [];
    if (mode === 'revision') schedule.revisionDominioId = 'old';
    if (mode === 'owner') schedule.configuradoPorId = 'other';
    if (mode === 'frequency') schedule.intervaloMinutos = 1;
    expect(await repository.start('owner', 'site', now)).toBeNull(); expect(create).not.toHaveBeenCalled();
  });
  it('omite la oportunidad si ya hay análisis manual o programado activo', async () => {
    const { repository, active, create, update } = setup(); active.mockResolvedValue({ id: 'active' });
    expect(await repository.start('owner', 'site', now)).toBeNull(); expect(create).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ ultimoEstado: 'OMITIDA_POR_ANALISIS_ACTIVO' }) }));
  });
});

describe('Coordinación y errores seguros', () => {
  it('vuelve a comprobar la programación antes de reclamar un trabajo y usa el identificador del sitio', async () => {
    const findSchedule = jest.fn<() => Promise<unknown>>().mockResolvedValue({ activa: false });
    const updateMany = jest.fn<() => Promise<{ count: number }>>().mockResolvedValue({ count: 1 });
    const tx = { $queryRaw: async () => [], programacionAnalisis: { findUnique: findSchedule }, analisis: { findUnique: async () => ({ programadoPara: now, verificacion: { revisionDominioId: 'r', revisionDominio: { sitio: { propietarioId: 'owner' } } } }), updateMany } };
    const repository = new AnalysisRepository({ analisis: { findUnique: async () => ({ verificacion: { revisionDominio: { sitioId: 'site' } } }) }, $transaction: async (work: (tx: unknown) => unknown) => work(tx) } as unknown as PrismaService, policy);
    expect(await repository.claim('job')).toBeNull();
    expect(findSchedule).toHaveBeenCalledWith({ where: { sitioId: 'site' } });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ estado: 'FALLIDO', reclamoExpiraEn: null }) }));
  });
  it('configurar exige propietario y propiedad vigente; desactivar no exige verificación vigente', async () => {
    const findFirst = jest.fn<() => Promise<unknown>>().mockResolvedValue(null);
    const updateMany = jest.fn<() => Promise<{ count: number }>>().mockResolvedValue({ count: 1 });
    const upsert = jest.fn<() => Promise<unknown>>().mockResolvedValue({ activa: true });
    const tx = { $queryRaw: async () => [], sitio: { findFirst }, programacionAnalisis: { updateMany, upsert, findUnique: async () => null } };
    const repository = new MonitoringRepository({ $transaction: async (work: (tx: unknown) => unknown) => work(tx) } as unknown as PrismaService, policy);
    await expect(repository.configure('other', 'site', true, 1440, now)).rejects.toThrow('Sitio no encontrado');
    findFirst.mockResolvedValue({ revisionActual: { id: 'r', verificaciones: [] } });
    await expect(repository.configure('owner', 'site', true, 1440, now)).rejects.toThrow('Verifica la revisión');
    await repository.configure('owner', 'site', false, 0, now); expect(updateMany).toHaveBeenCalled();
    findFirst.mockResolvedValue({ revisionActual: { id: 'r', verificaciones: [{ id: 'v' }] } });
    await repository.configure('owner', 'site', true, 10080, now);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ sitioId: 'site', configuradoPorId: 'owner', revisionDominioId: 'r', intervaloMinutos: 10080, activa: true }) }));
    expect(() => repository.configure('owner', 'site', true, 1, now)).toThrow('Frecuencia no aprobada');
  });
  it('evita solapar ticks y deja las oportunidades persistidas cuando se alcanza el límite', async () => {
    let release!: () => void;
    const start = jest.fn<() => Promise<never>>().mockImplementation(() => new Promise((_resolve, reject) => { release = () => reject(new ServiceUnavailableException()); }));
    const due = jest.fn<() => Promise<{ sitioId: string; configuradoPorId: string }[]>>().mockResolvedValue([{ sitioId: 's', configuradoPorId: 'owner' }, { sitioId: 's2', configuradoPorId: 'owner' }]);
    const service = new MonitoringService({ due } as unknown as MonitoringRepository, { start } as unknown as AnalysisService);
    const first = service.tick(now); const second = service.tick(now); expect(second).toBe(first);
    await Promise.resolve(); release(); await first; expect(start).toHaveBeenCalledTimes(1);
    await service.onModuleDestroy(); await service.tick(now); expect(due).toHaveBeenCalledTimes(1);
  });
  it('recupera al iniciar y reintenta tras fallos sin exponer datos', async () => {
    const due = jest.fn<() => Promise<never[]>>().mockRejectedValueOnce(new Error('private')).mockResolvedValue([]);
    const service = new MonitoringService({ due, get: async () => { throw new Error('private'); } } as unknown as MonitoringRepository, {} as AnalysisService);
    await service.onModuleInit(); await service.tick(now); expect(due).toHaveBeenCalledTimes(2);
    await expect(service.get('owner', 'site')).rejects.toThrow('No se pudo completar la operación de monitoreo.');
    await service.onModuleDestroy();
  });
  it('filtra alertas por propietario/sitio y marca lectura una sola vez', async () => {
    const findMany = jest.fn<() => Promise<never[]>>().mockResolvedValue([]), updateMany = jest.fn<() => Promise<unknown>>().mockResolvedValue({ count: 1 });
    const prisma = { sitio: { findFirst: async () => ({ id: 's' }) }, alerta: { findMany, updateMany, findFirst: async () => ({ id: 'a' }) } };
    const repository = new MonitoringRepository(prisma as unknown as PrismaService, policy);
    await repository.alerts('owner', 'site'); await repository.read('owner', 'site', 'alert', now);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { analisis: { verificacion: { revisionDominio: { sitioId: 'site', sitio: { propietarioId: 'owner' } } } } } }));
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: 'alert', leidaEn: null }), data: { leidaEn: now } }));
  });
});
