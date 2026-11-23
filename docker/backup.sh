#!/bin/bash
set -euo pipefail
umask 077
trap 'echo BACKUP_OPERATION_FAILED >&2' ERR
mode=${1:?backup, restore or manifest required}
file=${2:-}
mkdir -p /tmp/gnupg
chmod 700 /tmp/gnupg
export GNUPGHOME=/tmp/gnupg
gpg_common=(--batch --yes --pinentry-mode loopback --passphrase-file /run/secrets/backup-passphrase)
case "$mode" in
  backup|restore)
    [[ "$file" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*\.sql\.gpg$ ]] && [[ "$file" != *..* ]]
    ;;
esac
case "$mode" in
  backup)
    set -o noclobber
    mysqldump --defaults-extra-file=/run/secrets/backup.cnf --single-transaction --skip-lock-tables --skip-add-locks --no-tablespaces --set-gtid-purged=OFF nexoguard 2>/tmp/dump-error |
      gpg "${gpg_common[@]}" --symmetric --cipher-algo AES256 2>/tmp/gpg-error > "/backups/$file"
    sha256sum "/backups/$file" > "/backups/$file.sha256"
    echo ENCRYPTED_BACKUP_CREATED
    ;;
  restore)
    [[ "${NEXOGUARD_RESTORE_APPROVED:-no}" == yes ]]
    [[ $(mysql --defaults-extra-file=/run/secrets/restore.cnf --host=restore-db -Nse "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='nexoguard'" 2>/tmp/mysql-error) == 0 ]]
    # Authenticate the complete ciphertext BEFORE sending any SQL to the empty target.
    gpg "${gpg_common[@]}" --decrypt "/backups/$file" >/dev/null 2>/tmp/gpg-check-error
    gpg "${gpg_common[@]}" --decrypt "/backups/$file" 2>/tmp/gpg-error |
      mysql --defaults-extra-file=/run/secrets/restore.cnf --host=restore-db nexoguard 2>/tmp/mysql-error
    echo ISOLATED_RESTORE_COMPLETED
    ;;
  manifest)
    client=/run/secrets/backup.cnf
    if [[ "${NEXOGUARD_MANIFEST_TARGET:-source}" == restored ]]; then client=/run/secrets/restore.cnf; fi
    mysql --defaults-extra-file="$client" --batch --skip-column-names nexoguard < /usr/local/share/nexoguard-manifest.sql 2>/tmp/mysql-error
    ;;
  *) exit 1 ;;
esac
