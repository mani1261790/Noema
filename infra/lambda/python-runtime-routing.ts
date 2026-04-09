export const HEAVY_PYTHON_MODULES = new Set([
  "torch",
  "xgboost"
]);

export function normalizePythonModuleName(value: string): string {
  const moduleName = value.trim().split(".")[0].replace(/-/g, "_").toLowerCase();
  if (!moduleName) return "";
  if (!/^[a-z_][a-z0-9_]*$/.test(moduleName)) return "";
  return moduleName;
}

export function extractImportedPythonModules(code: string): string[] {
  if (!code) return [];
  const seen = new Set<string>();
  const lines = code.split(/\r?\n/);

  const importPattern = /^\s*import\s+([A-Za-z0-9_.,\s]+)(?:\s+as\s+[A-Za-z0-9_]+)?\s*$/;
  const fromPattern = /^\s*from\s+([A-Za-z0-9_\.]+)\s+import\s+/;

  for (const line of lines) {
    if (seen.size >= 24) break;
    const fromMatch = line.match(fromPattern);
    if (fromMatch) {
      const moduleName = normalizePythonModuleName(fromMatch[1]);
      if (moduleName) seen.add(moduleName);
      continue;
    }

    const importMatch = line.match(importPattern);
    if (!importMatch) continue;
    const rawModules = importMatch[1].split(",");
    for (const rawModule of rawModules) {
      if (seen.size >= 24) break;
      const noAlias = rawModule.split(/\s+as\s+/i)[0];
      const moduleName = normalizePythonModuleName(noAlias);
      if (moduleName) seen.add(moduleName);
    }
  }

  return Array.from(seen);
}

export function selectPythonRunnerFunctionName(
  expectedModules: string[],
  importsFromCode: string[],
  standardFunctionName: string,
  heavyFunctionName: string
): string {
  if (!heavyFunctionName) {
    return standardFunctionName;
  }
  const candidates = new Set<string>([...importsFromCode, ...expectedModules]);
  for (const moduleName of candidates) {
    if (HEAVY_PYTHON_MODULES.has(moduleName)) {
      return heavyFunctionName;
    }
  }
  return standardFunctionName;
}

export function stripHeavyPythonModules(modules: string[]): string[] {
  return modules.filter((moduleName) => !HEAVY_PYTHON_MODULES.has(moduleName));
}
