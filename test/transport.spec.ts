import { afterEach, describe, expect, test } from '@jest/globals';
import { randomBytes } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { request } from 'node:http';
import { createTransportServer } from '../src/transport/server';
import { transportRequest } from '../src/transport/contract';
import { remoteAnalysis, transportConfiguration } from '../src/transport/client';
import { codes } from '../src/analysis/domain/checks';
import { ownershipProvider } from '../src/transport/providers';

describe('transporte interno con respuestas controladas y sin DNS externo', () => {
  const servers: ReturnType<typeof createTransportServer>[] = [];
  afterEach(async () => { for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } });
  const key = randomBytes(32).toString('base64url');
  async function start(observe: Parameters<typeof createTransportServer>[1]) {
    const server = createTransportServer(key, observe); servers.push(server);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    return async (input: unknown, authorization = `Bearer ${key}`) => new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port: (server.address() as AddressInfo).port, path: '/v1/observe', method: 'POST', agent: false, headers: { authorization, 'content-type': 'application/json' } }, response => {
        let body = ''; response.on('data', chunk => { body += String(chunk); }); response.on('end', () => resolve({ status: response.statusCode!, body }));
      }); req.on('error', reject); req.end(JSON.stringify(input));
    });
  }
  test.each(['http://example.com', '127.0.0.1', 'db.internal', 'EXAMPLE.com', 'example.com/path'])('rechaza destinos ajenos al contrato: %s', domain => { expect(() => transportRequest({ operation: 'analyze', domain })).toThrow(); });
  test('rechaza campos adicionales, operación desconocida y dominio en info', () => {
    expect(() => transportRequest({ operation: 'analyze', domain: 'example.com', headers: {} })).toThrow();
    expect(() => transportRequest({ operation: 'proxy', domain: 'example.com' })).toThrow();
    expect(() => transportRequest({ operation: 'ssl-info', domain: 'example.com' })).toThrow();
  });
  test('autentica antes de llamar al motor y mantiene respuestas sin secretos', async () => {
    let called = 0;
    const send = await start(async input => { called++; return { domain: input.domain, public: true }; });
    expect((await send({ operation: 'validate', domain: 'example.com' }, 'Bearer invalid')).status).toBe(401);
    expect(called).toBe(0);
    expect((await send({ operation: 'validate', domain: 'example.com' })).status).toBe(200);
    expect(called).toBe(1);
  });
  test('oculta errores internos y limita cuerpo', async () => {
    const send = await start(async () => { throw new Error('SENSITIVE_FIXTURE'); });
    const failure = await send({ operation: 'analyze', domain: 'example.com' });
    expect(failure.status).toBe(502); expect(failure.body).not.toContain('SENSITIVE_FIXTURE');
    expect((await send({ operation: 'analyze', domain: 'x'.repeat(1100) })).status).toBe(413);
  });
  test('limita operaciones simultáneas y libera recursos', async () => {
    let entered = 0; let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const send = await start(async () => { entered++; await barrier; return { public: true }; });
    const pending = Array.from({ length: 4 }, () => send({ operation: 'validate', domain: 'example.com' }));
    while (entered < 4) await new Promise(resolve => setTimeout(resolve, 5));
    expect((await send({ operation: 'validate', domain: 'example.com' })).status).toBe(429);
    release(); expect((await Promise.all(pending)).map(result => result.status)).toEqual([200, 200, 200, 200]);
    expect((await send({ operation: 'validate', domain: 'example.com' })).status).toBe(200);
  });
  test('no permite HTTP remoto sin habilitación explícita de malla', () => {
    const env = { NEXOGUARD_TRANSPORT_URL: 'http://transport.railway.internal:3002', NEXOGUARD_TRANSPORT_SECRET: key };
    expect(() => transportConfiguration(env)).toThrow();
    expect(transportConfiguration({ ...env, NEXOGUARD_TRANSPORT_PRIVATE_HTTP: 'true' }).url.port).toBe('3002');
  });
  test('el cliente real intercambia resultados controlados y rechaza respuestas incompletas', async () => {
    let malformed = false;
    await start(async () => malformed ? { results: [] } : { failed: false, results: codes.map(code => ({ code, status: 'NO_EVALUADO', evidence: { reason: 'controlled' }, recommendation: 'Controlled recommendation' })) });
    const saved = { ...process.env };
    try {
      process.env.NEXOGUARD_TRANSPORT_URL = `http://127.0.0.1:${(servers.at(-1)!.address() as AddressInfo).port}`;
      process.env.NEXOGUARD_TRANSPORT_SECRET = key;
      process.env.NEXOGUARD_TRANSPORT_PRIVATE_HTTP = 'true';
      expect((await remoteAnalysis('example.com')).results).toHaveLength(12);
      malformed = true;
      await expect(remoteAnalysis('example.com')).rejects.toThrow('TRANSPORT_INVALID_RESPONSE');
    } finally { process.env = saved; }
  });
  test('producción no vuelve silenciosamente al transporte directo', () => {
    const saved = { ...process.env };
    try {
      process.env.NEXOGUARD_HTTP_MODE = 'production'; process.env.NEXOGUARD_TRANSPORT_MODE = 'direct';
      expect(() => ownershipProvider.useFactory()).toThrow('Producción requiere transporte separado');
    } finally { process.env = saved; }
  });
});
