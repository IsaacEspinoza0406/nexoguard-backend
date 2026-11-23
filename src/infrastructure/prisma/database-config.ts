import { readFileSync } from 'node:fs';
import { checkServerIdentity } from 'node:tls';

// Separate allowlists for the existing local database and a new TLS deployment.
// Errors deliberately contain neither URLs nor driver errors.
export function databaseConfig(env: NodeJS.ProcessEnv = process.env) {
  try {
    const url = new URL(env.DATABASE_URL || '');
    const user = decodeURIComponent(url.username);
    if (url.protocol !== 'mysql:' || url.port !== '3306' || !url.password ||
        decodeURIComponent(url.password).includes('REEMPLAZAR') || url.search || url.hash) throw new Error();
    const common = { host: url.hostname, port: 3306, user, password: decodeURIComponent(url.password), database: url.pathname.slice(1), allowPublicKeyRetrieval: false };
    if (env.NEXOGUARD_DB_MODE === 'local_unencrypted') {
      if (url.hostname !== 'db' || url.pathname !== '/nexoguard_migration_test' || user !== 'nexoguard') throw new Error();
      return { ...common, cachingRsaPublicKey: env.NEXOGUARD_DB_PUBLIC_KEY_FILE };
    }
    if (env.NEXOGUARD_DB_MODE !== 'production_tls' || env.NEXOGUARD_HTTP_MODE !== 'production' ||
        !env.NEXOGUARD_DB_EXPECTED_HOST || url.hostname !== env.NEXOGUARD_DB_EXPECTED_HOST ||
        !env.NEXOGUARD_DB_EXPECTED_NAME || common.database !== env.NEXOGUARD_DB_EXPECTED_NAME ||
        !/^[a-z][a-z0-9_]{0,63}$/.test(common.database) || user !== 'nexoguard_runtime' ||
        !env.NEXOGUARD_DB_CA_FILE) throw new Error();
    return { ...common, ssl: {
      ca: readFileSync(env.NEXOGUARD_DB_CA_FILE, 'utf8'), rejectUnauthorized: true,
      minVersion: 'TLSv1.2' as const, servername: url.hostname,
      checkServerIdentity: (_hostname: string, certificate: import('node:tls').PeerCertificate) => checkServerIdentity(url.hostname, certificate),
    } };
  } catch { throw new Error('Configuración de base de datos inválida: comprueba modo, destino autorizado y CA.'); }
}
