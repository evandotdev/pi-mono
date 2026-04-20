---
name: typescript
description: Use whenever creating, modifying, refactoring, or reviewing TypeScript or TSX files, resolving type errors, choosing imports, updating typed tests, or changing TypeScript APIs. Covers strict typing,
  installed dependency types, module/import rules, and TypeScript-specific validation.
---

Apply these rules whenever working in `.ts`, `.tsx`, `.mts`, or `.cts` files.
If repo-local instructions or direct user instructions conflict with this skill, follow those instead.

## Read first

- Check `tsconfig.json`, `package.json`, lint config, and test config before changing TypeScript code.
- Read nearby files before editing.

## Typing

- Prefer `unknown` plus narrowing, generics, discriminated unions, overloads, mapped types, indexed access types, and small local interfaces.
- Preserve strict typing. Do not add broad casts, non-null assertions, or unsafe fallbacks just to silence errors.
- Add explicit types where they materially improve exported APIs, complex return shapes, or tricky inference.
- Keep shared and exported APIs precise. Avoid overly broad types that hide mistakes.

## Type narrowing

- Prefer type guards (`if ('kind' in obj)`, `instanceof`, custom `is` predicates) over type assertions (`as Type`).
- Use `as Type` only at trust boundaries where you have external guarantees the type system can't verify (e.g., validated API responses, deserialized data).
- Never use `as unknown as Type` — this defeats the type system entirely. If you need it, the types are wrong.

  ```typescript
  // bad — asserts without proof
  const user = data as User

  // good — narrows with a check
  if (isUser(data)) {
    const user = data
  }

  // acceptable — data was validated by schema before this point
  const user = validatedData as User
  ```

## Nullability

- Prefer `T | undefined` over `T | null` for optional values. Use `null` only when it carries distinct meaning (e.g., "explicitly cleared" vs "never set").
- Do not mix `null` and `undefined` for the same concept within a module.
- Use optional properties (`field?: T`) for object shapes. Use `T | undefined` for function parameters and return types.

## Enums

- Prefer union types (`type Status = "active" | "inactive"`) over `enum` for string values — they are simpler, tree-shake better, and don't generate runtime code.
- Use `const enum` only when numeric values are needed and the project does not use `--isolatedModules` (which forbids `const enum` across files).
- Use a regular `enum` when you need reverse mapping or the values must be iterable at runtime.

## Dependencies and external types

- When fixing type errors involving third-party packages, inspect installed type definitions before guessing.
- Check package exports and `.d.ts` files in `node_modules`.

## Imports and modules

- Use standard top-level `import` statements only.
- Do not use `await import("./x")`, `import("pkg").Type` in type positions, or dynamic imports for types unless the user explicitly needs runtime code-splitting behavior.
- Use `import type` when the repo already uses it or when it cleanly avoids runtime imports.
- Follow existing path alias, barrel file, and module-boundary conventions instead of inventing new ones.

## Schema-derived types

- When the repo uses a schema validation library (Zod, Valibot, ArkType), derive TypeScript types from schemas using `z.infer<>` or equivalent — not the other way around.
- Do not maintain a hand-written type and a schema that describe the same shape. One must be the source of truth.
