"""Windows/Linux host launcher. All private fixture configuration travels via stdin.
Run from the NexoGuard root. Never use against a different project/real database.
"""
import json
from pathlib import Path
import subprocess

root = Path.cwd()
dc = ['docker', 'compose', '--env-file', 'bd/internal-tls-validation-20261127/fixture.env', '-f', 'deploy/ec2/compose.production.yaml', '-f', 'back/docker/ec2/compose.internal-tls.yaml', '-f', 'deploy/ec2/test/compose.internal-tls.local.yaml']
result = subprocess.run(dc + ['config', '--format', 'json'], stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
if result.returncode:
    raise SystemExit('FIXTURE_CONFIG_UNAVAILABLE')
model = json.loads(result.stdout)
if model['name'] != 'nexoguard-internal-tls-20261127':
    raise SystemExit('WRONG_FIXTURE_PROJECT')
volume = 'nexoguard-internal-tls-renewal-20261127-r2'
existing = subprocess.run(['docker', 'volume', 'inspect', volume], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
if existing.returncode == 0:
    raise SystemExit('TEST_VOLUME_EXISTS_USE_REVIEWED_NEW_NAME; nothing overwritten')
subprocess.run(['docker', 'volume', 'create', volume], stdout=subprocess.DEVNULL, check=True)
path = subprocess.check_output(['docker', 'volume', 'inspect', volume, '--format', '{{.Mountpoint}}'], text=True).strip()
command = ['docker', 'run', '--name', 'nexoguard-internal-tls-renewal-controller-20261127-r2', '--network', 'none',
           '--mount', f'type=volume,source={volume},target={path}',
           '--mount', 'type=volume,source=nexoguard-internal-tls-20261127-private,target=/original,readonly',
           '--mount', f'type=bind,source={root / "back"},target=/source,readonly',
           '--mount', f'type=bind,source={root / "front"},target=/frontend,readonly',
           '--mount', f'type=bind,source={root / "deploy/ec2/test"},target=/target-source,readonly',
           '--mount', 'type=bind,source=/var/run/docker.sock,target=/var/run/docker.sock',
           '--env', f'NEXOGUARD_RENEW_TEST_ROOT={path}', '-i', 'nexoguard-tls-operations:20261127', '/source/test/internal-tls-renewal.integration.py']
exit_code = subprocess.run(command, input=result.stdout, check=False).returncode
raise SystemExit(exit_code)
