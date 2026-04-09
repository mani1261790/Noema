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
import importlib.util
import re
from pathlib import Path


NOTEBOOK_DIR = Path("content/notebooks")
STEP_TIMEOUT_SECONDS = 10
ROOT_DIR = Path(__file__).resolve().parent.parent
RUNNER_HANDLER = ROOT_DIR / "infra" / "lambda" / "python-runner" / "handler.py"
IMPORT_PATTERN = re.compile(r"^\s*import\s+([A-Za-z0-9_.,\s]+)(?:\s+as\s+[A-Za-z0-9_]+)?\s*$")
FROM_PATTERN = re.compile(r"^\s*from\s+([A-Za-z0-9_\.]+)\s+import\s+")


def normalize_module_name(value: str) -> str:
  base = value.strip().split(".")[0].replace("-", "_").lower()
  if not base:
    return ""
  if not re.match(r"^[a-z_][a-z0-9_]*$", base):
    return ""
  return base


def extract_imported_modules(code: str) -> list[str]:
  modules: list[str] = []
  seen = set()
  for line in code.splitlines():
    if len(modules) >= 24:
      break
    from_match = FROM_PATTERN.match(line)
    if from_match:
      module_name = normalize_module_name(from_match.group(1))
      if module_name and module_name not in seen:
        seen.add(module_name)
        modules.append(module_name)
      continue

    import_match = IMPORT_PATTERN.match(line)
    if not import_match:
      continue
    for raw_module in import_match.group(1).split(","):
      if len(modules) >= 24:
        break
      module_name = normalize_module_name(raw_module.split(" as ", 1)[0])
      if module_name and module_name not in seen:
        seen.add(module_name)
        modules.append(module_name)
  return modules


def load_runner():
  spec = importlib.util.spec_from_file_location("noema_local_python_runner", RUNNER_HANDLER)
  if spec is None or spec.loader is None:
    raise RuntimeError(f"Unable to load runner handler: {RUNNER_HANDLER}")
  module = importlib.util.module_from_spec(spec)
  spec.loader.exec_module(module)
  return module


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


def run_code(runner, current_code: str, context_code: str) -> tuple[bool, str]:
  previous_backend = os.environ.get("MPLBACKEND")
  os.environ["MPLBACKEND"] = "Agg"
  try:
    result = runner.lambda_handler(
      {
        "action": "execute",
        "code": current_code,
        "contextCode": context_code,
        "expectedModules": extract_imported_modules(f"{context_code}\n{current_code}"),
      },
      None,
    )
  finally:
    if previous_backend is None:
      os.environ.pop("MPLBACKEND", None)
    else:
      os.environ["MPLBACKEND"] = previous_backend

  if result.get("timedOut"):
    return False, "TimeoutExpired"
  if result.get("error"):
    stderr = str(result.get("stderr") or "").strip()
    return False, stderr or str(result.get("error"))
  return True, ""


def main() -> int:
  runner = load_runner()
  notebooks = sorted(NOTEBOOK_DIR.glob("*.ipynb"))
  failures: list[str] = []

  for notebook in notebooks:
    cells = load_code_cells(notebook)
    if not cells:
      continue

    cumulative: list[str] = []
    for idx, cell in enumerate(cells, start=1):
      context = "\n\n".join(cumulative)
      ok, err = run_code(runner, cell, context)
      if not ok:
        failures.append(f"{notebook}: code#{idx}: {err.splitlines()[-1] if err else 'Execution failed'}")
        break
      cumulative.append(cell)

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
