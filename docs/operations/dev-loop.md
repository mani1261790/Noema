# Development Loop (Commit/Review/Push)

Use this loop for each implementation block.

## 1. Implement

- Make one cohesive set of changes.
- Keep scope tight enough to review quickly.

## 2. Local checks

Run at minimum:

```bash
npm run build:notebooks
npm run typecheck
npm run lint
npm run build
```

If infra changed:

```bash
cd infra
npm run build
npm run synth
```

## 3. Commit

```bash
git add .
git commit -m "<scope>: <summary>"
```

## 4. Codex review gate

- Ask Codex for review findings only (bugs/regressions/security/test gaps).
- Fix all high/major findings.
- Re-run checks.

## 5. Push

```bash
git push
```

## 6. Next task selection

- Identify next highest-impact task.
- Repeat from step 1.

## Maintenance phase target

Continue this loop until:

- CI is green on `main`.
- Deployment playbook is reproducible.
- Incident runbook exists and on-call steps are documented.
- KPI monitoring is visible and actionable.
