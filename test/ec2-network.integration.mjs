import assert from 'node:assert/strict';
import net from 'node:net';
import fs from 'node:fs';
import { lookup } from 'node:dns/promises';
async function reachable(host, port) {
  return new Promise(resolve => {
    const socket = net.connect({ host, port });
    const finish = value => { clearTimeout(timer); socket.destroy(); resolve(value); };
    const timer = setTimeout(() => finish(false), 1500);
    socket.once('connect', () => finish(true)); socket.once('error', () => finish(false));
  });
}
try {
  assert.equal(process.getuid(), 1000);
  const status = fs.readFileSync('/proc/self/status', 'utf8');
  assert.match(status, /CapEff:\s+0000000000000000/); assert.match(status, /NoNewPrivs:\s+1/);
  assert.equal((await lookup('public-peer')).address, '93.184.217.10');
  const results = {
    privateDatabaseDenied: !await reachable('10.254.244.10', 3306),
    privateHttpDenied: !await reachable('10.254.244.10', 80),
    metadataDenied: !await reachable('169.254.169.254', 80),
    hostPublicIpDenied: !await reachable('93.184.217.20', 80),
    loopbackDenied: !await reachable('127.0.0.1', 3002),
    ipv6LoopbackDenied: !await reachable('::1', 3002),
    simulatedPublicHttpAllowed: await reachable('93.184.217.10', 80),
    nonHttpDenied: !await reachable('93.184.217.10', 3306),
  };
  for (const value of Object.values(results)) assert.equal(value, true);
  console.log(JSON.stringify({ scope: 'isolated Docker, controlled peers, no Internet', uid: 1000, zeroCapabilities: true, controlledDns: true, ...results }));
} catch { console.error('EC2_NETWORK_CHECK_FAILED'); process.exitCode = 1; }
