# AGENTS.md

This file defines repository-specific operating rules for coding agents such as Codex.

## Branch and PR Rules

- Always create a pull request when a unit of work reaches a meaningful stopping point. Do not wait until the very end of a long sequence of changes if the current work is already reviewable.
- Unless the user explicitly asks for a different target, create PRs into `develop`.
- Never continue work on top of a branch whose PR has already been merged. When additional follow-up work is needed, start from the latest `origin/develop`, create a fresh branch, and open a new PR.
- Before creating a PR, verify that it is based on the latest target branch and check whether it is conflict-free.
- Do not tell the user a PR exists until the PR has actually been created and its base branch, open state, and mergeability have been confirmed.

## Release Flow

- The normal release shape is `develop -> main`.
- If `develop -> main` is conflicting, do not silently switch to a release branch into `main` as the primary answer.
- First prefer restoring a clean `develop -> main` flow by fixing the branch history or conflicts in `develop`, then open a direct PR from `develop` into `main`.
- Only use a temporary release branch into `main` if the user explicitly approves that deviation or if branch protection rules make the direct `develop -> main` route impossible and that constraint has been clearly explained.

## Protected Branches

- Treat `develop` and `main` as protected branches.
- Do not push directly to protected branches unless the user explicitly asks for it and repository rules allow it.
- If repository rules require PR-only changes, preserve that workflow. Prefer creating an intermediate branch and PR instead of asking the user to weaken protections, unless weakening a rule is the only practical path and the user agrees.

## Conflict Handling

- When resolving conflicts, preserve the latest intended behavior from the target line of development rather than mechanically preferring one side.
- After conflict resolution, run the relevant verification again before reporting the branch ready.
- If a conflict fix exists only to repair branch history with no content delta, state that explicitly in the PR description.

## Git Hygiene

- Keep unrelated untracked or generated files untouched unless they are part of the requested task.
- Do not delete branches just because they exist. Delete only branches that are confirmed merged or explicitly identified as unnecessary.
- When cleaning up old PRs, prefer closing superseded PRs with a short note that points to the replacement PR.
