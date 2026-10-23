#!/usr/bin/env bash
# One-time setup of the RSA & Gulf system on a fresh Ubuntu/Debian VM (e.g. Google Cloud e2-micro).
# Usage (as root):  sudo REPO_URL=https://github.com/YOUR-USER/rsa-gulf.git bash gcp-setup.sh
# Optional:         DOMAIN=yourdomain.com   (otherwise a free HTTPS address like 34-1-2-3.sslip.io is used)
# Safe to run again: it updates the code and keeps your data.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo "Run with sudo."; exit 1; fi
: "${REPO_URL:?Set REPO_URL, e.g. sudo REPO_URL=https://github.com/YOUR-USER/rsa-gulf.git bash gcp-setup.sh}"
APP_DIR=/opt/rsa-gulf
DATA_DIR=/var/lib/rsa-gulf
BACKUP_DIR=/var/backups/rsa-gulf
ENV_FILE=/etc/rsa-gulf.env

echo "== 1/6 Installing packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl git ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https

if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
echo "Node $(node -v)"

if ! command -v caddy >/dev/null 2>&1; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

echo "== 2/6 Getting the code"
id rsa >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin rsa
if [ -d "$APP_DIR/.git" ]; then
  git config --global --add safe.directory "$APP_DIR" || true
  git -C "$APP_DIR" pull --ff-only
else
  rm -rf "$APP_DIR"; git clone "$REPO_URL" "$APP_DIR"
fi
mkdir -p "$DATA_DIR" "$BACKUP_DIR"
chown -R rsa:rsa "$DATA_DIR" "$BACKUP_DIR"

echo "== 3/6 Staff password"
if [ ! -f "$ENV_FILE" ]; then
  while true; do
    read -rsp "Choose a staff password (8+ characters, no spaces or quotes): " PW; echo
    if [ "${#PW}" -ge 8 ] && [[ ! "$PW" =~ [[:space:]\"\'\\] ]]; then break; fi
    echo "Not valid, try again."
  done
  umask 077
  printf 'ADMIN_PASSWORD=%s\nPORT=3000\nHOST=127.0.0.1\nTRUST_PROXY=1\nDATA_DIR=%s\n' "$PW" "$DATA_DIR" > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
else
  echo "Keeping the existing password in $ENV_FILE"
fi

echo "== 4/6 Service"
cat > /etc/systemd/system/rsa-gulf.service <<UNIT
[Unit]
Description=RSA & Gulf website and database
After=network.target
[Service]
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$(command -v node) server.js
Restart=always
RestartSec=3
User=rsa
NoNewPrivileges=true
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable rsa-gulf >/dev/null
systemctl restart rsa-gulf

echo "== 5/6 HTTPS address"
if [ -n "${DOMAIN:-}" ]; then
  HOST_NAME="$DOMAIN"
else
  IP="$(curl -fsS -H 'Metadata-Flavor: Google' http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip 2>/dev/null || curl -fsS https://ifconfig.me)"
  HOST_NAME="$(echo "$IP" | tr . -).sslip.io"
fi
cat > /etc/caddy/Caddyfile <<CADDY
$HOST_NAME {
    reverse_proxy 127.0.0.1:3000
}
CADDY
systemctl enable caddy >/dev/null
systemctl restart caddy

echo "== 6/6 Nightly backup (2 AM)"
cat > /etc/cron.d/rsa-gulf-backup <<CRON
0 2 * * * rsa cd $APP_DIR && DATA_DIR=$DATA_DIR BACKUP_DIR=$BACKUP_DIR $(command -v node) backup.js >/dev/null 2>&1
CRON
chmod 644 /etc/cron.d/rsa-gulf-backup

sleep 3
if curl -fsS http://127.0.0.1:3000/api/health >/dev/null; then
  echo
  echo "DONE. The server is running."
  echo "  Website:    https://$HOST_NAME"
  echo "  Staff page: https://$HOST_NAME/admin"
  echo "(The HTTPS certificate can take a minute the first time.)"
else
  echo "The server did not start. See:  sudo journalctl -u rsa-gulf -n 50 --no-pager"; exit 1
fi
