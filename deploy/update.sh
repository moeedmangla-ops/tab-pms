#!/usr/bin/env bash
# Deploy the latest code from GitHub. Run as the app user from the app folder:  bash deploy/update.sh
set -euo pipefail
cd "$(dirname "$0")/.."
pg_dump --format=custom --file="$HOME/pre-update-$(date +%F-%H%M).dump" "$(grep ^DATABASE_URL .env | cut -d'"' -f2 | sed 's/?schema=public//')"
git pull --ff-only
npm ci
npx prisma generate
npx prisma migrate deploy
NEXT_TELEMETRY_DISABLED=1 npm run build
pm2 restart tab-web tab-worker
sleep 5 && curl -fsS localhost:3000/api/health && echo " — updated"
