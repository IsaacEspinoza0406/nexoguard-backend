import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const key = randomBytes(32);
const lifetimeMs = 600_000;

export function createRegistrationToken(): string {
  const payload = `${Date.now()}.${randomBytes(32).toString('hex')}`;
  return `${payload}.${createHmac('sha256', key).update(payload).digest('hex')}`;
}

export function isValidRegistrationToken(token: string, cookie: string): boolean {
  if (!/^\d{13}\.[0-9a-f]{64}\.[0-9a-f]{64}$/.test(token) || token !== cookie) return false;
  const [timestamp, nonce, signature] = token.split('.');
  const age = Date.now() - Number(timestamp);
  if (age < 0 || age >= lifetimeMs) return false;
  const expected = createHmac('sha256', key).update(`${timestamp}.${nonce}`).digest();
  return timingSafeEqual(Buffer.from(signature, 'hex'), expected);
}
