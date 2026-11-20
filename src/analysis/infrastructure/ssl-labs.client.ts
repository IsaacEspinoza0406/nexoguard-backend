import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { Agent, request } from 'node:https';
import { ClientRequestArgs, IncomingMessage } from 'node:http';
import { firstValueFrom } from 'rxjs';
import { AnalysisNetwork } from './analysis-network';

@Injectable()
export class SslLabsClient {
  constructor(private readonly http: HttpService, private readonly network: AnalysisNetwork) {}
  configured() { return process.env.SSLLABS_ENABLED === 'true' && /^[^\s@\r\n]+@[^\s@\r\n]+\.[^\s@\r\n]+$/.test(process.env.SSLLABS_EMAIL || ''); }
  async get(resource: 'info' | 'analyze', domain?: string) {
    if (!this.configured()) throw new Error('SSL_LABS_CONFIGURATION_REQUIRED');
    const url = new URL(`https://api.ssllabs.com/api/v4/${resource}`);
    if (resource === 'analyze') {
      if (!domain) throw new Error('DOMAIN_REQUIRED');
      url.search = new URLSearchParams({ host: domain, publish: 'off', all: 'done', fromCache: 'on', maxAge: '24', ignoreMismatch: 'off' }).toString();
    }
    const address = await this.network.destination(url.hostname);
    const agent = new Agent({ keepAlive: false, maxCachedSessions: 0, rejectUnauthorized: true, lookup: (_host, options, callback) => { if (options.all) callback(null, [address]); else callback(null, address.address, address.family); } });
    try {
      const response = await firstValueFrom(this.http.get(url.href, { adapter: 'http', httpsAgent: agent, proxy: false, maxRedirects: 0, timeout: 10000, signal: AbortSignal.timeout(10000), maxContentLength: 1048576, maxBodyLength: 0, decompress: false, responseType: 'text', validateStatus: () => true,
        headers: { Accept: 'application/json', 'Accept-Encoding': 'identity', email: process.env.SSLLABS_EMAIL, 'User-Agent': 'NexoGuard/1.0', Cookie: undefined, Authorization: undefined },
        transport: { request: (options: ClientRequestArgs, callback: (response: IncomingMessage) => void) => request({ ...options, maxHeaderSize: 8192 }, callback) },
      }));
      let data: unknown = null;
      if (response.status === 200) { if (typeof response.data !== 'string') throw new Error('INVALID_PROVIDER_RESPONSE'); data = JSON.parse(response.data) as unknown; }
      return { status: response.status, data, retryAfter: response.headers['retry-after'] as unknown, maximum: Number(response.headers['x-max-assessments']), current: Number(response.headers['x-current-assessments']) };
    } finally { agent.destroy(); }
  }
}
