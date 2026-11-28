// Only for the isolated TLS fixture while its gateway has a deliberately wrong CA/name.
import assert from 'node:assert/strict';
import { request } from 'node:https';
import { readFileSync } from 'node:fs';
const ca = readFileSync('/run/secrets/ca.pem');
for (const path of ['/login', '/health/ready']) {
  const status = await new Promise((resolve, reject) => {
    const req = request({ hostname: 'gateway', port: 8443, servername: process.env.PUBLIC_HOST, ca, path, headers: { Host: process.env.PUBLIC_HOST } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.setTimeout(10000, () => req.destroy(new Error('TIMEOUT')));
    req.on('error', reject); req.end();
  });
  assert.equal(status, 502, 'Gateway must reject the invalid upstream identity/trust');
}
console.log('NGINX_REJECTED_INVALID_UPSTREAM_FRONT_AND_BACK');
