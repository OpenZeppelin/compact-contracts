import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RunLock } from '../RunLock.ts';

/**
 * Dry unit tests for `RunLock.ts`, the one service that only touches the
 * filesystem: each case works in its own temp directory.
 */

describe('RunLock', () => {
  /** Out of every kernel's pid range, so `process.kill(pid, 0)` can only report
   * "no such process" — a stale lock without having to kill a real one. */
  const DEAD_PID = 2 ** 31 - 1;

  let dir: string;
  let lockPath: string;

  const stamp = (pid: number): void => {
    writeFileSync(lockPath, JSON.stringify({ pid, startedAt: 'earlier' }));
  };
  const holder = (): number =>
    (JSON.parse(readFileSync(lockPath, 'utf8')) as { pid: number }).pid;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'runlock-'));
    lockPath = path.join(dir, '.live-verify.lock');
  });

  afterEach(() => {
    new RunLock(lockPath).release();
  });

  it('stamps the lock with our pid when it is free', () => {
    new RunLock(lockPath).acquire();

    expect(holder()).toBe(process.pid);
  });

  it('refuses a lock held by a live process', () => {
    // Our parent is alive by construction, and is not us.
    stamp(process.ppid);

    expect(() => new RunLock(lockPath).acquire()).toThrow(
      `another test:live run is already in progress (pid ${process.ppid}, started earlier)`,
    );
    expect(holder()).toBe(process.ppid);
  });

  it('reclaims a lock left behind by a dead process', () => {
    stamp(DEAD_PID);

    new RunLock(lockPath).acquire();

    expect(holder()).toBe(process.pid);
  });

  it('refuses a fresh lock whose stamp has not landed yet', () => {
    // What a concurrent `wx` create looks like from outside between creating
    // the path and writing the pid: an empty file.
    writeFileSync(lockPath, '');

    expect(() => new RunLock(lockPath).acquire()).toThrow(
      'another test:live run is already in progress. Wait for it',
    );
    expect(readFileSync(lockPath, 'utf8')).toBe('');
  });

  it('reclaims an unreadable lock past the grace period', () => {
    writeFileSync(lockPath, '');
    const aMinuteAgo = (Date.now() - 60_000) / 1000;
    utimesSync(lockPath, aMinuteAgo, aMinuteAgo);

    new RunLock(lockPath).acquire();

    expect(holder()).toBe(process.pid);
  });

  it('leaves nothing behind when it reclaims', () => {
    stamp(DEAD_PID);

    new RunLock(lockPath).acquire();

    // The reclaim moves the stale file aside to win it atomically; that copy is
    // a step, not an artifact.
    expect(readdirSync(dir)).toStrictEqual([path.basename(lockPath)]);
  });

  it('releases a lock it owns', () => {
    const lock = new RunLock(lockPath);
    lock.acquire();

    lock.release();

    expect(readdirSync(dir)).toStrictEqual([]);
  });

  it('leaves a lock owned by another run alone', () => {
    stamp(DEAD_PID);

    // A run that lost a stale-lock race must not delete the winner's lock on the
    // way out, so `release` checks ownership rather than just unlinking.
    new RunLock(lockPath).release();

    expect(holder()).toBe(DEAD_PID);
  });
});
