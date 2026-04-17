import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { resolveNotebookSourcePath } from '../src/lib/notebook-artifacts';
import {
  extractImportedPythonModules,
  selectPythonRunnerFunctionName,
  stripHeavyPythonModules
} from '../infra/lambda/python-runtime-routing';

function checkRouting() {
  const code = [
    'import numpy as np',
    'import torch',
    'import torch.nn as nn'
  ].join('\n');
  const imports = extractImportedPythonModules(code);
  assert.deepEqual(imports, ['numpy', 'torch']);

  const selected = selectPythonRunnerFunctionName(imports, imports, 'standard-runner', 'heavy-runner');
  assert.equal(selected, 'heavy-runner');

  const stripped = stripHeavyPythonModules(['numpy', 'torch', 'xgboost', 'matplotlib']);
  assert.deepEqual(stripped, ['numpy', 'matplotlib']);
}

function checkGuardedTorchCellOnStandardRunner() {
  const handlerPath = path.join(process.cwd(), 'infra/lambda/python-runner/handler.py');
  const source = [
    'import numpy as np',
    'import matplotlib.pyplot as plt',
    '',
    'try:',
    '    import torch',
    '    import torch.nn as nn',
    '    import torch.optim as optim',
    '    TORCH_AVAILABLE = True',
    'except ModuleNotFoundError:',
    '    torch = None',
    '    nn = None',
    '    optim = None',
    '    TORCH_AVAILABLE = False',
    '',
    'np.random.seed(42)',
    "print('TORCH_AVAILABLE =', TORCH_AVAILABLE)",
  ].join('\n');

  const python = [
    'import importlib.util, json',
    `spec = importlib.util.spec_from_file_location('noema_runner', r'''${handlerPath}''')`,
    'module = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(module)',
    'event = {"action": "execute", "code": ' + JSON.stringify(source) + ', "contextCode": "", "expectedModules": ["numpy", "matplotlib"], "blockedModules": ["torch"]}',
    'result = module.lambda_handler(event, None)',
    'print(json.dumps(result))'
  ].join('\n');

  const completed = spawnSync('python3', ['-c', python], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      MPLBACKEND: 'Agg',
    }
  });

  assert.equal(completed.status, 0, completed.stderr || completed.stdout);
  const lines = completed.stdout.trim().split(/\n/);
  const payload = JSON.parse(lines[lines.length - 1] || '{}') as {
    error?: string | null;
    timedOut?: boolean;
    stdout?: string;
  };

  assert.equal(payload.timedOut, false, 'guarded torch cell timed out');
  assert.equal(payload.error ?? null, null, payload.error || 'unexpected runner error');
  assert.match(String(payload.stdout || ''), /TORCH_AVAILABLE = (True|False)/, 'guarded torch cell did not complete');
}

function checkNotebookFirstCell(notebookPath: string) {
  const notebook = JSON.parse(fs.readFileSync(notebookPath, 'utf8')) as {
    cells?: Array<{ cell_type?: string; source?: string[] | string }>;
  };
  const sourceText = (source: string[] | string | undefined) =>
    Array.isArray(source) ? source.join('') : String(source || '');
  const firstCode = (notebook.cells || [])
    .find((cell) => cell.cell_type === 'code' && sourceText(cell.source).trim());

  assert.ok(firstCode, `No code cell found in ${notebookPath}`);

  const handlerPath = path.join(process.cwd(), 'infra/lambda/python-runner/handler.py');
  const python = [
    'import importlib.util, json',
    `spec = importlib.util.spec_from_file_location('noema_runner', r'''${handlerPath}''')`,
    'module = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(module)',
    'event = {"action": "execute", "code": ' + JSON.stringify(sourceText(firstCode?.source)) + ', "contextCode": "", "expectedModules": ["numpy", "matplotlib"], "blockedModules": ["torch"]}',
    'result = module.lambda_handler(event, None)',
    'print(json.dumps(result))'
  ].join('\n');

  const completed = spawnSync('python3', ['-c', python], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      MPLBACKEND: 'Agg',
    }
  });

  assert.equal(completed.status, 0, completed.stderr || completed.stdout);
  const lines = completed.stdout.trim().split(/\n/);
  const payload = JSON.parse(lines[lines.length - 1] || '{}') as { error?: string | null; timedOut?: boolean };
  assert.equal(payload.timedOut, false, `Notebook first cell timed out: ${notebookPath}`);
  assert.equal(payload.error ?? null, null, `Notebook first cell failed: ${notebookPath}: ${payload.error || 'unknown'}`);
}

async function main() {
  checkRouting();
  checkGuardedTorchCellOnStandardRunner();
  checkNotebookFirstCell(await resolveNotebookSourcePath('neural-network-basics'));
  console.log('Python runtime safety checks passed.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
