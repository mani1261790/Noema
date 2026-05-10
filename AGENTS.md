# AGENTS.md

This file defines repository-specific operating rules for coding agents such as Codex.

## Branch and PR Rules

- Always create a pull request when a unit of work reaches a meaningful stopping point. Do not wait until the very end of a long sequence of changes if the current work is already reviewable.
- Unless the user explicitly asks for a different target, create PRs into `develop`.
- Never continue work on top of a branch whose PR has already been merged. When additional follow-up work is needed, start from the latest `origin/develop`, create a fresh branch, and open a new PR.
- Before creating a PR, verify that it is based on the latest target branch and check whether it is conflict-free.
- Do not tell the user a PR exists until the PR has actually been created and its base branch, open state, and mergeability have been confirmed.
- Keep one branch focused on one reviewable purpose. Do not mix unrelated fixes into the same branch or PR.
- When a new request is meaningfully separate from the current branch purpose, cut a fresh branch from the latest `origin/develop` instead of extending the old one.

## Release Flow

- The normal release shape is `develop -> main`.
- Only `develop` should be used as the normal source branch for changes entering `main`.
- Do not open `feature -> main`, `fix -> main`, or `release -> main` PRs unless the user explicitly approves the deviation after the constraint has been explained.
- If `develop -> main` is conflicting, do not silently switch to a release branch into `main` as the primary answer.
- First prefer restoring a clean `develop -> main` flow by fixing the branch history or conflicts in `develop`, then open a direct PR from `develop` into `main`.
- Only use a temporary release branch into `main` if the user explicitly approves that deviation or if branch protection rules make the direct `develop -> main` route impossible and that constraint has been clearly explained.

## Protected Branches

- Treat `develop` and `main` as protected branches.
- Do not push directly to protected branches unless the user explicitly asks for it and repository rules allow it.
- If repository rules require PR-only changes, preserve that workflow. Prefer creating an intermediate branch and PR instead of asking the user to weaken protections, unless weakening a rule is the only practical path and the user agrees.
- Do not make direct content changes against `main`. All normal production-bound changes should first land in `develop`.
- Treat any operation that changes `main` history or content as exceptional and require explicit user approval plus a clear reason.

## Commit and Push Discipline

- Create commits by work unit, not only at the very end. A commit should represent one coherent change that can be described in a single sentence.
- Do not mix refactors, bug fixes, content edits, and release plumbing into one commit unless they are inseparable.
- Before creating a commit, make sure the relevant verification for that work unit has been run if feasible.
- Pushes should happen at feature or review checkpoints, not after every tiny edit.
- Before pushing a branch with new meaningful changes, tell the user what is being pushed and get confirmation when the push represents a new feature slice, a release step, or a PR update they may want to review first.
- If the user has already clearly asked to finish the task end-to-end including PR creation, that counts as approval to push the branch needed for that PR.
- Do not force-push unless it is truly necessary and the user has approved it.

## Branch Creation and Freshness

- Before starting implementation, check whether the current branch is still the right place for the task.
- If the current branch already has a merged PR, abandon it and start a new branch from the latest `origin/develop`.
- If a branch is tied to an open PR, keep subsequent commits on that branch only if they are in-scope for that same PR.
- For follow-up fixes after merge, always create a new branch and a new PR.

## Conflict Handling

- When resolving conflicts, preserve the latest intended behavior from the target line of development rather than mechanically preferring one side.
- After conflict resolution, run the relevant verification again before reporting the branch ready.
- If a conflict fix exists only to repair branch history with no content delta, state that explicitly in the PR description.
- If a conflict is caused by branch history rather than file content, explain that distinction clearly to the user before choosing a workaround.
- Do not hide a process deviation inside conflict resolution. If you must change branch flow because of protection rules or history shape, say so explicitly.

## Git Hygiene

- Keep unrelated untracked or generated files untouched unless they are part of the requested task.
- Do not delete branches just because they exist. Delete only branches that are confirmed merged or explicitly identified as unnecessary.
- When cleaning up old PRs, prefer closing superseded PRs with a short note that points to the replacement PR.
- When reporting branch cleanup, distinguish between local branch deletion, remote branch deletion, and PR closure.
- When a PR is superseded, create and verify the replacement PR before closing the old one.
