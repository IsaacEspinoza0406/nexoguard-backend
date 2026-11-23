#!/bin/sh
set -eu
: "${NEXOGUARD_MYSQL_CA_FILE:?CA required}" "${NEXOGUARD_MYSQL_CERT_FILE:?certificate required}" "${NEXOGUARD_MYSQL_KEY_FILE:?private key required}"
# Mounted private files can belong to root. Copy into an ephemeral mysql-owned
# directory, rather than relaxing the permissions of the source private key.
install -d -m 700 -o mysql -g mysql /run/nexoguard-mysql-tls
install -m 644 -o mysql -g mysql "$NEXOGUARD_MYSQL_CA_FILE" /run/nexoguard-mysql-tls/ca.pem
install -m 644 -o mysql -g mysql "$NEXOGUARD_MYSQL_CERT_FILE" /run/nexoguard-mysql-tls/server.pem
install -m 600 -o mysql -g mysql "$NEXOGUARD_MYSQL_KEY_FILE" /run/nexoguard-mysql-tls/server-key.pem
if [ -n "${NEXOGUARD_MYSQL_INIT_FILE:-}" ]; then
  # Official initialization runs as mysql, which cannot read a root-only bind.
  # This directory is tmpfs in the EC2 topology; never loosen the source file.
  install -m 400 -o mysql -g mysql "$NEXOGUARD_MYSQL_INIT_FILE" /docker-entrypoint-initdb.d/20-users.sql
fi
exec /usr/local/bin/docker-entrypoint.sh mysqld --require-secure-transport=ON --ssl-ca=/run/nexoguard-mysql-tls/ca.pem --ssl-cert=/run/nexoguard-mysql-tls/server.pem --ssl-key=/run/nexoguard-mysql-tls/server-key.pem "$@"
