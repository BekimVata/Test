#!/usr/bin/env bash
# Banians office installer for a fresh Ubuntu 24.04 server (Hetzner).
# Safe to run again: it updates the code and keeps your settings and data.
# Usage: curl -fsSL https://raw.githubusercontent.com/BekimVata/Test/banians-office/install.sh | OFFICE_PASSWORD='your password' bash
set -euo pipefail
trap 'echo "INSTALL FAILED at line $LINENO (see above). Send this screen to Claude."' ERR

REPO="https://github.com/BekimVata/Test.git"
BRANCH="banians-office"
DIR="/opt/banians"
export DEBIAN_FRONTEND=noninteractive

echo "==> Installing system packages"
apt-get update -y
apt-get install -y curl git ca-certificates gnupg debian-keyring debian-archive-keyring apt-transport-https ufw

if ! command -v node >/dev/null || [ "$(node -v | cut -c2- | cut -d. -f1)" -lt 22 ]; then
  echo "==> Installing Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

if ! command -v caddy >/dev/null; then
  echo "==> Installing Caddy (automatic HTTPS)"
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
fi

echo "==> Getting the office code"
id banians >/dev/null 2>&1 || useradd --system --home "$DIR" --shell /usr/sbin/nologin banians
if [ -d "$DIR/.git" ]; then
  # Run git as the files' owner (git refuses repositories owned by another user), and fail loudly.
  chown -R banians:banians "$DIR"
  sudo -u banians git -c safe.directory="$DIR" -C "$DIR" fetch --depth 1 origin "$BRANCH"
  sudo -u banians git -c safe.directory="$DIR" -C "$DIR" reset --hard FETCH_HEAD
  echo "Code now at: $(sudo -u banians git -c safe.directory="$DIR" -C "$DIR" log -1 --format='%h %s')"
else
  rm -rf "$DIR.new" && git clone --depth 1 -b "$BRANCH" "$REPO" "$DIR.new"
  mkdir -p "$DIR" && cp -a "$DIR.new/." "$DIR/" && rm -rf "$DIR.new"
fi
mkdir -p "$DIR/data/files"
chown -R banians:banians "$DIR"
chmod 700 "$DIR/data"

if [ -n "${OFFICE_PASSWORD:-}" ]; then
  echo "==> Setting the office password"
  if ! sudo -u banians DATA_DIR="$DIR/data" node "$DIR/app/server.js" --set-password "$OFFICE_PASSWORD"; then
    echo "!! Password not set (it must be at least 8 characters). Set it later with:"
    echo "   sudo -u banians DATA_DIR=$DIR/data node $DIR/app/server.js --set-password 'yourpassword'"
  fi
fi

echo "==> Starting the office service"
cat > /etc/systemd/system/banians.service <<EOF
[Unit]
Description=Banians office
After=network-online.target
Wants=network-online.target

[Service]
User=banians
WorkingDirectory=$DIR
Environment=DATA_DIR=$DIR/data
Environment=PORT=3000
ExecStart=/usr/bin/node $DIR/app/server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now banians
systemctl restart banians

echo "==> Turning on automatic updates (checks every 15 minutes)"
cat > /usr/local/bin/banians-update <<'UPD'
#!/usr/bin/env bash
set -e
G="sudo -u banians git -c safe.directory=/opt/banians -C /opt/banians"
chown -R banians:banians /opt/banians
OLD=$($G rev-parse HEAD)
$G fetch -q --depth 1 origin banians-office
NEW=$($G rev-parse FETCH_HEAD)
if [ "$OLD" != "$NEW" ]; then
  $G reset -q --hard FETCH_HEAD
  systemctl restart banians
  echo "updated $OLD -> $NEW"
else
  echo "already up to date ($OLD)"
fi
UPD
chmod +x /usr/local/bin/banians-update
cat > /etc/systemd/system/banians-update.service <<'UNIT'
[Unit]
Description=Update the Banians office from GitHub
[Service]
Type=oneshot
ExecStart=/usr/local/bin/banians-update
UNIT
cat > /etc/systemd/system/banians-update.timer <<'UNIT'
[Unit]
Description=Check for Banians office updates
[Timer]
OnBootSec=2min
OnCalendar=*:0/15
Persistent=true
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now banians-update.timer
systemctl restart banians-update.timer

echo "==> Setting up HTTPS"
IP="$(curl -fsS --max-time 5 http://169.254.169.254/hetzner/v1/metadata/public-ipv4 || hostname -I | awk '{print $1}')"
HOST="$(echo "$IP" | tr '.' '-').sslip.io"
cat > /etc/caddy/Caddyfile <<EOF
$HOST {
  encode gzip
  reverse_proxy 127.0.0.1:3000 {
    flush_interval -1
  }
}
EOF
systemctl restart caddy

ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw --force enable >/dev/null

echo "$HOST" > "$DIR/data/address.txt"
echo ""
echo "======================================================"
echo " Banians office is running."
echo " Open: https://$HOST"
echo " (Log: /var/log/banians-install.log)"
echo "======================================================"
