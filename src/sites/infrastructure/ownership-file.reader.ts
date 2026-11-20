import { Injectable, BadGatewayException, ServiceUnavailableException } from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { request } from 'node:https';
import { VERIFICATION_PATH } from '../domain/domain';

const denied = new BlockList();
for (const [address, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) denied.addSubnet(address, prefix, 'ipv4');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
for (const [address, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]] as const) denied.addSubnet(address, prefix, 'ipv6');

export function isPublicAddress(address: string): boolean {
  const version = isIP(address);
  return version === 4 ? !denied.check(address, 'ipv4') : version === 6 && globalV6.check(address, 'ipv6') && !denied.check(address, 'ipv6');
}

// Native HTTPS gives explicit control of DNS pinning; no redirects, proxies or insecure TLS.
@Injectable()
export class OwnershipFileReader {
  private active = 0;

  async resolve(domain: string) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([lookup(domain, { all: true, verbatim: true }), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('DNS timeout')), 3000); })]);
    } finally { clearTimeout(timer); }
  }

  download(domain: string, address: string, family: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const req = request({ hostname: domain, servername: domain, port: 443, path: VERIFICATION_PATH, method: 'GET', agent: false, rejectUnauthorized: true,
        lookup: (_host, options, callback) => { if (options.all) callback(null, [{ address, family }]); else callback(null, address, family); },
        headers: { Accept: 'text/plain', 'Accept-Encoding': 'identity', 'User-Agent': 'NexoGuard-Ownership/1.0' }, maxHeaderSize: 8192,
      }, response => {
        if (response.statusCode !== 200 || (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity')) { response.destroy(); req.destroy(new Error('Unexpected response')); return; }
        let size = 0;
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => { size += chunk.length; if (size > 256) req.destroy(new Error('Response too large')); else chunks.push(chunk); });
        response.on('error', reject);
        response.on('end', () => resolve(Buffer.concat(chunks).toString('utf8').trim()));
      });
      const timer = setTimeout(() => req.destroy(new Error('HTTPS timeout')), 5000);
      req.once('close', () => clearTimeout(timer));
      req.once('error', reject);
      req.end();
    });
  }

  async read(domain: string): Promise<string> {
    if (this.active >= 4) throw new ServiceUnavailableException('Hay verificaciones en curso. Inténtalo más tarde.');
    this.active++;
    try {
      const addresses = await this.resolve(domain);
      // Reject mixed public/private DNS results, including IPv4-mapped IPv6.
      if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) throw new Error('Blocked destination');
      const selected = addresses[0];
      return await this.download(domain, selected.address, selected.family);
    } catch { throw new BadGatewayException('No se pudo leer el archivo. Comprueba el DNS público, HTTPS y la ruta; no se admiten redirecciones.'); }
    finally { this.active--; }
  }
}
