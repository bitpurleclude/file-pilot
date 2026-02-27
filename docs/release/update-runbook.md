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
   - `npm run dist:win`
   - upload `release/*.exe` to GitHub Release
4. Confirm release page shows correct tag and installer asset.

## Client Update Check Behavior

`checkStatus` semantics:

- `ok`: check completed normally
- `unreachable`: network/server unreachable
- `invalid_response`: GitHub API response invalid
- `channel_no_release`: selected channel has no release
- `asset_missing`: release exists but no Windows installer asset

Only `available=true` with `checkStatus=ok` and `downloadUrl` present should enable download.

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
   - `UPDATER_DOWNLOAD_FAILED`
2. Confirm asset URL accessibility.
3. Re-run release workflow if artifact upload failed.

## Rollback Procedure

1. Stop distribution by editing/removing faulty release assets.
2. Revert release-causing commit in channel branch.
3. Publish fixed release:
   - `beta`: push fix to `beta`
   - `master`: bump version, push to `master`
4. Re-test check/download/install flow on clean client.
