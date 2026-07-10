#!/usr/bin/env bash
# OmniDrive first-time setup script.
# Runs the full local-dev bootstrap in one command.
set -euo pipefail

# Color codes for friendly output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

info()  { echo -e "${BLUE}→${NC} $1"; }
ok()    { echo -e "${GREEN}✓${NC} $1"; }
warn()  { echo -e "${YELLOW}!${NC} $1"; }
fail()  { echo -e "${RED}✗${NC} $1"; exit 1; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo ""
echo "OmniDrive — first-time setup"
echo "============================"
echo ""

# 1. Check Node version
info "Checking Node.js version..."
if ! command -v node >/dev/null 2>&1; then
  fail "Node.js is not installed. Install Node 22+ from https://nodejs.org/"
fi
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 22 ]; then
  fail "Node.js $NODE_MAJOR.x detected — OmniDrive requires Node 22+. Use nvm: nvm install 22 && nvm use 22"
fi
ok "Node.js $(node -v)"

# 2. Install dependencies
info "Installing dependencies (npm workspaces)..."
if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi
ok "Dependencies installed"

# 3. Copy config templates (don't overwrite existing)
info "Copying config templates..."

copy_if_missing() {
  local src="$1"
  local dst="$2"
  if [ -f "$dst" ]; then
    warn "$dst already exists — skipping"
  else
    cp "$src" "$dst"
    ok "Created $dst"
  fi
}

copy_if_missing packages/worker/wrangler.example.toml packages/worker/wrangler.toml
copy_if_missing .env.example .env

# 4. Symlink .dev.vars → ../../.env (Wrangler reads .dev.vars for local secrets)
info "Linking packages/worker/.dev.vars → ../../.env..."
if [ -L packages/worker/.dev.vars ] || [ -f packages/worker/.dev.vars ]; then
  warn "packages/worker/.dev.vars already exists — skipping"
else
  ln -s ../../.env packages/worker/.dev.vars
  ok "Symlinked packages/worker/.dev.vars → ../../.env"
fi

# 5. Apply local D1 schema (creates the database if missing)
info "Applying local D1 schema..."
if [ -f packages/worker/migrations/0001_initial_schema.sql ]; then
  (cd packages/worker && npx wrangler d1 execute omnidrive --local --file=migrations/0001_initial_schema.sql) || warn "D1 migration skipped (may need manual run after wrangler login)"
  ok "Local D1 schema applied"
else
  warn "No migrations directory found — skipping D1 setup"
fi

# 6. Summary + next steps
echo ""
echo "Setup complete!"
echo "================"
echo ""
echo -e "${GREEN}Next steps:${NC}"
echo ""
echo "  1. Edit ${YELLOW}.env${NC} and fill in:"
echo "     - GOOGLE_CLIENT_ID       (from Google Cloud Console)"
echo "     - GOOGLE_CLIENT_SECRET   (from Google Cloud Console)"
echo "     - JWT_SECRET             (run: openssl rand -hex 16)"
echo "     - TOKEN_ENCRYPTION_KEY   (run: openssl rand -hex 16)"
echo ""
echo "  2. Edit ${YELLOW}packages/worker/wrangler.toml${NC} and fill in:"
echo "     - database_id   (run: npx wrangler d1 create omnidrive)"
echo "     - KV id         (run: npx wrangler kv namespace create KV)"
echo ""
echo "  3. Start the dev servers:"
echo "     ${GREEN}npm run dev${NC}"
echo "     → Worker: http://localhost:8888"
echo "     → Web:    http://localhost:8999"
echo ""
echo "  4. Visit http://localhost:8999 → register the first admin account"
echo ""
echo "  5. In Google Cloud Console → Credentials → your OAuth client:"
echo "     Add authorized redirect URI:"
echo "     http://localhost:8888/api/auth/callback"
echo ""
