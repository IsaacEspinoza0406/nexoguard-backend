import 'reflect-metadata';
import { jest } from '@jest/globals';
import { EventEmitter } from 'node:events';
import { PeerCertificate, TLSSocket } from 'node:tls';
import { of } from 'rxjs';
import { HttpService } from '@nestjs/axios';
import { certificateChecks, pageChecks } from '../src/analysis/domain/checks';
import { AnalysisNetwork, certificateObservation, redirectTarget } from '../src/analysis/infrastructure/analysis-network';
import { OwnershipFileReader } from '../src/sites/infrastructure/ownership-file.reader';
import { ManualEngine } from '../src/analysis/application/manual-engine';
import { AnalysisRepository } from '../src/analysis/infrastructure/analysis.repository';
import { AnalysisService } from '../src/analysis/application/analysis.service';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';

describe('Reglas manual-v1', () => {
  it('distingue certificado vencido e identidad incorrecta', () => {
    const results = certificateChecks({ trusted: false, identity: false, validFrom: '2020-01-01', validTo: '2021-01-01' });
    expect(results.map(r => r.status)).toEqual(['HALLAZGO', 'HALLAZGO']);
  });
  it('certificado válido y fechas ausentes no se confunden', () => {
    expect(certificateChecks({ trusted: true, identity: true, validFrom: '2020-01-01', validTo: '2099-01-01' })[1].status).toBe('APROBADO');
    expect(certificateChecks({ trusted: true, identity: true, validFrom: null, validTo: null })[1].status).toBe('NO_EVALUADO');
  });
  it('ausencia de cookies es no aplicable y cabeceras ausentes son hallazgos', () => {
    const results = pageChecks({ status: 200, headers: {}, cookies: [] });
    expect(results.filter(r => r.code.startsWith('COOKIE_')).every(r => r.status === 'NO_APLICABLE')).toBe(true);
    expect(results.find(r => r.code === 'HSTS')?.status).toBe('HALLAZGO');
  });
  it('retiene solo atributos agregados, sin nombres ni valores de cookies', () => {
    const results = pageChecks({ status: 200, headers: {}, cookies: ['private-name=private-value; Secure; HttpOnly; SameSite=Lax', 'other=other-value; SameSite=None'] });
    expect(JSON.stringify(results)).not.toMatch(/private-name|private-value|other-value/);
    expect(results.find(r => r.code === 'COOKIE_SECURE')?.status).toBe('HALLAZGO');
    expect(results.find(r => r.code === 'COOKIE_HTTPONLY')?.status).toBe('NO_EVALUADO');
    expect(results.find(r => r.code === 'COOKIE_SAMESITE')?.status).toBe('HALLAZGO');
  });
  it('comprueba valores, mantiene CSP como revisión contextual', () => {
    const results = pageChecks({ status: 200, headers: { 'strict-transport-security': 'max-age=31536000; includeSubDomains', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'strict-origin', 'content-security-policy': "default-src 'self'" }, cookies: ['x=fixture; Secure; HttpOnly; SameSite=Strict'] });
    expect(results.filter(r => r.code !== 'CSP').every(r => r.status === 'APROBADO')).toBe(true);
    expect(results.find(r => r.code === 'CSP')?.status).toBe('NO_EVALUADO');
  });
  it('respeta prioridad de CSP frente a XFO y orden de directivas HSTS', () => {
    const results = pageChecks({ status: 200, cookies: [], headers: { 'strict-transport-security': 'includeSubDomains; max-age=300', 'x-frame-options': 'DENY', 'content-security-policy': 'frame-ancestors *' } });
    expect(results.find(r => r.code === 'FRAMING')?.status).toBe('HALLAZGO');
    expect(results.find(r => r.code === 'HSTS')?.status).toBe('APROBADO');
  });
});

describe('Transporte con DNS y respuestas controladas', () => {
  const base = new URL('https://example.com/');
  it.each(['http://example.com/', 'https://other.com/', 'https://127.0.0.1/', 'https://example.com:444/', 'https://u:p@example.com/', '/?secret=fixture', '/#fragment', '//private.local/'])('bloquea redirección %s', input => expect(() => redirectTarget(input, base, 'example.com')).toThrow());
  it('acepta ruta relativa dentro del mismo dominio', () => expect(redirectTarget('/inicio', base, 'example.com').href).toBe('https://example.com/inicio'));
  it('rechaza DNS privado o mixto antes de conectar', async () => {
    const dns = { resolve: async () => [{ address: '8.8.8.8', family: 4 }, { address: '169.254.169.254', family: 4 }] };
    const network = new AnalysisNetwork(dns as unknown as OwnershipFileReader, {} as HttpService);
    await expect(network.destination('example.com')).rejects.toThrow('DESTINATION_BLOCKED');
  });
  it('no envía datos en el socket diagnóstico y comprueba identidad aunque falle confianza', async () => {
    const cert = { raw: Buffer.from('fixture'), subjectaltname: 'DNS:other.com', valid_from: 'Jan 1 00:00:00 2020 GMT', valid_to: 'Jan 1 00:00:00 2021 GMT' } as PeerCertificate;
    expect(certificateObservation('example.com', cert, false).identity).toBe(false);
    const network = new AnalysisNetwork({ resolve: async () => [{ address: '8.8.8.8', family: 4 }] } as unknown as OwnershipFileReader, {} as HttpService);
    const socket = Object.assign(new EventEmitter(), { authorized: false, getPeerCertificate: () => cert, destroy: jest.fn(), write: jest.fn() });
    jest.spyOn(network, 'openTls').mockImplementation(() => { queueMicrotask(() => socket.emit('secureConnect')); return socket as unknown as TLSSocket; });
    const result = await network.certificate('example.com');
    expect(result).toEqual(expect.objectContaining({ trusted: false, identity: false }));
    expect(socket.write).not.toHaveBeenCalled(); expect(socket.destroy).toHaveBeenCalled();
    socket.emit('close');
  });
  it('desactiva proxies/redirecciones, fija DNS y no envía credenciales en Axios', async () => {
    const get = jest.fn().mockReturnValue(of({ status: 200, headers: { 'set-cookie': ['s=private; Secure'] } }));
    const network = new AnalysisNetwork({ resolve: async () => [{ address: '8.8.8.8', family: 4 }] } as unknown as OwnershipFileReader, { get } as unknown as HttpService);
    await network.page(base);
    expect(get).toHaveBeenCalledWith(base.href, expect.objectContaining({ adapter: 'http', proxy: false, maxRedirects: 0, decompress: false, maxContentLength: 262144, headers: expect.objectContaining({ Cookie: undefined, Authorization: undefined }) }));
  });
});

describe('Motor con conexiones simuladas', () => {
  function setup() {
    const network = { page: jest.fn<AnalysisNetwork['page']>().mockImplementation(async url => url.protocol === 'http:' ? { status: 301, headers: {}, cookies: [], location: 'https://example.com/' } : { status: 200, headers: {}, cookies: [] }), certificate: jest.fn<AnalysisNetwork['certificate']>().mockResolvedValue({ trusted: true, identity: true, validFrom: '2020-01-01', validTo: '2099-01-01' }) };
    return { network, engine: new ManualEngine(network as unknown as AnalysisNetwork) };
  }
  it('produce doce comprobaciones sin conservar valores secretos', async () => {
    const { engine } = setup(); const run = await engine.run('example.com');
    expect(run.failed).toBe(false); expect(run.results).toHaveLength(12);
    expect(run.results.find(r => r.code === 'HTTP_REDIRECT')?.status).toBe('APROBADO');
  });
  it('registra certificado inválido y no descarga HTTP sobre TLS no autenticado', async () => {
    const { engine, network } = setup(); network.certificate.mockResolvedValue({ trusted: false, identity: true, validFrom: '2020-01-01', validTo: '2021-01-01' });
    const run = await engine.run('example.com');
    expect(run.failed).toBe(false); expect(network.page).toHaveBeenCalledTimes(1);
    expect(run.results.find(r => r.code === 'CERTIFICATE')?.status).toBe('HALLAZGO');
    expect(run.results.find(r => r.code === 'CSP')?.status).toBe('NO_EVALUADO');
  });
  it('diferencia fallo TLS de hallazgo y preserva evidencia parcial HTTP', async () => {
    const { engine, network } = setup(); network.certificate.mockRejectedValue(new Error('private transport details'));
    const run = await engine.run('example.com'); expect(run.failed).toBe(true);
    expect(run.results.find(r => r.code === 'HTTP_REDIRECT')?.status).toBe('APROBADO');
    expect(run.results.find(r => r.code === 'HTTPS')?.status).toBe('NO_EVALUADO');
    expect(JSON.stringify(run)).not.toContain('private transport details');
  });
  it('detiene bucles y redirecciones externas sin seguirlas', async () => {
    const { engine, network } = setup(); network.page.mockResolvedValue({ status: 302, headers: {}, cookies: [], location: 'https://other.com/' });
    const run = await engine.run('example.com'); expect(network.page).toHaveBeenCalledTimes(2);
    expect(run.results.find(r => r.code === 'HTTPS')?.status).toBe('NO_EVALUADO');
  });
});

describe('Persistencia y coordinación (Prisma simulado)', () => {
  it('rechaza propiedad ajena y revisión no verificada', async () => {
    const tx = { $queryRaw: async () => [], sitio: { findFirst: jest.fn<() => Promise<unknown>>().mockResolvedValue(null) } };
    const repository = new AnalysisRepository({ $transaction: async (run: (tx: unknown) => unknown) => run(tx) } as unknown as PrismaService);
    await expect(repository.start('other', 's')).rejects.toThrow('Sitio no encontrado.');
    tx.sitio.findFirst.mockResolvedValue({ revisionActual: { verificaciones: [] } });
    await expect(repository.start('owner', 's')).rejects.toThrow('Verifica la revisión actual');
  });
  it('no ejecuta un trabajo si la verificación fue invalidada o cambió la revisión', async () => {
    const updateMany = jest.fn<() => Promise<{ count: number }>>().mockResolvedValue({ count: 1 });
    const tx = { $queryRaw: async () => [], analisis: { findUnique: async () => ({ verificacion: { invalidadoEn: new Date(), revisionDominio: { sitio: {} } } }), updateMany } };
    const repository = new AnalysisRepository({ analisis: { findUnique: async () => ({ verificacion: { revisionDominio: { sitioId: 's' } } }) }, $transaction: async (run: (tx: unknown) => unknown) => run(tx) } as unknown as PrismaService);
    expect(await repository.claim('id')).toBeNull();
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ estado: 'FALLIDO' }) }));
  });
  it('un reclamo vencido no puede persistir resultados tardíos', async () => {
    const createMany = jest.fn();
    const tx = { $queryRaw: async () => [], analisis: { updateMany: async () => ({ count: 0 }) }, resultadoComprobacion: { createMany } };
    const repository = new AnalysisRepository({ analisis: { findUnique: async () => ({ verificacion: { revisionDominio: { sitioId: 's' } } }) }, $transaction: async (run: (tx: unknown) => unknown) => run(tx) } as unknown as PrismaService);
    await repository.finish('id', 1, [], false); expect(createMany).not.toHaveBeenCalled();
  });
  it('limita concurrencia, oculta errores internos y cierra los recursos', async () => {
    let complete!: () => void;
    const wait = new Promise<void>(resolve => { complete = resolve; });
    let id = 0;
    const repository = { start: async () => ({ id: String(++id), estado: 'PENDIENTE' }), claim: async () => ({ domain: 'example.com', version: 1 }), finish: async () => {}, history: async () => { throw new Error('private DB detail'); } };
    const service = new AnalysisService(repository as unknown as AnalysisRepository, { run: async () => { await wait; return { results: [], failed: false }; } } as unknown as ManualEngine);
    await service.start('u', 's'); await service.start('u', 's2');
    await expect(service.start('u', 's3')).rejects.toThrow('Hay dos análisis');
    await expect(service.history('u', 's')).rejects.toThrow('No se pudo completar');
    complete(); await service.onModuleDestroy();
    await expect(service.start('u', 's')).rejects.toThrow('Hay dos análisis');
  });
});
