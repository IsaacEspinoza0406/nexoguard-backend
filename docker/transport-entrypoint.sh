#!/bin/sh
set -eu
# Fail closed: lack of NET_ADMIN or IPv6 firewall support must prevent startup.
# This is a namespace firewall, not an application-only URL filter.
iptables -P OUTPUT DROP
iptables -P INPUT DROP
iptables -P FORWARD DROP
ip6tables -P OUTPUT DROP
ip6tables -P INPUT DROP
ip6tables -P FORWARD DROP
iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
ip6tables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
ip6tables -A OUTPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
# Inbound RPC only. Bearer authentication remains mandatory in the server.
iptables -A INPUT -p tcp --dport "${PORT:-3002}" -j ACCEPT
ip6tables -A INPUT -p tcp --dport "${PORT:-3002}" -j ACCEPT
# Only the container's configured resolver is allowed, and only DNS ports.
resolver=$(awk '/^nameserver / { print $2; exit }' /etc/resolv.conf)
case "$resolver" in
  *:*) for protocol in udp tcp; do
    ip6tables -A OUTPUT -p "$protocol" -m conntrack --ctorigdst "$resolver" --ctorigdstport 53 -j ACCEPT
    ip6tables -A INPUT -p "$protocol" -m conntrack --ctorigdst "$resolver" --ctorigdstport 53 -j ACCEPT
  done ;;
  *[!0-9.]*|'') echo 'Invalid DNS resolver' >&2; exit 1 ;;
  *) for protocol in udp tcp; do
    iptables -A OUTPUT -p "$protocol" -m conntrack --ctorigdst "$resolver" --ctorigdstport 53 -j ACCEPT
    iptables -A INPUT -p "$protocol" -m conntrack --ctorigdst "$resolver" --ctorigdstport 53 -j ACCEPT
  done ;;
esac
for range in 0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12 192.0.0.0/24 192.0.2.0/24 192.88.99.0/24 192.168.0.0/16 198.18.0.0/15 198.51.100.0/24 203.0.113.0/24 224.0.0.0/4 240.0.0.0/4; do
  iptables -A OUTPUT -d "$range" -j REJECT
done
if [ "${NEXOGUARD_REQUIRE_HOST_BLOCK:-false}" = true ] || [ -n "${NEXOGUARD_HOST_PUBLIC_IPV4:-}" ]; then
  case "${NEXOGUARD_HOST_PUBLIC_IPV4:-}" in *[!0-9.]*|'') echo 'Host public IPv4 required' >&2; exit 1 ;; esac
  iptables -A OUTPUT -d "$NEXOGUARD_HOST_PUBLIC_IPV4/32" -j REJECT
fi
iptables -A OUTPUT -p tcp -m multiport --dports 80,443 -j ACCEPT
# IPv6 stays denied in this initial deployment: no alternate route around IPv4 rules.
if [ -n "${NEXOGUARD_TRANSPORT_TLS_KEY:-}" ]; then
  # Keep mounted source keys root-only; give Node an ephemeral read-only copy.
  install -d -m 700 /run/nexoguard-transport-tls
  install -m 400 "$NEXOGUARD_TRANSPORT_TLS_KEY" /run/nexoguard-transport-tls/key.pem
  install -m 444 "$NEXOGUARD_TRANSPORT_TLS_CERT" /run/nexoguard-transport-tls/cert.pem
  chown node:node /run/nexoguard-transport-tls/key.pem /run/nexoguard-transport-tls/cert.pem /run/nexoguard-transport-tls
  export NEXOGUARD_TRANSPORT_TLS_KEY=/run/nexoguard-transport-tls/key.pem
  export NEXOGUARD_TRANSPORT_TLS_CERT=/run/nexoguard-transport-tls/cert.pem
fi
# Effective UID/capability drop is irreversible for the unprivileged application.
exec setpriv --reuid=node --regid=node --init-groups --inh-caps=-all --ambient-caps=-all --bounding-set=-all --no-new-privs node dist/transport/main.js
