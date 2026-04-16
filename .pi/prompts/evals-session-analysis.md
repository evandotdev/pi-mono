---
description: Evaluate/analyse extracted pi session artifacts with exact metrics, wrong-turn detection, and repo recommendations
---

Audit the extracted pi session artifacts: $ARGUMENTS

Canonical inputs:

- the outputs from `evals-session-extract.md` prompt
  - If either of the files below are missing, stop immediately and tell the user to run `/evals-session-extract` first.
  - `pi-session-summary.html`
  - `pi-session-jsonl-viewer.html`

## Guardrails & Fail fast

Do not fall back to raw session discovery in this prompt.

## Source priority

1. Use `pi-session-summary.html` for extracted metrics and summary structure.
2. Use `pi-session-jsonl-viewer.html` to verify exact raw entries, commands, and counts.
3. If a requested metric is not derivable from these two files, report `unavailable` and name the missing source.

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
   For each metric below, compute it or report `unavailable` with the missing source.

   | Metric                      | Why it matters                        | How to measure                                                       |
   | --------------------------- | ------------------------------------- | -------------------------------------------------------------------- |
   | Task success rate           | Primary effectiveness signal          | User-approved completion / total tasks                               |
   | First-pass success rate     | Measures prompt/tool quality          | Tasks accepted without rerun, rollback, or major restatement         |
   | Time to first useful edit   | Shows how fast pi becomes productive  | First write/edit that survives into final diff                       |
   | Time to first correct file  | Good for tool/system-prompt changes   | Time until first touched file that is in final accepted diff         |
   | Time to green               | Great for coding tasks                | Time until `npm run check` first passes                              |
   | Iterations to green         | Shows repair efficiency               | Failed check runs before first clean run                             |
   | Search-before-edit ratio    | Detects thrash                        | Discovery commands before first write/edit                           |
   | Repeated-search rate        | Detects uncertainty                   | Duplicate or near-duplicate `rg`/`find`/`grep`/`git status` calls    |
   | File focus entropy          | Measures scatter vs focus             | Entropy of read/write/edit targets per session                       |
   | Read-before-write precision | Good tool/prompt signal               | % of modified files that were read first                             |
   | Exploration debt            | Detects wasted context                | Files read but never touched in final diff                           |
   | Revert rate                 | Strong wrong-direction signal         | Reverted files / touched files                                       |
   | Diff churn ratio            | Measures wasted changes               | Total changed lines during session / final changed lines             |
   | Dead-end branch count       | Useful with `/tree`/`/fork` workflows | Branches abandoned without merged outcome                            |
   | Tool selection quality      | Detects bash overuse                  | Specialized tool calls vs bash fallbacks for the same task type      |
   | Tool retry rate             | Reliability signal                    | Repeated same tool call after failure or unclear result              |
   | Bash success rate           | Low-level tool health                 | Exit code 0 / total bash executions                                  |
   | Truncation rate             | Context loss signal                   | Truncated tool outputs / total tool outputs                          |
   | User intervention load      | Prompt quality signal                 | Steering messages, aborts, clarifications, rewrites per task         |
   | Abort recovery time         | Measures control responsiveness       | Time from abort to next productive action                            |
   | Prompt sensitivity          | Critical for system prompt work       | Metric variance grouped by `systemPromptHash`                        |
   | Model sensitivity           | Critical for model changes            | Metric variance grouped by model                                     |
   | Cost per successful task    | Practical efficiency                  | Total cost / successful tasks                                        |
   | Tokens per accepted LOC     | Context efficiency                    | Total tokens / final accepted changed LOC                            |
   | Compaction penalty          | Detects context loss                  | Re-reads, repeated searches, or wrong turns after compaction         |
   | Planning adherence          | For plan-mode changes                 | % planned steps completed without major replanning                   |
   | Plan rewrite count          | Measures planning stability           | Number of times plan structure changed materially                    |
   | Safety incident rate        | Guardrail quality                     | Dangerous command attempts, protected-path attempts, blocked actions |
   | Post-task defect rate       | True quality signal                   | Bugs found after “success”                                           |

7. **System prompt tracking**
   - summarize prompt hashes and group identical prompts only if that data is present in `pi-session-summary.html` or `pi-session-jsonl-viewer.html`
   - otherwise say that prompt tracking is unavailable from the current inputs

8. **Repo recommendations**
   - concrete `pi-mono` changes that would have reduced search loops, wrong turns, or recovery cost
   - keep recommendations file-oriented and implementation-oriented
