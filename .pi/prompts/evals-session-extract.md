---
description: Extract recent named pi sessions into reproducible HTML artifacts before evaluation/analysis
---

Generate the pi session extraction artifacts for the current project: $ARGUMENTS

This prompt is for extraction only.

## Inputs

Optional arguments may override selection:

- first numeric arg or num_sessions: number of named sessions to include, default to 5 if not explicitly stated
- non-numeric args: explicit session names or session file paths to include

## Behaviour

1. Resolve the session directory for the current cwd.
2. Find named sessions using the latest `session_info.name` in each session file.
3. Select sessions the args
4. Generate these extraction artifacts in the project root:
   - `pi-session-summary.html`
   - `pi-session-jsonl-viewer.html`
5. Keep raw JSON exact.
6. Do not do final analysis or repo recommendations in this step.

## Required report

Return a short extraction report with exactly these sections:

1. **Selected sessions**
   - session name
   - session file
   - timestamp span

2. **Outputs**
   - exact output paths for:
     - `pi-session-summary.html`
     - `pi-session-jsonl-viewer.html`

3. **System prompt availability**
   - explicitly say whether `systemPrompt` is unavailable in the selected raw session sources
   - if unavailable, say that later prompt tracking should use `/share:system-prompt`

## Guardrails & Fail Fast

- If the session directory does not exist, stop and report that clearly.
- If no named sessions are found, stop and report that clearly.
- If explicit session names are requested and some are missing, report which ones were not found.
