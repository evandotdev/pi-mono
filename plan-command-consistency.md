# Command Consistency Plan

Status legend: `[x]` implemented, `[ ]` pending.

## Final command shape

### Built-ins

#### Keep

- [x] `/model` (default picker)
- [x] `/model:list`
- [x] `/model:<scope> [provider/model]`
- [x] `/thinking` (status/info)
- [x] `/thinking:<off|minimal|low|medium|high|xhigh>`
- [x] `/context` (status/info)
- [x] `/context:clear`
- [x] `/session`
- [x] `/session:new`
- [x] `/session:resume`
- [x] `/session:name <name>`
- [x] `/prompt:<template>`
- [x] `/skill:<name>`

#### Remove

- [x] `/model:show`
- [x] `/context:show`
- [x] `/thinking <level>` (space form)
- [x] `/context show|clear` (space form)
- [x] `/new`
- [x] `/resume`
- [x] `/name`
- [x] `/session:rename`
- [x] bare `/<template>` prompt expansion

### Extensions (fork)

#### Keep root defaults

- [x] `/settings:guardrails` (default status behavior)

#### Add/keep colon subcommands

- [x] `/settings:guardrails:status|project|global|repo-default`

#### Remove

- [x] `/doctor:sandbox` alias (keep `/sandbox:info`)

---

## Implementation steps

### 1) Core dispatch + parsing

- [x] Update interactive command dispatch to canonical forms only.
- [x] Remove legacy aliases and space-style subcommands.
- [x] Keep `/thinking` and `/context` as info/status entrypoints.

### 2) Autocomplete + hotkeys list

- [x] Show only canonical commands.
- [x] Remove alias rows.
- [x] Replace ambiguous `[u]/[p]/[t]` source tags with explicit labels (`[user]/[project]/[temp]`).

### 3) Prompt template canonicalization

- [x] Expand only `/prompt:<template>`.
- [x] Update command exports (`get_commands`) so prompt commands are returned as `prompt:<name>`.

### 4) Fork extension normalization

- [x] Refactor guardrails commands to colon subcommands with a root default (`/settings:guardrails`).
- [x] Remove `/doctor:sandbox`.

### 5) Docs + changelog

- [x] Update README/docs/rpc/extensions/prompt-templates to canonical grammar.
- [x] Add changelog entries under `Unreleased`.

### 6) Tests + checks

- [x] Update/add tests for:
  - `/thinking` + `/thinking:<level>`
  - `/context` + `/context:clear` (no `/context:show`)
  - prompt expansion only via `/prompt:<name>`
  - removed aliases not recognized
  - `get_commands` prompt naming
- [x] Run targeted tests changed.
- [x] Run `npm run check`.

---

## Notes

- `plan-mode` extension was removed from the fork and planning is currently handled via `.pi/prompts/plan.md` (`/prompt:plan`).
