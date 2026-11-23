// DDL NEGATIVE TEST: invoke ONLY inside the isolated fixture, never production.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire('/app/package.json');
const { PrismaService } = require('/app/dist/infrastructure/prisma/prisma.service.js');
let prisma;
try {
  assert.equal(process.env.NEXOGUARD_EC2_ISOLATED_VALIDATION, 'yes');
  prisma = new PrismaService(); await prisma.onModuleInit();
  const users = await prisma.usuario.findMany({ select: { correoNormalizado: true, passwordHash: true } });
  assert.equal(users.length, Number(process.env.EXPECTED_USERS));
  assert.ok(users.every(u => u.correoNormalizado.startsWith('nexoguard-ec2-') && u.correoNormalizado.endsWith('@example.invalid')));
  assert.ok(users.every(u => u.passwordHash.startsWith('$argon2id$')));
  assert.equal(await prisma.sitio.count(), Number(process.env.EXPECTED_SITES));
  const tls = await prisma.$queryRawUnsafe("SHOW SESSION STATUS LIKE 'Ssl_cipher'");
  assert.ok(tls[0]?.Value);
  await assert.rejects(prisma.$executeRawUnsafe('CREATE TABLE ec2_runtime_ddl_probe (id INT)'), error => String(error?.meta?.driverAdapterError?.cause?.originalCode ?? error?.meta?.code ?? JSON.stringify(error)).includes('1142'));
  console.log(JSON.stringify({ scope: 'isolated new EC2 fixture only', persistedUsers: users.length, persistedSites: Number(process.env.EXPECTED_SITES), onlyFictionalUsers: true, allHashesArgon2id: true, databaseTls: true, runtimeDdlDenied1142: true }));
} catch { console.error('EC2_RUNTIME_CHECK_FAILED'); process.exitCode = 1; }
finally { if (prisma) await prisma.onModuleDestroy(); }
