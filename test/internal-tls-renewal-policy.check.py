"""Additional bounded checks against the completed private Linux fixture.
No renewed certificates are activated and no services are recreated by this file.
"""
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess

root = Path(os.environ['NEXOGUARD_RENEW_TEST_ROOT'])
release = root / 'release'
source = Path('/source/docker/ec2')
spec = importlib.util.spec_from_file_location('rotation', source / 'renew-internal-tls.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
cli = ['--release', str(release), '--public-env', str(root / 'config/public.env'), '--host-env', str(root / 'config/host.env'), '--tls-env', str(root / 'config/internal-web.env'), '--bundles', str(root / 'bundles'), '--project', 'nexoguard-internal-tls-20261127', '--lock', str(root / 'policy.lock'), '--public-probe-ca', '/run/secrets/ca.pem']
operation = module.Rotator(module.arguments(cli))
baseline = operation.unaffected()
saved = operation.env_file.read_bytes()
_, _, active = operation.private_metadata()
invalid = root / 'bundles/invalid-never-activated'
shutil.copytree(active, invalid)
for name in ('back', 'front'):
    os.chown(invalid / f'{name}.key', 1000, 1000)
shutil.copyfile(invalid / 'front.pem', invalid / 'back.pem')
try:
    operation.validate(invalid, new=True)
    raise AssertionError('Invalid server identity must fail before activation')
except module.RotationError:
    pass
(invalid / 'ca.key').chmod(0o640)
try:
    operation.validate(invalid, new=True)
    raise AssertionError('CA key permissions must be private')
except module.RotationError as error:
    assert str(error) == 'CA_KEY_PERMISSIONS_REQUIRED'
with open(root / 'policy.lock', 'a') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    result = subprocess.run(['python3', str(source / 'renew-internal-tls.py'), *cli], capture_output=True, timeout=15, check=True)
    assert result.stdout.strip() == b'INTERNAL_TLS_ALREADY_RUNNING'
assert operation.env_file.read_bytes() == saved and operation.unaffected() == baseline
units = root / 'units-final'
units.mkdir()
for name in ('docker.service', 'nexoguard.service'):
    (units / name).write_text('[Service]\nType=oneshot\nExecStart=/bin/true\n')
for name in ('nexoguard-internal-tls.service', 'nexoguard-internal-tls.timer'):
    shutil.copyfile(source / name, units / name)
env = {**os.environ, 'SYSTEMD_UNIT_PATH': str(units) + ':/lib/systemd/system'}
subprocess.run(['systemd-analyze', 'verify', '--man=no', str(units / 'nexoguard-internal-tls.service'), str(units / 'nexoguard-internal-tls.timer')], env=env, check=True, capture_output=True)
report = dict(invalidCertificateRejectedBeforeActivation=True, caKeyPermissionsChecked=True, concurrentInvocationSkipped=True, serviceIdsUnchanged=True, finalSystemdUnitsVerified=True)
(root / 'policy-result.json').write_text(json.dumps(report))
print(json.dumps(report))
