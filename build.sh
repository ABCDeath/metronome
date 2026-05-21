#!/bin/sh
set -e

# Install Rust stable if not already available (Cloudflare Pages has no Rust pre-installed).
# CF_PAGES=1 is injected by Cloudflare automatically — use it to guard local runs.
if [ "${CF_PAGES:-0}" = "1" ] && ! command -v cargo >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
  # POSIX dot-source — NOT bash 'source' (Cloudflare build env is /bin/sh)
  . "$HOME/.cargo/env"
fi

# Compile Rust -> WASM -> public/wasm/ (wasm-opt applied if available, skipped if not)
cargo xtask build

# Install JS deps and build the frontend (order is critical: WASM must precede vite build)
npm ci
npm run build
