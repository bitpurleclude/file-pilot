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
