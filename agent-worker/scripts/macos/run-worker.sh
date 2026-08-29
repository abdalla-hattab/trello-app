#!/bin/zsh
set -euo pipefail

SCRIPT_DIR=${0:A:h}
APP_DIR=${SCRIPT_DIR:h:h}
CONFIG_FILE=${MASARAT_AGENT_CONFIG:-"${APP_DIR:h}/worker.env"}

if [[ ! -r "$CONFIG_FILE" ]]; then
  print -u2 "Worker configuration is missing: $CONFIG_FILE"
  exit 1
fi

while IFS='=' read -r key value; do
  [[ -z "$key" || "$key" == \#* ]] && continue
  case "$key" in
    AI_PROVIDER|NODE_ENV|NODE_COMMAND|CODEX_COMMAND|CODEX_MODEL|CODEX_TIMEOUT_MS|CODEX_WORKDIR|BROWSER_EXECUTABLE_PATH|DB_HOST|DB_PORT|DB_NAME|DB_USER|DATABASE_SSL|NODE_EXTRA_CA_CERTS|WORKER_ID|WORKER_CONCURRENCY|WORKER_HEARTBEAT_MS|JOB_POLL_MS|JOB_LEASE_MS|JOB_MAX_ATTEMPTS|BROWSER_TIMEOUT_MS|MAX_AUDIT_PAGES|MAX_NETWORK_HOSTS|MAX_SCREENSHOT_BYTES|KEYCHAIN_ACCOUNT|KEYCHAIN_SERVICE)
      export "$key=$value"
      ;;
    *)
      print -u2 "Unsupported setting in $CONFIG_FILE: $key"
      exit 1
      ;;
  esac
done < "$CONFIG_FILE"

: "${NODE_COMMAND:?NODE_COMMAND is missing}"
: "${KEYCHAIN_ACCOUNT:?KEYCHAIN_ACCOUNT is missing}"
: "${KEYCHAIN_SERVICE:?KEYCHAIN_SERVICE is missing}"
export DB_PASSWORD=$(/usr/bin/security find-generic-password -a "$KEYCHAIN_ACCOUNT" -s "$KEYCHAIN_SERVICE" -w)

cd "$APP_DIR"
exec "$NODE_COMMAND" src/worker-main.js
