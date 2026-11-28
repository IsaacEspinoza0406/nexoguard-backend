// Bounded regression for the patched tool-only dependency. No database/network.
(async () => {
const { default: assert } = await import('node:assert/strict');
const { performance } = await import('node:perf_hooks');
const { createRequire } = await import('node:module');
const load = createRequire(process.cwd() + '/package.json');
assert.equal(load('prisma/package.json').version, '7.10.1');
assert.equal(load('@prisma/config/package.json').version, '7.10.1');
assert.equal(load('effect/package.json').version, '3.22.1');
const S = load('effect/Schema');
const schema = S.TemplateLiteral(S.String, ':', S.String, ':', S.String, 'END');
const started = performance.now();
assert.equal(S.is(schema)(':'.repeat(20000)), false);
assert.equal(S.is(schema)('a:b:cEND'), true);
load('prisma/config');
console.log(JSON.stringify({ prisma: '7.10.1', effect: '3.22.1', malformedRejected: true, validAccepted: true, elapsedMs: Math.round(performance.now() - started), toolConfigLoaded: true }));
})().catch(() => { console.error('TOOLCHAIN_CHECK_FAILED'); process.exitCode = 1; });
