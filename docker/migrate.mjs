import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { accessSync } from 'node:fs';
import { isAbsolute } from 'node:path';

export function migrationUrl(env = process.env) {
  const url = new URL(env.NEXOGUARD_MIGRATION_DATABASE_URL || '');
  if (env.NEXOGUARD_MIGRATION_APPROVED !== 'yes' ||
      url.protocol !== 'mysql:' || url.port !== '3306' || decodeURIComponent(url.username) !== 'nexoguard_migrate' ||
      !url.password || url.password.includes('REEMPLAZAR') || url.search || url.hash) {
    throw new Error('La migración requiere autorización explícita y cuenta independiente.');
  }
  if (env.NEXOGUARD_DB_MODE === 'local_unencrypted') {
    if (url.hostname !== 'db' || url.pathname !== '/nexoguard_migration_test') throw new Error('Destino local inválido.');
  } else if (env.NEXOGUARD_DB_MODE === 'production_tls') {
    if (!env.NEXOGUARD_DB_EXPECTED_HOST || url.hostname !== env.NEXOGUARD_DB_EXPECTED_HOST ||
        !env.NEXOGUARD_DB_EXPECTED_NAME || url.pathname !== `/${env.NEXOGUARD_DB_EXPECTED_NAME}` ||
        !/^[a-z][a-z0-9_]{0,63}$/.test(env.NEXOGUARD_DB_EXPECTED_NAME) ||
        !env.NEXOGUARD_DB_CA_FILE || !isAbsolute(env.NEXOGUARD_DB_CA_FILE)) throw new Error('Destino TLS inválido.');
    accessSync(env.NEXOGUARD_DB_CA_FILE);
    url.searchParams.set('sslcert', env.NEXOGUARD_DB_CA_FILE);
    url.searchParams.set('sslaccept', 'strict');
  } else throw new Error('Modo de migración inválido.');
  return url;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 try {
  const url = migrationUrl();
  const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { stdio: 'pipe', env: { ...process.env, DATABASE_URL: url.href } });
  if (result.error || result.status === null) throw new Error('No se pudo iniciar Prisma Migrate.');
  process.exitCode = result.status;
  console.log(result.status === 0 ? 'Prisma Migrate terminó correctamente en el destino autorizado.' : 'Prisma Migrate falló; revisar el destino en una consola privada sin publicar su salida.');
} catch {
  console.error('Migración bloqueada: comprueba cuenta independiente, autorización, destino y CA.');
  process.exitCode = 1;
}
}
