# Sandboxing in pi-mono

Pi-mono has two sandbox layers that are easy to confuse:

1. **Docker sandbox launcher** — the repo-local wrappers and Docker launcher used for day-to-day `pi` runs.
2. **OS-level sandbox extension** — the optional extension example that wraps `bash` with `@anthropic-ai/sandbox-runtime`.

This page is the canonical map for both systems.

## Inspect the current sandbox setup

If the sandbox extension is loaded, use:

- `/sandbox` — short status output
- `/sandbox:info` or `/doctor:sandbox` — detailed topology, config precedence, and repo file map

The detailed report is meant to answer the questions that usually cause discovery loops:

- Which config file is winning?
- Where does `~/.pi` come from?
- Which repo files control the sandbox launcher?
- Which files are the authoritative examples for changes?

## Docker sandbox launcher

The Docker sandbox launcher is the default path for repo-local `pi` runs.

### Configuration precedence

The launcher resolves config in this order:

1. built-in defaults
2. `~/.pi/agent/extensions/docker-sandbox.json`
3. `<repo>/.pi/docker-sandbox.json`
4. CLI/runtime overrides from `PI_SANDBOX_*`

### Key files

- `scripts/pi-sandbox.mjs` — resolves image, folders, mounts, and runtime args
- `scripts/pi-sandbox.sh` — entrypoint wrapper used by the launcher
- `scripts/pi-sandbox-build.sh` — rebuilds the sandbox image
- `.mise/tasks/pi/_default` — `pi` task wrapper
- `.mise/tasks/pi/readonly` — read-only sandbox wrapper
- `.mise/tasks/pi/shell` — interactive shell inside the sandbox container
- `.mise/tasks/pi/yolo` — explicit opt-out wrapper
- `.mise/tasks/pi/build` — rebuild task
- `.mise/tasks/pi/stow/install` and `.mise/tasks/pi/stow/uninstall` — stow helpers used to manage repo-local resources
- `.mise/tasks/pi/stow/mise/install` and `.mise/tasks/pi/stow/mise/uninstall` — global `mise` task wrapper installers

### What to inspect when folders look wrong

- `scripts/pi-sandbox.mjs`
- `.mise/tasks/pi/*`
- `.pi/docker-sandbox.json`
- `~/.pi/agent/extensions/docker-sandbox.json`

## OS-level sandbox extension

The extension example is useful when you want to sandbox individual shell commands rather than the entire process/container.

### Configuration precedence

The extension merges config in this order:

1. built-in defaults
2. `~/.pi/agent/extensions/sandbox.json`
3. `<repo>/.pi/sandbox.json`

### Key files

- `.pi/extensions/sandbox.ts` — repo-local sandbox extension used in this repo
- `packages/coding-agent/examples/extensions/sandbox/index.ts` — canonical example extension
- `~/.pi/agent/extensions/sandbox.json` — global extension config
- `<repo>/.pi/sandbox.json` — project-local overrides

### `~/.pi` ownership

The detailed report also shows whether `~/.pi` is:

- a real directory
- a symlink into a dotfiles repo
- missing
- another filesystem type

That check is important when debugging stow-based setups and repo-local resource ownership.

## Where to edit

If you are trying to change a sandbox behavior, start here:

- `scripts/pi-sandbox.mjs` — folder resolution, mount naming, runtime flags
- `.mise/tasks/pi/*` — CLI entrypoints and `-v` folder overrides
- `.pi/extensions/sandbox.ts` — repo-local sandbox extension
- `packages/coding-agent/examples/extensions/sandbox/index.ts` — example extension
- `packages/coding-agent/docs/extensions.md` — extension catalog entry
- `packages/coding-agent/README.md` — user-facing setup link
- `packages/coding-agent/CHANGELOG.md` — release notes for user-visible sandbox changes

## Why this helps

A sandbox-focused command and a canonical file map reduce the number of dead-end searches. Instead of re-discovering where the sandbox logic lives, you can inspect one report and jump directly to the file that owns the behavior you want to change.
