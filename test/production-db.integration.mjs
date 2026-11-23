// Only for the new isolated database in docs/validation/production-db.yaml.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import mariadb from 'mariadb';
import { PrismaService } from '../dist/infrastructure/prisma/prisma.service.js';

let stage = 'preflight';
(async () => {
  assert.equal(new URL(process.env.DATABASE_URL).hostname, 'prod-db');
  assert.equal(process.env.NEXOGUARD_DB_EXPECTED_NAME, 'nexoguard');
  const ssl = { ca: fs.readFileSync('/run/private/db-cert.pem', 'utf8'), servername: 'prod-db', rejectUnauthorized: true };
  stage = 'admin-tls';
  const admin = await mariadb.createConnection({ host: 'prod-db', user: 'root', password: fs.readFileSync('/run/private/admin-password', 'utf8'), database: 'nexoguard', ssl });
  let prisma;
  try {
    const grants = {
      usuarios: 'SELECT, INSERT', sesiones: 'SELECT, INSERT, UPDATE', sitios: 'SELECT, INSERT, UPDATE',
      revisiones_dominio: 'SELECT, INSERT', verificaciones_dominio: 'SELECT, INSERT, UPDATE',
      analisis: 'SELECT, INSERT, UPDATE', resultados_comprobacion: 'SELECT, INSERT, UPDATE',
      alertas: 'SELECT, INSERT, UPDATE', programaciones_analisis: 'SELECT, INSERT, UPDATE', proveedores_externos: 'SELECT, UPDATE',
    };
    stage = 'runtime-grants';
    for (const [table, permissions] of Object.entries(grants)) await admin.query(`GRANT ${permissions} ON nexoguard.${table} TO 'nexoguard_runtime'@'%'`);
    stage = 'schema';
    assert.equal(Number((await admin.query("SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema='nexoguard'"))[0].total), 11);
    assert.equal(Number((await admin.query('SELECT COUNT(*) AS total FROM _prisma_migrations WHERE finished_at IS NOT NULL'))[0].total), 3);
    stage = 'runtime-tls';
    const connection = await mariadb.createConnection({ host: 'prod-db', user: 'nexoguard_runtime', password: new URL(process.env.DATABASE_URL).password, database: 'nexoguard', ssl });
    try {
      const cipher = await connection.query("SHOW SESSION STATUS LIKE 'Ssl_cipher'"); assert.ok(cipher[0].Value);
      await assert.rejects(connection.query('CREATE TABLE forbidden_runtime_ddl (id INT)'), error => error.errno === 1142);
    } finally { await connection.end(); }
    stage = 'negative-tls';
    await assert.rejects(mariadb.createConnection({ host: 'prod-db', user: 'nexoguard_runtime', password: new URL(process.env.DATABASE_URL).password, database: 'nexoguard', ssl: { ...ssl, servername: 'wrong-name.invalid' } }));
    // A missing or untrusted CA must fail; no fallback to plaintext/RSA retrieval.
    await assert.rejects(mariadb.createConnection({ host: 'prod-db', user: 'nexoguard_runtime', password: new URL(process.env.DATABASE_URL).password, database: 'nexoguard', ssl: { servername: 'prod-db', rejectUnauthorized: true } }));
    stage = 'prisma';
    prisma = new PrismaService(); await prisma.onModuleInit();
    for (const table of Object.keys(grants).filter(name => name !== 'proveedores_externos')) {
      assert.equal(Number((await admin.query(`SELECT COUNT(*) AS total FROM ${table}`))[0].total), 0);
    }
    assert.equal(Number((await admin.query('SELECT COUNT(*) AS total FROM proveedores_externos'))[0].total), 1);
    // No user fixtures or imported records. Only official schema/provider seed exist.
    console.log(JSON.stringify({ scope: 'new isolated MySQL 8.4, no local data imported', tlsCipherPresent: true, wrongHostnameRejected: true, untrustedCaRejected: true, runtimeDdlDenied: true, prismaSelect1: true, tables: 11, appliedMigrations: 3, emptyApplicationData: true }));
  } finally { if (prisma) await prisma.onModuleDestroy(); await admin.end(); }
  console.log('PRISMA_CLIENT_CLOSED');
})().catch(error => { console.error(JSON.stringify({ check: 'ISOLATED_PRODUCTION_DB_CHECK_FAILED', stage, code: /^[A-Z_0-9]+$/.test(error.code || '') ? error.code : null, errno: Number.isInteger(error.errno) ? error.errno : null })); process.exitCode = 1; });
