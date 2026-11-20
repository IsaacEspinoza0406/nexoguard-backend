import { Injectable } from '@nestjs/common';
import { AnalysisNetwork, redirectTarget } from '../infrastructure/analysis-network';
import { Check, certificateChecks, check, codes, pageChecks, unavailable } from '../domain/checks';

@Injectable()
export class ManualEngine {
  constructor(private readonly network: AnalysisNetwork) {}
  async run(domain: string): Promise<{ results: Check[]; failed: boolean }> {
    const results: Check[] = [];
    const deadline = Date.now() + 45000;
    try {
      const http = await this.network.page(new URL(`http://${domain}/`));
      const redirect = [301, 302, 303, 307, 308].includes(http.status) && http.location ? redirectTarget(http.location, new URL(`http://${domain}/`), domain) : null;
      results.push(check('HTTP_REDIRECT', redirect ? 'APROBADO' : 'HALLAZGO', { redirectsToSameDomainHttps: !!redirect, status: http.status }, 'Redirige la página HTTP a HTTPS en el mismo dominio verificado. Comprueba Location y evita destinos no acreditados.'));
    } catch { results.push(unavailable('HTTP_REDIRECT', 'HTTP no accesible o redirección fuera del alcance permitido.')); }
    let connected = false;
    try {
      const cert = await this.network.certificate(domain);
      connected = true;
      results.push(...certificateChecks(cert));
      if (!cert.trusted || !cert.identity) {
        results.push(check('HTTPS', 'HALLAZGO', { tlsReached: true, authenticated: false }, 'Corrige el certificado antes de confiar en respuestas HTTP. No se descargó contenido con TLS no autenticado.'));
      } else {
        let current = new URL(`https://${domain}/`);
        const visited = new Set<string>();
        for (let hop = 0; ; hop++) {
          if (Date.now() >= deadline || hop > 3 || visited.has(current.href)) throw new Error('REDIRECT_LIMIT');
          visited.add(current.href);
          const page = await this.network.page(current);
          if ([301, 302, 303, 307, 308].includes(page.status)) {
            if (!page.location) throw new Error('MISSING_LOCATION');
            current = redirectTarget(page.location, current, domain);
            continue;
          }
          results.push(check('HTTPS', page.status >= 200 && page.status < 400 ? 'APROBADO' : 'HALLAZGO', { status: page.status, redirects: hop, authenticated: true }, 'La página principal debe estar disponible por HTTPS con identidad válida. Revisa errores del servidor y repite la solicitud anónima.'));
          results.push(...pageChecks(page)); break;
        }
      }
    } catch { results.push(unavailable('HTTPS', 'No se pudo obtener la página por HTTPS dentro de los límites de red.')); }
    for (const code of codes) if (!results.some(result => result.code === code)) results.push(unavailable(code, 'Sin respuesta autenticada o evidencia suficiente.'));
    return { results, failed: !connected };
  }
}
