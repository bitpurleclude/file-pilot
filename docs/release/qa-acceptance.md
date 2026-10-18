# QA Acceptance

## Purpose

Defines the QA acceptance suites that run outside the unit/integration gate,
plus the CI policy for nightly and pre-release verification. Every result must
name the commit it was validated on; do not reuse a green result across
branches (see `docs/release/README.md`).

## Test Suites

### 1. Performance acceptance

- File: `apps/desktop/tests/qa/performance-100-files.test.ts`
- Workload: generated 100-file sandbox dataset
- Thresholds:
  - dry-run total duration `< 8s`
  - execute total duration `< 20s`
- Output: `test-results/qa/perf-*.json`

### 2. Rollback reliability acceptance

- File: `apps/desktop/tests/qa/rollback-reliability.test.ts`
- Workload: batch execution with injected failures + rollback loop
- Threshold: rollback success rate `> 99%`
- Output: `test-results/qa/reliability-*.json`

### 3. Decision-model benchmark harness

- File: `apps/desktop/tests/qa/decision-model-benchmark.test.ts`
- Workload: 13-item Chinese corpus, two-level area/project decomposition against a mock decision endpoint
- Purpose: exercise the shadow-mode alignment path and summary report structure; the real model accuracy run remains pending model download
- Output: `test-results/qa/decision-benchmark-*.json`

## Local Commands

- Full QA: `npm run test:qa`
- Performance only: `npm run test:qa:perf`
- Reliability only: `npm run test:qa:reliability`
- Unit + integration gate: `npm run test`

## CI Policy

1. PR/main policy
   - Required gates: `typecheck`, `lint`, `test` (unit + integration), core e2e, package smoke
   - QA suite is not mandatory on every PR

2. Nightly policy
   - Workflow job: `qa-nightly`
   - Executes full `npm run test:qa`
   - Uploads `test-results/qa/*.json`

3. Pre-release policy
   - Workflow job: `qa-pre-release`
   - Executes full `npm run test:qa`
   - Uploads `test-results/qa/*.json`

## Evidence Format

Record the verified commit SHA, the exact command, and the observed result
(counts and exit code). A bare `[x]` without these three elements is not
accepted as verification evidence.
