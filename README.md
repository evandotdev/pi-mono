<p align="center">
  <a href="https://shittycodingagent.ai">
    <img src="https://shittycodingagent.ai/logo.svg" alt="pi logo" width="128">
  </a>
</p>
<p align="center">
  <a href="https://discord.com/invite/3cU7Bz4UPx"><img alt="Discord" src="https://img.shields.io/badge/discord-community-5865F2?style=flat-square&logo=discord&logoColor=white" /></a>
  <a href="https://github.com/badlogic/pi-mono/actions/workflows/ci.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/badlogic/pi-mono/ci.yml?style=flat-square&branch=main" /></a>
</p>
<p align="center">
  <a href="https://pi.dev">pi.dev</a> domain graciously donated by
  <br /><br />
  <a href="https://exe.dev"><img src="packages/coding-agent/docs/images/exy.png" alt="Exy mascot" width="48" /><br />exe.dev</a>
</p>

> New issues and PRs from new contributors are auto-closed by default. Maintainers review auto-closed issues daily. See [CONTRIBUTING.md](CONTRIBUTING.md).

---

# Pi Monorepo

> **Looking for the pi coding agent?** See **[packages/coding-agent](packages/coding-agent)** for installation and usage.

Tools for building AI agents and managing LLM deployments.

## Share your OSS coding agent sessions

If you use pi or other coding agents for open source work, please share your sessions.

Public OSS session data helps improve coding agents with real-world tasks, tool use, failures, and fixes instead of toy benchmarks.

For the full explanation, see [this post on X](https://x.com/badlogicgames/status/2037811643774652911).

To publish sessions, use [`badlogic/pi-share-hf`](https://github.com/badlogic/pi-share-hf). Read its README.md for setup instructions. All you need is a Hugging Face account, the Hugging Face CLI, and `pi-share-hf`.

You can also watch [this video](https://x.com/badlogicgames/status/2041151967695634619), where I show how I publish my `pi-mono` sessions.

I regularly publish my own `pi-mono` work sessions here:

- [badlogicgames/pi-mono on Hugging Face](https://huggingface.co/datasets/badlogicgames/pi-mono)

## Packages

| Package | Description |
|---------|-------------|
| **[@mariozechner/pi-ai](packages/ai)** | Unified multi-provider LLM API (OpenAI, Anthropic, Google, etc.) |
| **[@mariozechner/pi-agent-core](packages/agent)** | Agent runtime with tool calling and state management |
| **[@mariozechner/pi-coding-agent](packages/coding-agent)** | Interactive coding agent CLI |
| **[@mariozechner/pi-mom](packages/mom)** | Slack bot that delegates messages to the pi coding agent |
| **[@mariozechner/pi-tui](packages/tui)** | Terminal UI library with differential rendering |
| **[@mariozechner/pi-web-ui](packages/web-ui)** | Web components for AI chat interfaces |
| **[@mariozechner/pi-pods](packages/pods)** | CLI for managing vLLM deployments on GPU pods |

## Fork Updates

### Custom Extensions

- [grep-home-shorten.ts](.pi/extensions/grep-home-shorten.ts) truncates your `$HOME` variable into `~` to save tokens
- [guardrails.ts](.pi/extensions/guardrails.ts) blocks risky path and command patterns (for example `sudo` or `rm -rf`) with layered `repo-default`/`project`/`global` config scopes

#### Provided Extensions

- [diff.ts](.pi/extensions/diff.ts)
- [files.ts](.pi/extensions/files.ts)
- [redraws.ts](.pi/extensions/redraws.ts)
- [tps.ts](.pi/extensions/tps.ts)
- [prompt-url-widget.ts](.pi/extensions/prompt-url-widget.ts)

### Enhancements

- OAuth multi-account load balancing for Anthropic and OpenAI Codex
  - multiple saved accounts per provider with account-aware deduplication
  - account selection directly in `/login` and `/model`
  - automatic credential rotation on retryable rate-limit/overload responses (with notification)
- Interactive usage telemetry
  - footer shows provider usage windows (e.g. `5h`, `1d`, `7d`) with reset timing
  - `/login` shows per-account usage metrics to make account switching explicit

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines and [AGENTS.md](AGENTS.md) for project-specific rules (for both humans and agents).

## Development

```bash
npm install          # Install all dependencies
npm run build        # Build all packages
npm run check        # Lint, format, and type check
./test.sh            # Run tests (skips LLM-dependent tests without API keys)
./pi-test.sh         # Run pi from sources (can be run from any directory)
```

> **Note:** `npm run check` requires `npm run build` to be run first. The web-ui package uses `tsc` which needs compiled `.d.ts` files from dependencies.

### Sandbox and stow tasks (mise)

Inside `pi-mono`, these tasks run pi through the Docker sandbox tooling added in this repo:

```bash
mise run pi                # Sandbox mode (default)
mise run pi:readonly       # Read-only sandbox mode
mise run pi:shell          # Open bash in sandbox container
mise run pi:yolo           # Run directly from source (no sandbox)
mise run pi:build          # Build/rebuild sandbox image
```

To make these `pi:*` tasks available machine-wide (so `mise run pi` works from any directory), stow the global mise task package from this repo:

```bash
mise run pi:stow:mise:install
```

To remove those global task symlinks later:

```bash
mise run pi:stow:mise:uninstall
```

Global wrappers default to `~/pi-mono`. If your checkout lives elsewhere, set `PI_MONO_ROOT`.

To manage `~/.pi` from the repo's `.pi` directory:

```bash
mise run pi:stow:install
mise run pi:stow:uninstall
```

`pi:stow:install` writes a manifest to `~/.pi/.pi-mono-stow-manifest`.

## License

MIT
