#!/usr/bin/env bash
# First-time Linux Mint setup for OmniDrive dual-boot development.
# Windows clone: HDD (e.g. D:\coding\OmniDrive)
# Linux clone:  SSD  ~/coding/OmniDrive
set -euo pipefail

REPO_DIR="${REPO_DIR:-$HOME/coding/OmniDrive}"
GIT_REMOTE="${GIT_REMOTE:-https://github.com/asmaraputra/OmniDrive.git}"
WINDOWS_REPO="${WINDOWS_REPO:-}"
NODE_MAJOR="${NODE_MAJOR:-20}"
SKIP_APT="${SKIP_APT:-0}"

log() { echo "=> $*"; }
die() { echo "=> [ERROR] $*" >&2; exit 1; }

usage() {
  cat <<EOF
OmniDrive — Linux Mint setup (dual-boot with Windows)

Usage:
  ./scripts/setup-linux.sh [options]

Options (env vars):
  REPO_DIR=$REPO_DIR
  GIT_REMOTE=$GIT_REMOTE
  WINDOWS_REPO=   Path to mounted Windows clone (optional; runs sync-config)
  NODE_MAJOR=$NODE_MAJOR
  SKIP_APT=1      Skip apt install (if deps already installed)

Examples:
  chmod +x scripts/setup-linux.sh scripts/sync-config-from-windows.sh
  WINDOWS_REPO=/media/\$USER/Data/coding/OmniDrive ./scripts/setup-linux.sh
  ./scripts/setup-linux.sh
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

# --- 1. System packages (Linux Mint / Ubuntu base) ---
if [[ "$SKIP_APT" != "1" ]]; then
  log "Installing system packages (sudo required)..."
  sudo apt-get update
  sudo apt-get install -y \
    build-essential \
    python3 \
    git \
    curl \
    ca-certificates \
    lsof
fi

# --- 2. Node.js via fnm (per-user, easy version pin) ---
export PATH="${HOME}/.local/share/fnm:${PATH}"
if ! command -v fnm >/dev/null 2>&1; then
  log "Installing fnm (Fast Node Manager)..."
  curl -fsSL https://fnm.vercel.app/install | bash -s -- --install-dir "$HOME/.local/share/fnm" --skip-shell
fi

# shellcheck disable=SC1091
[[ -f "$HOME/.local/share/fnm/fnm" ]] && eval "$("$HOME/.local/share/fnm/fnm" env)"

if ! command -v node >/dev/null 2>&1 || [[ "$(node -p "process.versions.node.split('.')[0]")" -lt "$NODE_MAJOR" ]]; then
  log "Installing Node.js ${NODE_MAJOR}..."
  fnm install "$NODE_MAJOR"
  fnm default "$NODE_MAJOR"
  fnm use "$NODE_MAJOR"
  eval "$("$HOME/.local/share/fnm/fnm" env)"
fi

log "Node $(node -v) | npm $(npm -v)"

# --- 3. Clone or update repo ---
if [[ -d "$REPO_DIR/.git" ]]; then
  log "Repo exists — pulling latest..."
  git -C "$REPO_DIR" pull --ff-only
else
  log "Cloning into $REPO_DIR..."
  mkdir -p "$(dirname "$REPO_DIR")"
  git clone "$GIT_REMOTE" "$REPO_DIR"
fi

cd "$REPO_DIR"
chmod +x scripts/setup-linux.sh scripts/sync-config-from-windows.sh 2>/dev/null || true

# --- 4. Sync secrets from Windows HDD (optional) ---
if [[ -n "$WINDOWS_REPO" ]]; then
  log "Syncing config from Windows clone..."
  LINUX_REPO="$REPO_DIR" ./scripts/sync-config-from-windows.sh "$WINDOWS_REPO"
elif [[ ! -f .env ]]; then
  log "[WARN] No .env found."
  echo "    Option A: WINDOWS_REPO=/media/\$USER/<disk>/coding/OmniDrive ./scripts/setup-linux.sh"
  echo "    Option B: cp .env.example .env && edit manually"
  if [[ -f .env.example ]]; then
    cp .env.example .env
    log "Created .env from .env.example — fill in secrets before running dev."
  fi
fi

if [[ ! -f packages/worker/wrangler.toml && -f packages/worker/wrangler.example.toml ]]; then
  cp packages/worker/wrangler.example.toml packages/worker/wrangler.toml
  log "Created packages/worker/wrangler.toml from example — set D1/KV ids from Windows copy."
fi

# --- 5. npm install (Linux-native binaries; never reuse Windows node_modules) ---
log "Installing npm dependencies (Linux-native)..."
npm install

# --- 6. Worker env symlink (same as Makefile check-env) ---
if [[ -f .env ]]; then
  ln -sf ../../.env packages/worker/.dev.vars
  log "Linked packages/worker/.dev.vars -> ../../.env"
fi

# --- 7. Local D1 migrations ---
log "Applying local D1 migrations..."
npm run db:migrate:local --prefix packages/worker

# --- 8. Smoke test ---
log "Running tests..."
npm test

# --- 9. Wrangler login reminder ---
if ! npx wrangler whoami >/dev/null 2>&1; then
  log "[ACTION] Cloudflare login required on this OS (once):"
  echo "    cd $REPO_DIR && npx wrangler login"
fi

# --- 10. fnm shell hint ---
if ! grep -q 'fnm env' "$HOME/.bashrc" 2>/dev/null; then
  log "Add fnm to your shell (one-time):"
  echo '    eval "$(fnm env)"' >> "$HOME/.bashrc"
  echo "    Appended to ~/.bashrc — open a new terminal or: source ~/.bashrc"
fi

cat <<EOF

=> Setup complete.

Daily workflow (Linux):
  cd $REPO_DIR
  git pull
  npm install          # only if package-lock.json changed
  make dev             # or: npm run dev
  make stop            # before rebooting to Windows

Before switching to Windows:
  git add -A && git commit -m "..." && git push

After editing on Windows (next Linux session):
  git pull
  WINDOWS_REPO=/media/\$USER/<disk>/coding/OmniDrive ./scripts/sync-config-from-windows.sh
  # sync only if .env or wrangler.toml changed on Windows

Dev URLs (default .env):
  Web:    http://localhost:8999
  Worker: http://localhost:8888

EOF