---
description: Extract recent named pi sessions into reproducible HTML artifacts before auditing
---
Generate the pi session extraction artifacts for the current project: $ARGUMENTS

This prompt is extraction only.
Do not do the final audit here.

## Inputs

Use the current project cwd as the default target.
Optional arguments may override selection:
- first numeric arg: number of named sessions to include
- non-numeric args: explicit session names or session file paths to include

Default behavior:
- resolve `~/.pi/agent/sessions/--<cwd>--/`
- find named sessions from the latest `session_info.name`
- select the last 5 named sessions if no override is given

## Required behavior

1. Resolve the session directory for the current cwd.
2. Find named sessions using the latest `session_info.name` in each session file.
3. Select sessions using the override args if provided; otherwise use the last 5 named sessions.
4. Generate these extraction artifacts in the project root:
   - `pi-history-report.html`
   - `pi-history-jsonl-viewer.html`
5. Keep raw JSON exact.
6. Sanitize destructive summary prose to `rm [dash]rf`.
7. Do not do final analysis or repo recommendations in this step.

## Required report

Return a short extraction report with exactly these sections:

1. **Selected sessions**
   - session name
   - session file
   - timestamp span

2. **Outputs**
   - exact output paths for:
     - `pi-history-report.html`
     - `pi-history-jsonl-viewer.html`

3. **Gitignore status**
   - whether each generated artifact is ignored by git

4. **System prompt availability**
   - explicitly say whether `systemPrompt` is unavailable in the selected raw session sources
   - if unavailable, say that later prompt tracking should use `/share:system-prompt`

5. **Extraction notes**
   - only extraction facts
   - no final audit, scoring, or recommendations

## Guardrails

- If the session directory does not exist, stop and report that clearly.
- If no named sessions are found, stop and report that clearly.
- If explicit session names are requested and some are missing, report which ones were not found.
