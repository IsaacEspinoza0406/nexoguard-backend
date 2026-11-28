#!/usr/bin/python3
"""Root-only internal web certificate rotation. No application/DB credentials in logs.

New immutable bind sources + forced recreation of web services; never overwrite mounted
certificates. A durable journal restores the previous pointer after an interrupted run.
"""
import argparse
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import uuid


class RotationError(Exception):
    pass


def atomic_write(path, data):
    path = Path(path)
    tmp = path.with_name(path.name + '.new-' + uuid.uuid4().hex)
    with open(tmp, 'xb') as stream:
        os.chmod(tmp, 0o600)
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(tmp, path)
    directory = os.open(path.parent, os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def metadata(raw):
    result = {}
    for line in raw.decode('utf-8').splitlines():
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        key, separator, value = line.partition('=')
        if not separator or key not in ('TLS_RELEASE_TAG', 'INTERNAL_TLS_DIR') or key in result:
            raise RotationError('INVALID_TLS_METADATA')
        result[key] = value
    if set(result) != {'TLS_RELEASE_TAG', 'INTERNAL_TLS_DIR'} or not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}', result['TLS_RELEASE_TAG']):
        raise RotationError('INVALID_TLS_METADATA')
    return result


class Rotator:
    web = ('back', 'front', 'gateway')

    def __init__(self, args):
        self.args = args
        self.release = Path(args.release).resolve(strict=True)
        self.env_file = Path(args.tls_env)
        self.bundles = Path(args.bundles).resolve(strict=True)
        self.state = self.env_file.parent / 'internal-web-rotations'
        self.state.mkdir(mode=0o700, exist_ok=True)
        self.pending = self.state / 'pending.json'
        self.result = self.state / 'last-result.json'
        self.child_env = {key: value for key, value in os.environ.items() if key in ('PATH', 'HOME', 'LANG', 'DOCKER_HOST', 'DOCKER_CONFIG', 'DOCKER_CERT_PATH', 'DOCKER_TLS_VERIFY')}

    def run_command(self, command, *, input_bytes=None, timeout=240, allowed=(0,)):
        try:
            result = subprocess.run(command, input=input_bytes, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=self.child_env, timeout=timeout, check=False)
        except (OSError, subprocess.TimeoutExpired):
            raise RotationError('OPERATION_FAILED') from None
        if result.returncode not in allowed:
            # CLI output can include private env paths/config: never echo it.
            raise RotationError('OPERATION_FAILED')
        return result

    def dc(self, *arguments, **kwargs):
        return self.run_command([
            'docker', 'compose', '--env-file', self.args.public_env,
            '--env-file', self.args.host_env, '--env-file', str(self.env_file),
            '-f', str(self.release / 'deploy/ec2/compose.production.yaml'),
            '-f', str(self.release / 'back/docker/ec2/compose.internal-tls.yaml'),
            *arguments,
        ], **kwargs)

    def private_metadata(self):
        info = self.env_file.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o600:
            raise RotationError('PRIVATE_ENV_PERMISSIONS_REQUIRED')
        raw = self.env_file.read_bytes()
        config = metadata(raw)
        bundle = Path(config['INTERNAL_TLS_DIR'])
        if not bundle.is_absolute() or bundle.is_symlink() or bundle.resolve().parent != self.bundles:
            raise RotationError('INVALID_BUNDLE_DESTINATION')
        return raw, config, bundle

    def fingerprint(self, path):
        out = self.run_command(['openssl', 'x509', '-in', str(path), '-noout', '-sha256', '-fingerprint']).stdout.decode().strip().split('=')[-1]
        if not re.fullmatch(r'(?:[0-9A-F]{2}:){31}[0-9A-F]{2}', out):
            raise RotationError('INVALID_CERTIFICATE')
        return out

    def validate(self, bundle, *, new=False):
        directory = bundle.stat()
        if directory.st_uid != 0 or stat.S_IMODE(directory.st_mode) != 0o700:
            raise RotationError('PRIVATE_BUNDLE_PERMISSIONS_REQUIRED')
        ca_info = (bundle / 'ca.key').lstat()
        if not stat.S_ISREG(ca_info.st_mode) or ca_info.st_uid != 0 or stat.S_IMODE(ca_info.st_mode) != 0o600:
            raise RotationError('CA_KEY_PERMISSIONS_REQUIRED')
        # Stop before the CA would be unable to issue the next complete 90-day leaf.
        self.run_command(['openssl', 'x509', '-in', str(bundle / 'ca.pem'), '-checkend', str(92 * 86400), '-noout'])
        for name in ('ca', 'back', 'front'):
            cert = bundle / f'{name}.pem'
            key = bundle / f'{name}.key'
            if cert.is_symlink() or key.is_symlink():
                raise RotationError('BUNDLE_SYMLINK_NOT_ALLOWED')
            if name != 'ca':
                info = key.stat()
                if info.st_uid != 1000 or stat.S_IMODE(info.st_mode) != 0o400:
                    raise RotationError('SERVICE_KEY_PERMISSIONS_REQUIRED')
                command = ['openssl', 'verify', '-purpose', 'sslserver', '-verify_hostname', name, '-CAfile', str(bundle / 'ca.pem')]
                if not new:
                    command += ['-no_check_time']  # May renew a leaf that already expired; never disables a client check.
                self.run_command(command + [str(cert)])
                if new:
                    self.run_command(['openssl', 'x509', '-in', str(cert), '-checkend', str(31 * 86400), '-noout'])
            public_cert = self.run_command(['openssl', 'x509', '-in', str(cert), '-pubkey', '-noout']).stdout
            public_key = self.run_command(['openssl', 'pkey', '-in', str(key), '-pubout']).stdout
            if public_cert != public_key:
                raise RotationError('CERTIFICATE_KEY_MISMATCH')

    def model(self):
        model = json.loads(self.dc('config', '--format', 'json').stdout)
        if model.get('name') != self.args.project:
            raise RotationError('WRONG_COMPOSE_PROJECT')
        _, _, bundle = self.private_metadata()
        for service in self.web:
            data = model['services'][service]
            required = {'/run/internal-tls/ca.pem'}
            if service != 'gateway':
                required.update((f'/run/internal-tls/{service}.pem', f'/run/internal-tls/{service}.key'))
            seen = set()
            for mount in data.get('volumes', []):
                if mount['target'].startswith('/run/internal-tls/'):
                    seen.add(mount['target'])
                    if Path(mount['source']) != bundle / Path(mount['target']).name or not mount.get('read_only') or mount['target'] not in required:
                        raise RotationError('INVALID_TLS_BIND')
                if Path(mount.get('source', '')) == bundle / 'ca.key':
                    raise RotationError('CA_KEY_MOUNT_NOT_ALLOWED')
            if seen != required:
                raise RotationError('MISSING_TLS_BIND')
            if service != 'gateway' and not data['environment'].get('NODE_EXTRA_CA_CERTS'):
                raise RotationError('INTERNAL_CA_REQUIRED')
        if model['services']['front']['environment'].get('API_INTERNAL_URL') != 'https://back:3001':
            raise RotationError('INTERNAL_HTTPS_REQUIRED')
        return model

    def unaffected(self):
        snapshots = []
        for service in ('db', 'transport'):
            ids = self.dc('ps', '--all', '--quiet', service).stdout.decode().split()
            if len(ids) != 1:
                raise RotationError('UNEXPECTED_UNAFFECTED_SERVICE')
            data = json.loads(self.run_command(['docker', 'inspect', '--format', '{{json .State}}', ids[0]]).stdout)
            if not data.get('Running'):
                raise RotationError('UNAVAILABLE_UNAFFECTED_SERVICE')
            if data.get('Health', {}).get('Status') != 'healthy':
                raise RotationError('UNHEALTHY_UNAFFECTED_SERVICE')
            snapshots.append([ids[0], data['StartedAt']])
        return snapshots

    def recreate(self):
        self.dc('up', '-d', '--no-deps', '--force-recreate', '--pull', 'never', '--wait', '--wait-timeout', '180', *self.web, timeout=240)

    def verify(self, bundle):
        self.dc('exec', '-T', 'gateway', 'nginx', '-t', '-c', '/tmp/nexoguard-nginx.conf')
        model = self.model()
        host = model['services']['gateway']['environment']['PUBLIC_HOST']
        script = (self.release / 'back/docker/ec2/verify-internal-tls.mjs').read_bytes()
        self.dc('exec', '-T', 'back', 'node', '--input-type=module', '-', self.fingerprint(bundle / 'back.pem'), self.fingerprint(bundle / 'front.pem'), host,
                *([self.args.public_probe_ca] if self.args.public_probe_ca else []), input_bytes=script, timeout=60)

    def archive(self, journal, outcome):
        record = self.state / journal['id']
        record.mkdir(mode=0o700, exist_ok=True)
        journal['outcome'] = outcome
        atomic_write(self.pending, json.dumps(journal).encode())
        os.replace(self.pending, record / f'{outcome}.json')
        for folder in (record, self.state):
            descriptor = os.open(folder, os.O_DIRECTORY)
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
        atomic_write(self.result, json.dumps({'outcome': outcome, 'at': datetime.datetime.now(datetime.timezone.utc).isoformat()}).encode())
        print('INTERNAL_TLS_' + outcome.upper(), flush=True)

    def recover(self, journal):
        if journal['release'] != str(self.release) or journal['project'] != self.args.project or journal['configuration'] != self.configuration_fingerprint():
            raise RotationError('RECOVERY_REQUIRES_MANUAL_REVIEW')
        baseline = self.unaffected()  # Reboot may legitimately have changed IDs since the interrupted run.
        atomic_write(self.env_file, journal['previous_env'].encode())
        _, _, previous = self.private_metadata()
        self.recreate()
        self.verify(previous)
        if self.unaffected() != baseline:
            raise RotationError('UNAFFECTED_SERVICE_CHANGED')
        self.archive(journal, 'recovered')

    def configuration_fingerprint(self):
        digest = hashlib.sha256()
        for path in (Path(self.args.public_env), self.release / 'deploy/ec2/compose.production.yaml', self.release / 'back/docker/ec2/compose.internal-tls.yaml'):
            digest.update(path.read_bytes())
        return digest.hexdigest()

    def run_locked(self):
        if self.pending.exists():
            self.recover(json.loads(self.pending.read_bytes()))
            return 'recovered'
        previous_raw, _, previous = self.private_metadata()
        self.validate(previous)
        self.model()
        baseline = self.unaffected()
        due = any(self.run_command(['openssl', 'x509', '-in', str(previous / f'{name}.pem'), '-checkend', str(self.args.renew_before), '-noout'], allowed=(0, 1)).returncode != 0 for name in ('back', 'front'))
        if not due:
            print('INTERNAL_TLS_NOT_DUE', flush=True)
            return 'not_due'
        identifier = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex[:8]
        target = self.bundles / ('internal-web-' + identifier)
        self.run_command(['sh', str(self.release / 'back/docker/ec2/generate-internal-tls.sh'), str(target), str(previous)])
        self.validate(target, new=True)
        if self.fingerprint(target / 'ca.pem') != self.fingerprint(previous / 'ca.pem'):
            raise RotationError('UNEXPECTED_CA_ROTATION')
        journal = {'id': identifier, 'release': str(self.release), 'project': self.args.project, 'configuration': self.configuration_fingerprint(), 'previous_env': previous_raw.decode(), 'next_bundle': str(target)}
        atomic_write(self.pending, json.dumps(journal).encode())
        try:
            raw = re.sub(rb'(?m)^INTERNAL_TLS_DIR=.*$', ('INTERNAL_TLS_DIR=' + str(target)).encode(), previous_raw)
            atomic_write(self.env_file, raw)
            self.model()
            self.recreate()
            self.verify(target)
            if self.unaffected() != baseline:
                raise RotationError('UNAFFECTED_SERVICE_CHANGED')
            self.archive(journal, 'renewed')
            return 'renewed'
        except Exception:
            # Preserve all bundles; restore only metadata and recreate the three web processes.
            try:
                self.recover(journal)
            except Exception:
                raise RotationError('ROLLBACK_PENDING_MANUAL_REVIEW') from None
            raise RotationError('POSTCHECK_FAILED_PREVIOUS_BUNDLE_RESTORED') from None


def arguments(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release', default='/opt/nexoguard/current')
    parser.add_argument('--public-env', default='/etc/nexoguard/public.env')
    parser.add_argument('--host-env', default='/run/nexoguard-host.env')
    parser.add_argument('--tls-env', default='/etc/nexoguard/internal-web.env')
    parser.add_argument('--bundles', default='/etc/nexoguard')
    parser.add_argument('--project', default='nexoguard-production')
    parser.add_argument('--lock', default='/run/lock/nexoguard-internal-tls.lock')
    parser.add_argument('--renew-before', type=int, default=30 * 86400)
    parser.add_argument('--public-probe-ca', default='', help='Only for an isolated test with a non-public CA; normal public trust remains the production default.')
    args = parser.parse_args(argv)
    if not 1 <= args.renew_before <= 90 * 86400:
        parser.error('renew-before must be between 1 second and 90 days')
    return args


def main():
    if os.geteuid() != 0:
        raise RotationError('ROOT_REQUIRED')
    os.umask(0o077)
    args = arguments()
    with open(args.lock, 'a', encoding='utf-8') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print('INTERNAL_TLS_ALREADY_RUNNING')
            return
        Rotator(args).run_locked()


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # No raw subprocess output, env, PEMs or exception paths in journald.
        reason = str(error) if isinstance(error, RotationError) else 'OPERATION_FAILED'
        print('INTERNAL_TLS_FAILED: ' + reason, flush=True)
        raise SystemExit(1) from None
