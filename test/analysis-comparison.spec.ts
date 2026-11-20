import 'reflect-metadata';
import { jest } from '@jest/globals';
import { compareAnalyses, HistoricalAnalysis, HistoricalResult } from '../src/analysis/domain/comparison';
import { guidanceFor } from '../src/analysis/domain/recommendations';
import { codes, pageChecks, certificateChecks } from '../src/analysis/domain/checks';
import { AnalysisRepository } from '../src/analysis/infrastructure/analysis.repository';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { AnalysisService } from '../src/analysis/application/analysis.service';
import { ManualEngine } from '../src/analysis/application/manual-engine';

function result(status = 'HALLAZGO'): HistoricalResult { return { codigoComprobacion: 'HSTS', estado: status, evidencia: { positiveMaxAge: status === 'APROBADO', rulesVersion: 'manual-v1' }, observadoEn: new Date() }; }
function job(results = [result()]): HistoricalAnalysis { return { id: 'a', estado: 'COMPLETADO', procedencia: 'manual-v1', creadoEn: new Date(0), resultados: results }; }
function hsts(a: HistoricalAnalysis, b: HistoricalAnalysis) { return compareAnalyses(a, b).find(r => r.code === 'HSTS')!; }

describe('Comparación sin puntuaciones (reglas puras)', () => {
  it.each([['HALLAZGO', 'APROBADO', 'MEJORO'], ['APROBADO', 'HALLAZGO', 'EMPEORO'], ['APROBADO', 'APROBADO', 'IGUAL'], ['HALLAZGO', 'HALLAZGO', 'IGUAL']])('%s → %s = %s', (a, b, change) => expect(hsts(job([result(a)]), job([result(b)])).change).toBe(change));
  it.each(['NO_EVALUADO', 'NO_APLICABLE', 'UNKNOWN'])('no ordena %s como una mejora', state => {
    expect(hsts(job([result(state)]), job([result('APROBADO')])).change).toBe('NO_COMPARABLE');
    expect(hsts(job(), job([result(state)])).change).toBe('NO_COMPARABLE');
    expect(hsts(job([result(state)]), job([result(state)])).change).toBe('NO_COMPARABLE');
  });
  it.each(['FALLIDO', 'PENDIENTE', 'EN_EJECUCION'])('no atribuye mejoras al análisis %s', estado => {
    expect(hsts({ ...job(), estado }, job([result('APROBADO')])).change).toBe('NO_COMPARABLE');
    expect(hsts(job(), { ...job([result('APROBADO')]), estado }).change).toBe('NO_COMPARABLE');
  });
  it.each([null, {}, { rulesVersion: 'manual-v2', positiveMaxAge: true }, { rulesVersion: 'manual-v1' }, [], 'text'])('rechaza evidencia insuficiente %j', evidencia => {
    expect(hsts(job(), job([{ ...result('APROBADO'), evidencia }])).change).toBe('NO_COMPARABLE');
  });
  it('rechaza ausencias, observación sin fecha, duplicados y reglas de otro origen', () => {
    expect(hsts(job(), job([])).change).toBe('NO_COMPARABLE');
    expect(hsts(job(), job([{ ...result(), observadoEn: null }])).change).toBe('NO_COMPARABLE');
    expect(hsts(job(), job([result(), result()])).change).toBe('NO_COMPARABLE');
    expect(hsts(job(), { ...job(), procedencia: 'external-v1' }).change).toBe('NO_COMPARABLE');
  });
  it('no llama mejora al CSP presente ni a la desaparición de cookies', () => {
    const a = pageChecks({ status: 200, headers: {}, cookies: ['fixture=x'] });
    const b = pageChecks({ status: 200, headers: { 'content-security-policy': "default-src 'self'" }, cookies: [] });
    const convert = (rows: typeof a) => job(rows.map(r => ({ codigoComprobacion: r.code, estado: r.status, evidencia: { ...r.evidence, rulesVersion: 'manual-v1' }, observadoEn: new Date() })));
    const rows = compareAnalyses(convert(a), convert(b));
    for (const code of ['CSP', 'COOKIE_SECURE', 'COOKIE_HTTPONLY', 'COOKIE_SAMESITE']) expect(rows.find(r => r.code === code)?.change).toBe('NO_COMPARABLE');
  });
  it('admite evidencia real del motor para las reglas evaluadas de cabeceras y certificado', () => {
    const checks = [...pageChecks({ status: 200, headers: {}, cookies: ['fixture=x; Secure; HttpOnly; SameSite=Lax'] }), ...certificateChecks({ trusted: true, identity: true, validFrom: '2020-01-01', validTo: '2099-01-01' })];
    const j = job(checks.map(r => ({ codigoComprobacion: r.code, estado: r.status, evidencia: { ...r.evidence, rulesVersion: 'manual-v1' }, observadoEn: new Date() })));
    expect(compareAnalyses(j, j).filter(r => checks.some(c => c.code === r.code)).every(r => r.change === 'IGUAL')).toBe(true);
  });
});

describe('Catálogo RF-011', () => {
  it.each(codes)('cubre %s con los cinco elementos sin puntuaciones', code => {
    const guidance = guidanceFor(code)!;
    expect(guidance.version).toBe('catalog-v1');
    for (const key of ['explanation', 'consequence', 'applicability', 'correctiveAction', 'verification'] as const) expect(guidance[key].length).toBeGreaterThan(25);
  });
  it('no inventa recomendaciones para códigos desconocidos', () => { expect(guidanceFor('unknown')).toBeNull(); expect(guidanceFor('__proto__')).toBeNull(); });
});

describe('Repositorio autorizado y errores seguros (Prisma simulado)', () => {
  function setup() {
    const a = { ...job(), verificacion: { revisionDominioId: 'r' } }, b = { ...job([result('APROBADO')]), id: 'b', creadoEn: new Date(100), verificacion: { revisionDominioId: 'r' } };
    const findMany = jest.fn<() => Promise<unknown[]>>().mockResolvedValue([a, b]);
    const repository = new AnalysisRepository({ analisis: { findMany } } as unknown as PrismaService);
    return { a, b, findMany, repository };
  }
  it('filtra propietario y sitio de ambos análisis y compara una misma revisión', async () => {
    const { repository, findMany } = setup();
    expect((await repository.compare('owner', 'site', 'a', 'b')).results.find(r => r.code === 'HSTS')?.change).toBe('MEJORO');
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['a', 'b'] }, procedencia: 'manual-v1', verificacion: { revisionDominio: { sitioId: 'site', sitio: { propietarioId: 'owner' } } } } }));
  });
  it('no revela análisis ajenos ni inexistentes', async () => { const { repository, findMany } = setup(); findMany.mockResolvedValue([]); await expect(repository.compare('other', 'site', 'a', 'b')).rejects.toThrow('Análisis no encontrados'); });
  it('rechaza mismo ID, orden inverso y distinta revisión aunque el dominio sea igual', async () => {
    const { repository, findMany, a, b } = setup();
    await expect(repository.compare('owner', 'site', 'a', 'a')).rejects.toThrow('distintos');
    await expect(repository.compare('owner', 'site', 'b', 'a')).rejects.toThrow('anterior');
    findMany.mockResolvedValue([a, { ...b, verificacion: { revisionDominioId: 'r2' } }]);
    await expect(repository.compare('owner', 'site', 'a', 'b')).rejects.toThrow('misma revisión');
  });
  it('oculta errores de persistencia en la capa de aplicación', async () => {
    const { repository, findMany } = setup(); findMany.mockRejectedValue(new Error('private database details'));
    const service = new AnalysisService(repository, {} as ManualEngine);
    await expect(service.compare('owner', 'site', 'a', 'b')).rejects.toThrow('No se pudo completar la operación de análisis.');
  });
});
