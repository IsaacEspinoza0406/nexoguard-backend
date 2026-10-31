import { spawnSync } from 'node:child_process';

try {
  const url = new URL(process.env.DATABASE_URL || '');
  if (process.env.NEXOGUARD_MIGRATION_APPROVED !== 'yes' ||
      process.env.NEXOGUARD_DB_MODE !== 'local_unencrypted' ||
      url.protocol !== 'mysql:' || url.hostname !== 'db' || url.port !== '3306' ||
      url.pathname !== '/nexoguard_migration_test' || decodeURIComponent(url.username) !== 'nexoguard' ||
      !url.password || url.password.includes('REEMPLAZAR') || url.search || url.hash) {
    throw new Error('La migración requiere autorización explícita y destino local.');
  }
  const result = spawnSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { stdio: 'inherit' });
  if (result.error || result.status === null) throw new Error('No se pudo iniciar Prisma Migrate.');
  process.exitCode = result.status;
} catch {
  console.error('Migración bloqueada: verifica autorización, destino y modo local.');
  process.exitCode = 1;
}
