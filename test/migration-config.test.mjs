import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrationUrl } from '../docker/migrate.mjs';

const env = { NEXOGUARD_MIGRATION_APPROVED: 'yes', NEXOGUARD_DB_MODE: 'local_unencrypted', NEXOGUARD_MIGRATION_DATABASE_URL: 'mysql://nexoguard_migrate:fixture-only@db:3306/nexoguard_migration_test' };
test('acepta solo la configuración independiente autorizada, sin ejecutar Prisma', () => {
  assert.equal(migrationUrl(env).username, 'nexoguard_migrate');
});
test('no reutiliza DATABASE_URL del runtime ni admite su cuenta', () => {
  assert.throws(() => migrationUrl({ ...env, NEXOGUARD_MIGRATION_DATABASE_URL: '', DATABASE_URL: env.NEXOGUARD_MIGRATION_DATABASE_URL }));
  assert.throws(() => migrationUrl({ ...env, NEXOGUARD_MIGRATION_DATABASE_URL: env.NEXOGUARD_MIGRATION_DATABASE_URL.replace('nexoguard_migrate:', 'nexoguard:') }));
});
test('mantiene autorización, destino, modo y parámetros estrictos', () => {
  assert.throws(() => migrationUrl({ ...env, NEXOGUARD_MIGRATION_APPROVED: 'no' }));
  assert.throws(() => migrationUrl({ ...env, NEXOGUARD_DB_MODE: 'production' }));
  assert.throws(() => migrationUrl({ ...env, NEXOGUARD_MIGRATION_DATABASE_URL: env.NEXOGUARD_MIGRATION_DATABASE_URL.replace('@db:', '@localhost:') }));
  assert.throws(() => migrationUrl({ ...env, NEXOGUARD_MIGRATION_DATABASE_URL: env.NEXOGUARD_MIGRATION_DATABASE_URL + '?allowPublicKeyRetrieval=true' }));
});
