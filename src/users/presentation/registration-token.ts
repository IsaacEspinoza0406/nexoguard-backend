import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { httpSecurity } from '../../security/http-security';

const key = randomBytes(32);
const lifetimeMs = 600_000;

export function validateCsrfConfiguration(): void {
  if (httpSecurity().production && (!process.env.NEXOGUARD_CSRF_SECRET || Buffer.byteLength(process.env.NEXOGUARD_CSRF_SECRET) < 32)) throw new Error('Producción requiere una clave CSRF privada de al menos 32 bytes.');
}

function signingKey(): Buffer {
  validateCsrfConfiguration();
  return httpSecurity().production ? Buffer.from(process.env.NEXOGUARD_CSRF_SECRET!) : key;
}

export function createRegistrationToken(binding = ''): string {
  const payload = `${Date.now()}.${randomBytes(32).toString('hex')}`;
  return `${payload}.${createHmac('sha256', signingKey()).update(`${payload}:${binding}`).digest('hex')}`;
}

export function isValidRegistrationToken(token: string, cookie: string, binding = ''): boolean {
  if (!/^\d{13}\.[0-9a-f]{64}\.[0-9a-f]{64}$/.test(token) || token !== cookie) return false;
  const [timestamp, nonce, signature] = token.split('.');
  const age = Date.now() - Number(timestamp);
  if (age < 0 || age >= lifetimeMs) return false;
  const expected = createHmac('sha256', signingKey()).update(`${timestamp}.${nonce}:${binding}`).digest();
  return timingSafeEqual(Buffer.from(signature, 'hex'), expected);
}
