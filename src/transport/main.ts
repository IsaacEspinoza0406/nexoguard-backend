import 'reflect-metadata';
import { HttpService } from '@nestjs/axios';
import { OwnershipFileReader } from '../sites/infrastructure/ownership-file.reader';
import { AnalysisNetwork } from '../analysis/infrastructure/analysis-network';
import { ManualEngine } from '../analysis/application/manual-engine';
import { SslLabsClient } from '../analysis/infrastructure/ssl-labs.client';
import { createTransportServer } from './server';
import { listenerConfig } from '../security/listener-config';

// This entry point never imports AppModule, Prisma, dotenv, sessions or user repositories.
if (['DATABASE_URL', 'NEXOGUARD_MIGRATION_DATABASE_URL', 'MYSQL_ROOT_PASSWORD', 'MYSQL_PASSWORD', 'NEXOGUARD_CSRF_SECRET'].some(key => !!process.env[key])) throw new Error('El transporte no admite credenciales de la aplicación/base de datos.');
const ownership = new OwnershipFileReader();
const http = new HttpService();
const network = new AnalysisNetwork(ownership, http);
const engine = new ManualEngine(network);
const ssl = new SslLabsClient(http, network);
const tls = process.env.NEXOGUARD_TRANSPORT_TLS_CERT && process.env.NEXOGUARD_TRANSPORT_TLS_KEY ? { cert: process.env.NEXOGUARD_TRANSPORT_TLS_CERT, key: process.env.NEXOGUARD_TRANSPORT_TLS_KEY } : undefined;
if (!tls && process.env.NEXOGUARD_TRANSPORT_PRIVATE_HTTP !== 'true') throw new Error('El transporte requiere TLS o malla privada cifrada explícita.');
let running = 0;
const server = createTransportServer(process.env.NEXOGUARD_TRANSPORT_SECRET || '', async input => {
  if (input.operation === 'validate') { await network.destination(input.domain!); return { public: true }; }
  if (input.operation === 'ownership') return ownership.read(input.domain!);
  if (input.operation === 'analyze') {
    if (running >= 2) throw new Error('ANALYSIS_LIMIT');
    running++;
    try { return await engine.run(input.domain!); } finally { running--; }
  }
  if (input.operation === 'ssl-analyze') await network.destination(input.domain!);
  return ssl.get(input.operation === 'ssl-info' ? 'info' : 'analyze', input.domain);
}, tls);
const listener = listenerConfig();
server.listen(listener.port, listener.host);
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => {
  server.close();
  server.closeIdleConnections();
  const timer = setTimeout(() => { server.closeAllConnections(); process.exit(0); }, 55000);
  timer.unref();
});
