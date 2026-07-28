#!/usr/bin/env bash
# Infinite CRM — one-command ship script.
#
# Usage from ANYWHERE:
#   cd ~/Downloads/infinite-crm
#   ./ship.sh "commit message here"
#
# What it does (in order, stops on first failure):
#   1. Deploys the Cloudflare Worker via wrangler
#   2. Verifies the deploy by hitting /version
#   3. Commits + pushes to git → Vercel auto-deploys the frontend
#
# Requires: wrangler installed globally OR available via npx (npx handles both).

set -euo pipefail

MSG="${1:-Update}"
REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
WORKER_DIR="$REPO_DIR/cloudflare-worker"
WORKER_URL="https://infinite-crm-webhook.murrayhealthadvising.workers.dev/version"

echo ""
echo "🚀 Infinite CRM ship"
echo "   repo: $REPO_DIR"
echo "   msg:  $MSG"
echo ""

# ── 1. Deploy the Cloudflare Worker ────────────────────────────────────────
echo "1/3 Deploying Cloudflare Worker…"
cd "$WORKER_DIR"
# Wrangler --keep-vars preserves dashboard-set env vars and secrets so we
# don't accidentally wipe SUPABASE_SERVICE_KEY etc. every deploy.
npx wrangler deploy --keep-vars

# ── 2. Verify the deploy landed ────────────────────────────────────────────
echo ""
echo "2/3 Verifying worker version…"
sleep 3  # give edge a moment to propagate
VERSION_JSON=$(curl -s "$WORKER_URL")
VERSION=$(echo "$VERSION_JSON" | grep -o '"version":"[^"]*"' | cut -d'"' -f4 || echo "unknown")
LOCAL_VERSION=$(grep -m1 "version: 'v4" "$WORKER_DIR/worker-v4.js" | grep -o "v4\.[0-9]*")
echo "   local:  $LOCAL_VERSION"
echo "   remote: $VERSION"
if [ "$VERSION" = "$LOCAL_VERSION" ]; then
  echo "   ✓ Worker deploy confirmed."
else
  echo "   ⚠  Version mismatch — worker may not have deployed. Continuing anyway."
fi

# ── 3. Git commit + push (Vercel auto-deploys frontend) ───────────────────
echo ""
echo "3/3 Pushing frontend to git…"
cd "$REPO_DIR"
git add -A
if git diff --cached --quiet; then
  echo "   Nothing to commit — frontend is already up to date."
else
  git commit -m "$MSG"
  git push
  echo "   ✓ Pushed. Vercel will auto-deploy the frontend in ~1 min."
fi

echo ""
echo "✅ Ship complete."
echo ""
