---
description: Sync this fork with upstream pi-mono and reconcile changelog/version deltas
---
You are working inside a **fork** of `pi-mono`.

Repository context:
- `origin` = this fork
- `upstream` = check by running `git remote -v`, or default to the canonical `badlogic/pi-mono` repository

Task:
1. Confirm remotes are configured correctly (`origin` fork + `upstream` canonical).
2. Fetch latest changes and tags from `upstream`.
3. Determine and report versions before syncing:
   - Current local version (from repo tags and package versions).
   - Latest upstream version/tag.
   - Whether local is behind, ahead, or equal.
4. Pull/rebase the current working branch with the latest `upstream/main` changes.
5. Audit changelog updates by diffing all `packages/*/CHANGELOG.md` files between local and `upstream/main`:
   - List which package changelogs changed.
   - Summarize what changed under each `[Unreleased]`/version section.
6. Report exactly what changed after sync:
   - Commit range integrated.
   - Files changed (high-level summary).
   - Any conflicts and required manual resolution steps.

Merge-conflict policy (required):
- For conflicts in any `CHANGELOG.md` file, always preserve upstream release history sections exactly as in upstream.
- Keep this fork's local `## [Unreleased]` entries by reapplying them on top of the merged upstream changelog.
- Never drop upstream released versions or local unreleased items; resolve by combining both with upstream history first, then fork unreleased additions.
