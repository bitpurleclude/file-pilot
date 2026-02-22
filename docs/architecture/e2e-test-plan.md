# E2E Test Plan (M2/M3)

## Scope

This plan covers the M2/M3 delivery baseline:
- rule-first classification pipeline (`rule -> primary LLM -> secondary LLM -> local fallback`)
- low-confidence follow-up flow
- rule learning and management
- SQLite bootstrap + migration + legacy JSON import startup path

## Test Matrix

1. Startup and preload contract
- app launches without white screen
- `window.filePilotApi` is injected
- newly added methods are available: `submitFollowup`, `saveCorrections`, `listRules`, `updateRule`

2. Core workflow
- whitelist save works
- analyze returns enriched fields (`confidenceBand`, `decisionSource`, `needsFollowUp`)
- low-confidence item can be answered through follow-up API
- dry-run apply keeps source files unchanged

3. Rule learning workflow
- user correction can be persisted as rule
- subsequent similar file hits learned rule directly

4. Error and fallback workflow
- non-whitelist paths are rejected with stable error code
- invalid LLM response falls back to local rule
- renderer error reporting is persisted

5. Migration workflow
- app starts with SQLite migration enabled
- legacy JSON import path runs once and does not block analysis

6. Packaging smoke
- NSIS artifact exists after `dist:win`
- packaged artifact smoke check passes

## Runtime Stability Rules

1. Electron launch helper must clear `ELECTRON_RUN_AS_NODE` explicitly.
2. E2E execution must rebuild native module for Electron ABI before test run.
3. All E2E tests run with single worker for deterministic filesystem side effects.

## CI Gates

PR/main gates include:
- startup/workflow/error-path/rule-learning/migration E2E specs
- package smoke in dedicated Windows packaging job

Nightly and pre-release QA gates are defined separately in `ci-gates.yml`.
