// Native Newman runner. Raw HAR stays private; public summary contains counts only.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const root = new URL('../../', import.meta.url);
const { default: newman } = await import(new URL('bd/private-backups/validation-tools/node_modules/newman/index.js', root));
const collection = JSON.parse(await readFile(new URL('docs/validation/NexoGuard.postman_collection.json', root), 'utf8'));
const privateDir = new URL('bd/private-backups/validation-20261122/', root);
await mkdir(privateDir, { recursive: true });
const entries = [];
const toHar = (url, method, requestHeaders, body, status, statusText, responseHeaders, text, mime) => ({
  startedDateTime: new Date().toISOString(), time: 0,
  request: { method, url, httpVersion: 'HTTP/1.1', headers: requestHeaders, queryString: [], cookies: [], headersSize: -1, bodySize: -1, ...(body ? { postData: { mimeType: 'application/json', text: body } } : {}) },
  response: { status, statusText, httpVersion: 'HTTP/1.1', headers: responseHeaders, cookies: [], content: { size: Buffer.byteLength(text), mimeType: mime || 'application/json', text }, redirectURL: '', headersSize: -1, bodySize: -1 },
  cache: {}, timings: { send: 0, wait: 0, receive: 0 },
});
let transportFailed = false;
const summary = await new Promise((resolve, reject) => {
  newman.run({ collection, iterationCount: 1, reporters: [], timeoutRequest: 10000, ignoreRedirects: true }, (error, result) => error ? reject(new Error('Newman no completó la ejecución.')) : resolve(result))
    .on('request', (error, args) => {
      if (error || !args.response) { transportFailed = true; return; }
      const url = args.request.url.toString();
      if (new URL(url).origin !== 'http://127.0.0.1:38381') { transportFailed = true; return; }
      entries.push(toHar(url, args.request.method, args.request.headers.all().map(h => ({ name: h.key, value: h.value })), args.request.body?.raw, args.response.code, args.response.status, args.response.headers.all().map(h => ({ name: h.key, value: h.value })), args.response.stream.toString('utf8'), args.response.headers.get('Content-Type')));
    });
});
const rows = summary.run.executions.map(e => ({ case: e.item.name.split(' ')[0], status: e.response?.code || null, assertions: e.assertions?.length || 0, failures: e.assertions?.filter(a => a.error).length || 0 }));
const report = { tool: 'Newman 6.2.1 (native Postman runtime)', timestampUtc: new Date().toISOString(), persistence: 'Fictitious memory adapter, real Nest HTTP stack; NOT MySQL', requests: summary.run.stats.requests, assertions: summary.run.stats.assertions, failures: summary.run.failures.length, cases: rows };
// Capture only NexoGuard's isolated public UI and same-host static assets. No crawler/JS execution.
const uiBase = 'http://127.0.0.1:38382';
const paths = ['/', '/login', '/cuenta'];
const assets = new Set();
let noncePages = 0;
for (const path of paths) {
  const response = await fetch(uiBase + path, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
  const text = await response.text();
  if (!response.ok && !(path === '/cuenta' && response.status === 307)) throw new Error('No se obtuvo la página de prueba.');
  if (response.ok) {
    const policy = response.headers.get('content-security-policy') || '';
    const nonce = /'nonce-([A-Za-z0-9+/]+)'/.exec(policy)?.[1];
    const scripts = [...text.matchAll(/<script\b[^>]*>/g)];
    if (!nonce || !scripts.length || scripts.some(s => !s[0].includes(`nonce="${nonce}"`))) throw new Error('CSP/nonce no coincide con los scripts renderizados.');
    noncePages++;
  }
  entries.push(toHar(uiBase + path, 'GET', [], '', response.status, response.statusText, [...response.headers].map(([name, value]) => ({ name, value })), text, response.headers.get('content-type')));
  if (response.ok) for (const match of text.matchAll(/(?:src|href)="(\/_next\/static\/[^"?#]+(?:\?[^"#]*)?)"/g)) assets.add(match[1].replaceAll('&amp;', '&'));
}
for (const path of [...assets].slice(0, 40)) {
  const url = new URL(path, uiBase);
  if (url.origin !== uiBase || !url.pathname.startsWith('/_next/static/')) throw new Error('Recurso fuera de alcance.');
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('Recurso estático no disponible.');
  const text = await response.text();
  entries.push(toHar(url.href, 'GET', [], '', response.status, response.statusText, [...response.headers].map(([name, value]) => ({ name, value })), text, response.headers.get('content-type')));
}
report.ui = { pages: paths.length, noncePages, assets: Math.min(assets.size, 40), mode: 'HTTP capture only; no browser execution; private page unauthenticated redirect' };
await writeFile(new URL('nexoguard.har', privateDir), JSON.stringify({ log: { version: '1.2', creator: { name: 'NexoGuard native Newman validation', version: '1' }, entries } }));
await writeFile(new URL('docs/validation/newman-results.json', root), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ tool: report.tool, requests: report.requests, assertions: report.assertions, failures: report.failures, ui: report.ui }, null, 2));
if (transportFailed || report.failures || rows.length !== 26) process.exitCode = 1;
