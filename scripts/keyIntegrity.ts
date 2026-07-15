import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Recursively collect `<Contract>` basenames of every `.compact` under `root`.
 * The compiler names each artifact dir after the source file's basename, so this
 * is the set of contract names the current tree can legitimately produce. */
function compactContractNames(root: string): Set<string> {
  const names = new Set<string>();
  if (!existsSync(root)) return names;
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith('.compact'))
        names.add(entry.name.slice(0, -'.compact'.length));
    }
  };
  walk(root);
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
 * When `sourceRoot` is given, only contracts that still have a `.compact` source
 * under it are checked, so stale orphan artifact dirs (source deleted, keys never
 * rebuilt) do not false-positive. Omit it to scan every contract dir.
 *
 * @param artifactsRoot - artifact tree to scan (e.g. `contracts/artifacts`)
 * @param sourceRoot - optional source tree to scope by (e.g. `contracts/src`)
 * @returns absolute paths of empty key files; empty array means all good
 */
export function emptyKeyArtifacts(
  artifactsRoot: string,
  sourceRoot?: string,
): string[] {
  if (!existsSync(artifactsRoot)) return [];
  const live = sourceRoot ? compactContractNames(sourceRoot) : undefined;
  const empty: string[] = [];
  for (const contract of readdirSync(artifactsRoot, { withFileTypes: true })) {
    if (!contract.isDirectory()) continue;
    if (live && !live.has(contract.name)) continue; // skip stale orphans
    collectEmptyKeys(path.join(artifactsRoot, contract.name), empty);
  }
  return empty;
}

// Standalone CLI: `node scripts/keyIntegrity.ts` checks the repo's artifacts
// against its sources and exits 1 if any live contract has a truncated key.
const selfPath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === selfPath) {
  const repoRoot = path.resolve(path.dirname(selfPath), '..');
  const contracts = path.join(repoRoot, 'contracts');
  const bad = emptyKeyArtifacts(
    path.join(contracts, 'artifacts'),
    path.join(contracts, 'src'),
  );
  if (bad.length === 0) {
    console.log('ZK keys OK — no truncated (0-byte) .verifier/.prover files.');
  } else {
    console.log('Truncated (0-byte) ZK key(s) found:');
    for (const k of bad) console.log(`  ✗ ${path.relative(repoRoot, k)}`);
    console.log(
      '\nDrain the turbo cache and recompile serially — a parallel recompile ' +
        'can re-poison the cache (OpenZeppelin/compact-contracts#675):\n' +
        '  rm -rf .turbo/cache && corepack yarn compact --concurrency=1',
    );
  }
  process.exit(bad.length === 0 ? 0 : 1);
}
