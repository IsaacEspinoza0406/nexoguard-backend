import { createServer, RequestListener } from 'node:http';
import { createServer as createTlsServer } from 'node:https';
import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { TransportRequest, transportRequest } from './contract';

export function createTransportServer(secret: string, observe: (input: TransportRequest) => Promise<unknown>, tls?: { cert: string; key: string }) {
  if (!/^[a-zA-Z0-9_-]{43,128}$/.test(secret)) throw new Error('Transporte requiere una clave privada aleatoria.');
  let active = 0, minute = Date.now(), count = 0;
  const listener: RequestListener = async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const fail = (status: number) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end('{"error":"TRANSPORT_REJECTED"}'); };
    if (request.method === 'GET' && request.url === '/health/live') { response.end('{"status":"ok"}'); return; }
    const expected = Buffer.from(`Bearer ${secret}`), provided = Buffer.from(request.headers.authorization || '');
    if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) { request.resume(); fail(401); return; }
    if (request.method !== 'POST' || request.url !== '/v1/observe' || request.headers['content-type'] !== 'application/json') { request.resume(); fail(400); return; }
    if (Date.now() - minute >= 60000) { minute = Date.now(); count = 0; }
    if (active >= 4 || count >= 60) { request.resume(); fail(429); return; }
    count++; active++;
    try {
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of request) {
        size += Buffer.byteLength(chunk as Buffer);
        if (size > 1024) { fail(413); return; }
        chunks.push(Buffer.from(chunk as Buffer));
      }
      let input: TransportRequest;
      try { input = transportRequest(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown); }
      catch { fail(400); return; }
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        // Do not release the slot until the underlying bounded operation finishes.
        timer = setTimeout(() => { if (!response.writableEnded) fail(504); }, 48000);
        const result = await observe(input);
        const body = JSON.stringify(result);
        if (Buffer.byteLength(body) > 1048576) throw new Error('RESPONSE_LIMIT');
        if (!response.writableEnded) { response.writeHead(200, { 'Content-Type': 'application/json' }); response.end(body); }
      } catch { if (!response.writableEnded) fail(502); }
      finally { clearTimeout(timer); }
    } catch { if (!response.writableEnded && !response.destroyed) fail(400); }
    finally { active--; }
  };
  const server = tls ? createTlsServer({ cert: readFileSync(tls.cert), key: readFileSync(tls.key), minVersion: 'TLSv1.2', maxHeaderSize: 8192 }, listener) : createServer({ maxHeaderSize: 8192 }, listener);
  server.maxConnections = 16;
  server.headersTimeout = 5000;
  server.requestTimeout = 5000;
  server.keepAliveTimeout = 1000;
  server.maxHeadersCount = 16;
  server.setTimeout(55000, socket => socket.destroy());
  return server;
}
