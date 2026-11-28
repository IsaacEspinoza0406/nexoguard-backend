// In the production image, also used for the transport dependency directory.
(async () => {
const { default: assert } = await import('node:assert/strict');
const { createRequire } = await import('node:module');
const load = createRequire('/app/package.json');
for (const pkg of ['prisma', '@prisma/config', 'effect', 'typescript', 'jest']) {
  assert.throws(() => load.resolve(pkg), error => error.code === 'MODULE_NOT_FOUND');
}
load('reflect-metadata');
load('/app/dist/app.module.js');
load('/app/dist/infrastructure/prisma/prisma.service.js');
load('@prisma/adapter-mariadb');
const argon2 = load('argon2');
  const hash = await argon2.hash('fictional-runtime-check-only', { type: argon2.argon2id });
  assert.equal(await argon2.verify(hash, 'fictional-runtime-check-only'), true);
  console.log('RUNTIME_IMPORTS_AND_ARGON2ID_OK_TOOLCHAIN_ABSENT');
})().catch(() => { console.error('RUNTIME_DEPENDENCY_CHECK_FAILED'); process.exitCode = 1; });
