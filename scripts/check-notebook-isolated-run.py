#!/usr/bin/env python3
"""Execute notebooks in isolated subprocesses to ensure standalone runability.

Policy:
- Each notebook must run from a fresh Python process.
- Cells are executed cumulatively from the first code cell to current cell.
- No notebook may rely on symbols from other notebooks/chapters.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path


NOTEBOOK_DIR = Path("content/notebooks")
STEP_TIMEOUT_SECONDS = 10


def load_code_cells(path: Path) -> list[str]:
  with path.open("r", encoding="utf-8") as fh:
    notebook = json.load(fh)

  cells: list[str] = []
  for cell in notebook.get("cells", []):
    if cell.get("cell_type") != "code":
      continue
    source = "".join(cell.get("source") or "").strip()
    if source:
      cells.append(source)
  return cells


def run_code(code: str) -> tuple[bool, str]:
  wrapped = (
    "import warnings\n"
    "warnings.filterwarnings('ignore')\n"
    f"{code}\n"
  )
  env = dict(os.environ)
  env["MPLBACKEND"] = "Agg"
  try:
    completed = subprocess.run(
      [sys.executable, "-c", wrapped],
      stdout=subprocess.PIPE,
      stderr=subprocess.PIPE,
      text=True,
      timeout=STEP_TIMEOUT_SECONDS,
      env=env,
      check=False,
    )
  except subprocess.TimeoutExpired:
    return False, "TimeoutExpired"

  if completed.returncode != 0:
    return False, (completed.stderr or completed.stdout or "Execution failed").strip()
  return True, ""


def main() -> int:
  notebooks = sorted(NOTEBOOK_DIR.glob("*.ipynb"))
  failures: list[str] = []

  for notebook in notebooks:
    cells = load_code_cells(notebook)
    if not cells:
      continue

    cumulative: list[str] = []
    for idx, cell in enumerate(cells, start=1):
      cumulative.append(cell)
      ok, err = run_code("\n\n".join(cumulative))
      if not ok:
        failures.append(f"{notebook}: code#{idx}: {err.splitlines()[-1] if err else 'Execution failed'}")
        break

  if failures:
    print("Isolated notebook execution check failed:")
    for failure in failures:
      print(failure)
    print(f"Total failures: {len(failures)}")
    return 1

  print(f"Isolated notebook execution check passed ({len(notebooks)} notebooks).")
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
