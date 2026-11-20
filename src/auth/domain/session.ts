import { createHash, randomBytes } from 'node:crypto';

export const newSessionToken = () => randomBytes(32).toString('hex');
export const sessionHash = (token: string) => createHash('sha256').update(token).digest();
export const validSessionToken = (token: string) => /^[0-9a-f]{64}$/.test(token);

export function sessionDurations() {
  const absolute = Number(process.env.SESSION_ABSOLUTE_SECONDS || 28800);
  const idle = Number(process.env.SESSION_IDLE_SECONDS || 1800);
  if (![absolute, idle].every(n => Number.isSafeInteger(n) && n > 0) || idle > absolute || absolute > 604800) throw new Error('Duración de sesión inválida.');
  return { absolute: absolute * 1000, idle: idle * 1000 };
}
