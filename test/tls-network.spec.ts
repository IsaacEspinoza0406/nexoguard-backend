import { afterAll, afterEach, beforeAll, describe, expect, jest, test } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AddressInfo } from 'node:net';
import { createServer, Server } from 'node:https';
import { connect, getCACertificates, setDefaultCACertificates } from 'node:tls';
import { HttpService } from '@nestjs/axios';
import { AnalysisNetwork } from '../src/analysis/infrastructure/analysis-network';
import { OwnershipFileReader } from '../src/sites/infrastructure/ownership-file.reader';
import { databaseConfig } from '../src/infrastructure/prisma/database-config';
import { transportCall } from '../src/transport/client';

// Actual TLS handshakes against ephemeral loopback servers, not public analyses.
// Only fixture DNS/ports are remapped; certificate verification options are retained.
describe('TLS real con certificados efímeros y sin MySQL ni proveedores externos', () => {
  const folder = mkdtempSync(join(tmpdir(), 'nexoguard-tls-'));
  const originalCas = getCACertificates('default');
  const servers: Server[] = [];
  const originalEnv = { ...process.env };
  let ca: string;
  const file = (name: string) => join(folder, name);
  function openssl(...args: string[]) {
    execFileSync(process.env.NEXOGUARD_TEST_OPENSSL || 'openssl', args, { stdio: 'ignore', windowsHide: true, env: { ...process.env, OPENSSL_CONF: file('openssl.cnf') } });
  }
  function certificate(name: string, issuer: string, san: string) {
    openssl('req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', file(`${name}.key`), '-out', file(`${name}.csr`), '-subj', '/CN=TLS fixture');
    writeFileSync(file(`${name}.ext`), `subjectAltName=${san}\nextendedKeyUsage=serverAuth\n`);
    openssl('x509', '-req', '-in', file(`${name}.csr`), '-CA', file(`${issuer}.pem`), '-CAkey', file(`${issuer}.key`), '-set_serial', name === 'valid' ? '11' : name === 'wrong-name' ? '12' : '13', '-days', '1', '-extfile', file(`${name}.ext`), '-out', file(`${name}.pem`));
  }
  beforeAll(() => {
    // Do not inherit another Windows application's OpenSSL configuration.
    writeFileSync(file('openssl.cnf'), '[req]\ndistinguished_name=dn\n[dn]\n');
    for (const name of ['ca', 'untrusted-ca']) openssl('req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', file(`${name}.key`), '-out', file(`${name}.pem`), '-days', '1', '-subj', `/CN=${name}`, '-addext', 'basicConstraints=critical,CA:TRUE');
    certificate('valid', 'ca', 'DNS:fixture.example.com,DNS:db,IP:127.0.0.1');
    certificate('wrong-name', 'ca', 'DNS:other.example.invalid');
    certificate('untrusted', 'untrusted-ca', 'DNS:fixture.example.com,DNS:db,IP:127.0.0.1');
    ca = readFileSync(file('ca.pem'), 'utf8');
    setDefaultCACertificates([...originalCas, ca]);
  }, 30000);
  afterEach(async () => {
    jest.restoreAllMocks(); process.env = { ...originalEnv };
    for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
  afterAll(() => {
    setDefaultCACertificates(originalCas);
    // Only files in this freshly created exclusive directory; no recursive deletion.
    for (const name of readdirSync(folder)) unlinkSync(file(name));
    rmdirSync(folder);
  });
  async function start(name: string) {
    let requests = 0, applicationBytes = 0;
    const server = createServer({ key: readFileSync(file(`${name}.key`)), cert: readFileSync(file(`${name}.pem`)) }, (req, res) => {
      requests++;
      expect(req.headers.cookie).toBeUndefined();
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"public":true}');
    });
    server.on('secureConnection', socket => socket.on('data', chunk => { applicationBytes += chunk.length; }));
    server.on('tlsClientError', () => {});
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    return { port: (server.address() as AddressInfo).port, requests: () => requests, applicationBytes: () => applicationBytes };
  }
  function network(port: number) {
    const realHttp = new HttpService();
    const fixtureHttp = { get: (url: string, options: Parameters<HttpService['get']>[1]) => { const target = new URL(url); target.port = String(port); return realHttp.get(target.href, options); } };
    const result = new AnalysisNetwork({} as OwnershipFileReader, fixtureHttp as HttpService);
    jest.spyOn(result, 'destination').mockResolvedValue({ address: '127.0.0.1', family: 4 });
    jest.spyOn(result, 'openTls').mockImplementation(options => connect({ ...options, port, ca }));
    return result;
  }
  test('HTTPS acepta CA confiable y nombre correcto', async () => {
    const server = await start('valid');
    expect((await network(server.port).page(new URL('https://fixture.example.com/'))).status).toBe(200);
    expect(server.requests()).toBe(1);
  });
  test.each(['untrusted', 'wrong-name'])('HTTPS rechaza %s antes de enviar HTTP', async name => {
    const server = await start(name);
    await expect(network(server.port).page(new URL('https://fixture.example.com/'))).rejects.toThrow();
    expect(server.requests()).toBe(0); expect(server.applicationBytes()).toBe(0);
  });
  test.each([['valid', true, true], ['untrusted', false, true], ['wrong-name', false, false]] as const)('diagnóstico %s conserva confianza e identidad sin enviar datos de aplicación', async (name, trusted, identity) => {
    const server = await start(name);
    expect(await network(server.port).certificate('fixture.example.com')).toMatchObject({ trusted, identity });
    expect(server.requests()).toBe(0); expect(server.applicationBytes()).toBe(0);
  });
  test('RPC TLS acepta CA y nombre válidos y rechaza CA no confiable y nombre incorrecto', async () => {
    const valid = await start('valid');
    process.env.NEXOGUARD_TRANSPORT_URL = `https://127.0.0.1:${valid.port}`;
    process.env.NEXOGUARD_TRANSPORT_SECRET = 't'.repeat(43);
    process.env.NEXOGUARD_TRANSPORT_CA_FILE = file('ca.pem');
    expect(await transportCall({ operation: 'validate', domain: 'fixture.example.com' })).toEqual({ public: true });
    process.env.NEXOGUARD_TRANSPORT_CA_FILE = file('untrusted-ca.pem');
    await expect(transportCall({ operation: 'validate', domain: 'fixture.example.com' })).rejects.toThrow('TRANSPORT_UNAVAILABLE');
    expect(valid.requests()).toBe(1);
    const wrong = await start('wrong-name');
    process.env.NEXOGUARD_TRANSPORT_CA_FILE = file('ca.pem');
    process.env.NEXOGUARD_TRANSPORT_URL = `https://127.0.0.1:${wrong.port}`;
    await expect(transportCall({ operation: 'validate', domain: 'fixture.example.com' })).rejects.toThrow('TRANSPORT_UNAVAILABLE');
    expect(wrong.requests()).toBe(0);
  });
  test('opciones TLS de MySQL conservan CA, nombre y rechazo de certificados inválidos', async () => {
    const config = databaseConfig({ DATABASE_URL: 'mysql://nexoguard_runtime:fixture-only@db:3306/nexoguard', NEXOGUARD_DB_MODE: 'production_tls', NEXOGUARD_HTTP_MODE: 'production', NEXOGUARD_DB_EXPECTED_HOST: 'db', NEXOGUARD_DB_EXPECTED_NAME: 'nexoguard', NEXOGUARD_DB_CA_FILE: file('ca.pem') });
    if (!('ssl' in config)) throw new Error('Expected production TLS configuration');
    expect(config.ssl).toMatchObject({ rejectUnauthorized: true, servername: 'db', minVersion: 'TLSv1.2' });
    for (const [name, accepted] of [['valid', true], ['untrusted', false], ['wrong-name', false]] as const) {
      const server = await start(name);
      const connection = new Promise<boolean>(resolve => {
        const socket = connect({ ...config.ssl, host: '127.0.0.1', port: server.port });
        socket.once('secureConnect', () => { socket.destroy(); resolve(true); });
        socket.once('error', () => { socket.destroy(); resolve(false); });
      });
      expect(await connection).toBe(accepted); expect(server.requests()).toBe(0);
    }
  });
});
