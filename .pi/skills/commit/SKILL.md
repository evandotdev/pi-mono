---
name: commit
description: Read this skill before making git commits.
---

Create a git commit for the current changes using a concise Conventional Commits-style subject.

## Format

```text
<type>(scope): <description>
```

- `type`: (REQUIRED) Use one of fix, feat, build, chore, ci, docs, style, refactor, perf, test
- `scope`: (OPTIONAL) e.g. api, docs, ui, you can also run the following command to see existing type and scopes in the current repository:

- `description`: (REQUIRED) Short, imperative, <= 72 chars, no trailing period.

## Notes

- Body is OPTIONAL. If needed, add a blank line after the subject and write a short paragraph.
- Do NOT include breaking-change markers or footers.
- Do NOT add sign-offs (no `Signed-off-by`).
- Only commit; do NOT push.
- If it is unclear whether a file should be included, ask the user which files to commit.
- Treat any caller-provided arguments as additional commit guidance. Common patterns:
  - Freeform instructions should influence scope, summary, and body.
  - File paths or globs should limit which files to commit. If files are specified, only stage/commit those unless the user explicitly asks otherwise.
  - If arguments combine files and instructions, honor both.

## Steps

1. Infer from the prompt if the user provided specific file paths/globs and/or additional instructions.
2. Review `git status` and `git diff` to understand the current changes (limit to argument-specified files if provided). Note that git diff will not include untracked files.
3. (Optional) Run the following command to see commonly used scopes.

```bash
# Try this first
git log --pretty=format:%s \
| grep -E '^(feat|fix|build|chore|ci|docs|style|refactor|perf|test|revert)(\([^()]+\))?(!)?: ' \
| cut -d: -f1 \
| sort -u
# If error occurs, use this instead:
git log -n 50 --pretty=format:%s
```

4. If there are ambiguous extra files, ask the user for clarification before committing.
5. Stage only the intended files (all changes if no files specified).
6. Run `git commit -m "<subject>"` (and `-m "<body>"` if needed).
