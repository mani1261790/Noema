#!/usr/bin/env python3

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
NOTEBOOK_DIR = ROOT / "content" / "notebooks"
REVIEW_DIR = ROOT / ".tmp" / "notebook-reviews" / "beginner"

INTRO_QUESTIONS_HEADING = "## 最初に解きたい疑問"
INTRO_TERMS_HEADING = "## 先に押さえる言葉"
INTRO_GUIDE_HEADING = "## 実行前の見取り図"
INTRO_PITFALLS_HEADING = "## つまずきやすい点"
STEP_HEADING_PREFIX = "## コード"

INSERTED_HEADINGS = {
    INTRO_QUESTIONS_HEADING,
    INTRO_TERMS_HEADING,
    INTRO_GUIDE_HEADING,
    INTRO_PITFALLS_HEADING,
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


def is_inserted_markdown(cell: dict[str, Any]) -> bool:
    if cell.get("cell_type") != "markdown":
        return False
    heading = first_heading_line(cell_text(cell))
    return heading in INSERTED_HEADINGS or heading.startswith(STEP_HEADING_PREFIX)


def cleanup_previous_insertions(cells: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [cell for cell in cells if not is_inserted_markdown(cell)]


def normalize_terms(terms: list[dict[str, str]]) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for item in terms:
        term = str(item.get("term", "")).strip()
        definition = str(item.get("definition", "")).strip()
        if not term or not definition:
            continue
        if term in seen:
            continue
        seen.add(term)
        out.append({"term": term, "definition": definition})
    return out[:4]


def compact_line(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def is_probably_import_bootstrap(cell: dict[str, Any]) -> bool:
    if cell.get("cell_type") != "code":
        return False
    text = cell_text(cell).strip()
    if not text:
        return False
    bad_tokens = ("print(", "for ", "while ", "def ", "class ", "@", "plt.", "return ")
    if any(token in text for token in bad_tokens):
        return False
    allowed_prefixes = (
        "import ",
        "from ",
        "try:",
        "except ",
        "TORCH_AVAILABLE",
        "SKLEARN_AVAILABLE",
        "XGBOOST_AVAILABLE",
        "#",
    )
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if stripped.startswith(allowed_prefixes):
            continue
        if stripped in {"pass", "True", "False"}:
            continue
        if "=" in stripped and stripped.split("=", 1)[0].strip().isidentifier():
            rhs = stripped.split("=", 1)[1].strip()
            if rhs in {"True", "False", "None"}:
                continue
        return False
    return True


def find_first_markdown_title_index(cells: list[dict[str, Any]]) -> int | None:
    for idx, cell in enumerate(cells):
        if cell.get("cell_type") != "markdown":
            continue
        if first_heading_line(cell_text(cell)).startswith("# "):
            return idx
    return None


def find_background_index(cells: list[dict[str, Any]]) -> int | None:
    for idx, cell in enumerate(cells):
        if cell.get("cell_type") != "markdown":
            continue
        if "## 背景と目的" in cell_text(cell):
            return idx
    return None


def count_markdown_chars(cells: list[dict[str, Any]]) -> int:
    return sum(len(cell_text(cell)) for cell in cells if cell.get("cell_type") == "markdown")


def list_code_indexes(cells: list[dict[str, Any]]) -> list[int]:
    return [idx for idx, cell in enumerate(cells) if cell.get("cell_type") == "code"]


def infer_step_label(code_text: str, notebook_id: str, order: int) -> str:
    text = code_text
    lowered = text.lower()
    stripped_lines = [line.strip() for line in text.splitlines() if line.strip()]
    if stripped_lines and all(line.startswith(("import ", "from ", "try:", "except ")) or "=" in line for line in stripped_lines):
        return "実行環境をそろえる"
    if "def " in text and ("plot" in lowered or "imshow" in lowered or "plt." in text):
        return "可視化用の処理を定義する"
    if "def " in text:
        return "更新式や補助関数を定義する"
    if "plt." in text or "imshow" in lowered or "hist(" in lowered or "scatter(" in lowered:
        return "結果を図で確かめる"
    if "np.random" in text or "random." in text or "randn" in lowered or "arange" in lowered:
        return "入力データを作る"
    if "pinv" in lowered or "lstsq" in lowered or "fit(" in lowered or "train_test_split" in lowered:
        return "モデルや係数を推定する"
    if "vif" in lowered:
        return "共線性を測る"
    if "mse" in lowered or "loss" in lowered or "error" in lowered or "accuracy" in lowered:
        return "誤差や性能を測る"
    if "policy_star" in lowered or ("newv" in lowered and "max(" in lowered):
        return "価値反復を回して方策を取り出す"
    if "eval_policy" in lowered or "improve_policy" in lowered:
        return "方策評価と改善の準備をする"
    if "policy" in lowered or "q[" in lowered or "v =" in lowered or "gamma" in lowered:
        return "更新の中身を確かめる"
    if "for " in text and "print(" in text:
        return "反復の進み方を観察する"
    if notebook_id in {
        "policy-iteration",
        "value-iteration",
        "td-learning",
        "q-learning",
        "sarsa",
        "n-step-td",
        "td-lambda",
        "eligibility-trace-td-lambda",
        "deep-rl",
    }:
        return "価値や方策の更新を追う"
    if notebook_id in {
        "transformer-basics",
        "recurrent-neural-networks",
        "image-recognition-yolo",
        "neural-network-basics",
    }:
        return "表現の変化を追う"
    if order == 1:
        return "最初の入力を準備する"
    return "計算結果を確かめる"


def step_intro_text(label: str, checkpoints: list[str], order: int) -> str:
    focus = checkpoints[min(order - 1, len(checkpoints) - 1)] if checkpoints else "どの入力がどの出力を変えるか"
    return (
        f"{STEP_HEADING_PREFIX} {order}: {label}\n\n"
        f"このセルでは {label} ための最小コードを動かします。"
        f" 実行時は「{focus}」を意識して、変数名と出力の対応を追ってください。"
    )


def build_intro_cells(entry: dict[str, Any]) -> list[dict[str, Any]]:
    questions = [compact_line(str(item)) for item in entry.get("questions", []) if compact_line(str(item))]
    terms = normalize_terms(entry.get("terms", []))
    checkpoints = [compact_line(str(item)) for item in entry.get("checkpoints", []) if compact_line(str(item))]
    missing = [compact_line(str(item)) for item in entry.get("missing_explanations", []) if compact_line(str(item))]

    questions_text = "\n".join([INTRO_QUESTIONS_HEADING, ""] + [f"{idx + 1}. {item}" for idx, item in enumerate(questions[:5])])
    terms_text = "\n".join(
        [INTRO_TERMS_HEADING, ""]
        + [f"- `{item['term']}`: {item['definition']}" for item in terms[:4]]
    )
    guide_text = "\n".join([INTRO_GUIDE_HEADING, ""] + [f"{idx + 1}. {item}" for idx, item in enumerate(checkpoints[:3])])
    pitfalls_text = "\n".join([INTRO_PITFALLS_HEADING, ""] + [f"- {item}" for item in missing[:2]])

    return [md_cell(questions_text), md_cell(terms_text), md_cell(guide_text), md_cell(pitfalls_text)]


def insert_intro_block(cells: list[dict[str, Any]], entry: dict[str, Any]) -> list[dict[str, Any]]:
    intro_cells = build_intro_cells(entry)
    background_index = find_background_index(cells)
    title_index = find_first_markdown_title_index(cells)
    if background_index is not None:
        anchor = background_index + 1
    elif title_index is not None:
        anchor = title_index + 1
    else:
        anchor = 0
    return cells[:anchor] + intro_cells + cells[anchor:]


def insert_step_guides(cells: list[dict[str, Any]], notebook_id: str, checkpoints: list[str]) -> list[dict[str, Any]]:
    if not checkpoints:
        checkpoints = ["どの入力がどの出力を変えるか", "式とコードの対応がどこか", "最後に何を比較すればよいか"]

    code_indexes = list_code_indexes(cells)
    code_count = len(code_indexes)
    md_chars = count_markdown_chars(cells)
    need_more_structure = code_count >= 2 and (md_chars < 1000 or any(cells[idx - 1].get("cell_type") == "code" for idx in code_indexes if idx > 0))

    if not need_more_structure:
        return cells

    new_cells: list[dict[str, Any]] = []
    code_order = 0
    inserted_guides = 0
    for idx, cell in enumerate(cells):
        if cell.get("cell_type") == "code":
            code_order += 1
            prev_cell = cells[idx - 1] if idx > 0 else None
            prev_text = cell_text(prev_cell) if prev_cell else ""
            prev_heading = first_heading_line(prev_text) if prev_text else ""
            should_insert = (
                prev_cell is None
                or prev_cell.get("cell_type") != "markdown"
                or prev_heading in INSERTED_HEADINGS
                or prev_heading.startswith(STEP_HEADING_PREFIX)
            )
            if should_insert:
                label = infer_step_label(cell_text(cell), notebook_id, code_order)
                inserted_guides += 1
                new_cells.append(md_cell(step_intro_text(label, checkpoints, inserted_guides)))
        new_cells.append(cell)
    return new_cells


def reorder_leading_bootstrap(cells: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if len(cells) < 2:
        return cells
    if cells[0].get("cell_type") != "code":
        return cells
    title_index = find_first_markdown_title_index(cells)
    if title_index is None or title_index == 0:
        return cells

    bootstrap = cells[0]
    remaining = cells[1:]
    background_index = find_background_index(remaining)
    if background_index is not None:
        insert_at = background_index + 1
    else:
        insert_at = min(title_index, len(remaining))
    return remaining[:insert_at] + [bootstrap] + remaining[insert_at:]


def update_notebook(path: Path, entry: dict[str, Any]) -> bool:
    raw = json.loads(path.read_text())
    cells = cleanup_previous_insertions(raw["cells"])
    cells = reorder_leading_bootstrap(cells)
    cells = insert_intro_block(cells, entry)
    checkpoints = [compact_line(str(item)) for item in entry.get("checkpoints", []) if compact_line(str(item))]
    cells = insert_step_guides(cells, path.stem, checkpoints)
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
