---
name: code-quality
description: Use when implementing, refactoring, fixing bugs, adding tests, or reviewing code in any software repository.
---

Apply these rules whenever making code changes, regardless of language or framework.
If repo-local instructions or direct user instructions conflict with this skill, follow those instead.

# Conversational Style

- Keep answers short and concise
- No emojis in commits, issues, PR comments, or code
- No fluff or cheerful filler text
- Technical prose only, be kind but direct (e.g., "Thanks @user" not "Thanks so much @user!")
- State assumptions, notable tradeoffs, and residual risk clearly.
- Mention config, dependency, or user facing behavior changes explicitly.

# Code Quality

- No `any` types. Acceptable only when:
  - A third-party library lacks type definitions and writing a full type is disproportionate effort
  - Generic utility code where the type is truly unconstrained (e.g., serialization boundaries)
  - In these cases, add a `// eslint-disable-next-line` with a reason, not a blanket disable
- NEVER remove or downgrade code to fix type errors from outdated dependencies; upgrade the dependency instead
- Always ask the user before removing functionality or code that appears to be intentional
- Do not hardcode values that differ across environments, change with business rules, or already exist in a config/schema/registry.
- Add comments only to explain _why_, not _what_. If you need to explain _what_ the code does, simplify the code instead.

Unless the user explicitly asks for it...:

- Do not preserve backward compatibility
- Do not add deprecated aliases, fallback arguments
- Follow established local patterns instead of introducing a new style by default

# Tests and validation

- After code changes, run the repo's documented validation commands for the affected package or project.
- If you add or modify tests, run the affected tests.
- If behavior changes and the repo has an established test location, add or update tests there.
- If validation cannot be run, state what was skipped and why in the PR description.

# Error handling

- Throw exceptions for unexpected failures (network errors, missing resources that should exist, invariant violations). Return result types or error values for expected outcomes (validation failure, "not found" in a search).
- Define custom error classes for domain-specific failures. Include enough context to diagnose without reading the source:

  ```typescript
  // good
  throw new InsufficientFundsError({
    accountId,
    requested: amount,
    available: balance,
  });

  // bad
  throw new Error("insufficient funds");
  ```

- Catch at boundaries (controller, queue consumer, CLI entrypoint), not in the middle of business logic. Catching inside a service to rethrow a different error is usually a smell - let it propagate.
- Never swallow errors silently. If you catch and don't rethrow, log at `warn` or above with context.

# Async patterns

- Use `async/await` over `.then()` chains. Exceptions: concurrent operations with `Promise.all()` or `Promise.allSettled()` where chaining is clearer.
- Never fire-and-forget a promise. Every promise must be `await`ed, returned, or explicitly passed to a void handler that logs failures:

  ```typescript
  // bad - if this rejects, the error vanishes
  sendWelcomeEmail(user);

  // good - caller handles the result
  await sendWelcomeEmail(user);

  // good - explicitly fire-and-forget with error handling
  void sendWelcomeEmail(user).catch((err) =>
    logger.warn("welcome email failed", { userId: user.id, err }),
  );
  ```

- Do not use `await` inside loops when iterations are independent. Use `Promise.all()` or a concurrency-limited mapper instead:

  ```typescript
  // bad - sequential, N round trips
  for (const id of userIds) {
    const user = await getUser(id);
    results.push(user);
  }

  // good - concurrent
  const results = await Promise.all(userIds.map(getUser));
  ```

# Separation of Concerns

Organize code into layers. Each layer has one job and talks only to its immediate neighbor.

- Controllers handle HTTP - request handlign & validation, status codes, response formatting. No business logic, no direct database access.
- Services contain business logic - rules, calculations, orchestration. Agnostic to how they're called (HTTP, CLI, queue) and access data only through persistence abstractions.
- Repositories abstract storage - queries, caching, connection management. Translate between domain objects and storage format.
- The database layer (schema, migrations, indexes) hidden behind repositories. Swapping storage engines should not require changing services.

### Violations

Don't do this:

- A controller that runs SQL queries or calls an ORM directly
- A service that imports `Request`/`Response` types or sets HTTP status codes
- A service that imports UI framework code (`React`, `Vue`, template engines)
- A repository that makes business decisions (e.g., applying discount logic inside a query method)
- A controller that contains retry logic, rate limiting, or circuit breaker patterns - these belong in services or dedicated middleware
- Business logic split across both the controller and the service - prefer service to be the owner

# Readability & Conventions

If repo-local instructions or direct user instructions conflict with this section, ignore it.

When naming variables, functions, types, and modules, signal intent clearly through consistent suffixes,
prefixes, and structure.

### Common suffixes and prefixes

- `DTO` - data transfer object with no behavior (`UserInfoDTO`)
- `Service` - orchestrates business logic (`PaymentService`)
- `Repository` / `Repo` - data access abstraction (`OrderRepo`)
- `Factory` - creates complex objects (`ConnectionFactory`)
- `Handler` - processes a single event or command (`PaymentHandler`)
- `Middleware` - intercepts a request/response pipeline (`AuthMiddleware`)
- `Provider` - supplies or configures a dependency (`ConfigProvider`)
- `Adapter` - wraps an external system to match a local interface (`StripePaymentAdapter`)
- `Client` - talks to an external API (`SlackClient`)
- `Config` - holds configuration values (`DbConfig`)
- `Error` / `Exception` - custom error types (`InsufficientFundsError`)
- `Mock` / `Stub` / `Fake` - test doubles (`MockEmailService`)

### Booleans

Phrase booleans as questions:

- `isActive`
- `hasPermission`
- `canEdit`
- `shouldRetry`

Prefer positive names:

- `isEnabled`, not `isNotDisabled`

### Functions

Use verb-first, intent-clear names:

- `getUser`
- `fetchOrder`
- `calculateTotal`
- `validateInput`

Use consistent prefixes for common patterns:

- `to...` for transformations: `toDTO`, `toJSON`, `toDomainModel`
- `from...` for construction: `fromRequest`, `fromRow`
- `handle...` for event or command processors: `handlePayment`
- `ensure...` or `assert...` for guard functions that throw: `ensureAuthenticated`

### Collections

Pluralize collections:

- `users`, not `userList`
- `activeOrders`, not `orderArray`

Use singular names for iterated items:

- `for (const user of users)`

### Constants

Use `SCREAMING_SNAKE_CASE` or a clear contextual constant style:

- `MAX_RETRY_COUNT`
- `DEFAULT_TIMEOUT_MS`

Include units in the name when relevant:

- `timeoutMs`
- `cacheTtlSeconds`
- `maxFileSizeBytes`

### Interfaces and contracts

Name interfaces by capability:

- `Readable`
- `Serializable`
- `PaymentGateway`

### Enums

Use singular enum names and constant-style members:

- `OrderStatus.PENDING`
- `Role.ADMIN`

### Private and internal code

Use language-native visibility modifiers (`private`, `#field`) as the primary mechanism.
Use `_` prefix only in languages that lack native visibility (plain JavaScript, Python).
Never combine both - pick one per language.

Keep the public API surface obvious at a glance.
