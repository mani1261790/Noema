#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_DIR="${ROOT_DIR}/.tmp/jupyterlite-build"
VENV_DIR="${WORK_DIR}/.venv"
CONTENT_DIR="${WORK_DIR}/content"
OUTPUT_DIR="${ROOT_DIR}/public/jupyterlite"

rm -rf "${WORK_DIR}" "${OUTPUT_DIR}"
mkdir -p "${CONTENT_DIR}"
cp "${ROOT_DIR}"/content/notebooks/*.ipynb "${CONTENT_DIR}/"

python3 -m venv "${VENV_DIR}"
source "${VENV_DIR}/bin/activate"

python -m pip install --quiet --upgrade pip
python -m pip install --quiet \
  "jupyterlite==0.6.4" \
  "jupyterlite-pyodide-kernel==0.6.0" \
  "jupyter-server>=2.0.0" \
  "jupyterlab-server>=2.0.0" \
  "nbformat>=5.10.0"

jupyter lite build --contents "${CONTENT_DIR}" --output-dir "${OUTPUT_DIR}"

rm -rf "${WORK_DIR}"
rm -f "${ROOT_DIR}/.jupyterlite.doit.db"
