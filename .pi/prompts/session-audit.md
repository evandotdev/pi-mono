---
description: Audit extracted pi session artifacts with exact metrics, wrong-turn detection, and repo recommendations
---
Audit the extracted pi session artifacts: $ARGUMENTS

Canonical inputs:
- `@pi-history-report.html`
- `@pi-history-jsonl-viewer.html`
- optional `/share:system-prompt` artifacts

## Guard

If `pi-history-report.html` or `pi-history-jsonl-viewer.html` is missing, stop immediately and tell the user to run `/evals-extract-pi-sessions` first.

Do not fall back to raw session discovery in this prompt.

## Source priority

1. Use `pi-history-report.html` for extracted metrics and summary structure.
2. Use `pi-history-jsonl-viewer.html` to verify exact raw entries, commands, and counts.
3. Prefer `/share:system-prompt` artifacts for prompt tracking.
4. If a requested metric is not derivable from the attached artifacts, report `unavailable` and name the missing source.

## Classification rules

### Tool-call buckets
Count tool calls by tool name:
- `bash`
- `read`
- `write`
- `edit`
- `other`

### Bash command categories
Classify each bash command into exactly one bucket:
- `search`: `rg`, `grep`, `find`, `fd`, `ps ... | grep`, and similar discovery commands
- `inspect`: `ls`, `tree`, `pwd`, `wc`, `head`, `tail`, `sed`, `cat`, `jq`, and similar inspection commands
- `gitInspect`: `git status`, `git diff`, `git log`, `git show`, `git branch`, `git rev-parse`, and similar non-mutating git inspection
- `build`: `npm run check`, `npm test`, `npm exec`, `tsc`, and similar build/test commands
- `mutate`: `git add`, `git restore`, `git checkout`, `git reset`, `git commit`, `git merge`, `git rebase`, `git stash`, `rm`, `chmod`, `mv`, `cp`, and similar file-changing commands
- `mise`: `mise` commands
- `script`: `node`, `python`, or similar ad hoc scripts
- `other`: anything else

### Rollback signals
Flag these as rollback signals:
- `git restore`
- `git checkout`
- `git reset`
- `git clean`
- `rm [dash]rf`

### Planning mode
Track planning mode separately from thinking level:
- `planning mode active` if the artifacts show explicit plan mode, `/plan`, or equivalent structured planning state
- `planning mode unknown` if nothing explicit is present
- do not infer planning mode from writing style alone

## Required report sections

Produce these sections, in this order:

1. **Session inventory**
   - session name
   - file path
   - start time
   - end time
   - span
   - first user prompt
   - last assistant synthesis

2. **Per-session metrics**
   - total entries
   - entry-type counts: `user`, `assistant`, `toolResult`, `session_info`, `model_change`, `thinking_level_change`, `compaction`, `branch_summary`, `custom_message`
   - tool-call counts: `bash`, `read`, `write`, `edit`, `other`
   - bash-category counts: `search`, `inspect`, `gitInspect`, `build`, `mutate`, `mise`, `script`, `other`
   - discovery count and discovery ratio
   - mutation count and mutation ratio
   - rollback-signal count
   - tool errors
   - tokens: `input`, `output`, `cacheRead`, `cacheWrite`, `totalTokens`
   - cost: `input`, `output`, `cacheRead`, `cacheWrite`, `total`
   - model changes
   - thinking changes
   - planning mode
   - compactions
   - branch summaries

3. **Commands**
   - representative commands
   - category tag for each command
   - wrong turns and recovery points

4. **Hotspots**
   - top read paths
   - top write paths
   - top edit paths

5. **Cross-session comparison**
   - most discovery
   - most mutations
   - highest cost
   - most rollback signals
   - repeated command patterns

6. **Derived effectiveness metrics**
   For each of these, compute it or report `unavailable` with the missing source:
   - task success rate
   - first-pass success rate
   - time to first useful edit
   - time to first correct file
   - time to green
   - iterations to green
   - search-before-edit ratio
   - repeated-search rate
   - file focus entropy
   - read-before-write precision
   - exploration debt
   - revert rate
   - diff churn ratio
   - dead-end branch count
   - tool selection quality
   - tool retry rate
   - bash success rate
   - truncation rate
   - user intervention load
   - abort recovery time
   - prompt sensitivity
   - model sensitivity
   - cost per successful task
   - tokens per accepted LOC
   - compaction penalty
   - planning adherence
   - plan rewrite count
   - safety incident rate
   - post-task defect rate

7. **System prompt tracking**
   - if `/share:system-prompt` artifacts are attached, summarize prompt hashes and group identical prompts
   - if no prompt-sharing artifacts are attached, say that prompt tracking is unavailable from the current inputs

8. **Repo recommendations**
   - concrete `pi-mono` changes that would have reduced search loops, wrong turns, or recovery cost
   - keep recommendations file-oriented and implementation-oriented
