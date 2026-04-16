# Plan: add a core `ast-grep` tool

Status legend:
- `[x]` implemented / decided / investigated
- `[ ]` not yet implemented

## Current decisions

- [x] Tool name: `ast-grep`
- [x] Scope: discovery only
- [x] Runtime approach: invoke `ast-grep` from `PATH`
- [x] Do not use `@ast-grep/napi`
- [x] Rationale: the JavaScript API currently exposes only a small built-in language set, while the installed CLI can support the broader ast-grep language matrix on the host machine
- [x] Do not add rewrite/codemod support in the first cut

## What I investigated

### pi/coding-agent integration

- [x] Core tool definitions live under `packages/coding-agent/src/core/tools/*.ts`
- [x] `packages/coding-agent/src/core/tools/ls.ts` and `packages/coding-agent/src/core/tools/grep.ts` are the closest built-in patterns to follow
- [x] Built-in tool registration is centralized in `packages/coding-agent/src/core/tools/index.ts`
- [x] CLI tool selection is validated against `allTools` in `packages/coding-agent/src/cli/args.ts`
- [x] CLI wiring maps selected tool names through `allTools` in `packages/coding-agent/src/main.ts`
- [x] SDK wiring derives `initialActiveToolNames` from `options.tools` in `packages/coding-agent/src/core/sdk.ts`
- [x] Runtime setup builds `_baseToolDefinitions` from `createAllToolDefinitions(...)` in `packages/coding-agent/src/core/agent-session.ts`
- [x] Runtime setup then builds `_toolDefinitions`, `_toolRegistry`, `_toolPromptSnippets`, and `_toolPromptGuidelines` in `packages/coding-agent/src/core/agent-session.ts`
- [x] Active tools are applied via `setActiveToolsByName(...)`, which also rebuilds the system prompt in `packages/coding-agent/src/core/agent-session.ts`
- [x] The default system prompt is built in `packages/coding-agent/src/core/system-prompt.ts`
- [x] The system prompt "Available tools" section is driven by `promptSnippet`, not by `description`
- [x] Tool-specific prompt bullets are driven by `promptGuidelines`
- [x] The current system prompt has hardcoded exploration guidance for `bash`, `grep`, `find`, and `ls`
- [x] There are hardcoded built-in tool lists in CLI/docs/help text that need review when `ast-grep` becomes a built-in tool

### ast-grep API investigation

- [x] Read the JavaScript API docs for `@ast-grep/napi`
- [x] Read the napi performance guidance
- [x] Verified that the napi package exposes only a small built-in language enum (`JavaScript`, `TypeScript`, `Tsx`, `Html`, `Css`)
- [x] Confirmed experimentally that broader CLI languages like `python` fail with the napi parsing/search APIs in this setup
- [x] Reverted the napi approach because it does not satisfy the broader language-support requirement

## Current behavior preserved

- [x] `description` and `parameters` make a tool callable by the model
- [x] `promptSnippet` controls whether the tool appears in the default system prompt's "Available tools" section
- [x] `promptGuidelines` adds tool-specific bullets to the default system prompt
- [x] `codingTools` still defaults to `read`, `bash`, `edit`, `write`
- [x] `readOnlyTools` includes `ast-grep` in addition to `read`, `grep`, `find`, and `ls`

## Implemented scope

### 1. Core tool implementation

- [x] Add `packages/coding-agent/src/core/tools/ast-grep.ts`
- [x] Mirror the overall structure of `grep.ts` / `ls.ts`
- [x] Export:
  - [x] `AstGrepToolInput`
  - [x] `AstGrepToolDetails`
  - [x] `AstGrepToolOptions`
  - [x] `createAstGrepToolDefinition(...)`
  - [x] `createAstGrepTool(...)`
  - [x] `astGrepToolDefinition`
  - [x] `astGrepTool`
- [x] Define a TypeBox schema for the discovery-only API
- [x] Keep the API discovery-only:
  - [x] `pattern: string`
  - [x] `language: string`
  - [x] `path?: string`
  - [x] `limit?: number`
- [x] Resolve paths relative to `cwd`
- [x] Execute `ast-grep` from `PATH`
- [x] Allow any language alias supported by the installed `ast-grep` binary instead of hardcoding the small napi language set
- [x] Support abort handling at the tool level
- [x] Truncate output similarly to the existing read-only tools
- [x] Provide `renderCall` / `renderResult` formatting compatible with the existing tool UI

### 2. Prompt metadata

- [x] Add a `promptSnippet` for `ast-grep`
- [x] Add `promptGuidelines` that steer the model toward structural search when appropriate
- [x] Keep the snippet short enough for the "Available tools" list
- [x] Keep the guidance compatible with `grep` / `find` / `ls`

### 3. Register the tool centrally

- [x] Update `packages/coding-agent/src/core/tools/index.ts`
- [x] Add exports for the new tool and its types
- [x] Add `ast-grep` to `allTools`
- [x] Add `ast-grep` to `allToolDefinitions`
- [x] Add `createAstGrepToolDefinition(...)` to `createAllToolDefinitions(...)`
- [x] Add `createAstGrepTool(...)` to `createAllTools(...)`
- [x] Add `ast-grep` to `readOnlyTools`
- [x] Add `createAstGrepTool(...)` to `createReadOnlyTools(...)`
- [x] Keep `ast-grep` out of the default `codingTools` set

### 4. Wire CLI and SDK surfaces

- [x] Update `packages/coding-agent/src/cli/args.ts`
- [x] Make `--tools` accept `ast-grep`
- [x] Update CLI help text that lists available tools
- [x] Update examples that describe the read-only tool set
- [x] Update `packages/coding-agent/src/core/sdk.ts` re-exports
- [x] Update `packages/coding-agent/src/index.ts` re-exports

### 5. Update system prompt behavior

- [x] Update `packages/coding-agent/src/core/system-prompt.ts`
- [x] Add guidance that prefers `ast-grep` for syntax-aware / structural discovery
- [x] Keep `grep` for plain-text search
- [x] Keep `find` / `ls` for path and directory discovery
- [x] Keep `bash` as a shell fallback rather than the preferred structural search tool
- [x] Ensure the prompt still reads correctly when only some of these tools are active

### 6. Documentation updates

- [x] Update `packages/coding-agent/README.md`
- [x] Update `packages/coding-agent/docs/sdk.md`
- [x] Review the related CLI/help text that mentions built-in tool sets

### 7. Tests

- [x] Update `packages/coding-agent/test/system-prompt.test.ts`
- [x] Add coverage that `ast-grep` appears in the system prompt when active and has a `promptSnippet`
- [x] Add coverage that `ast-grep` prompt guidelines are included when active
- [x] Update a session/tool-registry test to confirm the tool is registered and can become active
- [x] Keep the direct tool behavior test gated on `ast-grep` being present on `PATH`

### 8. Validation

- [x] Run the relevant coding-agent test files
- [x] Run `npm run check`
- [x] Fix all reported errors, warnings, and infos before considering the implementation complete

## Not implemented in this cut

- [ ] YAML rule / `scan` support
- [ ] Rewrite / codemod support (`fix`, `transform`, `rewriters`)
- [ ] Bundled/parser-managed multi-language support independent of the host CLI
- [ ] More advanced file-type detection or richer AST result formatting

## File map changed

- [x] `packages/coding-agent/src/core/tools/ast-grep.ts`
- [x] `packages/coding-agent/src/core/tools/index.ts`
- [x] `packages/coding-agent/src/core/system-prompt.ts`
- [x] `packages/coding-agent/src/cli/args.ts`
- [x] `packages/coding-agent/src/core/sdk.ts`
- [x] `packages/coding-agent/src/index.ts`
- [x] `packages/coding-agent/README.md`
- [x] `packages/coding-agent/docs/sdk.md`
- [x] `packages/coding-agent/test/system-prompt.test.ts`
- [x] `packages/coding-agent/test/tools.test.ts`
- [x] `packages/coding-agent/test/agent-session-dynamic-tools.test.ts`
- [x] `plan-ast-grep-core-tool.md`

## Validation performed

- [x] `cd packages/coding-agent && npx tsx ../../node_modules/vitest/dist/cli.js --run test/tools.test.ts`
- [x] `cd packages/coding-agent && npx tsx ../../node_modules/vitest/dist/cli.js --run test/system-prompt.test.ts`
- [x] `cd packages/coding-agent && npx tsx ../../node_modules/vitest/dist/cli.js --run test/agent-session-dynamic-tools.test.ts`
- [x] `npm run check`

## Notes for follow-up work

- [x] The important registry boundary remains `createAllToolDefinitions(...)` -> `_baseToolDefinitions` -> `_toolRegistry` / `_toolPromptSnippets` / `_toolPromptGuidelines`
- [x] If `promptSnippet` is missing, the tool can still be callable but will be omitted from the default system prompt's tool list
- [x] If `promptGuidelines` are missing, the tool can still be callable but will not influence the default system prompt guidance
- [x] Broader language support comes from the installed `ast-grep` binary, not from bundled napi language registration
