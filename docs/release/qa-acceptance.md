# QA Acceptance (M2/M3)

## Purpose

This document defines the quality acceptance suite for M2/M3 and its CI enforcement strategy.

## Test Suites

1. Performance acceptance
- file: `apps/desktop/tests/qa/performance-100-files.test.ts`
- workload: generate 100-file sandbox dataset
- thresholds:
  - dry-run total duration `< 8s`
  - execute total duration `< 20s`
- output: `test-results/qa/perf-*.json`

2. Rollback reliability acceptance
- file: `apps/desktop/tests/qa/rollback-reliability.test.ts`
- workload: batch execution with injected failures + rollback loop
- threshold:
  - rollback success rate `> 99%`
- output: `test-results/qa/reliability-*.json`

## Local Commands

- full QA: `npm run test:qa`
- perf only: `npm run test:qa:perf`
- reliability only: `npm run test:qa:reliability`

## CI Policy

1. PR/main policy
- required gates: `typecheck`, `lint`, `test` (unit+integration), core `e2e`, package smoke
- QA suite is not mandatory on every PR

2. Nightly policy
- workflow job: `qa-nightly`
- executes full `npm run test:qa`
- uploads `test-results/qa/*.json`

3. Pre-release policy
- workflow job: `qa-pre-release`
- triggered by release publish or manual workflow dispatch input
- executes full `npm run test:qa`
- uploads `test-results/qa/*.json`

## Failure Handling

1. If performance threshold fails, inspect test JSON metrics and compare with previous nightly artifact.
2. If reliability threshold fails, inspect rollback failure details and identify non-compensatable operation patterns.
3. `qa-pre-release` 目前由 `release: published` 事件或手动 dispatch 触发，即**发布之后**运行；失败时的处置是当日修复并发布修正版或回退 tag。若要作为真正的发布前置门禁，需在发布前手动 dispatch 运行一次并确认通过。
