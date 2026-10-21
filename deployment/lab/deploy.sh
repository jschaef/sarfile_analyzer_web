#!/usr/bin/env bash
# Rootless deployment of the web frontend (Next.js + sar-web-api) on
# dus-lab-sar, next to the Streamlit app and the API/MCP of
# sarfile_analyzer_ng. Idempotent: re-running updates code, rebuilds and
# restarts; the secret is only generated when missing.
#
# Run as the app user (jschaef) from anywhere:
#   ~/data1/sarfile_analyzer_web/deployment/lab/deploy.sh
#
# Root steps (once): Node.js >= 20.9, the nginx vhost on :8444 and the
# firewall port, see README.md next to this script.
set -euo pipefail

WEB="$HOME/data1/sarfile_analyzer_web"
NG="$HOME/data1/sarfile_analyzer_ng"
VENV="$NG/code/venv"
CONF_DIR="$HOME/.config/sar-analyzer"
UNIT_DIR="$HOME/.config/systemd/user"
API_PORT=8300 # sar-web-api; 8200 is sar-mcp
WEB_PORT=3100 # Next.js

echo "== 1. update code =="
git -C "$WEB" pull --ff-only

echo "== 2. node =="
node -e '
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 20 || (major === 20 && minor < 9)) {
  console.error(`Node.js >= 20.9 needed, found ${process.versions.node}`);
  process.exit(1);
}
console.log(`node ${process.versions.node}`);'

echo "== 3. env file =="
mkdir -p "$CONF_DIR" && chmod 700 "$CONF_DIR"
if [ ! -f "$CONF_DIR/web.env" ]; then
    cat > "$CONF_DIR/web.env" <<EOF
SAR_WEB_API_SECRET=$(openssl rand -hex 32)
SAR_BACKEND_DIR=$NG
UPLOAD_DIR=$NG/code/upload
SAR_WEB_API_URL=http://127.0.0.1:$API_PORT
EOF
    chmod 600 "$CONF_DIR/web.env"
    echo "created web.env"
fi

echo "== 4. python deps (sar-web-api, in the venv of sarfile_analyzer_ng) =="
"$VENV/bin/pip" install -q -r "$WEB/backend/requirements.txt"

echo "== 5. build =="
# the old server would serve a half-replaced .next during the build
systemctl --user stop sar-web.service 2>/dev/null || true
cd "$WEB"
npm ci --no-audit --no-fund
# the /api/v2 rewrite takes the backend URL at build time
SAR_WEB_API_URL="http://127.0.0.1:$API_PORT" NEXT_TELEMETRY_DISABLED=1 npm run build

echo "== 6. user units =="
mkdir -p "$UNIT_DIR"
install -m 644 "$WEB/deployment/lab/sar-web-api.service" "$WEB/deployment/lab/sar-web.service" "$UNIT_DIR/"
systemctl --user daemon-reload
systemctl --user enable sar-web-api.service sar-web.service
systemctl --user restart sar-web-api.service
systemctl --user restart sar-web.service

echo "== 7. linger (boot persistence) =="
loginctl enable-linger "$USER" 2>/dev/null || true
loginctl show-user "$USER" -p Linger

echo "== 8. health check =="
for i in $(seq 1 30); do
    curl -fsS "http://127.0.0.1:$API_PORT/api/v2/health" >/dev/null 2>&1 &&
        curl -fsS -o /dev/null "http://127.0.0.1:$WEB_PORT/login" 2>/dev/null && break
    sleep 2
done
curl -fsS "http://127.0.0.1:$API_PORT/api/v2/health" && echo " sar-web-api OK"
curl -fsS -o /dev/null -w "login page HTTP %{http_code}\n" "http://127.0.0.1:$WEB_PORT/login"
systemctl --user --no-pager status sar-web-api.service sar-web.service | grep -E '●|Active:'

echo
echo "Web frontend: https://dus-lab-sar.lab.dus.suse.com:8444 (nginx vhost, see README.md)"
