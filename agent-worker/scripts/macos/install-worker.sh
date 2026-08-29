#!/bin/bash
set -euo pipefail

LABEL="com.masarat.website-agent-worker"
KEYCHAIN_SERVICE="com.masarat.website-agent-worker.database"
APP_ROOT="$HOME/Library/Application Support/Masarat Website Agent"
APP_DIR="$APP_ROOT/app"
LOG_DIR="$APP_ROOT/logs"
CONFIG_FILE="$APP_ROOT/worker.env"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
prompt_default() {
  local label="$1" default="$2" result
  read -r -p "$label [$default]: " result
  printf '%s' "${result:-$default}"
}
require_single_line() {
  case "$2" in *$'\n'*|*$'\r'*) fail "$1 cannot contain a newline.";; esac
}
write_setting() {
  require_single_line "$1" "$2"
  printf '%s=%s\n' "$1" "$2" >> "$CONFIG_FILE"
}

NODE_COMMAND="$(command -v node || true)"
NPM_COMMAND="$(command -v npm || true)"
[[ -n "$NODE_COMMAND" && -n "$NPM_COMMAND" ]] || fail "Node.js 24+ is required. Install the current Node.js LTS release, then run this installer again."
NODE_MAJOR="$($NODE_COMMAND -p "Number(process.versions.node.split('.')[0])")"
[[ "$NODE_MAJOR" -ge 24 ]] || fail "Node.js 24+ is required; found $($NODE_COMMAND --version)."

CODEX_COMMAND="${CODEX_COMMAND:-}"
if [[ -z "$CODEX_COMMAND" && -x "/Applications/ChatGPT.app/Contents/Resources/codex" ]]; then
  CODEX_COMMAND="/Applications/ChatGPT.app/Contents/Resources/codex"
fi
if [[ -z "$CODEX_COMMAND" && -x "/Applications/Codex.app/Contents/Resources/codex" ]]; then
  CODEX_COMMAND="/Applications/Codex.app/Contents/Resources/codex"
fi
if [[ -z "$CODEX_COMMAND" ]]; then CODEX_COMMAND="$(command -v codex || true)"; fi
[[ -n "$CODEX_COMMAND" && -x "$CODEX_COMMAND" ]] || fail "Codex was not found. Install/open the Codex or ChatGPT app and sign in first."
"$CODEX_COMMAND" login status 2>&1 | grep -q "Logged in using ChatGPT" || fail "Codex is not signed in with ChatGPT on this Mac. Open Codex, sign in, then retry."

PROJECT_REF="$(prompt_default "Supabase project reference" "zavuqwarhypeszimgjvx")"
DB_HOST="$(prompt_default "Supabase session-pooler host" "aws-0-eu-central-1.pooler.supabase.com")"
DB_PORT="$(prompt_default "Database port" "5432")"
DB_NAME="$(prompt_default "Database name" "postgres")"
OWNER_USER="$(prompt_default "Supabase owner user" "postgres.$PROJECT_REF")"
WORKER_ROLE="masarat_agent_worker"

printf 'Supabase database password (hidden; used once and never saved): '
IFS= read -r -s OWNER_PASSWORD
printf '\n'
[[ -n "$OWNER_PASSWORD" ]] || fail "The Supabase database password is required."

mkdir -p "$APP_DIR" "$LOG_DIR" "$HOME/Library/LaunchAgents"
chmod 700 "$APP_ROOT" "$LOG_DIR"

tar -C "$SOURCE_DIR" --exclude='./node_modules' --exclude='./.env' --exclude='./data' -cf - . | tar -C "$APP_DIR" -xf -
chmod 700 "$APP_DIR/scripts/macos/"*.sh
cd "$APP_DIR"
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 "$NPM_COMMAND" ci --omit=dev

BROWSER_EXECUTABLE_PATH="${BROWSER_EXECUTABLE_PATH:-}"
if [[ -z "$BROWSER_EXECUTABLE_PATH" ]]; then
  for candidate in \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    "$HOME/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"; do
    if [[ -x "$candidate" ]]; then BROWSER_EXECUTABLE_PATH="$candidate"; break; fi
  done
fi
if [[ -z "$BROWSER_EXECUTABLE_PATH" ]]; then
  MACOS_MAJOR="$(/usr/bin/sw_vers -productVersion | /usr/bin/cut -d. -f1)"
  if [[ "$MACOS_MAJOR" -lt 14 ]]; then
    fail "Google Chrome is required on macOS 13 because Playwright no longer provides a compatible bundled Chromium. Install Chrome, then retry."
  fi
  "$NODE_COMMAND" node_modules/playwright/cli.js install chromium
elif [[ ! -x "$BROWSER_EXECUTABLE_PATH" ]]; then
  fail "BROWSER_EXECUTABLE_PATH is not executable: $BROWSER_EXECUTABLE_PATH"
fi

CA_SOURCE="$APP_DIR/certs/supabase-root-2021-ca.pem"
CA_FILE="$APP_ROOT/supabase-root-2021-ca.pem"
[[ -f "$CA_SOURCE" ]] || fail "The bundled Supabase root CA certificate is missing."
/bin/cp "$CA_SOURCE" "$CA_FILE"
chmod 600 "$CA_FILE"

printf 'Applying database migrations...\n'
NODE_EXTRA_CA_CERTS="$CA_FILE" NODE_ENV=production ALLOWED_ORIGINS=https://managing.masaratkobra.com \
  DB_HOST="$DB_HOST" DB_PORT="$DB_PORT" DB_NAME="$DB_NAME" DB_USER="$OWNER_USER" DB_PASSWORD="$OWNER_PASSWORD" \
  "$NODE_COMMAND" src/migrate.js

WORKER_PASSWORD="$(/usr/bin/openssl rand -base64 48 | tr -d '\n')"
printf 'Creating a restricted database account for the worker...\n'
WORKER_DB_USER="$(printf '%s\n%s\n' "$OWNER_PASSWORD" "$WORKER_PASSWORD" | \
  NODE_EXTRA_CA_CERTS="$CA_FILE" DB_HOST="$DB_HOST" DB_PORT="$DB_PORT" DB_NAME="$DB_NAME" DB_USER="$OWNER_USER" \
  SUPABASE_PROJECT_REF="$PROJECT_REF" WORKER_DB_ROLE="$WORKER_ROLE" \
  "$NODE_COMMAND" scripts/provision-worker-db.js)"
unset OWNER_PASSWORD

KEYCHAIN_ACCOUNT="$(id -un)"
/usr/bin/security add-generic-password -U -a "$KEYCHAIN_ACCOUNT" -s "$KEYCHAIN_SERVICE" \
  -w "$WORKER_PASSWORD" -T /usr/bin/security >/dev/null
unset WORKER_PASSWORD

: > "$CONFIG_FILE"
chmod 600 "$CONFIG_FILE"
write_setting AI_PROVIDER codex
write_setting NODE_ENV production
write_setting NODE_COMMAND "$NODE_COMMAND"
write_setting CODEX_COMMAND "$CODEX_COMMAND"
write_setting CODEX_MODEL gpt-5.6-sol
write_setting CODEX_TIMEOUT_MS 1200000
write_setting CODEX_WORKDIR "$APP_DIR"
write_setting BROWSER_EXECUTABLE_PATH "$BROWSER_EXECUTABLE_PATH"
write_setting DB_HOST "$DB_HOST"
write_setting DB_PORT "$DB_PORT"
write_setting DB_NAME "$DB_NAME"
write_setting DB_USER "$WORKER_DB_USER"
write_setting DATABASE_SSL true
write_setting NODE_EXTRA_CA_CERTS "$CA_FILE"
write_setting WORKER_ID "$(scutil --get ComputerName 2>/dev/null || hostname)-website-agent"
write_setting WORKER_CONCURRENCY 1
write_setting WORKER_HEARTBEAT_MS 30000
write_setting JOB_POLL_MS 3000
write_setting JOB_LEASE_MS 900000
write_setting JOB_MAX_ATTEMPTS 2
write_setting BROWSER_TIMEOUT_MS 45000
write_setting MAX_AUDIT_PAGES 4
write_setting MAX_NETWORK_HOSTS 40
write_setting MAX_SCREENSHOT_BYTES 3500000
write_setting KEYCHAIN_ACCOUNT "$KEYCHAIN_ACCOUNT"
write_setting KEYCHAIN_SERVICE "$KEYCHAIN_SERVICE"

xml_escape() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/"/\&quot;/g'; }
RUNNER_XML="$(xml_escape "$APP_DIR/scripts/macos/run-worker.sh")"
OUT_XML="$(xml_escape "$LOG_DIR/worker.log")"
ERR_XML="$(xml_escape "$LOG_DIR/worker.error.log")"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$RUNNER_XML</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ProcessType</key><string>Background</string>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>$OUT_XML</string>
  <key>StandardErrorPath</key><string>$ERR_XML</string>
</dict></plist>
EOF
chmod 600 "$PLIST"
/usr/bin/plutil -lint "$PLIST" >/dev/null

DOMAIN="gui/$(id -u)"
/bin/launchctl bootout "$DOMAIN" "$PLIST" >/dev/null 2>&1 || true
/bin/launchctl bootstrap "$DOMAIN" "$PLIST"
/bin/launchctl kickstart -k "$DOMAIN/$LABEL"

printf '\nWebsite Agent worker installed.\n'
printf 'Model: gpt-5.6-sol through the signed-in Codex app (no OpenAI API key).\n'
printf 'Status command: %q\n' "$APP_DIR/scripts/macos/status-worker.sh"
