# Branch-based plan mode

This project-local extension keeps planning on a separate branch in the current session tree.

## Commands

- `/plan` - start plan mode from the current leaf, or show status if already active
- `/plan status` - show the saved anchor and approval state
- `/plan approve` - approve the exact `Plan:` block from the latest assistant response
- `/plan implement` - jump back to the saved anchor, carry forward the exact approved plan, and prefill the editor for implementation
- `/plan cancel` - clear the active plan workflow and return to the saved anchor
- `Ctrl+Alt+P` - start plan mode or show status

## Behavior

1. Run `/plan` at the point you want to branch from.
2. Ask the agent to inspect the codebase and produce a numbered plan under a `Plan:` header.
3. Run `/plan approve` to approve the exact plan text.
4. Run `/plan implement` to:
   - navigate back to the saved anchor with `/tree` semantics
   - restore implementation tools
   - inject the approved plan into the new branch as hidden context
   - prefill the editor with a safe implementation kickoff prompt
5. Review the prefilled prompt and press Enter yourself.

## Tool behavior

While plan mode is active:

- `edit` and `write` are blocked
- non-read-only `bash` commands are blocked
- other currently active tools stay available, so search or web tools can still be used during planning

## Layout

- `.pi/extensions/plan-mode/index.ts`
- `.pi/extensions/plan-mode/utils.ts`
