# Release Documentation

## Branch Channel Strategy

- `beta` branch -> prerelease channel
- `master` branch -> stable channel
- Trigger: every push to channel branch runs `.github/workflows/release-publish.yml`

## Tag Rules

- `beta`: `v<package.version>-beta.<run_number>`
- `master`: `v<package.version>`
- Stable tag must be unique. If `v<package.version>` exists, release workflow fails and requires version bump.

## Release Assets

- Release pipeline builds Windows installer with `npm run dist:win`
- Required asset pattern: `release/*.exe`
- Missing installer asset is treated as release failure

## Delivery Records

- [deliverable-20261006.md](./deliverable-20261006.md)：2026-10-06 beta 渠道交付记录（版本 `0.1.0`，触发分支 `feat/deliverable-fixes-20261006`，新增便携版打包）
- [e2e-remediation-20261006.md](./e2e-remediation-20261006.md)：2026-10-06 e2e 整改记录（版本 `0.1.0`，触发分支 `feat/e2e-remediation-20261006`，测试隔离/LLM stub/回滚与 UI e2e/门禁恢复/CI 修正）

## Rollback Path

1. Identify broken release tag and channel.
2. Mark GitHub release as draft or delete release assets if distribution must stop immediately.
3. Revert offending commit on the channel branch (`beta` or `master`) and push.
4. For stable fixes, bump `package.json` version and release again from `master`.
5. For beta fixes, push corrected commit to `beta` and verify new prerelease tag is generated.

## Evidence Checklist

Every change must provide:

- Release info: version, channel, trigger branch
- Docs delta: what update docs changed
- Rollback note: exact fallback command/process
- Verification: command outputs for `typecheck`, `lint`, `test`, `build`
