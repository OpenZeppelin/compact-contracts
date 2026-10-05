import { describe, expect, it, vi } from 'vitest';
import {
  type CacheEntry,
  GhCacheClient,
  pruneCaches,
  prunePlan,
} from '../caches.ts';
import type { Captured, Exec } from '../gh.ts';

/**
 * Unit tests for `caches.ts`. The `gh cache` adapter is driven through a
 * recording `Exec`, so the argv it builds is asserted rather than run.
 */

describe('prunePlan', () => {
  const HASH_A = 'a'.repeat(64);
  const HASH_B = 'b'.repeat(64);
  const NOW = Date.parse('2026-08-25T02:00:00Z');
  const DAYS = 24 * 60 * 60 * 1000;

  /** An entry accessed recently enough to survive the staleness rule. */
  const entry = (fields: Partial<CacheEntry> & { id: number }): CacheEntry => ({
    key: `Linux-deps-v1-${HASH_A}`,
    ref: 'refs/heads/main',
    createdAt: '2026-08-24T02:00:00Z',
    lastAccessedAt: '2026-08-25T01:00:00Z',
    sizeInBytes: 1024 * 1024,
    ...fields,
  });

  it('keeps a lone, recently used entry', () => {
    expect(prunePlan([entry({ id: 1 })], NOW)).toStrictEqual([]);
  });

  it('deletes every entry in a group but the newest', () => {
    // `actions/cache` restores the exact key or the newest prefix match, so an
    // older sibling can never be restored again once a newer one exists.
    const old = entry({
      id: 1,
      key: `Linux-deps-v1-${HASH_B}`,
      createdAt: '2026-08-20T02:00:00Z',
    });
    const newest = entry({ id: 2 });

    const doomed = prunePlan([old, newest], NOW);

    expect(doomed.map((d) => d.entry.id)).toStrictEqual([1]);
    expect(doomed[0]?.reason).toContain(`superseded by '${newest.key}'`);
  });

  it('groups by key prefix, not by exact key', () => {
    // Two different hashes under `Linux-live-token-` are one group; the deps
    // family is another. Only the older token entry goes.
    const doomed = prunePlan(
      [
        entry({
          id: 1,
          key: `Linux-live-token-${HASH_A}`,
          createdAt: '2026-08-20T02:00:00Z',
        }),
        entry({ id: 2, key: `Linux-live-token-${HASH_B}` }),
        entry({ id: 3 }),
      ],
      NOW,
    );

    expect(doomed.map((d) => d.entry.id)).toStrictEqual([1]);
  });

  it('never reads a newer entry on another ref as superseding', () => {
    // Cache restores are branch-scoped: a PR branch cannot restore main's
    // entry sideways, so deleting the branch's own entry would cost that
    // branch its cache entirely.
    const doomed = prunePlan(
      [
        entry({
          id: 1,
          ref: 'refs/pull/700/merge',
          createdAt: '2026-08-20T02:00:00Z',
        }),
        entry({ id: 2 }),
      ],
      NOW,
    );

    expect(doomed).toStrictEqual([]);
  });

  it('deletes an entry not restored in 7 days, even the newest', () => {
    const idle = entry({
      id: 1,
      lastAccessedAt: new Date(NOW - 8 * DAYS).toISOString(),
    });

    const doomed = prunePlan([idle], NOW);

    expect(doomed.map((d) => d.entry.id)).toStrictEqual([1]);
    expect(doomed[0]?.reason).toContain('not restored in 7 days');
  });

  it('keeps an entry idle for less than the threshold', () => {
    const idle = entry({
      id: 1,
      lastAccessedAt: new Date(NOW - 6 * DAYS).toISOString(),
    });

    expect(prunePlan([idle], NOW)).toStrictEqual([]);
  });

  it('treats a key without a hash tail as its own group', () => {
    // No prefix family to supersede within: only the staleness rule applies.
    const doomed = prunePlan(
      [
        entry({
          id: 1,
          key: 'Linux-adhoc',
          createdAt: '2026-08-20T02:00:00Z',
        }),
        entry({ id: 2, key: 'Linux-adhoc-two' }),
      ],
      NOW,
    );

    expect(doomed).toStrictEqual([]);
  });
});

describe('GhCacheClient and pruneCaches', () => {
  const recorder = (results: readonly Captured[] = []) => {
    const argv: string[][] = [];
    const exec: Exec = (cmd, args) => {
      argv.push([cmd, ...args]);
      return results[argv.length - 1] ?? { status: 0, stdout: '', stderr: '' };
    };
    return { argv, exec };
  };

  const apiEntry = (id: number, key: string) => ({
    id,
    key,
    ref: 'refs/heads/main',
    created_at: '2026-08-24T02:00:00Z',
    last_accessed_at: '2026-08-25T01:00:00Z',
    size_in_bytes: 2 * 1024 * 1024,
  });

  it('lists entries through the caches endpoint', () => {
    const { argv, exec } = recorder([
      {
        status: 0,
        stdout: JSON.stringify({
          total_count: 1,
          actions_caches: [apiEntry(7, 'Linux-adhoc')],
        }),
        stderr: '',
      },
    ]);

    expect(new GhCacheClient('o/r', exec).list()).toStrictEqual([
      {
        id: 7,
        key: 'Linux-adhoc',
        ref: 'refs/heads/main',
        createdAt: '2026-08-24T02:00:00Z',
        lastAccessedAt: '2026-08-25T01:00:00Z',
        sizeInBytes: 2 * 1024 * 1024,
      },
    ]);
    expect(argv[0]).toStrictEqual([
      'gh',
      'api',
      '/repos/o/r/actions/caches?per_page=100&page=1',
    ]);
  });

  it('walks pages until one comes back short', () => {
    // `--paginate` concatenates page objects into invalid JSON for this
    // endpoint, so the adapter pages explicitly.
    const fullPage = Array.from({ length: 100 }, (_, i) =>
      apiEntry(i, `k${i}`),
    );
    const { argv, exec } = recorder([
      {
        status: 0,
        stdout: JSON.stringify({ actions_caches: fullPage }),
        stderr: '',
      },
      {
        status: 0,
        stdout: JSON.stringify({ actions_caches: [apiEntry(100, 'last')] }),
        stderr: '',
      },
    ]);

    expect(new GhCacheClient('o/r', exec).list()).toHaveLength(101);
    expect(argv[1]?.[2]).toBe('/repos/o/r/actions/caches?per_page=100&page=2');
  });

  it('deletes by id with an explicit method', () => {
    const { argv, exec } = recorder();

    new GhCacheClient('o/r', exec).delete(42);

    expect(argv[0]).toStrictEqual([
      'gh',
      'api',
      '--method',
      'DELETE',
      '/repos/o/r/actions/caches/42',
    ]);
  });

  it('throws with gh stderr when a call fails', () => {
    const { exec } = recorder([
      { status: 1, stdout: '', stderr: 'HTTP 403\n' },
    ]);

    expect(() => new GhCacheClient('o/r', exec).list()).toThrow(
      /gh api .*caches.* failed \(exit 1\): HTTP 403/,
    );
  });

  it('prunes what the plan doomed and reports the freed size', () => {
    const deleted: number[] = [];
    const HASH_A = 'a'.repeat(64);
    const HASH_B = 'b'.repeat(64);
    const client = {
      list: (): CacheEntry[] => [
        {
          id: 1,
          key: `Linux-deps-v1-${HASH_A}`,
          ref: 'refs/heads/main',
          createdAt: '2026-08-20T02:00:00Z',
          lastAccessedAt: '2026-08-25T01:00:00Z',
          sizeInBytes: 3 * 1024 * 1024,
        },
        {
          id: 2,
          key: `Linux-deps-v1-${HASH_B}`,
          ref: 'refs/heads/main',
          createdAt: '2026-08-24T02:00:00Z',
          lastAccessedAt: '2026-08-25T01:00:00Z',
          sizeInBytes: 3 * 1024 * 1024,
        },
      ],
      delete: (id: number): void => {
        deleted.push(id);
      },
    };
    const logged = vi.spyOn(console, 'log').mockImplementation(() => {});

    const summary = pruneCaches(client, Date.parse('2026-08-25T02:00:00Z'));

    expect(deleted).toStrictEqual([1]);
    expect(summary).toBe('pruned 1 of 2 cache entries (3 MB freed).');
    expect(logged.mock.calls.flat().join('\n')).toContain('Linux-deps-v1-');

    logged.mockRestore();
  });
});
