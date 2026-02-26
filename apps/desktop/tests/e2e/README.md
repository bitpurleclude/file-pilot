# E2E Tests

This directory contains Playwright Electron E2E scenarios for File-Pilot.

## Current specs

1. `startup.spec.ts`: startup and preload API injection.
2. `workflow.spec.ts`: whitelist -> analyze -> follow-up -> correction -> dry-run.
3. `error-path.spec.ts`: whitelist rejection and LLM fallback behavior.
4. `rule-learning.spec.ts`: correction saved as rule and reused in next analyze.
5. `migration.spec.ts`: startup with migration path and normal workflow.
6. `package-smoke.spec.ts`: packaged app smoke check with isolated launch `cwd` and packaged `analyze` path.

## Execute

1. `npm run build`
2. `npm run test:e2e`

For packaged smoke:

1. `npm run dist:win`
2. `FILE_PILOT_RUN_PACKAGED_SMOKE=1 npx playwright test apps/desktop/tests/e2e/package-smoke.spec.ts`

## MCP frontend check (manual)

You can also run a manual frontend smoke using Chrome DevTools MCP:

1. Start renderer preview: `npm run dev -- --host 127.0.0.1 --port 4173`
2. Open `http://127.0.0.1:4173` with MCP.
3. Verify no console errors and core UI elements exist:
   - title `File-Pilot M2/M3`
   - whitelist input and action buttons
   - follow-up / correction controls after a successful analyze in Electron context

Use MCP for quick interaction debugging, but keep Playwright as the CI gate.
