#!/bin/sh
# Run as root on Linux. Output is PRIVATE and must be outside the source checkout.
# Usage: sh generate-internal-tls.sh NEW_DIRECTORY [EXISTING_CA_DIRECTORY]
# A new directory is required on every renewal; existing bundles are never overwritten.
set -eu
umask 077
test "$(id -u)" = 0 || { echo 'Run as root' >&2; exit 1; }
dest=${1:?new absolute private directory required}
case "$dest" in /*) ;; *) echo 'Absolute private path required' >&2; exit 1 ;; esac
test ! -e "$dest" || { echo 'Destination exists; refusing overwrite' >&2; exit 1; }
if test "$#" -gt 1; then
  test -r "$2/ca.pem" && test -r "$2/ca.key"
  openssl x509 -in "$2/ca.pem" -checkend 7948800 -noout >/dev/null
fi
mkdir -m 700 "$dest"
# Isolate OpenSSL from machine-specific configuration.
printf '[req]\ndistinguished_name=dn\n[dn]\n' > "$dest/openssl.cnf"
export OPENSSL_CONF="$dest/openssl.cnf"
if test "$#" -gt 1; then
  cp "$2/ca.pem" "$dest/ca.pem"
  cp "$2/ca.key" "$dest/ca.key"
else
  openssl req -x509 -newkey rsa:3072 -nodes -days 730 -sha256 \
    -subj '/CN=NexoGuard internal web CA' -addext 'basicConstraints=critical,CA:TRUE,pathlen:0' \
    -addext 'keyUsage=critical,keyCertSign,cRLSign' \
    -keyout "$dest/ca.key" -out "$dest/ca.pem" 2>/dev/null
fi
for name in back front; do
  openssl req -new -newkey rsa:2048 -nodes -sha256 -subj "/CN=$name" \
    -keyout "$dest/$name.key" -out "$dest/$name.csr" 2>/dev/null
  printf 'subjectAltName=DNS:%s\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n' "$name" > "$dest/$name.ext"
  openssl x509 -req -in "$dest/$name.csr" -CA "$dest/ca.pem" -CAkey "$dest/ca.key" \
    -set_serial "0x$(openssl rand -hex 16)" -days 90 -sha256 -extfile "$dest/$name.ext" -out "$dest/$name.pem" 2>/dev/null
  openssl verify -CAfile "$dest/ca.pem" -verify_hostname "$name" "$dest/$name.pem" >/dev/null
  # Host directory remains root-only; individual Docker binds are readable by UID 1000.
  chown 1000:1000 "$dest/$name.key"
  chmod 400 "$dest/$name.key"
  chmod 444 "$dest/$name.pem"
done
chmod 444 "$dest/ca.pem"
chmod 600 "$dest/ca.key"
echo 'Internal web certificates generated and names verified (90 days); no values printed.'
