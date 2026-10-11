# AGENTS Guide for `file-pilot`

This file is for agentic coding assistants working in this repository.
Follow it together with source code and in-repo docs.

## 0) Hard MUST Workflow

- MUST invoke `using-superpowers` before starting any code-task response.
- MUST invoke `using-git-worktrees` next, and execute implementation in a newly created git worktree.
- MUST NOT implement code changes directly in the main workspace (`D:\code\windsurf\file-pilot`).
- MUST include update-maintenance deliverables for every code change:
  - release information (version, channel, trigger branch)
  - update documentation changes
  - rollback instructions
  - verification evidence (executed commands and outcomes)

## 1) Project Snapshot

- Stack: Electron + React + TypeScript (`strict`) + Vite + Vitest.
- Package manager in use here: `npm` (lockfile: `package-lock.json`).
- Build target: Windows NSIS installer via `electron-builder`.
- Current architecture intent:
  - Renderer -> IPC Client -> Preload -> Main Handler -> UseCase -> Infra.
- Key folders:
  - `apps/desktop/electron` (main/preload)
  - `apps/desktop/src` (renderer)
  - `apps/desktop/core` (use cases)
  - `apps/desktop/infra` (adapters)
  - `apps/desktop/shared` (types/config/contracts)
  - `apps/desktop/tests` (unit/integration/e2e placeholder)
  - `docs/` (product/architecture/conventions/release/adr)

## 2) Rule Sources Checked

- Checked for Cursor rules: none found (`.cursor/rules/`, `.cursorrules`).
- Checked for Copilot rules: none found (`.github/copilot-instructions.md`).
- Primary conventions come from:
  - `PLAN.md`
  - `docs/conventions/m1-implementation.md`
  - `docs/architecture/*.md`
  - `package.json`, `tsconfig.json`, `eslint.config.mjs`

## 3) Build/Lint/Test Commands

Run from repository root: `D:\code\windsurf\file-pilot`.

### Core commands

- Type check all: `npm run typecheck`
- Lint all: `npm run lint`
- Test all: `npm run test`
- Test e2e: `npm run test:e2e`
- Test e2e core gate: `npm run test:e2e:core`
- List e2e tests: `npm run test:e2e:list`
- Build all: `npm run build`
- Build renderer only: `npm run build:renderer`
- Build electron bundles only: `npm run build:electron`
- Create npm tarball: `npm run pack`
- Build Windows installer: `npm run dist:win`

### Single test execution (important)

- Run one test file:
  - `npx vitest run --root . apps/desktop/tests/unit/export-logs.test.ts`
- Run one test by name (pattern):
  - `npx vitest run --root . -t "formats file name"`
- Run one file + one test name:
  - `npx vitest run --root . apps/desktop/tests/unit/rule-first-llm.test.ts -t "falls back to local rule"`
- Run one e2e file:
  - `npx playwright test apps/desktop/tests/e2e/startup.spec.ts`

### Typical pre-commit verification

- `npm run typecheck && npm run lint && npm run test && npm run build`
- Packaging/e2e related changes: also run `npm run test:e2e:core` (startup/workflow/rollback core scenarios; mandatory for packaging or e2e changes, may be skipped for docs-only changes).

## 4) Packaging & Release Notes

- Installer output path typically:
  - `release/File Pilot Setup 0.1.0.exe`
- Build config is in `package.json` under `build`.
- Signing is intentionally disabled for current phase:
  - `forceCodeSigning: false`
  - `win.signAndEditExecutable: false`

## 5) Coding Style Guidelines

### Language and formatting

- TypeScript only for app code.
- Use double quotes for strings.
- Use semicolons.
- Prefer small focused functions.
- Keep naming explicit and domain-driven.

### Imports

- Prefer ESM imports.
- Use `node:` prefix for Node builtins.
- Keep import groups stable:
  1. Node/builtin
  2. external packages
  3. local project imports
- For local imports, include `.js` extension in TS source import paths (NodeNext style).

### Types and strictness

- `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` are enabled.
- Do not use `any` (`@typescript-eslint/no-explicit-any` is error).
- Avoid unsafe optional assignment under `exactOptionalPropertyTypes`.
- Prefer explicit interfaces/types for cross-layer contracts.

### Naming

- UseCase functions: verb-oriented (`analyzeFiles`, `applySession`, `rollbackSession`).
- Config constants: uppercase object names (`LLM_CONFIG`, `LOGGING_CONFIG`).
- IPC channels: namespaced string constants in shared contracts.

## 6) Error Handling Guidelines

- Use unified IPC result shape:
  - success: `{ ok: true, data }`
  - failure: `{ ok: false, error: { code, message } }`
- Use `AppError` for domain/application errors where possible.
- Convert unknown errors via `toIpcError` before crossing IPC boundary.
- Never leave empty catch blocks unless intentionally swallowing non-critical side effects.
- If swallowing side-effect errors (e.g., logging), keep scope minimal and documented.

## 7) Logging Guidelines

- Use structured logs with fields like:
  - `timestamp`, `level`, `category`, `code`, `message`, `traceId`, optional `sessionId`, `details`.
- Current log infra:
  - `apps/desktop/infra/logging/file-logger.ts`
- Categories currently used:
  - `session`, `execution`, `error`, `audit`.
- Write logs at lifecycle boundaries:
  - request start, success, failure.
- Export logs should come from real stored records, then pass anonymization pipeline.

## 8) IPC and Layer Boundaries

- Validate IPC payloads with Zod in shared contracts.
- Register handlers only in main process.
- Expose only whitelisted API in preload (`contextBridge.exposeInMainWorld`).
- Renderer must not access filesystem/process APIs directly.

## 9) LLM Integration Rules

- Prompt construction must be template-driven.
- Current engine: `nunjucks` (Jinja2-like style).
- Keep prompt templates versioned (`prompt_version` pattern in reasons/logs).
- Validate template input before rendering (Zod schema).
- LLM call path should support timeout/retry/fallback.

## 10) Testing Strategy Expectations

- Unit: pure logic and rules.
- Integration: usecase orchestration, storage/logging behavior, IPC-adjacent flows.
- E2E: see planning docs and `apps/desktop/tests/e2e/README.md`.
- Use temporary directories/sandboxes for filesystem tests.
- Avoid touching real user paths in tests.

## 11) Definition of Done for Changes

- Code compiles: `npm run typecheck`.
- Lint clean: `npm run lint`.
- Tests pass: `npm run test`.
- Build works: `npm run build`.
- If packaging/e2e related: run `npm run test:e2e:core` (startup/workflow/rollback core scenarios; mandatory for packaging or e2e changes, may be skipped for docs-only changes).
- If packaging-related: run `npm run dist:win`.
- Update docs when behavior/config/contracts change.
- Update-maintenance record is complete for this change:
  - release information (version/channel/trigger branch)
  - update documentation delta
  - rollback instructions
  - verification evidence

## 12) Common Pitfalls to Avoid

- Breaking NodeNext import rules (`.js` suffix missing in local TS imports).
- Using `any` or suppressing type errors.
- Returning inconsistent IPC shapes.
- Hardcoding config values in business logic instead of `shared/config`.
- Adding renderer logic that bypasses preload/IPC boundaries.

## 13) Agent Workflow Recommendation

1. Invoke `using-superpowers` before any implementation action.
2. Invoke `using-git-worktrees` and create/switch to a new worktree for the task.
3. Read relevant files + docs first.
4. Make smallest safe change set.
5. Add/update tests with behavior changes.
6. Run verification commands.
7. Update docs for any changed behavior.
8. Produce update-maintenance evidence (release info + docs + rollback + test evidence).
9. Commit with clear `feat/fix/test/docs/chore` prefix.

### No-Exception Enforcement

- Code-change tasks are not allowed in the main workspace.
- If a worktree cannot be created, stop implementation and resolve that blocker first.
