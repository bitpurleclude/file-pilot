# Release Documentation

## Branch Channel Strategy

- `beta` branch -> prerelease channel
- `master` branch -> stable channel
- Trigger: every push to channel branch runs `.github/workflows/release-publish.yml`

## Tag Rules

- `beta`: `v<base.version>-beta.<run_number>`; the workflow injects the same version into `package.json` before building, so `app.getVersion()` matches the tag and beta-to-beta updates are visible.
- `master`: `v<package.version>`; the package version must not contain a prerelease suffix.
- Stable tag must be unique. If `v<package.version>` exists, release workflow fails and requires version bump.
- Do not rely on a manual beta version bump: the workflow derives the prerelease version from the base `package.json` version plus the run number.

## Release Assets

- Release pipeline builds Windows installer with `npm run dist:win`
- Required asset patterns: `release/*.exe` and `release/latest*.yml`
- Missing installer or missing update metadata is treated as release failure
- The client verifies the installer SHA-512 from `latest.yml` before writing it; a release without metadata is not accepted

## Delivery Records

- [deliverable-20261006.md](./deliverable-20261006.md)：2026-10-06 beta 渠道交付记录（版本 `0.1.0`，触发分支 `feat/deliverable-fixes-20261006`，新增便携版打包）
- [e2e-remediation-20261006.md](./e2e-remediation-20261006.md)：2026-10-06 e2e 整改记录（版本 `0.1.0`，触发分支 `feat/e2e-remediation-20261006`，测试隔离/LLM stub/回滚与 UI e2e/门禁恢复/CI 修正）
- [registry-stage1-20261017.md](./registry-stage1-20261017.md)：2026-10-17 治理层阶段①（登记册、坐标管线、建域查重、影子模式）
- [review-fixes-20261018.md](./review-fixes-20261018.md)：2026-10-18 审查修复（beta 更新版本方案、安装包完整性、登记册名称/坐标一致性、`NEW:` 路径、project_id/样本路径、UI reject 与 e2e reporter）
- [tray-popover-ui-20261018.md](./tray-popover-ui-20261018.md)：2026-10-18 托盘化 UI（托盘入口、自适应悬浮窗、独立设置窗、规则/更新面板、图标与隐藏窗口 e2e）
- [portable-20261019.md](./portable-20261019.md)：2026-10-19 Windows 便携版交付（版本 `0.1.0`，触发分支 `release/portable-20261019`，`dist:win:portable` 脚本与单文件 exe 产物）

## Rollback Path

1. Identify broken release tag and channel.
2. Mark GitHub release as draft or delete release assets if distribution must stop immediately.
3. Revert offending commit on the channel branch (`beta` or `master`) and push.
4. For stable fixes, bump `package.json` version and release again from `master`.
5. For beta fixes, push corrected commit to `beta`; the workflow derives `v<base>-beta.<run>` and injects it into the build, so clients on the previous beta receive the update.
6. If an installer was downloaded before the fix, delete `%APPDATA%\File Pilot\updates\` before retrying; unverified partial files are not used.

## Evidence Checklist

Every change must provide:

- Release info: version, channel, trigger branch
- Docs delta: what update docs changed
- Rollback note: exact fallback command/process
- Verification: command outputs for `typecheck`, `lint`, `test`, `build`
