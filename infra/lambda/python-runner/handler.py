import io
import json
import os
import re
import subprocess
import sys
import threading
import time
import traceback
from typing import Any

MAX_CODE_CHARS = 120000
MAX_EXPECTED_MODULES = 24
EXEC_TIMEOUT_SECONDS = 18
TMP_SITE_PACKAGES = "/tmp/noema-site-packages"
TMP_RUNTIME_HOME = "/tmp/noema-home"
TMP_XDG_CONFIG_HOME = "/tmp/noema-config"
TMP_MPL_CONFIG_DIR = "/tmp/noema-mplconfig"
BASE_MODULES_RAW = os.environ.get(
    "NOEMA_BASE_MODULES",
    "",
)

PACKAGE_MAP = {
    "sklearn": "scikit-learn",
    "PIL": "pillow",
    "cv2": "opencv-python-headless",
    "yaml": "pyyaml",
    "bs4": "beautifulsoup4",
    "skimage": "scikit-image",
    "xgboost": "xgboost",
}

MODULE_RE = re.compile(r"No module named ['\"]([^'\"]+)['\"]")

EXEC_WRAPPER = r'''
import ast
import base64
import contextlib
import io
import json
import sys
import traceback

payload = json.loads(sys.stdin.read() or "{}")
code = payload.get("code", "")

stdout_buffer = io.StringIO()
stderr_buffer = io.StringIO()
outputs = []

ok = True
error = None

scope = {"__name__": "__main__"}

MAX_TEXT_CHARS = 120_000
MAX_HTML_CHARS = 150_000
MAX_IMAGES = 2
MAX_IMAGE_BYTES = 450_000

def _truncate(text, limit):
    if not isinstance(text, str):
        text = str(text)
    if len(text) <= limit:
        return text
    return text[:limit] + "\n... [truncated]"

def _append_value_output(value):
    if value is None:
        return

    try:
        to_html = getattr(value, "to_html", None)
        if callable(to_html):
            html = to_html()
            if isinstance(html, str) and html.strip():
                outputs.append(
                    {
                        "type": "text/html",
                        "html": _truncate(html, MAX_HTML_CHARS),
                    }
                )
    except Exception:
        pass

    try:
        value_repr = repr(value)
    except Exception:
        value_repr = str(value)

    if value_repr and value_repr != "None":
        outputs.append(
            {
                "type": "text/plain",
                "text": _truncate(value_repr, MAX_TEXT_CHARS),
            }
        )

def _append_matplotlib_outputs():
    try:
        import matplotlib
    except Exception:
        return
    try:
        matplotlib.use("Agg")
    except Exception:
        pass
    try:
        import matplotlib.pyplot as plt
    except Exception:
        return

    fignums = list(plt.get_fignums())
    for index, fig_num in enumerate(fignums[:MAX_IMAGES], start=1):
        buffer = None
        try:
            fig = plt.figure(fig_num)
            buffer = io.BytesIO()
            fig.savefig(buffer, format="png", bbox_inches="tight")
            raw = buffer.getvalue()
            if len(raw) > MAX_IMAGE_BYTES:
                continue
            outputs.append(
                {
                    "type": "image/png",
                    "data": base64.b64encode(raw).decode("ascii"),
                    "alt": f"plot-{index}",
                }
            )
        except Exception:
            continue
        finally:
            try:
                buffer.close()
            except Exception:
                pass

    if fignums:
        try:
            plt.close("all")
        except Exception:
            pass

try:
    parsed = ast.parse(code, mode="exec")
    trailing_expr = None
    if parsed.body and isinstance(parsed.body[-1], ast.Expr):
        trailing_expr = parsed.body.pop().value

    with contextlib.redirect_stdout(stdout_buffer), contextlib.redirect_stderr(stderr_buffer):
        exec(compile(parsed, "<noema-exec>", "exec"), scope, scope)
        if trailing_expr is not None:
            value = eval(compile(ast.Expression(trailing_expr), "<noema-exec>", "eval"), scope, scope)
            _append_value_output(value)
        _append_matplotlib_outputs()
except Exception as exc:
    ok = False
    error = f"{exc.__class__.__name__}: {exc}"
    traceback.print_exc(file=stderr_buffer)

print(
    json.dumps(
        {
            "ok": ok,
            "error": error,
            "stdout": stdout_buffer.getvalue(),
            "stderr": stderr_buffer.getvalue(),
            "outputs": outputs,
        },
        ensure_ascii=False,
    )
)
'''

installed_packages: set[str] = set()
failed_packages: set[str] = set()
install_lock = threading.Lock()
base_preload_lock = threading.Lock()
base_preload_done = False


def _safe_int_env(name: str, default: int, minimum: int, maximum: int) -> int:
    raw = os.environ.get(name, str(default))
    try:
        parsed = int(raw)
    except Exception:
        parsed = default
    return max(minimum, min(maximum, parsed))


PIP_TIMEOUT_SECONDS = _safe_int_env("NOEMA_PIP_TIMEOUT_SECONDS", 120, 30, 600)


def _coerce_modules(raw: Any) -> list[str]:
    if not isinstance(raw, list):
        return []

    modules: list[str] = []
    seen = set()
    for item in raw:
        if len(modules) >= MAX_EXPECTED_MODULES:
            break
        base = str(item).strip().split(".")[0]
        if not base:
            continue
        if not re.match(r"^[A-Za-z_][A-Za-z0-9_]*$", base):
            continue
        if base in seen:
            continue
        seen.add(base)
        modules.append(base)

    return modules


def _coerce_modules_from_csv(raw: str) -> list[str]:
    if not raw:
        return []
    return _coerce_modules([value.strip() for value in raw.split(",") if value.strip()])


BASE_MODULES = _coerce_modules_from_csv(BASE_MODULES_RAW)


def _module_to_package(module_name: str) -> str:
    return PACKAGE_MAP.get(module_name, module_name)


def _extract_missing_module(stderr_text: str) -> str:
    match = MODULE_RE.search(stderr_text or "")
    if not match:
        return ""
    return match.group(1).split(".")[0]


def _build_runtime_env() -> dict[str, str]:
    os.makedirs(TMP_SITE_PACKAGES, exist_ok=True)
    os.makedirs(TMP_RUNTIME_HOME, exist_ok=True)
    os.makedirs(TMP_XDG_CONFIG_HOME, exist_ok=True)
    os.makedirs(TMP_MPL_CONFIG_DIR, exist_ok=True)

    env = dict(os.environ)
    existing = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = f"{TMP_SITE_PACKAGES}:{existing}" if existing else TMP_SITE_PACKAGES
    env["HOME"] = TMP_RUNTIME_HOME
    env["XDG_CONFIG_HOME"] = TMP_XDG_CONFIG_HOME
    env["MPLCONFIGDIR"] = TMP_MPL_CONFIG_DIR
    return env


def _install_package(module_name: str) -> tuple[bool, str]:
    package_name = _module_to_package(module_name)
    if package_name in installed_packages:
        return True, package_name
    if package_name in failed_packages:
        return False, package_name

    cmd = [
        sys.executable,
        "-m",
        "pip",
        "install",
        "--disable-pip-version-check",
        "--quiet",
        "--target",
        TMP_SITE_PACKAGES,
        package_name,
    ]

    env = _build_runtime_env()

    with install_lock:
        if package_name in installed_packages:
            return True, package_name

        try:
            result = subprocess.run(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                timeout=PIP_TIMEOUT_SECONDS,
                env=env,
                check=False,
            )
        except subprocess.TimeoutExpired:
            return False, package_name

        if result.returncode != 0:
            failed_packages.add(package_name)
            return False, package_name

        installed_packages.add(package_name)
        failed_packages.discard(package_name)
        return True, package_name


def _ensure_base_modules() -> tuple[list[str], list[str]]:
    global base_preload_done
    if base_preload_done:
        return [], []

    with base_preload_lock:
        if base_preload_done:
            return [], []
        base_preload_done = True
        return _preload_modules(BASE_MODULES)


def _run_code_once(code: str, timeout_seconds: int) -> dict[str, Any]:
    env = _build_runtime_env()

    try:
        completed = subprocess.run(
            [sys.executable, "-c", EXEC_WRAPPER],
            input=json.dumps({"code": code}, ensure_ascii=False),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            timeout=timeout_seconds,
            env=env,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return {
            "ok": False,
            "timedOut": True,
            "stdout": "",
            "stderr": "Execution timed out.",
            "error": "Execution timed out.",
            "outputs": [],
        }

    if completed.returncode != 0:
        return {
            "ok": False,
            "timedOut": False,
            "stdout": "",
            "stderr": (completed.stderr or "Python runner process failed."),
            "error": "Python runner process failed.",
            "outputs": [],
        }

    try:
        payload = json.loads(completed.stdout or "{}")
    except json.JSONDecodeError:
        return {
            "ok": False,
            "timedOut": False,
            "stdout": "",
            "stderr": "Python runner response decode failed.",
            "error": "Python runner response decode failed.",
            "outputs": [],
        }

    return {
        "ok": bool(payload.get("ok", False)),
        "timedOut": False,
        "stdout": str(payload.get("stdout", "")),
        "stderr": str(payload.get("stderr", "")),
        "error": str(payload.get("error") or "") or None,
        "outputs": payload.get("outputs") if isinstance(payload.get("outputs"), list) else [],
    }


def _preload_modules(modules: list[str]) -> tuple[list[str], list[str]]:
    installed: list[str] = []
    failed: list[str] = []
    for module_name in modules:
        ok, package_name = _install_package(module_name)
        if ok:
            installed.append(package_name)
        else:
            failed.append(module_name)

    # keep ordering stable while removing duplicates
    installed = list(dict.fromkeys(installed))
    failed = list(dict.fromkeys(failed))
    return installed, failed


def _execute_with_auto_install(code: str, modules_hint: list[str]) -> dict[str, Any]:
    installed, failed = _preload_modules(modules_hint)

    start = time.time()
    result = _run_code_once(code, EXEC_TIMEOUT_SECONDS)
    timed_out = bool(result.get("timedOut"))

    if not result.get("ok") and not timed_out:
        missing_module = _extract_missing_module(str(result.get("stderr") or ""))
        if missing_module:
            ok, package_name = _install_package(missing_module)
            if ok:
                installed.append(package_name)
                result = _run_code_once(code, EXEC_TIMEOUT_SECONDS)
                timed_out = bool(result.get("timedOut"))

    duration_ms = int((time.time() - start) * 1000)

    return {
        "stdout": str(result.get("stdout") or ""),
        "stderr": str(result.get("stderr") or ""),
        "error": result.get("error"),
        "timedOut": timed_out,
        "durationMs": duration_ms,
        "installedPackages": list(dict.fromkeys(installed)),
        "failedModules": failed,
        "outputs": result.get("outputs") if isinstance(result.get("outputs"), list) else [],
    }


def lambda_handler(event: dict[str, Any], _context: Any) -> dict[str, Any]:
    try:
        action = str(event.get("action", "execute")).strip().lower()
        modules_hint = _coerce_modules(event.get("expectedModules"))
        base_installed, base_failed = _ensure_base_modules()

        if action == "preload":
            installed, failed = _preload_modules(modules_hint)
            return {
                "ok": True,
                "installedPackages": list(dict.fromkeys(base_installed + installed)),
                "failedModules": list(dict.fromkeys(base_failed + failed)),
            }

        code = str(event.get("code") or "")
        if not code.strip():
            return {
                "stdout": "",
                "stderr": "",
                "error": "Code is required.",
                "timedOut": False,
                "durationMs": 0,
                "installedPackages": [],
                "failedModules": [],
            }

        if len(code) > MAX_CODE_CHARS:
            return {
                "stdout": "",
                "stderr": "",
                "error": f"Code is too long (max {MAX_CODE_CHARS} characters).",
                "timedOut": False,
                "durationMs": 0,
                "installedPackages": [],
                "failedModules": [],
            }

        result = _execute_with_auto_install(code, modules_hint)
        result["installedPackages"] = list(dict.fromkeys(base_installed + list(result.get("installedPackages", []))))
        result["failedModules"] = list(dict.fromkeys(base_failed + list(result.get("failedModules", []))))
        return result
    except Exception:
        return {
            "stdout": "",
            "stderr": traceback.format_exc(),
            "error": "Unhandled python runner error.",
            "timedOut": False,
            "durationMs": 0,
            "installedPackages": [],
            "failedModules": [],
        }
