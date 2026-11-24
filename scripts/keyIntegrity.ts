import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ARTIFACTS,
  type ArtifactRoot,
  INTEGRATION_ARTIFACTS,
  INTEGRATION_MOCKS,
  REPO_ROOT,
  SRC,
} from './live/paths.ts';

/** The artifact directory of every `.compact` under each root's source tree,
 * i.e. every directory the current sources can legitimately produce. */
function contractArtifactDirs(roots: readonly ArtifactRoot[]): string[] {
  const dirs: string[] = [];
  const walk = (root: ArtifactRoot, dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(root, p);
      else if (entry.name.endsWith('.compact'))
        dirs.push(
          path.join(
            root.artifacts,
            path.relative(root.src, p.slice(0, -'.compact'.length)),
          ),
        );
    }
  };
  for (const root of roots) if (existsSync(root.src)) walk(root, root.src);
  return dirs;
}

function collectEmptyKeys(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectEmptyKeys(p, out);
    } else if (
      (entry.name.endsWith('.verifier') || entry.name.endsWith('.prover')) &&
      statSync(p).size === 0
    ) {
      out.push(p);
    }
  }
}

/**
 * Find 0-byte ZK key files (`*.verifier` / `*.prover`) in the artifacts of the
 * contracts under `roots`.
 *
 * A truncated key comes from a killed compile, or from a turbo cache entry that
 * captured one. A 0-byte `_deposit.verifier` makes a real deploy fail in
 * `beforeAll`, which vitest turns into a silent whole-suite skip. Callers check
 * this before starting the live stack.
 *
 * Only contracts that still have a `.compact` source are checked, so stale
 * orphan artifact dirs (source deleted, keys never rebuilt) do not
 * false-positive.
 *
 * @returns absolute paths of empty key files; empty array means all good
 */
export function emptyKeyArtifacts(...roots: ArtifactRoot[]): string[] {
  const empty: string[] = [];
  for (const dir of contractArtifactDirs(roots)) {
    if (isDirectory(dir)) collectEmptyKeys(dir, empty);
  }
  return empty;
}

/** What every artifact directory carries, whatever the contract: the module the
 * specs import and the compiler's description of it. */
const REQUIRED_FILES = ['contract/index.js', 'compiler/contract-info.json'];

/** Key files the contract's circuits need, off its `contract-info.json`: one
 * prover/verifier pair per circuit the compiler proves. Pure circuits and
 * witness-only ones (`proof: false`) get no keys; the field is absent on older
 * artifacts, which only know pure. A module with no circuits (most of `src/`)
 * needs none, so an absent `keys/` is right for it. Unreadable info is not
 * reported here; `REQUIRED_FILES` already names the file. */
function requiredKeyFiles(contractDir: string): string[] {
  let circuits: readonly { name: string; pure: boolean; proof?: boolean }[];
  try {
    const info = readFileSync(
      path.join(contractDir, 'compiler/contract-info.json'),
      'utf8',
    );
    circuits =
      (JSON.parse(info) as { circuits?: typeof circuits }).circuits ?? [];
  } catch {
    return [];
  }
  return circuits
    .filter((c) => !c.pure && c.proof !== false)
    .flatMap((c) => [`keys/${c.name}.prover`, `keys/${c.name}.verifier`]);
}

function isDirectory(p: string): boolean {
  return statSync(p, { throwIfNoEntry: false })?.isDirectory() ?? false;
}

function isFile(p: string): boolean {
  return statSync(p, { throwIfNoEntry: false })?.isFile() ?? false;
}

/**
 * Artifacts of the contracts under `roots` that are absent or incomplete.
 *
 * {@link emptyKeyArtifacts} scans what is on disk, so a directory that never
 * arrived, or arrived without its module or keys, passes it silently, and every
 * one of those fails the deploy exactly like a truncated key does. After a
 * compile the case cannot arise (a successful compile wrote every file), but a
 * tree built elsewhere can be incomplete: a CI suite job downloads one, and a
 * download that unpacked partially would otherwise reach the specs. Its
 * consumers check this alongside the key scan.
 *
 * @returns absolute paths, sorted: the artifact directory when it is missing,
 *   else each required file it lacks
 */
export function missingKeyArtifacts(...roots: ArtifactRoot[]): string[] {
  const missing: string[] = [];
  for (const dir of contractArtifactDirs(roots)) {
    if (!isDirectory(dir)) {
      missing.push(dir);
      continue;
    }
    for (const file of [...REQUIRED_FILES, ...requiredKeyFiles(dir)]) {
      const p = path.join(dir, file);
      if (!isFile(p)) missing.push(p);
    }
  }
  return missing.sort();
}

// Standalone CLI: `node scripts/keyIntegrity.ts` checks the artifacts of `src`
// and the integration mocks, and exits 1 if any has a truncated key.
const selfPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === selfPath) {
  const bad = emptyKeyArtifacts(
    { src: SRC, artifacts: ARTIFACTS },
    { src: INTEGRATION_MOCKS, artifacts: INTEGRATION_ARTIFACTS },
  );
  if (bad.length === 0) {
    console.log('ZK keys OK — no truncated (0-byte) .verifier/.prover files.');
  } else {
    console.log('Truncated (0-byte) ZK key(s) found:');
    for (const k of bad) console.log(`  ✗ ${path.relative(REPO_ROOT, k)}`);
    console.log(
      '\nRecompile their category without the turbo cache, which may hold ' +
        'the truncated keys:\n  yarn compile:<category> --force',
    );
  }
  process.exit(bad.length === 0 ? 0 : 1);
}
