#!/usr/bin/env bash
# Pull the latest code from GitHub and restart. Run on the VM:  sudo bash /opt/rsa-gulf/deploy/update.sh
set -euo pipefail
if [ "$(id -u)" -ne 0 ]; then echo "Run with sudo."; exit 1; fi
APP_DIR=/opt/rsa-gulf
git config --global --add safe.directory "$APP_DIR" || true
git -C "$APP_DIR" pull --ff-only
systemctl restart rsa-gulf
sleep 2
curl -fsS http://127.0.0.1:3000/api/health >/dev/null && echo "Updated and running." || { echo "Not running. See: sudo journalctl -u rsa-gulf -n 50 --no-pager"; exit 1; }
