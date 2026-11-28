// Presentation fixture only: no DB, real sessions, providers, DNS or analysis requests.
// Never deploy this server. The fixed dummy cookie is not an authentication credential.
import { createServer, request } from 'node:http';
import { createRequire } from 'node:module';
const require = createRequire('/app/package.json');
const { guidanceFor } = require('/app/dist/analysis/domain/recommendations.js');
const { codes } = require('/app/dist/analysis/domain/checks.js');
const date = '2026-11-27T00:00:00.000Z';
const site = { id: 'ui-fixture-site', domain: 'simulacion-ui.example.invalid', status: 'unverified', verification: null };
const job = { id: 'ui-fixture-job', estado: 'COMPLETADO', creadoEn: date, motivoFallo: null };
createServer((req, res) => {
  const path = req.url.split('?')[0];
  if (path.startsWith('/api/') || path === '/auth/me') {
    res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET') { res.writeHead(405); res.end('{}'); return; }
    const routes = {
      '/auth/me': { id: 'fixture-only', email: 'fixture-ui@example.invalid' },
      '/api/sites': [site],
      '/api/sites/ui-fixture-site/analyses': [job],
      '/api/sites/ui-fixture-site/analyses/ui-fixture-job': { ...job, resultados: codes.map(code => ({ codigoComprobacion: code, estado: code === 'CSP' || code === 'COOKIE_HTTPONLY' ? 'NO_EVALUADO' : code.startsWith('COOKIE_') ? 'NO_APLICABLE' : 'HALLAZGO', evidencia: { scope: 'SIMULACIÓN VISUAL: datos ilustrativos, no análisis real.' }, observadoEn: date, guidance: guidanceFor(code) })) },
    };
    if (!Object.hasOwn(routes, path)) res.writeHead(404);
    res.end(JSON.stringify(routes[path] || {})); return;
  }
  const upstream = request({ hostname: 'nexoguard-practical-ui-front', port: 3000, path: req.url, method: req.method, headers: req.headers }, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res); });
  upstream.on('error', () => { res.writeHead(503); res.end('Presentation fixture unavailable'); });
  req.pipe(upstream);
}).listen(38001, '0.0.0.0');
