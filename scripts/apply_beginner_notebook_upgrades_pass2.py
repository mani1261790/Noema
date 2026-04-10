#!/usr/bin/env python3

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
NOTEBOOK_DIR = ROOT / "content" / "notebooks"
REVIEW_DIR = ROOT / ".tmp" / "notebook-reviews" / "beginner-pass2"

OUTPUT_GUIDE_HEADING = "## 出力の読み方"
SCOPE_HEADING = "## このノートの守備範囲"
PITFALLS_HEADING = "## つまずきやすい点"
PASS2_HEADINGS = {
    OUTPUT_GUIDE_HEADING,
    SCOPE_HEADING,
}


def md_cell(text: str) -> dict[str, Any]:
    return {
        "cell_type": "markdown",
        "metadata": {},
        "source": [text.rstrip() + "\n"],
    }


def cell_text(cell: dict[str, Any]) -> str:
    return "".join(cell.get("source", []))


def first_heading_line(text: str) -> str:
    for line in text.splitlines():
        if line.startswith("#"):
            return line.strip()
    return ""


def compact(value: Any) -> str:
    return " ".join(str(value).split()).strip()


def dedupe_lines(lines: list[str], limit: int) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for raw in lines:
        line = compact(raw)
        if not line or line in seen:
            continue
        seen.add(line)
        out.append(line)
        if len(out) >= limit:
            break
    return out


def polish_scope_line(line: str) -> str:
    replacements = [
        ("ではないこと。", "ではありません。"),
        ("であること。", "です。"),
        ("に見える。", "です。"),
    ]
    out = line
    for src, dst in replacements:
        if out.endswith(src):
            return out[: -len(src)] + dst
    return out


def is_pass2_cell(cell: dict[str, Any]) -> bool:
    return cell.get("cell_type") == "markdown" and first_heading_line(cell_text(cell)) in PASS2_HEADINGS


def remove_pass2_cells(cells: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [cell for cell in cells if not is_pass2_cell(cell)]


def find_heading_index(cells: list[dict[str, Any]], heading: str) -> int | None:
    for idx, cell in enumerate(cells):
        if cell.get("cell_type") != "markdown":
            continue
        if first_heading_line(cell_text(cell)) == heading:
            return idx
    return None


def append_to_pitfalls(cells: list[dict[str, Any]], additions: list[str]) -> list[dict[str, Any]]:
    additions = dedupe_lines(additions, 3)
    if not additions:
        return cells

    idx = find_heading_index(cells, PITFALLS_HEADING)
    if idx is None:
        return cells

    text = cell_text(cells[idx]).rstrip()
    existing = {compact(line[2:]) for line in text.splitlines() if line.startswith("- ")}
    new_items = [item for item in additions if item not in existing]
    if not new_items:
        return cells

    suffix = "\n" if text else ""
    suffix += "\n".join(f"- {item}" for item in new_items)
    cells[idx]["source"] = [text + suffix + "\n"]
    return cells


def build_output_guide(entry: dict[str, Any]) -> dict[str, Any] | None:
    gaps = dedupe_lines(entry.get("output_reading_gaps", []), 3)
    if not gaps:
        return None
    text = "\n".join(
        [OUTPUT_GUIDE_HEADING, ""]
        + [f"- {gap}" for gap in gaps]
    )
    return md_cell(text)


def build_scope_guide(entry: dict[str, Any]) -> dict[str, Any] | None:
    gaps = [polish_scope_line(line) for line in dedupe_lines(entry.get("scope_gaps", []), 2)]
    if not gaps:
        return None
    text = "\n".join(
        [SCOPE_HEADING, "", "このノートでは次の点は入口だけ触れるか、別ノートに分けて扱います。", ""]
        + [f"- {gap}" for gap in gaps]
    )
    return md_cell(text)


def insert_after(cells: list[dict[str, Any]], anchor_heading: str, new_cell: dict[str, Any] | None) -> list[dict[str, Any]]:
    if new_cell is None:
        return cells
    idx = find_heading_index(cells, anchor_heading)
    if idx is None:
        return cells
    return cells[: idx + 1] + [new_cell] + cells[idx + 1 :]


def update_notebook(path: Path, entry: dict[str, Any]) -> bool:
    raw = json.loads(path.read_text())
    cells = remove_pass2_cells(raw["cells"])
    cells = append_to_pitfalls(cells, entry.get("missing_explanations", []))
    cells = insert_after(cells, "## 実行前の見取り図", build_output_guide(entry))
    cells = insert_after(cells, PITFALLS_HEADING, build_scope_guide(entry))
    raw["cells"] = cells

    new_text = json.dumps(raw, ensure_ascii=False, indent=2) + "\n"
    if path.read_text() == new_text:
        return False
    path.write_text(new_text)
    return True


def main() -> None:
    if not REVIEW_DIR.exists():
        raise SystemExit(f"review dir not found: {REVIEW_DIR}")

    changed: list[str] = []
    for review_path in sorted(REVIEW_DIR.glob("*.json")):
        payload = json.loads(review_path.read_text())
        notebooks = payload.get("notebooks", {})
        for notebook_id, entry in notebooks.items():
            notebook_path = NOTEBOOK_DIR / f"{notebook_id}.ipynb"
            if not notebook_path.exists():
                continue
            if update_notebook(notebook_path, entry):
                changed.append(notebook_id)

    for notebook_id in changed:
        print(f"updated {notebook_id}")
    print(f"updated_count={len(changed)}")


if __name__ == "__main__":
    main()
