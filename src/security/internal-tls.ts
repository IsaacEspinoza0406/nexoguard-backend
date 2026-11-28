import { readFileSync } from 'node:fs';
import { createSecureContext, SecureContextOptions } from 'node:tls';

// TLS is mandatory for the production listener. HTTP remains explicit local dev only.
export function internalTls(production: boolean, env: NodeJS.ProcessEnv = process.env): SecureContextOptions | undefined {
  const cert = env.NEXOGUARD_INTERNAL_TLS_CERT, key = env.NEXOGUARD_INTERNAL_TLS_KEY;
  if (!cert && !key && !production) return undefined;
  if (!cert || !key) throw new Error('INTERNAL_TLS_CONFIGURATION_REQUIRED');
  try {
    const options: SecureContextOptions = { cert: readFileSync(cert), key: readFileSync(key), minVersion: 'TLSv1.2' };
    createSecureContext(options); // Fail before opening the listener, without logging paths/key contents.
    return options;
  } catch { throw new Error('INTERNAL_TLS_CONFIGURATION_INVALID'); }
}
