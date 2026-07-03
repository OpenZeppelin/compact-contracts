# Releasing

Releases are automated. You bump the version via a workflow, merge the bump PR,
and the tag, GitHub Release, and npm publish happen on their own (behind a
manual approval gate).

Notation: `X.Y.Z` is a concrete SemVer; `release/X.Y.x` is the audit branch for
the `X.Y` line (the `x` is literal — it denotes the patch line, not a point);
`N` is a prerelease counter.

## Branch model

- **`main`** — the alpha line; always exists.
- **`release/X.Y.x`** — the `X.Y` patch line; cut from `main` when an audit
  starts, carries `X.Y.0-rc.N → X.Y.0` (and any later `X.Y.Z` hotfixes). Deleted
  after back-merge; recreate it from the `vX.Y.Z` tag if a later hotfix is needed.

There is no long-lived per-version branch: a version bump is just a PR into
`main` or a `release/X.Y.x` branch.

## How it works

1. Run **Prepare release** (`prepare-release.yml`) via *Actions → Run workflow*:
   pick the branch, type the exact target version. It opens a `chore/bump-<version>`
   PR into that branch.
2. Review and merge the bump PR.
3. On merge, **Create release** (`create-release.yml`) cuts `v<version>` + a
   GitHub Release from that branch (`--prerelease` for any `-alpha`/`-rc`
   version).
4. That fires **Publish** (`release.yml`), which pauses at the `release`
   approval gate. An authorized reviewer approves, then it publishes to npm.

npm dist-tags: stable → `latest`, `-alpha`/`-rc` → `beta`.

## Versioning

Standard SemVer pre-release identifiers, in sort order:
`X.Y.0-alpha.N → … → X.Y.0-rc.N → … → X.Y.0`. Counters start at `.1` (no
`-rc.0`). Content drives the minor (`X.Y`); the 3-week cadence drives only the
alpha counter.

## Common flows

**Scheduled alpha (from `main`)**
- Prepare release on `main`, version `X.Y.0-alpha.N` → merge → publishes `beta`.

**Audit starts (cut the release line)**
- `git branch release/X.Y.x <audit-sha> && git push origin release/X.Y.x`
  (creating the branch cuts nothing — its version is already tagged).
- Prepare release on `release/X.Y.x`, version `X.Y.0-rc.1` → merge → publishes `beta`.
- rc fixes later: repeat with `X.Y.0-rc.2`, etc.

**Audit clears (stable + next alpha, same day)**
- Merge audit fixes into `release/X.Y.x`.
- Prepare release on `release/X.Y.x`, version `X.Y.0` → merge → publishes `latest`.
- Prepare release on `main`, next minor's first alpha `X.(Y+1).0-alpha.1` → merge
  → publishes `beta`.
- Back-merge `release/X.Y.x` → `main` (keep `main`'s higher version on conflict),
  then delete `release/X.Y.x`.

## Retries

Re-running is safe: `create-release.yml` only cuts a release if the tag has no
release yet, so no manual tag/release deletion is needed.

## One-time setup (repo admin)

- **Settings → Environments → `release`**: add required reviewers (this is what
  makes the approval gate real; without it the publish job pauses for no one).
- **Variables/secrets**: `GH_APP_ID` (var) and `GH_APP_PRIVATE_KEY` (secret) must
  be set — both `prepare-release.yml` and `create-release.yml` need the app token
  (the latter so its release event chains to the publish workflow).
