import assert from 'node:assert/strict';
import net from 'node:net';
import fs from 'node:fs';

async function reachable(host, port) {
  return new Promise(resolve => {
    const socket = net.connect({ host, port });
    const timer = setTimeout(() => { socket.destroy(); resolve(false); }, 1200);
    socket.once('connect', () => { clearTimeout(timer); socket.destroy(); resolve(true); });
    socket.once('error', () => { clearTimeout(timer); resolve(false); });
  });
}
(async () => {
  // Run as the same unprivileged UID as transport Node, never as container root.
  assert.equal(process.getuid(), 1000);
  const status = fs.readFileSync('/proc/self/status', 'utf8');
  assert.match(status, /CapEff:\s+0000000000000000/);
  assert.match(status, /NoNewPrivs:\s+1/);
  const addresses = await Promise.race([(await import('node:dns/promises')).lookup('public-sentinel', { all: true }), new Promise((_, reject) => setTimeout(() => reject(new Error('DNS_TIMEOUT')), 2500))]);
  assert.ok(addresses.some(item => item.address === '93.184.215.10'));
  const results = {
    privateDatabaseDenied: !(await reachable('10.254.243.10', 3306)),
    privateHttpDenied: !(await reachable('10.254.243.10', 80)),
    metadataDenied: !(await reachable('169.254.169.254', 80)),
    localLoopbackDenied: !(await reachable('127.0.0.1', 3002)),
    simulatedPublicHttpAllowed: await reachable('93.184.215.10', 80),
    publicNonHttpDenied: !(await reachable('93.184.215.10', 3306)),
    ipv6LoopbackDenied: !(await reachable('::1', 3002)),
  };
  for (const [name, passed] of Object.entries(results)) assert.equal(passed, true, name);
  console.log(JSON.stringify({ scope: 'Docker isolated network, controlled TCP sentinels, not public scans', uid: 1000, capabilities: 'none', controlledDnsResolver: true, ...results }));
})().catch(() => { console.error('TRANSPORT_NETWORK_CHECK_FAILED'); process.exitCode = 1; });
