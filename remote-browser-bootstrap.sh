#!/bin/sh
set -eu
mkdir -p /app
cd /app
apt-get update >/dev/null
npm init -y >/dev/null
npm install --omit=dev --no-audit --no-fund playwright@1.45.3 >/dev/null
npx playwright install --with-deps chromium >/dev/null
curl -fsSL https://smejj.com/assets/remote-browser-worker.js -o worker.mjs
node /app/worker.mjs
