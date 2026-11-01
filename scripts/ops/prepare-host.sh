#!/usr/bin/env bash
set -euo pipefail
# Ubuntu 24.04 reference setup; run on a new server only after external changes are approved.
test "${CONFIRM_HOST_SETUP:-}" = 'new-noct-server' || { echo 'Explicit new-server confirmation required'; exit 1; }
test "$(id -u)" = '0'
. /etc/os-release
test "$ID" = 'ubuntu' && test "$VERSION_ID" = '24.04'
apt-get update
apt-get install -y postgresql-16 postgresql-client-16 unattended-upgrades curl ca-certificates xz-utils
if ! id noct >/dev/null 2>&1; then useradd --system --create-home --home-dir /var/lib/noct --shell /usr/sbin/nologin noct; fi
install -d -o noct -g noct -m 750 /opt/noct/releases
install -d -o root -g noct -m 750 /etc/noct
# Node is downloaded from the official distribution and checked against its published digest.
node_version=v24.14.0
work=$(mktemp -d)
curl --fail --location "https://nodejs.org/dist/$node_version/node-$node_version-linux-x64.tar.xz" -o "$work/node.tar.xz"
curl --fail --location "https://nodejs.org/dist/$node_version/SHASUMS256.txt" -o "$work/sums"
expected=$(awk -v file="node-$node_version-linux-x64.tar.xz" '$2==file {print $1}' "$work/sums")
test -n "$expected"
printf '%s  %s\n' "$expected" "$work/node.tar.xz" | sha256sum --check
tar -xJf "$work/node.tar.xz" -C /usr/local --strip-components=1 --no-same-owner
echo 'Base runtime installed. Configure private DB roles, Caddy, secrets and approved timers using docs/OPERATIONS.md.'
echo 'No application timers have been enabled.'
