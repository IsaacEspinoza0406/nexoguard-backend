import { RequestHandler } from 'express';

export type SecurityEvent = { event: string; outcome: 'success' | 'failure'; status: number; at: string };
const operations: Array<[RegExp, string]> = [
  [/^\/users$/, 'user.registration'], [/^\/auth\/login$/, 'auth.login'], [/^\/auth\/logout$/, 'auth.logout'],
  [/^\/sites$/, 'site.create'], [/^\/sites\/[^/]+\/verification-challenges$/, 'ownership.challenge'],
  [/^\/sites\/[^/]+\/verification-challenges\/[^/]+\/check$/, 'ownership.check'],
  [/^\/sites\/[^/]+\/analyses$/, 'analysis.request'], [/^\/sites\/[^/]+\/schedule$/, 'monitoring.configure'],
  [/^\/sites\/[^/]+\/alerts\/[^/]+\/read$/, 'alert.read'], [/^\/sites\/[^/]+\/ssl-labs$/, 'external.request'],
];

// Explicit allowlist: never serialize a request, exception, URL, identity or header.
export function securityEvents(sink: (event: SecurityEvent) => void = event => console.info(JSON.stringify(event))): RequestHandler {
  return (request, response, next) => {
    const operation = request.method === 'POST' ? operations.find(([pattern]) => pattern.test(request.path))?.[1] : undefined;
    response.once('finish', () => {
      const status = response.statusCode;
      const event = operation || ([401, 403, 429].includes(status) ? 'access.denied' : undefined);
      if (!event) return;
      try { sink({ event, outcome: status < 400 ? 'success' : 'failure', status, at: new Date().toISOString() }); }
      catch { /* Audit sink failure must not crash a completed request or expose its contents. */ }
    });
    next();
  };
}
