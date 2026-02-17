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

MAX_CODE_CHARS = 20000
MAX_EXPECTED_MODULES = 24
EXEC_TIMEOUT_SECONDS = 12
TMP_SITE_PACKAGES = "/tmp/noema-site-packages"
BASE_MODULES_RAW = os.environ.get(
    "NOEMA_BASE_MODULES",
    "numpy,pandas,scipy,matplotlib,sklearn,seaborn,sympy,statsmodels,networkx",
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
import contextlib
import io
import json
import sys
import traceback

payload = json.loads(sys.stdin.read() or "{}")
code = payload.get("code", "")

stdout_buffer = io.StringIO()
stderr_buffer = io.StringIO()

ok = True
error = None

scope = {"__name__": "__main__"}

try:
    with contextlib.redirect_stdout(stdout_buffer), contextlib.redirect_stderr(stderr_buffer):
        exec(compile(code, "<noema-exec>", "exec"), scope, scope)
except Exception:
    ok = False
    error = "Python execution failed"
    traceback.print_exc(file=stderr_buffer)

print(
    json.dumps(
        {
            "ok": ok,
            "error": error,
            "stdout": stdout_buffer.getvalue(),
            "stderr": stderr_buffer.getvalue(),
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


def _install_package(module_name: str) -> tuple[bool, str]:
    package_name = _module_to_package(module_name)
    if package_name in installed_packages:
        return True, package_name
    if package_name in failed_packages:
        return False, package_name

    os.makedirs(TMP_SITE_PACKAGES, exist_ok=True)

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

    env = dict(os.environ)
    existing = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = f"{TMP_SITE_PACKAGES}:{existing}" if existing else TMP_SITE_PACKAGES

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
    os.makedirs(TMP_SITE_PACKAGES, exist_ok=True)

    env = dict(os.environ)
    existing = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = f"{TMP_SITE_PACKAGES}:{existing}" if existing else TMP_SITE_PACKAGES

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
        }

    if completed.returncode != 0:
        return {
            "ok": False,
            "timedOut": False,
            "stdout": "",
            "stderr": (completed.stderr or "Python runner process failed."),
            "error": "Python runner process failed.",
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
        }

    return {
        "ok": bool(payload.get("ok", False)),
        "timedOut": False,
        "stdout": str(payload.get("stdout", "")),
        "stderr": str(payload.get("stderr", "")),
        "error": str(payload.get("error") or "") or None,
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
