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
   PR into that branch. The same commit rolls `## Unreleased` in `CHANGELOG.md`
   into `## <version> (<date>)`. The workflow fails if `## Unreleased` has no
   entries (unless `allow_empty_changelog` is ticked). `<date>` is the UTC date
   Prepare ran. If the bump PR conflicts on `CHANGELOG.md`, re-run Prepare
   release.
2. Review and merge the bump PR.
3. On merge, **Create release** (`create-release.yml`) cuts `v<version>` + a
   GitHub Release from that branch (`--prerelease` for any `-alpha`/`-rc`
   version). The release notes are that version's `CHANGELOG.md` section,
   followed by GitHub's generated list. The job fails if the section is missing.
4. That fires **Publish** (`release.yml`), which pauses at the `release`
   approval gate. An authorized reviewer approves, then it publishes to npm.

npm dist-tags: stable → `latest`, `-alpha`/`-rc` → `beta`.

## Changelog

Every PR that changes `contracts/src/` (outside test dirs) or a runtime
dependency in `contracts/package.json` adds an entry under `## Unreleased` in
`CHANGELOG.md`, or carries the `skip-changelog` label if nothing user-facing
changed. The **Changelog entry** check enforces this once it is a required
check (see One-time setup). The bump PR rolls those entries into the release,
so no separate changelog PR is needed at release time.

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
- Prepare release on `release/X.Y.x`, version `X.Y.0-rc.1` (tick
  `allow_empty_changelog` if `## Unreleased` is empty) → merge → publishes `beta`.
- rc fixes later: repeat with `X.Y.0-rc.2`, etc.

**Audit clears (stable + next alpha, same day)**
- Merge audit fixes into `release/X.Y.x`.
- Prepare release on `release/X.Y.x`, version `X.Y.0` (tick
  `allow_empty_changelog` if `## Unreleased` is empty) → merge → publishes `latest`.
- Prepare release on `main`, next minor's first alpha `X.(Y+1).0-alpha.1` → merge
  → publishes `beta`.
- Back-merge `release/X.Y.x` → `main` (keep `main`'s higher version on conflict,
  and in `CHANGELOG.md` keep both sides' version sections, newest first), then
  delete `release/X.Y.x`.

## Retries

Re-running is safe: `create-release.yml` only cuts a release if the tag has no
release yet, so no manual tag/release deletion is needed.

A **Create release** failure on a missing changelog section re-fails on re-run,
because it reads the same commit. Merge the `CHANGELOG.md` fix, then cut the
release by hand (add `--prerelease` for alpha/rc). A release cut with a
maintainer token still fires `release.yml`.

```sh
gh release create v<version> --target <fix-sha> --title v<version> \
  --notes-file <section.md> --generate-notes
```

## One-time setup (repo admin)

- **Settings → Environments → `release`**: add required reviewers (this is what
  makes the approval gate real; without it the publish job pauses for no one).
- **Variables/secrets**: `GH_APP_ID` (var) and `GH_APP_PRIVATE_KEY` (secret) must
  be set — both `prepare-release.yml` and `create-release.yml` need the app token
  (the latter so its release event chains to the publish workflow).
- **Issues → Labels**: create the `skip-changelog` label.
- **Settings → Rules → Rulesets → Main Branch Protection**: require the
  **Changelog entry** status check. Without it the check is advisory only.
