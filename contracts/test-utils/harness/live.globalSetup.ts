import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchCoinEvents, indexerHead } from './ledgerEvents.js';

/**
 * Vitest `globalSetup` for the live tests — runs once in the main process,
 * before any worker builds a wallet, so a bad environment fails in ~1s instead
 * of after a slow wallet build. Gated on `MIDNIGHT_BACKEND === 'live'` so a dry
 * `vitest run` that happens to glob the live tests is a no-op.
 *
 * It guards two things:
 *   - **Freshness.** The live tests are not isolated from one another: they all
 *     run against the same node, so shielded-coin state left by an earlier run
 *     changes a later run's outcome (a coin re-spent against stale state is
 *     rejected with node `Custom error: 103`). Genesis records the funded
 *     seeds' shielded coins in block 0 (measured: 28 events); any coin a test
 *     creates on-chain is recorded in a later block. So a coin event at or
 *     beyond block {@link SCAN_FROM} means an earlier run left state behind —
 *     abort and tell the dev to `env:up`.
 *   - **Single run.** Two live runs against one node corrupt each other's coin
 *     state. A pid-stamped lock file makes the second run fail fast.
 *
 * Escape hatch: `MIDNIGHT_LIVE_ALLOW_DIRTY=1` skips the freshness check (the
 * lock is still taken). Thresholds: `MIDNIGHT_LIVE_MAX_COIN_EVENTS` (default 0),
 * `MIDNIGHT_LIVE_MAX_SCAN_BLOCKS` (default 3600 ≈ 6h of idle blocks).
 */

const LOGS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../logs',
);
const LOCK_PATH = path.join(LOGS_DIR, '.live-run.lock');

const INDEXER_PORT = Number(process.env.MIDNIGHT_INDEXER_PORT ?? 8088);
const INDEXER_URL = `http://127.0.0.1:${INDEXER_PORT}/api/v4/graphql`;

// Genesis coins are block 0; real deposits/drains are block 1+.
const SCAN_FROM = 1;
const MAX_COIN_EVENTS = Number(process.env.MIDNIGHT_LIVE_MAX_COIN_EVENTS ?? 0);
const MAX_SCAN_BLOCKS = Number(
  process.env.MIDNIGHT_LIVE_MAX_SCAN_BLOCKS ?? 3600,
);
const SCAN_CHUNK = 32;
const SCAN_CONCURRENCY = 8;

const ENV_UP_HINT = "run 'corepack yarn env:up' to reset the local stack";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// --- lock ------------------------------------------------------------------

export interface LockInfo {
  readonly pid: number;
  readonly startedAt: string;
}

/** Whether a pid names a live process (EPERM means alive but not ours to signal). */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * What an existing lock means for this process: `reentrant` when we already hold
 * it (one vitest process can run several live projects, each with its own
 * globalSetup), `held` when a live process owns it, `stale` otherwise.
 */
export function lockHolderState(
  info: LockInfo,
  ownPid: number,
  isAlive: (pid: number) => boolean,
): 'reentrant' | 'held' | 'stale' {
  if (info.pid === ownPid) return 'reentrant';
  return isAlive(info.pid) ? 'held' : 'stale';
}

function readLock(): LockInfo | undefined {
  try {
    return JSON.parse(readFileSync(LOCK_PATH, 'utf8')) as LockInfo;
  } catch {
    return undefined;
  }
}

function removeLock(): void {
  try {
    unlinkSync(LOCK_PATH);
  } catch {
    // already gone
  }
}

/** Take the lock, or throw if another live process holds it. */
function acquireLock(): { reentrant: boolean } {
  mkdirSync(LOGS_DIR, { recursive: true });
  const stamp = JSON.stringify({
    pid: process.pid,
    startedAt: new Date().toISOString(),
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync(LOCK_PATH, stamp, { flag: 'wx' });
      return { reentrant: false };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      const info = readLock();
      const state = info
        ? lockHolderState(info, process.pid, pidAlive)
        : 'stale';
      if (state === 'reentrant') return { reentrant: true };
      if (state === 'held') {
        throw new Error(
          `another live run is already in progress (pid ${info?.pid}, ` +
            `started ${info?.startedAt}). Wait for it to finish, or remove ` +
            `${LOCK_PATH} if it is stale.`,
        );
      }
      removeLock(); // stale or unreadable — reclaim and retry
    }
  }
  throw new Error(`could not acquire the live-run lock at ${LOCK_PATH}`);
}

/** Release only if we still own the lock (guards against a stale takeover). */
function releaseLock(reentrant: boolean): void {
  if (reentrant) return;
  const info = readLock();
  if (info?.pid === process.pid) removeLock();
}

// --- freshness -------------------------------------------------------------

/**
 * Count coin-commitment events in `[from, head]`, scanning in parallel chunks
 * and stopping as soon as the count exceeds `threshold` (so a dirty node is
 * caught in the first chunk; a clean node scans everything). `fetchWindow`
 * returns the event count for an inclusive block range — injected for testing.
 */
export async function countCoinEvents(
  fetchWindow: (from: number, to: number) => Promise<number>,
  from: number,
  head: number,
  threshold: number,
  { chunk = SCAN_CHUNK, concurrency = SCAN_CONCURRENCY } = {},
): Promise<number> {
  const windows: [number, number][] = [];
  for (let lo = from; lo <= head; lo += chunk) {
    windows.push([lo, Math.min(lo + chunk - 1, head)]);
  }
  let count = 0;
  for (let i = 0; i < windows.length; i += concurrency) {
    const batch = windows.slice(i, i + concurrency);
    const counts = await Promise.all(
      batch.map(([lo, hi]) => fetchWindow(lo, hi)),
    );
    for (const c of counts) count += c;
    if (count > threshold) return count;
  }
  return count;
}

async function indexerHeadWithRetry(): Promise<number> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      return await indexerHead(INDEXER_URL);
    } catch (e) {
      lastError = e;
      await sleep(1000);
    }
  }
  throw new Error(
    `live indexer not reachable at ${INDEXER_URL} (${String(lastError)}). ` +
      `Is the stack up? ${ENV_UP_HINT}.`,
  );
}

async function assertFreshNode(): Promise<void> {
  const head = await indexerHeadWithRetry();
  if (head > MAX_SCAN_BLOCKS) {
    throw new Error(
      'live stack has been up too long to verify freshness (indexer head ' +
        `${head} > ${MAX_SCAN_BLOCKS} blocks) — ${ENV_UP_HINT}, or set ` +
        'MIDNIGHT_LIVE_ALLOW_DIRTY=1 to run against it anyway.',
    );
  }
  const count = await countCoinEvents(
    (from, to) => fetchCoinEvents(INDEXER_URL, from, to).then((e) => e.length),
    SCAN_FROM,
    head,
    MAX_COIN_EVENTS,
  );
  if (count > MAX_COIN_EVENTS) {
    throw new Error(
      `live stack is not fresh: found ${count} shielded coin event(s) beyond ` +
        `genesis (block ${SCAN_FROM}+), so a previous run left state on the ` +
        `node. This makes shielded spends fail with node "Custom error: 103". ` +
        `${ENV_UP_HINT}, or set MIDNIGHT_LIVE_ALLOW_DIRTY=1 to run anyway.`,
    );
  }
}

export default async function setup(): Promise<() => void> {
  if (process.env.MIDNIGHT_BACKEND !== 'live') return () => {};
  const { reentrant } = acquireLock();
  try {
    if (process.env.MIDNIGHT_LIVE_ALLOW_DIRTY !== '1') await assertFreshNode();
  } catch (e) {
    releaseLock(reentrant);
    throw e;
  }
  return () => releaseLock(reentrant);
}
