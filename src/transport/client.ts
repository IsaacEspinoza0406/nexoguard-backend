import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { readFileSync } from 'node:fs';
import { codes, Check } from '../analysis/domain/checks';
import { TransportRequest, transportRequest } from './contract';

export function transportConfiguration(env: NodeJS.ProcessEnv = process.env) {
 try {
  const url = new URL(env.NEXOGUARD_TRANSPORT_URL || '');
  const key = env.NEXOGUARD_TRANSPORT_SECRET || '';
  // HTTP only across a deliberately enabled encrypted private mesh (or isolated local test).
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      !['https:', 'http:'].includes(url.protocol) ||
      (url.protocol === 'http:' && env.NEXOGUARD_TRANSPORT_PRIVATE_HTTP !== 'true') ||
      !/^[a-zA-Z0-9_-]{43,128}$/.test(key)) throw new Error('Configuración del transporte inválida.');
  return { url, key, ca: env.NEXOGUARD_TRANSPORT_CA_FILE ? readFileSync(env.NEXOGUARD_TRANSPORT_CA_FILE, 'utf8') : undefined };
 } catch { throw new Error('Configuración del transporte inválida.'); }
}

export async function transportCall(input: TransportRequest): Promise<unknown> {
  const body = JSON.stringify(transportRequest(input));
  const { url, key, ca } = transportConfiguration();
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(new URL('/v1/observe', url), {
      method: 'POST', agent: false, rejectUnauthorized: true, ca, maxHeaderSize: 8192,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, response => {
      const chunks: Buffer[] = []; let size = 0;
      response.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 1048576) request.destroy(new Error('TRANSPORT_RESPONSE_LIMIT')); else chunks.push(chunk); });
      response.on('error', () => reject(new Error('TRANSPORT_UNAVAILABLE')));
      response.on('end', () => {
        if (response.statusCode !== 200) { reject(new Error('TRANSPORT_UNAVAILABLE')); return; }
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown); }
        catch { reject(new Error('TRANSPORT_INVALID_RESPONSE')); }
      });
    });
    const timer = setTimeout(() => request.destroy(new Error('TRANSPORT_TIMEOUT')), 50000);
    request.once('close', () => clearTimeout(timer));
    request.once('error', () => reject(new Error('TRANSPORT_UNAVAILABLE')));
    request.end(body);
  });
}

export async function remoteAnalysis(domain: string): Promise<{ results: Check[]; failed: boolean }> {
  const value = await transportCall({ operation: 'analyze', domain }) as { results?: Check[]; failed?: unknown };
  if (!value || typeof value.failed !== 'boolean' || !Array.isArray(value.results) || value.results.length !== codes.length ||
      new Set(value.results.map(item => item.code)).size !== codes.length || value.results.some(item =>
        !codes.some(code => code === item.code) || !['APROBADO', 'HALLAZGO', 'NO_APLICABLE', 'NO_EVALUADO'].includes(item.status) ||
        typeof item.recommendation !== 'string' || !item.evidence || typeof item.evidence !== 'object' || Array.isArray(item.evidence) ||
        Object.values(item.evidence).some(entry => entry !== null && !['string', 'number', 'boolean'].includes(typeof entry)))) throw new Error('TRANSPORT_INVALID_RESPONSE');
  return { results: value.results, failed: value.failed };
}
