#!/usr/bin/env bash
# One-time setup of TAB PMS on a Bluehost VPS or dedicated server running Ubuntu 22.04/24.04
# WITHOUT cPanel. Run as root:  sudo bash deploy/setup-vps.sh pms.tabconsultantsllc.com you@tabconsultantsllc.com
# Installs PostgreSQL 16, Node.js 22, nginx, Let's Encrypt TLS and PM2; creates the database;
# builds the app; seeds configuration only (no demo data) unless SEED_DEMO=true.
set -euo pipefail
DOMAIN="${1:?usage: setup-vps.sh <domain> <admin-email>}"
ADMIN_EMAIL="${2:?usage: setup-vps.sh <domain> <admin-email>}"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_USER="${APP_USER:-tabpms}"
DB_PASS="$(openssl rand -hex 16)"

echo "==> Packages"
apt-get update -y
apt-get install -y curl ca-certificates gnupg nginx certbot python3-certbot-nginx postgresql postgresql-contrib openssl
if ! command -v node >/dev/null || [ "$(node -v | cut -c2- | cut -d. -f1)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
npm install -g pm2@5.4.2

echo "==> App user"
id "$APP_USER" >/dev/null 2>&1 || useradd -r -m -s /bin/bash "$APP_USER"
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"

echo "==> Database"
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='tab'" | grep -q 1 || sudo -u postgres psql -c "CREATE USER tab WITH PASSWORD '$DB_PASS' CREATEDB;"
sudo -u postgres psql -c "ALTER USER tab WITH PASSWORD '$DB_PASS';"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='tab_pms'" | grep -q 1 || sudo -u postgres psql -c "CREATE DATABASE tab_pms OWNER tab;"

echo "==> Environment (.env)"
if [ ! -f "$APP_DIR/.env" ]; then
  cat > "$APP_DIR/.env" <<ENV
DATABASE_URL="postgresql://tab:$DB_PASS@localhost:5432/tab_pms?schema=public"
SESSION_SECRET="$(openssl rand -hex 32)"
APP_URL="https://$DOMAIN"
SESSION_TIMEOUT_HOURS=8
LEAD_WEBHOOK_SECRET="$(openssl rand -hex 16)"
# Fill these after the Microsoft 365 app registration (docs/CONNECTORS.md), then: pm2 restart all
GRAPH_TENANT_ID=
GRAPH_CLIENT_ID=
GRAPH_CLIENT_SECRET=
GRAPH_SYNC_MAILBOXES=
ENTRA_TENANT_ID=
ENTRA_CLIENT_ID=
ENTRA_CLIENT_SECRET=
ENV
else
  sed -i "s#^DATABASE_URL=.*#DATABASE_URL=\"postgresql://tab:$DB_PASS@localhost:5432/tab_pms?schema=public\"#" "$APP_DIR/.env"
fi
chmod 600 "$APP_DIR/.env"; chown "$APP_USER":"$APP_USER" "$APP_DIR/.env"

echo "==> Build"
ADMIN_PW="$(openssl rand -base64 18)"
sudo -u "$APP_USER" bash -c "cd '$APP_DIR' && npm ci && npx prisma generate && npx prisma migrate deploy && \
  SEED_DEMO=${SEED_DEMO:-false} SEED_ADMIN_EMAIL='$ADMIN_EMAIL' SEED_ADMIN_PASSWORD='$ADMIN_PW' npx tsx prisma/seed.ts && \
  NEXT_TELEMETRY_DISABLED=1 npm run build"

echo "==> Processes (PM2)"
sudo -u "$APP_USER" bash -c "cd '$APP_DIR' && pm2 start deploy/ecosystem.config.cjs && pm2 save"
env PATH="$PATH" pm2 startup systemd -u "$APP_USER" --hp "/home/$APP_USER" >/dev/null

echo "==> nginx + TLS"
cat > /etc/nginx/sites-available/tab-pms <<NGINX
server {
  listen 80;
  server_name $DOMAIN;
  client_max_body_size 12m;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
  }
}
NGINX
ln -sf /etc/nginx/sites-available/tab-pms /etc/nginx/sites-enabled/tab-pms
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
certbot --nginx -d "$DOMAIN" -m "$ADMIN_EMAIL" --agree-tos --non-interactive --redirect || echo "!! TLS not issued yet: point $DOMAIN's A record at this server, then run: certbot --nginx -d $DOMAIN"

echo "==> Nightly database backup (kept 30 days)"
mkdir -p /var/backups/tab-pms && chown postgres /var/backups/tab-pms
cat > /etc/cron.d/tab-pms-backup <<CRON
30 1 * * * postgres pg_dump --format=custom --file=/var/backups/tab-pms/tab_pms_\$(date +\%F).dump tab_pms && find /var/backups/tab-pms -name '*.dump' -mtime +30 -delete
CRON

cat <<DONE

=====================================================================
 TAB PMS is installed.
 Open:      https://$DOMAIN
 Sign in:   $ADMIN_EMAIL
 Password:  $ADMIN_PW        <-- write this down now; it is not stored anywhere else
 You will be asked to set up two-factor at first sign-in.
 Status:    sudo -u $APP_USER pm2 status      Logs: sudo -u $APP_USER pm2 logs
 Health:    curl https://$DOMAIN/api/health
=====================================================================
DONE
