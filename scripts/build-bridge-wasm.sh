#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IGLOO_SHARED_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
DEFAULT_BIFROST_RS_DIR="${IGLOO_SHARED_ROOT}/../bifrost-rs"
if [[ -n "${BIFROST_RS_DIR:-}" ]]; then
  RESOLVED_BIFROST_RS_DIR="${BIFROST_RS_DIR}"
else
  RESOLVED_BIFROST_RS_DIR="${DEFAULT_BIFROST_RS_DIR}"
fi
BIFROST_RS_DIR="${RESOLVED_BIFROST_RS_DIR}"
WASM_PKG_DIR="${IGLOO_SHARED_ROOT}/public/wasm"
WASM_MODULES=(
  "crates/bifrost-bridge-wasm:bifrost_bridge_wasm"
  "crates/bifrost-profile-wasm:bifrost_profile_wasm"
)

if ! command -v wasm-pack >/dev/null 2>&1; then
  echo "error: wasm-pack is required (https://rustwasm.github.io/wasm-pack/installer/)" >&2
  exit 1
fi

if ! command -v clang >/dev/null 2>&1; then
  echo "error: clang is required to compile secp256k1 for wasm32-unknown-unknown" >&2
  exit 1
fi

if [[ ! -f "${BIFROST_RS_DIR}/Cargo.toml" ]]; then
  echo "error: bifrost-rs workspace not found at ${BIFROST_RS_DIR}" >&2
  echo "default workspace path: ${DEFAULT_BIFROST_RS_DIR}" >&2
  echo "override with: BIFROST_RS_DIR=/absolute/path/to/bifrost-rs npm run build:browser-wasm" >&2
  exit 1
fi

mkdir -p "${WASM_PKG_DIR}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

for module_spec in "${WASM_MODULES[@]}"; do
  crate_path="${module_spec%%:*}"
  out_name="${module_spec##*:}"
  out_dir="${TMP_DIR}/${out_name}"

  (
    cd "${BIFROST_RS_DIR}"
    wasm-pack build "${crate_path}" \
      --target web \
      --out-dir "${out_dir}" \
      --out-name "${out_name}"
  )

  cp "${out_dir}/${out_name}.js" "${WASM_PKG_DIR}/${out_name}.js"
  cp "${out_dir}/${out_name}.d.ts" "${WASM_PKG_DIR}/${out_name}.d.ts"
  cp "${out_dir}/${out_name}_bg.wasm" "${WASM_PKG_DIR}/${out_name}_bg.wasm"
  cat > "${WASM_PKG_DIR}/${out_name}_loader.mjs" <<EOF
import init, * as wasm from './${out_name}.js';

const wasmUrl = new URL('./${out_name}_bg.wasm', import.meta.url);

export default async function loadWasm(options = {}) {
  await init({ module_or_path: options.module_or_path ?? wasmUrl });
  return wasm;
}

export * from './${out_name}.js';
EOF
done

echo "ok: copied wasm artifacts to ${WASM_PKG_DIR}"
