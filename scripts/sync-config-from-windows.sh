#!/usr/bin/env bash
# Sync gitignored config from the Windows OmniDrive clone (HDD mount) into the Linux clone (SSD).
# Does not print secret values.
set -euo pipefail

LINUX_REPO="${LINUX_REPO:-$HOME/coding/OmniDrive}"
WINDOWS_REPO="${1:-${WINDOWS_REPO:-}}"

usage() {
  cat <<'EOF'
Usage:
  ./scripts/sync-config-from-windows.sh /path/to/windows/OmniDrive
  WINDOWS_REPO=/media/$USER/Data/coding/OmniDrive ./scripts/sync-config-from-windows.sh

Copies (if present on Windows):
  .env
  packages/worker/wrangler.toml
  packages/web/.env.production

Target Linux repo (override with LINUX_REPO):
  ~/coding/OmniDrive
EOF
}

if [[ -z "$WINDOWS_REPO" ]]; then
  usage
  exit 1
fi

if [[ ! -d "$WINDOWS_REPO" ]]; then
  echo "=> [ERROR] Windows repo not found: $WINDOWS_REPO"
  echo "    Mount the Windows HDD partition first (Linux Mint: file manager or /media/\$USER/...)."
  exit 1
fi

if [[ ! -d "$LINUX_REPO" ]]; then
  echo "=> [ERROR] Linux repo not found: $LINUX_REPO"
  echo "    Run scripts/setup-linux.sh first or set LINUX_REPO."
  exit 1
fi

copy_if_exists() {
  local src="$1"
  local dest="$2"
  if [[ -f "$src" ]]; then
    mkdir -p "$(dirname "$dest")"
    cp -a "$src" "$dest"
    echo "=> Copied $(basename "$dest")"
    return 0
  fi
  echo "=> Skipped (not on Windows): $(basename "$dest")"
  return 1
}

echo "=> Syncing config"
echo "    From: $WINDOWS_REPO"
echo "    To:   $LINUX_REPO"

copied=0
copy_if_exists "$WINDOWS_REPO/.env" "$LINUX_REPO/.env" && copied=1 || true
copy_if_exists "$WINDOWS_REPO/packages/worker/wrangler.toml" "$LINUX_REPO/packages/worker/wrangler.toml" && copied=1 || true
copy_if_exists "$WINDOWS_REPO/packages/web/.env.production" "$LINUX_REPO/packages/web/.env.production" && copied=1 || true

if [[ "$copied" -eq 0 ]]; then
  echo "=> [WARN] No config files copied. Create .env on Windows first (copy from .env.example)."
  exit 1
fi

# Worker dev reads secrets via .dev.vars (Makefile uses the same symlink).
if [[ -f "$LINUX_REPO/.env" ]]; then
  ln -sf ../../.env "$LINUX_REPO/packages/worker/.dev.vars"
  echo "=> Linked packages/worker/.dev.vars -> ../../.env"
fi

echo "=> Done. Secrets were copied but not displayed."