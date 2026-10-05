import {
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { LOGS, VERIFY_LOCK } from './paths.ts';

/** How long an unreadable lock is presumed to be one still being written. A
 * `wx` create lands the path before its stamp, and a reader in that window sees
 * an empty file, so a young unreadable lock is a live one, not a corpse. */
const UNREADABLE_GRACE_MS = 10_000;

interface LockInfo {
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
 * Pid-stamped lock making one orchestrator run exclusive.
 *
 * Two concurrent runs would interleave `env-up` resets and shielded-coin spends
 * against the one shared node, so the second run fails fast instead. A lock left
 * behind by a killed run is reclaimed, since its pid is no longer alive.
 *
 * This is the *orchestrator* lock. `live.globalSetup` holds a separate,
 * deliberately reentrant one (`.live-run.lock`) scoped to a vitest process.
 */
export class RunLock {
  readonly #path: string;

  constructor(lockPath: string = VERIFY_LOCK) {
    this.#path = lockPath;
  }

  #read(): LockInfo | undefined {
    try {
      return JSON.parse(readFileSync(this.#path, 'utf8')) as LockInfo;
    } catch {
      return undefined;
    }
  }

  /** Whether the lock on disk can be reclaimed: stamped by a dead process, or
   * unreadable for longer than {@link UNREADABLE_GRACE_MS}. */
  #stale(info: LockInfo | undefined): boolean {
    if (info) return !pidAlive(info.pid);
    try {
      return Date.now() - statSync(this.#path).mtimeMs > UNREADABLE_GRACE_MS;
    } catch {
      // Gone between the failed create and here: its holder released it. The
      // reclaim's rename then fails with ENOENT and reports it as held, which
      // is the safe way to lose this race.
      return true;
    }
  }

  /** The "someone else holds it" rejection, shared by both losing paths. */
  #heldBy(info: LockInfo | undefined): Error {
    const who = info ? ` (pid ${info.pid}, started ${info.startedAt})` : '';
    return new Error(
      `another test:live run is already in progress${who}. ` +
        `Wait for it, or remove ${this.#path}.`,
    );
  }

  /**
   * Take the lock, or throw if another run holds it.
   *
   * Every step that can be contended is a single atomic filesystem call, because
   * two runs starting at the same moment reach each of them together:
   *   - `wx` create — only one process can create the path;
   *   - `rename` of a stale lock — POSIX moves the inode once, so the second
   *     reclaimer gets ENOENT and loses.
   * A plain overwrite would let both reclaimers "win": the last writer owns the
   * file while the other runs on believing it holds the lock (its `release()`
   * finds a foreign pid and silently no-ops), so two orchestrators would drive
   * the one node — exactly what the lock exists to prevent.
   */
  acquire(): void {
    mkdirSync(LOGS, { recursive: true });
    const stamp = JSON.stringify({
      pid: process.pid,
      startedAt: new Date().toISOString(),
    });
    try {
      writeFileSync(this.#path, stamp, { flag: 'wx' });
      return;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }

    const info = this.#read();
    if (!this.#stale(info)) throw this.#heldBy(info);

    // Stale. Claim the right to reclaim it by moving it aside, then create the
    // lock fresh under `wx` — so a third run that started in between still wins
    // or loses cleanly rather than sharing.
    const stolen = `${this.#path}.stale.${process.pid}`;
    try {
      renameSync(this.#path, stolen);
    } catch (e) {
      // ENOENT means another run reclaimed it first; anything else (a
      // permissions problem on `logs/`) is its own fault and says so.
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      throw this.#heldBy(this.#read());
    }
    try {
      unlinkSync(stolen);
    } catch {
      // best effort — the lock itself is what matters
    }
    try {
      writeFileSync(this.#path, stamp, { flag: 'wx' });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      throw this.#heldBy(this.#read());
    }
  }

  /** Release only if we still own it, so a stale takeover is never clobbered. */
  release(): void {
    if (this.#read()?.pid !== process.pid) return;
    try {
      unlinkSync(this.#path);
    } catch {
      // already gone
    }
  }
}
