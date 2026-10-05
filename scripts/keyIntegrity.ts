import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Recursively collect `<Contract>` basenames of every `.compact` under `roots`.
 * The compiler names each artifact dir after the source file's basename, so this
 * is the set of contract names the current tree can legitimately produce. */
function compactContractNames(...roots: string[]): Set<string> {
  const names = new Set<string>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.compact'))
        names.add(entry.name.slice(0, -'.compact'.length));
    }
  };
  for (const root of roots) if (existsSync(root)) walk(root);
  return names;
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
 * Find 0-byte ZK key files (`*.verifier` / `*.prover`) under `artifactsRoot`.
 *
 * Compile can report success (a turbo cache hit, or a compiler that exits 0)
 * while leaving a truncated key on disk — an interrupted/killed compile, or a
 * turbo cache-restore racing a concurrent compile over the shared `artifacts/`
 * tree (OpenZeppelin/compact-contracts#675). A 0-byte `_deposit.verifier` makes a
 * real deploy fail in `beforeAll`, which vitest turns into a silent whole-suite
 * skip. Callers check this before starting the live stack.
 *
 * When `sourceRoots` are given, only contracts that still have a `.compact`
 * source under one of them are checked, so stale orphan artifact dirs (source
 * deleted, keys never rebuilt) do not false-positive. Pass none to scan every
 * contract dir.
 *
 * More than one root matters because sources outside `src/` also compile into the
 * same `artifacts/` tree: the integration mocks live under
 * `test/integration/_mocks`, so a `src`-only scan silently skips them — the live
 * integration target passes both roots.
 *
 * @param artifactsRoot - artifact tree to scan (e.g. `contracts/artifacts`)
 * @param sourceRoots - source trees to scope by (e.g. `contracts/src`)
 * @returns absolute paths of empty key files; empty array means all good
 */
export function emptyKeyArtifacts(
  artifactsRoot: string,
  ...sourceRoots: string[]
): string[] {
  if (!existsSync(artifactsRoot)) return [];
  const live =
    sourceRoots.length > 0 ? compactContractNames(...sourceRoots) : undefined;
  const empty: string[] = [];
  for (const contract of readdirSync(artifactsRoot, { withFileTypes: true })) {
    if (!contract.isDirectory()) continue;
    if (live && !live.has(contract.name)) continue; // skip stale orphans
    collectEmptyKeys(path.join(artifactsRoot, contract.name), empty);
  }
  return empty;
}

/** What every artifact directory carries, whatever the contract: the module the
 * specs import and the compiler's description of it. */
const REQUIRED_FILES = ['contract/index.js', 'compiler/contract-info.json'];

/** Key files the contract's circuits need, off its `contract-info.json`: one
 * prover/verifier pair per impure circuit. A module with no circuits (most of
 * `src/`) needs none, so an absent `keys/` is right for it. Unreadable info is
 * not reported here; `REQUIRED_FILES` already names the file. */
function requiredKeyFiles(contractDir: string): string[] {
  let circuits: readonly { name: string; pure: boolean }[];
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
    .filter((c) => !c.pure)
    .flatMap((c) => [`keys/${c.name}.prover`, `keys/${c.name}.verifier`]);
}

function isDirectory(p: string): boolean {
  return statSync(p, { throwIfNoEntry: false })?.isDirectory() ?? false;
}

function isFile(p: string): boolean {
  return statSync(p, { throwIfNoEntry: false })?.isFile() ?? false;
}

/**
 * Artifacts under `sourceRoots` that are absent or incomplete.
 *
 * {@link emptyKeyArtifacts} scans what is on disk, so a directory that never
 * arrived, or arrived without its module or keys, passes it silently, and every
 * one of those fails the deploy exactly like a truncated key does. After a
 * compile the case cannot arise (a successful compile wrote every file), but a
 * tree built elsewhere can be incomplete: a CI suite job downloads one, and a
 * download that unpacked partially would otherwise reach the specs. Its
 * consumers check this alongside the key scan.
 *
 * @param artifactsRoot - artifact tree to check (e.g. `contracts/artifacts`)
 * @param sourceRoots - source trees whose contracts must all be present
 * @returns paths relative to `artifactsRoot`, sorted: the contract name when
 *   its directory is missing, else each required file it lacks
 */
export function missingKeyArtifacts(
  artifactsRoot: string,
  ...sourceRoots: string[]
): string[] {
  const missing: string[] = [];
  for (const name of compactContractNames(...sourceRoots)) {
    const dir = path.join(artifactsRoot, name);
    if (!isDirectory(dir)) {
      missing.push(name);
      continue;
    }
    for (const file of [...REQUIRED_FILES, ...requiredKeyFiles(dir)]) {
      if (!isFile(path.join(dir, file))) missing.push(`${name}/${file}`);
    }
  }
  return missing.sort();
}

// Standalone CLI: `node scripts/keyIntegrity.ts` checks the repo's artifacts
// against its sources — `src` plus the integration mocks, the two trees that
// compile into `artifacts/` — and exits 1 if any has a truncated key.
const selfPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === selfPath) {
  const repoRoot = path.resolve(path.dirname(selfPath), '..');
  const contracts = path.join(repoRoot, 'contracts');
  const bad = emptyKeyArtifacts(
    path.join(contracts, 'artifacts'),
    path.join(contracts, 'src'),
    path.join(contracts, 'test/integration/_mocks'),
  );
  if (bad.length === 0) {
    console.log('ZK keys OK — no truncated (0-byte) .verifier/.prover files.');
  } else {
    console.log('Truncated (0-byte) ZK key(s) found:');
    for (const k of bad) console.log(`  ✗ ${path.relative(repoRoot, k)}`);
    console.log(
      '\nDrain the turbo cache and recompile serially — a parallel recompile ' +
        'can re-poison the cache (OpenZeppelin/compact-contracts#675):\n' +
        '  rm -rf .turbo/cache && yarn compile --concurrency=1',
    );
  }
  process.exit(bad.length === 0 ? 0 : 1);
}
