#!/bin/zsh
set -u

LABEL=com.masarat.website-agent-worker
APP_ROOT="$HOME/Library/Application Support/Masarat Website Agent"
DOMAIN="gui/$(id -u)"

echo "Service status"
/bin/launchctl print "$DOMAIN/$LABEL" 2>&1 | /usr/bin/sed -n '1,45p'
echo
echo "Recent worker output"
/usr/bin/tail -n 30 "$APP_ROOT/logs/worker.log" 2>/dev/null || true
echo
echo "Recent worker errors"
/usr/bin/tail -n 30 "$APP_ROOT/logs/worker.error.log" 2>/dev/null || true
