import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { Agent as HttpAgent, request as httpRequest, ClientRequestArgs, IncomingMessage } from 'node:http';
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https';
import { connect, checkServerIdentity, PeerCertificate } from 'node:tls';
import { firstValueFrom } from 'rxjs';
import { isPublicAddress, OwnershipFileReader } from '../../sites/infrastructure/ownership-file.reader';
import { CertificateObservation, PageObservation } from '../domain/checks';

export function redirectTarget(location: string, current: URL, domain: string): URL {
  const next = new URL(location, current);
  if (next.protocol !== 'https:' || next.hostname !== domain || next.port || next.username || next.password || next.search || next.hash || next.href.length > 2048) throw new Error('REDIRECT_BLOCKED');
  return next;
}

export function certificateObservation(domain: string, cert: PeerCertificate, trusted: boolean): CertificateObservation {
  const iso = (date: string) => Number.isFinite(Date.parse(date)) ? new Date(date).toISOString() : null;
  return { trusted, identity: !!cert.raw && !checkServerIdentity(domain, cert), validFrom: iso(cert.valid_from), validTo: iso(cert.valid_to) };
}

@Injectable()
export class AnalysisNetwork {
  constructor(private readonly dns: OwnershipFileReader, private readonly http: HttpService) {}

  async destination(domain: string) {
    const addresses = await this.dns.resolve(domain);
    if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) throw new Error('DESTINATION_BLOCKED');
    return addresses[0];
  }

  async certificate(domain: string): Promise<CertificateObservation> {
    const target = await this.destination(domain);
    return new Promise((resolve, reject) => {
      // Diagnostic handshake only. No application data is sent on this socket.
      const socket = this.openTls({ host: target.address, port: 443, servername: domain, rejectUnauthorized: false, ALPNProtocols: ['http/1.1'] });
      const timer = setTimeout(() => socket.destroy(new Error('TLS_TIMEOUT')), 5000);
      socket.once('close', () => clearTimeout(timer));
      socket.once('error', reject);
      socket.once('secureConnect', () => {
        try { resolve(certificateObservation(domain, socket.getPeerCertificate(), socket.authorized)); } catch { reject(new Error('CERTIFICATE_UNAVAILABLE')); }
        finally { socket.destroy(); }
      });
    });
  }

  openTls(options: import('node:tls').ConnectionOptions) { return connect(options); }

  async page(url: URL): Promise<PageObservation & { location?: string }> {
    if (!['http:', 'https:'].includes(url.protocol) || url.port || url.username || url.password || url.search || url.hash) throw new Error('URL_BLOCKED');
    const target = await this.destination(url.hostname);
    const lookup: import('node:net').LookupFunction = (_host, options, callback) => { if (options.all) callback(null, [target]); else callback(null, target.address, target.family); };
    const httpAgent = new HttpAgent({ keepAlive: false, lookup });
    const httpsAgent = new HttpsAgent({ keepAlive: false, lookup, rejectUnauthorized: true, maxCachedSessions: 0 });
    try {
      const response = await firstValueFrom(this.http.get(url.href, { adapter: 'http', httpAgent, httpsAgent, proxy: false, maxRedirects: 0, maxContentLength: 262144, maxBodyLength: 0, timeout: 5000, signal: AbortSignal.timeout(5000), decompress: false, responseType: 'arraybuffer', validateStatus: () => true,
        headers: { Accept: 'text/html', 'Accept-Encoding': 'identity', 'User-Agent': 'NexoGuard-Manual/1.0', Cookie: undefined, Authorization: undefined },
        // Never retain page bodies. Limit Node's parser, including Set-Cookie size.
        transport: { request: (options: ClientRequestArgs, callback: (response: IncomingMessage) => void) => (url.protocol === 'https:' ? httpsRequest : httpRequest)({ ...options, maxHeaderSize: 8192 }, callback) },
      }));
      const headers: Record<string, string> = {};
      for (const name of ['strict-transport-security', 'content-security-policy', 'x-frame-options', 'x-content-type-options', 'referrer-policy']) {
        const value = response.headers[name]; if (typeof value === 'string') headers[name] = value;
      }
      const cookies = response.headers['set-cookie'];
      return { status: response.status, headers, cookies: Array.isArray(cookies) ? cookies : [], location: typeof response.headers.location === 'string' ? response.headers.location : undefined };
    } finally { httpAgent.destroy(); httpsAgent.destroy(); }
  }
}
