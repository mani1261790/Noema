#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="${ROOT_DIR}/.tmp/pyodide-build"
OUT_DIR="${ROOT_DIR}/public/pyodide"
PYODIDE_VERSION="${PYODIDE_VERSION:-0.26.4}"
PYODIDE_DIST_KIND="${PYODIDE_DIST_KIND:-core}"
ARCHIVE_NAME="pyodide-core-${PYODIDE_VERSION}.tar.bz2"
if [[ "${PYODIDE_DIST_KIND}" == "full" ]]; then
  ARCHIVE_NAME="pyodide-${PYODIDE_VERSION}.tar.bz2"
fi
ARCHIVE_URL="https://github.com/pyodide/pyodide/releases/download/${PYODIDE_VERSION}/${ARCHIVE_NAME}"

rm -rf "${TMP_DIR}" "${OUT_DIR}"
mkdir -p "${TMP_DIR}" "${OUT_DIR}"

curl -L "${ARCHIVE_URL}" -o "${TMP_DIR}/pyodide.tar.bz2"
tar -xjf "${TMP_DIR}/pyodide.tar.bz2" -C "${OUT_DIR}" --strip-components=1

required_files=(
  "pyodide.js"
  "pyodide.asm.wasm"
  "python_stdlib.zip"
)
for file in "${required_files[@]}"; do
  if [[ ! -f "${OUT_DIR}/${file}" ]]; then
    echo "Missing required runtime file: ${file}" >&2
    exit 1
  fi
done

rm -rf "${TMP_DIR}"
