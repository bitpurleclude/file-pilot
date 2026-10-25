# Update System Runbook

## Purpose

This runbook is for operating the in-app update flow backed by GitHub Releases.

## Preconditions

- Channel branch exists:
  - `beta` for prerelease
  - `master` for stable
- GitHub Actions has `contents: write` permission
- Repository secrets/tokens are configured for release publishing

## Release Publish Steps

1. Merge or push to `beta` (prerelease) or `master` (stable).
2. Workflow `Release Publish` starts automatically.
3. Workflow executes:
   - `npm ci`
   - derive the build version (`<base>-beta.<run>` for beta) and apply it with `npm version --no-git-tag-version`
   - `npm run dist:win`
   - upload `release/*.exe` and `release/latest*.yml` to GitHub Release
4. Confirm release page shows the correct tag, installer asset, and `latest.yml`.

## Client Update Check Behavior

`checkStatus` semantics:

- `ok`: check completed normally
- `unreachable`: network/server unreachable
- `invalid_response`: GitHub API response invalid
- `channel_no_release`: selected channel has no release
- `asset_missing`: release exists but no Windows installer asset

Only `available=true` with `checkStatus=ok` and `downloadUrl` present should enable download.

## Download Integrity

- The client downloads `latest.yml` from the same release and reads the SHA-512 for the selected NSIS installer.
- The installer is streamed to a `.download` file, hashed, and only renamed into place when the digest matches.
- A release without `latest.yml` fails closed with `UPDATER_METADATA_MISSING`; a mismatched digest fails with `UPDATER_INTEGRITY_MISMATCH` and the partial file is deleted.
- Code signing remains disabled in this phase (`forceCodeSigning: false`); the SHA-512 check is the minimum integrity gate.

## Incident Handling

### Symptom: Check update shows error

1. Inspect `checkStatus` and `errorCode` from renderer logs.
2. Validate GitHub Release exists for selected channel.
3. Confirm release has `.exe` asset.
4. Retry check from client.

### Symptom: Download fails

1. Inspect IPC error code:
   - `UPDATER_UNREACHABLE`
   - `UPDATER_INVALID_RESPONSE`
   - `UPDATER_CHANNEL_NO_RELEASE`
   - `UPDATER_ASSET_MISSING`
   - `UPDATER_METADATA_MISSING`
   - `UPDATER_METADATA_INVALID`
   - `UPDATER_INTEGRITY_MISMATCH`
   - `UPDATER_DOWNLOAD_FAILED`
2. Confirm asset URL accessibility and that `latest.yml` is attached to the release.
3. If the digest mismatches, do not install; delete the `updates/` cache and re-run the release workflow.
4. Re-run release workflow if artifact upload failed.

## Rollback Procedure

1. Stop distribution by editing/removing faulty release assets.
2. Revert release-causing commit in channel branch.
3. Publish fixed release:
   - `beta`: push fix to `beta`; the workflow derives a new `v<base>-beta.<run>` build version
   - `master`: bump version, push to `master`
4. Re-test check/download/install flow on clean client, including `latest.yml` verification.

## 便携版发布注意事项

自 2026-10-06 起，`npm run dist:win` 除 NSIS 安装包外，同时产出便携版（portable）。

### 产物命名

- NSIS 安装包：`File Pilot Setup <version>.exe`
- 便携版：`File-Pilot-<version>-Portable.exe`（由 `package.json` 的 `build.portable.artifactName` 配置）
- 两种产物均输出到 `release/` 目录；发布流水线按 `release/*.exe` 模式上传资产，便携版天然命中该模式，无需调整资产校验。

### 分发方式

- 便携版为单文件免安装程序，可直接拷贝或下载后双击运行，适合免管理员权限、无安装权限或临时环境使用。
- 便携版与安装版可并存；分发时请明确标注版本号，避免用户混用新旧便携包。
- 便携版升级即"用新版文件替换旧版文件"，无需卸载步骤。

### 数据目录说明

- 便携版仅程序本身免安装；运行时数据（数据库 / 设置 / 日志 / 更新缓存）仍写入用户目录 `%APPDATA%\File Pilot`（Electron `userData`），不随程序文件携带。
- 换机器运行便携版不会自动带数据；如需迁移，需手动拷贝 `%APPDATA%\File Pilot`。
- 回滚或卸载不影响 `%APPDATA%\File Pilot`；若用户已完成 LLM Provider 配置迁移，回滚到旧版本后首次启动会走 legacy 迁移逻辑（兼容）。
