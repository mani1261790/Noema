#!/usr/bin/env python3
"""Static checker for undefined symbols across notebook code cells.

The checker simulates Jupyter execution order:
- Cells are evaluated from top to bottom.
- A symbol defined in an earlier cell is available in later cells.
"""

from __future__ import annotations

import ast
import builtins
import json
import sys
from pathlib import Path
from typing import Iterable


BUILTIN_NAMES = set(dir(builtins))
ALLOWED_RUNTIME_GLOBALS = {
    "__name__",
    "__file__",
    "__package__",
    "__loader__",
    "__spec__",
}


class UndefinedSymbolVisitor(ast.NodeVisitor):
    def __init__(self, globals_defined: set[str]) -> None:
        self.globals_defined = set(globals_defined)
        self.undefined: set[str] = set()
        self.scope_stack: list[set[str]] = [set()]

    def _is_known(self, name: str) -> bool:
        if name in BUILTIN_NAMES or name in ALLOWED_RUNTIME_GLOBALS:
            return True
        if name in self.globals_defined:
            return True
        return any(name in scope for scope in reversed(self.scope_stack))

    def _bind_name(self, target: ast.AST) -> None:
        if isinstance(target, ast.Name):
            self.scope_stack[-1].add(target.id)
            return
        if isinstance(target, (ast.Tuple, ast.List)):
            for elt in target.elts:
                self._bind_name(elt)
            return
        if isinstance(target, ast.Starred):
            self._bind_name(target.value)

    def visit_Name(self, node: ast.Name) -> None:
        if isinstance(node.ctx, ast.Load) and not self._is_known(node.id):
            self.undefined.add(node.id)
        if isinstance(node.ctx, (ast.Store, ast.Del)):
            self.scope_stack[-1].add(node.id)

    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            name = alias.asname or alias.name.split(".")[0]
            self.scope_stack[-1].add(name)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        for alias in node.names:
            if alias.name == "*":
                continue
            self.scope_stack[-1].add(alias.asname or alias.name)

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        self.scope_stack[-1].add(node.name)
        self._visit_function_like(node)

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        self.scope_stack[-1].add(node.name)
        self._visit_function_like(node)

    def visit_Lambda(self, node: ast.Lambda) -> None:
        self.scope_stack.append(set())
        self._bind_args(node.args)
        self.visit(node.body)
        self.scope_stack.pop()

    def _visit_function_like(self, node: ast.AST) -> None:
        args = getattr(node, "args")
        body = getattr(node, "body")
        self.scope_stack.append(set())
        self._bind_args(args)
        for stmt in body:
            self.visit(stmt)
        self.scope_stack.pop()

    def _bind_args(self, args: ast.arguments) -> None:
        for arg in args.posonlyargs + args.args + args.kwonlyargs:
            self.scope_stack[-1].add(arg.arg)
        if args.vararg:
            self.scope_stack[-1].add(args.vararg.arg)
        if args.kwarg:
            self.scope_stack[-1].add(args.kwarg.arg)

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        self.scope_stack[-1].add(node.name)
        self.scope_stack.append({"__class__"})
        for stmt in node.body:
            self.visit(stmt)
        self.scope_stack.pop()

    def _visit_comprehension(self, node: ast.AST, value_nodes: Iterable[ast.AST], generators: list[ast.comprehension]) -> None:
        self.scope_stack.append(set())
        for gen in generators:
            self.visit(gen.iter)
            self._bind_name(gen.target)
            for cond in gen.ifs:
                self.visit(cond)
        for value_node in value_nodes:
            self.visit(value_node)
        self.scope_stack.pop()

    def visit_ListComp(self, node: ast.ListComp) -> None:
        self._visit_comprehension(node, [node.elt], node.generators)

    def visit_SetComp(self, node: ast.SetComp) -> None:
        self._visit_comprehension(node, [node.elt], node.generators)

    def visit_GeneratorExp(self, node: ast.GeneratorExp) -> None:
        self._visit_comprehension(node, [node.elt], node.generators)

    def visit_DictComp(self, node: ast.DictComp) -> None:
        self._visit_comprehension(node, [node.key, node.value], node.generators)

    def visit_ExceptHandler(self, node: ast.ExceptHandler) -> None:
        if node.type:
            self.visit(node.type)
        self.scope_stack.append(set())
        if node.name:
            self.scope_stack[-1].add(node.name)
        for stmt in node.body:
            self.visit(stmt)
        self.scope_stack.pop()

    def visit_With(self, node: ast.With) -> None:
        for item in node.items:
            self.visit(item.context_expr)
            if item.optional_vars:
                self._bind_name(item.optional_vars)
        for stmt in node.body:
            self.visit(stmt)

    def visit_AsyncWith(self, node: ast.AsyncWith) -> None:
        self.visit_With(node)  # type: ignore[arg-type]


def collect_top_level_defs(tree: ast.Module, globals_defined: set[str]) -> None:
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            globals_defined.add(node.name)
        elif isinstance(node, ast.Import):
            for alias in node.names:
                globals_defined.add(alias.asname or alias.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom):
            for alias in node.names:
                if alias.name != "*":
                    globals_defined.add(alias.asname or alias.name)
        else:
            for sub in ast.walk(node):
                if isinstance(sub, ast.Name) and isinstance(sub.ctx, ast.Store):
                    globals_defined.add(sub.id)


def check_notebook(path: Path) -> list[str]:
    with path.open("r", encoding="utf-8") as fh:
        notebook = json.load(fh)

    globals_defined: set[str] = set()
    findings: list[str] = []
    code_cell_index = 0

    for cell in notebook.get("cells", []):
        if cell.get("cell_type") != "code":
            continue
        code_cell_index += 1
        source = "".join(cell.get("source") or [])
        if not source.strip():
            continue

        try:
            tree = ast.parse(source)
        except SyntaxError as exc:
            findings.append(f"{path}:code#{code_cell_index}: SyntaxError: {exc.msg}")
            continue

        visitor = UndefinedSymbolVisitor(globals_defined)
        visitor.visit(tree)
        if visitor.undefined:
            names = ", ".join(sorted(visitor.undefined))
            findings.append(f"{path}:code#{code_cell_index}: Undefined symbols: {names}")

        collect_top_level_defs(tree, globals_defined)

    return findings


def main() -> int:
    root = Path("content/notebooks")
    notebooks = sorted(root.glob("*.ipynb"))
    findings: list[str] = []

    for notebook in notebooks:
        findings.extend(check_notebook(notebook))

    if findings:
        print("Notebook code check failed:")
        for item in findings:
            print(item)
        print(f"Total findings: {len(findings)}")
        return 1

    print(f"Notebook code check passed ({len(notebooks)} notebooks).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
