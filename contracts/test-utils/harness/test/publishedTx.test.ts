/**
 * Tests for the published-transaction transport, `fetch` stubbed.
 *
 * The point of interest is the timeout contract. `awaitPublishedTxs` documents
 * "give up after this long", and enforcing that needs a bound on each request as
 * well as between polls, since `publishedTxsSince` issues one request per block.
 * A hung socket used to outlive the deadline entirely.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  awaitPublishedTxs,
  indexerHead,
  publishedTxsSince,
} from '../publishedTx.js';

// ---------------------------------------------------------------------------
// Stubbing the indexer
// ---------------------------------------------------------------------------

const realFetch = globalThis.fetch;

/** A GraphQL 200 carrying `data`. */
const ok = (data: unknown): Response =>
  ({
    ok: true,
    status: 200,
    json: async () => ({ data }),
  }) as unknown as Response;

const head = (height: number | null) => ({
  block: height === null ? null : { height },
});

const blockWith = (
  height: number,
  actions: readonly Record<string, unknown>[],
) => ({
  block: {
    height,
    transactions: [
      {
        hash: `0xtx${height}`,
        raw: `0xraw${height}`,
        contractActions: actions,
      },
    ],
  },
});

/** Never settles until aborted, which is what a stuck indexer looks like. */
const hang = (init?: { signal?: AbortSignal }): Promise<Response> =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => {
      // What undici raises when an `AbortSignal.timeout` fires.
      const error = new Error('The operation was aborted due to timeout');
      error.name = 'TimeoutError';
      reject(error);
    });
  });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// The timeout contract
// ---------------------------------------------------------------------------

describe('awaitPublishedTxs timeout', () => {
  it('should give up on a stuck indexer instead of hanging', async () => {
    fetchMock.mockImplementation(
      (_url: string, init?: { signal?: AbortSignal }) => hang(init),
    );

    const started = Date.now();
    await expect(awaitPublishedTxs(0, 1, 300)).rejects.toThrow(
      /expected 1 transaction\(s\) after block 0, saw 0/,
    );

    // The assertion that matters: bounded by the caller's deadline, not by
    // undici's far longer body timeout.
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it('should pass an abort signal on every request', async () => {
    fetchMock.mockResolvedValue(ok(head(0)));

    await indexerHead();

    const init = fetchMock.mock.calls[0]?.[1] as { signal?: AbortSignal };
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('should stop issuing per-block requests once the deadline passes', async () => {
    // A head far ahead of the lower bound: unbounded, this would be 5000 requests.
    fetchMock.mockImplementation(
      (_url: string, init?: { signal?: AbortSignal }) => {
        const body = JSON.parse(String((init as { body?: string })?.body));
        return body.query.includes('Head')
          ? Promise.resolve(ok(head(5_000)))
          : hang(init);
      },
    );

    await expect(awaitPublishedTxs(0, 1, 300)).rejects.toThrow(/expected 1/);

    // One head plus a bounded handful of block reads, nowhere near 5000.
    expect(fetchMock.mock.calls.length).toBeLessThan(20);
  });
});

// ---------------------------------------------------------------------------
// Protocol failures still surface at once
// ---------------------------------------------------------------------------

describe('protocol failures', () => {
  it('should surface an HTTP error rather than polling through it', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
    } as unknown as Response);

    await expect(awaitPublishedTxs(0, 1, 30_000)).rejects.toThrow(/HTTP 503/);
    // Not retried: one call, and the deadline was never consulted.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('should surface GraphQL errors', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ errors: [{ message: 'unknown field' }] }),
    } as unknown as Response);

    await expect(indexerHead()).rejects.toThrow(/unknown field/);
  });

  it('should surface an empty data payload', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    } as unknown as Response);

    await expect(indexerHead()).rejects.toThrow(/empty data/);
  });
});

// ---------------------------------------------------------------------------
// Reading a window, unchanged by the fix
// ---------------------------------------------------------------------------

describe('publishedTxsSince', () => {
  it('should report 0 for a head the indexer has no block for', async () => {
    fetchMock.mockResolvedValue(ok(head(null)));

    expect(await indexerHead()).toBe(0);
  });

  it('should keep only actions carrying an entry point', async () => {
    fetchMock.mockImplementation((_url: string, init?: unknown) => {
      const body = JSON.parse(String((init as { body?: string })?.body));
      return Promise.resolve(
        body.query.includes('Head')
          ? ok(head(1))
          : ok(
              blockWith(1, [
                // A deploy in the same block contributes no entry point.
                { address: '0xdeployed', state: '0xs' },
                { address: '0xcalled', entryPoint: 'transfer', state: '0xs' },
              ]),
            ),
      );
    });

    const [tx] = await publishedTxsSince(0);

    expect(tx?.calls).toStrictEqual([
      { address: '0xcalled', entryPoint: 'transfer', state: '0xs' },
    ]);
  });

  it('should filter by contract address, ignoring a 0x prefix', async () => {
    fetchMock.mockImplementation((_url: string, init?: unknown) => {
      const body = JSON.parse(String((init as { body?: string })?.body));
      return Promise.resolve(
        body.query.includes('Head')
          ? ok(head(1))
          : ok(
              blockWith(1, [
                { address: 'abc123', entryPoint: 'transfer', state: '0xs' },
              ]),
            ),
      );
    });

    expect(await publishedTxsSince(0, '0xabc123')).toHaveLength(1);
    expect(await publishedTxsSince(0, '0xdeadbeef')).toHaveLength(0);
  });
});
