import { CookieOptions, Request, RequestHandler } from 'express';

export const securityHeaders: RequestHandler = (_request, response, next) => {
  response.removeHeader('X-Powered-By');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  next();
};

export function httpSecurity() {
  const mode = process.env.NEXOGUARD_HTTP_MODE || (process.env.NODE_ENV === 'production' ? 'production' : 'local');
  if (!['local', 'production'].includes(mode)) throw new Error('Modo HTTP inválido.');
  const production = mode === 'production';
  const origin = process.env.FRONTEND_ORIGIN || 'http://127.0.0.1:3000';
  const url = new URL(origin);
  if (url.origin !== origin || url.username || url.password || (production ? url.protocol !== 'https:' : origin !== 'http://127.0.0.1:3000')) throw new Error('Origen HTTP inválido.');
  return { origin, production, sessionCookie: production ? '__Host-nexoguard_session' : 'nexoguard_session', csrfCookie: production ? '__Host-nexoguard_csrf' : 'auth_csrf' };
}

export function cookieOptions(path = '/'): CookieOptions {
  return { httpOnly: true, secure: httpSecurity().production, sameSite: 'strict', path };
}

// GET token issuance only. Browser same-origin GETs can omit Origin.
// Mutations must still validate Origin AND the session-bound CSRF token/cookie.
export function trustedTokenRequest(request: Request): boolean {
  const config = httpSecurity();
  const origin = request.get('origin');
  if (origin !== undefined) return origin === config.origin;
  return config.production && request.get('sec-fetch-site') === 'same-origin' &&
    request.get('host') === new URL(config.origin).host;
}

export function readCookie(request: Request, name: string): string {
  const matches = (request.headers.cookie || '').split(';').map(p => p.trim()).filter(p => p.startsWith(`${name}=`));
  if (matches.length !== 1) return '';
  try { return decodeURIComponent(matches[0].slice(name.length + 1)); } catch { return ''; }
}
