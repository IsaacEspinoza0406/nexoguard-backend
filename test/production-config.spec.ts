import { describe, test, expect } from '@jest/globals';
import { databaseConfig } from '../src/infrastructure/prisma/database-config';
import { listenerConfig } from '../src/security/listener-config';

describe('configuración de producción sin conexiones', () => {
  const local = { DATABASE_URL: 'mysql://nexoguard:fixture-only@db:3306/nexoguard_migration_test', NEXOGUARD_DB_MODE: 'local_unencrypted', NEXOGUARD_DB_PUBLIC_KEY_FILE: '/public-key' };
  test('mantiene el destino local y prohíbe recuperación RSA no autenticada', () => {
    expect(databaseConfig(local)).toMatchObject({ host: 'db', user: 'nexoguard', allowPublicKeyRetrieval: false, cachingRsaPublicKey: '/public-key' });
    expect(databaseConfig(local)).not.toHaveProperty('ssl');
  });
  test.each(['mysql://nexoguard:fixture-only@elsewhere:3306/nexoguard_migration_test', local.DATABASE_URL + '?ssl=false', local.DATABASE_URL.replace('nexoguard:', 'root:')])('rechaza un destino o parámetros diferentes', DATABASE_URL => {
    expect(() => databaseConfig({ ...local, DATABASE_URL })).toThrow('Configuración de base de datos inválida');
  });
  test('producción exige destino, usuario separado y CA explícitos', () => {
    const env = { DATABASE_URL: 'mysql://nexoguard_runtime:fixture-only@mysql.railway.internal:3306/nexoguard', NEXOGUARD_HTTP_MODE: 'production', NEXOGUARD_DB_MODE: 'production_tls', NEXOGUARD_DB_EXPECTED_HOST: 'mysql.railway.internal', NEXOGUARD_DB_EXPECTED_NAME: 'nexoguard' };
    expect(() => databaseConfig(env)).toThrow();
    expect(() => databaseConfig({ ...env, NEXOGUARD_DB_CA_FILE: '/nonexistent/ca' })).toThrow();
    expect(() => databaseConfig({ ...env, DATABASE_URL: env.DATABASE_URL.replace('nexoguard_runtime', 'root') })).toThrow();
  });
  test('admite PORT y no confía indiscriminadamente en proxies', () => {
    expect(listenerConfig({ PORT: '8080', HOST: '::' })).toEqual({ port: 8080, host: '::', trustProxy: false });
    expect(listenerConfig({ NEXOGUARD_TRUST_PROXY_IP: '10.2.0.4' }).trustProxy).toBe('10.2.0.4');
    for (const value of ['true', '1', '10.0.0.0/8']) expect(() => listenerConfig({ NEXOGUARD_TRUST_PROXY_IP: value })).toThrow();
    expect(() => listenerConfig({ PORT: '0' })).toThrow();
  });
});
