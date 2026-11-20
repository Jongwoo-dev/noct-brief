#!/usr/bin/env bash
set -euo pipefail
# Run only after deployment approval; RELEASE must be an already prepared Linux release directory.
: "${RELEASE:?Set an absolute verified release directory}"
case "$(realpath "$RELEASE")" in /opt/noct/releases/*) ;; *) echo 'Unexpected release path'; exit 1;; esac
test -f "$RELEASE/.next/standalone/server.js"
test -f "$RELEASE/package-lock.json"
test -d "$RELEASE/.next/static"
test -f "$RELEASE/.next/standalone/.next/server/instrumentation.js"
test -d "$RELEASE/node_modules/tsx"
# The caller supplies a fresh directory; never copies the whole development checkout.
if find "$RELEASE" -maxdepth 1 -name '.env*' | grep -q .; then echo 'Unexpected environment file'; exit 1; fi
previous=$(readlink -f /opt/noct/current || true)
ln -sfn "$RELEASE" /opt/noct/current.new
mv -Tf /opt/noct/current.new /opt/noct/current
systemctl restart noct-web
if ! curl --fail --retry 8 --retry-delay 2 http://127.0.0.1:3000/api/health; then
  if [ -n "$previous" ]; then ln -sfn "$previous" /opt/noct/current.new; mv -Tf /opt/noct/current.new /opt/noct/current; systemctl restart noct-web; fi
  echo 'Health check failed; inspect schema compatibility before retrying.'
  exit 1
fi
