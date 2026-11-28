// stdin operational probe, executed as the existing non-root back container user.
// Reads no user records, sends no cookies, prints no bodies or configuration.
import { request } from 'node:https';
import { readFileSync } from 'node:fs';
const [backFingerprint, frontFingerprint, publicHost, publicCaFile] = process.argv.slice(2);
if (![backFingerprint, frontFingerprint].every(value => /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(value || '')) || !/^[a-z0-9.-]+$/.test(publicHost || '')) throw new Error('INVALID_PROBE_CONFIGURATION');
async function probe(hostname, port, path, status, expectedFingerprint, servername = hostname, ca) {
  await new Promise((resolve, reject) => {
    const req = request({ hostname, port, path, servername, ...(ca ? { ca } : {}), rejectUnauthorized: true, agent: false, headers: { Host: servername } }, res => {
      if (res.statusCode !== status || (expectedFingerprint && res.socket.getPeerCertificate().fingerprint256 !== expectedFingerprint)) { res.destroy(); reject(new Error('TLS_POSTCHECK_FAILED')); return; }
      let bytes = 0;
      res.on('data', chunk => { bytes += chunk.length; if (bytes > 1048576) req.destroy(new Error('PROBE_TOO_LARGE')); });
      res.on('end', resolve); res.on('error', reject);
    });
    req.setTimeout(7000, () => req.destroy(new Error('PROBE_TIMEOUT')));
    req.on('error', reject); req.end();
  });
}
try {
  await probe('back', 3001, '/health/ready', 200, backFingerprint);
  await probe('front', 3000, '/login', 200, frontFingerprint);
  // Public certificate remains independent. This optional CA is ONLY for a local test CA.
  const publicCa = publicCaFile ? readFileSync(publicCaFile) : undefined;
  await probe('gateway', 8443, '/login', 200, null, publicHost, publicCa);
  await probe('gateway', 8443, '/health/ready', 200, null, publicHost, publicCa);
  await probe('gateway', 8443, '/api/auth/me', 401, null, publicHost, publicCa);
  console.log('INTERNAL_TLS_FINGERPRINTS_AND_PROXY_OK');
} catch { console.error('INTERNAL_TLS_POSTCHECK_FAILED'); process.exitCode = 1; }
