"""Linux controller for the EXISTING disposable TLS fixture only.

stdin: resolved private Compose JSON of that fixture, never print it. Socket access
belongs only to this temporary test tool, never to NexoGuard application services.
"""
import copy
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import traceback

ROOT = Path(os.environ['NEXOGUARD_RENEW_TEST_ROOT'])
SOURCE = Path('/source')
PROJECT = 'nexoguard-internal-tls-20261127'


def run(command, **kwargs):
    result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=300, **kwargs)
    if result.returncode:
        raise RuntimeError('FIXTURE_COMMAND_FAILED')
    return result.stdout


def main():
    model = json.load(sys.stdin)
    assert model['name'] == PROJECT and ROOT.name == '_data'
    assert not (ROOT / 'release').exists(), 'Use a new private fixture volume'
    os.umask(0o077)
    release = ROOT / 'release'
    public = release / 'back/docker/ec2'
    public.mkdir(parents=True)
    for name in ('generate-internal-tls.sh', 'renew-internal-tls.py', 'verify-internal-tls.mjs', 'compose.internal-tls.yaml', 'nexoguard-internal-tls.service', 'nexoguard-internal-tls.timer'):
        shutil.copyfile(SOURCE / 'docker/ec2' / name, public / name)
    mirror = ROOT / 'original'
    shutil.copytree('/original', mirror)
    bundles = ROOT / 'bundles'
    bundles.mkdir(mode=0o700)
    initial = bundles / 'internal-web-initial'
    shutil.copytree('/original/internal-web', initial)
    initial.chmod(0o700)
    for name in ('back', 'front'):
        os.chown(initial / f'{name}.key', 1000, 1000)
    config = ROOT / 'config'
    config.mkdir(mode=0o700)
    for name in ('public.env', 'host.env'):
        (config / name).write_text('')
    env_file = config / 'internal-web.env'
    env_file.write_text(f'TLS_RELEASE_TAG=tls-practical-20261127-r2\nINTERNAL_TLS_DIR={initial}\n')
    env_file.chmod(0o600)
    front = release / 'front/docker/ec2'
    front.mkdir(parents=True)
    shutil.copyfile('/frontend/docker/ec2/tls.conf.template', front / 'tls.conf.template')
    # All daemon bind sources must be genuine Linux paths. Do not write into the
    # laptop's files or touch the existing DB container/volume.
    for data in model['services'].values():
        for volume in data.get('volumes', []):
            source = volume.get('source', '')
            if volume.get('type') != 'bind' or not source.lower().startswith('c:/'):
                continue
            if '/nexoguard-internal-tls-20261127/' in source:
                relative = source.split('/nexoguard-internal-tls-20261127/', 1)[1]
                replacement = mirror / relative
                if not replacement.exists():
                    replacement.mkdir(parents=True)
            elif source.endswith('/front/docker/ec2/tls.conf.template'):
                replacement = front / 'tls.conf.template'
            elif '/back/test/' in source:
                relative = source.split('/back/test/', 1)[1]
                replacement = release / 'back/test' / relative
                replacement.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(SOURCE / 'test' / relative, replacement)
            elif source.endswith('/test/target.mjs'):
                replacement = release / 'target.mjs'
                shutil.copyfile('/target-source/target.mjs', replacement)
            else:
                raise RuntimeError('UNEXPECTED_BIND_SOURCE')
            volume['source'] = str(replacement)
    base = release / 'deploy/ec2/compose.production.yaml'
    base.parent.mkdir(parents=True)
    base.write_text(json.dumps(model))  # Private resolved fixture config, root/0600.
    base.chmod(0o600)
    spec = importlib.util.spec_from_file_location('rotation', public / 'renew-internal-tls.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    args = module.arguments(['--release', str(release), '--public-env', str(config / 'public.env'), '--host-env', str(config / 'host.env'), '--tls-env', str(env_file), '--bundles', str(bundles), '--project', PROJECT, '--lock', str(ROOT / 'lock'), '--public-probe-ca', '/run/secrets/ca.pem'])
    operation = module.Rotator(args)
    # First replacement validates reduced runtime dependencies. Only this disposable
    # project's web + transport services; DB is deliberately excluded.
    before_db = operation.dc('ps', '--all', '--quiet', 'db').stdout
    operation.dc('up', '-d', '--no-deps', '--force-recreate', '--pull', 'never', '--wait', '--wait-timeout', '180', 'back', 'front', 'gateway', 'transport')
    assert operation.dc('ps', '--all', '--quiet', 'db').stdout == before_db
    operation.verify(initial)
    baseline = operation.unaffected()
    count_script = b"const {PrismaService}=require('./dist/infrastructure/prisma/prisma.service.js');(async()=>{const p=new PrismaService();try{await p.onModuleInit();console.log(JSON.stringify(await p.$queryRaw`SELECT (SELECT COUNT(*) FROM usuarios) AS users_count,(SELECT COUNT(*) FROM sitios) AS sites_count,(SELECT COUNT(*) FROM analisis) AS analyses_count,(SELECT COUNT(*) FROM resultados_comprobacion) AS results_count`,(_,v)=>typeof v==='bigint'?Number(v):v))}finally{await p.onModuleDestroy()}})().catch(()=>process.exit(1));"
    counts_before = operation.dc('exec', '-T', 'back', 'node', '-', input_bytes=count_script).stdout
    assert operation.run_locked() == 'not_due'
    assert operation.unaffected() == baseline
    # Demonstrate Linux bind inode semantics with a public certificate copy,
    # not with the live server's mounted key/certificate.
    scratch = ROOT / 'bind-behavior'
    scratch.mkdir()
    cert = scratch / 'cert.pem'
    shutil.copyfile(initial / 'back.pem', cert)
    reader = 'nexoguard-internal-cert-bind-probe-20261127'
    run(['docker', 'run', '-d', '--name', reader, '--network', 'none', '--mount', f'type=bind,source={cert},target=/cert.pem,readonly', '--entrypoint', 'node', 'node:24.22.2-bookworm-slim', '-e', 'setInterval(()=>{},1000)'])
    old_bytes = run(['docker', 'exec', reader, 'cat', '/cert.pem'])
    alternate = scratch / 'alternate.pem'
    shutil.copyfile(initial / 'front.pem', alternate)
    os.replace(alternate, cert)  # New inode at same host pathname.
    assert cert.read_bytes() != old_bytes
    assert run(['docker', 'exec', reader, 'cat', '/cert.pem']) == old_bytes
    run(['docker', 'stop', reader])  # Preserve stopped container; no volume/data deletion.
    assert run(['docker', 'run', '--name', reader + '-rebound', '--network', 'none', '--mount', f'type=bind,source={cert},target=/cert.pem,readonly', '--entrypoint', 'cat', 'node:24.22.2-bookworm-slim', '/cert.pem']) == cert.read_bytes()
    args.renew_before = 90 * 86400  # Test-only due threshold; no clock/date alterations.
    before = env_file.read_bytes()
    assert operation.run_locked() == 'renewed'
    assert env_file.read_bytes() != before and operation.unaffected() == baseline
    _, _, renewed = operation.private_metadata()
    operation.verify(renewed)  # New served fingerprints, CA/name and proxy checked.
    assert operation.fingerprint(initial / 'ca.pem') == operation.fingerprint(renewed / 'ca.pem')
    # Inject one postcheck failure in the test object; real recreation + rollback.
    original_verify = operation.verify
    failed = False
    def fail_once(bundle):
        nonlocal failed
        if not failed:
            failed = True
            raise module.RotationError('CONTROLLED_POSTCHECK_FAILURE')
        return original_verify(bundle)
    operation.verify = fail_once
    saved = env_file.read_bytes()
    try:
        operation.run_locked()
        raise AssertionError('Expected postcheck failure')
    except module.RotationError as error:
        assert str(error) == 'POSTCHECK_FAILED_PREVIOUS_BUNDLE_RESTORED'
    operation.verify = original_verify
    assert env_file.read_bytes() == saved and not operation.pending.exists()
    operation.verify(renewed)
    # Simulate an abrupt process stop after activation, without rollback code.
    class PowerLoss(BaseException):
        pass
    operation.verify = lambda bundle: (_ for _ in ()).throw(PowerLoss())
    try:
        operation.run_locked()
    except PowerLoss:
        pass
    assert operation.pending.exists() and env_file.read_bytes() != saved
    restarted = module.Rotator(copy.copy(args))
    assert restarted.run_locked() == 'recovered'
    assert env_file.read_bytes() == saved and not restarted.pending.exists()
    assert restarted.unaffected() == baseline
    assert restarted.dc('exec', '-T', 'back', 'node', '-', input_bytes=count_script).stdout == counts_before
    # Validate unit syntax/calendar, not a running EC2 timer.
    units = ROOT / 'units'
    units.mkdir()
    for name in ('docker.service', 'nexoguard.service'):
        (units / name).write_text('[Service]\nType=oneshot\nExecStart=/bin/true\n')
    for name in ('nexoguard-internal-tls.service', 'nexoguard-internal-tls.timer'):
        shutil.copyfile(public / name, units / name)
    env = {**os.environ, 'SYSTEMD_UNIT_PATH': str(units) + ':/lib/systemd/system'}
    run(['systemd-analyze', 'verify', '--man=no', str(units / 'nexoguard-internal-tls.service'), str(units / 'nexoguard-internal-tls.timer')], env=env)
    result = dict(scope='real local Docker TLS rotation; no EC2; fault injection explicitly controlled', notDueSkipped=True, newServedFingerprints=True, sameCa=True, bindAtomicReplacementKeptOldInode=True, recreatedMountReadNewCertificate=True, postcheckRollback=True, interruptedRunRecovered=True, mysqlAndTransportNotRestartedDuringRotations=True, recordCountsUnchanged=True, systemdUnitsVerified=True, publicRequests=0)
    (ROOT / 'result.json').write_text(json.dumps(result))
    print(json.dumps(result))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # Do not dump private rendered Compose config or raw command output.
        frames = [{'function': item.name, 'line': item.lineno} for item in traceback.extract_tb(sys.exc_info()[2])]
        print('ISOLATED_ROTATION_TEST_FAILED ' + json.dumps(frames), flush=True)
        raise SystemExit(1) from None
