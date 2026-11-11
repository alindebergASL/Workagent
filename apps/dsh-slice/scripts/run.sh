#!/usr/bin/env bash
set -euo pipefail
APP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
SLICE_ROOT="$(cd -- "$APP_DIR/../.." && pwd)"
export PATH="$SLICE_ROOT/.local/toolchain/node-v24.22.2-linux-x64/bin:$SLICE_ROOT/.local/toolchain/pnpm/node_modules/.bin:$PATH"
export NODE_OPTIONS=--max-old-space-size=2048
export pnpm_config_store_dir="$SLICE_ROOT/.local/dsh-slice/pnpm-store"
export pnpm_config_cache_dir="$SLICE_ROOT/.local/dsh-slice/pnpm-cache"
export pnpm_config_state_dir="$SLICE_ROOT/.local/dsh-slice/pnpm-state"
export npm_config_cache="$SLICE_ROOT/.local/dsh-slice/npm-cache"
cd "$APP_DIR"
case "${1:-}" in
  install|config)
    # Dependency retrieval keeps the managed network proxy and CA environment.
    exec pnpm "$@"
    ;;
  *)
    # Runtime/test processes inherit no account, provider or host credentials.
    mkdir -p "$SLICE_ROOT/.local/dsh-slice/tmp" "$SLICE_ROOT/.local/dsh-slice/state"
    exec env -i PATH="$PATH" NODE_OPTIONS="$NODE_OPTIONS" \
      DSH_HOME="$SLICE_ROOT/.local/dsh-slice/home" \
      TMPDIR="$SLICE_ROOT/.local/dsh-slice/tmp" \
      pnpm_config_store_dir="$pnpm_config_store_dir" \
      pnpm_config_cache_dir="$pnpm_config_cache_dir" \
      pnpm_config_state_dir="$pnpm_config_state_dir" \
      npm_config_cache="$npm_config_cache" \
      pnpm "$@"
    ;;
esac
