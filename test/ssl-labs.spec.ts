import 'reflect-metadata';
import { jest } from '@jest/globals';
import { of } from 'rxjs';
import { HttpService } from '@nestjs/axios';
import { initialSslReport, providerReport, retryDelay, publicSslReport } from '../src/analysis/domain/ssl-labs';
import { SslLabsService } from '../src/analysis/application/ssl-labs.service';
import { SslLabsRepository } from '../src/analysis/infrastructure/ssl-labs.repository';
import { SslLabsClient } from '../src/analysis/infrastructure/ssl-labs.client';
import { AnalysisNetwork } from '../src/analysis/infrastructure/analysis-network';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { MonitoringPolicy } from '../src/analysis/application/monitoring-policy';

const now = new Date('2026-11-20T12:00:00.000Z');
const initial = () => initialSslReport('owner', now);
function data(status = 'READY') { return { host: 'example.com', port: 443, status, testTime: now.getTime() - 60000, startTime: now.getTime() - 120000, engineVersion: '2.4.0', criteriaVersion: '2025a', endpoints: [{ ipAddress: '8.8.8.8', statusMessage: 'Ready', grade: 'A', hasWarnings: false }, { statusMessage: 'Arbitrary private provider error', grade: 'F' }], private: 'do not keep', certs: ['do not keep'] }; }
it('DP-08 activa opciones aprobadas sin activar automáticamente sitios', () => { const p = new MonitoringPolicy(); expect(p.allowedMinutes).toEqual([1440, 10080]); expect(p.warningDays).toBe(30); });
it('normaliza solo estados, fechas, versiones y notas atribuidas al proveedor', () => {
  const report = providerReport(data(), 'example.com', initial(), now);
  expect(report.phase).toBe('READY'); expect(report.endpoints[0].grade).toBe('A'); expect(report.endpoints[1].status).toBe('ERROR'); expect(report.endpoints[1].grade).toBeNull();
  expect(report.testTime).toBe(new Date(now.getTime() - 60000).toISOString());
  expect(JSON.stringify(report)).not.toMatch(/do not keep|8\.8\.8\.8|Arbitrary private/);
  expect(publicSslReport(report)).not.toHaveProperty('requestedBy');
});
it.each(['DNS', 'IN_PROGRESS', 'ERROR'])('distingue estado externo %s', state => expect(providerReport(data(state), 'example.com', initial(), now).phase).toBe(state));
it.each([{ ...data(), host: 'other.example' }, { ...data(), port: 80 }, { ...data(), status: 'UNKNOWN' }, { ...data(), testTime: null }, { ...data(), endpoints: [] }, { ...data(), endpoints: 'bad' }])('rechaza datos incompletos o de otro destino', value => expect(() => providerReport(value, 'example.com', initial(), now)).toThrow());
it('respeta Retry-After y espera larga ante 503/529', () => {
  expect(retryDelay(429, '120', now)).toBe(120000); expect(retryDelay(503, undefined, now)).toBe(900000); expect(retryDelay(529, undefined, now)).toBe(1800000);
  expect(retryDelay(429, new Date(now.getTime() + 180000).toUTCString(), now)).toBe(180000);
});
describe('Cliente Axios con transporte simulado', () => {
  const saved = { enabled: process.env.SSLLABS_ENABLED, email: process.env.SSLLABS_EMAIL };
  afterEach(() => { if (saved.enabled === undefined) delete process.env.SSLLABS_ENABLED; else process.env.SSLLABS_ENABLED = saved.enabled; if (saved.email === undefined) delete process.env.SSLLABS_EMAIL; else process.env.SSLLABS_EMAIL = saved.email; });
  it('no contacta al proveedor sin configuración', async () => {
    delete process.env.SSLLABS_EMAIL; const get = jest.fn(); const client = new SslLabsClient({ get } as unknown as HttpService, {} as AnalysisNetwork);
    expect(client.configured()).toBe(false); await expect(client.get('info')).rejects.toThrow('CONFIGURATION_REQUIRED'); expect(get).not.toHaveBeenCalled();
  });
  it('usa solo API v4 fija, DNS fijado, TLS validado, sin proxy/redirecciones ni credenciales del usuario', async () => {
    process.env.SSLLABS_ENABLED = 'true'; process.env.SSLLABS_EMAIL = 'fixture@example.invalid';
    const destination = jest.fn<AnalysisNetwork['destination']>().mockResolvedValue({ address: '8.8.8.8', family: 4 });
    const get = jest.fn().mockReturnValue(of({ status: 200, data: JSON.stringify(data()), headers: {} }));
    const client = new SslLabsClient({ get } as unknown as HttpService, { destination } as unknown as AnalysisNetwork);
    await client.get('analyze', 'example.com');
    const url = new URL(get.mock.calls[0][0] as string);
    expect(url.origin).toBe('https://api.ssllabs.com'); expect(url.pathname).toBe('/api/v4/analyze'); expect(url.searchParams.get('publish')).toBe('off'); expect(url.searchParams.has('startNew')).toBe(false);
    expect(get).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ proxy: false, maxRedirects: 0, maxContentLength: 1048576, timeout: 10000, headers: expect.objectContaining({ Cookie: undefined, Authorization: undefined }) }));
    expect(destination).toHaveBeenCalledWith('api.ssllabs.com');
  });
});
describe('Coordinación sin dependencias externas reales', () => {
  function setup(status = 200) {
    const finish = jest.fn<() => Promise<void>>().mockResolvedValue(undefined);
    const claim = jest.fn<() => Promise<unknown>>().mockResolvedValue({ id: 'job', domain: 'example.com', report: initial(), jobVersion: 1, gateVersion: 1 });
    const get = jest.fn<SslLabsClient['get']>().mockImplementation(async resource => ({ status, data: resource === 'info' ? { maxAssessments: 1, currentAssessments: 0, newAssessmentCoolOff: 30000 } : data(), retryAfter: undefined, maximum: 1, current: 0 }));
    const service = new SslLabsService({ claim, finish, authorized: async () => true } as unknown as SslLabsRepository, { configured: () => true, get } as unknown as SslLabsClient, { destination: async () => ({ address: '8.8.8.8', family: 4 }) } as unknown as AnalysisNetwork);
    return { service, get, finish, claim };
  }
  it('persiste un informe listo sin convertir sus notas en comprobaciones aprobadas', async () => {
    const { service, finish } = setup(); await service.tick(now); expect(finish).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ phase: 'READY', provider: 'Qualys SSL Labs API v4' }), expect.any(Number), expect.any(Date));
  });
  it.each([429, 503, 529])('aplaza HTTP %s sin bloquear resultados propios', async status => { const { service, finish } = setup(status); await service.tick(now); expect(finish).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ phase: 'WAITING' }), expect.any(Number), expect.any(Date)); });
  it.each([400, 441, 500])('finaliza HTTP %s con error seguro', async status => { const { service, finish } = setup(status); await service.tick(now); expect(finish).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ phase: 'ERROR' }), expect.any(Number), expect.any(Date)); });
  it('respeta capacidad, recupera otra instancia y evita solapar ticks', async () => {
    const { service, get, claim, finish } = setup();
    get.mockResolvedValue({ status: 200, data: { maxAssessments: 1, currentAssessments: 1, newAssessmentCoolOff: 60000 }, retryAfter: undefined, maximum: 1, current: 1 });
    const first = service.tick(now); expect(service.tick(now)).toBe(first); await first;
    expect(get).toHaveBeenCalledTimes(1); expect(finish).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ phase: 'WAITING' }), expect.any(Number), expect.any(Date));
    await service.onModuleDestroy(); await service.tick(now); expect(claim).toHaveBeenCalledTimes(1);
  });
  it('puede sondear una evaluación ya aceptada aunque la capacidad para iniciar otra esté ocupada', async () => {
    const { service, get, claim } = setup();
    claim.mockResolvedValue({ id: 'job', domain: 'example.com', report: { ...initial(), submitted: true, phase: 'WAITING' }, jobVersion: 2, gateVersion: 2 });
    get.mockImplementation(async resource => ({ status: 200, data: resource === 'info' ? { maxAssessments: 1, currentAssessments: 1, newAssessmentCoolOff: 30000 } : data(), retryAfter: undefined, maximum: 1, current: 1 }));
    await service.tick(now); expect(get).toHaveBeenCalledWith('analyze', 'example.com');
  });
  it('propaga propietario y errores de configuración sin mensajes internos', async () => {
    const repository = { start: jest.fn<() => Promise<{ id: string; estado: string }>>().mockResolvedValue({ id: 'j', estado: 'PENDIENTE' }), history: async () => { throw new Error('private'); } };
    const configured = jest.fn().mockReturnValue(false);
    const service = new SslLabsService(repository as unknown as SslLabsRepository, { configured } as unknown as SslLabsClient, {} as AnalysisNetwork);
    await expect(service.start('u', 's', true)).rejects.toThrow('correo institucional'); configured.mockReturnValue(true);
    await expect(service.start('u', 's', false)).rejects.toThrow('autorizar'); await service.start('u', 's', true); expect(repository.start).toHaveBeenCalledWith('u', 's', expect.any(Date));
    await expect(service.history('u', 's')).rejects.toThrow('No se pudo completar la operación SSL Labs.');
  });
});
it('el reclamo del proveedor se respeta tras reinicio sin tocar trabajos ni hacer HTTP', async () => {
  const findFirst = jest.fn();
  const tx = { $queryRaw: async () => [], proveedorExterno: { findUnique: async () => ({ siguienteSolicitudEn: new Date(now.getTime() + 1000), reclamoExpiraEn: null }) }, analisis: { findFirst } };
  const repository = new SslLabsRepository({ $transaction: async (work: (tx: unknown) => unknown) => work(tx) } as unknown as PrismaService);
  expect(await repository.claim(now)).toBeNull(); expect(findFirst).not.toHaveBeenCalled();
});
